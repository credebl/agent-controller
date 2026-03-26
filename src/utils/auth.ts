export interface NoAuth {
  type: 'NoAuth'
  trustListUrl: string
}

export interface ClientAuth {
  type: 'ClientAuth'
  trustServiceTokenUrl: string
  trustListUrl: string
  trustServiceClientId: string
  trustServiceClientSecret: string
}

export type Auth = NoAuth | ClientAuth

export type AuthType = Auth['type']

export const AuthTypes = {
  NoAuth: 'NoAuth',
  ClientAuth: 'ClientAuth',
} as const satisfies Record<AuthType, AuthType>

const SUPPORTED_AUTH_TYPES = Object.values(AuthTypes) satisfies AuthType[]

export function getAuthType(): AuthType {
  const authType = process.env.TRUST_SERVICE_AUTH_TYPE as AuthType
  if (!authType) {
    console.warn('[getAuthType] TRUST_SERVICE_AUTH_TYPE is not set — defaulting to NoAuth')
    return AuthTypes.NoAuth
  }
  if (!SUPPORTED_AUTH_TYPES.includes(authType)) {
    throw new Error(
      `TRUST_SERVICE_AUTH_TYPE '${authType}' is not supported. Supported types: ${SUPPORTED_AUTH_TYPES.join(', ')}`,
    )
  }
  return authType
}

export function validateAuthConfig(): void {
  const authType = getAuthType()
  console.log('[validateAuthConfig] TRUST_SERVICE_AUTH_TYPE:', authType)

  const validators: Record<AuthType, () => void> = {
    NoAuth: () => {
      if (!process.env.TRUST_LIST_URL) throw new Error('[validateAuthConfig] TRUST_LIST_URL is required for NoAuth')
    },
    ClientAuth: () => {
      if (!process.env.TRUST_SERVICE_TOKEN_URL) throw new Error('[validateAuthConfig] TRUST_SERVICE_TOKEN_URL is required for ClientAuth')
      if (!process.env.TRUST_LIST_URL) throw new Error('[validateAuthConfig] TRUST_LIST_URL is required for ClientAuth')
      if (!process.env.TRUST_SERVICE_CLIENT_ID) throw new Error('[validateAuthConfig] TRUST_SERVICE_CLIENT_ID is required for ClientAuth')
      if (!process.env.TRUST_SERVICE_CLIENT_SECRET) throw new Error('[validateAuthConfig] TRUST_SERVICE_CLIENT_SECRET is required for ClientAuth')
    },
  }

  validators[authType]()
  console.log('[validateAuthConfig] configuration valid for auth type:', authType)
}
