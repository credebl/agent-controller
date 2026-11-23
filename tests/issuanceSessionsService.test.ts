import { CredentialFormat, SignerMethod } from '../src/enums/enum'
import { issuanceSessionService } from '../src/controllers/openid4vc/issuance-sessions/issuance-sessions.service'
import {
  checkAndCreateBitstringStatusList,
  checkAndCreateStatusList,
  revokeBitstringInStatusList,
  revokeCredentialInStatusList,
} from '../src/utils/statusListService'

jest.mock('@credo-ts/openid4vc', () => ({
  OpenId4VcIssuanceSessionRepository: class OpenId4VcIssuanceSessionRepository {},
}))

jest.mock('../src/utils/constant', () => ({ STATUS_LISTS_PATH: 'status-lists' }))

jest.mock('../src/utils/statusListService', () => ({
  checkAndCreateBitstringStatusList: jest.fn(async () => undefined),
  checkAndCreateStatusList: jest.fn(async () => undefined),
  getServerUrl: jest.fn(() => 'https://status.example.com'),
  revokeBitstringInStatusList: jest.fn(async () => undefined),
  revokeCredentialInStatusList: jest.fn(async () => undefined),
}))

const ISSUER_DID = 'did:web:issuer.example'
const ORIGINAL_ENV = { ...process.env }

const repository = {
  findById: jest.fn(),
  findByQuery: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
}

const createBitstringMock = checkAndCreateBitstringStatusList as jest.Mock
const createStatusMock = checkAndCreateStatusList as jest.Mock
const revokeBitstringMock = revokeBitstringInStatusList as jest.Mock
const revokeStatusMock = revokeCredentialInStatusList as jest.Mock

function makeRequest() {
  const issuer = {
    credentialConfigurationsSupported: {
      'ldp-credential': { format: CredentialFormat.LdpVc, vct: 'degree' },
      'sdjwt-credential': { format: CredentialFormat.VcSdJwt, vct: 'identity' },
      'mdoc-credential': { format: 'mso_mdoc' },
    },
  }
  const offerResult = { credentialOffer: { offer: true }, issuanceSession: { id: 'session-1' } }

  return {
    agent: {
      context: { contextCorrelationId: 'test' },
      modules: {
        openid4vc: {
          issuer: {
            getIssuerByIssuerId: jest.fn(async () => issuer),
            createCredentialOffer: jest.fn(async () => offerResult),
          },
        },
      },
      dependencyManager: { resolve: jest.fn(() => repository) },
    },
  } as any
}

function statusListDetails() {
  return { listId: 'list-1', index: 7, listSize: 131072 }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STATUS_LIST_SERVER_URL = 'https://status.example.com'
})

afterAll(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('IssuanceSessionsService.createCredentialOffer', () => {
  it('uses a bitstring status entry and records the mechanism for JSON-LD credentials', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: true,
      version: 'v2.0',
      credentials: [
        {
          credentialSupportedId: 'ldp-credential',
          format: CredentialFormat.LdpVc,
          payload: {
            '@context': 'https://www.w3.org/2018/credentials/v1',
            credentialSubject: { id: 'did:web:holder.example' },
            issuanceDate: '2024-01-01T00:00:00Z',
          },
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
          statusListDetails: statusListDetails(),
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createBitstringMock).toHaveBeenCalledWith(request.agent, 'list-1', ISSUER_DID, 131072)
    expect(createStatusMock).not.toHaveBeenCalled()
    expect(options.issuanceMetadata.StatusListInfo).toEqual([
      {
        credentialSupportedId: 'ldp-credential',
        listId: 'list-1',
        index: 7,
        issuerDid: ISSUER_DID,
        mechanism: 'bitstring',
      },
    ])
    expect(options.issuanceMetadata.credentials[0].payload.credentialStatus).toEqual({
      id: 'https://status.example.com/status-lists/list-1#7',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '7',
      statusListCredential: 'https://status.example.com/status-lists/list-1',
    })
    expect(options.issuanceMetadata.credentials[0].payload.status).toBeUndefined()
  })

  it('keeps the SD-JWT status_list block and legacy revoker for SD-JWT credentials', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: true,
      credentials: [
        {
          credentialSupportedId: 'sdjwt-credential',
          format: CredentialFormat.VcSdJwt,
          payload: {},
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
          statusListDetails: statusListDetails(),
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createStatusMock).toHaveBeenCalledWith(request.agent, 'list-1', ISSUER_DID, 131072)
    expect(createBitstringMock).not.toHaveBeenCalled()
    expect(options.issuanceMetadata.credentials[0].payload.status).toEqual({
      status_list: { uri: 'https://status.example.com/status-lists/list-1', idx: 7 },
    })
    expect(options.issuanceMetadata.StatusListInfo[0].mechanism).toBeUndefined()
  })

  it('uses the per-credential revocable flag when the offer flag is false', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: false,
      credentials: [
        {
          credentialSupportedId: 'sdjwt-credential',
          format: CredentialFormat.VcSdJwt,
          isRevocable: true,
          payload: {},
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
          statusListDetails: statusListDetails(),
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createStatusMock).toHaveBeenCalledWith(request.agent, 'list-1', ISSUER_DID, 131072)
    expect(options.issuanceMetadata.credentials[0].payload.status).toBeDefined()
  })

  it('does not add status for a credential explicitly marked non-revocable', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: true,
      credentials: [
        {
          credentialSupportedId: 'sdjwt-credential',
          format: CredentialFormat.VcSdJwt,
          isRevocable: false,
          payload: {},
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
          statusListDetails: statusListDetails(),
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createStatusMock).not.toHaveBeenCalled()
    expect(options.issuanceMetadata.credentials[0].payload.status).toBeUndefined()
    expect(options.issuanceMetadata.StatusListInfo).toBeUndefined()
  })

  it('falls back to the offer-level revocable flag when the credential flag is omitted', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: true,
      credentials: [
        {
          credentialSupportedId: 'sdjwt-credential',
          format: CredentialFormat.VcSdJwt,
          payload: {},
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
          statusListDetails: statusListDetails(),
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createStatusMock).toHaveBeenCalled()
    expect(options.issuanceMetadata.credentials[0].payload.status).toBeDefined()
  })

  it('skips status processing for a non-revocable mdoc even when the offer flag is true', async () => {
    const request = makeRequest()
    const options: any = {
      publicIssuerId: 'issuer-1',
      isRevocable: true,
      credentials: [
        {
          credentialSupportedId: 'mdoc-credential',
          format: 'mso_mdoc' as any,
          isRevocable: false,
          payload: { namespaces: {} },
          signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
        },
      ],
    }

    await issuanceSessionService.createCredentialOffer(options, request)

    expect(createStatusMock).not.toHaveBeenCalled()
    expect(createBitstringMock).not.toHaveBeenCalled()
    expect(options.issuanceMetadata.StatusListInfo).toBeUndefined()
  })
})

describe('IssuanceSessionsService.revokeBySessionId', () => {
  const request = makeRequest()

  it('dispatches each status entry by its stored mechanism', async () => {
    repository.findById.mockResolvedValueOnce({
      issuanceMetadata: {
        StatusListInfo: [
          { listId: 'bitstring-list', index: 1, issuerDid: ISSUER_DID, mechanism: 'bitstring' },
          { listId: 'sdjwt-list', index: 2, issuerDid: ISSUER_DID },
        ],
      },
    })

    await expect(issuanceSessionService.revokeBySessionId(request, 'session-1')).resolves.toEqual({
      message: 'Credentials in session revoked successfully',
    })

    expect(revokeBitstringMock).toHaveBeenCalledWith(request.agent, 'bitstring-list', 1, ISSUER_DID)
    expect(revokeStatusMock).toHaveBeenCalledWith(request.agent, 'sdjwt-list', 2, ISSUER_DID)
    expect(revokeBitstringMock.mock.invocationCallOrder[0]).toBeLessThan(revokeStatusMock.mock.invocationCallOrder[0])
  })
})
