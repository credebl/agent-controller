import type { ResolveOpenId4VpAuthorizationRequestOptions } from '@credo-ts/openid4vc'

export interface ResolveCredentialOfferBody {
  credentialOfferUri: string
}

export interface RequestCredentialBody {
  credentialOfferUri: string
  credentialsToRequest: string[]
  authorizationCode?: string
  codeVerifier?: string
  txCode?: string
}

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
}
