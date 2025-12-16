import { OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { Request as Req } from 'express'
import { Body, Controller, Delete, Get, Path, Post, Put, Query, Request, Route, Tags, Security } from 'tsoa'
import { injectable } from 'tsyringe'

import { SCOPES } from '../../../enums'
// eslint-disable-next-line import/order
import ErrorHandlingService from '../../../errorHandlingService'

// import { AgentWithRootOrTenant } from '../../types/agent'
import { OpenId4VcIssuanceSessionsCreateOffer } from '../types/issuer.types'

import { issuanceSessionService } from './issuance-sessions.service'

/**
 * Controller for managing OpenID4VC issuance sessions.
 * Provides endpoints to create credential offers, retrieve issuance sessions,
 * update session metadata, and delete sessions.
 */
@Tags('oid4vc issuance sessions')
@Route('/openid4vc/issuance-sessions')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class IssuanceSessionsController extends Controller {
  /**
   * Creates a credential offer with the specified credential configurations and authorization type.
   */
  @Post('/create-credential-offer')
  public async createCredentialOffer(@Request() request: Req, @Body() options: OpenId4VcIssuanceSessionsCreateOffer) {
    try {
      return await issuanceSessionService.createCredentialOffer(options, request)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Get issuance details by issuance SessionId
   */
  @Get('/:issuanceSessionId')
  public async getIssuanceSessionsById(@Request() request: Req, @Path('issuanceSessionId') issuanceSessionId: string) {
    try {
      return await issuanceSessionService.getIssuanceSessionsById(request, issuanceSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Fetch all issuance sessions by query
   */
  @Get('/')
  public async getIssuanceSessionsByQuery(
    @Request() request: Req,
    @Query() cNonce?: string,
    @Query() publicIssuerId?: string,
    @Query() preAuthorizedCode?: string,
    @Query() state?: OpenId4VcIssuanceSessionState,
    @Query() credentialOfferUri?: string,
    @Query() authorizationCode?: string,
  ) {
    try {
      return await issuanceSessionService.getIssuanceSessionsByQuery(
        request,
        cNonce,
        publicIssuerId,
        preAuthorizedCode,
        state,
        credentialOfferUri,
        authorizationCode,
      )
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Update issuance session metadata by session ID
   */
  @Put('/:issuanceSessionId')
  public async updateSessionById(
    @Request() request: Req,
    @Path('issuanceSessionId') issuanceSessionId: string,
    @Body() metadata: Record<string, unknown>,
  ) {
    try {
      return await issuanceSessionService.updateSessionIssuanceMetadataById(request, issuanceSessionId, metadata)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Delete issuance session by session ID
   */
  @Delete('/:issuanceSessionId')
  public async deleteIssuanceSessionById(
    @Request() request: Req,
    @Path('issuanceSessionId') issuanceSessionId: string,
  ) {
    try {
      await issuanceSessionService.deleteById(request, issuanceSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
