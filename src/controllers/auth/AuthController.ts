import axios from 'axios'
import { Request as Req } from 'express'
import { Body, Controller, Path, Post, Request, Route, Tags } from 'tsoa'
import { injectable } from 'tsyringe'

import { BadRequestError } from '../../errors'

interface OrgTokenRequest {
  clientId: string
  clientSecret: string
}

interface OrgTokenResponse {
  token: string
}

@Tags('Auth')
@Route('/v1/orgs')
@injectable()
export class AuthController extends Controller {
  /**
   * Generate an organization token by forwarding credentials to the platform
   */
  // @Security('jwt', [SCOPES.UNPROTECTED])
  @Post('/{orgId}/token')
  public async getOrgToken(
    @Request() _request: Req,
    @Path('orgId') orgId: string,
    @Body() body: OrgTokenRequest,
  ): Promise<OrgTokenResponse> {
    const trustServiceTokenUrl = process.env.TRUST_SERVICE_TOKEN_URL
    if (!trustServiceTokenUrl) {
      throw new BadRequestError('TRUST_SERVICE_TOKEN_URL is not configured')
    }

    const response = await axios.post<OrgTokenResponse>(
      `${trustServiceTokenUrl}`,
      { clientId: body.clientId, clientSecret: body.clientSecret },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json' } },
    )

    return response.data
  }
}
