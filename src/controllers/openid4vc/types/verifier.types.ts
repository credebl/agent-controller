/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import type { DifPresentationExchangeDefinitionV2 } from '@credo-ts/core'
import type { Format, Issuance, InputDescriptorV2 } from '@sphereon/pex-models'

export enum ResponseModeEnum {
  DIRECT_POST = 'direct_post',
  DIRECT_POST_JWT = 'direct_post.jwt',
  DC_API = 'dc_api',
  DC_API_JWT = 'dc_api.jwt',
}

/* -------------------------------------------------------------------------- */
/*                             PRESENTATION MODELS                            */
/* -------------------------------------------------------------------------- */

export interface InputDescriptorV2Model extends InputDescriptorV2 {
  format?: Format
  group?: string[]
  issuance?: Issuance[]
}

export interface DifPresentationExchangeDefinitionV2Model extends DifPresentationExchangeDefinitionV2 {
  format?: Format
  submission_requirements?: any[]
  input_descriptors: InputDescriptorV2Model[]
  frame?: object
}

export interface PresentationDefinition {
  definition: DifPresentationExchangeDefinitionV2Model
}

/* -------------------------------------------------------------------------- */
/*                                 DCQL MODELS                                */
/* -------------------------------------------------------------------------- */

/**
 * A DCQL claims query (OpenID4VP 1.0, section 6.3).
 */
export interface DcqlClaim {
  /** Required when the credential query has `claim_sets`, which refer to claims by this id. */
  id?: string
  /**
   * The claim's path: a string selects an object key, a number an array index, and null every array element.
   * @example ["credentialSubject", "role"]
   */
  path: Array<string | number | null>
  /**
   * The claim matches only if its value is one of these.
   * @example ["MND-0001"]
   */
  values?: Array<string | number | boolean>
  /** mso_mdoc only: whether the verifier intends to keep the claim value. */
  intent_to_retain?: boolean
}

/**
 * A trusted authorities query (OpenID4VP 1.0, section 6.1.1).
 */
export interface DcqlTrustedAuthority {
  /** e.g. `aki` (authority key identifier), `etsi_tl` or `openid_federation` */
  type: string
  values: string[]
}

/**
 * A DCQL credential query (OpenID4VP 1.0, section 6.1).
 */
export interface DcqlCredential {
  id: string
  format: string
  /** Whether several credentials may be returned for this query. */
  multiple?: boolean
  meta?: Record<string, any>
  trusted_authorities?: DcqlTrustedAuthority[]
  require_cryptographic_holder_binding?: boolean
  claims?: DcqlClaim[]
  /** Alternative sets of claim ids, in order of preference. */
  claim_sets?: string[][]
}

export interface DcqlCredentialSet {
  options: string[][]
  required?: boolean
}

export interface DcqlQuery {
  credentials: DcqlCredential[]
  credential_sets?: DcqlCredentialSet[]
}

export interface DcqlDefinition {
  query: DcqlQuery
}

/* -------------------------------------------------------------------------- */
/*                       AUTHORIZATION REQUEST MODEL                          */
/* -------------------------------------------------------------------------- */
export type OpenId4VcJwtIssuerDid = {
  method: 'did'
  didUrl: string
}

export type OpenId4VcIssuerX5c = {
  method: 'x5c'
  issuer?: string
  x5c: string[]
  alg?: string
  keyId?: string
}

export type OpenId4VcIssuerX5cOptions = OpenId4VcIssuerX5c & {
  clientIdPrefix?: ClientIdPrefix
}

export enum ClientIdPrefix {
  X509SanDns = 'x509_san_dns',
  X509Hash = 'x509_hash',
}

export interface CreateAuthorizationRequest {
  verifierId: string
  presentationExchange?: PresentationDefinition
  dcql?: string | DcqlDefinition

  responseMode?: ResponseModeEnum

  requestSigner: OpenId4VcJwtIssuerDid | OpenId4VcIssuerX5cOptions
  expectedOrigins?: string[]
  version?: 'v1' | 'v1.draft21' | 'v1.draft24'
}

/* -------------------------------------------------------------------------- */
/*                            VERIFIER METADATA                               */
/* -------------------------------------------------------------------------- */

export class OpenId4VcSiopVerifierClientMetadata {
  client_name?: string
  logo_uri?: string
  background_color?: string
  text_color?: string
}

export class OpenId4VcSiopCreateVerifierOptions {
  verifierId?: string
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}

export class OpenId4VcUpdateVerifierRecordOptions {
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}

export interface OpenId4VCDCQLVerificationSessionRecord {
  verificationSessionId: string
  authorizationResponse: Record<string, unknown>
  origin?: string
}
