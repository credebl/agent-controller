import { Agent } from '@credo-ts/core'
import { Body, Controller, Get, Post, Route, Security, Tags, Request } from 'tsoa'
import { injectable } from 'tsyringe'
import { Request as Req } from 'express'

import {
  AuthorizeRequestCredentialOffer,
  RequestCredentialBody,
  ResolveCredentialOfferBody,
  ResolveProofRequest,
} from '../types/holder.types'

import { holderService } from './holder.service'
import { SCOPES } from '../../../enums/enum'

@Tags('oid4vc holders')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@Route('openid4vc/holder')
@injectable()
export class HolderController extends Controller {
 
  /**
   * Get SdJwt type of credentials
   */
  @Get('/sd-jwt-vcs')
  public async getSdJwtCredentials(@Request() request: Req) {
    return await holderService.getSdJwtCredentials(request)
  }

  /** 
   * Fetch all mso mdoc credentials in wallet
   */
  @Get('/mdoc-vcs')
  public async getMdocCredentials(@Request() request: Req) {
    return await holderService.getMdocCredentials(request)
  }

    /**
   * Decode mso mdoc credential in wallet
   */
  @Post('/mdoc-vcs/decode')
  public async decodeMdocCredential(@Request() request: Req, @Body() body:{
      base64Url: string
    }) {
    return await holderService.decodeMdocCredential(request, body)
  }

  /**
   * Resolve a credential offer
   */
  @Post('resolve-credential-offer')
  public async resolveCredOffer(@Request() request: Req, @Body() body: ResolveCredentialOfferBody) {
    return await holderService.resolveCredentialOffer(request, body)
  }

//   /**
//    * Initiate an OID4VCI authorization request
//    */
  @Post('authorization-request')
  public async requestAuthorizationForCredential(@Request() request: Req, @Body() body: AuthorizeRequestCredentialOffer) {
    return await holderService.requestAuthorizationForCredential(request, body)
  }

  /**
   * Initiates a token request, then requests credentials from issuer
   */
  @Post('request-credential')
  public async requestCredential(@Request() request: Req, @Body() body: RequestCredentialBody) {
    return await holderService.requestCredential(request, body)
  }

  /**
   * Resolve a proof request
   */
  @Post('resolve-proof-request')
  public async resolveProofRequest(@Request() request: Req, @Body() body: ResolveProofRequest) {
    return await holderService.resolveProofRequest(request, body)
  }

  /**
   * Accept a proof request
   */
  @Post('accept-proof-request')
  public async acceptProofRequest(@Request() request: Req, @Body() body: ResolveProofRequest) {
    return await holderService.acceptPresentationRequest(request, body)
  }

  @Post('decode-sdjwt')
  public async decodeSdJwt(@Request() request: Req, @Body() body: { jwt: string }) {
    return await holderService.decodeSdJwt(request, body)
  }
}