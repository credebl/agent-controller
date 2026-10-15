import type {
  AuthorizeRequestCredentialOffer,
  CredentialListQuery,
  CredentialTags,
  DeleteCredentialBody,
  PaginatedCredentials,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'
import type { Agent, BaseRecordAny, DcqlCredentialsForRequest, DcqlQueryResult } from '@credo-ts/core'
import type {
  OpenId4VcAuthorizationCodeTokenRequestOptions,
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
  // W3cV2CredentialRecord,
  // W3cV2CredentialService,
} from '@credo-ts/core'
import {
  OpenId4VciAuthorizationFlow,
  authorizationCodeGrantIdentifier,
  preAuthorizedCodeGrantIdentifier,
} from '@credo-ts/openid4vc'

import { CredentialType } from '../types/holder.types'

import { getCredentialBindingResolver } from './credentialBindingResolver'
export class HolderService {
  private HOLDER_REDIRECT = process.env.HOLDER_REDIRECT ?? 'http://localhost:4001/redirect'
  private HOLDER_CLIENT_ID = process.env.HOLDER_CLIENT_ID ?? 'wallet'

  public async getSdJwtCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      vct: query.vct,
    })
    const records = await agentReq.agent.sdJwtVc.findAllByQuery(tagQuery)
    return this.paginateRecords(records, query, ['credentialType', 'vct', 'name', 'reference'])
  }

  public async getMdocCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      docType: query.docType,
    })
    const records = await agentReq.agent.mdoc.findAllByQuery(tagQuery)
    return this.paginateRecords(records, query, ['credentialType', 'docType', 'name', 'reference'])
  }

  public async getW3cCredentials(agentReq: Req, query: CredentialListQuery = {}) {
    const w3cCredentialRepository = agentReq.agent.dependencyManager.resolve(W3cCredentialRepository)
    const tagQuery = this.buildTagQuery({
      credentialType: query.credentialType,
      types: query.types,
    })
    const records = await w3cCredentialRepository.findByQuery(agentReq.agent.context, tagQuery)
    return this.paginateRecords(records, query, ['credentialType', 'types', 'name', 'reference'])
  }

  private buildTagQuery(filters: Record<string, string | string[] | undefined>) {
    const query: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        query[key] = value
      }
    }
    return query
  }

  private hasListParams(query: CredentialListQuery) {
    return Object.values(query).some((value) => value !== undefined && value !== null && value !== '')
  }

  private matchesSearch(record: BaseRecordAny, q: string, searchableTags: string[]) {
    const needle = q.trim().toLowerCase()
    if (!needle) return true

    const tags = record.getTags() as Record<string, unknown>
    return searchableTags.some((tag) => {
      const value = tags[tag]
      const values = Array.isArray(value) ? value : [value]
      return values.some((item) => typeof item === 'string' && item.toLowerCase().includes(needle))
    })
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

    const page = query.page && query.page > 0 ? query.page : 1
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 10
    const total = filtered.length
    const totalPages = Math.ceil(total / pageSize)
    const start = (page - 1) * pageSize
    const data = filtered.slice(start, start + pageSize).map((record) => ({
      ...(record as unknown as Record<string, unknown>),
      tags: record.getTags(),
    }))

    return {
      data,
      total,
      page,
      pageSize,
      totalPages,
    } as PaginatedCredentials<Record<string, unknown>>
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

    return (await this.requestAndStoreCredentials(agentReq, resolvedCredentialOffer, options, body.tags)) as any
  }
  private async requestAndStoreCredentials(
    agentReq: Req,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    options: OpenId4VciTokenRequestOptions,
    tags?: CredentialTags,
  ) {
    const tokenResponse = await agentReq.agent.modules.openid4vc.holder.requestToken({ ...options })
    const credentialResponse = await agentReq.agent.modules.openid4vc.holder.requestCredentials({
      ...options,
      credentialConfigurationIds: resolvedCredentialOffer.credentialOfferPayload.credential_configuration_ids,
      credentialBindingResolver: getCredentialBindingResolver({
        requestBatch: false,
      }),
      ...tokenResponse,
    })

    const storedCredentials = await Promise.all(
      credentialResponse.credentials.map(async (response) => {
        const credentialRecord = response.record

        if (tags && Object.keys(tags).length > 0) {
          credentialRecord.setTags(tags)
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

    return storedCredentials as any
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
