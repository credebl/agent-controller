import { PurgeRecordType } from './PurgeTypes'

export const PURGE_STREAM = 'PURGE'

// Schedule and execution subjects must be in the same stream for Nats-Schedule-Target to work
export const PURGE_SCHEDULER_SUBJECTS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge.schedule.didcomm.credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge.schedule.didcomm.proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge.schedule.oid4vc.issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge.schedule.oid4vc.verification',
}

export const PURGE_EXECUTION_SUBJECTS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge.execute.didcomm.credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge.execute.didcomm.proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge.execute.oid4vc.issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge.execute.oid4vc.verification',
}

export const PURGE_CONSUMER_NAMES: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: 'purge-worker-didcomm-credential',
  [PurgeRecordType.DIDCOMM_PROOF]: 'purge-worker-didcomm-proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: 'purge-worker-oid4vc-issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: 'purge-worker-oid4vc-verification',
}

// Added to ttlSeconds when computing stream max_age — covers worker processing time after fire
export const PURGE_STREAM_BUFFER_NS = 7 * 24 * 60 * 60 * 1_000_000_000

export const PURGE_CONSUMER_ACK_WAIT_NS = 30 * 1_000_000_000

export const PURGE_CONSUMER_MAX_DELIVER = 3

export const PURGE_CONSUMER_BACKOFF_NS = [
  5_000_000_000, //  5s
  30_000_000_000, // 30s
]

export const PURGE_WEBHOOK_PATHS: Record<PurgeRecordType, string> = {
  [PurgeRecordType.DIDCOMM_CREDENTIAL]: '/purge/didcomm-credential',
  [PurgeRecordType.DIDCOMM_PROOF]: '/purge/didcomm-proof',
  [PurgeRecordType.OID4VC_ISSUANCE]: '/purge/oid4vc-issuance',
  [PurgeRecordType.OID4VC_VERIFICATION]: '/purge/oid4vc-verification',
}

export const PURGE_WEBHOOK_RETRY_DELAYS_MS = [1000, 5000, 30000]

export const PURGE_WORKER_RESTART_DELAY_MS = 5_000
