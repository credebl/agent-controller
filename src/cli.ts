import type { AriesRestConfig } from './cliAgent.js'
import type { OpenBaoKmsConfig } from './utils/kms/openBao.js'

import dotenv from 'dotenv'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

dotenv.config()

import { runRestAgent } from './cliAgent.js'

function envBoolean(name: string, defaultValue = false): boolean {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envNumber(name: string, defaultValue: number): number {
  const value = process.env[name]
  if (!value) return defaultValue
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

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
  'openbao-enabled': boolean
  'openbao-write-enabled': boolean
  'openbao-address'?: string
  'openbao-token'?: string
  'openbao-role-id'?: string
  'openbao-secret-id'?: string
  'openbao-secret-id-file'?: string
  'openbao-auth-mount': string
  'openbao-namespace'?: string
  'openbao-transit-mount': string
  'openbao-kv-mount'?: string
  'openbao-deployment-id'?: string
  'openbao-timeout-ms': number
  'openbao-health-check': boolean
  'openbao-did-key-enabled': boolean
  'openbao-did-web-enabled': boolean
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
    .option('openbao-enabled', {
      boolean: true,
      default: envBoolean('OPENBAO_ENABLED'),
      description: 'Register the optional OpenBao KMS backend. Askar stays the default backend.',
    })
    .option('openbao-write-enabled', {
      boolean: true,
      default: envBoolean('OPENBAO_WRITE_ENABLED', true),
      description: 'Allow OpenBao to create/import/delete keys. Set false for rollback.',
    })
    .option('openbao-address', { string: true, default: process.env.OPENBAO_ADDRESS })
    .option('openbao-token', { string: true, default: process.env.OPENBAO_TOKEN })
    .option('openbao-role-id', { string: true, default: process.env.OPENBAO_ROLE_ID })
    .option('openbao-secret-id', { string: true, default: process.env.OPENBAO_SECRET_ID })
    .option('openbao-secret-id-file', { string: true, default: process.env.OPENBAO_SECRET_ID_FILE })
    .option('openbao-auth-mount', { string: true, default: process.env.OPENBAO_AUTH_MOUNT || 'approle' })
    .option('openbao-namespace', { string: true, default: process.env.OPENBAO_NAMESPACE })
    .option('openbao-transit-mount', { string: true, default: process.env.OPENBAO_TRANSIT_MOUNT || 'transit' })
    .option('openbao-kv-mount', { string: true, default: process.env.OPENBAO_KV_MOUNT })
    .option('openbao-deployment-id', { string: true, default: process.env.OPENBAO_DEPLOYMENT_ID })
    .option('openbao-timeout-ms', { number: true, default: envNumber('OPENBAO_TIMEOUT_MS', 10_000) })
    .option('openbao-health-check', {
      boolean: true,
      default: envBoolean('OPENBAO_HEALTH_CHECK', true),
      description: 'Fail startup when OpenBao is sealed or unreachable.',
    })
    .option('openbao-did-key-enabled', {
      boolean: true,
      default: envBoolean('OPENBAO_DID_KEY_ENABLED'),
      description: 'Opt in to creating/importing did:key keys in OpenBao.',
    })
    .option('openbao-did-web-enabled', {
      boolean: true,
      default: envBoolean('OPENBAO_DID_WEB_ENABLED'),
      description: 'Opt in to importing did:web keys in OpenBao.',
    })
    .config()
    .env('AFJ_REST')
    .parseAsync() as Promise<Parsed>
}

function openBaoConfigFromParsed(parsed: Parsed): OpenBaoKmsConfig {
  return {
    enabled: parsed['openbao-enabled'],
    writeEnabled: parsed['openbao-write-enabled'],
    ...(parsed['openbao-address'] ? { address: parsed['openbao-address'] } : {}),
    ...(parsed['openbao-token'] ? { token: parsed['openbao-token'] } : {}),
    ...(parsed['openbao-role-id'] ? { roleId: parsed['openbao-role-id'] } : {}),
    ...(parsed['openbao-secret-id'] ? { secretId: parsed['openbao-secret-id'] } : {}),
    ...(parsed['openbao-secret-id-file'] ? { secretIdFile: parsed['openbao-secret-id-file'] } : {}),
    authMount: parsed['openbao-auth-mount'],
    ...(parsed['openbao-namespace'] ? { namespace: parsed['openbao-namespace'] } : {}),
    transitMount: parsed['openbao-transit-mount'],
    ...(parsed['openbao-kv-mount'] ? { kvMount: parsed['openbao-kv-mount'] } : {}),
    ...(parsed['openbao-deployment-id'] ? { deploymentId: parsed['openbao-deployment-id'] } : {}),
    timeoutMs: parsed['openbao-timeout-ms'],
    healthCheck: parsed['openbao-health-check'],
    didKeyEnabled: parsed['openbao-did-key-enabled'],
    didWebEnabled: parsed['openbao-did-web-enabled'],
  }
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
    openBaoConfig: openBaoConfigFromParsed(parsed),
  } as AriesRestConfig)
}
