import 'reflect-metadata'

import type { KeyObject } from 'node:crypto'

import { Kms } from '@credo-ts/core'
import { X509CertificateGenerator } from '@peculiar/x509'
import { generateKeyPairSync, webcrypto } from 'node:crypto'

import { didX509Service } from '../didX509.service'

// The plug-in ships as ESM; only the key-id helper is used by the service.
jest.mock('@credebl/credo-ts-openbao', () => ({
  openBaoKeyId: (keyId: string) => (keyId.startsWith('ob_') ? keyId : `ob_${keyId}`),
}))

jest.mock('../../../utils/kms/nodeKms', () => ({ NODE_KMS_BACKEND: 'node' }))

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbols the service touches are stubbed.
jest.mock('@credo-ts/core', () => ({
  DidRepository: class {},
  inject: () => () => undefined,
  injectable: () => (target: unknown) => target,
  Kms: {
    KeyManagementModuleConfig: class {},
    KeyManagementKeyExistsError: class KeyManagementKeyExistsError extends Error {},
    PublicJwk: {
      fromPublicJwk: jest.fn(() => ({ getJwkThumbprint: () => new Uint8Array([1, 2, 3]) })),
    },
  },
  TypedArrayEncoder: {
    toBase64Url: () => 'thumbprint',
  },
}))

type KeyPair = { privateKey: KeyObject; publicKey: KeyObject }

async function createChain() {
  const toWebKeyPair = async ({ privateKey, publicKey }: KeyPair) => ({
    privateKey: await webcrypto.subtle.importKey(
      'pkcs8',
      privateKey.export({ format: 'der', type: 'pkcs8' }),
      { name: 'Ed25519' },
      true,
      ['sign'],
    ),
    publicKey: await webcrypto.subtle.importKey(
      'spki',
      publicKey.export({ format: 'der', type: 'spki' }),
      { name: 'Ed25519' },
      true,
      ['verify'],
    ),
  })

  const caPair = generateKeyPairSync('ed25519')
  const leafPair = generateKeyPairSync('ed25519')
  const ca = await toWebKeyPair(caPair)
  const leaf = await toWebKeyPair(leafPair)

  const root = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=Test Root CA, O=Test Org, C=US',
    keys: ca,
    signingAlgorithm: { name: 'Ed25519' },
  })
  const leafCertificate = await X509CertificateGenerator.create({
    subject: 'CN=issuer.example.com, O=Test Org, C=US',
    issuer: root.subject,
    publicKey: leaf.publicKey,
    signingKey: ca.privateKey,
    signingAlgorithm: { name: 'Ed25519' },
  })

  return { chain: [leafCertificate.toString('pem'), root.toString('pem')], leafPrivateKey: leafPair.privateKey }
}

describe('did:x509 import', () => {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original }
    delete process.env.OPENBAO_ENABLED
    delete process.env.OPENBAO_WRITE_ENABLED
    jest.clearAllMocks()
  })

  afterAll(() => {
    process.env = original
  })

  function existingDidFixture(
    did: string,
    getPublicKey = jest.fn().mockResolvedValue({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'stored-public-key',
    }),
  ) {
    const didDocument = {
      verificationMethod: [{ id: `${did}#key-1` }],
      toJSON: () => ({ id: did }),
    }
    const didRecord = {
      did,
      didDocument,
      keys: [{ kmsKeyId: 'askar-key', didDocumentRelativeKeyId: '#key-1' }],
      metadata: new Map<string, unknown>(),
    }
    const didRepository = {
      getCreatedDids: jest.fn().mockResolvedValue([didRecord]),
      update: jest.fn().mockResolvedValue(undefined),
    }
    const agent = {
      dids: { resolve: jest.fn().mockResolvedValue({ didDocument }), import: jest.fn() },
      context: { resolve: jest.fn().mockReturnValue(didRepository) },
      kms: { importKey: jest.fn(), getPublicKey },
    }
    return { agent, didRecord, didRepository }
  }

  it('reuses the key binding of an existing DID instead of rebinding it', async () => {
    const { chain, leafPrivateKey } = await createChain()
    const did = 'did:x509:0:sha256:root::subject:CN:issuer.example.com'
    const { agent, didRepository } = existingDidFixture(did)

    const result = await didX509Service.importDidX509(agent as never, {
      did,
      certificateChain: chain,
      privateKey: leafPrivateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    })

    expect(result.keyId).toBe('askar-key')
    expect(result.verificationMethodId).toBe(`${did}#key-1`)
    expect(didRepository.update).toHaveBeenCalledTimes(1)
    expect(agent.kms.importKey).not.toHaveBeenCalled()
    expect(agent.dids.import).not.toHaveBeenCalled()
  })

  it('rejects an existing DID whose bound key does not match the certificate', async () => {
    const { chain, leafPrivateKey } = await createChain()
    const did = 'did:x509:0:sha256:root::subject:CN:issuer.example.com'
    const { agent, didRecord, didRepository } = existingDidFixture(did)
    ;(Kms.PublicJwk.fromPublicJwk as jest.Mock)
      .mockReturnValueOnce({ getJwkThumbprint: () => new Uint8Array([1, 2, 3]) })
      .mockReturnValueOnce({ getJwkThumbprint: () => new Uint8Array([9, 9, 9]) })

    await expect(
      didX509Service.importDidX509(agent as never, {
        did,
        certificateChain: chain,
        privateKey: leafPrivateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }),
    ).rejects.toThrow('does not match the private key of the first (leaf) certificate')

    expect(didRecord.metadata.size).toBe(0)
    expect(didRepository.update).not.toHaveBeenCalled()
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })

  it('rejects an existing DID whose bound key cannot be read', async () => {
    const { chain, leafPrivateKey } = await createChain()
    const did = 'did:x509:0:sha256:root::subject:CN:issuer.example.com'
    const { agent, didRepository } = existingDidFixture(did, jest.fn().mockRejectedValue(new Error('key not found')))

    await expect(
      didX509Service.importDidX509(agent as never, {
        did,
        certificateChain: chain,
        privateKey: leafPrivateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }),
    ).rejects.toThrow('which cannot be read')

    expect(didRepository.update).not.toHaveBeenCalled()
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })

  it('returns the namespaced OpenBao key id when OpenBao stores the key', async () => {
    process.env.OPENBAO_ENABLED = 'true'
    process.env.OPENBAO_WRITE_ENABLED = 'true'
    const { leafPrivateKey } = await createChain()
    const agent = { kms: { importKey: jest.fn().mockResolvedValue({ keyId: 'ob_thumbprint' }) } }

    const keyId = await (
      didX509Service as unknown as {
        importKey: (agent: unknown, privateKey: KeyObject) => Promise<string>
      }
    ).importKey(agent, leafPrivateKey)

    expect(keyId).toBe('ob_thumbprint')
    expect(agent.kms.importKey).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'openbao', privateJwk: expect.objectContaining({ kid: 'thumbprint' }) }),
    )
  })
})
