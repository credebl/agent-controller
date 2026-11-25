import type { AgentContext, JsonObject } from '@credo-ts/core'

import { signV2Credential } from './signV2Credential'

type Oid4vciV2JsonLdSigner = (
  agentContext: AgentContext,
  options: { credential: JsonObject; verificationMethod: string },
) => Promise<Record<string, unknown>>

declare global {
  var __credeblOid4vciSignV2JsonLd: Oid4vciV2JsonLdSigner | undefined
}

/**
 * Credo's OID4VCI issuer signs `ldp_vc` through the VCDM 1.1 service only. The patched
 * `@credo-ts/openid4vc` (patches/@credo-ts+openid4vc+0.7.4.patch) calls this hook instead when the
 * credential is a VCDM 2.0 `W3cV2Credential`, and signs it with the Data Integrity suite from
 * `signV2Credential`.
 */
export function registerOid4vciV2Signer(): void {
  globalThis.__credeblOid4vciSignV2JsonLd = (agentContext, { credential, verificationMethod }) =>
    signV2Credential(agentContext, { credential, verificationMethod })
}
