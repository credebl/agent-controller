import type { TenantCredentials } from './helpers'
import type { JsonWebKey } from 'node:crypto'

import { createPublicKey, generateKeyPairSync, verify as verifySignature } from 'node:crypto'

import {
  SIGN_RAW_DATA_PATH,
  agentCall,
  base58Encode,
  createDidFromEncryptedKey,
  createTenant,
  deleteTenant,
  getAgentToken,
  liveConfig,
  liveIntegrationEnabled,
  transitKey,
  transitKeys,
} from './helpers'

const describeLive = liveIntegrationEnabled ? describe : describe.skip

/** `ac_<scope-hash>_<encoded-key-id>`; the scope hash isolates each tenant's Transit keys. */
function scopeOf(transitKeyName: string): string {
  return transitKeyName.split('_')[1]
}

describeLive('did:web encrypted key import (multi-tenant agent + OpenBao)', () => {
  const config = liveConfig()
  let baseToken: string
  let tenantA: TenantCredentials
  let tenantB: TenantCredentials
  let privateJwk: JsonWebKey
  let didA: string
  let publishedKeyA: string
  let transitKeyA: string

  beforeAll(async () => {
    baseToken = await getAgentToken(config.tenantAgentUrl, config.apiKey)
    tenantA = await createTenant(config.tenantAgentUrl, baseToken, 'didweb-integration-a')
    tenantB = await createTenant(config.tenantAgentUrl, baseToken, 'didweb-integration-b')
    privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  })

  afterAll(async () => {
    // Deleting a tenant also purges its OpenBao scope, so repeated local runs do not accumulate keys.
    if (!tenantA || !tenantB) return
    await Promise.allSettled([
      deleteTenant(config.tenantAgentUrl, baseToken, tenantA.id),
      deleteTenant(config.tenantAgentUrl, baseToken, tenantB.id),
    ])
  })

  it('creates a did:web from an encrypted key in tenant A with one scoped Transit key', async () => {
    const before = await transitKeys(config)
    const result = await createDidFromEncryptedKey(
      config.tenantAgentUrl,
      tenantA.token,
      'web',
      privateJwk,
      'tenant-a.example.com',
    )

    expect(result.status).toBe(200)
    expect(result.body.did).toBe('did:web:tenant-a.example.com')

    didA = result.body.did
    publishedKeyA = result.body.didDocument.verificationMethod[0]?.publicKeyBase58 as string

    const created = (await transitKeys(config)).filter((key) => !before.includes(key))
    expect(created).toHaveLength(1)
    transitKeyA = created[0]
  })

  it('stores tenant A material in an ed25519 Transit key that matches the published key', async () => {
    const key = await transitKey(config, transitKeyA)
    const publicKey = Buffer.from(key?.data?.keys?.['1']?.public_key as string, 'base64')

    expect(key?.data?.type).toBe('ed25519')
    expect(base58Encode(publicKey)).toBe(publishedKeyA)
  })

  it('signs as tenant A through the tenant-scoped OpenBao key', async () => {
    const data = Buffer.from('tenant did:web encrypted key import integration payload')
    const result = await agentCall<string>(config.tenantAgentUrl, tenantA.token, 'POST', SIGN_RAW_DATA_PATH, {
      data: data.toString('base64'),
      did: didA,
      keyType: 'Ed25519',
      publicKeyBase58: publishedKeyA,
    })

    expect(result.status).toBe(200)
    expect(
      verifySignature(
        null,
        data,
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x as string }, format: 'jwk' }),
        Buffer.from(result.body, 'base64'),
      ),
    ).toBe(true)
  })

  it('does not let tenant B sign with tenant A DID or key', async () => {
    const result = await agentCall<{ message?: string }>(
      config.tenantAgentUrl,
      tenantB.token,
      'POST',
      SIGN_RAW_DATA_PATH,
      {
        data: Buffer.from('cross tenant attempt').toString('base64'),
        did: didA,
        keyType: 'Ed25519',
        publicKeyBase58: publishedKeyA,
      },
    )

    expect(result.status).not.toBe(200)
  })

  it('maps the same key material to a separate Transit key per tenant scope', async () => {
    const before = await transitKeys(config)
    const result = await createDidFromEncryptedKey(
      config.tenantAgentUrl,
      tenantB.token,
      'web',
      privateJwk,
      'tenant-b.example.com',
    )

    expect(result.status).toBe(200)
    const created = (await transitKeys(config)).filter((key) => !before.includes(key))
    expect(created).toHaveLength(1)

    const [keyA, keyB] = await Promise.all([transitKey(config, transitKeyA), transitKey(config, created[0])])
    expect(scopeOf(created[0])).not.toBe(scopeOf(transitKeyA))
    expect(keyB?.data?.keys?.['1']?.public_key).toBe(keyA?.data?.keys?.['1']?.public_key)
  })
})
