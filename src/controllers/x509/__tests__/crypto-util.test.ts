import { generateKeyPairSync } from 'node:crypto'

import { pemToRawPrivateKey } from '../crypto-util'

describe('pemToRawPrivateKey', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const expected = Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64').toString('hex')

  it('reads a PKCS#8 PEM key', async () => {
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    await expect(pemToRawPrivateKey(pem)).resolves.toBe(expected)
  })

  it('reads a base64 PKCS#8 DER key', async () => {
    const derBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
    await expect(pemToRawPrivateKey(derBase64)).resolves.toBe(expected)
  })
})
