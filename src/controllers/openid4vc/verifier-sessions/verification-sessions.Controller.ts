import { Agent } from '@credo-ts/core'
import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { Body, Controller, Get, Path, Post, Query, Route, Tags } from 'tsoa'
import { injectable } from 'tsyringe'

import ErrorHandlingService from '../../../errorHandlingService'
// import { CreateAuthorizationRequest } from '../types/verifier.types'

import { verificationSessionService } from './verification-sessions.service'

@Tags('oid4vc verification sessions')
@Route('/openid4vc/verification-sessions')
@injectable()
export class VerificationSessionsController extends Controller {
  private agent: Agent

  public constructor(agent: Agent) {
    super()
    this.agent = agent
  }

  /**
   * Create an authorization request, acting as a Relying Party (RP)
   */
//   @Post('/create-presentation-request')
//   public async createProofRequest(@Body() createAuthorizationRequest: any) {
//     try {
//       return await verificationSessionService.createProofRequest(this.agent, createAuthorizationRequest)
//     } catch (error) {
//       throw ErrorHandlingService.handle(error)
//     }
//   }

  /**
   * Retrieve all verification session records
   */
  @Get('/')
  public async getAllVerificationSessions(
    @Query('publicVerifierId') publicVerifierId?: string,
    @Query('payloadState') payloadState?: string,
    @Query('state') state?: OpenId4VcVerificationSessionState,
    @Query('authorizationRequestUri') authorizationRequestUri?: string,
    @Query('nonce') nonce?: string,
  ) {
    try {
      return await verificationSessionService.findVerificationSessionsByQuery(
        this.agent,
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
  public async getVerificationSessionsById(@Path('verificationSessionId') verificationSessionId: string) {
    try {
      return await verificationSessionService.getVerificationSessionsById(this.agent, verificationSessionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
  //  TODO: Uncomment when the method is implemented: There was a problem resolving type of 'IDTokenPayload'.
  // /**
  //  * Get verification response by verification Session ID
  //  */
  // @Get('/response/:verificationSessionId')
  // public async getVerifiedAuthorizationResponse(@Path('verificationSessionId') verificationSessionId: string) {
  //   try {
  //     return await verificationSessionService.getVerifiedAuthorizationResponse(this.agent, verificationSessionId)
  //   } catch (error) {
  //     throw ErrorHandlingService.handle(error)
  //   }
  // }
}
