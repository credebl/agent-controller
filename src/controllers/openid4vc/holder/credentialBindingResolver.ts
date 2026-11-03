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
  getPublicJwkFromVerificationMethod,
  parseDid,
} from '@credo-ts/core'
import {
  type OpenId4VciCredentialBindingOptions,
  type OpenId4VciCredentialBindingResolver,
  OpenId4VciCredentialFormatProfile,
  type OpenId4VciResolvedCredentialOffer,
} from '@credo-ts/openid4vc'

import { BadRequestError } from '../../../errors/errors'

export interface CredentialBindingResolverOptions {
  requestBatch?: boolean | number
  /**
   * DID URL of a verification method (e.g. `did:web:example.com#key-1`), or a bare DID to use its
   * first authentication key. The DID must have been created or imported in this agent.
   */
  holderDidUrl?: string
  bindingPolicy?: CredentialBindingPolicy
}

/**
 * The issuer does not accept the requested holder DID. With the `prefer` policy the resolver
 * falls back to a new key instead of throwing.
 */
export class HolderBindingNotSupportedError extends BadRequestError {}

export function getCredentialBindingResolver({
  requestBatch,
  holderDidUrl,
  bindingPolicy = 'require',
}: CredentialBindingResolverOptions): OpenId4VciCredentialBindingResolver {
  return async (options) => {
    if (holderDidUrl) {
      try {
        const didUrl = await resolveHolderDidBinding(options, holderDidUrl)
        return { method: 'did', didUrls: [didUrl] }
      } catch (error) {
        if (!(error instanceof HolderBindingNotSupportedError) || bindingPolicy === 'require') throw error
        options.agentContext.config.logger.warn(
          `Issuer does not support binding to '${holderDidUrl}', falling back to a new key: ${error.message}`,
        )
      }
    }

    return createNewKeyBinding(options, requestBatch)
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

function assertDidBindingAllowed(
  verificationMethodId: string,
  credentialFormat: string,
  supportedDidMethods: string[] | undefined,
  supportsAllDidMethods: boolean,
) {
  if (credentialFormat === OpenId4VciCredentialFormatProfile.MsoMdoc) {
    throw new HolderBindingNotSupportedError(`DID binding is not supported for the '${credentialFormat}' format`)
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
    throw new BadRequestError(`Holder DID '${did}' was not created in this wallet`)
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
    throw new BadRequestError(`Verification method '${keyId}' not found in the DID document of '${did}'`)
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
  requestBatch?: boolean | number,
) {
  const kms = agentContext.resolve(Kms.KeyManagementApi)

  // First, we try to pick a did method
  // Prefer did:jwk, otherwise use did:key, otherwise use undefined
  let didMethod: 'key' | 'jwk' | undefined =
    supportsAllDidMethods || supportedDidMethods?.includes('did:jwk')
      ? 'jwk'
      : supportedDidMethods?.includes('did:key')
        ? 'key'
        : undefined

  // If supportedDidMethods is undefined, and supportsJwk is false, we will default to did:key
  // this is important as part of MATTR launchpad support which MUST use did:key but doesn't
  // define which did methods they support
  if (!supportedDidMethods && !supportsJwk) {
    didMethod = 'key'
  }

  // We don't want to request more than 10 credentials
  const batchSize =
    requestBatch === true
      ? Math.min(issuerMaxBatchSize, 10)
      : typeof requestBatch === 'number'
        ? Math.min(issuerMaxBatchSize, requestBatch)
        : 1
  // TODO: support key attestations
  if (!proofTypes.jwt || proofTypes.jwt.keyAttestationsRequired) {
    throw new Error('Unable to request credentials. Only jwt proof type without key attestations supported')
  }

  const signatureAlgorithm = proofTypes.jwt?.supportedSignatureAlgorithms?.[0]

  if (!signatureAlgorithm) {
    throw new Error('No supported signature algorithms found for JWT proof type')
  }
  const keys = await Promise.all(
    new Array(batchSize).fill(0).map(() =>
      kms
        .createKeyForSignatureAlgorithm({
          algorithm: signatureAlgorithm!,
          backend: 'askar',
        })
        .then((key) => Kms.PublicJwk.fromUnknown(key.publicJwk)),
    ),
  )

  if (didMethod) {
    const dm = didMethod
    const didsApi = agentContext.dependencyManager.resolve(DidsApi)
    const didResults = await Promise.all(
      keys.map(async (key) => {
        const didResult = await didsApi.create<JwkDidCreateOptions | KeyDidCreateOptions>({
          method: dm,
          options: {
            keyId: key.keyId,
          },
        })

        if (didResult.didState.state !== 'finished') {
          throw new Error('DID creation failed.')
        }

        let verificationMethodId: string
        if (didMethod === 'jwk') {
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

  // Otherwise we also support plain jwk for sd-jwt only
  if (
    supportsJwk &&
    (credentialFormat === OpenId4VciCredentialFormatProfile.SdJwtVc ||
      credentialFormat === OpenId4VciCredentialFormatProfile.SdJwtDc ||
      credentialFormat === OpenId4VciCredentialFormatProfile.JwtVcJsonLd ||
      credentialFormat === OpenId4VciCredentialFormatProfile.JwtVcJson ||
      credentialFormat === OpenId4VciCredentialFormatProfile.LdpVc ||
      credentialFormat === OpenId4VciCredentialFormatProfile.MsoMdoc)
  ) {
    return {
      method: 'jwk' as const,
      keys,
    }
  }

  throw new Error(
    `No supported binding method could be found. Supported methods are did:key and did:jwk, or plain jwk for sd-jwt/mdoc. Issuer supports ${
      supportsJwk ? 'jwk, ' : ''
    }${supportedDidMethods?.join(', ') ?? 'Unknown'}`,
  )
}
