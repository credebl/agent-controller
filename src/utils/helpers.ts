import type { Curve, EcCurve, EcType, OkpCurve, OkpType } from '../controllers/types'
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
    console.log(`[${label}] using cached token for clientId:`, clientId)
    return cachedToken
  }

  console.log(`[${label}] fetching token from:`, tokenUrl)

  let tokenResponse
  try {
    tokenResponse = await axios.post<any>(
      tokenUrl,
      { clientId, clientSecret },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json' } },
    )
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[${label}] token request failed:`, {
        url: tokenUrl,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      })
      throw new Error(
        `[${label}] platform token request failed with status ${error.response?.status ?? 'no response'}: ${JSON.stringify(error.response?.data ?? error.message)}`,
      )
    }
    throw error
  }

  console.log(`[${label}] token response status:`, tokenResponse.status)
  console.log(`[${label}] token response data:`, JSON.stringify(tokenResponse.data, null, 2))

  const token: string = tokenResponse.data?.data?.access_token
  if (!token) {
    console.error(`[${label}] unexpected token response shape:`, JSON.stringify(tokenResponse.data, null, 2))
    throw new Error(`[${label}] access_token not found in platform response`)
  }

  const expiresAt = getTokenExpiry(token)
  tokenCache.set(clientId, { token, expiresAt })
  console.log(`[${label}] token cached for clientId:`, clientId, '| expires at:', new Date(expiresAt * 1000).toISOString())

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
  console.log(`[${label}] calling match API:`, matchUrl)

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  try {
    const matchResponse = await axios.post<{ matched: boolean }>(
      matchUrl,
      { x509, ...(tenantId && { tenantId }) },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json', ...authHeaders } },
    )

    console.log(`[${label}] match response status:`, matchResponse.status)

    const isTrusted = matchResponse.data?.matched === true
    console.log(`[${label}] isTrusted:`, isTrusted)

    if (!isTrusted) {
      console.warn(`[${label}] certificate chain not trusted${tenantId ? ` for tenantId: ${tenantId}` : ''}`)
    }

    return isTrusted
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[${label}] match request failed:`, {
        url: matchUrl,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      })
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
    console.log(`[${label}] using tenantId:`, resolvedTenantId)
  }

  console.log(`[${label}] agent type: ${isDedicated ? 'dedicated' : 'shared'}, certificates:`, x509Certificates)

  const token = await fetchPlatformToken(tokenUrl, clientId, clientSecret, label)

  return checkTrustCertificatesExist(trustListUrl, x509Certificates, label, resolvedTenantId, token)
}
