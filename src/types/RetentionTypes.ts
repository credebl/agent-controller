export enum RecordType {
  DIDCOMM_CREDENTIAL = 'didcomm_credential',
  DIDCOMM_PROOF = 'didcomm_proof',
  OID4VC_ISSUANCE = 'oid4vc_issuance',
  OID4VC_VERIFICATION = 'oid4vc_verification',
}

// Terminal states that make a record eligible for deletion
export const TERMINAL_STATES: Record<RecordType, string[]> = {
  [RecordType.DIDCOMM_CREDENTIAL]: ['done', 'abandoned'],
  [RecordType.DIDCOMM_PROOF]: ['done', 'abandoned'],

  // All states from OpenId4VcIssuanceSessionState enum
  [RecordType.OID4VC_ISSUANCE]: [
    'OfferCreated',
    'OfferUriRetrieved',
    'AuthorizationInitiated',
    'AuthorizationGranted',
    'AccessTokenRequested',
    'AccessTokenCreated',
    'CredentialRequestReceived',
    'CredentialsPartiallyIssued',
    'Completed',
    'Error',
  ],

  // All states from OpenId4VcVerificationSessionState enum
  [RecordType.OID4VC_VERIFICATION]: [
    'RequestCreated',
    'RequestUriRetrieved',
    'ResponseVerified',
    'Error',
  ],
}

// Maps RecordType to the NATS subject it should be published on
export const NATS_SUBJECTS: Record<RecordType, string> = {
  [RecordType.DIDCOMM_CREDENTIAL]: 'retention.delete.didcomm.credential',
  [RecordType.DIDCOMM_PROOF]: 'retention.delete.didcomm.proof',
  [RecordType.OID4VC_ISSUANCE]: 'retention.delete.oid4vc.issuance',
  [RecordType.OID4VC_VERIFICATION]: 'retention.delete.oid4vc.verification',
}

// Maps RecordType to its webhook path (appended to webhookUrl)
// Need to add delete in the route
export const WEBHOOK_PATHS: Record<RecordType, string> = {
  [RecordType.DIDCOMM_CREDENTIAL]: '/wh/didcomm-issuance',
  [RecordType.DIDCOMM_PROOF]: '/wh/didcomm-verification',
  [RecordType.OID4VC_ISSUANCE]: '/wh/delete/oid4vc-issuance',
  [RecordType.OID4VC_VERIFICATION]: '/wh/delete/oid4vc-verification',
}

// Maps RecordType to its DLQ subject
export const DLQ_SUBJECTS: Record<RecordType, string> = {
  [RecordType.DIDCOMM_CREDENTIAL]: 'retention.dlq.didcomm.credential',
  [RecordType.DIDCOMM_PROOF]: 'retention.dlq.didcomm.proof',
  [RecordType.OID4VC_ISSUANCE]: 'retention.dlq.oid4vc.issuance',
  [RecordType.OID4VC_VERIFICATION]: 'retention.dlq.oid4vc.verification',
}

export interface NatsConfig {
  servers: string[]
  credentialsFile?: string
}

export interface RetentionConfig {
  enabled: boolean
  cronSchedule: string // cron syntax e.g. "0 */2 * * *"
  ttlSeconds: number // TTL in seconds after terminal state reached
  recordTypes: RecordType[]
  nats: NatsConfig
}

// ─── Config builders ─────────────────────────────────────────────────────────
// Resolves the final RetentionConfig from env vars + cliConfig.json.
// Priority: env vars > cliConfig.json > defaults.
// Returns undefined if retention is not enabled from either source.
export function buildRetentionConfig(configRetention?: Partial<RetentionConfig>): RetentionConfig | undefined {
  const enabled = process.env.RETENTION_ENABLED === 'true' || configRetention?.enabled === true
  if (!enabled) return undefined

  return {
    enabled: true,
    cronSchedule: process.env.RETENTION_CRON_SCHEDULE || configRetention?.cronSchedule || '0 */2 * * *',
    ttlSeconds: Number(process.env.RETENTION_TTL_SECONDS) || configRetention?.ttlSeconds || 2592000,
    recordTypes: buildRetentionRecordTypes(configRetention?.recordTypes),
    nats: {
      servers: (
        process.env.NATS_SERVERS ||
        configRetention?.nats?.servers?.join(',') ||
        'nats://localhost:4222'
      ).split(','),
      credentialsFile: process.env.NATS_CREDENTIALS_FILE || configRetention?.nats?.credentialsFile,
    },
  }
}

// Builds the list of record types from per-type env flags, falling back to
// cliConfig.json recordTypes array, then all four types as default.
function buildRetentionRecordTypes(configRecordTypes?: RecordType[]): RecordType[] {
  const envFlags: Record<string, RecordType> = {
    RETENTION_DIDCOMM_CREDENTIAL: RecordType.DIDCOMM_CREDENTIAL,
    RETENTION_DIDCOMM_PROOF: RecordType.DIDCOMM_PROOF,
    RETENTION_OID4VC_ISSUANCE: RecordType.OID4VC_ISSUANCE,
    RETENTION_OID4VC_VERIFICATION: RecordType.OID4VC_VERIFICATION,
  }

  const anyEnvSet = Object.keys(envFlags).some((key) => process.env[key] !== undefined)

  if (anyEnvSet) {
    return Object.entries(envFlags)
      .filter(([key]) => process.env[key] === 'true')
      .map(([, type]) => type)
  }

  return configRecordTypes ?? [
    RecordType.DIDCOMM_CREDENTIAL,
    RecordType.DIDCOMM_PROOF,
    RecordType.OID4VC_ISSUANCE,
    RecordType.OID4VC_VERIFICATION,
  ]
}

// Status values reported in the webhook payload after a deletion attempt
export enum DeletionStatus {
  DELETED = 'deleted',           // record was successfully deleted
  ALREADY_ABSENT = 'already-absent', // record was not found — treated as success (idempotent)
}

// Payload published to NATS for each eligible record
export interface DeletionJob {
  recordId: string
  recordType: RecordType
  tenantId: string // empty string for dedicated agents
  agentMode: 'shared' | 'dedicated'
  enqueuedAt: string // ISO-8601
}
