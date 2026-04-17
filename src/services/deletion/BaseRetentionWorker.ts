import type { Agent, Logger } from '@credo-ts/core'
import type { JsMsg } from 'nats'

import { RecordNotFoundError } from '@credo-ts/core'
import { StringCodec } from 'nats'

import type { DeletionJob } from '../../types/RetentionTypes'
import { DLQ_SUBJECTS, WEBHOOK_PATHS, RecordType, DeletionStatus } from '../../types/RetentionTypes'
import { natsClient } from '../../utils/NatsClient'
import { CONSUMER_MAX_DELIVER, WEBHOOK_RETRY_DELAYS_MS } from '../../utils/NatsConstants'
import { sleep } from '../../utils/webhook'

const sc = StringCodec()

export abstract class BaseRetentionWorker {
  protected abstract recordType: RecordType
  protected abstract consumerName: string

  protected abstract deleteRecord(agent: Agent, recordId: string): Promise<void>

  async start(agent: Agent, webhookUrl: string | undefined): Promise<void> {
    try {
      const consumer = await natsClient.getPullConsumer(this.consumerName)
      agent.config.logger.info(`[Retention] Worker started`, { consumer: this.consumerName })

      while (true) {
        const messages = await consumer.consume()
        for await (const msg of messages) {
          await this.processMessage(msg, agent, webhookUrl)
        }
        agent.config.logger.warn(`[Retention] Consume loop ended — restarting`, { consumer: this.consumerName })
      }
    } catch (err: any) {
      agent.config.logger.error(`[Retention] Worker loop exited`, {
        consumer: this.consumerName,
        error: err?.message,
        stack: err?.stack,
      })
    }
  }

  private async processMessage(msg: JsMsg, agent: Agent, webhookUrl: string | undefined): Promise<void> {
    let job: DeletionJob | undefined

    try {
      job = JSON.parse(sc.decode(msg.data)) as DeletionJob
    } catch {
      agent.config.logger.error('[Retention] Failed to parse job message — discarding', {
        consumer: this.consumerName,
      })
      msg.ack()
      return
    }

    const { recordId, recordType, tenantId, agentMode } = job
    const logger = agent.config.logger
    const deliveryCount = msg.info.deliveryCount

    logger.debug('[Retention] Job received', { recordId, recordType, tenantId, deliveryCount })

    try {
      if (agentMode === 'shared') {
        await (agent as any).modules.tenants.withTenantAgent({ tenantId }, async (tenantAgent: Agent) => {
          await this.deleteRecord(tenantAgent, recordId)
        })
      } else {
        await this.deleteRecord(agent, recordId)
      }

      logger.info('[Retention] Record deleted', { recordId, recordType, tenantId })

      msg.ack()
      if (webhookUrl) {
        await this.sendWebhookWithRetry(
          `${webhookUrl}${WEBHOOK_PATHS[this.recordType]}`,
          this.buildWebhookBody(job, DeletionStatus.DELETED),
          logger,
        )
      }
    } catch (err: any) {
      if (err instanceof RecordNotFoundError) {
        logger.warn('[Retention] Record already absent — treating as success', { recordId, recordType })

        msg.ack()
        if (webhookUrl) {
          await this.sendWebhookWithRetry(
            `${webhookUrl}${WEBHOOK_PATHS[this.recordType]}`,
            this.buildWebhookBody(job, DeletionStatus.ALREADY_ABSENT),
            logger,
          )
        }
        return
      }

      logger.warn('[Retention] Job failed', { recordId, recordType, deliveryCount, error: err?.message })

      if (deliveryCount >= CONSUMER_MAX_DELIVER) {
        try {
          await natsClient.publishToDlq(DLQ_SUBJECTS[this.recordType], job, err?.message ?? 'unknown error')
        } catch (dlqErr: any) {
          logger.error('[Retention] Failed to publish to DLQ', { recordId, error: dlqErr?.message })
        }

        logger.error('[Retention] Job moved to DLQ after max retries', {
          recordId,
          recordType,
          tenantId,
          deliveryCount,
        })

        msg.ack()
      } else {
        logger.warn('[Retention] Job failed — retrying', { recordId, deliveryCount })
        msg.nak()
      }
    }
  }

  private async sendWebhookWithRetry(
    url: string,
    body: Record<string, unknown>,
    logger: Logger,
  ): Promise<void> {
    const delays = WEBHOOK_RETRY_DELAYS_MS
    const maxAttempts = delays.length + 1

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fetch(url, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        })
        logger.debug('[Retention] Webhook sent', { url, recordId: (body.deletion as any)?.recordId })
        return
      } catch (err: any) {
        const isLastAttempt = attempt === maxAttempts - 1
        if (isLastAttempt) {
          logger.warn('[Retention] Webhook delivery failed after all retries', { url, error: err?.message })
        } else {
          logger.debug(`[Retention] Webhook attempt ${attempt + 1} failed — retrying in ${delays[attempt]}ms`)
          await sleep(delays[attempt])
        }
      }
    }
  }

  private buildWebhookBody(job: DeletionJob, status: DeletionStatus): Record<string, unknown> {
    return {
      eventType: 'retention.deletion.complete',
      occurredAt: new Date().toISOString(),
      tenantId: job.tenantId,
      deletion: {
        recordId: job.recordId,
        recordType: job.recordType,
        status,
        deletedAt: new Date().toISOString(),
      },
    }
  }
}
