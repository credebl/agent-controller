import type { JsonObject } from '@credo-ts/core'

import { BadRequestError } from '../src/errors/errors'
import { createEmptyBitstring, encodeBitstring, setBit } from '../src/utils/bitstring'
import { fetchWithTimeout } from '../src/utils/helpers'
import { checkAndCreateBitstringStatusList, revokeBitstringInStatusList } from '../src/utils/statusListService'
import { CREDENTIALS_V2_CONTEXT_URL } from '../src/vc-jsonld/constants'
import { signV2Credential } from '../src/vc-jsonld/signV2Credential'

jest.mock('@credo-ts/core', () => ({
  JwsService: class JwsService {},
  JwtPayload: class JwtPayload {
    public constructor(public readonly payload: unknown) {}
  },
}))

jest.mock('@sd-jwt/jwt-status-list', () => ({
  StatusList: jest.fn().mockImplementation((_statuses: number[], bits: number) => ({
    getBitsPerStatus: () => bits,
    compressStatusList: () => 'compressed-list',
    setStatus: jest.fn(),
  })),
  getListFromStatusListJWT: jest.fn(),
}))

jest.mock('../src/vc-jsonld/signV2Credential', () => ({
  signV2Credential: jest.fn(async (_agentContext: unknown, options: { credential: JsonObject }) => ({
    ...options.credential,
    proof: { type: 'Ed25519Signature2018' },
  })),
}))

jest.mock('../src/utils/helpers', () => ({
  fetchWithTimeout: jest.fn(),
  getAlgFromVerificationMethod: jest.fn(() => 'EdDSA'),
  getVerificationMethod: jest.fn(() => ({ id: 'did:web:issuer.example#key-1' })),
}))

jest.mock('../src/utils/constant', () => ({ STATUS_LISTS_PATH: 'status-lists' }))

const ISSUER = 'did:web:issuer.example'
const LIST_ID = 'list-1'
const LIST_URL = 'https://status.example.com/status-lists/list-1'
const ORIGINAL_ENV = { ...process.env }

const fetchMock = fetchWithTimeout as jest.Mock
const signV2Mock = signV2Credential as jest.Mock

function response(body: unknown, status = 200, etag?: string): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: etag ? { etag } : {},
  })
}

function listCredential(subjectOverrides: Record<string, unknown> = {}): JsonObject {
  const bits = createEmptyBitstring()
  if (subjectOverrides.revoked === true) {
    setBit(bits, 1, true)
  }
  const { revoked: _revoked, ...statusOverrides } = subjectOverrides

  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: LIST_URL,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: ISSUER,
    credentialSubject: {
      id: `${LIST_URL}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList: encodeBitstring(bits),
      ...statusOverrides,
    },
    proof: { type: 'Ed25519Signature2018' },
  }
}

function makeAgent() {
  return {
    context: { contextCorrelationId: 'test' },
    dependencyManager: {
      resolve: jest.fn(() => ({ createJwsCompact: jest.fn(async () => 'legacy.jwt') })),
    },
    dids: {
      resolve: jest.fn(async () => ({ didDocument: {} })),
      getCreatedDids: jest.fn(async () => [{ keys: [{ didDocumentRelativeKeyId: '#key-1', kmsKeyId: 'kms-1' }] }]),
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STATUS_LIST_SERVER_URL = 'https://status.example.com/'
  process.env.STATUS_LIST_API_KEY = 'test-key'
  process.env.STATUS_LIST_DEFAULT_SIZE = '131072'
})

afterAll(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('checkAndCreateBitstringStatusList', () => {
  const agent = makeAgent()

  it('creates and signs a list when the server returns 404', async () => {
    fetchMock.mockResolvedValueOnce(response('', 404)).mockResolvedValueOnce(response('', 201))

    await expect(checkAndCreateBitstringStatusList(agent, LIST_ID, ISSUER)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      LIST_URL,
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://status.example.com/status-lists',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(signV2Mock).toHaveBeenCalledWith(
      agent.context,
      expect.objectContaining({
        credential: expect.objectContaining({
          '@context': [CREDENTIALS_V2_CONTEXT_URL],
          id: LIST_URL,
          type: ['VerifiableCredential', 'BitstringStatusListCredential'],
          issuer: ISSUER,
        }),
        verificationMethod: 'did:web:issuer.example#key-1',
      }),
    )
  })

  it('tolerates a concurrent create returning 409', async () => {
    fetchMock.mockResolvedValueOnce(response('', 404)).mockResolvedValueOnce(response('', 409))

    await expect(checkAndCreateBitstringStatusList(agent, LIST_ID, ISSUER)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('leaves an existing list untouched', async () => {
    fetchMock.mockResolvedValueOnce(response(listCredential()))

    await checkAndCreateBitstringStatusList(agent, LIST_ID, ISSUER)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signV2Mock).not.toHaveBeenCalled()
  })
})

describe('revokeBitstringInStatusList', () => {
  const agent = makeAgent()

  it('rejects a malformed encodedList without calling the signing API', async () => {
    fetchMock.mockResolvedValueOnce(response(listCredential({ encodedList: 'not-a-bitstring', revoked: true })))

    const revocation = revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER)
    await expect(revocation).rejects.toBeInstanceOf(BadRequestError)
    await expect(revocation).rejects.toThrow(/invalid encodedList/)
    expect(signV2Mock).not.toHaveBeenCalled()
  })

  it('rejects status lists whose statusSize is not 1', async () => {
    fetchMock.mockResolvedValueOnce(response(listCredential({ statusSize: 2, revoked: true })))

    await expect(revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER)).rejects.toThrow(/only statusSize 1/)
    expect(signV2Mock).not.toHaveBeenCalled()
  })

  it('retries a 412 patch with If-Match until it succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response(listCredential(), 200, '"v1"'))
      .mockResolvedValueOnce(response('conflict', 412))
      .mockResolvedValueOnce(response(listCredential(), 200, '"v2"'))
      .mockResolvedValueOnce(response('', 200))

    await revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1][1].headers).toEqual(expect.objectContaining({ 'If-Match': '"v1"' }))
    expect(signV2Mock).toHaveBeenCalledTimes(2)
  })

  it('stops after the maximum number of conflict retries', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fetchMock
        .mockResolvedValueOnce(response(listCredential(), 200, `"v${attempt}"`))
        .mockResolvedValueOnce(response('conflict', 412))
    }

    await expect(revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER)).rejects.toThrow(/after 5 attempts/)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('propagates non-412 patch failures immediately', async () => {
    fetchMock
      .mockResolvedValueOnce(response(listCredential(), 200, '"v1"'))
      .mockResolvedValueOnce(response('server error', 500))

    await expect(revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER)).rejects.toThrow(
      /Failed to update bitstring status list on server: 500 server error/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent updates to the same list', async () => {
    fetchMock.mockImplementation(async (_uri: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') {
        return response('', 200)
      }
      return response(listCredential(), 200, '"v1"')
    })

    await Promise.all([
      revokeBitstringInStatusList(agent, LIST_ID, 1, ISSUER),
      revokeBitstringInStatusList(agent, LIST_ID, 2, ISSUER),
    ])

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? 'GET')).toEqual([
      'GET',
      'PATCH',
      'GET',
      'PATCH',
    ])
  })
})
