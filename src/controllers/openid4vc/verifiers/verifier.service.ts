import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../../src/cliAgent'
import type { Agent } from '@credo-ts/core'
import type { OpenId4VcUpdateVerifierRecordOptions } from '@credo-ts/openid4vc'

import { OpenId4VcVerifierRepository } from '@credo-ts/openid4vc'
import { OpenId4VcSiopCreateVerifierOptions } from '../types/verifier.types'

export class VerifierService {
  public async createVerifier(
    agent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    options: OpenId4VcSiopCreateVerifierOptions,
  ) {
    const verifierRecord = await agent.modules.openId4VcVerifier.createVerifier(options)
    return verifierRecord
  }

  public async updateVerifierMetadata(
    agent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    options: OpenId4VcUpdateVerifierRecordOptions,
  ) {
    // console.log(`Updating verifier ${options.verifierId}`)

    await agent.modules.openId4VcVerifier.updateVerifierMetadata(options)
    const verifierRecord = await this.getVerifier(agent, options.verifierId)
    return verifierRecord
  }

  public async getVerifiersByQuery(
    agent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    publicVerifierId?: string,
  ) {
    const verifierRepository = agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
    const verifiers = await verifierRepository.findByQuery(agent.context, {
      verifierId: publicVerifierId,
    })

    return verifiers
  }

  public async getVerifier(
    agent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    publicVerifierId: string,
  ) {
    return await agent.modules.openId4VcVerifier.getVerifierByVerifierId(publicVerifierId)
  }

  public async deleteVerifier(
    agent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    publicVerifierId: string,
  ) {
    const verifierRepository = agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
    await verifierRepository.deleteById(agent.context, publicVerifierId)
  }
}

export const issuerService = new VerifierService()
