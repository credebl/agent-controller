import type {
  AuthorizeRequestCredentialOffer,
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

import {
  DifPresentationExchangeService,
  DidKey,
  DidJwk,
  getJwkFromKey,
  Mdoc,
  W3cJsonLdVerifiableCredential,
  W3cJwtVerifiableCredential,
} from '@credo-ts/core'
import {
  OpenId4VciAuthorizationFlow,
  authorizationCodeGrantIdentifier,
  preAuthorizedCodeGrantIdentifier,
} from '@credo-ts/openid4vc'
import { Request as Req } from 'express'
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
    return (await agentReq.agent.modules.openId4VcHolderModule.resolveCredentialOffer(body.credentialOfferUri)) as any
  }

  public async requestAuthorizationForCredential(agentReq: Req, body: AuthorizeRequestCredentialOffer) {
    console.log('Requesting authorization for credential offer:', body)
    const resolvedCredentialOffer = await agentReq.agent.modules.openId4VcHolderModule.resolveCredentialOffer(
      body.credentialOfferUri,
    )
    console.log('Resolved credential offer:', resolvedCredentialOffer)
    const resolvedAuthorization = await this.initiateAuthorization(
      agentReq,
      resolvedCredentialOffer,
      body.credentialsToRequest,
    )

    let actionToTake = ''
    let authorizationRequestUrl: string | undefined = undefined
    let codeVerifier: string | undefined = undefined
    console.log('Resolved authorization', resolvedAuthorization)

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
    const resolvedCredentialOffer = await agentReq.agent.modules.openId4VcHolderModule.resolveCredentialOffer(
      body.credentialOfferUri,
    )

    let options: OpenId4VciTokenRequestOptions
    if (resolvedCredentialOffer.credentialOfferPayload.grants?.[preAuthorizedCodeGrantIdentifier]) {
      options = {
        resolvedCredentialOffer,
        txCode: body.txCode,
        code: body.authorizationCode,
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
    const tokenResponse = await agentReq.agent.modules.openId4VcHolderModule.requestToken({ ...options })
    const credentialResponse = await agentReq.agent.modules.openId4VcHolderModule.requestCredentials({
      ...options,
      credentialConfigurationIds: resolvedCredentialOffer.credentialOfferPayload.credential_configuration_ids,
      credentialBindingResolver: async ({
        keyTypes,
        supportedDidMethods,
        supportsAllDidMethods,
      }: {
        keyTypes: string[]
        supportedDidMethods?: string[]
        supportsAllDidMethods?: boolean
      }) => {
        const key = await agentReq.agent.wallet.createKey({ keyType: keyTypes[0] as any })
        if (supportsAllDidMethods || supportedDidMethods?.includes('did:key')) {
          const didKey = new DidKey(key)
          return { method: 'did', didUrl: `${didKey.did}#${didKey.key.fingerprint}` }
        }
        if (supportedDidMethods?.includes('did:jwk')) {
          const didJwk = DidJwk.fromJwk(getJwkFromKey(key))
          return { method: 'did', didUrl: `${didJwk.did}#0` }
        }
        return { method: 'jwk', jwk: getJwkFromKey(key) }
      },
      ...tokenResponse,
    })

    const storedCredentials = await Promise.all(
      credentialResponse.credentials.map(async (response: any) => {
        const credential = response.credentials[0]
        if (credential instanceof W3cJwtVerifiableCredential || credential instanceof W3cJsonLdVerifiableCredential) {
          return await agentReq.agent.w3cCredentials.storeCredential({ credential })
        }
        if (credential instanceof Mdoc) {
          return await agentReq.agent.mdoc.store(credential)
        }
        return await agentReq.agent.sdJwtVc.store(credential.compact)
      }),
    )

    return storedCredentials as any
  }

  private async initiateAuthorization(
    agentReq: Req,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    credentialsToRequest: string[],
  ) {
    console.log('Initiating authorization with resolvedCredentialOffer:', resolvedCredentialOffer)
    console.log('Credentials to request:', credentialsToRequest)

    const grants = resolvedCredentialOffer.credentialOfferPayload.grants
    console.log('Grants:', grants)

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
      console.log('Using authorization code grant flow')

      const scope = Object.entries(resolvedCredentialOffer.offeredCredentialConfigurations)
        .map(([id, val]) => (credentialsToRequest.includes(id) ? val.scope : undefined))
        .filter((v): v is string => Boolean(v))

      const resolved = await agentReq.agent.modules.openId4VcHolderModule.resolveOpenId4VciAuthorizationRequest(
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
    return (await agentReq.agent.modules.openId4VcHolderModule.resolveOpenId4VpAuthorizationRequest(
      body.proofRequestUri,
    )) as any
  }

  public async acceptPresentationRequest(agentReq: Req, body: ResolveProofRequest) {
    const resolved = await agentReq.agent.modules.openId4VcHolderModule.resolveOpenId4VpAuthorizationRequest(
      body.proofRequestUri,
    )
    console.log('Resolved proof request:', resolved)
    // const presentationExchangeService = agent.dependencyManager.resolve(DifPresentationExchangeService)

    if (!resolved.dcql) throw new Error('Missing DCQL on request')
    console.log('DCQL query result:', resolved.dcql.queryResult)
    //
    let dcqlCredentials
    try {
      dcqlCredentials = await agentReq.agent.modules.openId4VcHolderModule.selectCredentialsForDcqlRequest(
        resolved.dcql.queryResult,
      )
      console.log('Selected credentials for DCQL request:', dcqlCredentials)
    } catch (error) {
      console.error('Error selecting credentials for DCQL request:', error)
      throw error
    }
    const submissionResult = await agentReq.agent.modules.openId4VcHolderModule.acceptOpenId4VpAuthorizationRequest({
      authorizationRequestPayload: resolved.authorizationRequestPayload,
      dcql: {
        credentials: dcqlCredentials as DcqlCredentialsForRequest,
      },
    })
    console.log('Presentation submission result:', submissionResult)
    return submissionResult.serverResponse
  }

  public async decodeSdJwt(agentReq: Req, body: { jwt: string }) {
    const sdJwt = agentReq.agent.sdJwtVc.fromCompact(body.jwt)
    return sdJwt as any
  }

  public async getSelectedCredentialsForRequest(
    dcqlQueryResult: DcqlQueryResult,
    selectedCredentials: { [credentialQueryId: string]: string },
  ) {
    if (!dcqlQueryResult.canBeSatisfied) {
      throw new Error(
        'Cannot select the credentials for the dcql query presentation if the request cannot be satisfied',
      )
    }
    // TODO: Implement logic to select credentials based on selectedCredentials
    return {} as any // Placeholder return to avoid errors
  }
}
export const holderService = new HolderService()
