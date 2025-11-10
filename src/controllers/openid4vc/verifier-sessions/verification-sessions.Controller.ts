import { Agent } from '@credo-ts/core'
import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { Controller, Get, Path, Query, Route, Request, Security, Tags, Post, Body } from 'tsoa'
import { injectable } from 'tsyringe'
import ErrorHandlingService from '../../../errorHandlingService'

import { verificationSessionService } from './verification-sessions.service'
import { SCOPES } from '../../../enums'
import { Request as Req } from 'express'
import { CreateAuthorizationRequest } from '../types/verifier.types'

@Tags('oid4vc verification sessions')
@Route('/openid4vc/verification-sessions')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class VerificationSessionsController extends Controller {
  /**
   * Create an authorization request, acting as a Relying Party (RP)
   */
  @Post('/create-presentation-request')
  public async createProofRequest(
    @Request() request: Req,
    @Body() createAuthorizationRequest: CreateAuthorizationRequest,
  ) {
    try {
      return await verificationSessionService.createProofRequest(request, createAuthorizationRequest)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve all verification session records
   */
  @Get('/')
  public async getAllVerificationSessions(
    @Request() request: Req,
    @Query('publicVerifierId') publicVerifierId?: string,
    @Query('payloadState') payloadState?: string,
    @Query('state') state?: OpenId4VcVerificationSessionState,
    @Query('authorizationRequestUri') authorizationRequestUri?: string,
    @Query('nonce') nonce?: string,
  ) {
    try {
      return await verificationSessionService.findVerificationSessionsByQuery(
        request,
        publicVerifierId,
        payloadState,
        state,
        authorizationRequestUri,
        nonce,
      )
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Get verification session by ID
   */
  @Get('/:verificationSessionId')
  public async getVerificationSessionsById(
    @Request() request: Req,
    @Path('verificationSessionId') verificationSessionId: string,
  ) {
    try {
      return await verificationSessionService.getVerificationSessionsById(request, verificationSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
  //  TODO: Uncomment when the method is implemented: There was a problem resolving type of 'IDTokenPayload'.
  // /**
  //  * Get verification response by verification Session ID
  //  */
  @Get('/response/:verificationSessionId')
  public async getVerifiedAuthorizationResponse(
    @Request() request: Req,
    @Path('verificationSessionId') verificationSessionId: string,
  ) {
    try {
      return await verificationSessionService.getVerifiedAuthorizationResponse(request, verificationSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
