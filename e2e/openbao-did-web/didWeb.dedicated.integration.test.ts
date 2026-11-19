import type { JsonWebKey } from 'node:crypto'

import { createPublicKey, generateKeyPairSync, verify as verifySignature } from 'node:crypto'

import {
  SIGN_RAW_DATA_PATH,
  agentCall,
  base58Encode,
  createDidFromEncryptedKey,
  ed25519AuthorityDocument,
  ed25519PublicKeyBase58,
  encryptDidWebImportKey,
  encryptKeyForSession,
  getAgentToken,
  importDidWebFromEncryptedKey,
  importDidWebWithEnvelopes,
  importDidWebWithKeys,
  liveConfig,
  liveIntegrationEnabled,
  publicJwkOf,
  transitKey,
  transitKeys,
  writeWithEnvelope,
} from './helpers'

const describeLive = liveIntegrationEnabled ? describe : describe.skip

/** A unique authority DID per run: the local record and OpenBao key otherwise collide between local runs. */
function uniqueAuthorityDid(label: string, host = 'authority.example.com'): string {
  return `did:web:${host}:it:${label}:${Date.now()}`
}

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

  it('imports an externally issued did:web document and binds its custom verification method', async () => {
    const authorityDid = uniqueAuthorityDid('custom-method')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const authorityPublicJwk = publicJwkOf(authorityJwk)
    const verificationMethodId = `${authorityDid}#authority-signing-key`
    const didDocument = ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId)

    const before = await transitKeys(config)
    const imported = await importDidWebFromEncryptedKey(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      verificationMethodId,
      privateJwk: authorityJwk,
      allowUnresolvedDocument: true,
    })

    expect(imported.status).toBe(200)
    expect(imported.body.did).toBe(authorityDid)
    // The authority's custom fragment, contexts and service survive instead of a regenerated `#key-1` document.
    expect(imported.body.didDocument).toMatchObject({
      id: authorityDid,
      verificationMethod: [{ id: verificationMethodId }],
      authentication: [verificationMethodId],
      service: didDocument.service,
    })
    expect(imported.body.keys).toEqual([{ verificationMethodId, keyId: expect.any(String), backend: 'openbao' }])
    expect(await transitKeys(config)).toHaveLength(before.length + 1)

    // The imported document resolves from the local record without touching the network.
    const resolved = await agentCall<{ didDocument?: { id?: string; authentication?: unknown[] } }>(
      config.dedicatedAgentUrl,
      token,
      'GET',
      `/dids/${encodeURIComponent(authorityDid)}/resolve`,
    )
    expect(resolved.status).toBe(200)
    expect(resolved.body.didDocument).toMatchObject({
      id: authorityDid,
      authentication: [verificationMethodId],
    })

    // Signing uses the key bound to the authority's verification method id.
    const data = Buffer.from('authority issued did:web payload')
    const signature = await agentCall<string>(config.dedicatedAgentUrl, token, 'POST', SIGN_RAW_DATA_PATH, {
      data: data.toString('base64'),
      did: authorityDid,
      keyType: 'Ed25519',
      // The controller signs with the DID record's key; tsoa still requires this field on the request body.
      publicKeyBase58: ed25519PublicKeyBase58(authorityJwk),
    })
    expect(signature.status).toBe(200)
    expect(
      verifySignature(
        null,
        data,
        createPublicKey({ key: authorityPublicJwk as JsonWebKey, format: 'jwk' }),
        Buffer.from(signature.body, 'base64'),
      ),
    ).toBe(true)

    // Re-importing the same document and key is idempotent and does not add another Transit key.
    const again = await importDidWebFromEncryptedKey(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      verificationMethodId,
      privateJwk: authorityJwk,
      allowUnresolvedDocument: true,
    })
    expect(again.status).toBe(200)
    expect(await transitKeys(config)).toHaveLength(before.length + 1)
  })

  it('accepts a relative verification method id and reports the absolute id', async () => {
    const authorityDid = uniqueAuthorityDid('relative-method')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const didDocument = ed25519AuthorityDocument(authorityDid, authorityJwk, `${authorityDid}#signing`)

    const imported = await importDidWebFromEncryptedKey(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      verificationMethodId: '#signing',
      privateJwk: authorityJwk,
      allowUnresolvedDocument: true,
    })

    expect(imported.status).toBe(200)
    expect(imported.body.keys).toEqual([
      { verificationMethodId: `${authorityDid}#signing`, keyId: expect.any(String), backend: 'openbao' },
    ])
  })

  it('imports several keys at once and keeps a public-only keyAgreement method in the document', async () => {
    const authorityDid = uniqueAuthorityDid('multi-key')
    const signingJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const assertionJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const keyAgreementJwk = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' })
    const signingId = `${authorityDid}#signing`
    const assertionId = `${authorityDid}#assertion`
    const keyAgreementId = `${authorityDid}#key-agreement`

    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: authorityDid,
      verificationMethod: [
        { id: signingId, type: 'JsonWebKey2020', controller: authorityDid, publicKeyJwk: publicJwkOf(signingJwk) },
        {
          id: assertionId,
          type: 'JsonWebKey2020',
          controller: authorityDid,
          publicKeyJwk: publicJwkOf(assertionJwk),
        },
        // Published by the authority but its private key is not handed over: the method stays public-only.
        {
          id: keyAgreementId,
          type: 'JsonWebKey2020',
          controller: authorityDid,
          publicKeyJwk: publicJwkOf(keyAgreementJwk),
        },
      ],
      authentication: [signingId],
      assertionMethod: [assertionId],
      keyAgreement: [keyAgreementId],
    }

    const before = await transitKeys(config)
    const imported = await importDidWebWithKeys(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [
        { verificationMethodId: signingId, privateJwk: signingJwk },
        { verificationMethodId: assertionId, privateJwk: assertionJwk },
      ],
      allowUnresolvedDocument: true,
    })

    expect(imported.status).toBe(200)
    expect(imported.body.keys).toEqual(
      expect.arrayContaining([
        { verificationMethodId: signingId, keyId: expect.any(String), backend: 'openbao' },
        { verificationMethodId: assertionId, keyId: expect.any(String), backend: 'openbao' },
      ]),
    )
    expect(imported.body.keys).toHaveLength(2)
    expect(await transitKeys(config)).toHaveLength(before.length + 2)

    // The key agreement method has no imported key, but it is still part of the stored document.
    expect(imported.body.didDocument).toMatchObject({
      id: authorityDid,
      keyAgreement: [keyAgreementId],
      verificationMethod: expect.arrayContaining([
        expect.objectContaining({ id: keyAgreementId }),
        expect.objectContaining({ id: signingId }),
        expect.objectContaining({ id: assertionId }),
      ]),
    })

    // One of the two imported keys signs through OpenBao with the DID as the selector.
    const data = Buffer.from('multi-key authority issued did:web payload')
    const signature = await agentCall<string>(config.dedicatedAgentUrl, token, 'POST', SIGN_RAW_DATA_PATH, {
      data: data.toString('base64'),
      did: authorityDid,
      keyType: 'Ed25519',
      // The controller signs with the DID record's key; tsoa still requires this field on the request body.
      publicKeyBase58: ed25519PublicKeyBase58(signingJwk),
    })
    expect(signature.status).toBe(200)

    const verifiedWith = [signingJwk, assertionJwk].filter((jwk) =>
      verifySignature(
        null,
        data,
        createPublicKey({ key: publicJwkOf(jwk) as JsonWebKey, format: 'jwk' }),
        Buffer.from(signature.body, 'base64'),
      ),
    )
    expect(verifiedWith).toHaveLength(1)
  })

  it('rejects an unknown verification method id before consuming the session and then retries', async () => {
    const authorityDid = uniqueAuthorityDid('unknown-method')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const didDocument = ed25519AuthorityDocument(authorityDid, authorityJwk, `${authorityDid}#signing`)
    const envelope = await encryptDidWebImportKey(
      config.dedicatedAgentUrl,
      token,
      `${authorityDid}#missing`,
      authorityJwk,
    )

    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('does not exist in didDocument')

    // Rejection happens before the session is consumed, so the same envelope works once the id is corrected.
    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [{ ...envelope, verificationMethodId: `${authorityDid}#signing` }],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)
  })

  it('rejects a private key that does not match the verification method and keeps the session usable', async () => {
    const authorityDid = uniqueAuthorityDid('mismatched-key')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const unrelatedJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const verificationMethodId = `${authorityDid}#signing`
    const didDocument = ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId)
    const envelope = await encryptDidWebImportKey(config.dedicatedAgentUrl, token, verificationMethodId, unrelatedJwk)

    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('does not match verification method')

    // A mismatched key must not burn the session: re-encrypt the published key to the same session and retry.
    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [{ ...envelope, jwe: encryptKeyForSession(envelope.session, authorityJwk) }],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)
  })

  it('requires replace:true to rebind an existing DID and keeps the rejected session usable', async () => {
    const authorityDid = uniqueAuthorityDid('replace')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const verificationMethodId = `${authorityDid}#signing`
    const originalDocument = ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId)

    const original = await importDidWebFromEncryptedKey(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: originalDocument,
      verificationMethodId,
      privateJwk: authorityJwk,
      allowUnresolvedDocument: true,
    })
    expect(original.status).toBe(200)

    const updatedDocument = {
      ...originalDocument,
      service: [
        {
          id: `${authorityDid}#didcomm`,
          type: 'DIDCommMessaging',
          serviceEndpoint: 'https://moved.authority.example.com/didcomm',
        },
      ],
    }
    const changed = await importDidWebFromEncryptedKey(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: updatedDocument,
      verificationMethodId,
      privateJwk: authorityJwk,
      allowUnresolvedDocument: true,
    })
    expect(changed.status).toBe(400)
    expect(changed.body.message).toContain('Pass replace:true')

    // The rejected request did not consume its session, and replace applies the new document.
    const replaced = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: updatedDocument,
      keys: [{ verificationMethodId, session: changed.session, jwe: changed.jwe }],
      allowUnresolvedDocument: true,
      replace: true,
    })
    expect(replaced.status).toBe(200)
    expect(replaced.body.didDocument).toMatchObject({ service: updatedDocument.service })
  })

  it('rejects an invalid did before consuming the session and then imports with the corrected did', async () => {
    const invalidDid = 'did:web:127.0.0.1'
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const envelope = await encryptDidWebImportKey(
      config.dedicatedAgentUrl,
      token,
      `${invalidDid}#signing`,
      authorityJwk,
    )

    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: invalidDid,
      didDocument: ed25519AuthorityDocument(invalidDid, authorityJwk, `${invalidDid}#signing`),
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('not a valid did:web identifier')

    const authorityDid = uniqueAuthorityDid('corrected-did')
    const verificationMethodId = `${authorityDid}#signing`
    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
      keys: [{ ...envelope, verificationMethodId }],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)

    // The consumed session cannot be replayed after the successful import.
    const replay = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
      keys: [{ ...envelope, verificationMethodId }],
      allowUnresolvedDocument: true,
    })
    expect(replay.status).toBe(400)
  })

  it('rejects a document whose id does not match the did before consuming the session', async () => {
    const authorityDid = uniqueAuthorityDid('mismatched-document-id')
    const otherDid = uniqueAuthorityDid('other-document-id')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const verificationMethodId = `${authorityDid}#signing`
    const envelope = await encryptDidWebImportKey(config.dedicatedAgentUrl, token, verificationMethodId, authorityJwk)

    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(otherDid, authorityJwk, `${otherDid}#signing`),
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('does not match did')

    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)
  })

  it('rejects a reused session across two key entries before importing either key', async () => {
    const authorityDid = uniqueAuthorityDid('reused-session')
    const signingJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const assertionJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const signingId = `${authorityDid}#signing`
    const assertionId = `${authorityDid}#assertion`
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: authorityDid,
      verificationMethod: [
        { id: signingId, type: 'JsonWebKey2020', controller: authorityDid, publicKeyJwk: publicJwkOf(signingJwk) },
        {
          id: assertionId,
          type: 'JsonWebKey2020',
          controller: authorityDid,
          publicKeyJwk: publicJwkOf(assertionJwk),
        },
      ],
      authentication: [signingId],
      assertionMethod: [assertionId],
    }
    const envelope = await encryptDidWebImportKey(config.dedicatedAgentUrl, token, signingId, signingJwk)

    const before = await transitKeys(config)
    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [envelope, { ...envelope, verificationMethodId: assertionId }],
      allowUnresolvedDocument: true,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('Each key needs its own import session')
    expect(await transitKeys(config)).toHaveLength(before.length)

    // Neither key was imported and the session is still usable for the first entry.
    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument,
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)
  })

  it('rejects plaintext key material while the migration flag is disabled', async () => {
    const authorityDid = uniqueAuthorityDid('plaintext')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const verificationMethodId = `${authorityDid}#signing`

    const rejected = await agentCall<{ message?: string }>(
      config.dedicatedAgentUrl,
      token,
      'POST',
      '/dids/web/import',
      {
        did: authorityDid,
        didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
        allowUnresolvedDocument: true,
        keys: [{ verificationMethodId, privateKeyJwk: authorityJwk }],
      },
    )
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('Plaintext private key import is disabled')
  })

  it('requires allowUnresolvedDocument when the authority document cannot be resolved', async () => {
    // Port 9 is not served, so resolution fails immediately instead of waiting on DNS or a network timeout.
    const authorityDid = uniqueAuthorityDid('offline', 'localhost%3A9')
    const authorityJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const verificationMethodId = `${authorityDid}#signing`
    const envelope = await encryptDidWebImportKey(config.dedicatedAgentUrl, token, verificationMethodId, authorityJwk)

    const rejected = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
      keys: [envelope],
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('allowUnresolvedDocument')

    const retried = await importDidWebWithEnvelopes(config.dedicatedAgentUrl, token, {
      did: authorityDid,
      didDocument: ed25519AuthorityDocument(authorityDid, authorityJwk, verificationMethodId),
      keys: [envelope],
      allowUnresolvedDocument: true,
    })
    expect(retried.status).toBe(200)
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
