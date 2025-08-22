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
}

export interface AcceptProofRequest {
  proofRequestUri: string
  // selectedCredentials?: { [inputDescriptorId: string]: string }
}
