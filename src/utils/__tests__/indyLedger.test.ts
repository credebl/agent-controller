// Credo ships as ESM only, so its Indy and AnonCreds packages are replaced by small stand-ins that record how they
// were constructed. Everything in `indyLedger.ts` itself is real.
jest.mock('@credo-ts/indy-vdr', () => {
  class Recorded {
    public constructor(public readonly options?: unknown) {}
  }
  return {
    IndyVdrModule: class IndyVdrModule extends Recorded {},
    IndyVdrIndyDidRegistrar: class IndyVdrIndyDidRegistrar extends Recorded {},
    IndyVdrIndyDidResolver: class IndyVdrIndyDidResolver extends Recorded {},
    IndyVdrAnonCredsRegistry: class IndyVdrAnonCredsRegistry extends Recorded {},
  }
})
jest.mock('@hyperledger/indy-vdr-nodejs', () => ({ indyVdr: { native: 'indy-vdr' } }))
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }))
jest.mock('@credo-ts/anoncreds', () => {
  // Same patterns as @credo-ts/anoncreds 0.7.4.
  const ns = '((?:[a-z][_a-z0-9-]*)(?::[a-z][_a-z0-9-]*)?)'
  const did = `(did:indy:${ns}:([1-9A-HJ-NP-Za-km-z]{21,22}))`
  return {
    didIndyRegex: new RegExp(`^did:indy:${ns}:([1-9A-HJ-NP-Za-km-z]{21,22})$`),
    didIndySchemaIdRegex: new RegExp(`^${did}/anoncreds/v0/SCHEMA/(.+)/([0-9.]+)$`),
    unqualifiedSchemaIdRegex: /^([a-zA-Z0-9]{21,22}):2:(.+):([0-9.]+)$/,
    didIndyCredentialDefinitionIdRegex: new RegExp(`^${did}/anoncreds/v0/CLAIM_DEF/([1-9][0-9]*)/(.+)$`),
    unqualifiedCredentialDefinitionIdRegex: /^([a-zA-Z0-9]{21,22}):3:CL:([1-9][0-9]*):(.+)$/,
    unqualifiedRevocationRegistryIdRegex:
      /^([a-zA-Z0-9]{21,22}):4:[a-zA-Z0-9]{21,22}:3:CL:([1-9][0-9]*):(.+):CL_ACCUM:(.+)$/,
    didIndyRevocationRegistryIdRegex: new RegExp(`^${did}/anoncreds/v0/REV_REG_DEF/([1-9][0-9]*)/(.+)/(.+)$`),
  }
})

import type { IndyVdrPoolConfig } from '@credo-ts/indy-vdr'

import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from '@credo-ts/indy-vdr'

import {
  getIndyModules,
  IndyLedgerNotConfiguredAnonCredsRegistry,
  resolveIndyNetworks,
  type IndyNetworks,
} from '../indyLedger'

const indicioTestnet = { genesisTransactions: 'https://example.org/indicio-testnet', indyNamespace: 'indicio:testnet' }
const bcovrin = { genesisTransactions: 'https://example.org/bcovrin', indyNamespace: 'bcovrin:testnet' }

function fakeFetch() {
  return jest.fn(
    async (ledger: { genesisTransactions: string; indyNamespace: string }): Promise<IndyVdrPoolConfig> => ({
      genesisTransactions: `genesis of ${ledger.genesisTransactions}`,
      indyNamespace: ledger.indyNamespace,
      isProduction: false,
      connectOnStartup: true,
    }),
  )
}

describe('resolveIndyNetworks', () => {
  it('turns Indy off when no ledger and no BCOVRIN_TEST_GENESIS are configured', async () => {
    const fetchLedger = fakeFetch()

    await expect(resolveIndyNetworks({ indyLedger: [], bcovrinTestGenesis: '', fetchLedger })).resolves.toBe(undefined)
    await expect(resolveIndyNetworks({ bcovrinTestGenesis: '', fetchLedger })).resolves.toBe(undefined)
    await expect(resolveIndyNetworks({ indyLedger: [], bcovrinTestGenesis: '  ', fetchLedger })).resolves.toBe(
      undefined,
    )
    expect(fetchLedger).not.toHaveBeenCalled()
  })

  it('reads BCOVRIN_TEST_GENESIS from the environment by default', async () => {
    const previous = process.env.BCOVRIN_TEST_GENESIS
    try {
      delete process.env.BCOVRIN_TEST_GENESIS
      await expect(resolveIndyNetworks({ indyLedger: [] })).resolves.toBe(undefined)

      process.env.BCOVRIN_TEST_GENESIS = '{"txn":"genesis"}'
      await expect(resolveIndyNetworks({ indyLedger: [] })).resolves.toEqual([
        expect.objectContaining({ genesisTransactions: '{"txn":"genesis"}', indyNamespace: 'bcovrin:testnet' }),
      ])
    } finally {
      if (previous === undefined) delete process.env.BCOVRIN_TEST_GENESIS
      else process.env.BCOVRIN_TEST_GENESIS = previous
    }
  })

  it('keeps the BCovrin test network fallback when only BCOVRIN_TEST_GENESIS is set', async () => {
    await expect(resolveIndyNetworks({ indyLedger: [], bcovrinTestGenesis: '{"txn":"genesis"}' })).resolves.toEqual([
      {
        genesisTransactions: '{"txn":"genesis"}',
        indyNamespace: 'bcovrin:testnet',
        isProduction: false,
        connectOnStartup: true,
      },
    ])
  })

  it('uses the configured ledgers, in order, and ignores BCOVRIN_TEST_GENESIS then', async () => {
    const fetchLedger = fakeFetch()

    const networks = await resolveIndyNetworks({
      indyLedger: [indicioTestnet, bcovrin],
      bcovrinTestGenesis: '{"txn":"genesis"}',
      fetchLedger,
    })

    expect(fetchLedger).toHaveBeenCalledTimes(2)
    expect(networks?.map((network) => network.indyNamespace)).toEqual(['indicio:testnet', 'bcovrin:testnet'])
    expect(networks?.[0].genesisTransactions).toBe('genesis of https://example.org/indicio-testnet')
  })

  it('indyEnabled=false wins over a configured ledger and never downloads genesis files', async () => {
    const fetchLedger = fakeFetch()

    await expect(
      resolveIndyNetworks({
        indyLedger: [bcovrin],
        bcovrinTestGenesis: '{"txn":"genesis"}',
        indyEnabled: false,
        fetchLedger,
      }),
    ).resolves.toBe(undefined)
    expect(fetchLedger).not.toHaveBeenCalled()
  })

  it('indyEnabled=true without any ledger fails startup with a clear message', async () => {
    await expect(resolveIndyNetworks({ indyLedger: [], bcovrinTestGenesis: '', indyEnabled: true })).rejects.toThrow(
      /no Indy ledger is configured/,
    )
  })

  it('indyEnabled=true with a ledger behaves like the default', async () => {
    await expect(
      resolveIndyNetworks({ indyLedger: [bcovrin], indyEnabled: true, fetchLedger: fakeFetch() }),
    ).resolves.toHaveLength(1)
  })
})

describe('getIndyModules', () => {
  it('leaves out the Indy VDR module, did:indy and the Indy AnonCreds registry without networks', () => {
    const indy = getIndyModules(undefined)

    expect(indy.indyVdrModule).toBeUndefined()
    expect(indy.didRegistrars).toEqual([])
    expect(indy.didResolvers).toEqual([])
    expect(indy.anonCredsRegistry).toBeInstanceOf(IndyLedgerNotConfiguredAnonCredsRegistry)
    expect(indy.anonCredsRegistry).not.toBeInstanceOf(IndyVdrAnonCredsRegistry)
  })

  it('registers the Indy VDR module, did:indy and the Indy AnonCreds registry with networks', () => {
    const networks: IndyNetworks = [
      { genesisTransactions: 'genesis', indyNamespace: 'bcovrin:testnet', isProduction: false, connectOnStartup: true },
    ]

    const indy = getIndyModules(networks)

    expect(indy.indyVdrModule).toBeInstanceOf(IndyVdrModule)
    expect((indy.indyVdrModule as unknown as { options: { networks: unknown } }).options.networks).toBe(networks)
    expect(indy.didRegistrars).toEqual([expect.any(IndyVdrIndyDidRegistrar)])
    expect(indy.didResolvers).toEqual([expect.any(IndyVdrIndyDidResolver)])
    expect(indy.anonCredsRegistry).toBeInstanceOf(IndyVdrAnonCredsRegistry)
  })
})

describe('IndyLedgerNotConfiguredAnonCredsRegistry', () => {
  const registry = new IndyLedgerNotConfiguredAnonCredsRegistry()
  const context = {} as never

  it.each([
    'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL',
    'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL/anoncreds/v0/SCHEMA/name/1.0',
    'LjgpST2rjsoxYegQDRm7EL:2:name:1.0',
    'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default',
    'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL/anoncreds/v0/CLAIM_DEF/10/default',
  ])('claims the Indy identifier %s', (identifier) => {
    expect(registry.supportedIdentifier.test(identifier)).toBe(true)
  })

  it.each(['did:web:example.com', 'did:polygon:0x1234', 'did:key:z6Mk'])('does not claim %s', (identifier) => {
    expect(registry.supportedIdentifier.test(identifier)).toBe(false)
  })

  it('answers lookups with "Indy ledger is not configured"', async () => {
    await expect(registry.getSchema(context, 'LjgpST2rjsoxYegQDRm7EL:2:name:1.0')).resolves.toMatchObject({
      schemaId: 'LjgpST2rjsoxYegQDRm7EL:2:name:1.0',
      resolutionMetadata: { error: 'unsupportedAnonCredsMethod', message: 'Indy ledger is not configured' },
    })
    await expect(
      registry.getCredentialDefinition(context, 'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default'),
    ).resolves.toMatchObject({ resolutionMetadata: { message: 'Indy ledger is not configured' } })
    await expect(registry.getRevocationStatusList()).resolves.toMatchObject({
      resolutionMetadata: { message: 'Indy ledger is not configured' },
    })
  })

  it('fails writes with "Indy ledger is not configured"', async () => {
    await expect(registry.registerSchema()).resolves.toMatchObject({
      schemaState: { state: 'failed', reason: 'Indy ledger is not configured' },
    })
    await expect(registry.registerCredentialDefinition()).resolves.toMatchObject({
      credentialDefinitionState: { state: 'failed', reason: 'Indy ledger is not configured' },
    })
    await expect(registry.registerRevocationRegistryDefinition()).resolves.toMatchObject({
      revocationRegistryDefinitionState: { state: 'failed' },
    })
    await expect(registry.registerRevocationStatusList()).resolves.toMatchObject({
      revocationStatusListState: { state: 'failed' },
    })
  })
})

describe('IndyLedgerNotConfiguredAnonCredsRegistry results', () => {
  it('carries the marker the route guard looks for', () => {
    expect(new IndyLedgerNotConfiguredAnonCredsRegistry().indyLedgerNotConfigured).toBe(true)
  })

  it('returns a fresh object on every call', async () => {
    const registry = new IndyLedgerNotConfiguredAnonCredsRegistry()

    const first = await registry.registerSchema()
    ;(first.schemaState as { reason: string }).reason = 'changed by a caller'
    const firstLookup = await registry.getSchema({} as never, 'LjgpST2rjsoxYegQDRm7EL:2:name:1.0')
    firstLookup.resolutionMetadata.message = 'changed by a caller'

    await expect(registry.registerSchema()).resolves.toMatchObject({
      schemaState: { reason: 'Indy ledger is not configured' },
    })
    await expect(registry.getSchema({} as never, 'LjgpST2rjsoxYegQDRm7EL:2:name:1.0')).resolves.toMatchObject({
      resolutionMetadata: { message: 'Indy ledger is not configured' },
    })
  })
})
