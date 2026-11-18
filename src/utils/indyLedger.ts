import type {
  AnonCredsRegistry,
  GetCredentialDefinitionReturn,
  GetRevocationRegistryDefinitionReturn,
  GetRevocationStatusListReturn,
  GetSchemaReturn,
  RegisterCredentialDefinitionReturn,
  RegisterRevocationRegistryDefinitionReturn,
  RegisterRevocationStatusListReturn,
  RegisterSchemaReturn,
} from '@credo-ts/anoncreds'
import type { IndyVdrPoolConfig } from '@credo-ts/indy-vdr'

import {
  didIndyCredentialDefinitionIdRegex,
  didIndyRegex,
  didIndyRevocationRegistryIdRegex,
  didIndySchemaIdRegex,
  unqualifiedCredentialDefinitionIdRegex,
  unqualifiedRevocationRegistryIdRegex,
  unqualifiedSchemaIdRegex,
} from '@credo-ts/anoncreds'
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from '@credo-ts/indy-vdr'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'
import axios from 'axios'

import { IndicioAcceptanceMechanism, IndicioTransactionAuthorAgreement, Network, NetworkName } from '../enums'

import { INDY_LEDGER_NOT_CONFIGURED, INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER } from './indyLedgerGuard'

export interface IndyLedgerConfig {
  genesisTransactions: string
  indyNamespace: string
}

export type IndyNetworks = [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]]

export interface ResolveIndyNetworksOptions {
  /** `indyLedger` from the agent config. */
  indyLedger?: IndyLedgerConfig[]
  /**
   * Explicit switch (`indyEnabled` / `AFJ_REST_INDY_ENABLED`). `false` turns Indy off even when a ledger is configured,
   * `true` makes a missing ledger a startup error, `undefined` enables Indy only when a ledger is configured.
   */
  indyEnabled?: boolean
  /** Genesis transactions used when `indyLedger` is empty, `BCOVRIN_TEST_GENESIS` by default. */
  bcovrinTestGenesis?: string
  /** Namespace of the `BCOVRIN_TEST_GENESIS` network, `bcovrin:testnet` by default. */
  bcovrinNamespace?: string
  fetchLedger?: (ledger: IndyLedgerConfig) => Promise<IndyVdrPoolConfig>
}

/** Downloads the genesis transactions of a configured ledger and builds its pool config. */
export async function fetchLedgerData(ledgerConfig: IndyLedgerConfig): Promise<IndyVdrPoolConfig> {
  const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$/

  if (!urlPattern.test(ledgerConfig.genesisTransactions)) {
    throw new Error('Not a valid URL')
  }

  const genesisTransactions = await axios.get(ledgerConfig.genesisTransactions)

  const networkConfig: IndyVdrPoolConfig = {
    genesisTransactions: genesisTransactions.data,
    indyNamespace: ledgerConfig.indyNamespace,
    isProduction: false,
    connectOnStartup: true,
  }

  if (ledgerConfig.indyNamespace.includes(NetworkName.Indicio)) {
    if (ledgerConfig.indyNamespace === (Network.Indicio_Mainnet as string)) {
      networkConfig.transactionAuthorAgreement = {
        version: IndicioTransactionAuthorAgreement.Indicio_Testnet_Mainnet_Version,
        acceptanceMechanism: IndicioAcceptanceMechanism.Wallet_Agreement,
      }
    } else {
      networkConfig.transactionAuthorAgreement = {
        version: IndicioTransactionAuthorAgreement.Indicio_Demonet_Version,
        acceptanceMechanism: IndicioAcceptanceMechanism.Wallet_Agreement,
      }
    }
  }

  return networkConfig
}

/**
 * Works out which Indy networks the agent connects to. Returns `undefined` when Indy is off, in which case no Indy
 * module, DID registrar/resolver or AnonCreds registry is registered and the agent never contacts an Indy pool.
 *
 * - `indyEnabled: false` → off.
 * - a non-empty `indyLedger` → those ledgers (unchanged behaviour).
 * - otherwise a non-empty `BCOVRIN_TEST_GENESIS` → the BCovrin test network (unchanged behaviour).
 * - otherwise → off, or a startup error when `indyEnabled` is `true`.
 */
export async function resolveIndyNetworks({
  indyLedger,
  indyEnabled,
  bcovrinTestGenesis = process.env.BCOVRIN_TEST_GENESIS,
  bcovrinNamespace = Network.Bcovrin_Testnet,
  fetchLedger = fetchLedgerData,
}: ResolveIndyNetworksOptions): Promise<IndyNetworks | undefined> {
  if (indyEnabled === false) return undefined

  const ledgers = indyLedger ?? []
  if (ledgers.length !== 0) {
    return [await fetchLedger(ledgers[0]), ...(await Promise.all(ledgers.slice(1).map(fetchLedger)))]
  }

  if (bcovrinTestGenesis && bcovrinTestGenesis.trim() !== '') {
    return [
      {
        genesisTransactions: bcovrinTestGenesis,
        indyNamespace: bcovrinNamespace,
        isProduction: false,
        connectOnStartup: true,
      },
    ]
  }

  if (indyEnabled === true) {
    throw new Error(
      'Indy is enabled (indyEnabled / AFJ_REST_INDY_ENABLED=true) but no Indy ledger is configured. ' +
        'Set indyLedger or BCOVRIN_TEST_GENESIS, or leave Indy disabled.',
    )
  }

  return undefined
}

// Same identifiers the Indy VDR registry claims: did:indy issuer ids plus legacy and did:indy object ids.
const indyAnonCredsIdentifierRegex = new RegExp(
  [
    didIndyRegex,
    didIndySchemaIdRegex,
    unqualifiedSchemaIdRegex,
    didIndyCredentialDefinitionIdRegex,
    unqualifiedCredentialDefinitionIdRegex,
    unqualifiedRevocationRegistryIdRegex,
    didIndyRevocationRegistryIdRegex,
  ]
    .map((regex) => regex.source)
    .join('|'),
)

/**
 * Stands in for the Indy VDR AnonCreds registry when no ledger is configured. The AnonCreds module needs at least one
 * registry, and this keeps AnonCreds itself (link secrets, holder storage, DIDComm formats) available while every
 * Indy lookup or write fails with a clear "Indy ledger is not configured" instead of "no registry found".
 */
export class IndyLedgerNotConfiguredAnonCredsRegistry implements AnonCredsRegistry {
  public readonly methodName = 'indy'
  public readonly supportedIdentifier = indyAnonCredsIdentifierRegex
  public readonly allowsCaching = false
  /** Lets controllers recognise this registry and answer 501 before calling it. */
  public readonly [INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER] = true

  // Fresh objects on every call, so a caller that changes its result cannot change the next caller's.
  private resolutionMetadata() {
    return { error: 'unsupportedAnonCredsMethod', message: INDY_LEDGER_NOT_CONFIGURED }
  }

  private failedState() {
    return { state: 'failed' as const, reason: INDY_LEDGER_NOT_CONFIGURED }
  }

  public getSchema(_agentContext: unknown, schemaId: string): Promise<GetSchemaReturn> {
    return Promise.resolve({ schemaId, resolutionMetadata: this.resolutionMetadata(), schemaMetadata: {} })
  }

  public registerSchema(): Promise<RegisterSchemaReturn> {
    return Promise.resolve({ schemaState: this.failedState(), schemaMetadata: {}, registrationMetadata: {} })
  }

  public getCredentialDefinition(
    _agentContext: unknown,
    credentialDefinitionId: string,
  ): Promise<GetCredentialDefinitionReturn> {
    return Promise.resolve({
      credentialDefinitionId,
      resolutionMetadata: this.resolutionMetadata(),
      credentialDefinitionMetadata: {},
    })
  }

  public registerCredentialDefinition(): Promise<RegisterCredentialDefinitionReturn> {
    return Promise.resolve({
      credentialDefinitionState: this.failedState(),
      credentialDefinitionMetadata: {},
      registrationMetadata: {},
    })
  }

  public getRevocationRegistryDefinition(
    _agentContext: unknown,
    revocationRegistryDefinitionId: string,
  ): Promise<GetRevocationRegistryDefinitionReturn> {
    return Promise.resolve({
      revocationRegistryDefinitionId,
      resolutionMetadata: this.resolutionMetadata(),
      revocationRegistryDefinitionMetadata: {},
    })
  }

  public registerRevocationRegistryDefinition(): Promise<RegisterRevocationRegistryDefinitionReturn> {
    return Promise.resolve({
      revocationRegistryDefinitionState: this.failedState(),
      revocationRegistryDefinitionMetadata: {},
      registrationMetadata: {},
    })
  }

  public getRevocationStatusList(): Promise<GetRevocationStatusListReturn> {
    return Promise.resolve({ resolutionMetadata: this.resolutionMetadata(), revocationStatusListMetadata: {} })
  }

  public registerRevocationStatusList(): Promise<RegisterRevocationStatusListReturn> {
    return Promise.resolve({
      revocationStatusListState: this.failedState(),
      revocationStatusListMetadata: {},
      registrationMetadata: {},
    })
  }
}

/**
 * The Indy pieces of the agent's module set. With networks: the Indy VDR module, the did:indy registrar and resolver
 * and the Indy VDR AnonCreds registry. Without: no module, no did:indy support and a placeholder AnonCreds registry.
 */
export function getIndyModules(networks: IndyNetworks | undefined) {
  if (!networks) {
    return {
      indyVdrModule: undefined,
      didRegistrars: [],
      didResolvers: [],
      anonCredsRegistry: new IndyLedgerNotConfiguredAnonCredsRegistry() as AnonCredsRegistry,
    }
  }

  return {
    indyVdrModule: new IndyVdrModule({ indyVdr, networks }),
    didRegistrars: [new IndyVdrIndyDidRegistrar()],
    didResolvers: [new IndyVdrIndyDidResolver()],
    anonCredsRegistry: new IndyVdrAnonCredsRegistry() as AnonCredsRegistry,
  }
}
