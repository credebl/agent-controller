import { CredentialController } from '../src/controllers/didcomm/credentials/CredentialController'
import { checkAndCreateBitstringStatusList, revokeBitstringInStatusList } from '../src/utils/statusListService'

jest.mock('@credo-ts/core', () => ({
  W3cCredentialService: class W3cCredentialService {},
  createPeerDidDocumentFromServices: jest.fn(),
  PeerDidNumAlgo: { MultipleInceptionKeyWithoutDoc: 2 },
}))

jest.mock('@credo-ts/didcomm', () => ({
  DidCommCredentialState: {},
  DidCommCredentialRole: {},
}))

jest.mock('../src/errorHandlingService', () => ({
  __esModule: true,
  default: { handle: jest.fn((error: unknown) => error) },
}))

jest.mock('../src/controllers/didcomm/outofband/OutOfBandController', () => ({
  OutOfBandController: class OutOfBandController {},
}))

jest.mock('../src/purge/decorators/SchedulePurge', () => ({
  SchedulePurge: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}))

jest.mock('../src/utils/statusListService', () => ({
  checkAndCreateBitstringStatusList: jest.fn(async () => undefined),
  revokeBitstringInStatusList: jest.fn(async () => undefined),
}))

const ISSUER_DID = 'did:web:issuer.example'
const createMock = checkAndCreateBitstringStatusList as jest.Mock
const revokeMock = revokeBitstringInStatusList as jest.Mock

const agent = { context: { contextCorrelationId: 'test' } } as any
const controller = new CredentialController({} as any)

function statusCredential(listId: string, issuer: unknown = ISSUER_DID) {
  return {
    issuer,
    credentialStatus: {
      type: 'BitstringStatusListEntry',
      statusListCredential: `https://status.example.com/status-lists/${listId}`,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CredentialController.ensureBitstringStatusLists', () => {
  it('creates lists for nested and deduplicated bitstring status entries', async () => {
    const shared = statusCredential('list-1')
    const formats = {
      w3c: [shared, shared, { issuer: { id: ISSUER_DID }, nested: [statusCredential('list-2')] }],
      other: [{ credentialStatus: { statusListCredential: 'not-a-url' }, issuer: ISSUER_DID }],
    }

    await (controller as any).ensureBitstringStatusLists(agent, formats)

    expect(createMock).toHaveBeenCalledTimes(3)
    expect(createMock).toHaveBeenCalledWith(agent, 'list-1', ISSUER_DID)
    expect(createMock).toHaveBeenCalledWith(agent, 'list-2', ISSUER_DID)
    expect(createMock).toHaveBeenCalledWith(agent, 'not-a-url', ISSUER_DID)
  })

  it('handles circular references without revisiting nodes', async () => {
    const node: any = statusCredential('list-1')
    node.self = node

    await (controller as any).ensureBitstringStatusLists(agent, [node, node])

    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no bitstring status entry is present', async () => {
    await (controller as any).ensureBitstringStatusLists(agent, {
      anoncreds: [{ issuer: ISSUER_DID, schemaId: 'schema:1' }],
    })

    expect(createMock).not.toHaveBeenCalled()
  })

  it('ignores status entries without an issuer DID', async () => {
    await (controller as any).ensureBitstringStatusLists(agent, [statusCredential('list-1', { id: 123 })])

    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('CredentialController.revokeBitstringCredential', () => {
  it('revokes the requested entry and returns its identity', async () => {
    await expect(
      controller.revokeBitstringCredential({ agent } as any, {
        listId: 'list-1',
        index: 4,
        issuerDid: ISSUER_DID,
      }),
    ).resolves.toEqual({ revoked: true, listId: 'list-1', index: 4 })

    expect(revokeMock).toHaveBeenCalledWith(agent, 'list-1', 4, ISSUER_DID)
  })
})
