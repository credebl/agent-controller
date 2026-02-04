import type { Curve } from '../controllers/types'

import { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

export const X509_CERTIFICATE_RECORD = 'X509_CERTIFICATE'
export const keyAlgorithmToCurve: Partial<Record<KeyAlgorithm, Curve>> = {
  [KeyAlgorithm.Ed25519]: 'Ed25519',
  [KeyAlgorithm.X25519]: 'X25519',

  [KeyAlgorithm.EcSecp256r1]: 'P-256',
  [KeyAlgorithm.EcSecp384r1]: 'P-384',
  [KeyAlgorithm.EcSecp256k1]: 'secp256k1',
}
export const curveToKty = {
  Ed25519: 'OKP',
  X25519: 'OKP',
  'P-256': 'EC',
  'P-384': 'EC',
  'P-521': 'EC',
  secp256k1: 'EC',
} as const

export const verkey = '#verkey'
export const p521 = 'p521'
