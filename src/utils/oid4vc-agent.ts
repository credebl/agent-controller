import type { DisclosureFrame } from '../controllers/types'
import type {
  OpenId4VcCredentialHolderBinding,
  OpenId4VcCredentialHolderDidBinding,
  OpenId4VciCredentialRequestToCredentialMapper,
  OpenId4VciSignMdocCredentials,
  OpenId4VciSignSdJwtCredentials,
  OpenId4VciSignW3cCredentials,
} from '@credo-ts/openid4vc'

import { DidsApi } from '@credo-ts/core'
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

export function getCredentialRequestToCredentialMapper(): OpenId4VciCredentialRequestToCredentialMapper {
  return async ({
    holderBindings,
    issuanceSession,
    verification,
    credentialConfigurationIds,
    credentialConfigurationsSupported: supported,
    agentContext,
    authorization,
  }: {
    holderBindings: OpenId4VcCredentialHolderBinding[]
    issuanceSession: any
    verification?: any
    credentialConfigurationIds: string[]
    credentialConfigurationsSupported: any
    agentContext: any
    authorization: any
  }) => {
    const issuanceMetadata = issuanceSession.issuanceMetadata
    const issuerDid = issuanceMetadata?.['issuerDid'] as string | undefined
    const issuerx509certificate = issuanceMetadata?.['issuerx509certificate'] as string[] | undefined

    if (!issuerDid && !issuerx509certificate) {
      throw new Error('Either issuerDid or issuerx509certificate must be provided')
    }

    let issuerDidUrl: string | undefined = ''
    if (issuerDid) {
      const didsApi = await agentContext.dependencyManager.resolve(DidsApi)
      const didDocument = await didsApi.resolveDidDocument(issuerDid)

      // Set the first verificationMethod as backup, in case we won't find a match
      if (!issuerDidUrl && didDocument.verificationMethod?.[0].id) {
        issuerDidUrl = didDocument.verificationMethod?.[0].id
      }
    }

    if (!issuerDidUrl && !issuerx509certificate) {
      throw new Error('No matching verification method found')
    }

    if (!issuanceMetadata?.['credentials']) throw new Error('credential payload is not provided')

    const allCredentialPayload = issuanceMetadata?.['credentials']

    const credentialConfigurationId = credentialConfigurationIds[0]

    // Returns an array of all matching credentials
    const credentialPayload = Array.isArray(allCredentialPayload)
      ? allCredentialPayload.filter((c) => c.credentialSupportedId === credentialConfigurationId)
      : []
    const credentialConfiguration = supported[credentialConfigurationId]

    if (credentialConfigurationId === 'PresentationAuthorization') {
      const trustedCertificates = agentContext.dependencyManager.resolve(X509ModuleConfig).trustedCertificates
      if (trustedCertificates?.length !== 1) {
        throw new Error(`Expected exactly one trusted certificate. Received ${trustedCertificates?.length}.`)
      }

      return {
        credentialConfigurationId,
        format: ClaimFormat.SdJwtVc,
        credentials: holderBindings.map((holderBinding) => ({
          payload: {
            vct: credentialConfiguration.vct,
            authorized_user: authorization.accessToken.payload.sub,
          },
          holder: holderBinding,
          issuer:
            holderBindings[0].method === 'did'
              ? {
                  method: 'did',
                  didUrl: issuerDidUrl ?? '',
                }
              : { method: 'x5c', x5c: trustedCertificates, issuer: 'ISSUER_HOST ' },
        })),
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.JwtVcJson) {
      for (const holderBinding of holderBindings) {
        assertDidBasedHolderBinding(holderBinding)
      }

      return {
        credentialConfigurationId,
        format: ClaimFormat.JwtVc,
        credentials: holderBindings.map((holderBinding) => {
          assertDidBasedHolderBinding(holderBinding)

          const verificationMethod: string = issuerDidUrl ?? ''
          if (!verificationMethod) {
            throw new Error('issuerDidUrl is required for verificationMethod')
          }

          const finalVC = {
            credential: new W3cCredential({
              type: credentialConfiguration.credential_definition.type,
              issuer: new W3cIssuer({
                id: parseDid(verificationMethod).did,
              }),
              credentialSubject: JsonTransformer.fromJSON(
                {
                  id: parseDid(holderBinding.didUrl).did,
                  claims: {
                    ...credentialPayload[0].payload,
                  },
                },
                W3cCredentialSubject,
              ),
              issuanceDate: w3cDate(Date.now()),
            }),
            verificationMethod,
          }
          return finalVC
        }),
      } satisfies OpenId4VciSignW3cCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.SdJwtVc) {
      const disclosureFramePayload =
        credentialPayload[0].disclosureFrame && Object.keys(credentialPayload[0].disclosureFrame).length > 0
          ? credentialPayload[0].disclosureFrame
          : {}

      return {
        credentialConfigurationId,
        format: ClaimFormat.SdJwtVc,
        credentials: holderBindings.map((holderBinding) => ({
          payload: credentialPayload[0].payload,
          holder: holderBinding,
          issuer: issuerDidUrl
            ? {
                method: 'did',
                didUrl: issuerDidUrl,
              }
            : {
                method: 'x5c',
                x5c: issuerx509certificate ?? [], //[issuerx509certificate??""],
                issuer: process.env.AGENT_HOST ?? 'http://localhost:4001',
              },
          disclosureFrame: disclosureFramePayload,
        })),
      } satisfies OpenId4VciSignSdJwtCredentials
    }
    throw new Error('Invalid request')
  }
}

export function getMixedCredentialRequestToCredentialMapper(): OpenId4VciCredentialRequestToCredentialMapper {
  return async ({
    holderBindings,
    issuanceSession,
    verification,
    credentialConfigurationIds,
    credentialConfigurationsSupported,
    agentContext,
    authorization,
  }) => {
    const issuanceMetadata = issuanceSession.issuanceMetadata

    if (!issuanceMetadata?.['credentials']) throw new Error('credential payload is not provided')

    const allCredentialPayload = issuanceMetadata?.['credentials']

    const credentialConfigurationId = credentialConfigurationIds[0]

    // Returns an array of all matching credentials
    const credentialPayload = Array.isArray(allCredentialPayload)
      ? allCredentialPayload.filter(
          (c: Record<string, unknown>) => c.credentialSupportedId === credentialConfigurationId,
        )
      : []
    const credentialConfiguration = credentialConfigurationsSupported[credentialConfigurationId]

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
          throw new Error('No matching verification method found')
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
        credentialConfigurationId,
        format: ClaimFormat.SdJwtVc,
        credentials: holderBindings.map((holderBinding) => ({
          payload: {
            vct: credentialConfiguration.vct,
            authorized_user: authorization.accessToken.payload.sub,
          },
          holder: holderBinding,
          issuer:
            holderBindings[0].method === 'did'
              ? {
                  method: 'did',
                  didUrl: issuerDidVerificationMethod ?? '',
                }
              : { method: 'x5c', x5c: trustedCertificates, issuer: 'ISSUER_HOST ' },
        })),
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.MsoMdoc) {
      if (!issuerx509certificate)
        throw new Error(
          `issuerx509certificate is not provided for credential type ${OpenId4VciCredentialFormatProfile.MsoMdoc}`,
        )

      if (!credentialConfiguration.doctype) {
        throw new Error(
          `'doctype' not found in credential configuration, ${JSON.stringify(credentialConfiguration, null, 2)}`,
        )
      }

      // national id and ICAO default
      const namespace = credentialConfiguration.doctype

      return {
        credentialConfigurationId,
        format: ClaimFormat.MsoMdoc,
        credentials: holderBindings.map((holderBinding) => ({
          issuerCertificate: issuerx509certificate[0],
          holderKey: holderBinding.key,
          ...credential.payload,         
          docType: credentialConfiguration.doctype,
        })),
      } satisfies OpenId4VciSignMdocCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.JwtVcJson) {
      for (const holderBinding of holderBindings) {
        assertDidBasedHolderBinding(holderBinding)
      }

      return {
        credentialConfigurationId,
        format: ClaimFormat.JwtVc,
        credentials: holderBindings.map((holderBinding) => {
          assertDidBasedHolderBinding(holderBinding)

          const finalVC = {
            credential: new W3cCredential({
              type: credentialConfiguration.credential_definition.type,
              issuer: new W3cIssuer({
                id: parseDid(issuerDidVerificationMethod).did,
              }),
              credentialSubject: JsonTransformer.fromJSON(
                {
                  id: parseDid(holderBinding.didUrl).did,
                  claims: {
                    ...credential.payload,
                  },
                },
                W3cCredentialSubject,
              ),
              issuanceDate: w3cDate(Date.now()),
            }),
            verificationMethod: issuerDidVerificationMethod,
          }
          return finalVC
        }),
      } satisfies OpenId4VciSignW3cCredentials
    }

    if (credentialConfiguration.format === OpenId4VciCredentialFormatProfile.SdJwtVc) {
     const disclosureFramePayload =
        credentialPayload[0].disclosureFrame && Object.keys(credentialPayload[0].disclosureFrame).length > 0
          ? credentialPayload[0].disclosureFrame
          : {}

      return {
        credentialConfigurationId,
        format: ClaimFormat.SdJwtVc,
        credentials: holderBindings.map((holderBinding) => ({
          payload: credential.payload,
          holder: holderBinding,
          issuer: issuerDidVerificationMethod
            ? {
                method: 'did',
                didUrl: issuerDidVerificationMethod,
              }
            : {
                method: 'x5c',
                x5c: issuerx509certificate ?? [], //[issuerx509certificate??""],
                issuer: `${process.env.AGENT_HTTP_URL}`,
              },
          disclosureFrame: disclosureFramePayload,
        })),
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    throw new Error('Invalid request')
  }
}

function assertDidBasedHolderBinding(
  holderBinding: OpenId4VcCredentialHolderBinding,
): asserts holderBinding is OpenId4VcCredentialHolderDidBinding {
  if (holderBinding.method !== 'did') {
    throw new CredoError('Only did based holder bindings supported for this credential type')
  }
}

export interface OpenId4VcIssuanceSessionCreateOfferSdJwtCredentialOptions {
  /**
   * The id of the `credential_supported` entry that is present in the issuer
   * metadata. This id is used to identify the credential that is being offered.
   *
   * @example "ExampleCredentialSdJwtVc"
   */
  credentialSupportedId: string

  /**
   * The format of the credential that is being offered.
   * MUST match the format of the `credential_supported` entry.
   *
   * @example {@link OpenId4VciCredentialFormatProfile.SdJwtVc}
   */
  format: OpenId4VciCredentialFormatProfile

  /**
   * The payload of the credential that will be issued.
   *
   * If `vct` claim is included, it MUST match the `vct` claim from the issuer metadata.
   * If `vct` claim is not included, it will be added automatically.
   *
   * @example
   * {
   *   "first_name": "John",
   *   "last_name": "Doe",
   *   "age": {
   *      "over_18": true,
   *      "over_21": true,
   *      "over_65": false
   *   }
   * }
   */
  payload: {
    vct?: string
    [key: string]: unknown
  }

  /**
   * Disclosure frame indicating which fields of the credential can be selectively disclosed.
   *
   * @example
   * {
   *   "first_name": false,
   *   "last_name": false,
   *   "age": {
   *      "over_18": true,
   *      "over_21": true,
   *      "over_65": true
   *   }
   * }
   */
  disclosureFrame: DisclosureFrame
}
