export interface NatsConfig {
  servers: string[]
  credentialsFile?: string
}

export enum PurgeRecordType {
  DIDCOMM_CREDENTIAL = 'didcomm_credential',
  DIDCOMM_PROOF = 'didcomm_proof',
  OID4VC_ISSUANCE = 'oid4vc_issuance',
  OID4VC_VERIFICATION = 'oid4vc_verification',
}

export interface PurgeJob {
  recordId: string
  recordType: PurgeRecordType
  tenantId: string            // empty string for dedicated agents
  agentMode: 'shared' | 'dedicated'
  scheduledAt: string         // ISO-8601
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
}

export function buildPurgeConfig(): PurgeConfig | undefined {
  if (process.env.PURGE_ENABLED !== 'true') return undefined

  const natsEnabled = process.env.PURGE_NATS_ENABLED === 'true'
  const cronEnabled = process.env.PURGE_CRON_ENABLED === 'true'

  if (!natsEnabled && !cronEnabled) return undefined

  return {
    natsConfig: {
      enabled: natsEnabled,
      ttlSeconds: Number(process.env.PURGE_NATS_TTL_SECONDS) || 2592000,
      nats: {
        servers: (process.env.NATS_SERVERS || 'nats://localhost:4222').split(','),
        credentialsFile: process.env.NATS_CREDENTIALS_FILE,
      },
      recordTypes: buildPurgeRecordTypes(),
    },
    cronConfig: {
      enabled: cronEnabled,
      ttlSeconds: Number(process.env.PURGE_CRON_TTL_SECONDS) || 2592000,
      cronSchedule: process.env.PURGE_CRON_SCHEDULE || '0 * * * *',
      recordTypes: buildPurgeRecordTypes(),
    },
  }
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
    return Object.entries(envFlags)
      .filter(([key]) => process.env[key] === 'true')
      .map(([, type]) => type)
  }

  return [
    PurgeRecordType.DIDCOMM_CREDENTIAL,
    PurgeRecordType.DIDCOMM_PROOF,
    PurgeRecordType.OID4VC_ISSUANCE,
    PurgeRecordType.OID4VC_VERIFICATION,
  ]
}
