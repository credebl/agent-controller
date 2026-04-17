import type { Agent } from '@credo-ts/core'

import { RecordType } from '../../types/RetentionTypes'
import { BaseRetentionWorker } from './BaseRetentionWorker'

export class DidCommProofWorker extends BaseRetentionWorker {
  protected recordType = RecordType.DIDCOMM_PROOF
  protected consumerName = 'retention-worker-didcomm-proof'

  protected async deleteRecord(agent: Agent, recordId: string): Promise<void> {
    await (agent as any).modules.didcomm.proofs.deleteById(recordId)
  }
}

export const didCommProofWorker = new DidCommProofWorker()
