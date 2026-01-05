// FIXME: We've made many changes in this file for building agent with OIDC modules, please check the types and proper implementation of the changes

import type { DisclosureFrame } from '../controllers/types'
import type { SdJwtVcHolderBinding } from '@credo-ts/core'
import type {
  OpenId4VcCredentialHolderBinding,
  OpenId4VcCredentialHolderDidBinding,
  OpenId4VciCredentialRequestToCredentialMapper,
  OpenId4VciSignMdocCredentials,
  OpenId4VciSignSdJwtCredentials,
  OpenId4VciSignW3cCredentials,
} from '@credo-ts/openid4vc'

import { DidsApi, Kms, MdocApi, X509Certificate, X509Service } from '@credo-ts/core'
import {
  ClaimFormat,
  CredoError,
  JsonTransformer,
  W3cCredential,
  W3cCredentialSubject,
  W3cIssuer,
  X509ModuleConfig,
  parseDid,
  w3cDate,
} from '@credo-ts/core'
import { OpenId4VciCredentialFormatProfile } from '@credo-ts/openid4vc'

import { SignerMethod } from '../enums/enum'

export function getMixedCredentialRequestToCredentialMapper(): OpenId4VciCredentialRequestToCredentialMapper {
  return async ({
    holderBinding,
    issuanceSession,
    verification,
    credentialConfigurationId,
    credentialConfiguration,
    agentContext,
    authorization,
  }) => {
    const issuanceMetadata = issuanceSession.issuanceMetadata
    if (!issuanceMetadata?.['credentials']) throw new Error('credential payload is not provided')

    const allCredentialPayload = issuanceMetadata?.['credentials']

    // Returns an array of all matching credentials
    const credentialPayload = Array.isArray(allCredentialPayload)
      ? allCredentialPayload.filter(
          (c: Record<string, unknown>) => c.credentialSupportedId === credentialConfigurationId,
        )
      : []
    if (credentialPayload.length === 0) {
      throw new Error(`No credential payload found for credentialConfigurationId: ${credentialConfigurationId}`)
    }
    const credential = credentialPayload[0]
    let issuerDidVerificationMethod: string | undefined = ''
    let issuerx509certificate: string[] | undefined

    if (credential.signerOptions.method === SignerMethod.Did) {
      if (credential.signerOptions.did) {
        const didsApi = agentContext.dependencyManager.resolve(DidsApi)
        const didDocument = await didsApi.resolveDidDocument(credential.signerOptions.did)
        // Set the first verificationMethod as backup, in case we won't find a match
        if (didDocument.verificationMethod?.[0].id) {
          issuerDidVerificationMethod = didDocument.verificationMethod?.[0].id
        }

        if (!issuerDidVerificationMethod) {
          throw new Error('DID must be provided when using Did as signer method')
        }
      }
    } else if (credential.signerOptions.method === SignerMethod.X5c) {
      if (credential.signerOptions.x5c) {
        issuerx509certificate = credential.signerOptions.x5c // as string[] | undefined;

        if (!issuerx509certificate) {
          throw new Error('x509certificate must be provided when using x5c as signer method')
        }
      }
    }

    if (credentialConfigurationId === 'PresentationAuthorization') {
      const trustedCertificates = agentContext.dependencyManager.resolve(X509ModuleConfig).trustedCertificates
      if (trustedCertificates?.length !== 1) {
        throw new Error(`Expected exactly one trusted certificate. Received ${trustedCertificates?.length}.`)
      }

      return {
        format: ClaimFormat.SdJwtDc,
        credentials: [
          {
            payload: {
              vct: credentialConfiguration.vct,
              authorized_user: authorization.accessToken.payload.sub,
            },
            holder: {
              method: 'jwk',
              jwk: holderBinding.keys[0].jwk,
            } as SdJwtVcHolderBinding,
            issuer: {
              method: 'x5c',
              x5c: trustedCertificates.map((cert) => X509Certificate.fromEncodedCertificate(cert)),
              issuer: 'ISSUER_HOST',
            },
          },
        ],
        type: 'credentials',
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.MsoMdoc) {
      if (!issuerx509certificate)
        throw new Error(
          `issuerx509certificate is not provided for credential type ${OpenId4VciCredentialFormatProfile.MsoMdoc}`,
        )

      if (!credentialConfiguration.doctype) {
        throw new Error(`'doctype' not found in credential configuration,`)
      }

      const parsedCertificate = X509Service.parseCertificate(agentContext, {
        encodedCertificate: issuerx509certificate[0],
      })
      parsedCertificate.publicJwk.keyId = credential.signerOptions.keyId
      return {
        type: 'credentials',
        format: ClaimFormat.MsoMdoc,
        credentials: holderBinding.keys.map((holderBindingDetails) => ({
          issuerCertificate: parsedCertificate,
          holderKey: holderBindingDetails.jwk,
          ...credential.payload,
          docType: credentialConfiguration.doctype,
        })),
      } satisfies OpenId4VciSignMdocCredentials
    }
    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.SdJwtDc) {
      const disclosureFramePayload =
        credential.disclosureFrame && Object.keys(credential.disclosureFrame).length > 0
          ? credential.disclosureFrame
          : {}
      //Taking leaf certifcate from chain as issuer certificate, if not provided explicitly taking AGENT_HTTP_URL as issuer
      let parsedCertificate: any
      if (!issuerDidVerificationMethod && issuerx509certificate && issuerx509certificate.length > 0) {
        parsedCertificate = X509Service.parseCertificate(agentContext, {
          encodedCertificate: issuerx509certificate[0],
        })
        parsedCertificate.publicJwk.keyId = credential.signerOptions.keyId
      } else if (!issuerDidVerificationMethod) {
        throw new Error(`issuerx509certificate is not provided for credential ${credentialConfigurationId}`)
      }
      return {
        format: ClaimFormat.SdJwtDc,
        credentials: holderBinding.keys.map((binding) => ({
          payload: credentialPayload[0]?.payload,
          holder:
            binding.method === 'did'
              ? ({
                  method: 'did' as const,
                  didUrl: binding.didUrl,
                } as SdJwtVcHolderBinding)
              : ({
                  method: 'jwk' as const,
                  jwk: binding.method === 'jwk' ? binding.jwk : {},
                } as SdJwtVcHolderBinding),
          issuer: issuerDidVerificationMethod
            ? {
                method: 'did',
                didUrl: issuerDidVerificationMethod,
              }
            : {
                method: 'x5c',
                x5c: [parsedCertificate],
                // TODO: Need to check validation for issuer value
                // issuer: process.env.AGENT_HOST ?? 'http://localhost:4001',
              },
          disclosureFrame: disclosureFramePayload,
        })),
        type: 'credentials',
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    throw new Error('Invalid request')
  }
}

// function assertDidBasedHolderBinding(
//   holderBinding: OpenId4VcCredentialHolderBinding,
// ): asserts holderBinding is OpenId4VcCredentialHolderDidBinding {
//   if (holderBinding.method !== 'did') {
//     throw new CredoError('Only did based holder bindings supported for this credential type')
//   }
// }

export async function getTrustedCerts() {
  try {
    // const response = await fetch(`${process.env.TRUST_LIST_URL}`)
    // if (!response.ok) {
    //   throw new Error(`HTTP error! status: ${response.status}`)
    // }
    // const data = await response.json()
    // return data as string[]
    return [
      'MIICBzCCAbmgAwIBAgIRAMEUex+GR2GZKusP/izv/oswBQYDK2VwMCsxHDAaBgNVBAMTE0V4YW1wbGUgQ29ycG9yYXRpb24xCzAJBgNVBAYTAlVTMB4XDTI1MDEwMTAwMDAwMFoXDTI3MDEwMTAwMDAwMFowKzEcMBoGA1UEAxMTRXhhbXBsZSBDb3Jwb3JhdGlvbjELMAkGA1UEBhMCVVMwKjAFBgMrZXADIQC5RNVbJCX2L/z/PLbvaxLqi7+hA4fUUStWcmAo/qkX2aOB8TCB7jAdBgNVHQ4EFgQUkog6trQXXfsjb472jybLCBixSAMwDgYDVR0PAQH/BAQDAgGiMBUGA1UdJQEB/wQLMAkGByiBjF0FAQIwIgYDVR0jAQH/BBgwFoAUkog6trQXXfsjb472jybLCBixSAMwQAYDVR0SAQH/BDYwNIILZXhhbXBsZS5jb22GEmh0dHA6Ly9leGFtcGxlLmNvbYERYWRtaW5AZXhhbXBsZS5jb20wLAYDVR0RAQH/BCIwIIILZXhhbXBsZS5jb22BEWFkbWluQGV4YW1wbGUuY29tMBIGA1UdEwEB/wQIMAYBAf8CAQAwBQYDK2VwA0EAPjHj2keDv8BN3FGkOqG36VQKaYvb9Ena+1BI7hb+sBJ+QgBTlj1sK/+I7LMUfu/K3oCyZxT1CZpYRZkh7GEWAw==',
    ]
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching data:', error)
    return []
  }
}
