import axios from 'axios'
import { Request as Req } from 'express'
import { Body, Controller, Get, Path, Post, Request, Route, Tags } from 'tsoa'
import { injectable } from 'tsyringe'

import { BadRequestError } from '../../errors'
import { fetchDedicatedX509Certificates, fetchSharedAgentX509Certificates } from '../../utils/helpers'
import { getTrustedCerts } from '../../utils/oid4vc-agent'

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
    const platformBaseUrl = process.env.PLATFORM_BASE_URL
    if (!platformBaseUrl) {
      throw new BadRequestError('PLATFORM_BASE_URL is not configured')
    }

    const response = await axios.post<OrgTokenResponse>(
      `${platformBaseUrl}/v1/orgs/${orgId}/token`,
      { clientId: body.clientId, clientSecret: body.clientSecret },
      { headers: { 'Content-Type': 'application/json', accept: 'application/json' } },
    )

    return response.data
  }
// TODO: Remove these test endpoints after manual testing is done
  @Get('/test/dedicated-x509-certificates')
  public async testFetchDedicatedX509Certificates(@Request() _request: Req): Promise<string[]> {
    return fetchDedicatedX509Certificates()
  }

  @Get('/test/shared-agent-x509-certificates')
  public async testFetchSharedAgentX509Certificates(@Request() _request: Req): Promise<string[]> {
    return fetchSharedAgentX509Certificates()
  }

  /**
   * [TEMP] Manually trigger getTrustedCerts to test agent type detection and trust list fetch
   */
  @Get('/test/trusted-certs')
  public async testGetTrustedCerts(@Request() _request: Req): Promise<string[]> {
    return getTrustedCerts()
  }
}
