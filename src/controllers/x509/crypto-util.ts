import type { KeyObject } from 'crypto'

import { createPrivateKey } from 'crypto'

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
 * Extracts the raw private key (hex) from a private key in PEM or base64 DER
 * (PKCS#8) form. Platform and studio forward the key as base64 DER, while
 * users importing a certificate often paste the PEM they generated.
 */
export async function pemToRawPrivateKey(derKey: string | Buffer): Promise<string> {
  const isPem = typeof derKey === 'string' && derKey.includes('-----BEGIN')

  const keyObj: KeyObject = isPem
    ? createPrivateKey({
        key: derKey as string,
        format: 'pem',
      })
    : createPrivateKey({
        key: typeof derKey === 'string' ? Buffer.from(derKey, 'base64') : derKey,
        format: 'der',
        type: 'pkcs8', // Use 'pkcs8' for private keys (works for Ed25519, P256, RSA)
      })

  // Ed25519 JWK exports the *seed* (first 32 bytes of the private key)
  const jwk = keyObj.export({ format: 'jwk' })
  if (!jwk.d) throw new Error('Failed to extract private key material: missing d component in JWK')

  return Buffer.from(jwk.d, 'base64').toString('hex')
}
