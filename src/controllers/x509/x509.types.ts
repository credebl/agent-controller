import type { KeyType, X509ExtendedKeyUsage, X509KeyUsage } from '@credo-ts/core'

import { Extension, Example } from 'tsoa'

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
  keyType?: KeyType
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
