import type { Curve, EcCurve, EcType, OkpCurve, OkpType } from '../controllers/types'
import type { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

import { JsonEncoder, JsonTransformer } from '@credo-ts/core'
import { randomBytes } from 'crypto'

import { curveToKty, keyAlgorithmToCurve } from './constant'

export function objectToJson<T>(result: T) {
  const serialized = JsonTransformer.serialize(result)
  return JsonEncoder.fromString(serialized)
}

export async function generateSecretKey(length: number = 32): Promise<string> {
  // Asynchronously generate a buffer containing random values
  const buffer: Buffer = await new Promise((resolve, reject) => {
    randomBytes(length, (error, buf) => {
      if (error) {
        reject(error)
      } else {
        resolve(buf)
      }
    })
  })

  // Convert the buffer to a hexadecimal string
  const secretKey: string = buffer.toString('hex')

  return secretKey
}

export function getCertificateValidityForSystem(IsRootCA = false) {
  let options: { validityYears?: number; startFromCurrentMonth?: boolean }
  if (IsRootCA) {
    options = {
      validityYears: parseInt(process.env.ROOT_CA_VALIDITY_YEARS ?? '3'),
      startFromCurrentMonth: (process.env.ROOT_CA_START_FROM_CURRENT_MONTH ?? 'true') === 'true' ? true : false,
    }
  } else {
    options = {
      validityYears: parseInt(process.env.DCS_VALIDITY_YEARS ?? '3'),
      startFromCurrentMonth: (process.env.DCS_START_FROM_CURRENT_MONTH ?? 'true') === 'true' ? true : false,
    }
  }

  return getCertificateValidity(options)
}

export function getCertificateValidity(options?: { validityYears?: number; startFromCurrentMonth?: boolean }) {
  const { validityYears = 3, startFromCurrentMonth = false } = options || {}

  const now = new Date()

  const startYear = now.getUTCFullYear()
  const startMonth = startFromCurrentMonth ? now.getUTCMonth() : 0 // 0 = January
  const startDay = now.getUTCDate()

  const notBefore = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0))
  const notAfter = new Date(Date.UTC(startYear + validityYears, startMonth, startDay, 0, 0, 0))

  return { notBefore, notAfter }
}

function normalizeToCurve(input: Curve | KeyAlgorithm): Curve | undefined {
  // Already a Curve
  if (input in curveToKty) {
    return input as Curve
  }

  // Try mapping from KeyAlgorithm
  return keyAlgorithmToCurve[input as KeyAlgorithm]
}

export function getTypeFromCurve(key: Curve | KeyAlgorithm): OkpType | EcType {
  let keyTypeInfo: OkpType | EcType
  const normalizedCurve = normalizeToCurve(key)
  if (normalizedCurve && curveToKty[normalizedCurve] === 'OKP') {
    keyTypeInfo = {
      kty: 'OKP',
      crv: normalizedCurve as OkpCurve,
    }
  } else if (normalizedCurve && curveToKty[normalizedCurve] === 'EC') {
    keyTypeInfo = {
      kty: 'EC',
      crv: normalizedCurve as EcCurve,
    }
  } else {
    keyTypeInfo = {
      kty: 'EC',
      crv: 'P-256',
    }
  }
  return keyTypeInfo
}

type Namespaces = Record<string, any>

export function processIsoImages(namespaces: Namespaces): Namespaces {
  const IMAGE_FIELDS = ['portrait', 'enrolment_portrait_image']

  for (const [nsKey, nsValue] of Object.entries(namespaces)) {
    if (!nsKey.includes('org.iso')) continue

    for (const field of IMAGE_FIELDS) {
      const value = nsValue[field]

      if (value && typeof value === 'string') {
        nsValue[field] = safeBase64DataUrlToUint8Array(value)
      }
    }
  }

  return namespaces
}

function safeBase64DataUrlToUint8Array(dataUrl: string): Uint8Array | string {
  try {
    if (typeof dataUrl !== 'string') return dataUrl

    // Must contain base64 data
    if (!dataUrl.includes('base64,')) return dataUrl

    const parts = dataUrl.split(',')
    if (parts.length < 2) return dataUrl

    const base64 = parts[1]

    // Node.js safe decode (will throw if invalid)
    const buffer = Buffer.from(base64, 'base64')

    // Extra validation: ensure it decoded something meaningful
    if (!buffer || buffer.length === 0) {
      return dataUrl
    }

    return new Uint8Array(buffer)
  } catch (err) {
    // fallback → keep original string
    return dataUrl
  }
}
