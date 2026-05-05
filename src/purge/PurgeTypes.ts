export interface NatsConfig {
  servers: string[]
  nkeySeed?: string
  credentialsFile?: string
  username?: string
  password?: string
}

export type AgentMode = 'shared' | 'dedicated'

export enum PurgeRecordType {
  DIDCOMM_CREDENTIAL = 'didcomm_credential',
  DIDCOMM_PROOF = 'didcomm_proof',
  OID4VC_ISSUANCE = 'oid4vc_issuance',
  OID4VC_VERIFICATION = 'oid4vc_verification',
}

export interface PurgeJob {
  recordId: string
  recordType: PurgeRecordType
  tenantId: string
  agentMode: AgentMode
  scheduledAt: string
}

export interface PurgeNatsConfig {
  enabled: boolean
  ttlSeconds: number
  nats: NatsConfig
  recordTypes: PurgeRecordType[]
}

export interface PurgeCronConfig {
  enabled: boolean
  ttlSeconds: number
  cronSchedule: string
  recordTypes: PurgeRecordType[]
}

export interface PurgeConfig {
  natsConfig: PurgeNatsConfig
  cronConfig: PurgeCronConfig
  webhookEnabled: boolean
}

export function buildPurgeConfig(): PurgeConfig | undefined {
  if (process.env.PURGE_ENABLED !== 'true') return undefined

  const natsEnabled = process.env.PURGE_NATS_ENABLED === 'true'
  const cronEnabled = process.env.PURGE_CRON_ENABLED === 'true'

  if (!natsEnabled && !cronEnabled) return undefined

  return {
    natsConfig: {
      enabled: natsEnabled,
      ttlSeconds: parseTtlSeconds(process.env.PURGE_NATS_TTL_SECONDS, 'PURGE_NATS_TTL_SECONDS'),
      nats: {
        servers: (process.env.NATS_SERVERS || 'nats://localhost:4222')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        nkeySeed: process.env.NATS_NKEY_SEED,
        credentialsFile: process.env.NATS_CREDENTIALS_FILE,
        username: process.env.NATS_USER,
        password: process.env.NATS_PASSWORD,
      },
      recordTypes: buildPurgeRecordTypes(),
    },
    cronConfig: {
      enabled: cronEnabled,
      ttlSeconds: parseTtlSeconds(process.env.PURGE_CRON_TTL_SECONDS, 'PURGE_CRON_TTL_SECONDS'),
      cronSchedule: process.env.PURGE_CRON_SCHEDULE || '0 * * * *',
      recordTypes: buildPurgeRecordTypes(),
    },
    webhookEnabled: process.env.PURGE_WEBHOOK_ENABLED !== 'false',
  }
}

function parseTtlSeconds(value: string | undefined, envKey: string, defaultSeconds = 2592000): number {
  if (value === undefined || value === '') return defaultSeconds
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[Purge] ${envKey} must be a positive integer, got: "${value}"`)
  }
  return parsed
}

function buildPurgeRecordTypes(): PurgeRecordType[] {
  const envFlags: Record<string, PurgeRecordType> = {
    PURGE_DIDCOMM_CREDENTIAL: PurgeRecordType.DIDCOMM_CREDENTIAL,
    PURGE_DIDCOMM_PROOF: PurgeRecordType.DIDCOMM_PROOF,
    PURGE_OID4VC_ISSUANCE: PurgeRecordType.OID4VC_ISSUANCE,
    PURGE_OID4VC_VERIFICATION: PurgeRecordType.OID4VC_VERIFICATION,
  }

  const anyEnvSet = Object.keys(envFlags).some((key) => process.env[key] !== undefined)

  if (anyEnvSet) {
    const selected = Object.entries(envFlags)
      .filter(([key]) => process.env[key] === 'true')
      .map(([, type]) => type)

    if (selected.length === 0) {
      throw new Error(
        '[Purge] At least one PURGE_* record type flag must be set to "true" when any flag is present. ' +
          'Set PURGE_ENABLED=false to disable purge entirely.',
      )
    }

    return selected
  }

  return [
    PurgeRecordType.DIDCOMM_CREDENTIAL,
    PurgeRecordType.DIDCOMM_PROOF,
    PurgeRecordType.OID4VC_ISSUANCE,
    PurgeRecordType.OID4VC_VERIFICATION,
  ]
}
