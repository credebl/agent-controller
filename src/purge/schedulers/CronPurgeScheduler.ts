import type { Agent } from '@credo-ts/core'
import type { ScheduledTask } from 'node-cron'

import { RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository, OpenId4VcVerificationSessionRepository } from '@credo-ts/openid4vc'
import cron from 'node-cron'

import { deletePurgeRecord } from '../PurgeDeleteRecord'
import { sendPurgeWebhook, PurgeDeletionStatus } from '../PurgeWebhook'
import type { PurgeConfig } from '../PurgeTypes'
import { PurgeRecordType } from '../PurgeTypes'

export class CronPurgeScheduler {
  private job: ScheduledTask | null = null
  private isRunning = false

  async start(agent: Agent, config: PurgeConfig, webhookUrl: string | undefined): Promise<void> {
    const { cronConfig } = config

    this.job = cron.schedule(cronConfig.cronSchedule, () => {
      console.log(`[Purge][Cron] Tick fired — schedule="${cronConfig.cronSchedule}"`)
      if (this.isRunning) {
        console.warn('[Purge][Cron] Scan still running — skipping this tick')
        agent.config.logger.warn('[Purge] Cron scan still running — skipping this tick')
        return
      }
      this.isRunning = true
      this.runScan(agent, config, webhookUrl)
        .catch((err: Error) => {
          console.error('[Purge][Cron] Scan error', err?.message)
          agent.config.logger.error('[Purge] Cron scan error', { error: err?.message })
        })
        .finally(() => { this.isRunning = false })
    })

    console.log(`[Purge][Cron] Scheduler started — schedule="${cronConfig.cronSchedule}" ttlSeconds=${cronConfig.ttlSeconds} recordTypes=${cronConfig.recordTypes.join(', ')}`)
    agent.config.logger.info('[Purge] CronPurgeScheduler started', {
      cronSchedule: cronConfig.cronSchedule,
      ttlSeconds: cronConfig.ttlSeconds,
      recordTypes: cronConfig.recordTypes,
    })
  }

  async stop(): Promise<void> {
    this.job?.stop()
    this.job = null
  }

  private async runScan(agent: Agent, config: PurgeConfig, webhookUrl: string | undefined): Promise<void> {
    const logger = agent.config.logger
    const isShared = typeof (agent as any).modules?.tenants?.getAllTenants === 'function'

    console.log(`[Purge][Cron] Scan started — agentMode=${isShared ? 'shared' : 'dedicated'}`)
    logger.info('[Purge] Cron scan started', { agentMode: isShared ? 'shared' : 'dedicated' })

    let totalDeleted = 0

    if (isShared) {
      const tenants: Array<{ id: string }> = await (agent as any).modules.tenants.getAllTenants()

      for (const tenant of tenants) {
        try {
          await (agent as any).modules.tenants.withTenantAgent(
            { tenantId: tenant.id },
            async (tenantAgent: Agent) => {
              const count = await this.scanTenant(tenantAgent, tenant.id, config, webhookUrl)
              totalDeleted += count
            },
          )
        } catch (err: any) {
          console.error(`[Purge][Cron] Failed to scan tenant tenantId=${tenant.id}`, err?.message)
          logger.error('[Purge] Failed to scan tenant', { tenantId: tenant.id, error: err?.message })
        }
      }
    } else {
      totalDeleted = await this.scanTenant(agent, '', config, webhookUrl)
    }

    console.log(`[Purge][Cron] Scan completed — totalDeleted=${totalDeleted}`)
    logger.info('[Purge] Cron scan completed', { totalDeleted })
  }

  private async scanTenant(
    tenantAgent: Agent,
    tenantId: string,
    config: PurgeConfig,
    webhookUrl: string | undefined,
  ): Promise<number> {
    let deleted = 0
    const { cronConfig } = config

    for (const recordType of cronConfig.recordTypes) {
      try {
        const expiredIds = await this.queryExpiredRecords(tenantAgent, recordType, cronConfig.ttlSeconds)
        console.log(`[Purge][Cron] Queried expired records — recordType=${recordType} tenantId="${tenantId}" found=${expiredIds.length}`)

        for (const recordId of expiredIds) {
          console.log(`[Purge][Cron] Deleting record — recordType=${recordType} recordId=${recordId} tenantId="${tenantId}"`)
          if (await this.deleteAndNotify(tenantAgent, recordId, recordType, tenantId, webhookUrl)) {
            deleted++
          }
        }
      } catch (err: any) {
        console.error(`[Purge][Cron] Error scanning recordType=${recordType} tenantId="${tenantId}"`, err?.message)
        tenantAgent.config.logger.error('[Purge] Error scanning record type', {
          tenantId,
          recordType,
          error: err?.message,
        })
      }
    }

    return deleted
  }

  private async queryExpiredRecords(
    agent: Agent,
    recordType: PurgeRecordType,
    ttlSeconds: number,
  ): Promise<string[]> {
    const cutoffMs = Date.now() - ttlSeconds * 1000
    const ids: string[] = []

    switch (recordType) {
      case PurgeRecordType.DIDCOMM_CREDENTIAL: {
        const records = await (agent as any).modules.didcomm.credentials.findAllByQuery({})
        for (const r of records) {
          if (r.createdAt && new Date(r.createdAt).getTime() < cutoffMs) ids.push(r.id)
        }
        break
      }

      case PurgeRecordType.DIDCOMM_PROOF: {
        const records = await (agent as any).modules.didcomm.proofs.findAllByQuery({})
        for (const r of records) {
          if (r.createdAt && new Date(r.createdAt).getTime() < cutoffMs) ids.push(r.id)
        }
        break
      }

      case PurgeRecordType.OID4VC_ISSUANCE: {
        const repo = agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
        const records = await repo.findByQuery(agent.context, {})
        for (const r of records) {
          if (r.createdAt && new Date(r.createdAt).getTime() < cutoffMs) ids.push(r.id)
        }
        break
      }

      case PurgeRecordType.OID4VC_VERIFICATION: {
        const repo = agent.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
        const records = await repo.findByQuery(agent.context, {})
        for (const r of records) {
          if (r.createdAt && new Date(r.createdAt).getTime() < cutoffMs) ids.push(r.id)
        }
        break
      }
    }

    return ids
  }

  private async deleteAndNotify(
    agent: Agent,
    recordId: string,
    recordType: PurgeRecordType,
    tenantId: string,
    webhookUrl: string | undefined,
  ): Promise<boolean> {
    const logger = agent.config.logger
    let status: PurgeDeletionStatus

    try {
      await deletePurgeRecord(agent, recordType, recordId)
      console.log(`[Purge][Cron] Record deleted — recordType=${recordType} recordId=${recordId} tenantId="${tenantId}"`)
      logger.info('[Purge] Record deleted by cron', { recordId, recordType, tenantId })
      status = PurgeDeletionStatus.DELETED
    } catch (err: any) {
      if (err instanceof RecordNotFoundError) {
        console.warn(`[Purge][Cron] Record already absent — recordType=${recordType} recordId=${recordId}`)
        logger.warn('[Purge] Record already absent — skipping', { recordId, recordType })
        status = PurgeDeletionStatus.ALREADY_ABSENT
      } else {
        console.error(`[Purge][Cron] Failed to delete record — recordType=${recordType} recordId=${recordId}`, err?.message)
        logger.error('[Purge] Failed to delete record', { recordId, recordType, error: err?.message })
        return false
      }
    }

    if (webhookUrl) {
      await sendPurgeWebhook(webhookUrl, recordId, recordType, tenantId, status, logger)
   
 }

    return true
  }
}
