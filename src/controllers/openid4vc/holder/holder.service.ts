import type {
  AuthorizeRequestCredentialOffer,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'
import type { Agent } from '@credo-ts/core'
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

type MappedAttributesReturnType =
  | string
  | number
  | boolean
  | { [key: string]: MappedAttributesReturnType }
  | null
  | undefined
  | Array<MappedAttributesReturnType>

function recursivelyMapAttribues(value: unknown): MappedAttributesReturnType {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries()).map(([key, value]) => [key, recursivelyMapAttribues(value)]))
  }
  if (Array.isArray(value)) return value.map(recursivelyMapAttribues)
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, recursivelyMapAttribues(value)]))
}

export class HolderService {
  private HOLDER_REDIRECT = process.env.HOLDER_REDIRECT ?? 'http://localhost:4001/redirect'
  private HOLDER_CLIENT_ID = process.env.HOLDER_CLIENT_ID ?? 'wallet'

  public async getSdJwtCredentials(agent: Agent) {
    return await agent.sdJwtVc.getAll()
  }

  public async getMdocCredentials(agent: Agent) {
    return await agent.mdoc.getAll()
  }

  // public async resolveCredentialOffer(agent: Agent, body: ResolveCredentialOfferBody) {
  //   return await agent.modules.openId4VcHolderModule.resolveCredentialOffer(body.credentialOfferUri)
  // }

  public async requestAuthorizationForCredential(agent: Agent, body: AuthorizeRequestCredentialOffer) {
    console.log('Requesting authorization for credential offer:', body)
    const resolvedCredentialOffer = await agent.modules.openId4VcHolderModule.resolveCredentialOffer(
      body.credentialOfferUri,
    )
    console.log('Resolved credential offer:', resolvedCredentialOffer)
    const resolvedAuthorization = await this.initiateAuthorization(
      agent,
      resolvedCredentialOffer,
      body.credentialsToRequest,
    )

    let actionToTake = ''
    let authorizationRequestUrl: string | undefined = undefined
    let codeVerifier: string | undefined = undefined
    console.log('Resolved authorization:::::::::::::', resolvedAuthorization)

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

    return { actionToTake, authorizationRequestUrl, codeVerifier }
  }

  public async requestCredential(agent: Agent, body: RequestCredentialBody) {
    const resolvedCredentialOffer = await agent.modules.openId4VcHolderModule.resolveCredentialOffer(
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

    return await this.requestAndStoreCredentials(agent, resolvedCredentialOffer, options)
  }

  private async requestAndStoreCredentials(
    agent: Agent,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    options: OpenId4VciTokenRequestOptions,
  ) {
    const tokenResponse = await agent.modules.openId4VcHolderModule.requestToken({ ...options })
    const credentialResponse = await agent.modules.openId4VcHolderModule.requestCredentials({
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
        const key = await agent.wallet.createKey({ keyType: keyTypes[0] as any })
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
          return await agent.w3cCredentials.storeCredential({ credential })
        }
        if (credential instanceof Mdoc) {
          return await agent.mdoc.store(credential)
        }
        return await agent.sdJwtVc.store(credential.compact)
      }),
    )

    return storedCredentials
  }

  private async initiateAuthorization(
    agent: Agent,
    resolvedCredentialOffer: OpenId4VciResolvedCredentialOffer,
    credentialsToRequest: string[],
  ) {
    console.log("agent::::::::::::::", Object.keys(agent.modules.openId4VcHolderModule))

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

      const resolved = await agent.modules.openId4VcHolderModule.resolveIssuanceAuthorizationRequest(
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
      }
    }

    // ❌ Unsupported grant
    throw new Error('Unsupported grant type')
  }

  public async resolveProofRequest(agent: Agent, body: ResolveProofRequest) {
    return await agent.modules.openId4VcHolderModule.resolveOpenId4VpAuthorizationRequest(body.proofRequestUri)
  }

  public async acceptPresentationRequest(agent: Agent, body: ResolveProofRequest) {
    const resolved = await agent.modules.openId4VcHolderModule.resolveOpenId4VpAuthorizationRequest(
      body.proofRequestUri,
    )
    const presentationExchangeService = agent.dependencyManager.resolve(DifPresentationExchangeService)

    if (!resolved.presentationExchange) throw new Error('Missing presentation exchange on request')

    const submissionResult = await agent.modules.openId4VcHolderModule.acceptOpenId4VpAuthorizationRequest({
      authorizationRequestPayload: resolved.authorizationRequestPayload,
      presentationExchange: {
        credentials: presentationExchangeService.selectCredentialsForRequest(
          resolved.presentationExchange.credentialsForRequest,
        ),
      },
    })

    return submissionResult.serverResponse
  }
}
