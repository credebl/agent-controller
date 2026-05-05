import type { Curve, EcCurve, EcType, OkpCurve, OkpType } from '../controllers/types'
import type { DidDocument, VerificationMethod } from '@credo-ts/core'
import type { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

import { JsonEncoder, JsonTransformer } from '@credo-ts/core'
import axios from 'axios'
import { randomBytes } from 'crypto'

import { TRUST_SERVICE_ENV_KEYS, curveToKty, keyAlgorithmToCurve } from './constant'
const TOKEN_EXPIRY_BUFFER_SECONDS = 60
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function getTokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'))
    return typeof payload.exp === 'number' ? payload.exp : 0
  } catch {
    return 0
  }
}

function getCachedToken(clientId: string): string | null {
  const cached = tokenCache.get(clientId)
  if (!cached) return null
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (nowSeconds < cached.expiresAt - TOKEN_EXPIRY_BUFFER_SECONDS) {
    return cached.token
  }
  tokenCache.delete(clientId)
  return null
}

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

export function getVerificationMethod(didDocument: DidDocument): VerificationMethod | undefined {
  // Try assertionMethod first
  const assertionMethod = didDocument.assertionMethod?.[0]
  if (assertionMethod) {
    if (typeof assertionMethod === 'string') {
      return didDocument.dereferenceVerificationMethod(assertionMethod)
    }
    return assertionMethod as VerificationMethod
  }
  // Fallback to verificationMethod[0]
  return didDocument.verificationMethod?.[0]
}

export function getAlgFromVerificationMethod(vm: VerificationMethod): string {
  if (vm.type === 'Ed25519VerificationKey2018' || vm.type === 'Ed25519VerificationKey2020') {
    return 'EdDSA'
  }

  if (vm.type === 'JsonWebKey2020' || vm.type === 'JsonWebKey2024') {
    const jwk = vm.publicKeyJwk as any
    if (jwk?.crv === 'P-256') return 'ES256'
    if (jwk?.crv === 'P-384') return 'ES384'
    if (jwk?.crv === 'P-521') return 'ES512'
    if (jwk?.crv === 'secp256k1') return 'ES256K'
  }

  if (vm.type === 'EcdsaSecp256k1VerificationKey2019') {
    return 'ES256K'
  }

  return 'EdDSA'
}

export async function fetchWithTimeout(resource: string, options: any = {}) {
  const { timeout = 10000, ...fetchOptions } = options
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout(id)
  }
}

type Namespaces = Record<string, any>

export function processIsoImages(namespaces: Namespaces): Namespaces {
  const IMAGE_FIELDS = ['portrait', 'enrolment_portrait_image']

  for (const [nsKey, nsValue] of Object.entries(namespaces)) {
    if (!nsKey.includes('org.iso.18013.5') && !nsKey.includes('org.iso.23220')) continue

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

async function fetchPlatformToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  label: string,
): Promise<string> {
  if (!tokenUrl) throw new Error(`[${label}] tokenUrl is required`)
  if (!clientId) throw new Error(`[${label}] clientId is required`)
  if (!clientSecret) throw new Error(`[${label}] clientSecret is required`)

  const cachedToken = getCachedToken(clientId)
  if (cachedToken) {
    return cachedToken
  }

  let tokenResponse
  try {
    tokenResponse = await axios.post<any>(
      tokenUrl,
      { clientId, clientSecret },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json' } },
    )
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `[${label}] platform token request failed with status ${error.response?.status ?? 'no response'}: ${JSON.stringify(error.response?.data ?? error.message)}`,
      )
    }
    throw error
  }

  const token: string = tokenResponse.data?.data?.access_token
  if (!token) {
    throw new Error(`[${label}] access_token not found in platform response`)
  }

  const expiresAt = getTokenExpiry(token)
  tokenCache.set(clientId, { token, expiresAt })

  return token
}

async function checkTrustCertificatesExist(
  trustServiceUrl: string,
  x509: string[],
  label: string,
  tenantId?: string,
  token?: string,
): Promise<boolean> {
  const matchUrl = trustServiceUrl

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  try {
    const matchResponse = await axios.post<{ matched: boolean }>(
      matchUrl,
      { x509, ...(tenantId && { tenantId }) },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json', ...authHeaders } },
    )

    return matchResponse.data?.matched === true
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `[${label}] trust-service match request failed with status ${error.response?.status ?? 'no response'}: ${JSON.stringify(error.response?.data ?? error.message)}`,
      )
    }
    throw error
  }
}

export async function checkX509Certificates(
  x509Certificates: string[],
  isDedicated: boolean,
  tenantId?: string,
): Promise<boolean> {
  const label = 'checkX509Certificates'

  if (!x509Certificates || x509Certificates.length === 0) {
    throw new Error(`[${label}] certificate chain is required but was not provided`)
  }

  const tokenUrl = process.env[TRUST_SERVICE_ENV_KEYS.TOKEN_URL]
  const clientId = process.env[TRUST_SERVICE_ENV_KEYS.CLIENT_ID]
  const clientSecret = process.env[TRUST_SERVICE_ENV_KEYS.CLIENT_SECRET]
  const trustListUrl = process.env[TRUST_SERVICE_ENV_KEYS.TRUST_LIST_URL]

  if (!tokenUrl) throw new Error(`[${label}] ${TRUST_SERVICE_ENV_KEYS.TOKEN_URL} is not configured`)
  if (!clientId) throw new Error(`[${label}] ${TRUST_SERVICE_ENV_KEYS.CLIENT_ID} is not configured`)
  if (!clientSecret) throw new Error(`[${label}] ${TRUST_SERVICE_ENV_KEYS.CLIENT_SECRET} is not configured`)
  if (!trustListUrl) throw new Error(`[${label}] ${TRUST_SERVICE_ENV_KEYS.TRUST_LIST_URL} is not configured`)

  let resolvedTenantId: string | undefined
  if (!isDedicated) {
    resolvedTenantId = tenantId
    if (!resolvedTenantId) throw new Error(`[${label}] tenantId is required for shared agent but was not provided`)
  }

  const token = await fetchPlatformToken(tokenUrl, clientId, clientSecret, label)

  return checkTrustCertificatesExist(trustListUrl, x509Certificates, label, resolvedTenantId, token)
}
