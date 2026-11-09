import type { AgentContext, JsonObject } from '@credo-ts/core'

import { decodeBitstring, getBit } from './bitstring'

const BITSTRING_ENTRY_TYPE = 'BitstringStatusListEntry'
const BITSTRING_LIST_TYPE = 'BitstringStatusList'
const BITSTRING_LIST_CREDENTIAL_TYPE = 'BitstringStatusListCredential'
const REVOCATION_PURPOSE = 'revocation'

export interface BitstringStatusVerificationOptions {
  allowedOrigins?: string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
  requireIssuerMatch?: boolean
  verifyListCredential?: (
    agentContext: AgentContext,
    credential: JsonObject,
  ) => Promise<{ isValid: boolean; error?: Error }>
}

export interface BitstringStatusVerificationResult {
  checked: boolean
  revoked: boolean
  verified: boolean
  statusListUri?: string
  statusListIndex?: number
  statusPurpose?: string
  error?: string
}

interface ParsedCredential {
  credential: JsonObject
  issuerId?: string
}

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as JsonObject
}

function parseCredential(input: JsonObject | string): ParsedCredential {
  if (typeof input === 'object') {
    return { credential: input, issuerId: getIssuerId(input) }
  }

  const trimmed = input.trim()
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as JsonObject
    return { credential: parsed, issuerId: getIssuerId(parsed) }
  }

  const parts = input.split('.')
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('Invalid JWT')
  }

  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JsonObject
  const vc = asJsonObject(claims.vc)
  const credential = vc ?? claims
  return { credential, issuerId: getIssuerId(credential) }
}

function getIssuerId(credential: JsonObject): string | undefined {
  const issuer = credential.issuer
  if (typeof issuer === 'string') {
    return issuer
  }
  const issuerObject = asJsonObject(issuer)
  return typeof issuerObject?.id === 'string' ? issuerObject.id : undefined
}

function getTypes(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

function getStatusEntry(credential: JsonObject): JsonObject | undefined {
  const raw = credential.credentialStatus
  const entries = Array.isArray(raw) ? raw : [raw]
  return entries.map(asJsonObject).find((entry) => getTypes(entry?.type).includes(BITSTRING_ENTRY_TYPE))
}

function normalizeOrigins(origins: string[]): string[] {
  return origins
    .map((origin) => {
      try {
        return new URL(origin).origin
      } catch {
        return undefined
      }
    })
    .filter((origin): origin is string => Boolean(origin))
}

function getAllowedOrigins(options: BitstringStatusVerificationOptions): string[] {
  if (options.allowedOrigins) {
    return normalizeOrigins(options.allowedOrigins)
  }

  const configured = [
    process.env.STATUS_LIST_SERVER_URL,
    ...(process.env.STATUS_LIST_ALLOWED_ORIGINS ?? '').split(','),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  return normalizeOrigins(configured)
}

function failure(
  error: string,
  extra: Partial<BitstringStatusVerificationResult> = {},
): BitstringStatusVerificationResult {
  return {
    checked: true,
    revoked: false,
    verified: false,
    error,
    ...extra,
  }
}

function parseStatusListIndex(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const index = Number(value)
    return Number.isSafeInteger(index) ? index : undefined
  }
  return undefined
}

async function verifyListProof(
  agentContext: AgentContext,
  listCredential: JsonObject,
  options: BitstringStatusVerificationOptions,
): Promise<{ isValid: boolean; error?: Error }> {
  if (options.verifyListCredential) {
    return options.verifyListCredential(agentContext, listCredential)
  }

  const { verifyV2Credential } = await import('../vc-jsonld/verifyV2Credential')
  return verifyV2Credential(agentContext, { credential: listCredential })
}

export async function verifyBitstringStatus(
  agentContext: AgentContext,
  input: JsonObject | string,
  options: BitstringStatusVerificationOptions = {},
): Promise<BitstringStatusVerificationResult> {
  let parsed: ParsedCredential
  try {
    parsed = parseCredential(input)
  } catch (error) {
    return failure(`Unable to parse credential: ${error instanceof Error ? error.message : String(error)}`)
  }

  const entry = getStatusEntry(parsed.credential)
  if (!entry) {
    return { checked: false, revoked: false, verified: true }
  }

  const statusPurpose = entry.statusPurpose
  if (statusPurpose !== REVOCATION_PURPOSE) {
    return failure(`Unsupported statusPurpose '${String(statusPurpose)}'`, {
      statusPurpose: typeof statusPurpose === 'string' ? statusPurpose : undefined,
    })
  }

  const statusListIndex = parseStatusListIndex(entry.statusListIndex)
  if (statusListIndex === undefined) {
    return failure('statusListIndex must be a non-negative integer', { statusPurpose })
  }

  const statusListUri = entry.statusListCredential
  if (typeof statusListUri !== 'string' || statusListUri.length === 0) {
    return failure('statusListCredential must be a non-empty string', { statusPurpose, statusListIndex })
  }

  let listUrl: URL
  try {
    listUrl = new URL(statusListUri)
  } catch {
    return failure('statusListCredential must be an absolute URL', { statusPurpose, statusListIndex, statusListUri })
  }

  if (listUrl.protocol !== 'https:' && listUrl.protocol !== 'http:') {
    return failure('statusListCredential must use http or https', {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  const allowedOrigins = getAllowedOrigins(options)
  if (allowedOrigins.length === 0) {
    return failure('No status list server origins are configured', {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }
  if (!allowedOrigins.includes(listUrl.origin)) {
    return failure(`statusListCredential origin '${listUrl.origin}' is not allowed`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 10000

  let response: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      response = await fetchImpl(listUrl.toString(), {
        headers: { accept: 'application/ld+json, application/json' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    return failure(`Unable to fetch status list: ${error instanceof Error ? error.message : String(error)}`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (!response.ok) {
    return failure(`Status list request failed with HTTP ${response.status}`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  let listCredential: JsonObject
  try {
    listCredential = (await response.json()) as JsonObject
  } catch (error) {
    return failure(
      `Status list response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      {
        statusPurpose,
        statusListIndex,
        statusListUri,
      },
    )
  }

  if (!getTypes(listCredential.type).includes(BITSTRING_LIST_CREDENTIAL_TYPE)) {
    return failure(`Status list credential must include type '${BITSTRING_LIST_CREDENTIAL_TYPE}'`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  const listIssuerId = getIssuerId(listCredential)
  if (options.requireIssuerMatch !== false && parsed.issuerId && listIssuerId !== parsed.issuerId) {
    return failure('Status list issuer does not match credential issuer', {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  const proofResult = await verifyListProof(agentContext, listCredential, options)
  if (!proofResult.isValid) {
    return failure(
      `Status list proof verification failed${proofResult.error ? `: ${proofResult.error.message}` : ''}`,
      { statusPurpose, statusListIndex, statusListUri },
    )
  }

  const rawSubject = listCredential.credentialSubject
  const subject = asJsonObject(Array.isArray(rawSubject) ? rawSubject[0] : rawSubject)
  if (!subject) {
    return failure('Status list credential has no credentialSubject', {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (!getTypes(subject.type).includes(BITSTRING_LIST_TYPE)) {
    return failure(`Status list subject must include type '${BITSTRING_LIST_TYPE}'`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (subject.statusPurpose !== REVOCATION_PURPOSE) {
    return failure(`Status list purpose '${String(subject.statusPurpose)}' does not match '${REVOCATION_PURPOSE}'`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (subject.statusSize !== undefined && subject.statusSize !== 1) {
    return failure(`Unsupported statusSize '${String(subject.statusSize)}' (only 1 is supported)`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (typeof subject.encodedList !== 'string') {
    return failure('Status list subject has no encodedList', {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  let bits: Uint8Array
  try {
    bits = decodeBitstring(subject.encodedList)
  } catch (error) {
    return failure(`Invalid bitstring: ${error instanceof Error ? error.message : String(error)}`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  if (statusListIndex >= bits.length * 8) {
    return failure(`statusListIndex ${statusListIndex} is outside the status list`, {
      statusPurpose,
      statusListIndex,
      statusListUri,
    })
  }

  return {
    checked: true,
    revoked: getBit(bits, statusListIndex),
    verified: true,
    statusListUri,
    statusListIndex,
    statusPurpose,
  }
}
