/**
 * Constants for VCDM 2.0 JSON-LD (Data Integrity / ldp_vc) signing and verification.
 *
 * Credo 0.6.x does not expose an `ldp_vc` path for VCDM 2.0 (`W3cV2CredentialService`
 * only supports `vc+jwt` and `vc+sd-jwt`), so this module wires the low-level
 * `@digitalcredentials/vc` + `@digitalcredentials/jsonld-signatures` primitives that
 * Credo uses internally, bypassing the V1 `W3cJsonLdVerifiableCredential` model.
 */

export const CREDENTIALS_V2_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2'
export const STATUS_V1_CONTEXT_URL = 'https://www.w3.org/ns/credentials/status/v1'

/**
 * Default Data Integrity suite for VCDM 2.0.
 *
 * NOTE: Credo 0.6.x ships only `Ed25519Signature2018` and `Ed25519Signature2020`.
 * `Ed25519Signature2020` rejects `Ed25519VerificationKey2018` verification methods
 * (which is what `did:key` Ed25519 resolves to), so the platform default is
 * `Ed25519Signature2018` which accepts both 2018 and 2020 key types.
 */
export const DEFAULT_V2_PROOF_TYPE = 'Ed25519Signature2018'

export const SUPPORTED_V2_PROOF_TYPES = ['Ed25519Signature2018', 'Ed25519Signature2020'] as const

export type SupportedV2ProofType = (typeof SUPPORTED_V2_PROOF_TYPES)[number]
