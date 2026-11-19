import { JsonTransformer, Jwt, W3cJsonLdVerifiableCredential } from '@credo-ts/core'

import { AgentController } from '../src/controllers/agent/AgentController'
import { verifyBitstringStatus } from '../src/utils/bitstringStatusVerifier'
import { CREDENTIALS_V2_CONTEXT_URL } from '../src/vc-jsonld/constants'
import { verifyV2Credential } from '../src/vc-jsonld/verifyV2Credential'

jest.mock('@credo-ts/core', () => ({
  JsonTransformer: { fromJSON: jest.fn((value: unknown) => value) },
  W3cJsonLdVerifiableCredential: class W3cJsonLdVerifiableCredential {},
  TypedArrayEncoder: { toBase58: jest.fn() },
  ClaimFormat: {},
  W3cCredentialRecord: class W3cCredentialRecord {},
  DidDocument: class DidDocument {},
  Jwt: { fromSerializedJwt: jest.fn() },
  verkeyToPublicJwk: jest.fn(),
  getKmsKeyIdForVerifiacationMethod: jest.fn(),
  getPublicJwkFromVerificationMethod: jest.fn(() => ({ publicKey: { kty: 'OKP' } })),
}))

jest.mock('../src/utils/constant', () => ({ ALGORITHM_MAP: {}, STATUS_LISTS_PATH: 'status-lists' }))

jest.mock('../src/errorHandlingService', () => ({
  __esModule: true,
  default: { handle: jest.fn((error: unknown) => error) },
}))

jest.mock('../src/utils/bitstringStatusVerifier', () => ({
  verifyBitstringStatus: jest.fn(),
}))

jest.mock('../src/vc-jsonld/verifyV2Credential', () => ({
  verifyV2Credential: jest.fn(),
}))

const V1_CREDENTIAL = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential'],
  issuer: 'did:web:issuer.example',
  credentialSubject: { id: 'did:web:holder.example' },
}
const V2_CREDENTIAL = { ...V1_CREDENTIAL, '@context': [CREDENTIALS_V2_CONTEXT_URL] }
const BITSTRING_CREDENTIAL = {
  ...V1_CREDENTIAL,
  credentialStatus: {
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '1',
    statusListCredential: 'https://status.example.com/status-lists/1',
  },
}
const STATUS_OK = {
  checked: true,
  revoked: false,
  verified: true,
  statusListUri: 'https://status.example.com/status-lists/1',
  statusListIndex: 1,
  statusPurpose: 'revocation',
}

const verifyBitstringMock = verifyBitstringStatus as jest.Mock
const verifyV2Mock = verifyV2Credential as jest.Mock
const fromSerializedJwtMock = Jwt.fromSerializedJwt as jest.Mock

function makeRequest() {
  return {
    agent: {
      context: { contextCorrelationId: 'test' },
      config: { logger: { info: jest.fn() } },
      w3cCredentials: { verifyCredential: jest.fn(async () => ({ isValid: true, verifier: 'v1' })) },
      w3cV2Credentials: { verifyCredential: jest.fn(async () => ({ isValid: true, verifier: 'v2' })) },
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  verifyBitstringMock.mockResolvedValue(STATUS_OK)
  verifyV2Mock.mockResolvedValue({ isValid: true, verifier: 'v2-direct' })
})

describe('AgentController.verifyCredential', () => {
  const controller = new AgentController()

  it('verifies a VCDM 1.1 JSON credential with the Credo v1 API', async () => {
    const request = makeRequest()

    const result = await controller.verifyCredential(request, {
      credential: V1_CREDENTIAL,
      trustedIssuers: [{ method: 'did', issuance: 'did:web:issuer.example' }],
    })

    expect(JsonTransformer.fromJSON).toHaveBeenCalledWith(V1_CREDENTIAL, W3cJsonLdVerifiableCredential)
    expect(request.agent.w3cCredentials.verifyCredential).toHaveBeenCalledWith({
      credential: V1_CREDENTIAL,
      trustedIssuers: [{ method: 'did', issuance: 'did:web:issuer.example' }],
    })
    expect(request.agent.w3cV2Credentials.verifyCredential).not.toHaveBeenCalled()
    expect(verifyBitstringMock).toHaveBeenCalledWith(request.agent.context, V1_CREDENTIAL)
    expect(result).toEqual({ isValid: true, verified: true, verifier: 'v1', revocation: STATUS_OK })
  })

  it('disables Credo status verification for bitstring entries before checking them explicitly', async () => {
    const request = makeRequest()

    await controller.verifyCredential(request, { credential: BITSTRING_CREDENTIAL })

    expect(request.agent.w3cCredentials.verifyCredential).toHaveBeenCalledWith({
      credential: BITSTRING_CREDENTIAL,
      verifyCredentialStatus: false,
    })
    expect(verifyBitstringMock).toHaveBeenCalledWith(request.agent.context, BITSTRING_CREDENTIAL)
  })

  it('disables Credo status verification for array-valued bitstring entries', async () => {
    const request = makeRequest()
    const credential = {
      ...V1_CREDENTIAL,
      credentialStatus: [{ type: 'Other' }, BITSTRING_CREDENTIAL.credentialStatus],
    }

    await controller.verifyCredential(request, { credential })

    expect(request.agent.w3cCredentials.verifyCredential).toHaveBeenCalledWith({
      credential,
      verifyCredentialStatus: false,
    })
  })

  it('leaves Credo status verification enabled for other status mechanisms', async () => {
    const request = makeRequest()
    const credential = {
      ...V1_CREDENTIAL,
      credentialStatus: { type: 'StatusList2021Entry' },
    }

    await controller.verifyCredential(request, { credential })

    expect(request.agent.w3cCredentials.verifyCredential).toHaveBeenCalledWith({ credential })
  })

  it('verifies a VCDM 2.0 JSON credential with the V2 helper', async () => {
    const request = makeRequest()

    const result = await controller.verifyCredential(request, { credential: V2_CREDENTIAL })

    expect(verifyV2Mock).toHaveBeenCalledWith(request.agent.context, { credential: V2_CREDENTIAL })
    expect(request.agent.w3cCredentials.verifyCredential).not.toHaveBeenCalled()
    expect(result).toEqual({ isValid: true, verified: true, verifier: 'v2-direct', revocation: STATUS_OK })
  })

  it('detects a VCDM 2.0 compact JWT from its payload context', async () => {
    fromSerializedJwtMock.mockReturnValue({
      payload: { additionalClaims: { vc: { '@context': [CREDENTIALS_V2_CONTEXT_URL] } } },
    })
    const request = makeRequest()

    await controller.verifyCredential(request, { credential: 'header.payload.signature' })

    expect(fromSerializedJwtMock).toHaveBeenCalledWith('header.payload.signature')
    expect(request.agent.w3cV2Credentials.verifyCredential).toHaveBeenCalledWith({
      credential: 'header.payload.signature',
    })
  })

  it('falls back to the v1 API when a compact JWT cannot be parsed', async () => {
    fromSerializedJwtMock.mockImplementation(() => {
      throw new Error('not a JWT')
    })
    const request = makeRequest()

    await controller.verifyCredential(request, { credential: 'opaque-credential' })

    expect(request.agent.w3cCredentials.verifyCredential).toHaveBeenCalledWith({ credential: 'opaque-credential' })
  })

  it('marks a cryptographically valid but revoked credential as invalid', async () => {
    const revokedStatus = { ...STATUS_OK, revoked: true }
    verifyBitstringMock.mockResolvedValue(revokedStatus)
    const request = makeRequest()

    const result = await controller.verifyCredential(request, { credential: V1_CREDENTIAL })

    expect(result).toEqual({ isValid: false, verified: false, verifier: 'v1', revocation: revokedStatus })
  })

  it('marks a credential invalid when revocation verification fails', async () => {
    const failedStatus = { ...STATUS_OK, verified: false, error: 'status list proof failed' }
    verifyBitstringMock.mockResolvedValue(failedStatus)
    const request = makeRequest()

    const result = await controller.verifyCredential(request, { credential: V1_CREDENTIAL })

    expect(result.isValid).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.revocation).toEqual(failedStatus)
  })
})
