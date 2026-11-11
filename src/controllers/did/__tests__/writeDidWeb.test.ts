import 'reflect-metadata'

import type { JsonWebKey } from 'node:crypto'

jest.mock('../../../errorHandlingService', () => ({
  __esModule: true,
  default: { handle: (error: unknown) => error },
}))

// Avoid loading Credo's ESM / agent-stack dependencies in Jest; only the symbols the did:web flow touches are
// stubbed. Everything else under test (controller, domain validation, key import sessions and envelopes) is real.
jest.mock('@credo-ts/askar', () => ({
  transformPrivateKeyToPrivateJwk: jest.fn(),
  transformSeedToPrivateJwk: jest.fn(),
}))

jest.mock('@sovio-id/credo-openbao-kms', () => ({
  OPENBAO_KEY_ID_PREFIX: 'ob_',
  openBaoKeyId: (keyId: string) => (keyId.startsWith('ob_') ? keyId : `ob_${keyId}`),
}))

jest.mock('../../../cliAgent', () => ({ RestMultiTenantAgentModules: {} }))

jest.mock('@credo-ts/core', () => {
  // did:web publishes Ed25519 keys as Ed25519VerificationKey2018/2020 and EC / RSA keys as JsonWebKey2020; the two
  // helpers take different argument names for the same fields.
  const verificationMethod = (options: Record<string, unknown>, type: string) => ({
    id: (options.id ?? options.verificationMethodId) as string,
    type,
    controller: (options.controller ?? options.did) as string,
    publicKeyJwk: options.publicJwk,
  })

  class DidDocumentBuilder {
    private readonly document: Record<string, unknown>

    public constructor(did: string) {
      this.document = {
        id: did,
        verificationMethod: [] as unknown[],
        authentication: [] as unknown[],
        assertionMethod: [] as unknown[],
        capabilityInvocation: [] as unknown[],
        capabilityDelegation: [] as unknown[],
      }
    }

    public addContext() {
      return this
    }
    public addVerificationMethod(method: unknown) {
      ;(this.document.verificationMethod as unknown[]).push(method)
      return this
    }
    public addAuthentication(keyId: string) {
      ;(this.document.authentication as unknown[]).push(keyId)
      return this
    }
    public addAssertionMethod(keyId: string) {
      ;(this.document.assertionMethod as unknown[]).push(keyId)
      return this
    }
    public addCapabilityInvocation(keyId: string) {
      ;(this.document.capabilityInvocation as unknown[]).push(keyId)
      return this
    }
    public addCapabilityDelegation(keyId: string) {
      ;(this.document.capabilityDelegation as unknown[]).push(keyId)
      return this
    }
    public build() {
      return this.document
    }
  }

  return {
    Agent: class Agent {
      public config = { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }
    },
    inject: () => () => undefined,
    injectable: () => (target: unknown) => target,
    DidRepository: class {},
    TypedArrayEncoder: { toBase64Url: () => '', fromUtf8String: () => new Uint8Array() },
    Hasher: { hash: () => new Uint8Array() },
    LogLevel: {},
    PeerDidNumAlgo: { ShortFormAndLongForm: 0 },
    DidKey: { fromPublicKey: () => ({}) },
    createPeerDidDocumentFromServices: () => ({}),
    DidDocumentBuilder,
    getEd25519VerificationKey2018: (options: Record<string, unknown>) =>
      verificationMethod(options, 'Ed25519VerificationKey2018'),
    getEd25519VerificationKey2020: (options: Record<string, unknown>) =>
      verificationMethod(options, 'Ed25519VerificationKey2020'),
    getJsonWebKey2020: (options: Record<string, unknown>) => verificationMethod(options, 'JsonWebKey2020'),
    SECURITY_ED25519_2018_CONTEXT_URL: 'https://w3id.org/security/suites/ed25519-2018/v1',
    SECURITY_ED25519_2020_CONTEXT_URL: 'https://w3id.org/security/suites/ed25519-2020/v1',
    SECURITY_JWS_CONTEXT_URL: 'https://w3id.org/ns/security/jws/v1',
    VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018: 'Ed25519VerificationKey2018',
    VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020: 'Ed25519VerificationKey2020',
    Kms: {
      KeyManagementModuleConfig: class {},
      KeyManagementKeyExistsError: class KeyManagementKeyExistsError extends Error {},
      PublicJwk: {
        fromPublicJwk: (jwk: Record<string, unknown>) => ({ ...jwk, getJwkThumbprint: () => new Uint8Array() }),
      },
    },
  }
})

import { generateKeyPairSync } from 'node:crypto'

import { BadRequestError } from '../../../errors'
import { encryptKeyImportEnvelope } from '../../../utils/keyImport/jwe'
import { consumeImportSession, createImportSession, resetImportSessions } from '../../../utils/keyImport/session'
import { DidController } from '../DidController'

// The envelope carries a real Ed25519 private JWK, as the studio sends it for a did:web key import.
const ed25519PrivateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as {
  kty: string
  crv: string
  x: string
  d: string
}

describe('DidController.writeDid for did:web with an encrypted key', () => {
  let controller: DidController
  let kmsImportKey: jest.Mock
  let didsImport: jest.Mock

  beforeEach(() => {
    resetImportSessions()
    controller = new DidController()
  })

  function agent() {
    kmsImportKey = jest.fn(async ({ privateJwk }: { privateJwk: { kty: string; crv: string } }) => ({
      keyId: 'kms-key-id',
      publicJwk: { kty: privateJwk.kty, crv: privateJwk.crv, x: ed25519PrivateJwk.x },
    }))
    didsImport = jest.fn(async () => undefined)

    return {
      context: { contextCorrelationId: 'tenant-1' },
      kms: { importKey: kmsImportKey },
      dids: { import: didsImport },
    }
  }

  /**
   * Sends a `POST /dids/write` request for method `web` with a real single-use key import envelope.
   */
  async function encryptedWebDidRequest(domain?: string) {
    const session = await createImportSession('web', 'tenant-1')
    const jwe = encryptKeyImportEnvelope(
      session.publicKeyJwk as JsonWebKey,
      Buffer.from(JSON.stringify({ privateKeyJwk: ed25519PrivateJwk })),
      session.protectedHeader,
    )

    const promise = controller.writeDid({ agent: agent() } as never, {
      method: 'web',
      domain,
      encryptedKey: { sessionId: session.sessionId, jwe },
    })

    return { session, jwe, promise }
  }

  it.each([
    ['example.com', 'did:web:example.com'],
    ['ayanworks.github.io:iec:0522012345', 'did:web:ayanworks.github.io:iec:0522012345'],
    ['example.com%3A3000:users:alice', 'did:web:example.com%3A3000:users:alice'],
    ['localhost%3A3000', 'did:web:localhost%3A3000'],
    ['example.com:~', 'did:web:example.com:%7E'],
  ])('creates %s as %s from an encrypted key', async (domain, expectedDid) => {
    const { promise } = await encryptedWebDidRequest(domain)

    const result = await promise

    expect(result.did).toBe(expectedDid)
    expect(result.didDocument.id).toBe(expectedDid)
    expect(result.didDocument.verificationMethod?.[0]).toMatchObject({
      id: `${expectedDid}#key-1`,
      controller: expectedDid,
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: ed25519PrivateJwk.x },
    })
    expect(kmsImportKey).toHaveBeenCalledWith({
      privateJwk: expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', d: ed25519PrivateJwk.d }),
    })
    expect(didsImport).toHaveBeenCalledWith({
      did: expectedDid,
      overwrite: true,
      didDocument: expect.objectContaining({ id: expectedDid }),
      keys: [{ didDocumentRelativeKeyId: '#key-1', kmsKeyId: 'kms-key-id' }],
    })
  })

  it('consumes the single-use session once the DID is created', async () => {
    const { session, jwe, promise } = await encryptedWebDidRequest('example.com')

    await promise

    expect(() =>
      consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'web' }),
    ).toThrow()
  })

  it.each(['example.com::x', '127.0.0.1', 'foo.123', 'example.com%3A65536'])(
    'rejects the invalid domain %s before consuming the single-use session',
    async (domain) => {
      const { session, jwe, promise } = await encryptedWebDidRequest(domain)

      await expect(promise).rejects.toThrow(BadRequestError)
      expect(kmsImportKey).not.toHaveBeenCalled()
      expect(didsImport).not.toHaveBeenCalled()

      // The session is still intact, so the caller can correct the domain and retry with the same envelope.
      expect(
        consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'web' }),
      ).toEqual({ privateKeyJwk: ed25519PrivateJwk })
    },
  )

  it('rejects a missing domain before consuming the single-use session', async () => {
    const { session, jwe, promise } = await encryptedWebDidRequest()

    await expect(promise).rejects.toThrow('For create did:web, domain is required')
    expect(kmsImportKey).not.toHaveBeenCalled()
    expect(didsImport).not.toHaveBeenCalled()
    expect(
      consumeImportSession({ sessionId: session.sessionId, jwe, agentBinding: 'tenant-1', method: 'web' }),
    ).toEqual({ privateKeyJwk: ed25519PrivateJwk })
  })
})
