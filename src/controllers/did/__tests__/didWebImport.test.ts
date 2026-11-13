jest.mock('@credo-ts/core', () => require('./didWebTestMocks').credoCoreMock())

import type { DidDocument, VerificationMethod } from '@credo-ts/core'

import { DidDocument as CredoDidDocument } from '@credo-ts/core'
import { generateKeyPairSync } from 'node:crypto'

import { BadRequestError } from '../../../errors'
import {
  assertPrivateKeyMatchesVerificationMethod,
  assertValidDidWebIdentifier,
  didDocumentsEqual,
  normalizeVerificationMethodId,
  parseDidWebDocument,
  privateJwkThumbprint,
  verificationMethodRelativeId,
  verificationMethodThumbprint,
  verificationMethodsById,
} from '../didWebImport'

const DID = 'did:web:gov-agency.example.com'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privateJwk = privateKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; d: string }
const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string }

const otherKeyPair = generateKeyPairSync('ed25519')
const otherPublicJwk = otherKeyPair.publicKey.export({ format: 'jwk' })

const signingMethod: VerificationMethod = {
  id: `${DID}#authority-signing-key`,
  type: 'Ed25519VerificationKey2020',
  controller: DID,
  publicKeyJwk: publicJwk,
} as unknown as VerificationMethod

const otherMethod: VerificationMethod = {
  id: `${DID}#other-key`,
  type: 'Ed25519VerificationKey2020',
  controller: DID,
  publicKeyJwk: otherPublicJwk,
} as unknown as VerificationMethod

const authorityDocument = {
  '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
  id: DID,
  verificationMethod: [signingMethod, otherMethod],
  authentication: [`${DID}#authority-signing-key`],
  assertionMethod: [`${DID}#authority-signing-key`],
  service: [
    { id: `${DID}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: 'https://gov-agency.example.com/didcomm' },
  ],
}

function document(overrides: Record<string, unknown> = {}): DidDocument {
  return parseDidWebDocument({ ...authorityDocument, ...overrides }, (overrides.id as string) ?? DID)
}

describe('assertValidDidWebIdentifier', () => {
  it.each([
    'did:web:example.com',
    'did:web:ayanworks.github.io:iec:0522012345',
    'did:web:example.com%3A3000:users:alice',
    'did:web:localhost%3A3000',
    'did:web:example.com:%7E',
  ])('accepts %s', (did) => {
    expect(() => assertValidDidWebIdentifier(did)).not.toThrow()
  })

  it.each([
    [undefined, 'did must be a did:web identifier'],
    ['did:key:z6Mkfake', 'did must be a did:web identifier'],
    ['did:web:', 'did must be a did:web identifier'],
    ['did:web:example.com#key-1', 'without a fragment'],
    ['did:web:example.com?service=agent', 'without a fragment'],
    ['did:web:example.com/path', 'without a fragment'],
    ['did:web:127.0.0.1', 'not a valid did:web identifier'],
    ['did:web:example.com::x', 'not a valid did:web identifier'],
  ])('rejects %s', (did, message) => {
    expect(() => assertValidDidWebIdentifier(did)).toThrow(BadRequestError)
    expect(() => assertValidDidWebIdentifier(did)).toThrow(message)
  })
})

describe('parseDidWebDocument', () => {
  it('keeps the authority document as-is', () => {
    const parsed = document()

    expect(parsed.id).toBe(DID)
    expect(parsed.toJSON()).toMatchObject({
      '@context': authorityDocument['@context'],
      id: DID,
      service: authorityDocument.service,
    })
    expect(parsed.verificationMethod?.map((method) => method.id)).toEqual([
      `${DID}#authority-signing-key`,
      `${DID}#other-key`,
    ])
  })

  it.each([[undefined], ['not a document'], [[]]])('rejects %s', (raw) => {
    expect(() => parseDidWebDocument(raw, DID)).toThrow('didDocument must be a JSON object')
  })

  it('rejects a document for a different DID', () => {
    expect(() => parseDidWebDocument(authorityDocument, 'did:web:other.example.com')).toThrow(
      'does not match did "did:web:other.example.com"',
    )
  })

  it('reports a document the DID parser rejects', () => {
    const spy = jest.spyOn(CredoDidDocument, 'fromJSON').mockImplementation(() => {
      throw new Error('broken document')
    })

    try {
      expect(() => parseDidWebDocument({ id: DID }, DID)).toThrow(
        'didDocument is not a valid DID document: broken document',
      )
    } finally {
      spy.mockRestore()
    }
  })
})

describe('verification method ids', () => {
  it('normalizes relative ids and leaves absolute ids alone', () => {
    expect(normalizeVerificationMethodId(DID, '#authority-signing-key')).toBe(`${DID}#authority-signing-key`)
    expect(normalizeVerificationMethodId(DID, `${DID}#authority-signing-key`)).toBe(`${DID}#authority-signing-key`)
  })

  it('extracts the fragment Credo stores as didDocumentRelativeKeyId', () => {
    expect(verificationMethodRelativeId(`${DID}#authority-signing-key`)).toBe('#authority-signing-key')
    expect(() => verificationMethodRelativeId(DID)).toThrow('has no fragment')
  })
})

describe('verificationMethodsById', () => {
  it('indexes methods listed under verificationMethod and under a purpose', () => {
    const inline = {
      id: '#inline-key',
      type: 'Ed25519VerificationKey2020',
      controller: DID,
      publicKeyJwk: otherPublicJwk,
    }
    const methods = verificationMethodsById(document({ verificationMethod: [signingMethod], authentication: [inline] }))

    expect([...methods.keys()]).toEqual([`${DID}#authority-signing-key`, `${DID}#inline-key`])
  })

  it('follows a relative reference to a method in verificationMethod', () => {
    const methods = verificationMethodsById(document({ authentication: ['#other-key'] }))
    expect(methods.get(`${DID}#other-key`)?.id).toBe(`${DID}#other-key`)
  })

  it('rejects a dangling reference', () => {
    expect(() => verificationMethodsById(document({ authentication: ['#missing'] }))).toThrow(
      'didDocument has an invalid verification method reference',
    )
  })
})

describe('key thumbprints', () => {
  it('derives the same thumbprint from a private key and its published verification method', () => {
    expect(privateJwkThumbprint(privateJwk)).toBe(verificationMethodThumbprint(signingMethod))
  })

  it('rejects private key material that is not a JWK', () => {
    expect(() => privateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519' } as never)).toThrow(
      'The private key is not a valid JWK',
    )
  })

  it('rejects a verification method without a supported public key', () => {
    expect(() => verificationMethodThumbprint({ id: `${DID}#bare` } as VerificationMethod)).toThrow(
      'does not contain a supported public key',
    )
  })

  it('accepts the matching key and rejects a different one', () => {
    expect(() => assertPrivateKeyMatchesVerificationMethod(privateJwk, signingMethod)).not.toThrow()
    expect(() =>
      assertPrivateKeyMatchesVerificationMethod(otherKeyPair.privateKey.export({ format: 'jwk' }), signingMethod),
    ).toThrow(`The private key does not match verification method "${signingMethod.id}" in didDocument`)
  })
})

describe('didDocumentsEqual', () => {
  it('treats the same document as equal', () => {
    expect(didDocumentsEqual(document(), document())).toBe(true)
  })

  it('detects a changed service endpoint', () => {
    const changed = document({
      service: [{ id: `${DID}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: 'https://elsewhere.example.com' }],
    })

    expect(didDocumentsEqual(document(), changed)).toBe(false)
  })

  it('detects a changed verification method', () => {
    const changed = document({ verificationMethod: [signingMethod] })

    expect(didDocumentsEqual(document(), changed)).toBe(false)
  })
})
