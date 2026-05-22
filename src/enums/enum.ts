export enum CredentialEnum {
  Finished = 'finished',
  Action = 'action',
  Failed = 'failed',
  Wait = 'wait',
}

export enum Role {
  Author = 'author',
  Endorser = 'endorser',
}

export enum DidMethod {
  Indy = 'indy',
  Key = 'key',
  Web = 'web',
  Polygon = 'polygon',
  Peer = 'peer',
}

export enum NetworkName {
  Bcovrin = 'bcovrin',
  Indicio = 'indicio',
}

export enum IndicioTransactionAuthorAgreement {
  Indicio_Testnet_Mainnet_Version = '1.0',
  // To do: now testnet has also moved to version 1.3 of TAA
  Indicio_Demonet_Version = '1.3',
}

export enum Network {
  Bcovrin_Testnet = 'bcovrin:testnet',
  Indicio_Testnet = 'indicio:testnet',
  Indicio_Demonet = 'indicio:demonet',
  Indicio_Mainnet = 'indicio:mainnet',
}

export enum NetworkTypes {
  Testnet = 'testnet',
  Demonet = 'demonet',
  Mainnet = 'mainnet',
}

export enum IndicioAcceptanceMechanism {
  Wallet_Agreement = 'wallet_agreement',
  At_Submission = 'at_submission',
  For_Session = 'for_session',
  On_File = 'on_file',
  Product_Eula = 'product_eula',
  Service_Agreement = 'service_agreement',
}

export enum EndorserMode {
  Internal = 'internal',
  External = 'external',
}

export enum SchemaError {
  NotFound = 'notFound',
  UnSupportedAnonCredsMethod = 'unsupportedAnonCredsMethod',
}

export enum HttpStatusCode {
  OK = 200,
  Created = 201,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  InternalServerError = 500,
}

export declare enum CustomHandshakeProtocol {
  DidExchange = 'https://didcomm.org/didexchange/1.1',
  Connections = 'https://didcomm.org/connections/1.0',
}

export enum AgentRole {
  RestRootAgentWithTenants = 'RestRootAgentWithTenants',
  RestRootAgent = 'RestRootAgent',
  RestTenantAgent = 'RestTenantAgent',
}

export enum ErrorMessages {
  Unauthorized = 'Unauthorized',
}

export enum RESULT {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum SCOPES {
  UNPROTECTED = 'skip',
  MULTITENANT_BASE_AGENT = 'Basewallet',
  TENANT_AGENT = 'tenant',
  DEDICATED_AGENT = 'dedicated',
}

export enum SignerMethod {
  Did = 'did',
  X5c = 'x5c',
}
export enum KeyAlgorithmCurve {
  Ed25519 = 'Ed25519',
  X25519 = 'X25519',
  P256 = 'P-256',
  P384 = 'P-384',
  P521 = 'P-521',
  secp256k1 = 'secp256k1',
  Bls12381G2 = 'bls12381g2',
}

export enum CredentialFormat {
  VcSdJwt = 'vc+sd-jwt',
  DcSdJwt = 'dc+sd-jwt',
  JwtVcJson = 'jwt_vc_json',
  JwtVcJsonLd = 'jwt_vc_json-ld',
  LdpVc = 'ldp_vc',
}
