import type { Agent } from '@credo-ts/core'
import type { Consumer } from 'nats'

import { RecordNotFoundError } from '@credo-ts/core'
import { StringCodec } from 'nats'

import { PURGE_CONSUMER_MAX_DELIVER } from './PurgeConstants'
import { deletePurgeRecord } from './PurgeDeleteRecord'
import { sendPurgeWebhook, PurgeDeletionStatus } from './PurgeWebhook'
import type { PurgeJob } from './PurgeTypes'
import { PurgeRecordType } from './PurgeTypes'

const sc = StringCodec()

export class PurgeWorker {
  private recordType: PurgeRecordType
  private consumerName: string
  private webhookUrl: string | undefined

  constructor(recordType: PurgeRecordType, consumerName: string, webhookUrl?: string) {
    this.recordType = recordType
    this.consumerName = consumerName
    this.webhookUrl = webhookUrl
  }

  async start(agent: Agent, consumer: Consumer): Promise<void> {
    console.log(`[Purge][Worker] Started — consumer=${this.consumerName} recordType=${this.recordType}`)
    agent.config.logger.info('[Purge] Worker started', { consumer: this.consumerName })

    while (true) {
      const messages = await consumer.consume()
      console.log(`[Purge][Worker] Consuming messages — consumer=${this.consumerName}`)
      for await (const msg of messages) {
        await this.processMessage(msg, agent)
      }
      console.warn(`[Purge][Worker] Consume loop ended — restarting consumer=${this.consumerName}`)
      agent.config.logger.warn('[Purge] Consume loop ended — restarting', { consumer: this.consumerName })
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

    console.log(`[Purge][Worker] Job received — recordType=${recordType} recordId=${recordId} tenantId="${tenantId}" deliveryCount=${deliveryCount}`)
    logger.info('[Purge] Job received', { recordId, recordType, tenantId, deliveryCount })

    try {
      if (agentMode === 'shared') {
        await (agent as any).modules.tenants.withTenantAgent({ tenantId }, async (tenantAgent: Agent) => {
          await deletePurgeRecord(tenantAgent, this.recordType, recordId)
        })
      } else {
        await deletePurgeRecord(agent, this.recordType, recordId)
      }

      console.log(`[Purge][Worker] Record deleted — recordType=${recordType} recordId=${recordId} tenantId="${tenantId}"`)
      logger.info('[Purge] Record deleted', { recordId, recordType, tenantId })
      msg.ack()

      if (this.webhookUrl) {
        await sendPurgeWebhook(this.webhookUrl, recordId, this.recordType, tenantId, PurgeDeletionStatus.DELETED, logger)
      }
    } catch (err: any) {
      if (err instanceof RecordNotFoundError) {
        console.warn(`[Purge][Worker] Record already absent — recordType=${recordType} recordId=${recordId}`)
        logger.warn('[Purge] Record already absent — treating as success', { recordId, recordType })
        msg.ack()

        if (this.webhookUrl) {
          await sendPurgeWebhook(this.webhookUrl, recordId, this.recordType, tenantId, PurgeDeletionStatus.ALREADY_ABSENT, logger)
        }
        return
      }

      console.warn(`[Purge][Worker] Job failed — recordType=${recordType} recordId=${recordId} deliveryCount=${deliveryCount}`, err?.message)
      logger.warn('[Purge] Job failed', { recordId, recordType, deliveryCount, error: err?.message })

      if (deliveryCount >= PURGE_CONSUMER_MAX_DELIVER) {
        console.error(`[Purge][Worker] Job dropped after max retries — recordType=${recordType} recordId=${recordId} tenantId="${tenantId}"`)
        logger.error('[Purge] Job dropped after max retries', { recordId, recordType, tenantId, deliveryCount })
        msg.ack()
      } else {
        console.log(`[Purge][Worker] Nacking job for retry — recordType=${recordType} recordId=${recordId} deliveryCount=${deliveryCount}`)
        msg.nak()
      }
    }
  }

}
