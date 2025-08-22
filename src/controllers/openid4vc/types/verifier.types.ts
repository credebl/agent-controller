/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import type { DifPresentationExchangeDefinitionV2 } from '@credo-ts/core'
import type { SubmissionRequirement, Format, Issuance, InputDescriptorV2 } from '@sphereon/pex-models'

export enum ResponseModeEnum {
  DIRECT_POST = 'direct_post',
  DIRECT_POSJWT = 'direct_post.jwt',
}// export interface SubmissionRequirementModel extends SubmissionRequirement {

export interface InputDescriptorV2Model extends InputDescriptorV2 {
  format?: Format
  group?: string[]
  issuance?: Issuance[]
  // constraints already inherited
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

export interface CreateAuthorizationRequest {
  verifierId: string
  verifierDid: string
  presentationExchange: PresentationDefinition
  responseMode?: ResponseModeEnum
}

export class OpenId4VcSiopVerifierClientMetadata {
  client_name?: string
  logo_uri?: string
}

export class OpenId4VcSiopCreateVerifierOptions {
  verifierId?: string
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}

export class OpenId4VcUpdateVerifierRecordOptions {
  verifierId!: string
  clientMetadata?: OpenId4VcSiopVerifierClientMetadata
}
