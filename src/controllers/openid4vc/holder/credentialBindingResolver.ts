import type { CredentialBindingPolicy } from '../types/holder.types'

import {
  type AgentContext,
  DidJwk,
  DidKey,
  DidsApi,
  type JwkDidCreateOptions,
  type KeyDidCreateOptions,
  Kms,
  type VerificationMethod,
  W3cCredentialRecord,
  getPublicJwkFromVerificationMethod,
  parseDid,
  tryParseDid,
} from '@credo-ts/core'
import {
  type OpenId4VciCredentialBindingOptions,
  type OpenId4VciCredentialBindingResolver,
  OpenId4VciCredentialFormatProfile,
  type OpenId4VciResolvedCredentialOffer,
} from '@credo-ts/openid4vc'

import { BadRequestError, UnprocessableEntityError } from '../../../errors/errors'
import { selectKmsBackendForCreate } from '../../../utils/kms/backend'

import {
  BINDING_ERROR_CODES,
  BindingValidationError,
  KeyCreationError,
  getKeyTypeForAlgorithm,
  kmsBackendAvailability,
  selectFreshKeyDidMethod,
  selectFreshKeySignatureAlgorithm,
} from './credentialBindingOptions'

export interface CredentialBindingResolverOptions {
  requestBatch?: boolean | number
  /**
   * DID URL of a verification method (e.g. `did:web:example.com#key-1`), or a bare DID to use its
   * first authentication key. The DID must have been created or imported in this agent.
   */
  holderDidUrl?: string
  bindingPolicy?: CredentialBindingPolicy
  /** DID method for a fresh key, e.g. `did:jwk` or `did:key`. Only used when `holderDidUrl` is absent. */
  didMethod?: string
  /** JWA algorithm for a fresh key's proof of possession. Only used when `holderDidUrl` is absent. */
  signatureAlgorithm?: string
}

/**
 * The issuer does not accept the requested holder DID. With the `prefer` policy the resolver
 * falls back to a new key instead of throwing.
 */
export class HolderBindingNotSupportedError extends BadRequestError {}

/** The issuer returned a credential that is not bound to the requested holder DID. */
export class HolderBindingMismatchError extends UnprocessableEntityError {}

/**
 * Checks that each W3C credential names the holder DID as a `credentialSubject`.
 *
 * Credo proves possession of the holder key to the issuer and verifies the issuer's signature, but not
 * that the issuer used the proven DID as the subject. Call it before storing, with the `require` policy.
 */
export function assertW3cCredentialsBoundToHolderDid(records: unknown[], holderDidUrl: string) {
  const holderDid = parseDid(holderDidUrl).did
  for (const record of records) {
    if (!(record instanceof W3cCredentialRecord)) continue

    const subjectIds = record.firstCredential.credentialSubjectIds
    if (!subjectIds.some((subjectId) => tryParseDid(subjectId)?.did === holderDid)) {
      throw new HolderBindingMismatchError(
        `The issuer returned a credential whose subject (${subjectIds.join(', ') || 'none'}) is not the holder DID '${holderDid}'`,
      )
    }
  }
}

export function getCredentialBindingResolver({
  requestBatch,
  holderDidUrl,
  bindingPolicy = 'require',
  didMethod,
  signatureAlgorithm,
}: CredentialBindingResolverOptions): OpenId4VciCredentialBindingResolver {
  return async (options) => {
    if (holderDidUrl) {
      try {
        const didUrl = await resolveHolderDidBinding(options, holderDidUrl)
        return { method: 'did', didUrls: [didUrl] }
      } catch (error) {
        if (
          !(error instanceof HolderBindingNotSupportedError) ||
          bindingPolicy === 'require' ||
          options.credentialFormat === OpenId4VciCredentialFormatProfile.MsoMdoc
        ) {
          throw error
        }
        options.agentContext.config.logger.warn(
          `Issuer does not support binding to '${holderDidUrl}', falling back to a new key: ${error.message}`,
        )
      }
    }

    return createNewKeyBinding(options, requestBatch, { didMethod, signatureAlgorithm })
  }
}

/**
 * Checks that the issuer accepts a proof signed with the holder DID's key and returns the
 * absolute verification method id to bind to. Credo picks the signing algorithm itself.
 */
async function resolveHolderDidBinding(
  {
    agentContext,
    proofTypes,
    supportedDidMethods,
    supportsAllDidMethods,
    credentialFormat,
  }: OpenId4VciCredentialBindingOptions,
  holderDidUrl: string,
): Promise<string> {
  const { verificationMethod, verificationMethodId } = await resolveHolderVerificationMethod(agentContext, holderDidUrl)

  assertDidBindingAllowed(verificationMethodId, credentialFormat, supportedDidMethods, supportsAllDidMethods)
  assertJwtProofAllowed(
    verificationMethod,
    verificationMethodId,
    proofTypes.jwt
      ? {
          keyAttestationsRequired: Boolean(proofTypes.jwt.keyAttestationsRequired),
          algorithms: proofTypes.jwt.supportedSignatureAlgorithms,
        }
      : undefined,
  )

  return verificationMethodId
}

/**
 * Checks the holder DID, and with the `require` policy the offered credential configurations,
 * before the token request, so that a binding that will fail does so before the pre-authorized
 * code and PIN are used. Covers the format and DID method; the resolver also checks the key algorithm.
 */
export async function assertOfferAcceptsHolderDid(
  agentContext: AgentContext,
  resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
  credentialConfigurationIds: string[],
  { holderDidUrl, bindingPolicy = 'require' }: { holderDidUrl: string; bindingPolicy?: CredentialBindingPolicy },
) {
  const { verificationMethod, verificationMethodId } = await resolveHolderVerificationMethod(agentContext, holderDidUrl)

  // mso_mdoc cannot be DID-bound at all, so prefer cannot fall back to a key that was never requested.
  for (const configurationId of credentialConfigurationIds) {
    const configuration = resolvedCredentialOffer.offeredCredentialConfigurations[configurationId]
    if (configuration?.format === OpenId4VciCredentialFormatProfile.MsoMdoc) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT,
        `${configurationId}: DID binding is not supported for the '${configuration.format}' format`,
      )
    }
  }
  if (bindingPolicy === 'prefer') return

  for (const configurationId of credentialConfigurationIds) {
    const configuration = resolvedCredentialOffer.offeredCredentialConfigurations[configurationId]
    // Credo rejects configurations with unknown formats itself
    if (!configuration) continue

    const bindingMethods = configuration.cryptographic_binding_methods_supported
    try {
      assertDidBindingAllowed(
        verificationMethodId,
        configuration.format,
        bindingMethods?.filter((method) => method.startsWith('did:')),
        bindingMethods?.includes('did') ?? false,
      )
      // Without proof_types_supported the issuer states no proof requirements to check
      const proofTypes = configuration.proof_types_supported
      if (proofTypes) {
        const jwt = proofTypes.jwt
        assertJwtProofAllowed(
          verificationMethod,
          verificationMethodId,
          jwt
            ? {
                keyAttestationsRequired: Boolean(jwt.key_attestations_required),
                algorithms: jwt.proof_signing_alg_values_supported,
              }
            : undefined,
        )
      }
    } catch (error) {
      if (error instanceof HolderBindingNotSupportedError) {
        throw new HolderBindingNotSupportedError(`${configurationId}: ${error.message}`)
      }
      throw error
    }
  }
}

export interface NewKeyBindingSelection {
  didMethod?: string
  signatureAlgorithm?: string
}

/**
 * Checks a fresh-key selection against every requested configuration before the token request, so an unsupported DID
 * method, proof algorithm or KMS backend cannot consume an offer or tx code. The resolver repeats the checks with the
 * algorithm list Credo has already narrowed to the wallet's capabilities.
 */
export function assertOfferAcceptsNewKeyBinding(
  agentContext: AgentContext,
  resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
  credentialConfigurationIds: string[],
  { didMethod, signatureAlgorithm }: NewKeyBindingSelection,
): void {
  const availability = kmsBackendAvailability(agentContext.resolve(Kms.KeyManagementApi))

  for (const configurationId of credentialConfigurationIds) {
    const configuration = resolvedCredentialOffer.offeredCredentialConfigurations[configurationId]
    // Credo rejects configurations with unknown formats itself
    if (!configuration) continue

    try {
      const bindingMethods = configuration.cryptographic_binding_methods_supported
      const selectedDidMethod = selectFreshKeyDidMethod({
        didMethod,
        supportedDidMethods: bindingMethods?.filter((method) => method.startsWith('did:')),
        supportsAllDidMethods: bindingMethods?.includes('did') ?? false,
        supportsJwk: Boolean(bindingMethods?.includes('jwk') || bindingMethods?.includes('cose_key')),
        credentialFormat: configuration.format,
      })

      const jwtProof = configuration.proof_types_supported?.jwt
      // As in the require-policy DID preflight, missing proof metadata states no requirements to check.
      // Credo narrows the algorithms to the wallet's capabilities when it creates the proof, so leave the
      // algorithm choice to the resolver for those offers instead of rejecting an empty algorithm list.
      if (jwtProof) {
        if (jwtProof.key_attestations_required) {
          throw new BindingValidationError(
            BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
            'Issuer requires key attestations for jwt proofs; fresh-key binding does not support them',
          )
        }
        selectFreshKeySignatureAlgorithm({
          signatureAlgorithm,
          algorithms: jwtProof.proof_signing_alg_values_supported,
          didMethod: selectedDidMethod,
          isBackendAvailable: availability,
        })
      }
    } catch (error) {
      throw prefixedBindingError(error, configurationId)
    }
  }
}

function prefixedBindingError(error: unknown, configurationId: string): never {
  if (error instanceof BindingValidationError) {
    throw new BindingValidationError(error.code, `${configurationId}: ${error.message}`)
  }
  if (error instanceof KeyCreationError) {
    throw new KeyCreationError(
      `${configurationId}: ${error.message.replace(`${BINDING_ERROR_CODES.KEY_CREATION_FAILED}: `, '')}`,
    )
  }
  throw error
}

function assertDidBindingAllowed(
  verificationMethodId: string,
  credentialFormat: string,
  supportedDidMethods: string[] | undefined,
  supportsAllDidMethods: boolean,
) {
  if (credentialFormat === OpenId4VciCredentialFormatProfile.MsoMdoc) {
    throw new HolderBindingNotSupportedError(
      `${BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT}: DID binding is not supported for the '${credentialFormat}' format`,
    )
  }

  // supportedDidMethods is undefined when the issuer lists no binding methods at all
  // (same check as Credo's OpenId4VciHolderService)
  const { did, method } = parseDid(verificationMethodId)
  const didMethodAllowed =
    supportsAllDidMethods ||
    supportedDidMethods === undefined ||
    supportedDidMethods.some((supportedDidMethod) => did.startsWith(supportedDidMethod))
  if (!didMethodAllowed) {
    throw new HolderBindingNotSupportedError(
      `Issuer does not support did:${method} binding for '${credentialFormat}' credentials. Supported: ${supportedDidMethods.join(', ') || 'none'}`,
    )
  }
}

/** Checks that the issuer accepts a jwt proof, without key attestations, signed with the holder's key. */
function assertJwtProofAllowed(
  verificationMethod: VerificationMethod,
  verificationMethodId: string,
  jwtProof: { keyAttestationsRequired: boolean; algorithms: string[] | undefined } | undefined,
) {
  if (!jwtProof || jwtProof.keyAttestationsRequired) {
    throw new HolderBindingNotSupportedError('Issuer does not accept a jwt proof without key attestations')
  }
  if (!jwtProof.algorithms) {
    throw new HolderBindingNotSupportedError(
      'Issuer metadata does not list proof_signing_alg_values_supported for the jwt proof type',
    )
  }

  const keyAlgorithms = getPublicJwkFromVerificationMethod(verificationMethod).supportedSignatureAlgorithms
  if (!jwtProof.algorithms.some((algorithm) => (keyAlgorithms as string[]).includes(algorithm))) {
    throw new HolderBindingNotSupportedError(
      `Key '${verificationMethodId}' signs with ${keyAlgorithms.join(', ')}, but the issuer accepts ${jwtProof.algorithms.join(', ')}`,
    )
  }
}

async function resolveHolderVerificationMethod(
  agentContext: AgentContext,
  holderDidUrl: string,
): Promise<{ verificationMethod: VerificationMethod; verificationMethodId: string }> {
  let parsedDid: ReturnType<typeof parseDid>
  try {
    parsedDid = parseDid(holderDidUrl)
  } catch {
    throw new BadRequestError(`Holder DID URL '${holderDidUrl}' is not a valid DID or DID URL`)
  }
  const { did, fragment } = parsedDid

  let didDocument
  try {
    ;({ didDocument } = await agentContext.resolve(DidsApi).resolveCreatedDidDocumentWithKeys(did))
  } catch {
    throw new BadRequestError(
      `${BINDING_ERROR_CODES.DID_NOT_CONTROLLED_BY_HOLDER_TENANT}: Holder DID '${did}' was not created in this wallet`,
    )
  }

  let keyId = holderDidUrl
  if (!fragment) {
    const [authentication] = didDocument.authentication ?? []
    const authenticationId = typeof authentication === 'string' ? authentication : authentication?.id
    if (!authenticationId) {
      throw new BadRequestError(`Holder DID '${did}' has no authentication key`)
    }
    keyId = authenticationId
  }

  let verificationMethod: VerificationMethod
  try {
    verificationMethod = didDocument.dereferenceKey(keyId)
  } catch {
    throw new BadRequestError(
      `${BINDING_ERROR_CODES.DID_NOT_CONTROLLED_BY_HOLDER_TENANT}: Verification method '${keyId}' not found in the DID document of '${did}'`,
    )
  }

  // DID documents may use relative ids such as '#key-1'
  const verificationMethodId = verificationMethod.id.startsWith('#')
    ? `${did}${verificationMethod.id}`
    : verificationMethod.id
  return { verificationMethod, verificationMethodId }
}

async function createNewKeyBinding(
  {
    supportedDidMethods,
    issuerMaxBatchSize,
    proofTypes,
    supportsAllDidMethods,
    supportsJwk,
    credentialFormat,
    agentContext,
  }: OpenId4VciCredentialBindingOptions,
  requestBatch: boolean | number | undefined,
  { didMethod: requestedDidMethod, signatureAlgorithm: requestedSignatureAlgorithm }: NewKeyBindingSelection,
) {
  const kms = agentContext.resolve(Kms.KeyManagementApi)

  // TODO: support key attestations
  if (!proofTypes.jwt || proofTypes.jwt.keyAttestationsRequired) {
    throw new Error('Unable to request credentials. Only jwt proof type without key attestations supported')
  }

  const didMethod = selectFreshKeyDidMethod({
    didMethod: requestedDidMethod
      ? requestedDidMethod.startsWith('did:')
        ? requestedDidMethod
        : `did:${requestedDidMethod}`
      : undefined,
    supportedDidMethods,
    supportsAllDidMethods,
    supportsJwk,
    credentialFormat,
  })
  const signatureAlgorithm = selectFreshKeySignatureAlgorithm({
    signatureAlgorithm: requestedSignatureAlgorithm,
    algorithms: proofTypes.jwt.supportedSignatureAlgorithms,
    didMethod,
    isBackendAvailable: kmsBackendAvailability(kms),
  })

  // We don't want to request more than 10 credentials
  const batchSize =
    requestBatch === true
      ? Math.min(issuerMaxBatchSize, 10)
      : typeof requestBatch === 'number'
        ? Math.min(issuerMaxBatchSize, requestBatch)
        : 1

  // Do not force Askar here: it cannot create RSA or P-521 keys. The helper leaves the backend implicit for
  // EC/OKP keys (Credo's default fallback) and selects Node KMS or OpenBao where they are required.
  const keyType = getKeyTypeForAlgorithm(signatureAlgorithm)
  const backend = keyType ? selectKmsBackendForCreate(keyType as Kms.KmsCreateKeyType) : undefined
  const createKeyOptions = {
    algorithm: signatureAlgorithm as Kms.KnownJwaSignatureAlgorithm,
    ...(backend?.backend ? { backend: backend.backend } : {}),
  }

  let keys
  try {
    keys = await Promise.all(
      new Array(batchSize)
        .fill(0)
        .map(() =>
          kms.createKeyForSignatureAlgorithm(createKeyOptions).then((key) => Kms.PublicJwk.fromUnknown(key.publicJwk)),
        ),
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new KeyCreationError(`Unable to create a key for '${signatureAlgorithm}': ${reason}`)
  }

  if (didMethod) {
    const dm = didMethod.replace(/^did:/, '')
    const didsApi = agentContext.dependencyManager.resolve(DidsApi)
    const didResults = await Promise.all(
      keys.map(async (key) => {
        const didResult = await didsApi.create<JwkDidCreateOptions | KeyDidCreateOptions>({
          method: dm as 'key' | 'jwk',
          options: {
            keyId: key.keyId,
          },
        })

        if (didResult.didState.state !== 'finished') {
          throw new Error('DID creation failed.')
        }

        let verificationMethodId: string
        if (dm === 'jwk') {
          const didJwk = DidJwk.fromDid(didResult.didState.did)
          verificationMethodId = didJwk.verificationMethodId
        } else {
          const didKey = DidKey.fromDid(didResult.didState.did)
          verificationMethodId = `${didKey.did}#${didKey.publicJwk.fingerprint}`
        }

        return verificationMethodId
      }),
    )

    return {
      method: 'did' as const,
      didUrls: didResults,
    }
  }

  // Plain JWK is only accepted by Credo for these formats; ldp_vc requires a DID method.
  if (
    supportsJwk &&
    (credentialFormat === OpenId4VciCredentialFormatProfile.SdJwtVc ||
      credentialFormat === OpenId4VciCredentialFormatProfile.SdJwtDc ||
      credentialFormat === OpenId4VciCredentialFormatProfile.JwtVcJsonLd ||
      credentialFormat === OpenId4VciCredentialFormatProfile.JwtVcJson ||
      credentialFormat === OpenId4VciCredentialFormatProfile.MsoMdoc)
  ) {
    return {
      method: 'jwk' as const,
      keys,
    }
  }

  throw new BindingValidationError(
    BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
    `No supported binding method could be found for '${credentialFormat}' credentials. Use did:key or did:jwk.`,
  )
}
