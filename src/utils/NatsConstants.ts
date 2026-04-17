// ─── NATS Stream Names ────────────────────────────────────────────────────────

// Main work queue — holds all pending deletion jobs.
// WorkQueue retention: message is permanently removed after it is ack'd.
export const RETENTION_DELETION_STREAM = 'RETENTION_DELETION'

// Dead-letter queue — holds jobs that failed after all retry attempts.
// Limits retention: messages are kept for manual investigation, not auto-deleted on ack.
export const RETENTION_DLQ_STREAM = 'RETENTION_DLQ'

// ─── NATS Subject Patterns ────────────────────────────────────────────────────

// All subjects that the RETENTION_DELETION stream must capture.
// Must stay in sync with NATS_SUBJECTS in RetentionTypes.ts.
export const DELETION_SUBJECTS = [
  'retention.delete.didcomm.credential',
  'retention.delete.didcomm.proof',
  'retention.delete.oid4vc.issuance',
  'retention.delete.oid4vc.verification',
]

// ─── NATS Consumer Definitions ───────────────────────────────────────────────

// One pull consumer per record type.
// Each consumer filters to its own subject so workers only receive their own messages.
// Consumer names must stay in sync with the consumerName in each *Worker.ts file.
export const CONSUMERS: Array<{ name: string; filterSubject: string }> = [
  {
    name: 'retention-worker-didcomm-credential',
    filterSubject: 'retention.delete.didcomm.credential',
  },
  {
    name: 'retention-worker-didcomm-proof',
    filterSubject: 'retention.delete.didcomm.proof',
  },
  {
    name: 'retention-worker-oid4vc-issuance',
    filterSubject: 'retention.delete.oid4vc.issuance',
  },
  {
    name: 'retention-worker-oid4vc-verification',
    filterSubject: 'retention.delete.oid4vc.verification',
  },
]

// ─── NATS Connection ──────────────────────────────────────────────────────────

// -1 means retry forever — the agent should not stop trying to reconnect.
export const NATS_MAX_RECONNECT_ATTEMPTS = -1

// How long (ms) to wait between reconnect attempts.
export const NATS_RECONNECT_TIME_WAIT_MS = 2000

// ─── NATS Stream Limits ───────────────────────────────────────────────────────

// NATS time values are in nanoseconds (1 second = 1_000_000_000 ns).

// How long to keep a message in the RETENTION_DELETION stream before discarding.
// Prevents unbounded growth if workers fall behind.
// 7 days in nanoseconds.
export const DELETION_STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000

// Maximum number of messages to keep in the RETENTION_DELETION stream.
export const DELETION_STREAM_MAX_MSGS = 1_000_000

// Deduplication window: NATS will reject a message with the same Nats-Msg-Id
// if it was already published within this window.
// Our Msg-Id = recordId + enqueuedAt, so this prevents double-publishing
// from the same cron run while allowing re-publishing in later cron runs.
// 24 hours in nanoseconds.
export const DELETION_STREAM_DEDUP_WINDOW_NS = 24 * 60 * 60 * 1_000_000_000

// How long to keep failed jobs in the DLQ for manual investigation.
// 30 days in nanoseconds.
export const DLQ_STREAM_MAX_AGE_NS = 30 * 24 * 60 * 60 * 1_000_000_000

// Maximum number of messages to keep in the DLQ stream.
export const DLQ_STREAM_MAX_MSGS = 100_000

// ─── NATS Consumer Delivery Config ───────────────────────────────────────────

// How long NATS waits for a worker to ack a message before redelivering it.
// Must be long enough to cover the full deletion + webhook retry time.
// Worst case: webhook retries = 1s + 5s + 30s = 36s → 60s gives comfortable headroom.
// 60 seconds in nanoseconds.
export const CONSUMER_ACK_WAIT_NS = 60 * 1_000_000_000

// Maximum number of delivery attempts before a job is considered permanently failed.
// After this many attempts, the worker routes the job to the DLQ.
// Must stay in sync with MAX_DELIVER in BaseRetentionWorker.ts.
export const CONSUMER_MAX_DELIVER = 5

// Backoff delays between redelivery attempts (nanoseconds).
// NATS uses these to space out retries after a nak().
// Attempt 1 → 2: wait 1s
// Attempt 2 → 3: wait 5s
// Attempt 3 → 4: wait 30s
// Attempt 4 → 5: wait 2 min
// Attempt 5    : move to DLQ (no more redelivery)
export const CONSUMER_BACKOFF_NS = [
  1_000_000_000,    //  1 second
  5_000_000_000,    //  5 seconds
  30_000_000_000,   // 30 seconds
  120_000_000_000,  //  2 minutes
  300_000_000_000,  //  5 minutes
]

// ─── NATS Error Codes ─────────────────────────────────────────────────────────

// JetStream API error codes returned when a stream or consumer already exists.
// Used in addOrUpdateStream() to detect and handle existing resources.
export const NATS_ERR_STREAM_ALREADY_EXISTS = 10058
export const NATS_ERR_CONSUMER_ALREADY_EXISTS = 10148

// ─── Webhook Retry Delays ─────────────────────────────────────────────────────

// Delays in milliseconds between webhook delivery attempts.
// Total attempts = delays.length + 1 (1 initial + N retries).
// [1s, 5s, 30s] → 3 retries → 4 total attempts.
export const WEBHOOK_RETRY_DELAYS_MS = [1000, 5000, 30000]
