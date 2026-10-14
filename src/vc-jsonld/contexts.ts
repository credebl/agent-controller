import { contexts as credentialsV2Contexts } from '@digitalcredentials/credentials-v2-context'

import { CREDENTIALS_V2_CONTEXT_URL, STATUS_V1_CONTEXT_URL } from './constants'

/**
 * `https://www.w3.org/ns/credentials/v2` is sourced from the
 * `@digitalcredentials/credentials-v2-context` package (bundled with Credo's VC stack).
 */
const CREDENTIALS_V2_CONTEXT = credentialsV2Contexts.get(CREDENTIALS_V2_CONTEXT_URL) as
  | Record<string, unknown>
  | undefined

/**
 * `https://www.w3.org/ns/credentials/status/v1` — inline copy of the W3C Bitstring
 * Status List context (https://www.w3.org/ns/credentials/status/v1) so canonicalization
 * does not depend on a network fetch.
 */
const STATUS_V1_CONTEXT: Record<string, unknown> = {
  '@context': {
    '@protected': true,
    id: '@id',
    type: '@type',
    BitstringStatusListCredential: 'https://www.w3.org/ns/credentials/status#BitstringStatusListCredential',
    BitstringStatusList: {
      '@id': 'https://www.w3.org/ns/credentials/status#BitstringStatusList',
      '@context': {
        '@protected': true,
        id: '@id',
        type: '@type',
        encodedList: {
          '@id': 'https://www.w3.org/ns/credentials/status#encodedList',
          '@type': 'https://w3id.org/security#multibase',
        },
        statusPurpose: 'https://www.w3.org/ns/credentials/status#statusPurpose',
        ttl: 'https://www.w3.org/ns/credentials/status#ttl',
      },
    },
    BitstringStatusListEntry: {
      '@id': 'https://www.w3.org/ns/credentials/status#BitstringStatusListEntry',
      '@context': {
        '@protected': true,
        id: '@id',
        type: '@type',
        statusListCredential: {
          '@id': 'https://www.w3.org/ns/credentials/status#statusListCredential',
          '@type': '@id',
        },
        statusListIndex: 'https://www.w3.org/ns/credentials/status#statusListIndex',
        statusPurpose: 'https://www.w3.org/ns/credentials/status#statusPurpose',
        statusMessage: {
          '@id': 'https://www.w3.org/ns/credentials/status#statusMessage',
          '@context': {
            '@protected': true,
            id: '@id',
            type: '@type',
            message: 'https://www.w3.org/ns/credentials/status#message',
            status: 'https://www.w3.org/ns/credentials/status#status',
          },
        },
        statusReference: {
          '@id': 'https://www.w3.org/ns/credentials/status#statusReference',
          '@type': '@id',
        },
        statusSize: {
          '@id': 'https://www.w3.org/ns/credentials/status#statusSize',
          '@type': 'https://www.w3.org/2001/XMLSchema#integer',
        },
      },
    },
  },
}

const INLINE_CONTEXTS: Record<string, Record<string, unknown> | undefined> = {
  [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT,
  [STATUS_V1_CONTEXT_URL]: STATUS_V1_CONTEXT,
}

/**
 * Returns an inline JSON-LD context document for known VCDM 2.0 / Bitstring
 * contexts, or `undefined` if the URL is not cached locally.
 */
export function getInlineContext(url: string): Record<string, unknown> | undefined {
  return INLINE_CONTEXTS[url]
}
