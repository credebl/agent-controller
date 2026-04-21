import { PurgeRecordType } from './PurgeTypes'

// ─── NATS Stream Name ─────────────────────────────────────────────────────────
// Single combined stream — schedule and execution subjects must be in the same
// stream for Nats-Schedule-Target to be valid.

export const PURGE_STREAM = 'PURGE'

// ─── NATS Subjects ────────────────────────────────────────────────────────────

// Scheduled messages are published here. NATS holds them until Nats-Schedule
// time, then re-publishes to the corresponding execution subject (same stream).
export const PURGE_SCHEDULER_SUBJECTS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge.schedule.didcomm.credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge.schedule.didcomm.proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge.schedule.oid4vc.issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge.schedule.oid4vc.verification',
}

// Workers consume from these subjects. Consumers filter on these so schedule
// messages are ignored.
export const PURGE_EXECUTION_SUBJECTS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge.execute.didcomm.credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge.execute.didcomm.proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge.execute.oid4vc.issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge.execute.oid4vc.verification',
}

// ─── NATS Consumer Definitions ───────────────────────────────────────────────

export const PURGE_CONSUMER_NAMES: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge-worker-didcomm-credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge-worker-didcomm-proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge-worker-oid4vc-issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge-worker-oid4vc-verification',
}

// ─── NATS Stream Limits ───────────────────────────────────────────────────────

// 35 days — covers max schedule TTL + buffer for unprocessed execute messages
export const PURGE_STREAM_MAX_AGE_NS = 35 * 24 * 60 * 60 * 1_000_000_000

// ─── Consumer Delivery Config ─────────────────────────────────────────────────

// 30 seconds in nanoseconds
export const PURGE_CONSUMER_ACK_WAIT_NS = 30 * 1_000_000_000

export const PURGE_CONSUMER_MAX_DELIVER = 3

export const PURGE_CONSUMER_BACKOFF_NS = [
  5_000_000_000,  //  5 seconds
  30_000_000_000, // 30 seconds
]

// ─── Webhook Paths ────────────────────────────────────────────────────────────

// Appended to webhookUrl after every deletion.
// Full URL = webhookUrl + PURGE_WEBHOOK_PATHS[recordType]
// e.g. http://host/wh/agentId/purge/oid4vc-issuance
export const PURGE_WEBHOOK_PATHS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: '/purge/didcomm-credential',
  [PurgeRecordType.DIDCOMM_PROOF]: '/purge/didcomm-proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: '/purge/oid4vc-issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: '/purge/oid4vc-verification',
}

// Retry delays for webhook delivery attempts (ms): 1s → 5s → 30s
export const PURGE_WEBHOOK_RETRY_DELAYS_MS = [1000, 5000, 30000]
