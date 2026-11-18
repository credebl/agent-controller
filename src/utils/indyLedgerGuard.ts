import { IndyLedgerNotConfiguredError } from '../errors/errors'

export const INDY_LEDGER_NOT_CONFIGURED = 'Indy ledger is not configured'

/**
 * Marker property of the placeholder AnonCreds registry that stands in for the Indy registry when the agent runs
 * without an Indy ledger. Kept here, free of Credo imports, so controllers can check for it cheaply.
 */
export const INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER = 'indyLedgerNotConfigured'

interface DidRegistrarLike {
  supportedMethods: string[]
}

interface AnonCredsRegistryLike {
  supportedIdentifier: RegExp
  [INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER]?: boolean
}

/** The parts of a root or tenant agent the checks read. Both expose the same `dids` and `anoncreds` config. */
interface AgentLike {
  dids: { config: { registrars: DidRegistrarLike[] } }
  modules?: { anoncreds?: { config?: { registries?: AnonCredsRegistryLike[] } } }
}

/** Whether the agent can create `did:indy` DIDs, i.e. it has a registrar for the `indy` method. */
export function hasIndyDidRegistrar(agent: AgentLike): boolean {
  return agent.dids.config.registrars.some((registrar) => registrar.supportedMethods.includes('indy'))
}

/** Throws a 501 "Indy ledger is not configured" error when the agent has no `did:indy` registrar. */
export function assertIndyDidRegistrar(agent: AgentLike): void {
  if (!hasIndyDidRegistrar(agent)) {
    throw new IndyLedgerNotConfiguredError(INDY_LEDGER_NOT_CONFIGURED)
  }
}

/**
 * Throws a 501 "Indy ledger is not configured" error when any of the identifiers would be served by the placeholder
 * registry, i.e. it is an Indy identifier and the agent runs without an Indy ledger. Identifiers of other AnonCreds
 * methods, or of a real Indy registry, pass, so the registry Credo selects still decides. Running this before an
 * AnonCreds write keeps it free of side effects such as creating credential definition keys.
 */
export function assertAnonCredsIdentifiersServed(agent: AgentLike, identifiers: Array<string | undefined>): void {
  const registries = agent.modules?.anoncreds?.config?.registries ?? []

  for (const identifier of identifiers) {
    if (!identifier) continue
    const registry = registries.find((candidate) =>
      matchesWithoutSideEffects(candidate.supportedIdentifier, identifier),
    )
    if (registry?.[INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER]) {
      throw new IndyLedgerNotConfiguredError(INDY_LEDGER_NOT_CONFIGURED)
    }
  }
}

/**
 * `RegExp.test` advances `lastIndex` on global and sticky expressions. Credo tests the same expression again when it
 * selects the registry, so restore `lastIndex` to leave that selection unchanged.
 */
function matchesWithoutSideEffects(expression: RegExp, identifier: string): boolean {
  const { lastIndex } = expression
  try {
    return expression.test(identifier)
  } finally {
    expression.lastIndex = lastIndex
  }
}
