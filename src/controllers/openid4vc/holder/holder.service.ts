import type {
  AuthorizeRequestCredentialOffer,
  DeleteCredentialBody,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'
import type { Agent, DcqlCredentialsForRequest, DcqlQueryResult } from '@credo-ts/core'
import type {
  OpenId4VcAuthorizationCodeTokenRequestOptions,
  OpenId4VciPreAuthorizedTokenRequestOptions,
  OpenId4VciResolvedCredentialOffer,
  OpenId4VciTokenRequestOptions,
} from '@credo-ts/openid4vc'
import type { Request as Req } from 'express'

import { Mdoc, SdJwtVcRecord, MdocRecord } from '@credo-ts/core'
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

  public async getSdJwtCredentials(agentReq: Req) {
    return await agentReq.agent.sdJwtVc.getAll()
  }

  public async getMdocCredentials(agentReq: Req) {
    return await agentReq.agent.mdoc.getAll()
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

    return (await this.requestAndStoreCredentials(agentReq, resolvedCredentialOffer, options)) as any
  }
  private async requestAndStoreCredentials(
    agentReq: Req,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    options: OpenId4VciTokenRequestOptions,
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
        // TODO: We can add this later
        // if (credential instanceof W3cJwtVerifiableCredential || credential instanceof W3cJsonLdVerifiableCredential) {
        //   return await agentReq.agent.w3cCredentials.storeCredential({ credential })
        // }
        if (credentialRecord instanceof MdocRecord) {
          return await agentReq.agent.mdoc.store({ record: credentialRecord })
        }
        if (credentialRecord instanceof SdJwtVcRecord) {
          return await agentReq.agent.sdJwtVc.store({
            record: credentialRecord,
          })
        }
        throw new Error(`Unsupported credential record type`)
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

    if (!resolved.dcql) throw new Error('Missing DCQL on request')
    //
    let dcqlCredentials
    try {
      dcqlCredentials = await agentReq.agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest(
        resolved.dcql.queryResult,
      )
    } catch (error) {
      throw error
    }
    const submissionResult = await agentReq.agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
      authorizationRequestPayload: resolved.authorizationRequestPayload,
      dcql: {
        credentials: dcqlCredentials as DcqlCredentialsForRequest,
      },
      origin: body.options?.origin,
    })
    const result: any = submissionResult.serverResponse || { status: 200, body: {} }
    result['body'] = submissionResult
    return result
  }

  public async deleteCredential(agentReq: Req, { credentialId, credentialType }: DeleteCredentialBody) {
    if (credentialType === CredentialType.SD_JWT) {
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
