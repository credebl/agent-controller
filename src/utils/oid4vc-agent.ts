import type { DisclosureFrame } from '../controllers/types'
import type { SdJwtVcHolderBinding } from '@credo-ts/core'
import type {
  OpenId4VcCredentialHolderBinding,
  OpenId4VcCredentialHolderDidBinding,
  OpenId4VciCredentialRequestToCredentialMapper,
  OpenId4VciSignMdocCredentials,
  OpenId4VciSignSdJwtCredentials,
} from '@credo-ts/openid4vc'

import {
  Agent,
  ClaimFormat,
  CredoError,
  DidsApi,
  LogLevel,
  X509Certificate,
  X509ModuleConfig,
  X509Service,
  W3cCredential,
  W3cV2Credential,
  JsonTransformer,
  CREDENTIALS_CONTEXT_V1_URL,
  CREDENTIALS_CONTEXT_V2_URL,
} from '@credo-ts/core'
import { OpenId4VciCredentialFormatProfile } from '@credo-ts/openid4vc'
import { container } from 'tsyringe'

import { SignerMethod } from '../enums/enum'

import { validateAuthConfig } from './auth'
import { checkX509Certificates, processIsoImages } from './helpers'
import { TsLogger } from './logger'

const logger = new TsLogger(LogLevel.info)

export function getMixedCredentialRequestToCredentialMapper(): OpenId4VciCredentialRequestToCredentialMapper {
  return async ({
    holderBinding,
    issuanceSession,
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
              vct: credentialConfiguration.vct as string,
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
      if (!issuerx509certificate || issuerx509certificate.length === 0)
        throw new Error(
          `issuerx509certificate is not provided or empty for credential type ${OpenId4VciCredentialFormatProfile.MsoMdoc}`,
        )

      if (!credentialConfiguration.doctype) {
        throw new Error(`'doctype' not found in credential configuration,`)
      }

      const parsedCertificates = issuerx509certificate.map((cert) => {
        return X509Service.parseCertificate(agentContext, {
          encodedCertificate: cert,
        })
      })

      parsedCertificates[0].publicJwk.keyId = credential.signerOptions.keyId
      const updatedNamespaces = processIsoImages(credential.payload.namespaces)
      credential.payload.namespaces = updatedNamespaces
      return {
        type: 'credentials',
        format: ClaimFormat.MsoMdoc,
        credentials: holderBinding.keys.map((holderBindingDetails) => ({
          issuerCertificate: parsedCertificates as any,
          holderKey: holderBindingDetails.jwk,
          ...credential.payload,
          validityInfo: {
            signed: credential.payload.validityInfo.signed
              ? new Date(credential.payload.validityInfo.signed)
              : new Date(),
            validFrom: new Date(credential.payload.validityInfo.validFrom),
            validUntil: new Date(credential.payload.validityInfo.validUntil),
          },
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
              },
          disclosureFrame: disclosureFramePayload,
        })),
        type: 'credentials',
      } satisfies OpenId4VciSignSdJwtCredentials
    }

    if (
      credentialConfiguration.format === OpenId4VciCredentialFormatProfile.JwtVcJson ||
      credentialConfiguration.format === OpenId4VciCredentialFormatProfile.JwtVcJsonLd
    ) {
      if (credential.signerOptions.method === SignerMethod.X5c) {
        throw new Error(`X5c signing method is not supported for W3C VC formats (${credentialConfiguration.format})`)
      }

      const payload = credentialPayload[0]?.payload
      const context = payload?.['@context']
      const contextArray = Array.isArray(context) ? context : context ? [context] : []
      const isV2 =
        contextArray.includes(CREDENTIALS_CONTEXT_V2_URL) || !!payload?.validFrom || !!payload?.validUntil

      return {
        format: ClaimFormat.JwtVc,
        credentials: holderBinding.keys.map((binding) => {
          let rawSubject: any
          let subjectId: string | undefined = undefined
          const bindingDid = binding.method === 'did' ? (binding as any).didUrl : undefined

          if (Array.isArray(payload.credentialSubject)) {
            rawSubject = payload.credentialSubject.map((subj: any) => {
              if (subj && typeof subj === 'object') {
                const itemId = subj.id || bindingDid
                return itemId ? { ...subj, id: itemId } : { ...subj }
              }
              return subj
            })
            const firstWithId = rawSubject.find((s: any) => s?.id)
            subjectId = firstWithId?.id || bindingDid
          } else {
            const origSubject = payload.credentialSubject || {}
            subjectId = origSubject.id || bindingDid

            rawSubject = { ...origSubject }
            if (subjectId) {
              rawSubject.id = subjectId
            }
          }

          const issuer = payload.issuer || credential.signerOptions.did
          const finalIssuer = isV2 && typeof issuer === 'string' ? { id: issuer } : issuer

          const mainContext = isV2 ? CREDENTIALS_CONTEXT_V2_URL : CREDENTIALS_CONTEXT_V1_URL

          const finalContext = contextArray.includes(mainContext)
            ? [mainContext, ...contextArray.filter((c) => c !== mainContext)]
            : [mainContext, ...contextArray]

          const credentialJson: any = {
            '@context': finalContext,
            type: payload.type,
            issuer: finalIssuer,
            credentialSubject: rawSubject,
          }

          if (isV2) {
            credentialJson.validFrom = payload.validFrom || payload.issuanceDate
            credentialJson.validUntil = payload.validUntil || payload.expirationDate
            // Add issuanceDate for JWT signer compatibility
            credentialJson.issuanceDate = credentialJson.validFrom
            credentialJson.expirationDate = credentialJson.validUntil
          } else {
            credentialJson.issuanceDate = payload.issuanceDate
            credentialJson.expirationDate = payload.expirationDate
          }

          const credInstance: any = isV2
            ? JsonTransformer.fromJSON(credentialJson, W3cV2Credential)
            : JsonTransformer.fromJSON(credentialJson, W3cCredential)

          if (credInstance.credentialSubject) {
            if (Array.isArray(credInstance.credentialSubject)) {
              for (const item of credInstance.credentialSubject) {
                if (item && typeof item === 'object') {
                  item.id = item.id || subjectId
                }
              }
            } else {
              credInstance.credentialSubject.id = subjectId
            }
          }

          return {
            format: ClaimFormat.JwtVc,
            verificationMethod: issuerDidVerificationMethod,
            credential: credInstance,
          }
        }),
        type: 'credentials',
      } as any
    }

    throw new Error('Invalid request format ' + credentialConfiguration.format)
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
    issuer?: string | any
    credentialSubject?: any
    validFrom?: string
    validUntil?: string
    issuanceDate?: string
    expirationDate?: string
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

async function verifyX509CertificateTrust(
  certificateChain: X509Certificate[],
  isDedicated: boolean,
  tenantId?: string,
): Promise<boolean> {
  const x509Certificates = certificateChain.map((cert) => cert.toString('base64'))
  return checkX509Certificates(x509Certificates, isDedicated, tenantId)
}

export async function getTrustedCerts(params: {
  certificateChain: X509Certificate[]
  tenantId?: string
}): Promise<boolean> {
  const { tenantId, certificateChain } = params

  const agent = container.resolve(Agent)
  if (!agent) {
    throw new Error('[getTrustedCerts] agent not available in container')
  }

  if (certificateChain.length === 0) {
    throw new Error('[getTrustedCerts] certificate chain is required but was not provided')
  }

  const isDedicated = !('tenants' in agent.modules)
  logger.info(`[getTrustedCerts] agent type: ${isDedicated ? 'dedicated' : 'shared'}`)

  if (!isDedicated && !tenantId) {
    throw new Error('[getTrustedCerts] tenantId is required for shared agents')
  }

  const isTrusted = await verifyX509CertificateTrust(certificateChain, isDedicated, tenantId)
  if (!isTrusted) {
    logger.warn(`[getTrustedCerts] certificate chain not trusted${isDedicated ? '' : ` for tenantId: ${tenantId}`}`)
  }

  return isTrusted
}

/**
 * ClientAuth flow: verifies the certificate chain against the trust-service using a platform token.
 * Returns the PEM certs if trusted, empty array if not.
 */
export async function getX509CertsByClientToken(
  tenantId: string,
  certificateChain: X509Certificate[],
): Promise<string[]> {
  const isTrusted = await getTrustedCerts({ certificateChain, tenantId })

  if (!isTrusted) {
    logger.warn(`[getX509CertsByClientToken] certificate chain not trusted for tenantId: ${tenantId}`)
    return []
  }

  return certificateChain.map((cert) => cert.toString('pem'))
}

export async function getX509CertsByUrl(): Promise<string[]> {
  const trustListUrl = process.env.TRUST_LIST_URL
  if (!trustListUrl) throw new Error('[getX509CertsByUrl] TRUST_LIST_URL is not configured')

  logger.info(`[getX509CertsByUrl] fetching trust list from: ${trustListUrl}`)

  const response = await fetch(trustListUrl)

  if (!response.ok) {
    throw new Error(`[getX509CertsByUrl] failed to fetch trust list: HTTP ${response.status}`)
  }

  const data = await response.json()

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('[getX509CertsByUrl] trust list is empty or invalid')
  }

  logger.info(`[getX509CertsByUrl] fetched certificates count: ${data.length}`)

  return data as string[]
}

export { validateAuthConfig }
