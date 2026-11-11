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
const p521Key = generateKeyPairSync('ec', { namedCurve: 'P-521' }).privateKey.export({ format: 'jwk' }) as {
  kty: string
  crv: string
  x: string
  y: string
  d: string
}
const x25519PrivateKey = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' })

const x25519Key = generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' })

function publicJwkOf(privateJwk: Record<string, unknown>): Record<string, unknown> {
  const key = createPrivateKey({ key: privateJwk as JsonWebKey, format: 'jwk' })
  return createPublicKey(key).export({ format: 'jwk' }) as Record<string, unknown>
}

const signingPublicJwk = publicJwkOf(signingKey)
const otherSigningPublicJwk = publicJwkOf(otherSigningKey)
const ecPublicJwk = publicJwkOf(ecKey)
const p521PublicJwk = publicJwkOf(p521Key)
const x25519PublicJwk = publicJwkOf(x25519PrivateKey)

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
    // allowUnresolvedDocument:true imports the supplied copy without contacting the authority.
    expect(fixture.didsResolve).not.toHaveBeenCalled()
  })

  it('imports a supplied document that matches the published one', async () => {
    const fixture = createAgent()
    fixture.didsResolve.mockResolvedValue({ didDocument: mockDocument(authorityDocument()) })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument: authorityDocument(),
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(fixture.didsResolve).toHaveBeenCalledWith(DID, { useLocalCreatedDidRecord: false })
    expect(result.keys[0].verificationMethodId).toBe(`${DID}#authority-signing-key`)
  })

  it('rejects a supplied document that belongs to a different DID', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument({ id: 'did:web:other.example.com' }),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow(`does not match did "${DID}"`)
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects a supplied document that is not a JSON object', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: 'not a document' as never,
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('didDocument must be a JSON object')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects a document with a dangling verification method reference', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument({ authentication: ['#missing-key'] }),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('didDocument has an invalid verification method reference')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('binds a key to a relative verification method id', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument: authorityDocument({
        verificationMethod: [
          {
            id: '#authority-signing-key',
            type: 'Ed25519VerificationKey2020',
            controller: DID,
            publicKeyJwk: signingPublicJwk,
          },
        ],
        authentication: ['#authority-signing-key'],
        assertionMethod: ['#authority-signing-key'],
      }),
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    // The document keeps the relative id it was published with, and the key is bound to it.
    expect(result.keys[0].verificationMethodId).toBe('#authority-signing-key')
    expect(fixture.didsImport).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [{ didDocumentRelativeKeyId: '#authority-signing-key', kmsKeyId: 'kms-key-1' }],
      }),
    )
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

  it('requires an empty request body to name a did:web', async () => {
    const fixture = createAgent()

    await expect(controller.importDidWeb({ agent: fixture.agent } as never, undefined as never)).rejects.toThrow(
      'did must be a did:web identifier',
    )
  })

  it('requires a verificationMethodId for every key', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ encryptedKey: key } as never],
      }),
    ).rejects.toThrow('keys[].verificationMethodId is required')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects two key entries for the same verification method', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [
          { verificationMethodId: '#authority-signing-key', encryptedKey: { sessionId: 'one', jwe: 'jwe' } },
          { verificationMethodId: `${DID}#authority-signing-key`, encryptedKey: { sessionId: 'two', jwe: 'jwe' } },
        ],
      }),
    ).rejects.toThrow('keys contains more than one entry for verification method')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('requires encrypted or plaintext key material for each key', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key' }],
      }),
    ).rejects.toThrow('needs an encryptedKey or plaintext private key')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects a key that contains both encrypted and plaintext material', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [
          {
            verificationMethodId: '#authority-signing-key',
            encryptedKey: { sessionId: 'one', jwe: 'jwe' },
            privateKeyJwk: signingKey,
          },
        ],
      }),
    ).rejects.toThrow('Provide either encryptedKey or plaintext key material per key, not both')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('requires both sessionId and jwe in an encryptedKey', async () => {
    const fixture = createAgent()

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: { sessionId: '', jwe: 'jwe' } }],
      }),
    ).rejects.toThrow('encryptedKey.sessionId and encryptedKey.jwe are required')

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: { sessionId: 'one' } as never }],
      }),
    ).rejects.toThrow('encryptedKey.sessionId and encryptedKey.jwe are required')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects plaintext key material while the migration flag is disabled', async () => {
    const fixture = createAgent()
    const previous = process.env.ALLOW_PLAINTEXT_KEY_IMPORT
    delete process.env.ALLOW_PLAINTEXT_KEY_IMPORT

    try {
      await expect(
        controller.importDidWeb({ agent: fixture.agent } as never, {
          did: DID,
          didDocument: authorityDocument(),
          allowUnresolvedDocument: true,
          keys: [{ verificationMethodId: '#authority-signing-key', privateKeyJwk: signingKey }],
        }),
      ).rejects.toThrow('Plaintext private key import is disabled')
      expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.ALLOW_PLAINTEXT_KEY_IMPORT
      else process.env.ALLOW_PLAINTEXT_KEY_IMPORT = previous
    }
  })

  it('imports plaintext key material when the migration flag is enabled', async () => {
    const fixture = createAgent()
    const previous = process.env.ALLOW_PLAINTEXT_KEY_IMPORT
    process.env.ALLOW_PLAINTEXT_KEY_IMPORT = 'true'

    try {
      const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', privateKeyJwk: signingKey }],
      })

      expect(result.keys).toEqual([
        { verificationMethodId: `${DID}#authority-signing-key`, keyId: 'kms-key-1', backend: 'askar' },
      ])
      expect(fixture.didsImport).toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.ALLOW_PLAINTEXT_KEY_IMPORT
      else process.env.ALLOW_PLAINTEXT_KEY_IMPORT = previous
    }
  })

  it('rejects a key type that cannot sign, even when the document publishes it', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument({
      verificationMethod: [
        {
          id: `${DID}#key-agreement-key`,
          type: 'X25519KeyAgreementKey2020',
          controller: DID,
          publicKeyJwk: x25519PublicJwk,
        },
      ],
      authentication: [],
      assertionMethod: [],
      keyAgreement: [`${DID}#key-agreement-key`],
    })
    const { session, encryptedKey: key } = await encryptedKey(x25519PrivateKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument,
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#key-agreement-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('did:web does not support a OKP X25519 private key')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    // The key type check happens before any session is consumed.
    expect(() =>
      consumeImportSession({
        sessionId: session.sessionId,
        jwe: key.jwe,
        agentBinding: 'tenant-1',
        method: 'web',
      }),
    ).not.toThrow()
  })

  it('routes an EC P-521 key to the Node KMS because Askar cannot hold it', async () => {
    const fixture = createAgent()
    const didDocument = authorityDocument({
      verificationMethod: [
        {
          id: `${DID}#assertion-key`,
          type: 'JsonWebKey2020',
          controller: DID,
          publicKeyJwk: p521PublicJwk,
        },
      ],
      authentication: [],
      assertionMethod: [`${DID}#assertion-key`],
    })
    const { encryptedKey: key } = await encryptedKey(p521Key)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument,
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: '#assertion-key', encryptedKey: key }],
    })

    expect(result.keys).toEqual([{ verificationMethodId: `${DID}#assertion-key`, keyId: 'kms-key-1', backend: 'node' }])
    expect(fixture.kmsImportKey).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'node', privateJwk: expect.objectContaining({ crv: 'P-521' }) }),
    )
  })

  it('repairs a keyless record that GET /dids/:did stored for the same DID', async () => {
    const fixture = createAgent()
    // `GET /dids/:did` imports a resolved document with overwrite and no keys, leaving an unusable record behind.
    fixture.records.push({ didDocument: mockDocument(authorityDocument()), keys: [] })
    const { encryptedKey: key } = await encryptedKey(signingKey)

    const result = await controller.importDidWeb({ agent: fixture.agent } as never, {
      did: DID,
      didDocument: authorityDocument(),
      allowUnresolvedDocument: true,
      keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
    })

    expect(result.keys).toHaveLength(1)
    expect(fixture.kmsImportKey).toHaveBeenCalled()
    expect(fixture.didsImport).toHaveBeenCalledWith(
      expect.objectContaining({
        overwrite: true,
        keys: [{ didDocumentRelativeKeyId: '#authority-signing-key', kmsKeyId: 'kms-key-1' }],
      }),
    )
  })

  it('refuses to rebind when the stored key is no longer in the KMS', async () => {
    const fixture = createAgent()
    preload(fixture, authorityDocument(), [
      { verificationMethodId: `${DID}#authority-signing-key`, privateJwk: signingKey },
    ])
    fixture.keyStore.delete('preloaded-key-0')
    const { encryptedKey: key } = await encryptedKey(signingKey)

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('Pass replace:true to rebind it')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
    expect(fixture.didsImport).not.toHaveBeenCalled()
  })

  it('rejects an import session created for another DID method', async () => {
    const fixture = createAgent()
    const session = await createImportSession('key', 'tenant-1')
    const jwe = encryptKeyImportEnvelope(
      session.publicKeyJwk as JsonWebKey,
      Buffer.from(JSON.stringify({ privateKeyJwk: signingKey })),
      session.protectedHeader,
    )

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: { sessionId: session.sessionId, jwe } }],
      }),
    ).rejects.toThrow('The key import session is invalid or has expired')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
  })

  it('rejects an import session created for another agent', async () => {
    const fixture = createAgent()
    const { encryptedKey: key } = await encryptedKey(signingKey, 'tenant-2')

    await expect(
      controller.importDidWeb({ agent: fixture.agent } as never, {
        did: DID,
        didDocument: authorityDocument(),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId: '#authority-signing-key', encryptedKey: key }],
      }),
    ).rejects.toThrow('The key import session is invalid or has expired')
    expect(fixture.kmsImportKey).not.toHaveBeenCalled()
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
