import type { Agent } from '@credo-ts/core'
import type { JetStreamClient, JetStreamManager, NatsConnection } from 'nats'

import { AckPolicy, DiscardPolicy, RetentionPolicy, StorageType, StringCodec, connect, headers } from 'nats'

import { buildNatsAuthenticator } from '../../utils/NatsAuthenticator'

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
  PURGE_STREAM_BUFFER_NS,
} from '../PurgeConstants'
import type { AgentMode, PurgeConfig, PurgeJob } from '../PurgeTypes'
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
      ...buildNatsAuthenticator(natsConfig.nats),
      maxReconnectAttempts: NATS_MAX_RECONNECT_ATTEMPTS,
      reconnectTimeWait: NATS_RECONNECT_TIME_WAIT_MS,
    })
    this.js = this.nc.jetstream()
    this.jsm = await this.nc.jetstreamManager()

    console.log(`[Purge][NATS] Connected to NATS server(s): ${natsConfig.nats.servers}`)
    console.log('[Purge][NATS] Provisioning streams...')
    agent.config.logger.info('[Purge] Provisioning NATS streams...')
    await this.provisionStreams()
    console.log('[Purge][NATS] Streams ready')
    agent.config.logger.info('[Purge] NATS streams ready')

    console.log('[Purge][NATS] Provisioning consumers...')
    agent.config.logger.info('[Purge] Provisioning NATS consumers...')
    await this.provisionConsumers()
    console.log(`[Purge][NATS] Consumers ready — recordTypes=${this.recordTypes.join(', ')}`)
    agent.config.logger.info('[Purge] NATS consumers ready')

    await this.startWorkers(agent, webhookUrl)

    console.log(`[Purge][NATS] Scheduler started — ttlSeconds=${this.ttlSeconds} recordTypes=${this.recordTypes.join(', ')}`)
    agent.config.logger.info('[Purge] NatsPurgeScheduler started', { ttlSeconds: this.ttlSeconds })
  }

  async schedulePurge(
    recordType: PurgeRecordType,
    recordId: string,
    tenantId: string,
    agentMode: AgentMode,
  ): Promise<void> {
    if (!this.js) throw new Error('[Purge] NatsPurgeScheduler not started')

    const fireAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString()
    const job: PurgeJob = { recordId, recordType, tenantId, agentMode, scheduledAt: fireAt }

    // tenantScope ensures subjects and dedup IDs are unique across tenants in shared mode
    const tenantScope = agentMode === 'shared' ? tenantId : 'dedicated'
    // Subject is unique per tenant+record — NATS allows only one active schedule per subject
    const scheduleSubject = `${PURGE_SCHEDULER_SUBJECTS[recordType]}.${tenantScope}.${recordId}`

    const h = headers()
    h.set('Nats-Schedule', `@at ${fireAt}`)
    h.set('Nats-Schedule-Target', PURGE_EXECUTION_SUBJECTS[recordType])
    h.set('Nats-Msg-Id', `purge-${recordType}-${tenantScope}-${recordId}`)

    await this.js.publish(scheduleSubject, sc.encode(JSON.stringify(job)), { headers: h })

    console.info(`[Purge] Scheduled: ${recordType} recordId=${recordId} tenantId="${tenantId}" agentMode=${agentMode} fireAt=${fireAt}`)
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

    await this.addOrUpdateStream({
      name: PURGE_STREAM,
      subjects: ['purge.schedule.>', 'purge.execute.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age: this.ttlSeconds * 1_000_000_000 + PURGE_STREAM_BUFFER_NS,
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
        // Stale streams from a previous version — delete and retry
        console.warn('[Purge] Subject overlap detected — purging stale streams and retrying')
        await this.deleteStaleStreams(config.subjects)
        await this.jsm.streams.add(config)
      } else {
        throw err
      }
    }
  }

  private async deleteStaleStreams(_subjects: string[]): Promise<void> {
    if (!this.jsm) return
    const list = await this.jsm.streams.list().next()
    for (const stream of list) {
      if (stream.config.name === PURGE_STREAM) continue
      // Only delete streams that explicitly claim purge.* subjects — never touch unrelated streams
      const isPurgeStream = stream.config.subjects?.some(
        (s: string) => s.startsWith('purge.schedule.') || s.startsWith('purge.execute.'),
      )
      if (isPurgeStream) {
        console.warn(`[Purge] Deleting stale purge stream: ${stream.config.name}`)
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
      console.log(`[Purge][NATS] Starting worker — recordType=${recordType} consumer=${consumerName}`)
      agent.config.logger.info('[Purge] Starting worker', { recordType, consumerName })
      this.runWorkerWithRestart(agent, recordType, consumerName, webhookUrl)
    }
  }

  private runWorkerWithRestart(
    agent: Agent,
    recordType: PurgeRecordType,
    consumerName: string,
    webhookUrl: string | undefined,
    attempt = 0,
  ): void {
    if (!this.js) return

    const delayMs = Math.min(1000 * 2 ** attempt, 60_000)

    const launch = async () => {
      const consumer = await this.js!.consumers.get(PURGE_STREAM, consumerName)
      const worker = new PurgeWorker(recordType, consumerName, webhookUrl)
      await worker.start(agent, consumer)
    }

    launch()
      .then(() => console.log(`[Purge][NATS] Worker launched — consumer=${consumerName}`))
      .catch((err: Error) => {
        if (!this.nc) return // scheduler stopped — do not restart
        console.error(`[Purge][NATS] Worker crashed — consumer=${consumerName} attempt=${attempt} retryIn=${delayMs}ms`, err?.message)
        agent.config.logger.error('[Purge] Worker crashed — restarting', { consumerName, attempt, delayMs, error: err?.message })
        setTimeout(() => this.runWorkerWithRestart(agent, recordType, consumerName, webhookUrl, attempt + 1), delayMs)
      })
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

