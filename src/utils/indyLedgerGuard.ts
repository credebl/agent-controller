import type { Agent } from '@credo-ts/core'
import type { TenantAgent } from '@credo-ts/tenants'

import { IndyLedgerNotConfiguredError } from '../errors/errors'

export const INDY_LEDGER_NOT_CONFIGURED = 'Indy ledger is not configured'

/** Key the Indy VDR module is registered under. It is only present when the agent was started with a ledger. */
export const INDY_VDR_MODULE_KEY = 'indyVdr'

type AnyAgent = Pick<Agent | TenantAgent, 'dependencyManager'>

/**
 * Whether the (root or tenant) agent was started with an Indy ledger. Tenant agents share the root agent's registered
 * modules, so this answers the same for both.
 */
export function isIndyLedgerConfigured(agent: AnyAgent): boolean {
  return Boolean(agent.dependencyManager?.registeredModules?.[INDY_VDR_MODULE_KEY])
}

/** Throws a 501 "Indy ledger is not configured" error for routes that need Indy. */
export function assertIndyLedgerConfigured(agent: AnyAgent): void {
  if (!isIndyLedgerConfigured(agent)) {
    throw new IndyLedgerNotConfiguredError(INDY_LEDGER_NOT_CONFIGURED)
  }
}
