import type { Agent } from '@credo-ts/core'

import { RecordType } from '../../types/RetentionTypes'
import { BaseRetentionWorker } from './BaseRetentionWorker'

export class DidCommCredentialWorker extends BaseRetentionWorker {
  protected recordType = RecordType.DIDCOMM_CREDENTIAL
  protected consumerName = 'retention-worker-didcomm-credential'

  protected async deleteRecord(agent: Agent, recordId: string): Promise<void> {
    await (agent as any).modules.didcomm.credentials.deleteById(recordId)
  }
}

export const didCommCredentialWorker = new DidCommCredentialWorker()
