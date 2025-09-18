import { OpenId4VciCredentialFormatProfile } from "@credo-ts/openid4vc"

export enum SignerMethod {
  Did = 'did',
  X5c = 'x5c',
}

export interface OpenId4VcIssuanceSessionCredentialOptions {
  credentialSupportedId: string
  signerOptions: {
    method: SignerMethod
    did?: string
    x5c?: string[]
  }
  format: OpenId4VciCredentialFormatProfile
  payload: {
    vct?: string
    [key: string]: unknown
  }
  disclosureFrame?: Record<string, boolean | Record<string, boolean>>
}

export interface OpenId4VcIssuanceSessionsCreateOffer {
  publicIssuerId: string
  credentials: Array<OpenId4VcIssuanceSessionCredentialOptions>
  authorizationCodeFlowConfig?: {
    authorizationServerUrl: string
    requirePresentationDuringIssuance?: boolean
    issuerState?: string
  }
  preAuthorizedCodeFlowConfig?: {
    preAuthorizedCode?: string
    txCode?: {
      description?: string
      length?: number
      input_mode?: 'numeric' | 'text'
    }
    authorizationServerUrl: string
  }
  issuanceMetadata?: Record<string, unknown>
}

export interface X509GenericRecordContent {
  dcs?: string | string[]
  root?: string
}

export interface X509GenericRecord {
  id: string
  content?: X509GenericRecordContent
}

export interface Logo {
  uri?: string
  alt_text?: string
  [key: string]: unknown
}

export interface CredentialDisplay {
  name?: string
  locale?: string
  logo?: Logo
  [key: string]: unknown
}

export interface AuthorizationServerClientAuth {
  clientId: string
  clientSecret: string
}

export interface AuthorizationServerConfig {
  issuer: string
  clientAuthentication?: AuthorizationServerClientAuth
}

export interface BatchCredentialIssuanceOptions {
  batchSize: number
}

export interface ProofTypeConfig {
  proof_signing_alg_values_supported: string[]
}

export interface CredentialConfigurationDisplay {
  name: string
  locale?: string
  logo?: Logo
  description?: string
  background_color?: string
  background_image?: Logo
  text_color?: string
}

export interface CredentialDefinition {
  type: string[]
  [key: string]: any
}

export interface CredentialConfigurationSupportedWithFormats {
  format: 'vc+sd-jwt' | 'mso_mdoc' | 'jwt_vc_json' | string,
  vct?: string,
  doctype?: string,
  scope?: string
  claims?: Record<string, unknown>
  cryptographic_binding_methods_supported?: string[]
  credential_signing_alg_values_supported?: string[]
  proof_types_supported?: Record<string, ProofTypeConfig>
  credential_definition?: CredentialDefinition
  display?: CredentialConfigurationDisplay[]
}
export interface CreateIssuerOptions {
  issuerId?: string
  accessTokenSignerKeyType?: string
  display?: CredentialDisplay[]
  authorizationServerConfigs?: AuthorizationServerConfig[]
  dpopSigningAlgValuesSupported?: string[]
  credentialConfigurationsSupported: Record<string, CredentialConfigurationSupportedWithFormats>
  batchCredentialIssuance?: BatchCredentialIssuanceOptions
}

export interface UpdateIssuerRecordOptions {
  display?: CredentialDisplay[]
  dpopSigningAlgValuesSupported?: string[]
  credentialConfigurationsSupported: Record<string, CredentialConfigurationSupportedWithFormats>
  batchCredentialIssuance?: BatchCredentialIssuanceOptions
}
