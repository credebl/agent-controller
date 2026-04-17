import type { Agent } from '@credo-ts/core'

import { OpenId4VcVerificationSessionRepository } from '@credo-ts/openid4vc'

import { RecordType } from '../../types/RetentionTypes'
import { BaseRetentionWorker } from './BaseRetentionWorker'

export class Oid4VcVerificationWorker extends BaseRetentionWorker {
  protected recordType = RecordType.OID4VC_VERIFICATION
  protected consumerName = 'retention-worker-oid4vc-verification'

  protected async deleteRecord(agent: Agent, recordId: string): Promise<void> {
    const repository = agent.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
    await repository.deleteById(agent.context, recordId)
  }
}

export const oid4VcVerificationWorker = new Oid4VcVerificationWorker()
