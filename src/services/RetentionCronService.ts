import type { Agent } from '@credo-ts/core'
import type { ScheduledTask } from 'node-cron'

import { OpenId4VcIssuanceSessionRepository, OpenId4VcVerificationSessionRepository } from '@credo-ts/openid4vc'
import cron from 'node-cron'

import type { DeletionJob, RetentionConfig } from '../types/RetentionTypes'
import { NATS_SUBJECTS, RecordType, TERMINAL_STATES } from '../types/RetentionTypes'
import { natsClient } from '../utils/NatsClient'

import { didCommCredentialWorker } from './deletion/DidCommCredentialWorker'
import { didCommProofWorker } from './deletion/DidCommProofWorker'
import { oid4VcIssuanceWorker } from './deletion/Oid4VcIssuanceWorker'
import { oid4VcVerificationWorker } from './deletion/Oid4VcVerificationWorker'

class RetentionCronService {
  private job: ScheduledTask | null = null
  private _webhookUrl: string | undefined

  get webhookUrl(): string | undefined {
    return this._webhookUrl
  }

  async start(agent: Agent, config: RetentionConfig, webhookUrl: string | undefined): Promise<void> {
    this._webhookUrl = webhookUrl

    await natsClient.connect(config.nats)
    await natsClient.provisionStreams()
    await natsClient.provisionConsumers()

    const enabledTypes = new Set(config.recordTypes)

    if (enabledTypes.has(RecordType.DIDCOMM_CREDENTIAL)) {
      didCommCredentialWorker
        .start(agent, this._webhookUrl)
        .catch((err: Error) =>
          agent.config.logger.error('[Retention] DidCommCredentialWorker crashed', { error: err?.message }),
        )
    }

    if (enabledTypes.has(RecordType.DIDCOMM_PROOF)) {
      didCommProofWorker
        .start(agent, this._webhookUrl)
        .catch((err: Error) =>
          agent.config.logger.error('[Retention] DidCommProofWorker crashed', { error: err?.message }),
        )
    }

    if (enabledTypes.has(RecordType.OID4VC_ISSUANCE)) {
      oid4VcIssuanceWorker
        .start(agent, this._webhookUrl)
        .catch((err: Error) =>
          agent.config.logger.error('[Retention] Oid4VcIssuanceWorker crashed', { error: err?.message }),
        )
    }

    if (enabledTypes.has(RecordType.OID4VC_VERIFICATION)) {
      oid4VcVerificationWorker
        .start(agent, this._webhookUrl)
        .catch((err: Error) =>
          agent.config.logger.error('[Retention] Oid4VcVerificationWorker crashed', { error: err?.message }),
        )
    }

    agent.config.logger.info('[Retention] Deletion workers started', { enabledTypes: config.recordTypes })

    this.job = cron.schedule(config.cronSchedule, () => {
      this.runScan(agent, config).catch((err: Error) =>
        agent.config.logger.error('[Retention] Unhandled scan error', { error: err?.message }),
      )
    })

    agent.config.logger.info('[Retention] Cron service started', {
      cronSchedule: config.cronSchedule,
      ttlSeconds: config.ttlSeconds,
      recordTypes: config.recordTypes,
    })
  }

  async stop(): Promise<void> {
    this.job?.stop()
    this.job = null
    await natsClient.disconnect()
  }

  private async runScan(agent: Agent, config: RetentionConfig): Promise<void> {
    const logger = agent.config.logger
    let totalPublished = 0

    try {
      const isShared = typeof (agent as any).modules?.tenants?.getAllTenants === 'function'

      logger.info('[Retention] Scan started', { agentMode: isShared ? 'shared' : 'dedicated' })

      if (isShared) {
        const tenants: Array<{ id: string }> = await (agent as any).modules.tenants.getAllTenants()

        for (const tenant of tenants) {
          try {
            await (agent as any).modules.tenants.withTenantAgent(
              { tenantId: tenant.id },
              async (tenantAgent: Agent) => {
                const count = await this.scanTenant(tenantAgent, tenant.id, config)
                totalPublished += count
              },
            )
          } catch (err: any) {
            logger.error('[Retention] Failed to scan tenant', { tenantId: tenant.id, error: err?.message })
          }
        }
      } else {
        totalPublished = await this.scanTenant(agent, '', config)
      }

      logger.info('[Retention] Scan completed', { jobsPublished: totalPublished })
    } catch (err: any) {
      logger.error('[Retention] Scan error', { error: err?.message })
    }
  }

  private async scanTenant(tenantAgent: Agent, tenantId: string, config: RetentionConfig): Promise<number> {
    let published = 0
    const agentMode: 'shared' | 'dedicated' = tenantId === '' ? 'dedicated' : 'shared'

    for (const recordType of config.recordTypes) {
      try {
        const recordIds = await this.queryExpiredRecords(tenantAgent, recordType, config.ttlSeconds)

        if (recordIds.length === 0) continue

        for (const recordId of recordIds) {
          await this.publishJob(recordId, recordType, tenantId, agentMode)
          published++
        }
      } catch (err: any) {
        tenantAgent.config.logger.error('[Retention] Error scanning record type', {
          tenantId,
          recordType,
          error: err?.message,
        })
      }
    }

    return published
  }

  private async queryExpiredRecords(agent: Agent, recordType: RecordType, ttlSeconds: number): Promise<string[]> {
    const terminalStates = TERMINAL_STATES[recordType]
    const cutoffMs = Date.now() - ttlSeconds * 1000
    const expiredIds: string[] = []

    switch (recordType) {
      case RecordType.DIDCOMM_CREDENTIAL: {
        const records = await (agent as any).modules.didcomm.credentials.findAllByQuery({
          state: terminalStates,
        })
        for (const record of records) {
          if (record.updatedAt && new Date(record.updatedAt).getTime() < cutoffMs) {
            expiredIds.push(record.id)
          }
        }
        break
      }

      case RecordType.DIDCOMM_PROOF: {
        const records = await (agent as any).modules.didcomm.proofs.findAllByQuery({
          state: terminalStates,
        })
        for (const record of records) {
          if (record.updatedAt && new Date(record.updatedAt).getTime() < cutoffMs) {
            expiredIds.push(record.id)
          }
        }
        break
      }

      case RecordType.OID4VC_ISSUANCE: {
        const repo = agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
        const records = await repo.findByQuery(agent.context, {})
        for (const record of records) {
          const inTerminalState = terminalStates.includes(record.state as string)
          if (inTerminalState && record.updatedAt && new Date(record.updatedAt).getTime() < cutoffMs) {
            expiredIds.push(record.id)
          }
        }
        break
      }

      case RecordType.OID4VC_VERIFICATION: {
        const repo = agent.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
        const records = await repo.findByQuery(agent.context, {})
        for (const record of records) {
          const inTerminalState = terminalStates.includes(record.state as string)
          if (inTerminalState && record.updatedAt && new Date(record.updatedAt).getTime() < cutoffMs) {
            expiredIds.push(record.id)
          }
        }
        break
      }
    }

    return expiredIds
  }

  private async publishJob(
    recordId: string,
    recordType: RecordType,
    tenantId: string,
    agentMode: 'shared' | 'dedicated',
  ): Promise<void> {
    const job: DeletionJob = {
      recordId,
      recordType,
      tenantId,
      agentMode,
      enqueuedAt: new Date().toISOString(),
    }

    await natsClient.publish(NATS_SUBJECTS[recordType], job)
  }
}

export const retentionCronService = new RetentionCronService()
