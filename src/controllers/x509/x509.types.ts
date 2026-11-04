import type { Curve } from '../types'
import type { X509ExtendedKeyUsage, X509KeyUsage } from '@credo-ts/core'

// Enum remains the same
export enum GeneralNameType {
  DNS = 'dns',
  DN = 'dn',
  EMAIL = 'email',
  GUID = 'guid',
  IP = 'ip',
  URL = 'url',
  UPN = 'upn',
  REGISTERED_ID = 'id',
}

export interface AuthorityAndSubjectKeyDto {
  /**
   * @example "my-seed-12345"
   * @description Seed to deterministically derive the key (optional)
   */
  seed?: string

  /**
   * @example "3yPQbnk6WwLgX8K3JZ4t7vBnJ8XqY2mMpRcD9fNvGtHw"
   * @description publicKeyBase58 for using existing key in wallet (optional)
   */
  publicKeyBase58?: string

  /**
   * @example "p256"
   * @description Type of the key used for signing the X.509 Certificate (default is p256)
   */
  keyType?: Curve
}

export interface NameDto {
  /**
   * @example "dns"
   */
  type: GeneralNameType

  /**
   * @example "example.com"
   */
  value: string
}

export interface X509CertificateIssuerAndSubjectOptionsDto {
  /**
   * @example "US"
   */
  countryName?: string

  /**
   * @example "California"
   */
  stateOrProvinceName?: string

  /**
   * @example "IT Department"
   */
  organizationalUnit?: string

  /**
   * @example "Example Corporation"
   */
  commonName?: string
}

export interface ValidityDto {
  /**
   * @example "2024-01-01T00:00:00.000Z"
   */
  notBefore?: Date

  /**
   * @example "2025-01-01T00:00:00.000Z"
   */
  notAfter?: Date
}

export interface KeyUsageDto {
  /**
   * @example ["digitalSignature", "keyEncipherment", "crlSign"]
   */
  usages: X509KeyUsage[]

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface ExtendedKeyUsageDto {
  /**
   * @example ["MdlDs", "ServerAuth", "ClientAuth"]
   */
  usages: X509ExtendedKeyUsage[]

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface NameListDto {
  /**
   * @example [{ "type": "dns", "value": "example.com" }, { "type": "email", "value": "admin@example.com" }]
   */
  name: NameDto[]

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface AuthorityAndSubjectKeyIdentifierDto {
  /**
   * @example true
   */
  include: boolean

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface BasicConstraintsDto {
  /**
   * @example false
   */
  ca: boolean

  /**
   * @example 0
   */
  pathLenConstraint?: number

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface CrlDistributionPointsDto {
  /**
   * @example ["http://crl.example.com/ca.crl"]
   */
  urls: string[]

  /**
   * @example true
   */
  markAsCritical?: boolean
}

export interface X509CertificateExtensionsOptionsDto {
  keyUsage?: KeyUsageDto
  extendedKeyUsage?: ExtendedKeyUsageDto
  authorityKeyIdentifier?: AuthorityAndSubjectKeyIdentifierDto
  subjectKeyIdentifier?: AuthorityAndSubjectKeyIdentifierDto
  issuerAlternativeName?: NameListDto
  subjectAlternativeName?: NameListDto
  basicConstraints?: BasicConstraintsDto
  crlDistributionPoints?: CrlDistributionPointsDto
}

// Main DTO Interface
export interface X509CreateCertificateOptionsDto {
  authorityKey?: AuthorityAndSubjectKeyDto
  subjectPublicKey?: AuthorityAndSubjectKeyDto

  /**
   * @example "1234567890"
   */
  serialNumber?: string

  /**
   * @example {
   *   "countryName": "US",
   *   "stateOrProvinceName": "California",
   *   "commonName": "Example CA"
   * }
   * OR
   * @example "/C=US/ST=California/O=Example Corporation/CN=Example CA"
   */
  issuer: X509CertificateIssuerAndSubjectOptionsDto | string

  /**
   * @example {
   *   "countryName": "US",
   *   "commonName": "www.example.com"
   * }
   * OR
   * @example "/C=US/CN=www.example.com"
   */
  subject?: X509CertificateIssuerAndSubjectOptionsDto | string

  validity?: ValidityDto
  extensions?: X509CertificateExtensionsOptionsDto
}

export type DidX509PolicyType = 'subject' | 'san' | 'eku' | 'fulcio-issuer'

/**
 * A policy narrows down which certificates of the chain may use the did:x509, see
 * https://github.com/microsoft/did-x509/blob/main/specification.md#5-did-x509-policies
 */
export interface DidX509Policy {
  /**
   * @example "subject"
   */
  type: DidX509PolicyType

  /**
   * Only for `subject`: the attributes of the leaf certificate's subject the DID is restricted to.
   * @example { "CN": "example.com", "O": "Example Org" }
   */
  fields?: Record<string, string>

  /**
   * Only for `san`: the type of the subject alternative name.
   * @example "dns"
   */
  sanType?: 'dns' | 'email' | 'uri'

  /**
   * For `san` the name, for `eku` the OID, for `fulcio-issuer` the issuer.
   * @example "example.com"
   */
  value?: string
}

export interface DidX509ImportOptionsDto {
  /**
   * Certificate chain, leaf first and root CA last. Every entry is either a PEM certificate / PEM bundle or a base64
   * encoded DER certificate.
   */
  certificateChain: string[]

  /**
   * Private key of the leaf certificate: PEM (PKCS#8, SEC1 or PKCS#1) or base64 DER (PKCS#8). EC (P-256, P-384,
   * P-521), Ed25519 and RSA keys are supported.
   */
  privateKey: string

  /**
   * Passphrase of the private key if it is encrypted
   */
  passphrase?: string

  /**
   * Policies of the DID. Defaults to the common name of the leaf certificate (`subject:CN`) when omitted.
   * @example [{ "type": "subject", "fields": { "CN": "example.com" } }]
   */
  policies?: DidX509Policy[]

  /**
   * Import an existing did:x509 instead of deriving one from the chain. It is validated against the chain.
   */
  did?: string
}

export interface DidX509ImportResponse {
  did: string
  didDocument: Record<string, unknown>
  /**
   * Id of the leaf key in the agent's KMS
   */
  keyId: string
  verificationMethodId: string
}

export interface DidX509ChainResponse {
  did: string
  /**
   * base64url encoded DER certificates, leaf first
   */
  x509chain: string[]
}
