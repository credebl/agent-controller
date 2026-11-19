import { VerificationSessionsService } from '../src/controllers/openid4vc/verifier-sessions/verification-sessions.service'
import { verifyBitstringStatus } from '../src/utils/bitstringStatusVerifier'

jest.mock('@credo-ts/core', () => ({
  JsonTransformer: {},
  Mdoc: class Mdoc {},
  MdocDeviceResponse: class MdocDeviceResponse {},
  TypedArrayEncoder: {},
  W3cJsonLdVerifiablePresentation: class W3cJsonLdVerifiablePresentation {},
  W3cJwtVerifiablePresentation: class W3cJwtVerifiablePresentation {},
  X509Service: class X509Service {},
}))

jest.mock('@credo-ts/openid4vc', () => ({
  OpenId4VcJwtIssuerDid: class OpenId4VcJwtIssuerDid {},
  OpenId4VcVerificationSessionState: {},
}))

jest.mock('tsyringe', () => ({
  injectable: () => (target: unknown) => target,
}))

jest.mock('../src/utils/bitstringStatusVerifier', () => ({
  verifyBitstringStatus: jest.fn(),
}))

const verifyMock = verifyBitstringStatus as jest.Mock
const service = new VerificationSessionsService()

function requestReturning(result: unknown) {
  return {
    agent: {
      context: { contextCorrelationId: 'test' },
      modules: {
        openid4vc: {
          verifier: { verifyAuthorizationResponse: jest.fn(async () => result) },
        },
      },
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  verifyMock.mockImplementation(async (_context: unknown, credential: unknown) => {
    if (credential === 'revoked-jwt') {
      return { checked: true, revoked: true, verified: true, statusListIndex: 1 }
    }
    if (credential === 'unverifiable-jwt') {
      return { checked: true, revoked: false, verified: false, error: 'status list proof failed' }
    }
    return { checked: true, revoked: false, verified: true }
  })
})

describe('VerificationSessionsService.verifyAuthorizationResponse', () => {
  it('aggregates revocation checks across PEX and DCQL presentations', async () => {
    const result = {
      presentationExchange: {
        presentations: {
          proof1: [
            {
              verifiableCredential: [
                { '@context': ['https://www.w3.org/2018/credentials/v1'], credentialStatus: {} },
                { serializedJwt: 'revoked-jwt' },
                { toJson: () => ({ id: 'w3c-json' }) },
              ],
            },
          ],
        },
      },
      dcql: {
        presentations: {
          query1: [{ presentation: { verifiableCredential: 'unverifiable-jwt' } }],
        },
      },
    }
    const request = requestReturning(result)

    const response = await service.verifyAuthorizationResponse(request, {} as any)

    expect(verifyMock).toHaveBeenCalledTimes(4)
    expect(verifyMock.mock.calls.map((call) => call[1])).toEqual([
      { '@context': ['https://www.w3.org/2018/credentials/v1'], credentialStatus: {} },
      'revoked-jwt',
      { id: 'w3c-json' },
      'unverifiable-jwt',
    ])
    expect(response.revocation).toEqual({
      checked: true,
      revoked: true,
      verified: false,
      presentations: [
        {
          presentationIndex: 0,
          credentials: [
            { credentialIndex: 0, checked: true, revoked: false, verified: true },
            { credentialIndex: 1, checked: true, revoked: true, verified: true, statusListIndex: 1 },
            { credentialIndex: 2, checked: true, revoked: false, verified: true },
          ],
        },
        {
          presentationIndex: 1,
          credentials: [
            {
              credentialIndex: 0,
              checked: true,
              revoked: false,
              verified: false,
              error: 'status list proof failed',
            },
          ],
        },
      ],
    })
  })

  it('returns an empty aggregate when no presentation contains credentials', async () => {
    const request = requestReturning({})

    const response = await service.verifyAuthorizationResponse(request, {} as any)

    expect(verifyMock).not.toHaveBeenCalled()
    expect(response.revocation).toEqual({
      checked: false,
      revoked: false,
      verified: true,
      presentations: [],
    })
  })

  it('reads encoded credentials and ignores empty presentation values', async () => {
    const result = {
      dcql: {
        presentations: {
          query1: [
            { verifiableCredential: null },
            { presentation: { verifiableCredential: { encoded: 'encoded-mdoc' } } },
          ],
        },
      },
    }
    const request = requestReturning(result)

    await service.verifyAuthorizationResponse(request, {} as any)

    expect(verifyMock).toHaveBeenCalledTimes(1)
    expect(verifyMock).toHaveBeenCalledWith(request.agent.context, 'encoded-mdoc')
  })
})
