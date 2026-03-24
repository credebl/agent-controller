import type { Curve, EcCurve, EcType, OkpCurve, OkpType } from '../controllers/types'
import type { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

import { JsonEncoder, JsonTransformer, X509Certificate } from '@credo-ts/core'
import axios from 'axios'
import { randomBytes } from 'crypto'

import { curveToKty, keyAlgorithmToCurve } from './constant'
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
  platformBaseUrl: string,
  clientId: string,
  clientSecret: string,
  label: string,
): Promise<string> {
  if (!platformBaseUrl) throw new Error(`[${label}] platformBaseUrl is required`)
  if (!clientId) throw new Error(`[${label}] clientId is required`)
  if (!clientSecret) throw new Error(`[${label}] clientSecret is required`)

  const cachedToken = getCachedToken(clientId)
  if (cachedToken) {
    console.log(`[${label}] using cached token for clientId:`, clientId)
    return cachedToken
  }

  const tokenUrl = `${platformBaseUrl}/v1/orgs/${clientId}/token`
  console.log(`[${label}] fetching token from:`, tokenUrl)

  let tokenResponse
  try {
    tokenResponse = await axios.post<any>(
      tokenUrl,
      { clientSecret },
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
  token: string,
  x509: string[],
  label: string,
  tenantId?: string,
): Promise<boolean> {
  const matchUrl = `${trustServiceUrl}/api/x509-certificates/match`
  console.log(`[${label}] calling match API:`, matchUrl)

  try {
    const matchResponse = await axios.post<boolean>(
      matchUrl,
      { x509, ...(tenantId && { tenantId }) },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json', Authorization: `Bearer ${token}` } },
    )

    console.log(`[${label}] match response status:`, matchResponse.status)
    console.log(`[${label}] match response data:`, matchResponse.data)

    if (!matchResponse.data) {
      console.warn(`[${label}] certificate chain not trusted${tenantId ? ` for tenantId: ${tenantId}` : ''}`)
      return false
    }

    return matchResponse.data
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

export async function checkDedicatedX509Certificates(certificateChain: X509Certificate[]): Promise<boolean> {
  const label = 'checkDedicatedX509Certificates'

  const platformBaseUrl = process.env.PLATFORM_BASE_URL
  const clientId = process.env.PLATFORM_DEDICATED_CLIENT_ID
  const clientSecret = process.env.PLATFORM_DEDICATED_CLIENT_SECRET
  const trustServiceUrl = process.env.TRUST_SERVICE_URL

  if (!platformBaseUrl) throw new Error('PLATFORM_BASE_URL is not configured')
  if (!clientId) throw new Error('PLATFORM_DEDICATED_CLIENT_ID is not configured')
  if (!clientSecret) throw new Error('PLATFORM_DEDICATED_CLIENT_SECRET is not configured')
  if (!trustServiceUrl) throw new Error('TRUST_SERVICE_URL is not configured')

  if (!certificateChain || certificateChain.length === 0) {
    throw new Error(`[${label}] certificate chain is required but was not provided`)
  }

  const token = await fetchPlatformToken(platformBaseUrl, clientId, clientSecret, label)
  const x509 = certificateChain.map((cert) => cert.toString('base64'))
  console.log(`[${label}] certificate chain length:`, x509.length)

  return checkTrustCertificatesExist(trustServiceUrl, token, x509, label)
}

export async function checkSharedAgentX509Certificates(tenantId?: string, certificateChain?: X509Certificate[]): Promise<boolean> {
  const label = 'checkSharedAgentX509Certificates'

  const platformBaseUrl = process.env.PLATFORM_BASE_URL
  const clientId = process.env.PLATFORM_SHARED_AGENT_CLIENT_ID
  const clientSecret = process.env.PLATFORM_SHARED_AGENT_CLIENT_SECRET
  const resolvedTenantId = tenantId ?? process.env.PLATFORM_SHARED_AGENT_TENANT_ID
  const trustServiceUrl = process.env.TRUST_SERVICE_URL

  if (!platformBaseUrl) throw new Error('PLATFORM_BASE_URL is not configured')
  if (!clientId) throw new Error('PLATFORM_SHARED_AGENT_CLIENT_ID is not configured')
  if (!clientSecret) throw new Error('PLATFORM_SHARED_AGENT_CLIENT_SECRET is not configured')
  if (!resolvedTenantId) throw new Error('tenantId not provided and PLATFORM_SHARED_AGENT_TENANT_ID is not configured')
  if (!trustServiceUrl) throw new Error('TRUST_SERVICE_URL is not configured')

  console.log(`[${label}] using tenantId:`, resolvedTenantId, tenantId ? '(from agent context)' : '(from .env)')

  if (!certificateChain || certificateChain.length === 0) {
    throw new Error(`[${label}] certificate chain is required but was not provided`)
  }

  const token = await fetchPlatformToken(platformBaseUrl, clientId, clientSecret, label)

  const x509 = certificateChain.map((cert) => cert.toString('base64'))
  console.log(`[${label}] certificate chain length:`, x509.length)

  return checkTrustCertificatesExist(trustServiceUrl, token, x509, label, resolvedTenantId)
}
