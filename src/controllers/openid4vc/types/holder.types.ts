import type { ResolveOpenId4VpAuthorizationRequestOptions } from '@credo-ts/openid4vc'

export interface ResolveCredentialOfferBody {
  credentialOfferUri: string
}

export interface RequestCredentialBody {
  credentialOfferUri: string
  /**
   * Credential configuration ids to request. Each must be in the offer. Defaults to all offered ids.
   */
  credentialsToRequest?: string[]
  authorizationCode?: string
  codeVerifier?: string
  txCode?: string
  tags?: CredentialTags
  /**
   * Bind the credentials to this DID instead of a new key: a verification method id
   * (e.g. `did:web:example.com#key-1`), or a bare DID to use its first authentication key.
   * The DID must have been created or imported in this wallet.
   * @example "did:web:ayanworks.github.io:iec:0522012345#key-1"
   */
  holderDidUrl?: string
  /**
   * What to do when the issuer does not support `holderDidUrl` (DID method or key algorithm):
   * `require` fails the request, `prefer` binds to a new key instead. Ignored without `holderDidUrl`.
   * @default "require"
   */
  bindingPolicy?: CredentialBindingPolicy
}

export type CredentialBindingPolicy = 'require' | 'prefer'

export type CredentialTags = Record<string, string | string[] | undefined>

export interface CredentialListQuery {
  q?: string
  page?: number
  pageSize?: number
  credentialType?: string
  vct?: string
  docType?: string
  types?: string
  issuer?: string
  name?: string
  reference?: string
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
  filters?: CredentialListQuery
}

export type PaginatedCredentials<T> = PaginatedResponse<T>

export interface AuthorizeRequestCredentialOffer {
  credentialOfferUri: string
  credentialsToRequest: string[]
}

export interface ResolveProofRequest {
  proofRequestUri: string
  options?: ResolveOpenId4VpAuthorizationRequestOptions
}

export interface AcceptProofRequest {
  proofRequestUri: string
  // selectedCredentials?: { [inputDescriptorId: string]: string }
}

export interface DeleteCredentialBody {
  credentialType: CredentialType
  credentialId: string
}

export enum CredentialType {
  SD_JWT = 'sd-jwt-vc',
  MSO_MDOC = 'mso_mdoc',
  W3C_VC = 'w3c-vc',
}
