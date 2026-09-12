import type { OpenBaoTransitClient, OpenBaoTransitKey } from '../OpenBaoTransitClient'
import type { AgentContext } from '@credo-ts/core'

jest.mock('@credo-ts/core', () => {
  class KeyManagementError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
      super(message, options)
    }
  }
  class KeyManagementAlgorithmNotSupportedError extends KeyManagementError {}
  class KeyManagementKeyNotFoundError extends KeyManagementError {
    public constructor(keyId: string) {
      super(`Key '${keyId}' not found`)
    }
  }
  return {
    Kms: {
      KeyManagementError,
      KeyManagementAlgorithmNotSupportedError,
      KeyManagementKeyNotFoundError,
      PublicJwk: {
        fromUnknown: (jwk: Record<string, unknown>) => ({ toJson: () => jwk }),
      },
    },
  }
})

import { OpenBaoKeyManagementService } from '../OpenBaoKeyManagementService'
import { resolveOpenBaoKmsConfig } from '../OpenBaoKmsConfig'

const publicKey = Buffer.alloc(32, 7).toString('base64')

const transitKey: OpenBaoTransitKey = {
  name: 'test',
  type: 'ed25519',
  latest_version: 1,
  keys: { '1': { public_key: publicKey } },
}

const context = (id: string) => ({ contextCorrelationId: id }) as AgentContext

const createClient = () =>
  ({
    createKey: jest.fn().mockResolvedValue(undefined),
    readKey: jest.fn().mockResolvedValue(transitKey),
    sign: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    verify: jest.fn().mockResolvedValue(true),
  }) as unknown as jest.Mocked<OpenBaoTransitClient>

describe('OpenBaoKeyManagementService', () => {
  const config = resolveOpenBaoKmsConfig({ url: 'https://bao.example', token: 'test-token', keyPrefix: 'wallet' })

  test('creates non-exportable tenant-scoped Ed25519 keys', async () => {
    const client = createClient()
    const service = new OpenBaoKeyManagementService(config, client)
    const result = await service.createKey(context('tenant-a'), {
      keyId: 'issuer-signing',
      type: { kty: 'OKP', crv: 'Ed25519' },
    })

    expect(result.keyId).toMatch(/^openbao:[a-f0-9]{20}:issuer-signing$/)
    expect(result.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: result.keyId })
    expect(client.createKey).toHaveBeenCalledWith(
      expect.stringMatching(/^wallet-[a-f0-9]{20}-issuer-signing$/),
      'ed25519',
    )
  })

  test('fails closed when a key belongs to another tenant', async () => {
    const client = createClient()
    const service = new OpenBaoKeyManagementService(config, client)
    const created = await service.createKey(context('tenant-a'), {
      keyId: 'holder-binding',
      type: { kty: 'OKP', crv: 'Ed25519' },
    })

    await expect(service.getPublicKey(context('tenant-b'), created.keyId)).rejects.toThrow('not found')
    expect(client.readKey).toHaveBeenCalledTimes(1)
  })

  test('routes signing and verification to Transit', async () => {
    const client = createClient()
    const service = new OpenBaoKeyManagementService(config, client)
    const created = await service.createKey(context('tenant-a'), {
      keyId: 'credential',
      type: { kty: 'OKP', crv: 'Ed25519' },
    })
    const data = new Uint8Array([4, 5, 6])
    const signed = await service.sign(context('tenant-a'), {
      keyId: created.keyId,
      algorithm: 'EdDSA',
      data,
    })
    const verified = await service.verify(context('tenant-a'), {
      key: { keyId: created.keyId },
      algorithm: 'EdDSA',
      data,
      signature: signed.signature,
    })

    expect(signed.signature).toEqual(new Uint8Array([1, 2, 3]))
    expect(verified.verified).toBe(true)
    expect(client.sign).toHaveBeenCalledWith(expect.any(String), data, 'EdDSA')
    expect(client.verify).toHaveBeenCalledWith(expect.any(String), data, signed.signature, 'EdDSA', 1)
  })

  test('does not claim unsupported key import, encryption, or random operations', () => {
    const service = new OpenBaoKeyManagementService(config, createClient())
    const agentContext = context('tenant-a')

    expect(service.isOperationSupported(agentContext, { operation: 'importKey', privateJwk: {} as never })).toBe(false)
    expect(service.isOperationSupported(agentContext, { operation: 'randomBytes' })).toBe(false)
    expect(
      service.isOperationSupported(agentContext, {
        operation: 'createKey',
        type: { kty: 'OKP', crv: 'X25519' },
      }),
    ).toBe(false)
  })
})
