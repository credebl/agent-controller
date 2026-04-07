import type { AriesRestConfig } from './cliAgent.js'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import dotenv from 'dotenv'

dotenv.config()

import { runRestAgent } from './cliAgent.js'

interface IndyLedger {
  genesisTransactions: string
  indyNamespace: string
}

interface Parsed {
  label: string
  'wallet-id': string
  'wallet-key': string
  'wallet-type': string
  'wallet-url': string
  'wallet-scheme': string
  'wallet-account': string
  'wallet-password': string
  'wallet-admin-account': string
  'wallet-admin-password': string
  'indy-ledger': IndyLedger[]
  endpoint?: string[]
  'log-level': number
  'outbound-transport': ('http' | 'ws')[]
  'inbound-transport'?: InboundTransport[]
  'auto-accept-connections'?: boolean
  'auto-accept-credentials'?: 'always' | 'never' | 'contentApproved'
  'auto-accept-proofs'?: 'always' | 'never' | 'contentApproved'
  'webhook-url'?: string
  'admin-port': number
  tenancy: boolean
  'did-registry-contract-address'?: string
  'schema-manager-contract-address'?: string
  'wallet-connect-timeout'?: number
  'wallet-max-connections'?: number
  'wallet-idle-timeout'?: number
  schemaFileServerURL?: string
  didRegistryContractAddress?: string
  schemaManagerContractAddress?: string
  rpcUrl?: string
  fileServerUrl?: string
  fileServerToken?: string
  apiKey?: string
  updateJwtSecret?: boolean
  'status-list-server-url'?: string
  'status-list-api-key'?: string
  'status-list-default-size'?: number
}

interface InboundTransport {
  transport: Transports
  port: number
}

type Transports = 'http' | 'ws'

async function parseArguments(): Promise<Parsed> {
  return yargs(hideBin(process.argv))
    .command('start', 'Start Credo Rest agent')
    .option('label', { alias: 'l', string: true, demandOption: true })
    .option('wallet-id', { string: true, demandOption: true })
    .option('wallet-key', { string: true, demandOption: true })
    .option('wallet-type', { string: true, demandOption: true })
    .option('wallet-url', { string: true, demandOption: true })
    .option('wallet-scheme', { string: true, demandOption: true })
    .option('wallet-account', { string: true, demandOption: true })
    .option('wallet-password', { string: true, demandOption: true })
    .option('wallet-admin-account', { string: true, demandOption: true })
    .option('wallet-admin-password', { string: true, demandOption: true })
    .option('indy-ledger', {
      array: true,
      default: [],
      coerce: (input) =>
        input.map((item: { genesisTransactions: string; indyNamespace: string }) => ({
          genesisTransactions: item.genesisTransactions,
          indyNamespace: item.indyNamespace,
        })),
    })
    .option('endpoint', {
      array: true,
      coerce: (input) => input.map((item: string) => String(item)),
    })
    .option('log-level', { number: true, default: 3 })
    .option('outbound-transport', {
      array: true,
      coerce: (input) => {
        const validValues = ['http', 'ws']
        return input.map((item: string) => {
          if (validValues.includes(item)) {
            return item as 'http' | 'ws'
          } else {
            throw new Error(`Invalid value for outbound-transport: ${item}. Valid values are 'http' or 'ws'.`)
          }
        })
      },
    })
    .option('inbound-transport', {
      array: true,
      coerce: (input) => {
        const transports: InboundTransport[] = []
        for (const item of input) {
          if (
            typeof item === 'object' &&
            'transport' in item &&
            typeof item.transport === 'string' &&
            'port' in item &&
            typeof item.port === 'number'
          ) {
            transports.push({ transport: item.transport as Transports, port: item.port })
          } else {
            throw new Error(
              'Inbound transport should be specified as an array of objects with transport and port properties.',
            )
          }
        }
        return transports
      },
    })
    .option('auto-accept-connections', { boolean: true, default: false })
    .option('auto-accept-credentials', {
      choices: ['always', 'never', 'contentApproved'],
      coerce: (input: string) => {
        if (['always', 'never', 'contentApproved'].includes(input)) {
          return input as 'always' | 'never' | 'contentApproved'
        } else {
          throw new Error(
            'Invalid value for auto-accept-credentials. Valid values are "always", "never", or "contentApproved".',
          )
        }
      },
    })
    .option('auto-accept-proofs', {
      choices: ['always', 'never', 'contentApproved'],
      coerce: (input: string) => {
        if (['always', 'never', 'contentApproved'].includes(input)) {
          return input as 'always' | 'never' | 'contentApproved'
        } else {
          throw new Error(
            'Invalid value for auto-accept-proofs. Valid values are "always", "never", or "contentApproved".',
          )
        }
      },
    })
    .option('webhook-url', { string: true })
    .option('admin-port', { number: true, demandOption: true })
    .option('tenancy', { boolean: true, default: false })
    .option('did-registry-contract-address', { string: true })
    .option('schema-manager-contract-address', { string: true })
    .option('wallet-connect-timeout', { number: true })
    .option('wallet-max-connections', { number: true })
    .option('wallet-idle-timeout', { number: true })
    .option('apiKey', {
      string: true,
      default: process.env.API_KEY,
      coerce: (input: string | undefined) => {
        if (!input) return input
        input = input.trim()
        if (input && input.length < 16) {
          throw new Error('API key must be at least 16 characters long')
        }
        return input
      },
    })
    .option('updateJwtSecret', {
      boolean: true,
      default: process.env.UPDATE_JWT_SECRET === 'true',
    })
    .option('status-list-server-url', { string: true, default: process.env.STATUS_LIST_SERVER_URL })
    .option('status-list-api-key', { string: true, default: process.env.STATUS_LIST_API_KEY })
    .option('status-list-default-size', { number: true, default: process.env.STATUS_LIST_DEFAULT_SIZE ? Number(process.env.STATUS_LIST_DEFAULT_SIZE) : undefined })
    .config()
    .env('AFJ_REST')
    .parseAsync() as Promise<Parsed>
}

export async function runCliServer() {
  const parsed = await parseArguments()

  await runRestAgent({
    label: parsed.label,
    walletConfig: {
      id: parsed['wallet-id'],
      key: parsed['wallet-key'],
      database: {
        type: parsed['wallet-type'],
        config: {
          host: parsed['wallet-url'],
          connectTimeout: parsed['wallet-connect-timeout'] || Number(process.env.CONNECT_TIMEOUT),
          maxConnections: parsed['wallet-max-connections'] || Number(process.env.MAX_CONNECTIONS),
          idleTimeout: parsed['wallet-idle-timeout'] || Number(process.env.IDLE_TIMEOUT),
        },
        credentials: {
          account: parsed['wallet-account'],
          password: parsed['wallet-password'],
          adminAccount: parsed['wallet-admin-account'],
          adminPassword: parsed['wallet-admin-password'],
        },
      },
    },
    indyLedger: parsed['indy-ledger'],
    endpoints: parsed.endpoint,
    autoAcceptConnections: parsed['auto-accept-connections'],
    autoAcceptCredentials: parsed['auto-accept-credentials'],
    autoAcceptProofs: parsed['auto-accept-proofs'],
    logLevel: parsed['log-level'],
    inboundTransports: parsed['inbound-transport'],
    outboundTransports: parsed['outbound-transport'],
    webhookUrl: parsed['webhook-url'],
    adminPort: parsed['admin-port'],
    tenancy: parsed.tenancy,
    schemaFileServerURL: parsed.schemaFileServerURL,
    didRegistryContractAddress: parsed.didRegistryContractAddress,
    schemaManagerContractAddress: parsed.schemaManagerContractAddress,
    rpcUrl: parsed.rpcUrl,
    fileServerUrl: parsed.fileServerUrl,
    fileServerToken: parsed.fileServerToken,
    apiKey: parsed['apiKey'],
    updateJwtSecret: parsed['updateJwtSecret'],
    statusListServerUrl: parsed['status-list-server-url'],
    statusListApiKey: parsed['status-list-api-key'],
    statusListDefaultSize: parsed['status-list-default-size'],
  } as AriesRestConfig)
}
