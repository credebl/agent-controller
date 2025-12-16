import type { RestAgentModules } from '../../../cliAgent'
import type { Agent } from '@credo-ts/core'
import type { Request as Req } from 'express'

// import { OpenId4VcIssuerRepository } from '@credo-ts/openid4vc/build/openid4vc-issuer/repository/OpenId4VcIssuerRepository.mjs'

export class IssuerService {
  public async createIssuerAgent(
    agentReq: Req,
    createIssuerOptions: any, //TODO: Replace with OpenId4VciCreateIssuerOptions,
  ) {
    console.log('Creating issuer agent with options:', JSON.stringify(createIssuerOptions))
    const issuerRecord = await agentReq.agent.modules.openid4vc.issuer?.createIssuer(createIssuerOptions)
    console.log('Created issuer record:', JSON.stringify(issuerRecord, null, 2))
    const issuerMetadata = await agentReq.agent.modules.openid4vc.issuer?.getIssuerMetadata(
      issuerRecord?.issuerId ?? '',
    )
    // eslint-disable-next-line no-console
    console.log(`\nIssuer URL: ${issuerMetadata?.credentialIssuer.credential_issuer}`)
    return issuerRecord
  }

  public async updateIssuerMetadata(
    agentReq: Req,
    publicIssuerId: string,
    updateIssuerRecordOptions: any, // TODO: Replace with OpenId4VcUpdateIssuerRecordOptions
  ) {
    await agentReq.agent.modules.openid4vc.issuer?.updateIssuerMetadata({
      issuerId: publicIssuerId,
      ...updateIssuerRecordOptions,
    })
    return await this.getIssuer(agentReq, publicIssuerId)
  }

  public async getIssuersByQuery(agentReq: Req, publicIssuerId?: string) {
    const result = publicIssuerId
      ? (agentReq.agent as Agent<RestAgentModules>).openid4vc.issuer.getIssuerByIssuerId(publicIssuerId) // .dependencyManager.resolve(OpenId4VcIssuerRepository)
      : (agentReq.agent as Agent<RestAgentModules>).openid4vc.issuer.getAllIssuers()
    return result
  }

  public async getIssuer(agentReq: Req, publicIssuerId: string) {
    return await agentReq.agent.modules.openid4vc.issuer?.getIssuerByIssuerId(publicIssuerId)
  }

  // public async deleteIssuer(agentReq: Req, issuerId: string) {
  //   const result = (agentReq.agent as Agent<RestAgentModules>).openid4vc.config.issuer.
  //   return result
  // }

  public async getIssuerAgentMetaData(agentReq: Req, issuerId: string) {
    // return await agent.modules.openId4VcIssuer.getIssuerMetadata(issuerId)
    return 0
  }
}

export const issuerService = new IssuerService()
