// import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../../src/cliAgent'
// import type { Agent } from '@credo-ts/core'
// import type { OpenId4VcUpdateVerifierRecordOptions } from '@credo-ts/openid4vc'

// import { OpenId4VcVerifierRepository } from '@credo-ts/openid4vc'
// import { OpenId4VcSiopCreateVerifierOptions } from '../types/verifier.types'
// import { Request as Req } from 'express'

// export class VerifierService {
//   public async createVerifier(
//     agentReq: Req,
//     options: OpenId4VcSiopCreateVerifierOptions,
//   ) {
//     const verifierRecord = await agentReq.agent.modules.openId4VcVerifier.createVerifier(options)
//     return verifierRecord
//   }

//   public async updateVerifierMetadata(
//     agentReq: Req,
//     options: OpenId4VcUpdateVerifierRecordOptions,
//   ) {
//     // console.log(`Updating verifier ${options.verifierId}`)

//     await agentReq.agent.modules.openId4VcVerifier.updateVerifierMetadata(options)
//     const verifierRecord = await this.getVerifier(agentReq, options.verifierId)
//     return verifierRecord
//   }

//   public async getVerifiersByQuery(
//     agentReq: Req,
//     publicVerifierId?: string,
//   ) {
//     const verifierRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
//     const verifiers = await verifierRepository.findByQuery(agentReq.agent.context, {
//       verifierId: publicVerifierId,
//     })

//     return verifiers
//   }

//   public async getVerifier(
//     agentReq: Req,
//     publicVerifierId: string,
//   ) {
//     return await agentReq.agent.modules.openId4VcVerifier.getVerifierByVerifierId(publicVerifierId)
//   }

//   public async deleteVerifier(
//     agentReq: Req,
//     publicVerifierId: string,
//   ) {
//     const verifierRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcVerifierRepository)
//     await verifierRepository.deleteById(agentReq.agent.context, publicVerifierId)
//   }
// }

// export const issuerService = new VerifierService()
