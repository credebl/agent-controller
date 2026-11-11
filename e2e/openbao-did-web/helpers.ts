import type { JsonWebKey } from 'node:crypto'

import { encryptKeyImportEnvelope } from '../../src/utils/keyImport/jwe'

/**
 * Helpers for the live integration suite. These tests run against a real agent-controller and a real OpenBao, so they
 * are excluded from the default Jest run and from CI. See README.md in this directory.
 */
export interface LiveConfig {
  dedicatedAgentUrl: string
  tenantAgentUrl: string
  openBaoUrl: string
  openBaoToken: string
  apiKey: string
}

export interface ImportSession {
  sessionId: string
  publicKeyJwk: JsonWebKey
  protectedHeader: string
}

export interface VerificationMethod {
  id: string
  publicKeyBase58?: string
}

export interface DidWriteResult {
  did: string
  didDocument: {
    verificationMethod: VerificationMethod[]
  }
}

/** Response of `POST /dids/web/import` for an externally issued did:web document. */
export interface DidWebImportResult {
  did: string
  didDocument: Record<string, unknown>
  keys: Array<{ verificationMethodId: string; keyId: string; backend: string }>
}

export interface ErrorResult {
  message?: string
}

export interface TenantCredentials {
  id: string
  token: string
}

interface TransitKeyListResponse {
  data?: {
    keys?: string[]
  }
}

export interface TransitKeyResponse {
  data?: {
    type?: string
    keys?: Record<string, { public_key?: string }>
  }
}

export interface AgentCallResult<T> {
  status: number
  body: T
}

/** Raw-data signing, without storing a credential. */
export const SIGN_RAW_DATA_PATH = '/agent/credential/sign?storeCredential=false&dataTypeToSign=rawData'

export const liveIntegrationEnabled = process.env.OPENBAO_INTEGRATION === '1'

export function liveConfig(): LiveConfig {
  return {
    dedicatedAgentUrl: process.env.OPENBAO_INTEGRATION_DEDICATED_URL ?? 'http://127.0.0.1:4101',
    tenantAgentUrl: process.env.OPENBAO_INTEGRATION_TENANT_URL ?? 'http://127.0.0.1:4201',
    openBaoUrl: process.env.OPENBAO_INTEGRATION_OPENBAO_URL ?? 'http://127.0.0.1:8201',
    openBaoToken: process.env.OPENBAO_INTEGRATION_OPENBAO_TOKEN ?? 'root-dev-token',
    apiKey: process.env.OPENBAO_INTEGRATION_API_KEY ?? 'local-integration-api-key-16',
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function getAgentToken(agentUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${agentUrl}/agent/token`, {
    method: 'POST',
    headers: { authorization: apiKey },
  })
  const body = (await parseBody(response)) as { token?: string }
  if (response.status !== 200 || !body?.token) {
    throw new Error(`Could not get an agent token from ${agentUrl}: ${response.status} ${JSON.stringify(body)}`)
  }
  return body.token
}

export async function agentCall<T>(
  agentUrl: string,
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<AgentCallResult<T>> {
  const response = await fetch(`${agentUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: (await parseBody(response)) as T }
}

export async function openBaoGet<T>(config: LiveConfig, path: string): Promise<T | null> {
  const response = await fetch(`${config.openBaoUrl}/v1/${path}`, {
    headers: { 'X-Vault-Token': config.openBaoToken },
  })
  if (response.status === 404) return null
  return (await parseBody(response)) as T
}

export async function transitKeys(config: LiveConfig): Promise<string[]> {
  const listed = await openBaoGet<TransitKeyListResponse>(config, 'transit/keys?list=true')
  return [...(listed?.data?.keys ?? [])].sort((left, right) => left.localeCompare(right))
}

export function transitKey(config: LiveConfig, name: string): Promise<TransitKeyResponse | null> {
  return openBaoGet<TransitKeyResponse>(config, `transit/keys/${name}`)
}

export async function createImportSession(
  agentUrl: string,
  token: string,
  method: 'web' | 'key',
): Promise<ImportSession> {
  const result = await agentCall<ImportSession & ErrorResult>(agentUrl, token, 'POST', '/dids/import/session', {
    method,
  })
  if (result.status !== 200 || !result.body.sessionId) {
    throw new Error(`Could not create a key import session: ${result.status} ${JSON.stringify(result.body)}`)
  }
  return result.body
}

/**
 * Requests a single-use import session, encrypts the private key to it and calls `POST /dids/write`, exactly like the
 * studio does. The session and envelope are returned so tests can retry or replay them.
 */
export async function createDidFromEncryptedKey(
  agentUrl: string,
  token: string,
  method: 'web' | 'key',
  privateJwk: JsonWebKey,
  domain?: string,
): Promise<AgentCallResult<DidWriteResult & ErrorResult> & { session: ImportSession; jwe: string }> {
  const session = await createImportSession(agentUrl, token, method)
  const jwe = encryptKeyImportEnvelope(
    session.publicKeyJwk,
    Buffer.from(JSON.stringify({ privateKeyJwk: privateJwk })),
    session.protectedHeader,
  )
  const result = await writeWithEnvelope(agentUrl, token, method, domain, session, jwe)
  return { ...result, session, jwe }
}

export function writeWithEnvelope(
  agentUrl: string,
  token: string,
  method: 'web' | 'key',
  domain: string | undefined,
  session: ImportSession,
  jwe: string,
): Promise<AgentCallResult<DidWriteResult & ErrorResult>> {
  return agentCall<DidWriteResult & ErrorResult>(agentUrl, token, 'POST', '/dids/write', {
    method,
    ...(domain === undefined ? {} : { domain }),
    encryptedKey: { sessionId: session.sessionId, jwe },
  })
}

/**
 * Imports an externally issued did:web document the way an authority hands it over: the document plus private keys
 * encrypted to single-use sessions. Each key is bound to the verification method id given in the document.
 */
export async function importDidWebFromEncryptedKey(
  agentUrl: string,
  token: string,
  options: {
    did: string
    didDocument: Record<string, unknown>
    verificationMethodId: string
    privateJwk: JsonWebKey
    allowUnresolvedDocument?: boolean
    replace?: boolean
  },
): Promise<AgentCallResult<DidWebImportResult & ErrorResult> & { session: ImportSession; jwe: string }> {
  const session = await createImportSession(agentUrl, token, 'web')
  const jwe = encryptKeyImportEnvelope(
    session.publicKeyJwk,
    Buffer.from(JSON.stringify({ privateKeyJwk: options.privateJwk })),
    session.protectedHeader,
  )
  const result = await agentCall<DidWebImportResult & ErrorResult>(agentUrl, token, 'POST', '/dids/web/import', {
    did: options.did,
    didDocument: options.didDocument,
    ...(options.allowUnresolvedDocument === undefined
      ? {}
      : { allowUnresolvedDocument: options.allowUnresolvedDocument }),
    ...(options.replace === undefined ? {} : { replace: options.replace }),
    keys: [{ verificationMethodId: options.verificationMethodId, encryptedKey: { sessionId: session.sessionId, jwe } }],
  })
  return { ...result, session, jwe }
}

export async function createTenant(agentUrl: string, baseToken: string, label: string): Promise<TenantCredentials> {
  const result = await agentCall<TenantCredentials & ErrorResult>(
    agentUrl,
    baseToken,
    'POST',
    '/multi-tenancy/create-tenant',
    {
      config: { label },
    },
  )
  if (result.status !== 200 || !result.body.token) {
    throw new Error(`Could not create tenant ${label}: ${result.status} ${JSON.stringify(result.body)}`)
  }
  return result.body
}

export function deleteTenant(agentUrl: string, baseToken: string, tenantId: string): Promise<AgentCallResult<unknown>> {
  return agentCall<unknown>(agentUrl, baseToken, 'DELETE', `/multi-tenancy/${tenantId}`)
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Encodes the raw public key bytes the same way Credo writes `publicKeyBase58`. */
export function base58Encode(buffer: Buffer): string {
  let value = BigInt(`0x${buffer.toString('hex')}`)
  let encoded = ''
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded
    value /= 58n
  }
  for (const byte of buffer) {
    if (byte !== 0) break
    encoded = `1${encoded}`
  }
  return encoded
}
