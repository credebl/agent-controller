import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../cliAgent'
import type { Agent } from '@credo-ts/core'
import { Request as Req } from 'express'

import { OpenId4VcIssuerRepository } from '@credo-ts/openid4vc/build/openid4vc-issuer/repository'

export class IssuerService {
  public async createIssuerAgent(
    agentReq: Req,
    createIssuerOptions: any, //TODO: Replace with OpenId4VciCreateIssuerOptions,
  ) {
    const issuerRecord = await agentReq.agent.modules.openId4VcIssuer.createIssuer(createIssuerOptions)
    const issuerMetadata = await agentReq.agent.modules.openId4VcIssuer.getIssuerMetadata(issuerRecord.issuerId)
    // eslint-disable-next-line no-console
    console.log(`\nIssuer URL: ${issuerMetadata.credentialIssuer.credential_issuer}`)
    return issuerRecord
  }

  public async updateIssuerMetadata(
    agentReq: Req,
    publicIssuerId: string,
    updateIssuerRecordOptions: any, // TODO: Replace with OpenId4VcUpdateIssuerRecordOptions
  ) {
    await agentReq.agent.modules.openId4VcIssuer.updateIssuerMetadata({
      issuerId: publicIssuerId,
      ...updateIssuerRecordOptions,
    })
    return await this.getIssuer(agentReq, publicIssuerId)
  }

  public async getIssuersByQuery(
    agentReq: Req,
    publicIssuerId?: string,
  ) {
    const repository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuerRepository)
    return await repository.findByQuery(agentReq.agent.context, { issuerId: publicIssuerId })
  }

  public async getIssuer(agentReq:Req , publicIssuerId: string) {
    return await agentReq.agent.modules.openId4VcIssuer.getIssuerByIssuerId(publicIssuerId)
  }

  public async deleteIssuer(agentReq: Req, issuerId: string) {
    const repository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuerRepository)
    await repository.deleteById(agentReq.agent.context, issuerId)
  }

  public async getIssuerAgentMetaData(
    agentReq: Req,
    issuerId: string,
  ) {
    // return await agent.modules.openId4VcIssuer.getIssuerMetadata(issuerId)
    return 0
  }
}

export const issuerService = new IssuerService()
