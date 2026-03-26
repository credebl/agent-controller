import type { OpenId4VcIssuanceSessionsCreateOffer } from '../types/issuer.types'
import type { Request as Req } from 'express'

import { type OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'

import { SignerMethod } from '../../../enums/enum'
import { BadRequestError, NotFoundError } from '../../../errors/errors'

import { checkAndCreateStatusList, getServerUrl } from '../../../utils/statusListService'

class IssuanceSessionsService {
  public async createCredentialOffer(options: OpenId4VcIssuanceSessionsCreateOffer, agentReq: Req) {
    const { credentials, publicIssuerId } = options

    const issuer = await agentReq.agent.modules.openid4vc.issuer?.getIssuerByIssuerId(publicIssuerId)
    if (!issuer) {
      throw new NotFoundError(`Issuer with id ${publicIssuerId} not found`)
    }

    const offerStatusInfo: any[] = []

    const mappedCredentials = await Promise.all(credentials.map(async (cred) => {
      const supported = issuer?.credentialConfigurationsSupported[cred.credentialSupportedId]
      if (!supported) {
        throw new Error(`CredentialSupportedId '${cred.credentialSupportedId}' is not supported by issuer`)
      }
      if (supported.format !== cred.format) {
        throw new Error(
          `Format mismatch for '${cred.credentialSupportedId}': expected '${supported.format}', got '${cred.format}'`,
        )
      }

      // must have signing options
      if (!cred.signerOptions?.method) {
        throw new BadRequestError(
          `signerOptions must be provided and allowed methods are ${Object.values(SignerMethod).join(', ')}`,
        )
      }

      if (cred.signerOptions.method == SignerMethod.Did && !cred.signerOptions.did) {
        throw new BadRequestError(
          `For ${cred.credentialSupportedId} : did must be present inside signerOptions if SignerMethod is 'did' `,
        )
      }

      if (cred.signerOptions.method === SignerMethod.X5c && !cred.signerOptions.x5c) {
        throw new BadRequestError(
          `For ${cred.credentialSupportedId} : x5c must be present inside signerOptions if SignerMethod is 'x5c' `,
        )
      }

      const effectiveIssuerDid = cred.signerOptions?.method === SignerMethod.Did ? cred.signerOptions.did : undefined
      const effectiveStatusList = cred.statusListDetails || options.statusListDetails

      let statusBlock = undefined
      if (effectiveIssuerDid && effectiveStatusList) {
        await checkAndCreateStatusList(
          agentReq.agent as any,
          effectiveStatusList.listId,
          effectiveIssuerDid,
          effectiveStatusList.listSize,
        )
        const listUri = `${getServerUrl()}/status-lists/${effectiveStatusList.listId}`

        statusBlock = {
          status_list: {
            uri: listUri,
            idx: effectiveStatusList.index
          }
        }

        offerStatusInfo.push({
          credentialSupportedId: cred.credentialSupportedId,
          listId: effectiveStatusList.listId,
          index: effectiveStatusList.index,
          issuerDid: effectiveIssuerDid
        })
      }

      const currentVct = cred.payload && 'vct' in cred.payload ? (cred.payload as any).vct : undefined
      return {
        ...cred,
        payload: {
          ...cred.payload,
          vct: currentVct ?? (typeof supported.vct === 'string' ? supported.vct : undefined),
          ...(statusBlock ? { status: statusBlock } : {})
        },
      }
    }))

    options.issuanceMetadata ||= {}
    options.issuanceMetadata.credentials = mappedCredentials

    if (offerStatusInfo.length > 0) {
      options.issuanceMetadata.StatusListInfo = offerStatusInfo
    }

    const issuerModule = agentReq.agent.modules.openid4vc.issuer

    if (!issuerModule) {
      throw new Error('OID4VC issuer module not initialized')
    }
    const { credentialOffer, issuanceSession } = await issuerModule.createCredentialOffer({
      issuerId: publicIssuerId,
      issuanceMetadata: options.issuanceMetadata,
      credentialConfigurationIds: credentials.map((c) => c.credentialSupportedId),
      preAuthorizedCodeFlowConfig: options.preAuthorizedCodeFlowConfig,
      authorizationCodeFlowConfig: options.authorizationCodeFlowConfig,
    })

    return { credentialOffer, issuanceSession }
  }

  public async getIssuanceSessionsById(agentReq: Req, sessionId: string) {
    const issuer = agentReq.agent.modules.openid4vc.issuer
    if (!issuer) {
      throw new Error('OID4VC issuer module not initialized')
    }
    return issuer.getIssuanceSessionById(sessionId)
  }

  public async getIssuanceSessionsByQuery(
    agentReq: Req,
    cNonce?: string,
    publicIssuerId?: string,
    preAuthorizedCode?: string,
    state?: OpenId4VcIssuanceSessionState,
    credentialOfferUri?: string,
    authorizationCode?: string,
  ) {
    const issuanceSessionRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
    const issuanceSessions = await issuanceSessionRepository.findByQuery(agentReq.agent.context, {
      cNonce,
      issuerId: publicIssuerId,
      preAuthorizedCode,
      state,
      credentialOfferUri,
      authorizationCode,
    })

    return issuanceSessions
  }

  /**
   * update an existing issuance session metadata, useful for mobile edge
   * agents that will scan QR codes to notify the system of their
   * wallet user id
   *
   * @param issuerAgent
   * @param sessionId
   * @param metadata
   * @returns the updated issuance session record
   */
  public async updateSessionIssuanceMetadataById(agentReq: Req, sessionId: string, metadata: Record<string, unknown>) {
    const issuanceSessionRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)

    const record = await issuanceSessionRepository.findById(agentReq.agent.context, sessionId)

    if (!record) {
      throw new NotFoundError(`Issuance session with id ${sessionId} not found`)
    }

    record.issuanceMetadata = {
      ...record.issuanceMetadata,
      ...metadata,
    }

    await issuanceSessionRepository.update(agentReq.agent.context, record)

    return record
  }

  /**
   * deletes ann issuance session by id
   *
   * @param sessionId
   * @param issuerAgent
   */
  public async deleteById(agentReq: Req, sessionId: string): Promise<void> {
    const issuanceSessionRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
    await issuanceSessionRepository.deleteById(agentReq.agent.context, sessionId)
  }

  public async revokeBySessionId(agentReq: Req, sessionId: string) {
    const issuanceSessionRepository = agentReq.agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
    const record = await issuanceSessionRepository.findById(agentReq.agent.context, sessionId)

    if (!record) {
      throw new NotFoundError(`Issuance session with id ${sessionId} not found`)
    }

    const statusInfo = record.issuanceMetadata?.StatusListInfo as any[]
    if (!statusInfo || statusInfo.length === 0) {
      throw new Error(`No status list information found for session ${sessionId}`)
    }

    const { revokeCredentialInStatusList } = await import('../../../utils/statusListService')

    for (const info of statusInfo) {
      await revokeCredentialInStatusList(agentReq.agent as any, info.listId, info.index, info.issuerDid)
    }

    return { message: 'Credentials in session revoked successfully' }
  }
}

export const issuanceSessionService = new IssuanceSessionsService()
