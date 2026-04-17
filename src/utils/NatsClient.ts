import {
  AckPolicy,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  StringCodec,
  connect,
  headers,
} from 'nats'
import type { Consumer, JetStreamClient, JetStreamManager, NatsConnection, StreamConfig } from 'nats'

import type { DeletionJob, NatsConfig } from '../types/RetentionTypes'
import { RecordType } from '../types/RetentionTypes'
import {
  CONSUMERS,
  CONSUMER_ACK_WAIT_NS,
  CONSUMER_BACKOFF_NS,
  CONSUMER_MAX_DELIVER,
  DELETION_STREAM_DEDUP_WINDOW_NS,
  DELETION_STREAM_MAX_AGE_NS,
  DELETION_STREAM_MAX_MSGS,
  DELETION_SUBJECTS,
  DLQ_STREAM_MAX_AGE_NS,
  DLQ_STREAM_MAX_MSGS,
  NATS_ERR_CONSUMER_ALREADY_EXISTS,
  NATS_ERR_STREAM_ALREADY_EXISTS,
  NATS_MAX_RECONNECT_ATTEMPTS,
  NATS_RECONNECT_TIME_WAIT_MS,
  RETENTION_DELETION_STREAM,
  RETENTION_DLQ_STREAM,
} from './NatsConstants'

const sc = StringCodec()

class NatsClient {
  private nc: NatsConnection | null = null
  private js: JetStreamClient | null = null
  private jsm: JetStreamManager | null = null

  async connect(config: NatsConfig): Promise<void> {
    this.nc = await connect({
      servers: config.servers,
      ...(config.credentialsFile ? { credentialsFile: config.credentialsFile } : {}),
      maxReconnectAttempts: NATS_MAX_RECONNECT_ATTEMPTS,
      reconnectTimeWait: NATS_RECONNECT_TIME_WAIT_MS,
    })
    this.js = this.nc.jetstream()
    this.jsm = await this.nc.jetstreamManager()
  }

  async provisionStreams(): Promise<void> {
    if (!this.jsm) throw new Error('[NatsClient] Not connected — call connect() first')

    const deletionStreamConfig = {
      name: RETENTION_DELETION_STREAM,
      subjects: DELETION_SUBJECTS,
      retention: RetentionPolicy.Workqueue,
      storage: StorageType.File,
      max_age: DELETION_STREAM_MAX_AGE_NS,
      max_msgs: DELETION_STREAM_MAX_MSGS,
      discard: DiscardPolicy.Old,
      duplicate_window: DELETION_STREAM_DEDUP_WINDOW_NS,
    }

    const dlqStreamConfig = {
      name: RETENTION_DLQ_STREAM,
      subjects: ['retention.dlq.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age: DLQ_STREAM_MAX_AGE_NS,
      max_msgs: DLQ_STREAM_MAX_MSGS,
    }

    // Use update-or-create so config changes (e.g. new subjects) always take effect
    await this.addOrUpdateStream(deletionStreamConfig)
    await this.addOrUpdateStream(dlqStreamConfig)
  }

  private async addOrUpdateStream(config: Partial<StreamConfig> & { name: string }): Promise<void> {
    if (!this.jsm) throw new Error('[NatsClient] Not connected — call connect() first')
    try {
      await this.jsm.streams.add(config)
    } catch (err: any) {
      if (this.isAlreadyExistsError(err)) {
        // Stream exists — update it so any config changes (subjects, retention, etc.) take effect
        await this.jsm.streams.update(config.name, config)
      } else {
        throw err
      }
    }
  }

  async provisionConsumers(): Promise<void> {
    if (!this.jsm) throw new Error('[NatsClient] Not connected — call connect() first')

    for (const consumer of CONSUMERS) {
      try {
        await this.jsm.consumers.add(RETENTION_DELETION_STREAM, {
          durable_name: consumer.name,
          ack_policy: AckPolicy.Explicit,
          ack_wait: CONSUMER_ACK_WAIT_NS,
          max_deliver: CONSUMER_MAX_DELIVER,
          backoff: CONSUMER_BACKOFF_NS,
          filter_subject: consumer.filterSubject,
        })
      } catch (err: any) {
        if (!this.isAlreadyExistsError(err)) throw err
      }
    }
  }

  async publish(subject: string, payload: DeletionJob): Promise<void> {
    if (!this.js) throw new Error('[NatsClient] Not connected — call connect() first')

    const h = headers()
    // Msg-Id combines recordId + enqueuedAt so the same record can be re-queued
    // in a later cron run (different timestamp) while still deduplicating within
    // a single cron run (same timestamp for all jobs published together).
    h.set('Nats-Msg-Id', `${payload.recordId}-${payload.enqueuedAt}`)

    await this.js.publish(subject, sc.encode(JSON.stringify(payload)), { headers: h })
  }

  async publishToDlq(dlqSubject: string, payload: DeletionJob, errorReason: string): Promise<void> {
    if (!this.js) throw new Error('[NatsClient] Not connected — call connect() first')

    const h = headers()
    h.set('X-Retention-Error', errorReason)
    h.set('X-Retention-Record-Type', payload.recordType)

    await this.js.publish(dlqSubject, sc.encode(JSON.stringify(payload)), { headers: h })
  }

  async getPullConsumer(consumerName: string): Promise<Consumer> {
    if (!this.js) throw new Error('[NatsClient] Not connected — call connect() first')
    return this.js.consumers.get(RETENTION_DELETION_STREAM, consumerName)
  }

  async disconnect(): Promise<void> {
    if (this.nc) {
      await this.nc.drain()
      this.nc = null
      this.js = null
      this.jsm = null
    }
  }

  decode(data: Uint8Array): DeletionJob {
    return JSON.parse(sc.decode(data)) as DeletionJob
  }

  private isAlreadyExistsError(err: any): boolean {
    const msg: string = err?.message ?? ''
    return (
      msg.includes('stream name already in use') ||
      msg.includes('consumer name already in use') ||
      err?.api_error?.err_code === NATS_ERR_STREAM_ALREADY_EXISTS ||
      err?.api_error?.err_code === NATS_ERR_CONSUMER_ALREADY_EXISTS
    )
  }
}

export const natsClient = new NatsClient()
export { RecordType }
