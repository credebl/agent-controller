import type { JsonWebKey } from 'node:crypto'

import { encryptKeyImportEnvelope, KeyImportEnvelopeError, MAX_KEY_IMPORT_JWE_LENGTH } from '../jwe'
import {
  agentBindingFor,
  consumeImportSession,
  createImportSession,
  KeyImportSessionError,
  resetImportSessions,
  type KeyImportSessionDescriptor,
} from '../session'

const MATERIAL = JSON.stringify({ privateKey: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----' })

function envelopeFor(session: KeyImportSessionDescriptor, plaintext = MATERIAL): string {
  return encryptKeyImportEnvelope(session.publicKeyJwk as JsonWebKey, Buffer.from(plaintext), session.protectedHeader)
}

describe('key import envelope', () => {
  beforeEach(() => resetImportSessions())

  it('decrypts material for the agent and method that created the session', async () => {
    const session = await createImportSession('key', 'tenant-1')

    expect(
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: envelopeFor(session),
        agentBinding: 'tenant-1',
        method: 'key',
      }),
    ).toEqual({ privateKey: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----' })
  })

  it('accepts a private JWK and an optional passphrase', async () => {
    const session = await createImportSession('web', 'tenant-1')
    const payload = JSON.stringify({
      privateKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
      passphrase: 'correct horse',
    })

    expect(
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: envelopeFor(session, payload),
        agentBinding: 'tenant-1',
        method: 'web',
      }),
    ).toEqual({ privateKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' }, passphrase: 'correct horse' })
  })

  it('creates sessions for did:polygon keys', async () => {
    const session = await createImportSession('polygon', 'tenant-1')
    const payload = JSON.stringify({ privateKey: 'ab'.repeat(32) })

    expect(session.protectedHeader.method).toBe('polygon')
    expect(
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: envelopeFor(session, payload),
        agentBinding: 'tenant-1',
        method: 'polygon',
      }),
    ).toEqual({ privateKey: 'ab'.repeat(32) })
  })

  it('binds the envelope to the DID method', async () => {
    const session = await createImportSession('key', 'tenant-1')
    const jwe = envelopeFor(session)

    expect(() =>
      consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'web' }),
    ).toThrow(KeyImportSessionError)
  })

  it('binds the envelope to the agent', async () => {
    const session = await createImportSession('key', 'tenant-1')
    const jwe = envelopeFor(session)

    expect(() =>
      consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-2', method: 'key' }),
    ).toThrow(KeyImportSessionError)
  })

  it('is single use', async () => {
    const session = await createImportSession('key', 'tenant-1')
    const jwe = envelopeFor(session)

    consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'key' })
    expect(() =>
      consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'key' }),
    ).toThrow(KeyImportSessionError)
  })

  it('rejects an expired session', async () => {
    const session = await createImportSession('key', 'tenant-1', 0)
    const jwe = envelopeFor(session)

    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe,
        agentBinding: 'tenant-1',
        method: 'key',
        now: Date.now(),
      }),
    ).toThrow(KeyImportSessionError)
  })

  it('rejects tampering with the authenticated header', async () => {
    const session = await createImportSession('key', 'tenant-1')
    const segments = envelopeFor(session).split('.')
    const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'))
    segments[0] = Buffer.from(JSON.stringify({ ...header, method: 'web' }), 'utf8').toString('base64url')

    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: segments.join('.'),
        agentBinding: 'tenant-1',
        method: 'key',
      }),
    ).toThrow(KeyImportEnvelopeError)
  })

  it('rejects a payload with both key formats', async () => {
    const session = await createImportSession('key', 'tenant-1')
    const payload = JSON.stringify({ privateKey: 'pem', privateKeyJwk: { kty: 'OKP' } })

    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: envelopeFor(session, payload),
        agentBinding: 'tenant-1',
        method: 'key',
      }),
    ).toThrow(KeyImportSessionError)
  })

  it('rejects an oversized envelope before parsing it', async () => {
    const session = await createImportSession('key', 'tenant-1')

    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: 'a'.repeat(MAX_KEY_IMPORT_JWE_LENGTH + 1),
        agentBinding: 'tenant-1',
        method: 'key',
      }),
    ).toThrow(KeyImportEnvelopeError)
  })

  it('derives the agent binding from a tenant agent context', () => {
    expect(agentBindingFor({ context: { contextCorrelationId: 'tenant-abc' } })).toBe('tenant-abc')
    expect(agentBindingFor({})).toBe('dedicated')
  })
})
