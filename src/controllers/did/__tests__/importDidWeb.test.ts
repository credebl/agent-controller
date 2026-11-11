jest.mock('../../../errorHandlingService', () => ({
  __esModule: true,
  default: { handle: (error: unknown) => error },
}))

jest.mock('@credo-ts/askar', () => ({
  transformPrivateKeyToPrivateJwk: jest.fn(),
  transformSeedToPrivateJwk: jest.fn(),
}))

jest.mock('@sovio-id/credo-openbao-kms', () => ({
  OPENBAO_KEY_ID_PREFIX: 'ob_',
  openBaoKeyId: (keyId: string) => (keyId.startsWith('ob_') ? keyId : `ob_${keyId}`),
}))

jest.mock('../../../cliAgent', () => ({ RestMultiTenantAgentModules: {} }))

jest.mock('@credo-ts/core', () => require('./didWebTestMocks').credoCoreMock())

import type { DidDocument } from '@credo-ts/core'
import type { JsonWebKey } from 'node:crypto'

import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'

import { BadRequestError } from '../../../errors'
import { encryptKeyImportEnvelope } from '../../../utils/keyImport/jwe'
import { consumeImportSession, createImportSession, resetImportSessions } from '../../../utils/keyImport/session'
import { DidController } from '../DidController'
import { parseDidWebDocument } from '../didWebImport'

const DID = 'did:web:gov-agency.example.com'

const signingKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as {
  kty: string
  crv: string
  x: string
  d: string
}
const otherSigningKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as typeof signingKey
const ecKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }) as {
  kty: string
  crv: string
  x: string
  y: string
  d: string
}

const x25519Key = generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' })

function publicJwkOf(privateJwk: Record<string, unknown>): Record<string, unknown> {
  const key = createPrivateKey({ key: privateJwk as JsonWebKey, format: 'jwk' })
  return createPublicKey(key).export({ format: 'jwk' }) as Record<string, unknown>
}

const signingPublicJwk = publicJwkOf(signingKey)
const otherSigningPublicJwk = publicJwkOf(otherSigningKey)
const ecPublicJwk = publicJwkOf(ecKey)

/** The DID document a government authority would host for its did:web. */
function authorityDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
    id: DID,
    verificationMethod: [
      {
        id: `${DID}#authority-signing-key`,
        type: 'Ed25519VerificationKey2020',
        controller: DID,
        publicKeyJwk: signingPublicJwk,
      },
    ],
    authentication: [`${DID}#authority-signing-key`],
    assertionMethod: [`${DID}#authority-signing-key`],
    service: [{ id: `${DID}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: 'https://gov-agency.example.com' }],
    ...overrides,
  }
}

function mockDocument(raw: Record<string, unknown>): DidDocument {
  return parseDidWebDocument(raw, raw.id as string)
}

interface StoredDid {
  didDocument: DidDocument
  keys: Array<{ didDocumentRelativeKeyId: string; kmsKeyId: string }>
}

type AgentFixture = ReturnType<typeof createAgent>

function createAgent() {
  const keyStore = new Map<string, Record<string, unknown>>()
  const records: StoredDid[] = []
  let keyCounter = 0

  const kmsImportKey = jest.fn(async ({ privateJwk }: { privateJwk: Record<string, unknown> }) => {
    const keyId = `kms-key-${++keyCounter}`
    const publicJwk = publicJwkOf(privateJwk)
    keyStore.set(keyId, publicJwk)
    return { keyId, publicJwk }
  })
  const kmsGetPublicKey = jest.fn(async ({ keyId }: { keyId: string }) => keyStore.get(keyId))
  const didsImport = jest.fn(
    async ({ did, didDocument, keys }: { did: string; didDocument: DidDocument; keys: StoredDid['keys'] }) => {
      const existing = records.find((record) => record.didDocument.id === did)
      if (existing) {
        existing.didDocument = didDocument
        existing.keys = keys
        return
      }
      records.push({ didDocument, keys })
    },
  )
  const didsGetCreatedDids = jest.fn(async ({ did }: { did?: string } = {}) =>
    records.filter((record) => did === undefined || record.didDocument.id === did),
  )
  const didsResolve = jest.fn(async () => ({}))

  const agent = {
    context: { contextCorrelationId: 'tenant-1' },
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    kms: { importKey: kmsImportKey, getPublicKey: kmsGetPublicKey },
    dids: { import: didsImport, getCreatedDids: didsGetCreatedDids, resolve: didsResolve },
  }

  return { agent, keyStore, records, kmsImportKey, didsImport, didsResolve }
}

/** Adds a key to the agent's stored records without going through the endpoint, to model an earlier import. */
function preload(
  fixture: AgentFixture,
  document: Record<string, unknown>,
  bindings: Array<{ verificationMethodId: string; privateJwk: Record<string, unknown> }>,
): StoredDid {
  const record: StoredDid = { didDocument: mockDocument(document), keys: [] }
  bindings.forEach(({ verificationMethodId, privateJwk }, index) => {
    const keyId = `preloaded-key-${index}`
    fixture.keyStore.set(keyId, publicJwkOf(privateJwk))
    record.keys.push({
      didDocumentRelativeKeyId: verificationMethodId.slice(verificationMethodId.indexOf('#')),
      kmsKeyId: keyId,
    })
  })
  fixture.records.push(record)
  return record
}

describe('DidController.importDidWeb', () => {
  let controller: DidController

  beforeEach(() => {
    resetImportSessions()
    controller = new DidController()
  })

  async function encryptedKey(privateJwk: Record<string, unknown>, agentBinding = 'tenant-1') {
    const session = await createImportSession('web', agentBinding)
    const jwe = encryptKeyImportEnvelope(
      session.publicKeyJwk as JsonWebKey,
      Buffer.from(JSON.stringify({ privateKeyJwk: privateJwk })),
      session.protectedHeader,
    )
    return { session, encryptedKey: { sessionId: session.sessionId, jwe } }
  }

  it('stores the authority document verbatim and binds the key to its verification method id', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)
    const didDocument = authorityDocument()

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument,
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(result.did).toBe(DID)
    // The custom fragment and the authority's service survive, instead of a regenerated `#key-1` document.
    expect(result.didDocument).toMatchObject({
      '@context': didDocument['@context'],
      id: DID,
      verificationMethod: [{ id: `${DID}#authority-signing-key` }],
      authentication: [`${DID}#authority-signing-key`],
      service: didDocument.service,
    })
    expect(result.keys).toEqual([
      { verificationMethodId: `${DID}#authority-signing-key`, keyId: 'kms-key-1', backend: 'askar' },
    ])

    expect(fixture.didsImport).toHaveBeenCalledWith({
      did: DID,
      didDocument: expect.objectContaining({ id: DID }),
      keys: [{ didDocumentRelativeKeyId: '#authority-signing-key', kmsKeyId: 'kms-key-1' }],
      overwrite: true,
    })
    expect(fixture.kmsImportKey).toHaveBeenCalledWith({
      privateJwk: expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', d: signingKey.d }),
    })
  })

  it('accepts an absolute verification method id', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument: authorityDocument(),
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: `${DID}#authority-signing-key`, encryptedKey: key }],
    })

    expect(result.keys[0].verificationMethodId).toBe(`${DID}#authority-signing-key`)
  })

  it('resolves the published document when the caller does not supply one', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument()
    fixture.didsResolve.mockResolvedValue({ didDocument: mockDocument(didDocument) })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(fixture.didsResolve).toHaveBeenCalledWith(DID, { useLocalCreatedDidRecord: false })
    expect(result.didDocument).toMatchObject({ id: DID })
  })

  it('rejects a supplied document that differs from the published one', async () => {
    const fixture = createAgent()
    const published = authorityDocument({
      service: [{ id: `${DID}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: 'https://elsewhere.example.com' }],
    })
    fixture.didsResolve.mockResolvedValue({ didDocument: mockDocument(published) })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`didDocument does not match the document published for ${DID}`)
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    expect(fixture.didsImport).not.toHaveBeenCalled()
  })

  it('rejects an offline document unless allowUnresolvedDocument is set', async () => {
    const fixture = createAgent()
    fixture.didsResolve.mockRejectedValue(new Error('offline'))
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('Pass allowUnresolvedDocument:true')
  })

  it('reports a resolution failure when no document is supplied', async () => {
    const fixture = createAgent()
    fixture.didsResolve.mockResolvedValue({
      didDocument: undefined,
      didResolutionMetadata: { error: 'notFound', message: 'not found' },
    })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`Unable to resolve ${DID}: not found`)
  })

  it('rejects an unknown verification method id without consuming the import session', async () => {
    const fixture = createAgent()
    const { session, encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#missing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`Verification method "#missing-key" does not exist in didDocument`)

    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    // The caller can retry with the same envelope.
    expect(
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: key.jwe,
        agentBinding: 'tenant-1',
        method: 'web',
      }),
    ).toEqual({ privateKeyJwk: signingKey })
  })

  it('rejects a private key that does not match the published verification method', async () => {
    const fixture = createAgent()
    const { session, encryptedKey: key } = await encryptedKey(otherSigningKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`The private key does not match verification method "${DID}#authority-signing-key"`)

    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    expect(fixture.didsImport).not.toHaveBeenCalled()
    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: key.jwe,
        agentBinding: 'tenant-1',
        method: 'web',
      }),
    ).not.toThrow()
  })

  it('imports several keys and leaves public-only verification methods in the document', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument({
      verificationMethod: [
        {
          id: `${DID}#authority-signing-key`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyJwk: signingPublicJwk,
        },
        {
          id: `${DID}#assertion-key`,
          type: 'JsonWebKey2020',
          controller: DID,
          publicKeyJwk: ecPublicJwk,
        },
        {
          id: `${DID}#key-agreement-key`,
          type: 'X25519KeyAgreementKey2020',
          controller: DID,
          publicKeyJwk: x25519Key,
        },
      ],
      assertionMethod: [`${DID}#assertion-key`],
      keyAgreement: [`${DID}#key-agreement-key`],
    })

    const credentialKey = await encryptedKey(signingKey)
    const assertionKey = await encryptedKey(ecKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument,
      allowUnresolvedDocument: true,
      keys: [
        { verificationMethodId: '#authority-signing-key', encryptedKey: credentialKey.encryptedKey },
        { verificationMethodId: '#assertion-key', encryptedKey: assertionKey.encryptedKey },
      ],
    })

    expect(result.keys.map((key) => key.verificationMethodId)).toEqual([
      `${DID}#authority-signing-key`,
      `${DID}#assertion-key`,
    ])
    expect(fixture.didsImport).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [
          { didDocumentRelativeKeyId: '#authority-signing-key', kmsKeyId: 'kms-key-1' },
          { didDocumentRelativeKeyId: '#assertion-key', kmsKeyId: 'kms-key-2' },
        ],
      }),
    )
    // The X25519 key agreement method has no private key; it is still published in the stored document.
    expect(result.didDocument).toMatchObject({
      keyAgreement: [`${DID}#key-agreement-key`],
    })
  })

  it('rejects two keys that reuse the same import session', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument({
      verificationMethod: [
        {
          id: `${DID}#authority-signing-key`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyJwk: signingPublicJwk,
        },
        {
          id: `${DID}#assertion-key`,
          type: 'JsonWebKey2020',
          controller: DID,
          publicKeyJwk: ecPublicJwk,
        },
      ],
    })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument,
        allowUnresolvedDocument: true,
        keys: [
          { verificationMethodId: '#authority-signing-key', encryptedKey: key },
          { verificationMethodId: '#assertion-key', encryptedKey: key },
        ],
      }),
    ).rejects.toThrow('Each key needs its own import session')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('is idempotent when the same document and key binding are imported again', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument()
    preload(fixture, didDocument, [{ verificationMethodId: `${DID}#authority-signing-key`, privateJwk: signingKey }])
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument,
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(result.keys).toEqual([
      { verificationMethodId: `${DID}#authority-signing-key`, keyId: 'preloaded-key-0', backend: 'askar' },
    ])
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    expect(fixture.didsImport).not.toHaveBeenCalled()
  })

  it('refuses to rebind an existing DID unless replace is set', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument()
    preload(fixture, didDocument, [
      { verificationMethodId: `${DID}#authority-signing-key`, privateJwk: otherSigningKey },
    ])
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument,
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`Pass replace:true to rebind it`)
    expect(fixture.didsImport).not.toHaveBeenCalled()
  })

  it('rebinds an existing DID when replace is set', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument()
    preload(fixture, didDocument, [
      { verificationMethodId: `${DID}#authority-signing-key`, privateJwk: otherSigningKey },
    ])
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument,
      allowUnresolvedDocument: true,
      replace: true,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(result.keys[0].keyId).toBe('kms-key-1')
    expect(fixture.kmsImportKey).toHaveBeenCalled()
    expect(fixture.didsImport).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [{ didDocumentRelativeKeyId: '#authority-signing-key', kmsKeyId: 'kms-key-1' }],
      }),
    )
  })

  it('rejects an invalid did before consuming anything', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: 'did:key:z6Mkfake',
        keys: [],
      }),
    ).rejects.toThrow(BadRequestError)
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('requires at least one key', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [],
      }),
    ).rejects.toThrow('keys must contain at least one verification method key')
  })
})

describe('DidController.writeDid for did:web', () => {
  it('rejects a supplied didDocument instead of silently regenerating it', async () => {
    resetImportSessions()
    const controller = new DidController()
    const fixture = createAgent()

    await expect(
      controller.writeDid(
        { agent: fixture.agent } as never,
        {
          method: 'web',
          domain: 'example.com',
          didDocument: authorityDocument(),
        } as never,
      ),
    ).rejects.toThrow('use POST /dids/web/import')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    expect(fixture.didsImport).not.toHaveBeenCalled()
  })
})
