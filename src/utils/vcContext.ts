export const CREDENTIALS_CONTEXT_V1_URL = 'https://www.w3.org/2018/credentials/v1'
export const CREDENTIALS_CONTEXT_V2_URL = 'https://www.w3.org/ns/credentials/v2'
export const BITSTRING_STATUS_LIST_CONTEXT_V1 = 'https://www.w3.org/ns/credentials/status/v1'

export type JsonLdVersion = 'v1.1' | 'v2.0'

function formatDate(date: unknown): unknown {
  if (!date) return undefined
  if (date instanceof Date) return date.toISOString()
  if (typeof date === 'string') {
    try {
      const parsed = new Date(date)
      if (Number.isNaN(parsed.getTime())) return date
      return parsed.toISOString()
    } catch {
      return date
    }
  }
  return date
}

export function updateContextForVersion(
  transformed: Record<string, any>,
  version: JsonLdVersion | undefined,
  includeStatusListContext = false,
) {
  const v1Context = CREDENTIALS_CONTEXT_V1_URL
  const v2Context = CREDENTIALS_CONTEXT_V2_URL

  if (version === 'v2.0') {
    let currentCtx: any[] = []
    if (Array.isArray(transformed['@context'])) {
      currentCtx = transformed['@context']
    } else if (typeof transformed['@context'] === 'string') {
      currentCtx = [transformed['@context']]
    }

    const ctxSet = new Set(currentCtx)
    ctxSet.delete(v1Context)
    ctxSet.delete(v2Context)
    transformed['@context'] = [v2Context, v1Context, ...Array.from(ctxSet)]
  } else if (!transformed['@context']) {
    transformed['@context'] = [v1Context]
  } else if (Array.isArray(transformed['@context'])) {
    const ctxSet = new Set(transformed['@context'])
    ctxSet.delete(v1Context)
    const contexts = [v1Context, ...Array.from(ctxSet)]
    if (includeStatusListContext && !contexts.includes(BITSTRING_STATUS_LIST_CONTEXT_V1)) {
      contexts.push(BITSTRING_STATUS_LIST_CONTEXT_V1)
    }
    transformed['@context'] = contexts
  } else if (typeof transformed['@context'] === 'string') {
    transformed['@context'] = includeStatusListContext
      ? [v1Context, transformed['@context'], BITSTRING_STATUS_LIST_CONTEXT_V1]
      : [v1Context, transformed['@context']]
  }

  if (!version && includeStatusListContext) {
    const contexts = Array.isArray(transformed['@context']) ? [...transformed['@context']] : []
    if (!contexts.includes(BITSTRING_STATUS_LIST_CONTEXT_V1)) {
      contexts.push(BITSTRING_STATUS_LIST_CONTEXT_V1)
    }
    transformed['@context'] = contexts
  }
}

export function transformPayloadForVersion(
  payload: Record<string, any>,
  version: JsonLdVersion | undefined,
  includeStatusListContext = false,
): Record<string, any> {
  if (version !== 'v2.0') {
    if (!includeStatusListContext) {
      return payload
    }
    const transformed = { ...payload }
    updateContextForVersion(transformed, version, includeStatusListContext)
    return transformed
  }

  const transformed = { ...payload }

  if (transformed.issuanceDate && !transformed.validFrom) {
    transformed.validFrom = transformed.issuanceDate
  }
  delete transformed.issuanceDate

  if (transformed.expirationDate && !transformed.validUntil) {
    transformed.validUntil = transformed.expirationDate
    delete transformed.expirationDate
  }

  if (transformed.validFrom) transformed.validFrom = formatDate(transformed.validFrom)
  if (transformed.validUntil) transformed.validUntil = formatDate(transformed.validUntil)

  if (typeof transformed.issuer === 'string' && transformed.issuer.startsWith('did:')) {
    transformed.issuer = { id: transformed.issuer }
  }

  updateContextForVersion(transformed, version, includeStatusListContext)

  return transformed
}
