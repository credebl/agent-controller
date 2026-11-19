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

function asContextArray(value: unknown): any[] {
  if (Array.isArray(value)) return [...value]
  if (typeof value === 'string') return [value]
  return []
}

function uniqueContexts(contexts: any[], ...excluded: string[]): any[] {
  const set = new Set(contexts)
  for (const context of excluded) {
    set.delete(context)
  }
  return [...set]
}

function hasStatusContext(contexts: any[]): boolean {
  return new Set(contexts).has(BITSTRING_STATUS_LIST_CONTEXT_V1)
}

function withStatusContext(contexts: any[], includeStatus: boolean): any[] {
  if (!includeStatus || hasStatusContext(contexts)) return contexts
  return [...contexts, BITSTRING_STATUS_LIST_CONTEXT_V1]
}

function v1Contexts(value: unknown, includeStatus: boolean): unknown {
  if (Array.isArray(value)) {
    const contexts = [CREDENTIALS_CONTEXT_V1_URL, ...uniqueContexts(value, CREDENTIALS_CONTEXT_V1_URL)]
    return withStatusContext(contexts, includeStatus)
  }
  if (typeof value === 'string') {
    return withStatusContext([CREDENTIALS_CONTEXT_V1_URL, value], includeStatus)
  }
  return value
}

export function updateContextForVersion(
  transformed: Record<string, any>,
  version: JsonLdVersion | undefined,
  includeStatusListContext = false,
) {
  const context = transformed['@context']

  if (version === 'v2.0') {
    transformed['@context'] = [
      CREDENTIALS_CONTEXT_V2_URL,
      ...uniqueContexts(asContextArray(context), CREDENTIALS_CONTEXT_V1_URL, CREDENTIALS_CONTEXT_V2_URL),
    ]
    return
  }

  if (!context) {
    transformed['@context'] =
      version === 'v1.1' && includeStatusListContext
        ? [CREDENTIALS_CONTEXT_V1_URL, BITSTRING_STATUS_LIST_CONTEXT_V1]
        : [CREDENTIALS_CONTEXT_V1_URL]
  } else {
    transformed['@context'] = v1Contexts(context, includeStatusListContext)
  }

  if (!version && includeStatusListContext) {
    transformed['@context'] = withStatusContext(asContextArray(transformed['@context']), true)
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
