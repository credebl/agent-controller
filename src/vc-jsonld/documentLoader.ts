import type { AgentContext } from '@credo-ts/core'

import { W3cCredentialsModuleConfig } from '@credo-ts/core'

import { getInlineContext } from './contexts'

export type JsonLdDocumentLoader = (url: string) => Promise<any>

/**
 * Resolve the JSON-LD document loader configured for the agent context.
 */
export function resolveDocumentLoader(agentContext: AgentContext): JsonLdDocumentLoader {
  const config = agentContext.dependencyManager.resolve(W3cCredentialsModuleConfig)
  return config.documentLoader(agentContext) as unknown as JsonLdDocumentLoader
}

/**
 * Serve bundled VCDM 2.0 / Bitstring Status List contexts locally, even when the
 * configured loader would otherwise fetch them from the network. All other URLs
 * are delegated to the original loader.
 */
export function withInlineContexts(documentLoader: JsonLdDocumentLoader): JsonLdDocumentLoader {
  return async (url: string) => {
    const inlineContext = getInlineContext(url)
    if (inlineContext) {
      return { contextUrl: null, documentUrl: url, document: inlineContext }
    }

    return documentLoader(url)
  }
}
