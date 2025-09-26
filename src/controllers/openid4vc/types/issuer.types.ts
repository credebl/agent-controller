import { MdocNameSpaces, W3cCredential } from "@credo-ts/core"
import { OpenId4VciCreateCredentialOfferOptions, OpenId4VciCredentialFormatProfile, OpenId4VciSignCredentials } from "@credo-ts/openid4vc"

export enum SignerMethod {
  Did = 'did',
  X5c = 'x5c',
}

export interface OpenId4VciOfferCredentials {
  credentialSupportedId: string  
  format: OpenId4VciCredentialFormatProfile,
  signerOptions: {
    method: SignerMethod
    did?: string
    x5c?: string[]
  }
}

export interface OpenId4VciOfferSdJwtCredential extends OpenId4VciOfferCredentials {
  
  payload: {
    vct?: string
    [key: string]: unknown
  }
  disclosureFrame?: Record<string, boolean | Record<string, boolean>>
}
export interface ValidityInfo {
    signed: Date;
    validFrom: Date;
    validUntil: Date;
    expectedUpdate?: Date;
}

export interface OpenId4VciOfferMdocCredential extends OpenId4VciOfferCredentials {     
  payload: {
    docType: 'org.iso.18013.5.1.mDL' | (string & {})
    validityInfo?: Partial<ValidityInfo>,
    namespaces: MdocNameSpaces    
  }
}

export interface OpenId4VciOfferW3cCredential extends OpenId4VciOfferCredentials {     
  payload: {
  verificationMethod: string;
   credential: W3cCredential;
  }
}


export interface OpenId4VcIssuanceSessionsCreateOffer {//extends OpenId4VciCreateCredentialOfferOptions {
  publicIssuerId: string
  credentials: Array<OpenId4VciOfferSdJwtCredential | OpenId4VciOfferMdocCredential | OpenId4VciOfferW3cCredential> 
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
