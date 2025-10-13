import { createPrivateKey, KeyObject } from 'crypto'

/**
 * Extracts the raw private key (hex) from a PEM-encoded EC (P-256) private key.
 */
async function pemToRawEcPrivateKey(pem: string): Promise<string> {
  const keyObj: KeyObject = createPrivateKey({
    key: pem,
    format: 'pem',
  })

  // Extract raw private key (as Buffer)
  const rawPrivateKey = keyObj.export({
    format: 'jwk',
  }).d!

  return Buffer.from(rawPrivateKey, 'base64').toString('hex')
}

/**
 * Extracts the raw private key (hex) from a PEM-encoded Ed25519 private key.
 */
export async function pemToRawEd25519PrivateKey(derKey: string | Buffer): Promise<string> {
  // If it's a base64 string, convert to Buffer
  const keyBuffer = typeof derKey === 'string' ? Buffer.from(derKey, 'base64') : derKey

  const keyObj: KeyObject = createPrivateKey({
    key: keyBuffer,
    format: 'der',
    type: 'pkcs8', // Use 'pkcs8' for private keys (works for Ed25519, P256, RSA)
  })

  // Ed25519 JWK exports the *seed* (first 32 bytes of the private key)
  const jwk = keyObj.export({ format: 'jwk' })
  if (!jwk.d) throw new Error('Not an Ed25519 private key')

  return Buffer.from(jwk.d, 'base64').toString('hex')
}
