import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../../src/cliAgent'
import type { OpenId4VcSiopCreateVerifierOptions } from '../types/verifier.types'
import type { Agent } from '@credo-ts/core'
import type { OpenId4VcUpdateVerifierRecordOptions } from '@credo-ts/openid4vc'
import type { Request as Req } from 'express'

import { OpenId4VcVerifierRepository } from '@credo-ts/openid4vc'

export class VerifierService {
  public async createVerifier(agentReq: Req, options: OpenId4VcSiopCreateVerifierOptions) {
    const verifierRecord = await agentReq.agent.modules.openid4vc.verifier.createVerifier(options)
    return verifierRecord
  }

  public async updateVerifierMetadata(agentReq: Req, options: OpenId4VcUpdateVerifierRecordOptions) {
    await agentReq.agent.modules.openid4vc.verifier.updateVerifierMetadata(options)
    const verifierRecord = await this.getVerifier(agentReq, options.verifierId)
    return verifierRecord
  }

  public async getVerifiersByQuery(agentReq: Req, publicVerifierId?: string) {
    const verifierRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
    const verifiers = await verifierRepository.findByQuery(agentReq.agent.context, {
      verifierId: publicVerifierId,
    })

    return verifiers
  }

  public async getVerifier(agentReq: Req, publicVerifierId: string) {
    return await agentReq.agent.modules.openid4vc.verifier.getVerifierByVerifierId(publicVerifierId)
  }

  public async deleteVerifier(agentReq: Req, verifierId: string) {
    const verifierRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
    return await verifierRepository
      .deleteById(agentReq.agent.context, verifierId)
      .then(() => ({ message: 'Record deleted successfully' }))
  }
}
