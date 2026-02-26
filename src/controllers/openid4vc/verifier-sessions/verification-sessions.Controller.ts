import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { Request as Req } from 'express'
import { Controller, Get, Path, Query, Route, Request, Security, Tags, Post, Body } from 'tsoa'
import { injectable } from 'tsyringe'

import { SCOPES } from '../../../enums'
import ErrorHandlingService from '../../../errorHandlingService'
import { CreateAuthorizationRequest, OpenId4VCDCQLVerificationSessionRecord } from '../types/verifier.types'

import { VerificationSessionsService } from './verification-sessions.service'

@Tags('oid4vc verification sessions')
@Route('/openid4vc/verification-sessions')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class VerificationSessionsController extends Controller {
  public constructor(private verificationSessionService: VerificationSessionsService) {
    super()
  }
  /**
   * Create an authorization request, acting as a Relying Party (RP)
   */
  @Post('/create-presentation-request')
  public async createProofRequest(
    @Request() request: Req,
    @Body() createAuthorizationRequest: CreateAuthorizationRequest,
  ) {
    try {
      return await this.verificationSessionService.createProofRequest(request, createAuthorizationRequest)
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
    @Query('authorizationRequestId') authorizationRequestId?: string,
    @Query('nonce') nonce?: string,
  ) {
    try {
      return await this.verificationSessionService.findVerificationSessionsByQuery(
        request,
        publicVerifierId,
        payloadState,
        state,
        authorizationRequestUri,
        nonce,
        authorizationRequestId,
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
      return await this.verificationSessionService.getVerificationSessionsById(request, verificationSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
  // /**
  //  * Get verification response by verification Session ID
  //  */
  @Get('/response/:verificationSessionId')
  public async getVerifiedAuthorizationResponse(
    @Request() request: Req,
    @Path('verificationSessionId') verificationSessionId: string,
  ) {
    try {
      return await this.verificationSessionService.getVerifiedAuthorizationResponse(request, verificationSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Verify authorization response for a DCAPI proof request
   */
  @Post('/verify-authorization-response')
  public async verifyDcqlProofRequest(
    @Request() request: Req,
    @Body() verifydcqlProofRquest: OpenId4VCDCQLVerificationSessionRecord,
  ) {
    try {
      return await this.verificationSessionService.verifyAuthorizationResponse(request, verifydcqlProofRquest)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
