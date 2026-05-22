import type { OpenId4VcIssuanceSessionsCreateOffer } from '../types/issuer.types'
import type { Request as Req } from 'express'

import { type OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'

import { CREDENTIALS_CONTEXT_V1_URL, CREDENTIALS_CONTEXT_V2_URL } from '@credo-ts/core'

import { CredentialFormat, SignerMethod } from '../../../enums/enum'
import { BadRequestError, NotFoundError } from '../../../errors/errors'
import { STATUS_LISTS_PATH } from '../../../utils/constant'
import { checkAndCreateStatusList, getServerUrl, revokeCredentialInStatusList } from '../../../utils/statusListService'

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
        const transformedPayload = this.transformPayloadForVersion(
          {
            ...cred.payload,
            vct: currentVct ?? (typeof supported.vct === 'string' ? supported.vct : undefined),
            ...(statusBlock ? { status: statusBlock } : {}),
          },
          effectiveVersion,
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

    if (version === 'v2.0') {
      if (cred.payload.issuer) {
        const issuer = cred.payload.issuer
        if (typeof issuer === 'object' && !issuer.id) {
          throw new BadRequestError(`Issuer object for '${cred.credentialSupportedId}' must contain 'id' property`)
        }
      }
    }

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

  private transformPayloadForVersion(payload: any, version: 'v1.1' | 'v2.0' | undefined) {
    if (version !== 'v2.0') {
      return payload
    }

    const transformed = { ...payload }

    const formatDate = (date: any) => {
      if (!date) return undefined
      if (date instanceof Date) return date.toISOString()
      if (typeof date === 'string') {
        try {
          const d = new Date(date)
          if (isNaN(d.getTime())) return date
          return d.toISOString()
        } catch {
          return date
        }
      }
      return date
    }

    // Rule: issuanceDate -> validFrom
    if (transformed.issuanceDate && !transformed.validFrom) {
      transformed.validFrom = transformed.issuanceDate
    }

    // Rule: expirationDate -> validUntil
    if (transformed.expirationDate && !transformed.validUntil) {
      transformed.validUntil = transformed.expirationDate
      delete transformed.expirationDate
    }

    // Normalize dates to ISO format
    if (transformed.validFrom) transformed.validFrom = formatDate(transformed.validFrom)
    if (transformed.validUntil) transformed.validUntil = formatDate(transformed.validUntil)

    // Rule: issuer string -> object (standardizing for v2.0 if it is a DID)
    if (typeof transformed.issuer === 'string' && transformed.issuer.startsWith('did:')) {
      transformed.issuer = { id: transformed.issuer }
    }

    // Rule: Update @context for v2.0
    const v1Context = CREDENTIALS_CONTEXT_V1_URL
    const v2Context = CREDENTIALS_CONTEXT_V2_URL

    if (version === 'v2.0') {
      const currentCtx = Array.isArray(transformed['@context'])
        ? transformed['@context']
        : typeof transformed['@context'] === 'string'
          ? [transformed['@context']]
          : []

      const ctxSet = new Set(currentCtx)
      ctxSet.delete(v1Context)
      ctxSet.delete(v2Context)
      // W3C V2.0 requires the V2 context to be the very first element.
      transformed['@context'] = [v2Context, v1Context, ...Array.from(ctxSet)]
    } else {
      // W3C V1.1 / Default behavior
      if (!transformed['@context']) {
        transformed['@context'] = [v1Context]
      } else if (Array.isArray(transformed['@context'])) {
        const ctxSet = new Set(transformed['@context'])
        ctxSet.delete(v1Context)
        transformed['@context'] = [v1Context, ...Array.from(ctxSet)]
      } else if (typeof transformed['@context'] === 'string') {
        transformed['@context'] = [v1Context, transformed['@context']]
      }
    }

    return transformed
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

    if (![CredentialFormat.VcSdJwt, CredentialFormat.DcSdJwt].includes(cred.format as unknown as CredentialFormat)) {
      throw new BadRequestError(
        `Revocation is only supported for SD-JWT formats (vc+sd-jwt, dc+sd-jwt), got '${cred.format}'`,
      )
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

    await checkAndCreateStatusList(
      agentReq.agent as any,
      effectiveStatusList.listId,
      effectiveIssuerDid,
      effectiveStatusList.listSize,
    )

    const listUri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${effectiveStatusList.listId}`

    offerStatusInfo.push({
      credentialSupportedId: cred.credentialSupportedId,
      listId: effectiveStatusList.listId,
      index: effectiveStatusList.index,
      issuerDid: effectiveIssuerDid,
    })

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
      await revokeCredentialInStatusList(agentReq.agent as any, info.listId, info.index, info.issuerDid)
    }

    return { message: 'Credentials in session revoked successfully' }
  }
}

export const issuanceSessionService = new IssuanceSessionsService()
