import type { PurgeJob } from './PurgeTypes'
import type { PurgeRecordType } from './PurgeTypes'
import type { Agent } from '@credo-ts/core'
import type { Consumer } from 'nats'

import { RecordNotFoundError } from '@credo-ts/core'
import { StringCodec } from 'nats'

import { PURGE_CONSUMER_MAX_DELIVER, PURGE_WORKER_RESTART_DELAY_MS } from './PurgeConstants'
import { deletePurgeRecord } from './PurgeDeleteRecord'
import { sendPurgeWebhook, PurgeDeletionStatus } from './PurgeWebhook'

const sc = StringCodec()

export class PurgeWorker {
  private recordType: PurgeRecordType
  private consumerName: string
  private webhookUrl: string | undefined
  private stopped = false

  public constructor(recordType: PurgeRecordType, consumerName: string, webhookUrl?: string) {
    this.recordType = recordType
    this.consumerName = consumerName
    this.webhookUrl = webhookUrl
  }

  public stop(): void {
    this.stopped = true
  }

  public async start(agent: Agent, consumer: Consumer): Promise<void> {
    agent.config.logger.info('[Purge] Worker started', { consumer: this.consumerName })

    while (!this.stopped) {
      try {
        const messages = await consumer.consume()
        for await (const msg of messages) {
          await this.processMessage(msg, agent)
        }
        agent.config.logger.warn('[Purge] Consume loop ended — restarting', { consumer: this.consumerName })
      } catch (err: any) {
        if (this.stopped) return
        agent.config.logger.error('[Purge] Consume loop error — restarting after delay', {
          consumer: this.consumerName,
          error: err?.message,
        })
        await new Promise((resolve) => setTimeout(resolve, PURGE_WORKER_RESTART_DELAY_MS))
      }
    }
  }

  private async processMessage(msg: any, agent: Agent): Promise<void> {
    let job: PurgeJob | undefined

    try {
      job = JSON.parse(sc.decode(msg.data)) as PurgeJob
    } catch {
      agent.config.logger.error('[Purge] Failed to parse job — discarding', { consumer: this.consumerName })
      msg.ack()
      return
    }

    const { recordId, recordType, tenantId, agentMode } = job
    const logger = agent.config.logger
    const deliveryCount: number = msg.info.deliveryCount

    if (recordType !== this.recordType) {
      logger.error('[Purge] Job record type mismatch — discarding', {
        expected: this.recordType,
        received: recordType,
        recordId,
      })
      msg.ack()
      return
    }

    logger.info('[Purge] Job received', { recordId, recordType, tenantId, deliveryCount })

    try {
      if (agentMode === 'shared') {
        await (agent as any).modules.tenants.withTenantAgent({ tenantId }, async (tenantAgent: Agent) => {
          await deletePurgeRecord(tenantAgent, this.recordType, recordId)
        })
      } else {
        await deletePurgeRecord(agent, this.recordType, recordId)
      }

      logger.info('[Purge] Record deleted', { recordId, recordType, tenantId })
      msg.ack()

      if (this.webhookUrl) {
        try {
          await sendPurgeWebhook(
            this.webhookUrl,
            recordId,
            this.recordType,
            tenantId,
            PurgeDeletionStatus.DELETED,
            logger,
          )
        } catch (webhookErr: any) {
          logger.warn('[Purge] Webhook delivery failed after deletion', {
            recordId,
            recordType,
            error: webhookErr?.message,
          })
        }
      }
    } catch (err: any) {
      if (err instanceof RecordNotFoundError) {
        logger.warn('[Purge] Record already absent — treating as success', { recordId, recordType })
        msg.ack()

        if (this.webhookUrl) {
          try {
            await sendPurgeWebhook(
              this.webhookUrl,
              recordId,
              this.recordType,
              tenantId,
              PurgeDeletionStatus.ALREADY_ABSENT,
              logger,
            )
          } catch (webhookErr: any) {
            logger.warn('[Purge] Webhook delivery failed for already-absent record', {
              recordId,
              recordType,
              error: webhookErr?.message,
            })
          }
        }
        return
      }

      logger.warn('[Purge] Job failed', { recordId, recordType, deliveryCount, error: err?.message })

      if (deliveryCount >= PURGE_CONSUMER_MAX_DELIVER) {
        logger.error('[Purge] Job dropped after max retries', { recordId, recordType, tenantId, deliveryCount })
        msg.ack()
      } else {
        msg.nak()
      }
    }
  }
}
