import type { Curve, EcCurve, EcType, OkpCurve, OkpType } from '../controllers/types'
import type { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

import { JsonEncoder, JsonTransformer } from '@credo-ts/core'
import axios from 'axios'
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

async function fetchPlatformToken(platformBaseUrl: string, clientId: string, clientSecret: string, label: string): Promise<string> {
  if (!platformBaseUrl) throw new Error(`[${label}] platformBaseUrl is required`)
  if (!clientId) throw new Error(`[${label}] clientId is required`)
  if (!clientSecret) throw new Error(`[${label}] clientSecret is required`)

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

  return token
}

async function fetchTrustServiceCertificates(trustServiceUrl: string, token: string, ecosystemIds: string[], label: string): Promise<string[]> {
  const certsUrl = `${trustServiceUrl}/api/x509-certificates/ecosystems`
  console.log(`[${label}] fetching certificates from:`, certsUrl, 'ecosystemIds:', ecosystemIds)

  try {
    const certResponse = await axios.get(certsUrl, {
      params: { ecosystemIds: ecosystemIds.join(',') },
      headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
    })

    console.log(`[${label}] certificates response status:`, certResponse.status)
    console.log(`[${label}] certificates response data:`, JSON.stringify(certResponse.data, null, 2))

    if (!Array.isArray(certResponse.data) || certResponse.data.length === 0) {
      throw new Error('No certificates returned from trust-service')
    }

    const certificates: string[] = certResponse.data.map((cert: { certificateData: string }) => cert.certificateData)
    console.log(`[${label}] extracted certificates count:`, certificates.length)

    return certificates
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[${label}] certificates request failed:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      })
      throw new Error(`Failed to fetch certificates from trust-service: ${error.response?.status} ${JSON.stringify(error.response?.data)}`)
    }
    throw error
  }
}

export async function fetchDedicatedX509Certificates(): Promise<string[]> {
  const platformBaseUrl = process.env.PLATFORM_BASE_URL
  const clientId = process.env.PLATFORM_DEDICATED_CLIENT_ID
  const clientSecret = process.env.PLATFORM_DEDICATED_CLIENT_SECRET
  const trustServiceUrl = process.env.TRUST_SERVICE_URL

  if (!platformBaseUrl) throw new Error('PLATFORM_BASE_URL is not configured')
  if (!clientId) throw new Error('PLATFORM_DEDICATED_CLIENT_ID is not configured')
  if (!clientSecret) throw new Error('PLATFORM_DEDICATED_CLIENT_SECRET is not configured')
  if (!trustServiceUrl) throw new Error('TRUST_SERVICE_URL is not configured')

  const token = await fetchPlatformToken(platformBaseUrl, clientId, clientSecret, 'fetchDedicatedX509Certificates')
  return fetchTrustServiceCertificates(trustServiceUrl, token, [], 'fetchDedicatedX509Certificates')
}

export async function fetchSharedAgentX509Certificates(tenantId?: string): Promise<string[]> {
  const label = 'fetchSharedAgentX509Certificates'

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
    console.log(`[${label}] starting certificate fetch for tenantId:`, resolvedTenantId)

  console.log(`[${label}] using tenantId:`, resolvedTenantId, tenantId ? '(from agent context)' : '(from .env)')

  const token = await fetchPlatformToken(platformBaseUrl, clientId, clientSecret, label)

  const ecosystemsUrl = `${platformBaseUrl}/v1/orgs/tenant/${resolvedTenantId}/ecosystems`
  console.log(`[${label}] fetching ecosystem IDs from:`, ecosystemsUrl)

  let ecosystemIds: string[]
  try {
    const ecosystemResponse = await axios.get<{ statusCode: number; message: string; data: string[] }>(
      ecosystemsUrl,
      { headers: { accept: 'application/json', Authorization: `Bearer ${token}` } },
    )

    console.log(`[${label}] ecosystem response status:`, ecosystemResponse.status)
    console.log(`[${label}] ecosystem response data:`, JSON.stringify(ecosystemResponse.data, null, 2))

    ecosystemIds = ecosystemResponse.data.data
    if (!Array.isArray(ecosystemIds) || ecosystemIds.length === 0) {
      throw new Error(`No ecosystem IDs found for tenant: ${resolvedTenantId}`)
    }

    console.log(`[${label}] ecosystem IDs:`, ecosystemIds)
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[${label}] ecosystem IDs request failed:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      })
      throw new Error(`Failed to fetch ecosystem IDs from platform: ${error.response?.status} ${JSON.stringify(error.response?.data)}`)
    }
    throw error
  }

  return fetchTrustServiceCertificates(trustServiceUrl, token, ecosystemIds, label)
}
