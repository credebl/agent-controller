import type { RecordId } from './examples'
import type { CustomHandshakeProtocol } from '../enums'
import type { AnonCredsDidCommCredentialFormat, LegacyIndyCredentialFormat } from '@credo-ts/anoncreds'
import type {
  DidResolutionMetadata,
  DidDocumentMetadata,
  DidRegistrationExtraOptions,
  DidDocument,
  DidRegistrationSecretOptions,
  DidResolutionOptions,
  JsonObject,
  W3cJsonLdVerifyCredentialOptions,
  DataIntegrityProofOptions,
  W3cJsonLdSignCredentialOptions,
  W3cCredential,
  W3cCredentialSubject,
  X509CertificateIssuerAndSubjectOptions,
  SingleOrArray,
} from '@credo-ts/core'

import type {
  JsonCredential,
  ReceiveOutOfBandInvitationConfig,
  OutOfBandDidCommService,
  DidCommCredentialFormatPayload,
  DidCommAutoAcceptCredential,
  DidCommProofExchangeRecord,
  DidCommJsonLdCredentialFormat,
  DidCommCredentialExchangeRecord,
  DidCommAutoAcceptProof,
  DidCommHandshakeProtocol,
  DidCommMessage,
  DidCommRouting,
  DidCommAttachment,
} from '@credo-ts/didcomm'
import type { DIDDocument } from 'did-resolver'
import { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

export type CustomTenantConfig = {label: string} & {
  connectionImageUrl?: string
}

export interface AgentInfo {
  label: string
  endpoints: string[]
  isInitialized: boolean
  publicDid: void
}

export interface AgentToken {
  token: string
}

export interface AgentMessageType {
  '@id': string
  '@type': string
  [key: string]: unknown
}

export interface DidResolutionResultProps {
  didResolutionMetadata: DidResolutionMetadata
  didDocument: DIDDocument | null
  didDocumentMetadata: DidDocumentMetadata
}

export interface ProofRequestMessageResponse {
  message: string
  proofRecord: DidCommProofExchangeRecord
}

// type CredentialFormats = [CredentialFormat]
type CredentialFormats = [LegacyIndyCredentialFormat, AnonCredsDidCommCredentialFormat, DidCommJsonLdCredentialFormat]

enum ProtocolVersion {
  v1 = 'v1',
  v2 = 'v2',
}
export interface ProposeCredentialOptions {
  protocolVersion: ProtocolVersion
  credentialFormats: DidCommCredentialFormatPayload<CredentialFormatType[], 'createProposal'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
  connectionId: RecordId
}

// export interface ProposeCredentialOptions<CPs extends CredentialProtocol[] = CredentialProtocol[]> extends BaseOptions {
//   connectionId: string
//   protocolVersion: CredentialProtocolVersionType<CPs>
//   credentialFormats: DidCommCredentialFormatPayload<CredentialFormatsFromProtocols<CPs>, 'createProposal'>
// }

export interface AcceptCredentialProposalOptions {
  credentialRecordId: string
  credentialFormats?: DidCommCredentialFormatPayload<CredentialFormats, 'acceptProposal'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
}

export interface CreateOfferOptions {
  protocolVersion: ProtocolVersion
  connectionId: RecordId
  credentialFormats: DidCommCredentialFormatPayload<CredentialFormats, 'createOffer'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
  goalCode?: string
  goal?: string
}

type CredentialFormatType = LegacyIndyCredentialFormat | DidCommJsonLdCredentialFormat | AnonCredsDidCommCredentialFormat

export interface CreateOfferOobOptions {
  protocolVersion: string
  credentialFormats: DidCommCredentialFormatPayload<CredentialFormatType[], 'createOffer'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
  goalCode?: string
  parentThreadId?: string
  willConfirm?: boolean
  label?: string
  imageUrl?: string
  recipientKey?: string
  invitationDid?: string
}
export interface CredentialCreateOfferOptions {
  credentialRecord: DidCommCredentialExchangeRecord
  credentialFormats: JsonCredential
  options: any
  attachmentId?: string
}

export interface CreateProofRequestOobOptions {
  protocolVersion: string
  proofFormats: any
  goalCode?: string
  parentThreadId?: string
  willConfirm?: boolean
  autoAcceptProof?: DidCommAutoAcceptProof
  comment?: string
  label?: string
  imageUrl?: string
  recipientKey?: string
  invitationDid?: string
}

export interface OfferCredentialOptions {
  credentialFormats: {
    indy: {
      credentialDefinitionId: string
      attributes: {
        name: string
        value: string
      }[]
    }
  }
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
  connectionId: string
}

export interface V2OfferCredentialOptions {
  protocolVersion: string
  connectionId: string
  credentialFormats: {
    indy: {
      credentialDefinitionId: string
      attributes: {
        name: string
        value: string
      }[]
    }
  }
  autoAcceptCredential: string
}

export interface AcceptCredential {
  credentialRecordId: RecordId
}

export interface CredentialOfferOptions {
  credentialRecordId: RecordId
  credentialFormats?: DidCommCredentialFormatPayload<CredentialFormats, 'acceptOffer'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
}

export interface AcceptCredentialRequestOptions {
  credentialRecordId: RecordId
  credentialFormats?: DidCommCredentialFormatPayload<CredentialFormats, 'acceptRequest'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
}

type ReceiveOutOfBandInvitationProps = Omit<ReceiveOutOfBandInvitationConfig, 'routing'>

export interface ReceiveInvitationProps extends ReceiveOutOfBandInvitationProps {
  invitation: OutOfBandInvitationSchema
}

export interface ReceiveInvitationByUrlProps extends ReceiveOutOfBandInvitationProps {
  invitationUrl: string
}

export interface AcceptInvitationConfig {
  autoAcceptConnection?: boolean
  reuseConnection?: boolean
  label: string
  alias?: string
  imageUrl?: string
  mediatorId?: string
}

export interface OutOfBandInvitationSchema {
  '@id'?: string
  '@type': string
  label: string
  goalCode?: string
  goal?: string
  accept?: string[]
  handshake_protocols?: CustomHandshakeProtocol[]
  services: Array<OutOfBandDidCommService | string>
  imageUrl?: string
}

export interface ConnectionInvitationSchema {
  id?: string
  '@type': string
  label: string
  did?: string
  recipientKeys?: string[]
  serviceEndpoint?: string
  routingKeys?: string[]
  imageUrl?: string
}

// TODO: added type in protocolVersion
// export interface RequestProofOptions {
//   protocolVersion: 'v1' | 'v2'
//   connectionId: string
//   // TODO: added indy proof formate
//   proofFormats: ProofFormatPayload<[IndyProofFormat], 'createRequest'>
//   comment: string
//   autoAcceptProof?: DidCommAutoAcceptProof
//   parentThreadId?: string
// }

export interface RequestProofOptions {
  connectionId: string
  protocolVersion: string
  proofFormats: any
  comment: string
  autoAcceptProof: DidCommAutoAcceptProof
  goalCode?: string
  parentThreadId?: string
  willConfirm?: boolean
}

// TODO: added type in protocolVersion
export interface RequestProofProposalOptions {
  connectionId: string
  proofFormats: any
  goalCode?: string
  parentThreadId?: string
  autoAcceptProof?: DidCommAutoAcceptProof
  comment?: string
}

export interface AcceptProofProposal {
  proofRecordId: string
  proofFormats: any
  comment?: string
  autoAcceptProof?: DidCommAutoAcceptProof
  goalCode?: string
  willConfirm?: boolean
}

export interface GetTenantAgentOptions {
  tenantId: string
}

export interface DidCreateOptions {
  method?: string
  did?: string
  options?: DidRegistrationExtraOptions
  secret?: DidRegistrationSecretOptions
  didDocument?: DidDocument
  seed?: any
}

export interface ResolvedDid {
  didUrl: string
  options?: DidResolutionOptions
}

export interface DidCreate {
  // FIXME: Check type
  keyType?: KeyAlgorithm
  seed?: string
  domain?: string
  method: string
  network?: string
  did?: string
  role?: string
  endorserDid?: string
  didDocument?: DidDocument
  privatekey?: string
  endpoint?: string
}

export interface CreateTenantOptions {
  config: Omit<CustomTenantConfig, 'walletConfig'>
}

// export type WithTenantAgentCallback<AgentModules extends ModulesMap> = (
//   tenantAgent: TenantAgent<AgentModules>
// ) => Promise<void>

export interface WithTenantAgentOptions {
  tenantId: string
  method: string
  payload?: any
}

export interface ReceiveConnectionsForTenants {
  tenantId: string
  invitationId?: string
}

export interface CreateInvitationOptions {
  label?: string
  alias?: string
  imageUrl?: string
  goalCode?: string
  goal?: string
  handshake?: boolean
  handshakeProtocols?: DidCommHandshakeProtocol[]
  messages?: DidCommMessage[]
  multiUseInvitation?: boolean
  autoAcceptConnection?: boolean
  routing?: DidCommRouting
  appendedAttachments?: DidCommAttachment[]
  invitationDid?: string
}

//todo:Add transaction type
export interface EndorserTransaction {
  transaction: string | Record<string, unknown>
  endorserDid: string
}

export interface DidNymTransaction {
  did: string
  nymRequest: string
}

//todo:Add endorsedTransaction type
export interface WriteTransaction {
  endorsedTransaction: string
  endorserDid?: string
  schema?: {
    issuerId: string
    name: string
    version: string
    attributes: string[]
  }
  credentialDefinition?: {
    schemaId: string
    issuerId: string
    tag: string
    value: unknown
    type: string
  }
}
export interface RecipientKeyOption {
  recipientKey?: string
}

export interface CreateSchemaInput {
  issuerId: string
  name: string
  version: string
  attributes: string[]
  endorse?: boolean
  endorserDid?: string
}

export interface SchemaMetadata {
  did: string
  schemaId: string
  schemaTxnHash?: string
  schemaUrl?: string
}
/**
 * @example "ea4e5e69-fc04-465a-90d2-9f8ff78aa71d"
 */
export type ThreadId = string

export type SignDataOptions = {
  data: string
  // FIXME: Check type
  keyType: any
  publicKeyBase58: string
  did?: string
  method?: string
}

export type VerifyDataOptions = {
  data: string
  // FIXME: Check type
  keyType: any
  publicKeyBase58: string
  signature: string
}

export interface jsonLdCredentialOptions {
  '@context': Array<string | JsonObject>
  type: Array<string>
  credentialSubject: SingleOrArray<JsonObject>
  proofType: string
}

export interface credentialPayloadToSign {
  issuerDID: string
  method: string
  credential: jsonLdCredentialOptions // TODO: add support for other credential format
}
export interface SafeW3cJsonLdVerifyCredentialOptions extends W3cJsonLdVerifyCredentialOptions {
  // Ommited due to issues with TSOA
  // FIXME: Check type
  proof: SingleOrArray<any | DataIntegrityProofOptions>
}

export type ExtensibleW3cCredentialSubject = W3cCredentialSubject & {
  [key: string]: unknown
}

export type ExtensibleW3cCredential = W3cCredential & {
  [key: string]: unknown
  credentialSubject: SingleOrArray<ExtensibleW3cCredentialSubject>
}

export type CustomW3cJsonLdSignCredentialOptions = Omit<W3cJsonLdSignCredentialOptions, 'format'> & {
  [key: string]: unknown
}

export type DisclosureFrame = {
  [key: string]: boolean | DisclosureFrame
}


export interface BasicX509CreateCertificateConfig extends X509CertificateIssuerAndSubjectOptions {
         
  // FIXME: Check type
  keyType: any;
    issuerAlternativeNameURL: string;
}

export interface X509ImportCertificateOptionsDto {

    /*
        X.509 certificate in base64 string format
    */
    certificate: string;

   /*
   Private key in base64 string format
   */
    privateKey?: string;
  
  // FIXME: Check type
  keyType: any;
}