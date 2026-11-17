import type { RecordId } from './examples'
import type {
  AnonCredsCredentialDefinition,
  AnonCredsDidCommCredentialFormat,
  AnonCredsDidCommProofFormat,
  LegacyIndyCredentialFormat,
  LegacyIndyDidCommProofFormat,
  RegisterCredentialDefinitionReturnStateAction,
  RegisterCredentialDefinitionReturnStateFailed,
  RegisterCredentialDefinitionReturnStateFinished,
  RegisterCredentialDefinitionReturnStateWait,
  RegisterSchemaReturnStateAction,
  RegisterSchemaReturnStateFailed,
  RegisterSchemaReturnStateFinished,
  RegisterSchemaReturnStateWait,
} from '@credo-ts/anoncreds'
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
  DidCommProofFormatPayload,
  DidCommDifPresentationExchangeProofFormat,
} from '@credo-ts/didcomm'
import type { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'
import type { DIDDocument } from 'did-resolver'

import { DidMethod, type CustomHandshakeProtocol } from '../enums'

export type CustomTenantConfig = { label: string } & {
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

export enum CredentialState {
  ProposalSent = 'proposal-sent',
  ProposalReceived = 'proposal-received',
  OfferSent = 'offer-sent',
  OfferReceived = 'offer-received',
  Declined = 'declined',
  RequestSent = 'request-sent',
  RequestReceived = 'request-received',
  CredentialIssued = 'credential-issued',
  CredentialReceived = 'credential-received',
  Done = 'done',
  Abandoned = 'abandoned',
}

export enum CredentialRole {
  Issuer = 'issuer',
  Holder = 'holder',
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
type ProofFormats = [
  LegacyIndyDidCommProofFormat,
  AnonCredsDidCommProofFormat,
  DidCommDifPresentationExchangeProofFormat,
]

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

export interface AcceptCredentialProposalOptions {
  credentialExchangeRecordId: string
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

type CredentialFormatType =
  LegacyIndyCredentialFormat | DidCommJsonLdCredentialFormat | AnonCredsDidCommCredentialFormat

export interface CreateOfferOobOptions {
  protocolVersion: ProtocolVersion
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
  credentialExchangeRecordId: RecordId
}

export interface CredentialOfferOptions {
  credentialExchangeRecordId: RecordId
  credentialFormats?: DidCommCredentialFormatPayload<CredentialFormats, 'acceptOffer'>
  autoAcceptCredential?: DidCommAutoAcceptCredential
  comment?: string
}

export interface AcceptCredentialRequestOptions {
  credentialExchangeRecordId: RecordId
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
  protocolVersion: ProtocolVersion
  connectionId: string
  proofFormats: DidCommProofFormatPayload<ProofFormats, 'createProposal'>
  goalCode?: string
  parentThreadId?: string
  autoAcceptProof?: DidCommAutoAcceptProof
  comment?: string
}

export interface AcceptProofProposal {
  proofExchangeRecordId: string
  proofFormats: DidCommProofFormatPayload<ProofFormats, 'acceptProposal'>
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
  keyType?: KeyAlgorithm
  seed?: string
  domain?: string
  method: string
  network?: string
  did?: string
  role?: string
  endorserDid?: string
  didDocument?: DidDocument
  /**
   * @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Send the did:polygon key inside `encryptedKey`.
   *
   * Hex encoded secp256k1 private key for `did:polygon`.
   */
  privatekey?: string
  /**
   * @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Use `encryptedKey` instead.
   *
   * Existing private key to import for `did:key` and `did:web`: PEM (PKCS#8, SEC1 or PKCS#1, optionally encrypted)
   * or base64 DER (PKCS#8). `privateKeyJwk` is the JWK equivalent. When either is supplied, `keyType` and `seed` are
   * ignored and the key material determines the DID.
   */
  privateKey?: string
  /** @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Use `encryptedKey` instead. */
  privateKeyJwk?: Record<string, unknown>
  /** @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Send the passphrase inside `encryptedKey`. */
  passphrase?: string
  /**
   * Private key material encrypted to a single-use import session (see `POST /dids/import/session`). This is the only
   * accepted way to import an existing `did:key`, `did:web` or `did:polygon` key in production.
   */
  encryptedKey?: KeyImportEncryptedKey
  endpoint?: string
  /**
   * Verification method type of the Ed25519 key in a new `did:web` document. Defaults to
   * `Ed25519VerificationKey2018`. `Ed25519VerificationKey2020` publishes `publicKeyMultibase` and signs
   * JSON-LD credentials and presentations with `Ed25519Signature2020`.
   */
  verificationMethodType?: Ed25519VerificationMethodType
}

/** An encrypted private key envelope bound to a single use import session. */
export interface KeyImportEncryptedKey {
  /** Id returned by `POST /dids/import/session`. */
  sessionId: string
  /** Compact JWE containing the private key material. */
  jwe: string
}

export interface KeyImportSessionRequest {
  /** DID method the key will be imported for. */
  method: string
}

export interface KeyImportSessionResponse {
  sessionId: string
  kid: string
  method: string
  /** ISO 8601 expiry of the session. */
  expiresAt: string
  alg: string
  enc: string
  /** Public key the client encrypts the private key material to. */
  publicKeyJwk: Record<string, unknown>
  /** Protected header the client must use for the JWE, it binds the envelope to this session. */
  protectedHeader: Record<string, unknown>
}

/** One private key of an imported did:web document, bound to the verification method the authority published it for. */
export interface DidWebImportKey {
  /**
   * Id of a verification method in `didDocument`. It can be absolute (`did:web:example.com#key-1`) or relative
   * (`#key-1`) to the imported DID.
   * @example "did:web:gov-agency.example.com#authority-signing-key"
   */
  verificationMethodId: string

  /**
   * Private key material encrypted to a single-use import session (see `POST /dids/import/session` with method `web`).
   * Each key needs its own session.
   */
  encryptedKey?: KeyImportEncryptedKey
  /** @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Use `encryptedKey` instead. */
  privateKey?: string
  /** @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Use `encryptedKey` instead. */
  privateKeyJwk?: Record<string, unknown>
  /** @deprecated Disabled unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Send the passphrase inside `encryptedKey`. */
  passphrase?: string
}

/**
 * Imports a `did:web` identity created and hosted by an external authority (for example a government agency). Unlike
 * `POST /dids/write`, the supplied DID document is stored verbatim instead of being regenerated from a domain.
 */
export interface DidWebImportOptions {
  /**
   * The authority's DID.
   * @example "did:web:gov-agency.example.com"
   */
  did: string

  /**
   * The DID document as published by the authority. When omitted it is resolved over the network instead.
   */
  didDocument?: Record<string, unknown>

  /** Private keys to import. Verification methods without a key stay in the document as public-only entries. */
  keys: DidWebImportKey[]

  /**
   * Import the supplied `didDocument` even when it cannot be resolved over the network (air-gapped or private
   * deployments). Without this flag a supplied document is compared with the published document and rejected on a
   * mismatch.
   */
  allowUnresolvedDocument?: boolean

  /**
   * Rebind an existing imported DID to a different document or key. Without it, re-importing the same document and
   * keys is idempotent but a different binding is rejected.
   */
  replace?: boolean
}

export interface DidWebImportedKey {
  /** Verification method id exactly as it appears in the imported document. */
  verificationMethodId: string
  /** Id of the private key in the agent's KMS. */
  keyId: string
  /** Backend that holds the key: `askar`, `node` or `openbao`. */
  backend: string
}

export interface DidWebImportResponse {
  did: string
  didDocument: Record<string, unknown>
  keys: DidWebImportedKey[]
}

export type Ed25519VerificationMethodType = 'Ed25519VerificationKey2018' | 'Ed25519VerificationKey2020'

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
/** A DID trusted to issue the credential being verified (Credo's `TrustedIssuerDid`). */
export interface TrustedIssuerDidOption {
  method: 'did'
  /** The trusted issuer DID */
  issuance: string
}

// Credo 0.7.4 also accepts a callback for trustedIssuers, which tsoa cannot model; only the list is exposed
export interface SafeW3cJsonLdVerifyCredentialOptions extends Omit<W3cJsonLdVerifyCredentialOptions, 'trustedIssuers'> {
  // Ommited due to issues with TSOA
  // FIXME: Check type
  proof: SingleOrArray<any | DataIntegrityProofOptions>
  /**
   * Issuer DIDs to accept. When set, verification fails for a credential from any other DID;
   * an empty list trusts no issuer.
   */
  trustedIssuers?: TrustedIssuerDidOption[]
}

export type ExtensibleW3cCredentialSubject = W3cCredentialSubject & {
  [key: string]: unknown
}

export type ExtensibleW3cCredential = W3cCredential & {
  [key: string]: unknown
  credentialSubject: SingleOrArray<ExtensibleW3cCredentialSubject>
}

export type CustomW3cJsonLdSignCredentialOptions = Omit<W3cJsonLdSignCredentialOptions, 'format' | 'credential'> & {
  credential: Omit<W3cCredential, 'context' | 'credentialSubject'> & {
    '@context': Array<string | Record<string, unknown>>
    credentialSubject: SingleOrArray<JsonObject>
  }
  [key: string]: unknown
}

export type DisclosureFrame = {
  [key: string]: boolean | DisclosureFrame
}

export interface BasicX509CreateCertificateConfig extends X509CertificateIssuerAndSubjectOptions {
  // FIXME: Check type
  keyType: any
  issuerAlternativeNameURL: string
}

export interface X509ImportCertificateOptionsDto {
  /*
        X.509 certificate in base64 string format
    */
  certificate: string

  /*
   Private key in base64 string format
   */
  privateKey?: string

  // FIXME: Check type
  keyType: any
}

export const supportedKeyTypesDID: Record<DidMethod, readonly { kty: string; crv: string }[]> = {
  [DidMethod.Indy]: [{ kty: 'OKP', crv: 'Ed25519' }],

  // RSA keys are supported as well but are not described by a curve
  [DidMethod.X509]: [
    { kty: 'OKP', crv: 'Ed25519' },
    { kty: 'EC', crv: 'P-256' },
    { kty: 'EC', crv: 'P-384' },
    { kty: 'EC', crv: 'P-521' },
  ],

  [DidMethod.Peer]: [
    { kty: 'OKP', crv: 'Ed25519' },
    { kty: 'OKP', crv: 'X25519' },
  ],

  [DidMethod.Key]: [
    { kty: 'OKP', crv: 'Ed25519' },
    { kty: 'OKP', crv: 'X25519' },
    { kty: 'EC', crv: 'P-256' },
    { kty: 'EC', crv: 'P-384' },
    { kty: 'EC', crv: 'P-521' },
    { kty: 'EC', crv: 'secp256k1' },
  ],

  [DidMethod.Web]: [
    { kty: 'OKP', crv: 'Ed25519' },
    { kty: 'OKP', crv: 'X25519' },
    { kty: 'EC', crv: 'P-256' },
    { kty: 'EC', crv: 'secp256k1' },
  ],

  [DidMethod.Polygon]: [{ kty: 'EC', crv: 'secp256k1' }],
}

export type Curve = 'Ed25519' | 'X25519' | 'P-256' | 'P-384' | 'P-521' | 'secp256k1'

export type OkpCurve = 'Ed25519' | 'X25519'
export type EcCurve = 'P-256' | 'P-384' | 'P-521' | 'secp256k1'

export type OkpType = {
  kty: 'OKP'
  crv: 'Ed25519' | 'X25519'
}

export type EcType = {
  kty: 'EC'
  crv: 'P-256' | 'P-384' | 'P-521' | 'secp256k1'
}

export interface SchemaResponseDTO {
  schemaId: string
  schema?: {
    issuerId: string
    name: string
    version: string
    attrNames: string[]
  }
  resolutionMetadata: Record<string, unknown> // Use Record or explicitly define what you need
  schemaMetadata: Record<string, unknown>
}

export interface RegisterSchemaReturn {
  jobId?: string
  schemaState:
    | RegisterSchemaReturnStateWait
    | RegisterSchemaReturnStateAction
    | RegisterSchemaReturnStateFinished
    | RegisterSchemaReturnStateFailed
  schemaMetadata: Record<string, unknown>
  registrationMetadata: Record<string, unknown>
}

export interface GetCredentialDefinitionReturn {
  credentialDefinition?: AnonCredsCredentialDefinition
  credentialDefinitionId: string
  resolutionMetadata: Record<string, unknown>
  credentialDefinitionMetadata: Record<string, unknown>
}

export type CredentialDefinitionStates =
  | RegisterCredentialDefinitionReturnStateWait
  | RegisterCredentialDefinitionReturnStateAction
  | RegisterCredentialDefinitionReturnStateFinished
  | RegisterCredentialDefinitionReturnStateFailed

export interface RegisterCredentialDefinitionReturn {
  jobId?: string
  credentialDefinitionState: CredentialDefinitionStates
  credentialDefinitionMetadata: Record<string, unknown>
  registrationMetadata: Record<string, unknown>
}
