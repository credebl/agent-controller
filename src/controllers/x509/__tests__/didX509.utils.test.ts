import type { KeyObject } from 'node:crypto'

import { resolveDid } from '@didx509/core'
import { X509CertificateGenerator, X509Certificate, BasicConstraintsExtension } from '@peculiar/x509'
import { generateKeyPairSync, webcrypto } from 'node:crypto'

import {
  assertKeyMatchesCertificate,
  buildDidX509,
  buildPolicy,
  parseCertificateChain,
  parsePrivateKey,
  parsePrivateKeyJwk,
  privateKeyToJwk,
  toX509ChainOption,
} from '../didX509.utils'

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbol the utils touch is stubbed.
jest.mock('@credo-ts/core', () => ({ DidRepository: class {} }))

type Algorithm = 'P-256' | 'P-384' | 'P-521' | 'Ed25519' | 'RSA'

const algorithms: Record<Algorithm, { generate: () => { privateKey: KeyObject; publicKey: KeyObject }; sign: object }> =
  {
    'P-256': {
      generate: () => generateKeyPairSync('ec', { namedCurve: 'P-256' }),
      sign: { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' },
    },
    'P-384': {
      generate: () => generateKeyPairSync('ec', { namedCurve: 'P-384' }),
      sign: { name: 'ECDSA', namedCurve: 'P-384', hash: 'SHA-384' },
    },
    'P-521': {
      generate: () => generateKeyPairSync('ec', { namedCurve: 'P-521' }),
      sign: { name: 'ECDSA', namedCurve: 'P-521', hash: 'SHA-512' },
    },
    Ed25519: { generate: () => generateKeyPairSync('ed25519'), sign: { name: 'Ed25519' } },
    RSA: {
      generate: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
      sign: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    },
  }

/** Generates a root CA -> leaf chain where the leaf uses the given key type, like a CA issued certificate would. */
async function createChain(algorithm: Algorithm) {
  const { generate, sign } = algorithms[algorithm]
  const toWebKeys = async (pair: { privateKey: KeyObject; publicKey: KeyObject }) => {
    const importAlgorithm = algorithm === 'RSA' ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : sign
    return {
      privateKey: await webcrypto.subtle.importKey(
        'pkcs8',
        pair.privateKey.export({ format: 'der', type: 'pkcs8' }),
        importAlgorithm,
        true,
        ['sign'],
      ),
      publicKey: await webcrypto.subtle.importKey(
        'spki',
        pair.publicKey.export({ format: 'der', type: 'spki' }),
        importAlgorithm,
        true,
        ['verify'],
      ),
    }
  }

  const caPair = generate()
  const leafPair = generate()
  const ca = await toWebKeys(caPair)
  const leaf = await toWebKeys(leafPair)

  const root = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=Test Root CA, O=Test Org, C=US',
    keys: ca,
    signingAlgorithm: sign,
    extensions: [new BasicConstraintsExtension(true, undefined, true)],
  })
  const leafCertificate = await X509CertificateGenerator.create({
    subject: 'CN=issuer.example.com, O=Test Org, C=US',
    issuer: root.subject,
    publicKey: leaf.publicKey,
    signingKey: ca.privateKey,
    signingAlgorithm: sign,
  })

  return { root, leaf: leafCertificate, leafPrivateKey: leafPair.privateKey }
}

describe.each(Object.keys(algorithms) as Algorithm[])('did:x509 import utils (%s)', (algorithm) => {
  let chain: Awaited<ReturnType<typeof createChain>>

  beforeAll(async () => {
    chain = await createChain(algorithm)
  })

  it('reads PEM and base64 DER chains leaf first', () => {
    const pem = parseCertificateChain([chain.leaf.toString('pem'), chain.root.toString('pem')])
    const bundle = parseCertificateChain([`${chain.leaf.toString('pem')}\n${chain.root.toString('pem')}`])
    const der = parseCertificateChain([chain.leaf.toString('base64'), chain.root.toString('base64')])

    for (const parsed of [pem, bundle, der]) {
      expect(parsed).toHaveLength(2)
      expect(parsed[0].subject).toBe(chain.leaf.subject)
      expect(parsed[1].subject).toBe(chain.root.subject)
    }
  })

  it('builds a did:x509 that resolves against the chain and exposes the leaf key', async () => {
    const parsed = parseCertificateChain([chain.leaf.toString('pem'), chain.root.toString('pem')])
    const did = await buildDidX509(parsed, [{ type: 'subject', fields: { CN: 'issuer.example.com' } }])

    expect(did).toMatch(/^did:x509:0:sha256:[A-Za-z0-9_-]+::subject:CN:issuer\.example\.com$/)

    const document = await resolveDid(did, parsed)
    expect(document.id).toBe(did)
    expect(document.verificationMethod).toHaveLength(1)
  })

  it('reads the private key as PEM and DER and checks it against the leaf certificate', () => {
    const pem = chain.leafPrivateKey.export({ format: 'pem', type: 'pkcs8' }) as string
    const der = (chain.leafPrivateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64')
    const leaf = parseCertificateChain([chain.leaf.toString('pem')])[0]

    for (const key of [pem, der]) {
      const parsedKey = parsePrivateKey(key)
      expect(() => assertKeyMatchesCertificate(parsedKey, leaf)).not.toThrow()
      expect(privateKeyToJwk(parsedKey).kty).toBe(algorithm === 'RSA' ? 'RSA' : algorithm === 'Ed25519' ? 'OKP' : 'EC')
    }
  })

  it('rejects a private key that does not belong to the leaf certificate', () => {
    const other = parsePrivateKey(
      algorithms[algorithm].generate().privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    )
    const leaf = parseCertificateChain([chain.leaf.toString('pem')])[0]
    expect(() => assertKeyMatchesCertificate(other, leaf)).toThrow('does not match')
  })

  it('formats the chain as the x509chain resolution option', () => {
    const parsed = parseCertificateChain([chain.leaf.toString('pem'), chain.root.toString('pem')])
    const option = toX509ChainOption(parsed).split(',')
    expect(option).toHaveLength(2)
    expect(new X509Certificate(Buffer.from(option[0], 'base64url')).subject).toBe(chain.leaf.subject)
  })
})

describe('did:x509 policies and key parsing', () => {
  it('percent encodes policy values', () => {
    expect(buildPolicy({ type: 'subject', fields: { CN: 'a b', O: 'x:y' } })).toBe('subject:CN:a%20b:O:x%3Ay')
    expect(buildPolicy({ type: 'san', sanType: 'dns', value: 'example.com' })).toBe('san:dns:example.com')
    expect(buildPolicy({ type: 'eku', value: '1.3.6.1.5.5.7.3.3' })).toBe('eku:1.3.6.1.5.5.7.3.3')
  })

  it('rejects incomplete policies', () => {
    expect(() => buildPolicy({ type: 'subject' })).toThrow('at least one field')
    expect(() => buildPolicy({ type: 'san', value: 'example.com' })).toThrow('sanType')
  })

  it('rejects garbage as private key and as certificate', () => {
    expect(() => parsePrivateKey('not a key')).toThrow('Unable to read privateKey')
    expect(() => parseCertificateChain(['not a certificate'])).toThrow('invalid certificate')
  })
})

describe('parsePrivateKeyJwk', () => {
  it.each(['P-256', 'P-384', 'P-521', 'Ed25519', 'RSA'] as const)(
    'reads a %s private JWK given as an object',
    (type) => {
      const { privateKey } = algorithms[type].generate()
      const jwk = privateKey.export({ format: 'jwk' })

      const parsed = parsePrivateKeyJwk(jwk as Record<string, unknown>)
      expect(parsed.type).toBe(privateKey.type)
      expect(parsed.asymmetricKeyType).toBe(privateKey.asymmetricKeyType)
    },
  )

  it('reads a private JWK given as a JSON string', () => {
    const { privateKey } = algorithms['P-256'].generate()
    const jwk = JSON.stringify(privateKey.export({ format: 'jwk' }))

    const parsed = parsePrivateKeyJwk(jwk)
    expect(parsed.asymmetricKeyType).toBe('ec')
  })

  it('rejects public JWKs, symmetric keys and invalid input', () => {
    const { publicKey } = algorithms['P-256'].generate()

    expect(() => parsePrivateKeyJwk(publicKey.export({ format: 'jwk' }) as Record<string, unknown>)).toThrow(
      'expected a private JWK',
    )
    expect(() => parsePrivateKeyJwk({ kty: 'oct', d: 'c2VjcmV0' })).toThrow('symmetric (oct) keys are not supported')
    expect(() => parsePrivateKeyJwk('{not json')).toThrow('Unable to read privateKeyJwk')
    expect(() => parsePrivateKeyJwk({})).toThrow('expected a JWK object with a kty parameter')
  })
})
