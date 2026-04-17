import type { Agent } from '@credo-ts/core'

import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'

import { RecordType } from '../../types/RetentionTypes'
import { BaseRetentionWorker } from './BaseRetentionWorker'

export class Oid4VcIssuanceWorker extends BaseRetentionWorker {
  protected recordType = RecordType.OID4VC_ISSUANCE
  protected consumerName = 'retention-worker-oid4vc-issuance'

  protected async deleteRecord(agent: Agent, recordId: string): Promise<void> {
    agent.config.logger.info(`[Retention] Attempting to delete OID4VC issuance session`, { recordId })
    try {
      const repository = agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
      await repository.deleteById(agent.context, recordId)
      agent.config.logger.info(`[Retention] Successfully deleted OID4VC issuance session`, { recordId })
    } catch (err: any) {
      agent.config.logger.error(`[Retention] Failed to delete OID4VC issuance session`, {
        recordId,
        error: err?.message,
        errorType: err?.constructor?.name,
      })
      throw err // re-throw so BaseRetentionWorker can handle retry/DLQ
    }
  }
}

export const oid4VcIssuanceWorker = new Oid4VcIssuanceWorker()
