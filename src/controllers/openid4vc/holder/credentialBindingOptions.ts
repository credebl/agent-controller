import type { CredentialBindingMode, CredentialBindingPolicy, RequestCredentialBody } from '../types/holder.types'
import type { Kms } from '@credo-ts/core'

import { BadRequestError, InternalServerError } from '../../../errors/errors'
import { ASKAR_KMS_BACKEND, NODE_KMS_BACKEND, selectKmsBackendForCreate } from '../../../utils/kms/backend'

export const BINDING_ERROR_CODES = {
  INVALID_BINDING_MODE: 'INVALID_BINDING_MODE',
  MISSING_HOLDER_DID_URL: 'MISSING_HOLDER_DID_URL',
  CONFLICTING_HOLDER_DID_URL: 'CONFLICTING_HOLDER_DID_URL',
  UNSUPPORTED_DID_METHOD: 'UNSUPPORTED_DID_METHOD',
  UNSUPPORTED_PROOF_ALGORITHM: 'UNSUPPORTED_PROOF_ALGORITHM',
  INCOMPATIBLE_DID_METHOD_AND_ALGORITHM: 'INCOMPATIBLE_DID_METHOD_AND_ALGORITHM',
  DID_BINDING_NOT_SUPPORTED_FOR_FORMAT: 'DID_BINDING_NOT_SUPPORTED_FOR_FORMAT',
  DID_NOT_CONTROLLED_BY_HOLDER_TENANT: 'DID_NOT_CONTROLLED_BY_HOLDER_TENANT',
  KEY_CREATION_FAILED: 'KEY_CREATION_FAILED',
} as const

export type BindingErrorCode = (typeof BINDING_ERROR_CODES)[keyof typeof BINDING_ERROR_CODES]

/** A user-input error in the binding selection. Always returned as HTTP 400. */
export class BindingValidationError extends BadRequestError {
  public readonly code: BindingErrorCode

  public constructor(code: BindingErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.code = code
  }
}

/** A wallet-side failure to create the key for the selected binding. Never downgrades to another algorithm. */
export class KeyCreationError extends InternalServerError {
  public constructor(detail: string) {
    super(`${BINDING_ERROR_CODES.KEY_CREATION_FAILED}: ${detail}`)
  }
}

export interface NormalizedCredentialBinding {
  mode: CredentialBindingMode
  holderDidUrl?: string
  policy: CredentialBindingPolicy
  didMethod?: string
  signatureAlgorithm?: string
}

type BindingRequestBody = Pick<RequestCredentialBody, 'holderDidUrl' | 'bindingPolicy' | 'binding'>

export interface KeyTypeForAlgorithm {
  kty: 'OKP' | 'EC' | 'RSA'
  crv?: string
  modulusLength?: 2048 | 3072 | 4096
}

/** JWA algorithms that fresh keys can be created for. RS256 and PS256 deliberately stay supported. */
export const KEY_TYPES_FOR_ALGORITHMS: Record<string, KeyTypeForAlgorithm> = {
  EdDSA: { kty: 'OKP', crv: 'Ed25519' },
  ES256: { kty: 'EC', crv: 'P-256' },
  ES384: { kty: 'EC', crv: 'P-384' },
  ES512: { kty: 'EC', crv: 'P-521' },
  ES256K: { kty: 'EC', crv: 'secp256k1' },
  RS256: { kty: 'RSA', modulusLength: 2048 },
  RS384: { kty: 'RSA', modulusLength: 2048 },
  RS512: { kty: 'RSA', modulusLength: 2048 },
  PS256: { kty: 'RSA', modulusLength: 2048 },
  PS384: { kty: 'RSA', modulusLength: 2048 },
  PS512: { kty: 'RSA', modulusLength: 2048 },
}

/** Preferred order for implicit fresh-key selection, independent of the wallet's JWA registration order. */
export const PREFERRED_NEW_KEY_ALGORITHMS = ['EdDSA', 'ES256', 'ES384', 'ES512', 'RS256', 'PS256']

export const FRESH_KEY_DID_METHODS = ['did:key', 'did:jwk'] as const

export function getKeyTypeForAlgorithm(algorithm: string): KeyTypeForAlgorithm | undefined {
  return KEY_TYPES_FOR_ALGORITHMS[algorithm]
}

/**
 * Resolves the flat and nested binding fields into one selection. The flat fields keep their old meaning, so a caller
 * that does not send `binding` behaves exactly as before.
 */
export function normalizeCredentialBinding(body: BindingRequestBody): NormalizedCredentialBinding {
  const { binding } = body
  if (!binding) {
    return {
      mode: body.holderDidUrl ? 'existing-did' : 'new-key',
      holderDidUrl: body.holderDidUrl,
      policy: body.bindingPolicy ?? 'require',
    }
  }

  const mode = String(binding.mode) as CredentialBindingMode
  if (mode !== 'new-key' && mode !== 'existing-did') {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.INVALID_BINDING_MODE,
      `binding.mode must be 'new-key' or 'existing-did' (received '${String(binding.mode)}')`,
    )
  }

  if (body.bindingPolicy && binding.policy && body.bindingPolicy !== binding.policy) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.INVALID_BINDING_MODE,
      `binding.policy '${binding.policy}' conflicts with bindingPolicy '${body.bindingPolicy}'`,
    )
  }
  const policy = binding.policy ?? body.bindingPolicy ?? 'require'
  if (policy !== 'require' && policy !== 'prefer') {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.INVALID_BINDING_MODE,
      `binding policy must be 'require' or 'prefer' (received '${policy}')`,
    )
  }

  if (mode === 'existing-did') {
    if (binding.didMethod) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
        'binding.didMethod is only valid when binding.mode is new-key',
      )
    }
    if (binding.signatureAlgorithm) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
        'binding.signatureAlgorithm is only valid when binding.mode is new-key',
      )
    }
    if (!binding.holderDidUrl) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.MISSING_HOLDER_DID_URL,
        'binding.holderDidUrl is required when binding.mode is existing-did',
      )
    }
    if (body.holderDidUrl && body.holderDidUrl !== binding.holderDidUrl) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.CONFLICTING_HOLDER_DID_URL,
        `binding.holderDidUrl '${binding.holderDidUrl}' conflicts with holderDidUrl '${body.holderDidUrl}'`,
      )
    }
    return { mode, holderDidUrl: binding.holderDidUrl, policy }
  }

  if (binding.holderDidUrl || body.holderDidUrl) {
    const holderDidUrl = binding.holderDidUrl ?? body.holderDidUrl
    throw new BindingValidationError(
      BINDING_ERROR_CODES.CONFLICTING_HOLDER_DID_URL,
      `binding.mode 'new-key' conflicts with holderDidUrl '${holderDidUrl}'`,
    )
  }

  return {
    mode,
    policy,
    didMethod: binding.didMethod ? normalizeFreshKeyDidMethod(binding.didMethod) : undefined,
    signatureAlgorithm: binding.signatureAlgorithm
      ? normalizeSignatureAlgorithm(binding.signatureAlgorithm)
      : undefined,
  }
}

function normalizeFreshKeyDidMethod(didMethod: string): string {
  const normalized = didMethod.trim().startsWith('did:') ? didMethod.trim() : `did:${didMethod.trim()}`
  if (!FRESH_KEY_DID_METHODS.includes(normalized as (typeof FRESH_KEY_DID_METHODS)[number])) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
      `Fresh keys can only be created for ${FRESH_KEY_DID_METHODS.join(' or ')} (received '${didMethod}')`,
    )
  }
  return normalized
}

function normalizeSignatureAlgorithm(signatureAlgorithm: string): string {
  const normalized = signatureAlgorithm.trim()
  if (!getKeyTypeForAlgorithm(normalized)) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
      `Signature algorithm '${signatureAlgorithm}' is not supported for new keys`,
    )
  }
  return normalized
}

/** did:key cannot encode RSA or P-521 keys. did:jwk can represent every JWK key type. */
export function isAlgorithmCompatibleWithDidMethod(algorithm: string, didMethod?: string): boolean {
  if (didMethod !== 'did:key') return true
  const keyType = getKeyTypeForAlgorithm(algorithm)
  return Boolean(keyType && (keyType.kty === 'OKP' || (keyType.kty === 'EC' && keyType.crv !== 'P-521')))
}

/** The backend the wallet must have registered to create a key for an algorithm, or undefined if it cannot. */
export function requiredBackendForAlgorithm(algorithm: string): string | undefined {
  const keyType = getKeyTypeForAlgorithm(algorithm)
  if (!keyType) return undefined
  return selectKmsBackendForCreate(keyType as Kms.KmsCreateKeyType).name
}

/**
 * Picks the DID method for a fresh key. An explicit method is validated against the issuer; the implicit choice keeps
 * the existing did:jwk, did:key, plain JWK preference, except that mso_mdoc always uses a plain JWK.
 */
export function selectFreshKeyDidMethod({
  didMethod,
  supportedDidMethods,
  supportsAllDidMethods,
  supportsJwk,
  credentialFormat,
}: {
  didMethod?: string
  supportedDidMethods?: string[]
  supportsAllDidMethods: boolean
  supportsJwk: boolean
  credentialFormat: string
}): string | undefined {
  if (didMethod) {
    if (credentialFormat === 'mso_mdoc') {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT,
        `DID binding is not supported for the '${credentialFormat}' format; use plain JWK binding`,
      )
    }
    const allowed =
      supportsAllDidMethods ||
      supportedDidMethods === undefined ||
      supportedDidMethods.some((supported) => didMethod.startsWith(supported))
    if (!allowed) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
        `Issuer does not support ${didMethod} binding. Supported: ${supportedDidMethods?.join(', ') || 'none'}`,
      )
    }
    return didMethod
  }

  let selected: string | undefined
  if (credentialFormat !== 'mso_mdoc') {
    if (supportsAllDidMethods || supportedDidMethods?.includes('did:jwk')) selected = 'did:jwk'
    else if (supportedDidMethods?.includes('did:key')) selected = 'did:key'
    // MATTR launchpad does not advertise binding methods, but requires did:key
    else if (!supportedDidMethods && !supportsJwk) selected = 'did:key'
  }

  if (!selected) {
    if (!supportsJwk) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
        `No binding method is supported for '${credentialFormat}' credentials`,
      )
    }
    if (credentialFormat === 'ldp_vc') {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
        "Plain JWK binding is not supported for 'ldp_vc' credentials; use did:key or did:jwk",
      )
    }
  }

  return selected
}

/** Returns whether a backend is registered for an algorithm, or undefined when the wallet does not expose that. */
export type BackendAvailability = (algorithm: string, backend: string) => boolean | undefined

/**
 * Picks the proof algorithm for a fresh key. An explicit algorithm is checked against issuer metadata and the wallet;
 * implicit selection uses a privacy/compatibility-friendly preference rather than the wallet's JWA registration order.
 */
export function selectFreshKeySignatureAlgorithm({
  signatureAlgorithm,
  algorithms,
  didMethod,
  isBackendAvailable,
  availableBackends,
}: {
  signatureAlgorithm?: string
  algorithms?: string[]
  didMethod?: string
  /** Per-algorithm backend availability. Receives the backend name selected by `selectKmsBackendForCreate`. */
  isBackendAvailable?: BackendAvailability
  /** Convenience form for callers that already know the registered backend names. */
  availableBackends?: string[]
}): string {
  const issuerAlgorithms = algorithms ?? []
  const isAvailable: BackendAvailability =
    isBackendAvailable ??
    (availableBackends ? (_algorithm, backend) => availableBackends.includes(backend) : undefined) ??
    (() => undefined)

  if (signatureAlgorithm) {
    if (!issuerAlgorithms.includes(signatureAlgorithm)) {
      throw new BindingValidationError(
        BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
        `Issuer does not accept signature algorithm '${signatureAlgorithm}'. Supported: ${
          issuerAlgorithms.join(', ') || 'none'
        }`,
      )
    }
    assertAlgorithmCanBeCreated(signatureAlgorithm, didMethod, isAvailable)
    return signatureAlgorithm
  }

  const candidates = [
    ...PREFERRED_NEW_KEY_ALGORITHMS,
    ...issuerAlgorithms.filter((algorithm) => !PREFERRED_NEW_KEY_ALGORITHMS.includes(algorithm)),
  ]
  const selected = candidates.find(
    (algorithm) => issuerAlgorithms.includes(algorithm) && canCreateAlgorithm(algorithm, didMethod, isAvailable),
  )
  if (!selected) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
      `No signature algorithm supported by both the issuer and the wallet. Issuer supports: ${
        issuerAlgorithms.join(', ') || 'none'
      }`,
    )
  }
  return selected
}

function canCreateAlgorithm(
  algorithm: string,
  didMethod: string | undefined,
  isAvailable: BackendAvailability,
): boolean {
  const backend = requiredBackendForAlgorithm(algorithm)
  return Boolean(
    backend && isAlgorithmCompatibleWithDidMethod(algorithm, didMethod) && isAvailable(algorithm, backend) !== false,
  )
}

export function assertAlgorithmCanBeCreated(
  algorithm: string,
  didMethod: string | undefined,
  isAvailable: BackendAvailability,
): void {
  if (didMethod && !isAlgorithmCompatibleWithDidMethod(algorithm, didMethod)) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.INCOMPATIBLE_DID_METHOD_AND_ALGORITHM,
      `${didMethod} cannot hold a key for '${algorithm}'; use did:jwk`,
    )
  }

  const backend = requiredBackendForAlgorithm(algorithm)
  if (!backend) {
    throw new BindingValidationError(
      BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
      `Signature algorithm '${algorithm}' is not supported for new keys`,
    )
  }
  if (isAvailable(algorithm, backend) === false) {
    // This is discoverable before token redemption, so it is a 400 rather than a runtime 500.
    throw new BindingValidationError(
      BINDING_ERROR_CODES.KEY_CREATION_FAILED,
      `No '${backend}' KMS backend is registered for '${algorithm}'`,
    )
  }
}

/** Names of the KMS backends that can create this key type, when Credo exposes them. */
export function getAvailableCreateBackends(kms: unknown, keyType: KeyTypeForAlgorithm): string[] | undefined {
  if (
    !kms ||
    typeof (kms as { supportedBackendsForOperation?: unknown }).supportedBackendsForOperation !== 'function'
  ) {
    return undefined
  }
  const backends = (
    kms as { supportedBackendsForOperation: (operation: { operation: 'createKey'; type: unknown }) => string[] }
  ).supportedBackendsForOperation({ operation: 'createKey', type: keyType })
  return Array.isArray(backends) ? backends : undefined
}

/** Builds the availability callback used by {@link selectFreshKeySignatureAlgorithm} from a Credo KMS API. */
export function kmsBackendAvailability(kms: unknown): BackendAvailability {
  return (algorithm, backend) => {
    const keyType = getKeyTypeForAlgorithm(algorithm)
    if (!keyType) return false
    const available = getAvailableCreateBackends(kms, keyType)
    return available === undefined ? undefined : available.includes(backend)
  }
}

export { ASKAR_KMS_BACKEND, NODE_KMS_BACKEND }
