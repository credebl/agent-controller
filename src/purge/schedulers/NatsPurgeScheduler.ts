import type { Agent } from '@credo-ts/core'
import type { JetStreamClient, JetStreamManager, NatsConnection } from 'nats'

import { AckPolicy, DiscardPolicy, RetentionPolicy, StorageType, StringCodec, connect, headers } from 'nats'

import {
  NATS_ERR_CONSUMER_ALREADY_EXISTS,
  NATS_ERR_STREAM_ALREADY_EXISTS,
  NATS_MAX_RECONNECT_ATTEMPTS,
  NATS_RECONNECT_TIME_WAIT_MS,
} from '../../utils/NatsConstants'
import {
  PURGE_CONSUMER_ACK_WAIT_NS,
  PURGE_CONSUMER_BACKOFF_NS,
  PURGE_CONSUMER_MAX_DELIVER,
  PURGE_CONSUMER_NAMES,
  PURGE_EXECUTION_SUBJECTS,
  PURGE_SCHEDULER_SUBJECTS,
  PURGE_STREAM,
  PURGE_STREAM_MAX_AGE_NS,
} from '../PurgeConstants'
import type { PurgeConfig, PurgeJob } from '../PurgeTypes'
import { PurgeRecordType } from '../PurgeTypes'
import { PurgeWorker } from '../PurgeWorker'

const sc = StringCodec()

export class NatsPurgeScheduler {
  private nc: NatsConnection | null = null
  private js: JetStreamClient | null = null
  private jsm: JetStreamManager | null = null
  private ttlSeconds = 0
  private recordTypes: PurgeRecordType[] = []

  async start(agent: Agent, config: PurgeConfig, webhookUrl: string | undefined): Promise<void> {
    const { natsConfig } = config
    this.ttlSeconds = natsConfig.ttlSeconds
    this.recordTypes = natsConfig.recordTypes

    this.nc = await connect({
      servers: natsConfig.nats.servers,
      ...(natsConfig.nats.credentialsFile ? { credentialsFile: natsConfig.nats.credentialsFile } : {}),
      maxReconnectAttempts: NATS_MAX_RECONNECT_ATTEMPTS,
      reconnectTimeWait: NATS_RECONNECT_TIME_WAIT_MS,
    })
    this.js = this.nc.jetstream()
    this.jsm = await this.nc.jetstreamManager()

    agent.config.logger.info('[Purge] Provisioning NATS streams...')
    await this.provisionStreams()
    agent.config.logger.info('[Purge] NATS streams ready')

    agent.config.logger.info('[Purge] Provisioning NATS consumers...')
    await this.provisionConsumers()
    agent.config.logger.info('[Purge] NATS consumers ready')

    await this.startWorkers(agent, webhookUrl)

    agent.config.logger.info('[Purge] NatsPurgeScheduler started', { ttlSeconds: this.ttlSeconds })
  }

  async schedulePurge(
    recordType: PurgeRecordType,
    recordId: string,
    tenantId: string,
    agentMode: 'shared' | 'dedicated',
  ): Promise<void> {
    if (!this.js) throw new Error('[Purge] NatsPurgeScheduler not started')

    const fireAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString()
    const job: PurgeJob = { recordId, recordType, tenantId, agentMode, scheduledAt: fireAt }

    // Subject is unique per record — prevents later offers overwriting earlier ones
    // (NATS: only one active schedule per subject)
    const scheduleSubject = `${PURGE_SCHEDULER_SUBJECTS[recordType]}.${recordId}`

    const h = headers()
    h.set('Nats-Schedule', `@at ${fireAt}`)
    h.set('Nats-Schedule-Target', PURGE_EXECUTION_SUBJECTS[recordType])
    h.set('Nats-Msg-Id', `purge-${recordType}-${recordId}`)

    await this.js.publish(scheduleSubject, sc.encode(JSON.stringify(job)), { headers: h })

    console.info(`[Purge] Scheduled: ${recordType} recordId=${recordId} fireAt=${fireAt}`)
  }

  async stop(): Promise<void> {
    if (this.nc) {
      await this.nc.drain()
      this.nc = null
      this.js = null
      this.jsm = null
    }
  }

  private async provisionStreams(): Promise<void> {
    if (!this.jsm) throw new Error('[Purge] Not connected')

    // Single combined stream: schedule subjects AND execution subjects must live
    // in the same stream — NATS validates Nats-Schedule-Target against the same stream.
    // Limits retention so schedule messages are not blocked waiting for a consumer ack.
    await this.addOrUpdateStream({
      name: PURGE_STREAM,
      // Wildcards required — schedule subjects include a per-record ID suffix
      // e.g. purge.schedule.oid4vc.issuance.<recordId>
      subjects: ['purge.schedule.>', 'purge.execute.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age: PURGE_STREAM_MAX_AGE_NS,
      discard: DiscardPolicy.Old,
      allow_msg_schedules: true,
    })
  }

  private async addOrUpdateStream(config: any): Promise<void> {
    if (!this.jsm) throw new Error('[Purge] Not connected')
    try {
      await this.jsm.streams.add(config)
    } catch (err: any) {
      if (this.isAlreadyExistsError(err)) {
        await this.jsm.streams.update(config.name, config)
      } else if (err?.message?.includes('subjects overlap')) {
        // Old streams from a previous code version have conflicting subjects.
        // Delete them and retry — safe because these are transient job streams.
        console.warn('[Purge] Subject overlap detected — purging stale streams and retrying')
        await this.deleteStaleStreams(config.subjects)
        await this.jsm.streams.add(config)
      } else {
        throw err
      }
    }
  }

  private async deleteStaleStreams(subjects: string[]): Promise<void> {
    if (!this.jsm) return
    const list = await this.jsm.streams.list().next()
    for (const stream of list) {
      const hasOverlap = stream.config.subjects?.some((s: string) =>
        subjects.some((newS) => s === newS || s.endsWith('>') || newS.endsWith('>')),
      )
      if (hasOverlap && stream.config.name !== PURGE_STREAM) {
        console.warn(`[Purge] Deleting stale stream: ${stream.config.name}`)
        await this.jsm.streams.delete(stream.config.name)
      }
    }
  }

  private async provisionConsumers(): Promise<void> {
    if (!this.jsm) throw new Error('[Purge] Not connected')

    for (const recordType of this.recordTypes) {
      try {
        await this.jsm.consumers.add(PURGE_STREAM, {
          durable_name: PURGE_CONSUMER_NAMES[recordType],
          ack_policy: AckPolicy.Explicit,
          ack_wait: PURGE_CONSUMER_ACK_WAIT_NS,
          max_deliver: PURGE_CONSUMER_MAX_DELIVER,
          backoff: PURGE_CONSUMER_BACKOFF_NS,
          filter_subject: PURGE_EXECUTION_SUBJECTS[recordType],
        })
      } catch (err: any) {
        if (!this.isAlreadyExistsError(err)) throw err
      }
    }
  }

  private async startWorkers(agent: Agent, webhookUrl: string | undefined): Promise<void> {
    if (!this.js) throw new Error('[Purge] Not connected')

    for (const recordType of this.recordTypes) {
      const consumerName = PURGE_CONSUMER_NAMES[recordType]
      const consumer = await this.js.consumers.get(PURGE_STREAM, consumerName)
      const worker = new PurgeWorker(recordType, consumerName, webhookUrl)

      agent.config.logger.info('[Purge] Starting worker', { recordType, consumerName })

      worker.start(agent, consumer).catch((err: Error) =>
        agent.config.logger.error('[Purge] Worker crashed', { consumerName, error: err?.message }),
      )
    }
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
