import type { AgentContext, DocumentLoader } from '@credo-ts/core'
import type { DocumentLoaderResult } from '@credo-ts/core/build/modules/vc/data-integrity/jsonldUtil.mjs'

import { CredoError } from '@credo-ts/core'
import { defaultDocumentLoader } from '@credo-ts/core/build/modules/vc/data-integrity/libraries/documentLoader.mjs'

import { getInlineContext } from '../vc-jsonld/contexts'

/**
 * Check if URL belongs to CREDEBL schema domain
 */
function isW3CDeprecatedUrl(url: string, agentContext: AgentContext): boolean {
  // agentContext.config.logger.debug(
  //   `Checking if w3c url(${url}) contains deprecated domain for agent: ${agentContext.config.label}`,
  // )
  return url.startsWith(process.env.DEPRECATED_DOMAIN!)
}

/**
 * For JSON-LD schemas replace deprecated domain to migrated/updated domain
 */
function replaceUrl(url: string, agent: AgentContext): string {
  agent.config.logger.debug(`Replacing deprecated domain with updated domain`)
  return url.replace(process.env.DEPRECATED_DOMAIN!, process.env.CURRENT_DOMAIN!)
}

/**
 * Custom loader that extends Credo's default loader
 */
export const CustomDocumentLoader = (agentContext: AgentContext): DocumentLoader => {
  const defaultLoader = defaultDocumentLoader(agentContext)

  return async function (url: string): Promise<DocumentLoaderResult> {
    try {
      // Intercept VCDM 2.0 / Bitstring Status List contexts that Credo's default
      // loader does not bundle, to avoid network fetches during signing/verification.
      const inlineContext = getInlineContext(url)
      if (inlineContext) {
        agentContext.config.logger.debug(`Serving inline context for url(${url})`)
        return { contextUrl: null, documentUrl: url, document: inlineContext as any }
      }

      // Intercept credebl schemas
      if (isW3CDeprecatedUrl(url, agentContext)) {
        // agentContext.config.logger.debug(
        //   `Found w3c url(${url}) containing deprecated domain for agent: ${agentContext.config.label}`,
        // )
        url = replaceUrl(url, agentContext)
      }

      agentContext.config.logger.debug(`Passing url(${url}) to default loader`)
      return await defaultLoader(url)
    } catch (error) {
      throw new CredoError(`Failed to load document for ${url}`, { cause: error as Error })
    }
  }
}
