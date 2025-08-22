import { Agent } from '@credo-ts/core'
import { Body, Get, Post, Route, Security, Tags } from 'tsoa'
import { injectable } from 'tsyringe'

import {
  AuthorizeRequestCredentialOffer,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'

import { HolderService } from './holder.service'

@Tags('oid4vc holders')
@Security('apiKey')
@Route('openid4vc/holder')
@injectable()
export class HolderController {
  private agent: Agent
  private holderService: HolderService

  public constructor(agent: Agent) {
    this.agent = agent
    this.holderService = new HolderService()
  }

  /**
   * Get SdJwt type of credentials
   */
  @Get('/sd-jwt-vcs')
  public async getSdJwtCredentials() {
    return await this.holderService.getSdJwtCredentials(this.agent)
  }

  /**
   * Fetch all mso mdoc credentials in wallet
   */
  @Get('/mdoc-vcs')
  public async getMdocCredentials() {
    return await this.holderService.getMdocCredentials(this.agent)
  }

  /**
   * Resolve a credential offer
   */
  // @Post('resolve-credential-offer')
  // public async resolveCredOffer(@Body() body: ResolveCredentialOfferBody) {
  //   return await this.holderService.resolveCredentialOffer(this.agent, body)
  // }

  /**
   * Initiate an OID4VCI authorization request
   */
  @Post('authorization-request')
  public async requestAuthorizationForCredential(@Body() body: AuthorizeRequestCredentialOffer) {
    return await this.holderService.requestAuthorizationForCredential(this.agent, body)
  }

  /**
   * Initiates a token request, then requests credentials from issuer
   */
  @Post('request-credential')
  public async requestCredential(@Body() body: RequestCredentialBody) {
    return await this.holderService.requestCredential(this.agent, body)
  }

  /**
   * Resolve a proof request
   */
  @Post('resolve-proof-request')
  public async resolveProofRequest(@Body() body: ResolveProofRequest) {
    return await this.holderService.resolveProofRequest(this.agent, body)
  }

  /**
   * Accept a proof request
   */
  @Post('accept-proof-request')
  public async acceptProofRequest(@Body() body: ResolveProofRequest) {
    return await this.holderService.acceptPresentationRequest(this.agent, body)
  }
}
