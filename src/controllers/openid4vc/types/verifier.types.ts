/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import type { DifPresentationExchangeDefinitionV2 } from '@credo-ts/core'
import type { SubmissionRequirement, Format, Issuance, InputDescriptorV2 } from '@sphereon/pex-models'

export enum ResponseModeEnum {
  DIRECT_POST = 'direct_post',
  DIRECT_POST_JWT = 'direct_post.jwt',
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

export interface DcqlClaim {
  path: string[]
  intent_to_retain?: boolean
}

export interface DcqlCredential {
  id: string
  format: string
  meta?: Record<string, any>
  require_cryptographic_holder_binding?: boolean
  claims: DcqlClaim[]
}

export interface DcqlQuery {
  combine?: 'all' | 'any'
  credentials: DcqlCredential[]
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
}

export interface CreateAuthorizationRequest {
  verifierId: string
  presentationExchange?: PresentationDefinition
  dcql?: string | DcqlDefinition

  responseMode?: ResponseModeEnum

  requestSigner: OpenId4VcJwtIssuerDid | OpenId4VcIssuerX5c
}

/* -------------------------------------------------------------------------- */
/*                            VERIFIER METADATA                               */
/* -------------------------------------------------------------------------- */

export class OpenId4VcSiopVerifierClientMetadata {
  client_name?: string
  logo_uri?: string
}

export class OpenId4VcSiopCreateVerifierOptions {
  verifierId?: string
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}

export class OpenId4VcUpdateVerifierRecordOptions {
  verifierId?: string
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}
