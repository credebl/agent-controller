import type { RestAgentModules } from '../../../cliAgent'
import type { CreateIssuerOptions } from '../types/issuer.types'
import type { Agent } from '@credo-ts/core'
import type { Request as Req } from 'express'

import { OpenId4VcIssuerRepository } from '@credo-ts/openid4vc'

export class IssuerService {
  public async createIssuerAgent(
    agentReq: Req,
    createIssuerOptions: any, //TODO: Replace with OpenId4VciCreateIssuerOptions,
  ) {
    const issuer = agentReq.agent.modules.openid4vc.issuer
    if (!issuer) {
      throw new Error('OID4VC issuer module not initialized')
    }
    const issuerRecord = await issuer.createIssuer(createIssuerOptions)
    const issuerMetadata = await issuer.getIssuerMetadata(issuerRecord?.issuerId ?? '')
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
      ? (agentReq.agent as Agent<RestAgentModules>).openid4vc.issuer?.getIssuerByIssuerId(publicIssuerId)
      : (agentReq.agent as Agent<RestAgentModules>).openid4vc.issuer?.getAllIssuers()
    return result
  }

  public async getIssuer(agentReq: Req, publicIssuerId: string) {
    return await agentReq.agent.modules.openid4vc.issuer?.getIssuerByIssuerId(publicIssuerId)
  }

  public async deleteIssuer(agentReq: Req, issuerId: string) {
    const issuanceRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuerRepository)
    await issuanceRepository.deleteById(agentReq.agent.context, issuerId)
    return { message: 'Record deleted successfully' }
  }

  public async getIssuerAgentMetaData(agentReq: Req, issuerId: string) {
    return (await agentReq.agent.modules.openid4vc.issuer?.getIssuerMetadata(issuerId)) as any
  }
}

export const issuerService = new IssuerService()
