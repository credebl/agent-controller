import type { Agent } from '@credo-ts/core'

import { OpenId4VcIssuanceSessionRepository, OpenId4VcVerificationSessionRepository } from '@credo-ts/openid4vc'

import { PurgeRecordType } from './PurgeTypes'

export async function deletePurgeRecord(agent: Agent, recordType: PurgeRecordType, recordId: string): Promise<void> {
  switch (recordType) {
    case PurgeRecordType.DIDCOMM_CREDENTIAL:
      await (agent as any).modules.didcomm.credentials.deleteById(recordId)
      break

    case PurgeRecordType.DIDCOMM_PROOF:
      await (agent as any).modules.didcomm.proofs.deleteById(recordId)
      break

    case PurgeRecordType.OID4VC_ISSUANCE: {
      const repo = agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
      await repo.deleteById(agent.context, recordId)
      break
    }

    case PurgeRecordType.OID4VC_VERIFICATION: {
      const repo = agent.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
      await repo.deleteById(agent.context, recordId)
      break
    }

    default: {
      const _exhaustive: never = recordType
      throw new Error(`[Purge] Unhandled record type: ${_exhaustive}`)
    }
  }
}
