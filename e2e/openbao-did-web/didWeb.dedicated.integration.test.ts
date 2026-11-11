import type { JsonWebKey } from 'node:crypto'

import { createPublicKey, generateKeyPairSync, verify as verifySignature } from 'node:crypto'

import {
  SIGN_RAW_DATA_PATH,
  agentCall,
  base58Encode,
  createDidFromEncryptedKey,
  getAgentToken,
  liveConfig,
  liveIntegrationEnabled,
  transitKey,
  transitKeys,
  writeWithEnvelope,
} from './helpers'

const describeLive = liveIntegrationEnabled ? describe : describe.skip

describeLive('did:web encrypted key import (dedicated agent + OpenBao)', () => {
  const config = liveConfig()
  let token: string
  let privateJwk: JsonWebKey
  let did: string
  let publishedKey: string
  let transitKeyName: string

  beforeAll(async () => {
    token = await getAgentToken(config.dedicatedAgentUrl, config.apiKey)
    privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  })

  it('creates did:web:example.com from an encrypted key with exactly one OpenBao Transit key', async () => {
    const before = await transitKeys(config)
    const result = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, 'example.com')

    expect(result.status).toBe(200)
    expect(result.body.did).toBe('did:web:example.com')

    did = result.body.did
    publishedKey = result.body.didDocument.verificationMethod[0]?.publicKeyBase58 as string

    const created = (await transitKeys(config)).filter((key) => !before.includes(key))
    expect(created).toHaveLength(1)
    transitKeyName = created[0]
  })

  it('imports an ed25519 Transit key whose public key is published in the DID document', async () => {
    const key = await transitKey(config, transitKeyName)
    const publicKey = key?.data?.keys?.['1']?.public_key as string

    expect(key?.data?.type).toBe('ed25519')
    expect(base58Encode(Buffer.from(publicKey, 'base64'))).toBe(publishedKey)
  })

  it('stores and resolves the imported DID', async () => {
    // `/dids/:did/resolve` reads the local record without overwriting it. `GET /dids/:did` writes, so it is avoided
    // here to keep the key binding intact.
    const result = await agentCall<{ didDocument?: { id?: string } }>(
      config.dedicatedAgentUrl,
      token,
      'GET',
      `/dids/${encodeURIComponent(did)}/resolve`,
    )

    expect(result.status).toBe(200)
    expect(result.body.didDocument?.id).toBe(did)
  })

  it('signs through the OpenBao key and the signature verifies', async () => {
    const data = Buffer.from('did:web encrypted key import integration payload')
    const result = await agentCall<string>(config.dedicatedAgentUrl, token, 'POST', SIGN_RAW_DATA_PATH, {
      data: data.toString('base64'),
      did,
      keyType: 'Ed25519',
      publicKeyBase58: publishedKey,
    })

    expect(result.status).toBe(200)
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x as string },
      format: 'jwk',
    })
    expect(verifySignature(null, data, publicKey, Buffer.from(result.body, 'base64'))).toBe(true)

    const verification = await agentCall<{ verified?: boolean }>(
      config.dedicatedAgentUrl,
      token,
      'POST',
      '/agent/verify',
      {
        data: data.toString('base64'),
        signature: result.body,
        publicKeyBase58: publishedKey,
        keyType: 'Ed25519',
      },
    )

    expect(verification.status).toBe(200)
    expect(verification.body.verified).toBe(true)
  })

  it('re-importing the same key keeps the DID and does not duplicate the Transit key', async () => {
    const before = await transitKeys(config)
    const result = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, 'example.com')

    expect(result.status).toBe(200)
    expect(result.body.did).toBe(did)
    expect(await transitKeys(config)).toHaveLength(before.length)
  })

  it.each([
    ['ayanworks.github.io:iec:0522012345', 'did:web:ayanworks.github.io:iec:0522012345'],
    ['localhost%3A3000', 'did:web:localhost%3A3000'],
    ['example.com:~', 'did:web:example.com:%7E'],
  ])('encodes the domain %s as %s', async (domain, expected) => {
    const result = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, domain)

    expect(result.status).toBe(200)
    expect(result.body.did).toBe(expected)
  })

  it.each(['foo.123', '127.0.0.1', 'example.com::x', 'example.com%3A65536'])(
    'rejects the invalid domain %s before consuming the single-use session',
    async (domain) => {
      const rejected = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, domain)
      expect(rejected.status).toBe(400)

      // The same session and envelope still work for a valid domain, which proves validation ran before consumption.
      const retried = await writeWithEnvelope(
        config.dedicatedAgentUrl,
        token,
        'web',
        'example.com',
        rejected.session,
        rejected.jwe,
      )
      expect(retried.status).toBe(200)
      expect(retried.body.did).toBe('did:web:example.com')
    },
  )

  it('rejects a missing domain before consuming the single-use session', async () => {
    const rejected = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, undefined)

    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toBe('For create did:web, domain is required')

    const retried = await writeWithEnvelope(
      config.dedicatedAgentUrl,
      token,
      'web',
      'example.com',
      rejected.session,
      rejected.jwe,
    )
    expect(retried.status).toBe(200)
  })

  it('does not allow a single-use envelope to be replayed', async () => {
    const created = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'web', privateJwk, 'example.com')
    expect(created.status).toBe(200)

    const replay = await writeWithEnvelope(
      config.dedicatedAgentUrl,
      token,
      'web',
      'example.com',
      created.session,
      created.jwe,
    )
    expect(replay.status).toBe(400)
  })

  it('creates did:key in OpenBao when did:key import is enabled', async () => {
    const before = await transitKeys(config)
    const keyJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const result = await createDidFromEncryptedKey(config.dedicatedAgentUrl, token, 'key', keyJwk)

    expect(result.status).toBe(200)
    expect(result.body.did).toMatch(/^did:key:z6Mk/)
    expect(await transitKeys(config)).toHaveLength(before.length + 1)
  })
})
