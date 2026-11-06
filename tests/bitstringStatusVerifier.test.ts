import type { AgentContext, JsonObject } from '@credo-ts/core'

import {
  createEmptyBitstring,
  encodeBitstring,
  setBit,
} from '../src/utils/bitstring'
import { verifyBitstringStatus } from '../src/utils/bitstringStatusVerifier'

const ISSUER = 'did:key:z6Mkissuer'
const LIST_URL = 'https://status.example.com/status-lists/1'
const agentContext = {} as AgentContext

function makeList(overrides: Partial<JsonObject> = {}, subjectOverrides: Record<string, unknown> = {}): JsonObject {
  const bits = createEmptyBitstring()
  if (subjectOverrides.revoked === true) {
    setBit(bits, 1, true)
  }

  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: ISSUER,
    credentialSubject: {
      id: `${ISSUER}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList: encodeBitstring(bits),
      ...subjectOverrides,
    },
    proof: { type: 'Ed25519Signature2018' },
    ...overrides,
  }
}

function makeCredential(status: Record<string, unknown> | null = {}): JsonObject {
  const credentialStatus =
    status === null
      ? undefined
      : {
          id: `${LIST_URL}#1`,
          type: 'BitstringStatusListEntry',
          statusPurpose: 'revocation',
          statusListIndex: '1',
          statusListCredential: LIST_URL,
          ...status,
        }

  return {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: ISSUER,
    credentialSubject: { id: 'did:key:z6Mkholder' },
    ...(credentialStatus ? { credentialStatus } : {}),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/ld+json' },
  })
}

function defaultOptions(overrides: Record<string, unknown> = {}) {
  return {
    allowedOrigins: ['https://status.example.com'],
    verifyListCredential: jest.fn(async () => ({ isValid: true })),
    ...overrides,
  }
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.signature`
}

describe('verifyBitstringStatus', () => {
  it('returns unchecked when the credential has no status entry', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(null), defaultOptions())

    expect(result).toEqual({ checked: false, revoked: false, verified: true })
  })

  it('returns unchecked for non-bitstring status types', async () => {
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ type: 'RevocationList2020Status' }),
      defaultOptions(),
    )

    expect(result.checked).toBe(false)
    expect(result.verified).toBe(true)
  })

  it('verifies an unrevoked bitstring entry', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(makeList()))
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      LIST_URL,
      expect.objectContaining({ headers: expect.objectContaining({ accept: expect.any(String) }) }),
    )
    expect(result).toMatchObject({
      checked: true,
      revoked: false,
      verified: true,
      statusListIndex: 1,
      statusPurpose: 'revocation',
      statusListUri: LIST_URL,
    })
  })

  it('reports a revoked entry', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl: jest.fn(async () => jsonResponse(makeList({}, { revoked: true }))),
    })

    expect(result.revoked).toBe(true)
    expect(result.verified).toBe(true)
  })

  it('handles VCDM 1.0 JWT credentials with a vc claim', async () => {
    const credential = makeCredential()
    const result = await verifyBitstringStatus(
      agentContext,
      makeJwt({ iss: ISSUER, vc: credential }),
      {
        ...defaultOptions(),
        fetchImpl: jest.fn(async () => jsonResponse(makeList({}, { revoked: true }))),
      },
    )

    expect(result).toMatchObject({ checked: true, revoked: true, verified: true })
  })

  it('handles VCDM 2.0 JWT credentials with top-level claims', async () => {
    const credential = makeCredential()
    const result = await verifyBitstringStatus(agentContext, makeJwt(credential), {
      ...defaultOptions(),
      fetchImpl: jest.fn(async () => jsonResponse(makeList())),
    })

    expect(result).toMatchObject({ checked: true, revoked: false, verified: true })
  })

  it('rejects non-revocation purposes', async () => {
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ statusPurpose: 'suspension' }),
      defaultOptions(),
    )

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/statusPurpose/)
  })

  it('rejects invalid indexes', async () => {
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ statusListIndex: '-1' }),
      defaultOptions(),
    )

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/statusListIndex/)
  })

  it('rejects relative status list URLs', async () => {
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ statusListCredential: '/status-lists/1' }),
      defaultOptions(),
    )

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/absolute URL/)
  })

  it('rejects origins outside the allowlist before fetching', async () => {
    const fetchImpl = jest.fn()
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ statusListCredential: 'https://attacker.example/status-lists/1' }),
      { ...defaultOptions(), fetchImpl },
    )

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/not allowed/)
  })

  it('fails closed when no origins are configured', async () => {
    const previous = { url: process.env.STATUS_LIST_SERVER_URL, origins: process.env.STATUS_LIST_ALLOWED_ORIGINS }
    delete process.env.STATUS_LIST_SERVER_URL
    delete process.env.STATUS_LIST_ALLOWED_ORIGINS

    try {
      const result = await verifyBitstringStatus(agentContext, makeCredential(), {
        verifyListCredential: async () => ({ isValid: true }),
      })
      expect(result.verified).toBe(false)
      expect(result.error).toMatch(/No status list server origins/)
    } finally {
      if (previous.url) process.env.STATUS_LIST_SERVER_URL = previous.url
      if (previous.origins) process.env.STATUS_LIST_ALLOWED_ORIGINS = previous.origins
    }
  })

  it('rejects a status list issued by a different issuer', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl: jest.fn(async () => jsonResponse(makeList({ issuer: 'did:key:z6Mkother' }))),
    })

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/issuer does not match/)
  })

  it('rejects a status list with the wrong purpose', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl: jest.fn(async () => jsonResponse(makeList({}, { statusPurpose: 'suspension' }))),
    })

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/purpose/)
  })

  it('rejects a status list with an invalid proof', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      verifyListCredential: async () => ({ isValid: false, error: new Error('bad signature') }),
      fetchImpl: jest.fn(async () => jsonResponse(makeList())),
    })

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/proof verification failed/)
  })

  it('rejects indexes outside the list', async () => {
    const result = await verifyBitstringStatus(
      agentContext,
      makeCredential({ statusListIndex: String(131072) }),
      {
        ...defaultOptions(),
        fetchImpl: jest.fn(async () => jsonResponse(makeList())),
      },
    )

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/outside the status list/)
  })

  it('rejects malformed status list responses', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl: jest.fn(
        async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    })

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/not valid JSON/)
  })

  it('rejects non-2xx status list responses', async () => {
    const result = await verifyBitstringStatus(agentContext, makeCredential(), {
      ...defaultOptions(),
      fetchImpl: jest.fn(async () => jsonResponse({}, 500)),
    })

    expect(result.verified).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
  })
})
