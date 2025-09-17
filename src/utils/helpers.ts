import { JsonTransformer } from '@credo-ts/core'
import { JsonEncoder } from '@credo-ts/core/build/utils/JsonEncoder'
import { randomBytes } from 'crypto'

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
  let options: { validityYears?: number, startFromCurrentMonth?: boolean };
  if (IsRootCA) {
    options = {
      validityYears:  parseInt(process.env.ROOT_CA_VALIDITY_YEARS ?? '3'),
      startFromCurrentMonth: (process.env.ROOT_CA_START_FROM_CURRENT_MONTH ?? 'true') === 'true' ? true : false
    }

  } else {
    options = {
      validityYears:  parseInt(process.env.DCS_VALIDITY_YEARS ?? '3'),
      startFromCurrentMonth: (process.env.DCS_START_FROM_CURRENT_MONTH ?? 'true') === 'true' ? true : false
    }

  }

  return getCertificateValidity(options);

}

export function getCertificateValidity(options?: {
  validityYears?: number
  startFromCurrentMonth?: boolean
}) {
  const {
    validityYears = 3,
    startFromCurrentMonth = false,
  } = options || {}

  const now = new Date()

  const startYear = now.getUTCFullYear()
  const startMonth = startFromCurrentMonth ? now.getUTCMonth() : 0 // 0 = January
  const startDay = now.getUTCDate()

  const notBefore = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0))
  const notAfter = new Date(Date.UTC(startYear + validityYears, startMonth, startDay, 0, 0, 0))

  return { notBefore, notAfter }
}