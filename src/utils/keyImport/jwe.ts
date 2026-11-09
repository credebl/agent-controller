import type { JsonWebKey, KeyObject } from 'node:crypto'

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  generateKeyPair,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'

/**
 * Compact JWE used to protect private key material on its way to the agent.
 *
 * The client encrypts the key to an ephemeral RSA public key that only this agent process holds the private key for.
 * The protected header is the JWE associated data, so a client cannot move an envelope to another session or DID
 * method without invalidating the AES-GCM tag. The format is standard JWE compact serialization with
 * `RSA-OAEP-256` + `A256GCM`, so any JOSE library can produce it (see docs/key-import-security.md).
 */
export const KEY_IMPORT_JWE_ALG = 'RSA-OAEP-256'
export const KEY_IMPORT_JWE_ENC = 'A256GCM'

/** An RSA 3072 session key is used for at most a few minutes and protects one small payload. */
const SESSION_KEY_MODULUS_LENGTH = 3072
const IV_LENGTH = 12
const TAG_LENGTH = 16
const CEK_LENGTH = 32

/** Hard limits so a malformed or hostile envelope cannot make the agent allocate unbounded memory. */
export const MAX_KEY_IMPORT_JWE_LENGTH = 200_000
export const MAX_KEY_IMPORT_PLAINTEXT_LENGTH = 50_000

export interface KeyImportJweHeader {
  alg: typeof KEY_IMPORT_JWE_ALG
  enc: typeof KEY_IMPORT_JWE_ENC
  /** Key id of the import session, the same value as `sid`. Mirrors the JOSE `kid` header. */
  kid: string
  /** Import session id. */
  sid: string
  /** DID method the material is imported for: `key`, `web` or `x509`. */
  method: string
  /** Expiry of the session as a Unix timestamp in seconds. */
  exp: number
  [claim: string]: unknown
}

export class KeyImportEnvelopeError extends Error {
  public constructor(message = 'The encrypted key payload is invalid') {
    super(message)
    this.name = 'KeyImportEnvelopeError'
  }
}

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url')
}

/**
 * Generates the per-session key pair. The public key is handed to the client, the private key stays in this process.
 * RSA 3072 generation can take hundreds of milliseconds, so it runs on the libuv thread pool instead of blocking the
 * event loop for every tenant.
 */
export async function createKeyImportKeyPair(): Promise<{ publicJwk: JsonWebKey; privateKey: KeyObject }> {
  const { publicKey, privateKey } = await new Promise<{ publicKey: KeyObject; privateKey: KeyObject }>(
    (resolve, reject) => {
      generateKeyPair(
        'rsa',
        { modulusLength: SESSION_KEY_MODULUS_LENGTH, publicExponent: 0x10001 },
        (error, generatedPublicKey, generatedPrivateKey) =>
          error ? reject(error) : resolve({ publicKey: generatedPublicKey, privateKey: generatedPrivateKey }),
      )
    },
  )

  return { publicJwk: publicKey.export({ format: 'jwk' }) as JsonWebKey, privateKey }
}

/**
 * Encrypts key material as a compact JWE. Exported for the CLI/reference client and unit tests; the REST agent only
 * decrypts envelopes.
 */
export function encryptKeyImportEnvelope(publicJwk: JsonWebKey, plaintext: Buffer, header: KeyImportJweHeader): string {
  if (plaintext.length === 0) throw new KeyImportEnvelopeError('The key payload is empty')
  if (plaintext.length > MAX_KEY_IMPORT_PLAINTEXT_LENGTH) {
    throw new KeyImportEnvelopeError('The key payload is too large')
  }

  const protectedSegment = base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'))
  const contentEncryptionKey = randomBytes(CEK_LENGTH)
  const publicKey = createPublicKey({ key: publicJwk, format: 'jwk' })
  const encryptedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    contentEncryptionKey,
  )

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(`aes-${CEK_LENGTH * 8}-gcm`, contentEncryptionKey, iv)
  cipher.setAAD(Buffer.from(protectedSegment, 'ascii'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    protectedSegment,
    base64UrlEncode(encryptedKey),
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(tag),
  ].join('.')
}

/**
 * Decrypts a compact JWE produced by {@link encryptKeyImportEnvelope} or any standards compliant JOSE client. Every
 * failure is mapped to the same generic error so a caller cannot probe the session or the ciphertext.
 */
export function decryptKeyImportEnvelope(
  privateKey: KeyObject,
  jwe: string,
): { plaintext: Buffer; header: KeyImportJweHeader } {
  if (typeof jwe !== 'string' || jwe.length === 0 || jwe.length > MAX_KEY_IMPORT_JWE_LENGTH) {
    throw new KeyImportEnvelopeError()
  }

  const segments = jwe.split('.')
  if (segments.length !== 5) throw new KeyImportEnvelopeError()

  const [protectedSegment, encryptedKeySegment, ivSegment, ciphertextSegment, tagSegment] = segments
  if (!protectedSegment || !encryptedKeySegment || !ivSegment || !ciphertextSegment || !tagSegment) {
    throw new KeyImportEnvelopeError()
  }

  let header: KeyImportJweHeader
  try {
    header = JSON.parse(Buffer.from(protectedSegment, 'base64url').toString('utf8')) as KeyImportJweHeader
  } catch {
    throw new KeyImportEnvelopeError()
  }
  if (header?.alg !== KEY_IMPORT_JWE_ALG || header?.enc !== KEY_IMPORT_JWE_ENC) {
    throw new KeyImportEnvelopeError('Unsupported key import encryption')
  }

  try {
    const contentEncryptionKey = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encryptedKeySegment, 'base64url'),
    )
    if (contentEncryptionKey.length !== CEK_LENGTH) throw new KeyImportEnvelopeError()

    const iv = Buffer.from(ivSegment, 'base64url')
    const tag = Buffer.from(tagSegment, 'base64url')
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new KeyImportEnvelopeError()

    const decipher = createDecipheriv(`aes-${CEK_LENGTH * 8}-gcm`, contentEncryptionKey, iv)
    decipher.setAAD(Buffer.from(protectedSegment, 'ascii'))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextSegment, 'base64url')), decipher.final()])

    if (plaintext.length === 0 || plaintext.length > MAX_KEY_IMPORT_PLAINTEXT_LENGTH) {
      throw new KeyImportEnvelopeError()
    }

    return { plaintext, header }
  } catch (error) {
    if (error instanceof KeyImportEnvelopeError) throw error
    throw new KeyImportEnvelopeError()
  }
}
