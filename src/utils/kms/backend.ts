import type { Kms } from '@credo-ts/core'

import { OPENBAO_KMS_BACKEND, openBaoBackendForCreate, openBaoBackendForJwk } from './openBao'

/** Askar is the default backend, so no explicit backend name is passed when it is selected. */
export const ASKAR_KMS_BACKEND = 'askar'

/** The node:crypto backed KMS, used for key types Askar cannot hold or sign with. */
export const NODE_KMS_BACKEND = 'node'

export type KmsBackendName = 'askar' | 'node' | 'openbao'

export interface KmsBackendSelection {
  /** The backend name to pass to Credo, or `undefined` to use the default (Askar). */
  backend?: string
  /** The human readable backend that actually handled the key. */
  name: KmsBackendName
}

/**
 * Askar handles EC / OKP (and oct) keys. RSA and EC P-521 are routed to the Node KMS because Askar cannot store or
 * sign with them.
 */
export function needsNodeKms(key: { kty: string; crv?: string }): boolean {
  return key.kty === 'RSA' || (key.kty === 'EC' && key.crv === 'P-521')
}

/**
 * Picks the backend used when creating a new key. OpenBao wins when it is enabled and supports the key type, then the
 * Node KMS for key types Askar cannot handle, otherwise Askar is used implicitly.
 */
export function selectKmsBackendForCreate(type: Kms.KmsCreateKeyType): KmsBackendSelection {
  const openBao = openBaoBackendForCreate(type)
  if (openBao) return { backend: openBao, name: OPENBAO_KMS_BACKEND }
  if (needsNodeKms(type)) return { backend: NODE_KMS_BACKEND, name: NODE_KMS_BACKEND }
  return { name: ASKAR_KMS_BACKEND }
}

/**
 * Picks the backend used when importing an existing private JWK. Mirrors {@link selectKmsBackendForCreate} so a key is
 * stored in the same backend whether it was generated here or imported from the caller.
 */
export function selectKmsBackendForJwk(jwk: { kty: string; crv?: string }): KmsBackendSelection {
  const openBao = openBaoBackendForJwk(jwk)
  if (openBao) return { backend: openBao, name: OPENBAO_KMS_BACKEND }
  if (needsNodeKms(jwk)) return { backend: NODE_KMS_BACKEND, name: NODE_KMS_BACKEND }
  return { name: ASKAR_KMS_BACKEND }
}
