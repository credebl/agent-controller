import type { JsonWebKey, KeyObject } from 'node:crypto'

import { randomBytes } from 'node:crypto'

import {
  createKeyImportKeyPair,
  decryptKeyImportEnvelope,
  KEY_IMPORT_JWE_ALG,
  KEY_IMPORT_JWE_ENC,
  MAX_KEY_IMPORT_PLAINTEXT_LENGTH,
  type KeyImportJweHeader,
} from './jwe'

/**
 * A key import session is the server side of the envelope flow. The client asks for one, encrypts the private key to
 * the returned public key, and posts the envelope back. Sessions are single use and expire quickly so a captured
 * envelope cannot be replayed.
 */
export type KeyImportMethod = 'key' | 'web' | 'x509' | 'polygon' | 'x509-certificate'

export const KEY_IMPORT_METHODS: readonly KeyImportMethod[] = ['key', 'web', 'x509', 'polygon', 'x509-certificate']

const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000
const MAX_ACTIVE_SESSIONS = 1_000
const MAX_FAILED_ATTEMPTS = 5
const MAX_PRIVATE_KEY_LENGTH = 20_000
const MAX_PASSPHRASE_LENGTH = 1_000

export interface KeyImportSessionDescriptor {
  sessionId: string
  kid: string
  method: KeyImportMethod
  expiresAt: string
  alg: typeof KEY_IMPORT_JWE_ALG
  enc: typeof KEY_IMPORT_JWE_ENC
  /** Public key the client encrypts the key material to. */
  publicKeyJwk: JsonWebKey
  /** Protected header the client must use. It binds the envelope to this session, method and expiry. */
  protectedHeader: KeyImportJweHeader
}

export interface KeyImportKeyMaterial {
  privateKey?: string
  privateKeyJwk?: Record<string, unknown>
  passphrase?: string
}

interface StoredImportSession {
  sessionId: string
  kid: string
  method: KeyImportMethod
  expiresAt: number
  agentBinding: string
  publicKeyJwk: JsonWebKey
  protectedHeader: KeyImportJweHeader
  privateKey: KeyObject
  used: boolean
  failedAttempts: number
}

/** Process local store. Sessions are short lived, so a replicated agent only needs affinity for the import request. */
const sessions = new Map<string, StoredImportSession>()

export class KeyImportSessionError extends Error {
  public constructor(message = 'The key import session is invalid or has expired. Request a new import session.') {
    super(message)
    this.name = 'KeyImportSessionError'
  }
}

export function isKeyImportMethod(value: unknown): value is KeyImportMethod {
  return typeof value === 'string' && (KEY_IMPORT_METHODS as readonly string[]).includes(value)
}

/**
 * Stable identity of the agent that owns a session. Tenant agents carry their tenant correlation id; a dedicated
 * agent has a single wallet, so the constant is enough to keep its sessions out of another agent's scope.
 */
export function agentBindingFor(agent: unknown): string {
  const context = (agent as { context?: { contextCorrelationId?: string } } | undefined)?.context
  return context?.contextCorrelationId || 'dedicated'
}

function sessionTtlMs(): number {
  const configured = Number(process.env.KEY_IMPORT_SESSION_TTL_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_MS
}

function pruneExpired(now: number): void {
  for (const [id, session] of sessions) {
    if (session.used || session.expiresAt <= now) sessions.delete(id)
  }
}

/**
 * Creates a session for a single DID method and agent. The agent binding stops an envelope from being replayed
 * against another tenant, and the method binding stops it from being used for a different DID type.
 */
export async function createImportSession(
  method: KeyImportMethod,
  agentBinding: string,
  now = Date.now(),
): Promise<KeyImportSessionDescriptor> {
  // Generate the key first: other sessions can be created while it runs, so the cap is applied after it.
  const { publicJwk, privateKey } = await createKeyImportKeyPair()

  pruneExpired(now)

  // Bound the number of live sessions so unauthenticated session creation cannot exhaust memory.
  while (sessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined
    if (!oldest) break
    sessions.delete(oldest)
  }

  const sessionId = randomBytes(32).toString('base64url')
  const expiresAt = now + sessionTtlMs()

  const descriptor: KeyImportSessionDescriptor = {
    sessionId,
    kid: sessionId,
    method,
    expiresAt: new Date(expiresAt).toISOString(),
    alg: KEY_IMPORT_JWE_ALG,
    enc: KEY_IMPORT_JWE_ENC,
    publicKeyJwk: publicJwk,
    protectedHeader: {
      alg: KEY_IMPORT_JWE_ALG,
      enc: KEY_IMPORT_JWE_ENC,
      kid: sessionId,
      sid: sessionId,
      method,
      // JWT style expiry in seconds. The millisecond value above stays the source of truth for the store.
      exp: Math.floor(expiresAt / 1000),
    },
  }

  sessions.set(sessionId, {
    sessionId,
    kid: sessionId,
    method,
    expiresAt,
    agentBinding,
    publicKeyJwk: publicJwk,
    protectedHeader: descriptor.protectedHeader,
    privateKey,
    used: false,
    failedAttempts: 0,
  })
  return descriptor
}

function assertSessionUsable(
  session: StoredImportSession,
  options: { agentBinding: string; method: KeyImportMethod; now: number },
): void {
  if (session.used) throw new KeyImportSessionError()
  if (session.expiresAt <= options.now) throw new KeyImportSessionError()
  if (session.method !== options.method) throw new KeyImportSessionError()
  if (session.agentBinding !== options.agentBinding) throw new KeyImportSessionError()
}

function parseKeyMaterial(plaintext: Buffer): KeyImportKeyMaterial {
  let payload: unknown
  try {
    payload = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new KeyImportSessionError('The decrypted key payload is invalid')
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new KeyImportSessionError('The decrypted key payload is invalid')
  }

  const { privateKey, privateKeyJwk, passphrase } = payload as Record<string, unknown>

  if ((privateKey === undefined) === (privateKeyJwk === undefined)) {
    throw new KeyImportSessionError('The decrypted key payload must contain exactly one private key')
  }
  if (privateKey !== undefined && (typeof privateKey !== 'string' || privateKey.length > MAX_PRIVATE_KEY_LENGTH)) {
    throw new KeyImportSessionError('The decrypted key payload is invalid')
  }
  if (
    privateKeyJwk !== undefined &&
    (typeof privateKeyJwk !== 'object' ||
      privateKeyJwk === null ||
      Array.isArray(privateKeyJwk) ||
      JSON.stringify(privateKeyJwk).length > MAX_KEY_IMPORT_PLAINTEXT_LENGTH)
  ) {
    throw new KeyImportSessionError('The decrypted key payload is invalid')
  }
  if (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > MAX_PASSPHRASE_LENGTH)) {
    throw new KeyImportSessionError('The decrypted key payload is invalid')
  }

  return {
    ...(privateKey !== undefined ? { privateKey } : {}),
    ...(privateKeyJwk !== undefined ? { privateKeyJwk: privateKeyJwk as Record<string, unknown> } : {}),
    ...(passphrase !== undefined ? { passphrase } : {}),
  }
}

/**
 * Validates and consumes an envelope. The session is marked used before the key is imported, so two concurrent
 * requests cannot both import the same material.
 */
export function consumeImportSession(options: {
  sessionId: string
  jwe: string
  agentBinding: string
  method: KeyImportMethod
  now?: number
}): KeyImportKeyMaterial {
  const now = options.now ?? Date.now()
  const session = sessions.get(options.sessionId)
  if (!session) throw new KeyImportSessionError()

  assertSessionUsable(session, { agentBinding: options.agentBinding, method: options.method, now })

  let decrypted: { plaintext: Buffer; header: KeyImportJweHeader }
  try {
    decrypted = decryptKeyImportEnvelope(session.privateKey, options.jwe)
  } catch (error) {
    session.failedAttempts += 1
    if (session.failedAttempts >= MAX_FAILED_ATTEMPTS) sessions.delete(options.sessionId)
    throw error
  }

  // The protected header is authenticated data. It must describe this exact session and method.
  if (
    decrypted.header.sid !== session.sessionId ||
    decrypted.header.kid !== session.kid ||
    decrypted.header.method !== options.method ||
    decrypted.header.exp !== Math.floor(session.expiresAt / 1000)
  ) {
    sessions.delete(options.sessionId)
    throw new KeyImportSessionError()
  }

  session.used = true
  sessions.delete(options.sessionId)

  return parseKeyMaterial(decrypted.plaintext)
}

/** Exposed for tests. */
export function resetImportSessions(): void {
  sessions.clear()
}
