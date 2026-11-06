import type { OpenId4VcIssuanceSessionsCreateOffer } from '../types/issuer.types'
import type { Request as Req } from 'express'

import { OpenId4VcIssuanceSessionRepository, type OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'

import { CredentialFormat, SignerMethod } from '../../../enums/enum'
import { BadRequestError, NotFoundError } from '../../../errors/errors'
import { STATUS_LISTS_PATH } from '../../../utils/constant'
import {
  checkAndCreateBitstringStatusList,
  checkAndCreateStatusList,
  getServerUrl,
  revokeBitstringInStatusList,
  revokeCredentialInStatusList,
} from '../../../utils/statusListService'
import { transformPayloadForVersion } from '../../../utils/vcContext'

class IssuanceSessionsService {
  public async createCredentialOffer(options: OpenId4VcIssuanceSessionsCreateOffer, agentReq: Req) {
    const { credentials, publicIssuerId } = options

    const issuer = await agentReq.agent.modules.openid4vc.issuer?.getIssuerByIssuerId(publicIssuerId)
    if (!issuer) {
      throw new NotFoundError(`Issuer with id ${publicIssuerId} not found`)
    }

    const offerStatusInfo: any[] = []

    const mappedCredentials = await Promise.all(
      credentials.map(async (cred) => {
        const supported = issuer.credentialConfigurationsSupported[cred.credentialSupportedId]

        const format = cred.format as unknown as CredentialFormat
        const isJsonLdFormat = format === CredentialFormat.JwtVcJsonLd || format === CredentialFormat.LdpVc
        const effectiveVersion = options.version === 'v2.0' && isJsonLdFormat ? 'v2.0' : undefined

        this.validateCredentialConfig(cred, supported, effectiveVersion)

        const statusBlock = await this.processStatusList(cred, options, agentReq, offerStatusInfo)

        const currentVct = cred.payload && 'vct' in cred.payload ? cred.payload.vct : undefined
        const statusProperty = isJsonLdFormat ? { credentialStatus: statusBlock } : { status: statusBlock }
        const transformedPayload = transformPayloadForVersion(
          {
            ...cred.payload,
            vct: currentVct ?? (typeof supported.vct === 'string' ? supported.vct : undefined),
            ...(statusBlock ? statusProperty : {}),
          },
          effectiveVersion,
          isJsonLdFormat && Boolean(statusBlock),
        )

        return {
          ...cred,
          payload: transformedPayload,
        }
      }),
    )

    options.issuanceMetadata ||= {}
    options.issuanceMetadata.credentials = mappedCredentials
    options.issuanceMetadata.isRevocable = options.isRevocable

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
      version: 'v1',
    })

    return { credentialOffer, issuanceSession }
  }

  private validateCredentialConfig(cred: any, supported: any, version?: string) {
    if (!supported) {
      throw new Error(`CredentialSupportedId '${cred.credentialSupportedId}' is not supported by issuer`)
    }
    if (supported.format !== cred.format) {
      throw new Error(
        `Format mismatch for '${cred.credentialSupportedId}': expected '${supported.format}', got '${cred.format}'`,
      )
    }

    const isW3cFormat =
      cred.format === CredentialFormat.JwtVcJson ||
      cred.format === CredentialFormat.JwtVcJsonLd ||
      cred.format === CredentialFormat.LdpVc

    if (isW3cFormat && !cred.payload?.credentialSubject) {
      throw new BadRequestError(
        `Credential payload for '${cred.credentialSupportedId}' must contain 'credentialSubject'`,
      )
    }

    if (
      version === 'v2.0' &&
      cred.payload?.issuer &&
      typeof cred.payload.issuer === 'object' &&
      !cred.payload.issuer.id
    ) {
      throw new BadRequestError(`Issuer object for '${cred.credentialSupportedId}' must contain 'id' property`)
    }

    this.validateSignerOptions(cred)
  }

  private validateSignerOptions(cred: any) {
    if (!cred.signerOptions?.method) {
      throw new BadRequestError(
        `signerOptions must be provided and allowed methods are ${Object.values(SignerMethod).join(', ')}`,
      )
    }

    if (cred.signerOptions.method === SignerMethod.Did && !cred.signerOptions.did) {
      throw new BadRequestError(
        `For ${cred.credentialSupportedId} : did must be present inside signerOptions if SignerMethod is 'did' `,
      )
    }

    if (cred.signerOptions.method === SignerMethod.X5c && !cred.signerOptions.x5c) {
      throw new BadRequestError(
        `For ${cred.credentialSupportedId} : x5c must be present inside signerOptions if SignerMethod is 'x5c' `,
      )
    }
  }

  private async processStatusList(
    cred: any,
    options: OpenId4VcIssuanceSessionsCreateOffer,
    agentReq: Req,
    offerStatusInfo: any[],
  ) {
    if (!options.isRevocable) {
      return undefined
    }

    const effectiveIssuerDid = cred.signerOptions?.method === SignerMethod.Did ? cred.signerOptions.did : undefined
    const effectiveStatusList = cred.statusListDetails || options.statusListDetails

    const isSdJwtFormat = [CredentialFormat.VcSdJwt, CredentialFormat.DcSdJwt].includes(
      cred.format as unknown as CredentialFormat,
    )
    const isJsonLdFormat = cred.format === CredentialFormat.JwtVcJsonLd || cred.format === CredentialFormat.LdpVc

    if (!isSdJwtFormat && !isJsonLdFormat) {
      throw new BadRequestError(`Revocation is only supported for SD-JWT and W3C JSON-LD formats, got '${cred.format}'`)
    }

    if (!process.env.STATUS_LIST_SERVER_URL) {
      throw new BadRequestError('Cannot create revocable credentials: STATUS_LIST_SERVER_URL is not configured')
    }

    if (cred.signerOptions.method !== SignerMethod.Did || !effectiveIssuerDid) {
      throw new BadRequestError(`Revocation is not supported without a DID signer (found ${cred.signerOptions.method})`)
    }

    if (!effectiveStatusList) {
      throw new BadRequestError('Status list details must be provided for revocable credentials')
    }

    const listUri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${effectiveStatusList.listId}`

    if (isJsonLdFormat) {
      await checkAndCreateBitstringStatusList(
        agentReq.agent as any,
        effectiveStatusList.listId,
        effectiveIssuerDid,
        effectiveStatusList.listSize,
      )
    } else {
      await checkAndCreateStatusList(
        agentReq.agent as any,
        effectiveStatusList.listId,
        effectiveIssuerDid,
        effectiveStatusList.listSize,
      )
    }

    offerStatusInfo.push({
      credentialSupportedId: cred.credentialSupportedId,
      listId: effectiveStatusList.listId,
      index: effectiveStatusList.index,
      issuerDid: effectiveIssuerDid,
      ...(isJsonLdFormat ? { mechanism: 'bitstring' } : {}),
    })

    if (isJsonLdFormat) {
      return {
        id: `${listUri}#${effectiveStatusList.index}`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: String(effectiveStatusList.index),
        statusListCredential: listUri,
      }
    }

    return {
      status_list: {
        uri: listUri,
        idx: effectiveStatusList.index,
      },
    }
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

    if (!process.env.STATUS_LIST_SERVER_URL) {
      throw new BadRequestError('Cannot execute revocation: STATUS_LIST_SERVER_URL is not configured')
    }

    for (const info of statusInfo) {
      if (info.mechanism === 'bitstring') {
        await revokeBitstringInStatusList(agentReq.agent as any, info.listId, info.index, info.issuerDid)
      } else {
        await revokeCredentialInStatusList(agentReq.agent as any, info.listId, info.index, info.issuerDid)
      }
    }

    return { message: 'Credentials in session revoked successfully' }
  }
}

export const issuanceSessionService = new IssuanceSessionsService()
