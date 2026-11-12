import type {
  AuthorizeRequestCredentialOffer,
  CredentialListQuery,
  CredentialNotificationEvent,
  CredentialNotificationResult,
  CredentialTags,
  DeleteCredentialBody,
  PaginatedCredentials,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'
import type { BaseRecordAny, DcqlCredentialsForRequest } from '@credo-ts/core'
import type {
  OpenId4VcAuthorizationCodeTokenRequestOptions,
  OpenId4VciCredentialResponse,
  OpenId4VciPreAuthorizedTokenRequestOptions,
  OpenId4VciResolvedCredentialOffer,
  OpenId4VciTokenRequestOptions,
} from '@credo-ts/openid4vc'
import type { Request as Req } from 'express'

import {
  Mdoc,
  SdJwtVcRecord,
  MdocRecord,
  W3cCredentialRecord,
  W3cCredentialRepository,
  W3cCredentialService,
  JsonTransformer,
  // W3cV2CredentialRecord,
  // W3cV2CredentialService,
} from '@credo-ts/core'
import {
  OpenId4VciAuthorizationFlow,
  authorizationCodeGrantIdentifier,
  preAuthorizedCodeGrantIdentifier,
} from '@credo-ts/openid4vc'

import { StatusException } from '../../../errors/StatusException'
import { BadRequestError } from '../../../errors/errors'
import { CredentialType } from '../types/holder.types'

import {
  assertOfferAcceptsHolderDid,
  assertW3cCredentialsBoundToHolderDid,
  getCredentialBindingResolver,
} from './credentialBindingResolver'
type FilterValue = string | string[] | undefined

class NotificationTimeoutError extends Error {}

interface CredentialNotificationContext {
  enabled: boolean
  metadata: OpenId4VciResolvedCredentialOffer['metadata']
  accessToken: string
  dpop?: OpenId4VciTokenRequestOptions['dpop']
}

export class HolderService {
  private HOLDER_REDIRECT = process.env.HOLDER_REDIRECT ?? 'http://localhost:4001/redirect'
  private HOLDER_CLIENT_ID = process.env.HOLDER_CLIENT_ID ?? 'wallet'
  // How long to wait for the issuer to answer an OID4VCI notification before giving up on it
  private NOTIFICATION_TIMEOUT_MS = Number(process.env.OID4VCI_NOTIFICATION_TIMEOUT_MS) || 5000

  // Tags are dynamic - allow all string/string[] values
  private readonly DEFAULT_PAGE = 1
  private readonly DEFAULT_PAGE_SIZE = 20
  private readonly MAX_PAGE_SIZE = 100

  public async getSdJwtCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      vct: query.vct,
    })
    const records = await agentReq.agent.sdJwtVc.findAllByQuery(tagQuery)
    return this.paginateRecords(records, query, ['credentialType', 'vct', 'name', 'reference', 'issuer'])
  }

  public async getMdocCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      docType: query.docType,
    })
    const records = await agentReq.agent.mdoc.findAllByQuery(tagQuery)
    return this.paginateRecords(records, query, ['credentialType', 'docType', 'name', 'reference', 'issuer'])
  }

  public async getW3cCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const w3cCredentialRepository = agentReq.agent.dependencyManager.resolve(W3cCredentialRepository)
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      types: query.types,
    })
    const records = await w3cCredentialRepository.findByQuery(agentReq.agent.context, tagQuery)
    return this.paginateRecords(records, query, [
      'credentialType',
      'types',
      'name',
      'reference',
      'issuer',
      'vct',
      'docType',
    ])
  }

  private normalizeFilterValue(value: FilterValue): FilterValue {
    if (value === undefined || value === null || value === '') {
      return undefined
    }
    if (Array.isArray(value)) {
      const filtered = value
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v !== undefined && v !== null && v !== '')
      return filtered.length > 0 ? filtered : undefined
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.includes(',')) {
        const parts = trimmed
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p !== '')
        return parts.length > 0 ? parts : undefined
      }
      return trimmed === '' ? undefined : trimmed
    }
    return value
  }

  private buildTagQuery(filters: Record<string, string | string[] | undefined>) {
    const query: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(filters)) {
      const normalized = this.normalizeFilterValue(value)
      if (normalized !== undefined && normalized !== null) {
        if (Array.isArray(normalized)) {
          if (normalized.length === 0) continue
          query[key] = normalized
        } else if (normalized !== '') {
          query[key] = normalized
        }
      }
    }
    return query
  }

  private hasListParams(query: CredentialListQuery) {
    return Object.values(query).some((value) => value !== undefined && value !== null && value !== '')
  }

  private getTagValue(tags: Record<string, unknown>, key: string): unknown {
    if (!tags || typeof tags !== 'object') return undefined
    if (key in tags) {
      return tags[key]
    }
    // Try case-insensitive lookup for backward compatibility
    const lowerKey = key.toLowerCase()
    for (const [k, v] of Object.entries(tags)) {
      if (k.toLowerCase() === lowerKey) {
        return v
      }
    }
    return undefined
  }

  private matchesSearchInTags(tags: Record<string, unknown>, needle: string, searchableTags: string[]): boolean {
    return searchableTags.some((tag) => {
      const value = this.getTagValue(tags, tag)
      if (value === undefined || value === null) return false
      const values = Array.isArray(value) ? value : [value]
      return values.some((item) => typeof item === 'string' && item.toLowerCase().includes(needle))
    })
  }

  private matchesSearchInRecord(recordAny: any, needle: string): boolean {
    const fallbackFields = ['id', 'name', 'reference', 'issuerId', 'issuer']
    for (const field of fallbackFields) {
      const value = recordAny[field]
      if (typeof value === 'string' && value.toLowerCase().includes(needle)) {
        return true
      }
    }

    if (recordAny.credential && typeof recordAny.credential === 'object') {
      try {
        const credStr = JSON.stringify(recordAny.credential).toLowerCase()
        if (credStr.includes(needle)) return true
      } catch {
        // ignore
      }
    }
    return false
  }

  private matchesSearch(record: BaseRecordAny, q: string, searchableTags: string[]) {
    const needle = q.trim().toLowerCase()
    if (!needle) return true

    const tags = (record.getTags ? record.getTags() : (record as any).tags) as Record<string, unknown> | undefined

    if (tags && typeof tags === 'object') {
      if (this.matchesSearchInTags(tags, needle, searchableTags)) {
        return true
      }
    }

    return this.matchesSearchInRecord(record as any, needle)
  }

  private validateAndNormalizePagination(query: CredentialListQuery) {
    let page = this.DEFAULT_PAGE
    let pageSize = this.DEFAULT_PAGE_SIZE

    if (query.page !== undefined && query.page !== null) {
      const pageNum = Number(query.page)
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        throw new StatusException('Invalid page. page must be an integer >= 1', 400)
      }
      page = pageNum
    }

    if (query.pageSize !== undefined && query.pageSize !== null) {
      const pageSizeNum = Number(query.pageSize)
      if (!Number.isInteger(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > this.MAX_PAGE_SIZE) {
        throw new StatusException(
          `Invalid pageSize. pageSize must be an integer between 1 and ${this.MAX_PAGE_SIZE}`,
          400,
        )
      }
      pageSize = pageSizeNum
    }

    return { page, pageSize }
  }

  private paginateRecords<T extends BaseRecordAny>(
    records: T[],
    query: CredentialListQuery,
    searchableTags: string[],
  ): T[] | PaginatedCredentials<Record<string, unknown>> {
    const filtered = query.q
      ? records.filter((record) => this.matchesSearch(record, query.q as string, searchableTags))
      : records

    if (!this.hasListParams(query)) {
      return filtered
    }

    const { page, pageSize } = this.validateAndNormalizePagination(query)
    const total = filtered.length
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const data = filtered.slice(start, end).map((record) => {
      const recordJson = JsonTransformer.toJSON(record) as Record<string, unknown>
      const recordTags = record.getTags ? record.getTags() : (recordJson.tags as any)
      return {
        ...recordJson,
        tags: recordTags,
      }
    })

    const filters: CredentialListQuery = {}
    if (query.q) filters.q = query.q.trim()
    if (query.credentialType) filters.credentialType = query.credentialType
    if (query.vct) filters.vct = query.vct
    if (query.docType) filters.docType = query.docType
    if (query.types) filters.types = query.types
    if (query.issuer) filters.issuer = query.issuer
    if (query.name) filters.name = query.name
    if (query.reference) filters.reference = query.reference

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    } as PaginatedCredentials<Record<string, unknown>>
  }

  private sanitizeTags(tags?: CredentialTags): CredentialTags | undefined {
    if (!tags || typeof tags !== 'object') return undefined
    const sanitized: CredentialTags = {}
    for (const key of Object.keys(tags)) {
      const value = (tags as any)[key]
      if (Array.isArray(value)) {
        const cleaned = value.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
        if (cleaned.length > 0) {
          sanitized[key] = cleaned
        }
      } else if (typeof value === 'string' && value.trim() !== '') {
        sanitized[key] = value.trim()
      }
      // allow dynamic keys as-is if valid
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined
  }

  public async decodeMdocCredential(
    agentReq: Req,
    options: {
      base64Url: string
    },
  ) {
    const credential = Mdoc.fromBase64Url(options.base64Url)
    return {
      namespace: credential.issuerSignedNamespaces,
      docType: credential.docType,
      validityInfo: credential.validityInfo,
      issuerSignedCertificateChain: credential.issuerSignedCertificateChain,
    } as any
  }

  public async resolveCredentialOffer(agentReq: Req, body: ResolveCredentialOfferBody) {
    return (await agentReq.agent.modules.openid4vc.holder.resolveCredentialOffer(body.credentialOfferUri)) as any
  }

  public async requestAuthorizationForCredential(agentReq: Req, body: AuthorizeRequestCredentialOffer) {
    const resolvedCredentialOffer = await agentReq.agent.modules.openid4vc.holder.resolveCredentialOffer(
      body.credentialOfferUri,
    )
    const resolvedAuthorization = await this.initiateAuthorization(
      agentReq,
      resolvedCredentialOffer,
      body.credentialsToRequest,
    )

    let actionToTake = ''
    let authorizationRequestUrl: string | undefined = undefined
    let codeVerifier: string | undefined = undefined

    switch (resolvedAuthorization.authorizationFlow) {
      case 'Oauth2Redirect':
        actionToTake = 'Open the authorizationRequestUrl in your browser.'
        authorizationRequestUrl = resolvedAuthorization.authorizationRequestUrl
        codeVerifier = resolvedAuthorization.codeVerifier
        break
      case 'PresentationDuringIssuance':
        actionToTake = 'Presentation during issuance not supported yet'
        break
      case 'PreAuthorized':
        if (resolvedCredentialOffer.credentialOfferPayload.grants?.[preAuthorizedCodeGrantIdentifier]?.tx_code) {
          actionToTake = 'Ask for txcode from issuer and use it further'
        }
        break
    }

    return { actionToTake, authorizationRequestUrl, codeVerifier } as any
  }

  public async requestCredential(agentReq: Req, body: RequestCredentialBody) {
    const resolvedCredentialOffer = await agentReq.agent.modules.openid4vc.holder.resolveCredentialOffer(
      body.credentialOfferUri,
    )

    let options: OpenId4VciTokenRequestOptions
    if (resolvedCredentialOffer.credentialOfferPayload.grants?.[preAuthorizedCodeGrantIdentifier]) {
      options = {
        resolvedCredentialOffer,
        txCode: body.txCode,
      } as OpenId4VciPreAuthorizedTokenRequestOptions
    } else {
      options = {
        resolvedCredentialOffer,
        code: body.authorizationCode,
        clientId: this.HOLDER_CLIENT_ID,
        codeVerifier: body.codeVerifier,
        redirectUri: this.HOLDER_REDIRECT,
      } as OpenId4VcAuthorizationCodeTokenRequestOptions
    }

    return (await this.requestAndStoreCredentials(agentReq, resolvedCredentialOffer, options, body)) as any
  }
  private async requestAndStoreCredentials(
    agentReq: Req,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    options: OpenId4VciTokenRequestOptions,
    { credentialsToRequest, tags, holderDidUrl, bindingPolicy, sendNotification = true }: RequestCredentialBody,
  ) {
    const offeredIds = resolvedCredentialOffer.credentialOfferPayload.credential_configuration_ids
    const notOffered = credentialsToRequest?.filter((id) => !offeredIds.includes(id)) ?? []
    if (notOffered.length > 0) {
      throw new BadRequestError(`Credentials not in the offer: ${notOffered.join(', ')}`)
    }

    const credentialConfigurationIds = credentialsToRequest?.length ? credentialsToRequest : offeredIds
    if (holderDidUrl) {
      await assertOfferAcceptsHolderDid(agentReq.agent.context, resolvedCredentialOffer, credentialConfigurationIds, {
        holderDidUrl,
        bindingPolicy,
      })
    }

    const tokenResponse = await agentReq.agent.modules.openid4vc.holder.requestToken({ ...options })
    const credentialResponse = await agentReq.agent.modules.openid4vc.holder.requestCredentials({
      ...options,
      credentialConfigurationIds,
      credentialBindingResolver: getCredentialBindingResolver({
        requestBatch: false,
        holderDidUrl,
        bindingPolicy,
      }),
      ...tokenResponse,
    })

    const notificationContext: CredentialNotificationContext = {
      enabled: sendNotification,
      metadata: resolvedCredentialOffer.metadata,
      accessToken: tokenResponse.accessToken,
      dpop: credentialResponse.dpop,
    }

    if (holderDidUrl && bindingPolicy !== 'prefer') {
      try {
        assertW3cCredentialsBoundToHolderDid(
          credentialResponse.credentials.map((response) => response.record),
          holderDidUrl,
        )
      } catch (error) {
        // None of the credentials is stored, so tell the issuer that each of them failed
        await this.sendCredentialNotifications(
          agentReq,
          notificationContext,
          credentialResponse.credentials.map((response) => ({ response, event: 'credential_failure' })),
        )
        throw error
      }
    }

    const sanitizedTags = this.sanitizeTags(tags)

    const results = await this.settleUntilFirstRejection(
      credentialResponse.credentials.map(async ({ record: credentialRecord }) => {
        if (sanitizedTags && Object.keys(sanitizedTags).length > 0) {
          try {
            credentialRecord.setTags(sanitizedTags as any)
          } catch (error) {
            // Ignore tag setting errors to avoid blocking issuance
          }
        }

        if (
          credentialRecord instanceof W3cCredentialRecord ||
          (credentialRecord as any).type === 'W3cCredentialRecord'
        ) {
          return await agentReq.agent.w3cCredentials.store({
            record: credentialRecord as W3cCredentialRecord,
          })
        }

        /*
        W3C V2.0 Support
        if (
          credentialRecord instanceof W3cV2CredentialRecord ||
          (credentialRecord as any).type === 'W3cV2CredentialRecord'
        ) {
          return await agentReq.agent.w3cV2Credentials.store({
            record: credentialRecord as W3cV2CredentialRecord,
          })
        }
        */

        if (credentialRecord instanceof MdocRecord) {
          return await agentReq.agent.mdoc.store({ record: credentialRecord })
        }
        if (credentialRecord instanceof SdJwtVcRecord) {
          return await agentReq.agent.sdJwtVc.store({
            record: credentialRecord,
          })
        }
        throw new Error(
          `Unsupported credential record type: ${(credentialRecord as any)?.type || typeof credentialRecord}`,
        )
      }),
    )

    // credential_accepted for each stored credential, credential_failure for each one that could not be stored.
    // A credential still being stored when another one failed gets no notification.
    const notifications = await this.sendCredentialNotifications(
      agentReq,
      notificationContext,
      credentialResponse.credentials.map((response, index) => ({
        response,
        event: results[index] && (results[index].status === 'fulfilled' ? 'credential_accepted' : 'credential_failure'),
      })),
    )

    const rejected = results.find((result): result is PromiseRejectedResult => result?.status === 'rejected')
    if (rejected) {
      throw rejected.reason
    }

    return results.map((result, index) => ({
      ...JsonTransformer.toJSON((result as PromiseFulfilledResult<BaseRecordAny>).value),
      notification: notifications[index],
    })) as any
  }

  /**
   * Like `Promise.allSettled`, but returns as soon as one promise rejects, so a store that never settles
   * cannot hold back the error of another. Promises that are still pending then are `undefined`.
   */
  private settleUntilFirstRejection<T>(promises: Promise<T>[]): Promise<Array<PromiseSettledResult<T> | undefined>> {
    const results: Array<PromiseSettledResult<T> | undefined> = promises.map(() => undefined)
    return new Promise((resolve) => {
      let pending = promises.length
      if (pending === 0) resolve(results)
      promises.forEach((promise, index) => {
        promise.then(
          (value) => {
            results[index] = { status: 'fulfilled', value }
            if (--pending === 0) resolve(results)
          },
          (reason) => {
            results[index] = { status: 'rejected', reason }
            // A copy, so stores that settle later do not change what the caller sees
            resolve([...results])
          },
        )
      })
    })
  }

  /**
   * Sends an OID4VCI notification to the issuer for each credential, one at a time: an issuer may record
   * each notification on the issuance session, and parallel updates of one session can overwrite each other.
   * A notification that is not sent is logged and reported, but never fails the request.
   */
  private async sendCredentialNotifications(
    agentReq: Req,
    context: CredentialNotificationContext,
    credentials: Array<{ response: OpenId4VciCredentialResponse; event?: CredentialNotificationEvent }>,
  ): Promise<CredentialNotificationResult[]> {
    const results: CredentialNotificationResult[] = []
    let timedOut = false
    for (const { response, event } of credentials) {
      if (timedOut) {
        // A timed-out call cannot be cancelled and may still reach the issuer, so a further call could
        // update the issuance session at the same time
        results.push({ status: 'skipped', reason: 'An earlier notification to this issuer timed out' })
        continue
      }
      const sent = await this.sendCredentialNotification(agentReq, context, response, event)
      timedOut = sent.timedOut
      results.push(sent.result)
    }
    return results
  }

  private async sendCredentialNotification(
    agentReq: Req,
    { enabled, metadata, accessToken, dpop }: CredentialNotificationContext,
    { notificationId, credentialConfigurationId }: OpenId4VciCredentialResponse,
    event: CredentialNotificationEvent | undefined,
  ): Promise<{ result: CredentialNotificationResult; timedOut: boolean }> {
    const skipped = (reason: string) => ({ result: { status: 'skipped', reason } as const, timedOut: false })
    if (!enabled) return skipped('sendNotification is false')
    if (!event) return skipped('The credential was still being stored when another one failed')
    if (!metadata.credentialIssuer.notification_endpoint) return skipped('Issuer metadata has no notification_endpoint')
    if (!notificationId) return skipped('Credential response has no notification_id')

    try {
      await this.withTimeout(
        agentReq.agent.modules.openid4vc.holder.sendNotification({
          metadata,
          accessToken,
          dpop,
          notificationId,
          notificationEvent: event,
        }),
        this.NOTIFICATION_TIMEOUT_MS,
        `No answer from the issuer within ${this.NOTIFICATION_TIMEOUT_MS} ms`,
      )
      return { result: { status: 'sent', event }, timedOut: false }
    } catch (error) {
      const reason = this.notificationErrorReason(error)
      agentReq.agent.config.logger.warn(
        `[OpenId4VCI] Failed to send '${event}' notification to the issuer for '${credentialConfigurationId}': ${reason}`,
        { notificationId, credentialIssuer: metadata.credentialIssuer.credential_issuer },
      )
      return { result: { status: 'failed', event, reason }, timedOut: error instanceof NotificationTimeoutError }
    }
  }

  /**
   * The error message, plus the issuer's HTTP status and OAuth error code when the issuer
   * rejected the notification (e.g. `HTTP 400 invalid_notification_id`).
   */
  private notificationErrorReason(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const { response } = (error ?? {}) as {
      response?: {
        response?: { status?: number }
        notificationErrorResponseResult?: { success: boolean; data?: { error?: string } }
      }
    }
    const status = response?.response?.status
    const code = response?.notificationErrorResponseResult?.data?.error
    const detail = [status && `HTTP ${status}`, code].filter(Boolean).join(' ')
    return detail ? `${message}: ${detail}` : message
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new NotificationTimeoutError(message)), timeoutMs)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async initiateAuthorization(
    agentReq: Req,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    credentialsToRequest: string[],
  ) {
    const grants = resolvedCredentialOffer.credentialOfferPayload.grants

    // 👉 Handle Pre-Authorized Code Grant
    if (grants?.[preAuthorizedCodeGrantIdentifier]) {
      const preAuthorizedCode = grants[preAuthorizedCodeGrantIdentifier]['pre-authorized_code']
      return {
        authorizationFlow: 'PreAuthorized' as const,
        preAuthorizedCode,
      }
    }

    // 👉 Handle Authorization Code Grant
    if (grants?.[authorizationCodeGrantIdentifier]) {
      const scope = Object.entries(resolvedCredentialOffer.offeredCredentialConfigurations)
        .map(([id, val]) => (credentialsToRequest.includes(id) ? val.scope : undefined))
        .filter((v): v is string => Boolean(v))

      const resolved = await agentReq.agent.modules.openid4vc.holder.resolveOpenId4VciAuthorizationRequest(
        resolvedCredentialOffer,
        {
          clientId: this.HOLDER_CLIENT_ID,
          redirectUri: this.HOLDER_REDIRECT,
          scope,
        },
      )

      // 👉 Support Presentation During Issuance flow
      if (resolved.authorizationFlow === OpenId4VciAuthorizationFlow.PresentationDuringIssuance) {
        return {
          ...resolved,
          authorizationFlow: 'PresentationDuringIssuance' as const,
        }
      }

      return {
        ...resolved,
        authorizationFlow: 'Oauth2Redirect' as const,
      } as any
    }

    // ❌ Unsupported grant
    throw new Error('Unsupported grant type')
  }

  public async resolveProofRequest(agentReq: Req, body: ResolveProofRequest) {
    return (await agentReq.agent.modules.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(
      body.proofRequestUri,
      body.options,
    )) as any
  }

  public async acceptPresentationRequest(agentReq: Req, body: ResolveProofRequest) {
    const resolved = await agentReq.agent.modules.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(
      body.proofRequestUri,
      body.options,
    )
    // const presentationExchangeService = agent.dependencyManager.resolve(DifPresentationExchangeService)

    let acceptOptions: any = {
      authorizationRequestPayload: resolved.authorizationRequestPayload,
      origin: body.options?.origin,
    }

    if (resolved.dcql) {
      const dcqlCredentials = await agentReq.agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest(
        resolved.dcql.queryResult,
      )
      acceptOptions.dcql = { credentials: dcqlCredentials as DcqlCredentialsForRequest }
    } else if (resolved.presentationExchange) {
      const pexCredentials =
        await agentReq.agent.modules.openid4vc.holder.selectCredentialsForPresentationExchangeRequest(
          resolved.presentationExchange.credentialsForRequest,
        )
      acceptOptions.presentationExchange = { credentials: pexCredentials }
    } else {
      throw new Error('Missing DCQL or Presentation Exchange on request')
    }

    const submissionResult =
      await agentReq.agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest(acceptOptions)
    if (submissionResult.serverResponse) {
      const { serverResponse, ...rest } = submissionResult

      return {
        ...serverResponse,
        body: rest,
      } as any
    }
    return {
      status: 200,
      body: submissionResult,
    } as any
  }

  public async deleteCredential(agentReq: Req, { credentialId, credentialType }: DeleteCredentialBody) {
    if (credentialType === CredentialType.W3C_VC) {
      const w3cCredentialService = await agentReq.agent.dependencyManager.resolve(W3cCredentialService)
      // const w3cV2CredentialService = await agentReq.agent.dependencyManager.resolve(W3cV2CredentialService)

      try {
        return await w3cCredentialService.removeCredentialRecord(agentReq.agent.context, credentialId)
      } catch (error) {
        /* 
        // W3C V2.0 Support
        return await w3cV2CredentialService.removeCredentialRecord(agentReq.agent.context, credentialId)
        */
        throw error
      }
    } else if (credentialType === CredentialType.SD_JWT) {
      const sdJwtRecord = await agentReq.agent.sdJwtVc.getById(credentialId)
      if (sdJwtRecord) {
        return await agentReq.agent.sdJwtVc.deleteById(credentialId)
      }
      throw new Error(`Credential with id ${credentialId} not found`)
    } else if (credentialType === CredentialType.MSO_MDOC) {
      const mdocRecord = await agentReq.agent.mdoc.getById(credentialId)
      if (mdocRecord) {
        return await agentReq.agent.mdoc.deleteById(credentialId)
      }
      throw new Error(`Credential with id ${credentialId} not found`)
    } else {
      throw new Error(`Unsupported credential type: ${credentialType}`)
    }
  }

  public async decodeSdJwt(agentReq: Req, body: { jwt: string }) {
    const sdJwt = agentReq.agent.sdJwtVc.fromCompact(body.jwt)
    return sdJwt as any
  }
}
export const holderService = new HolderService()
