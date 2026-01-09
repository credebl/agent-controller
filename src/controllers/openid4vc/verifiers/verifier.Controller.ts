import { Request as Req } from 'express'
import { Body, Delete, Get, Path, Post, Put, Query, Route, Request, Security, Tags } from 'tsoa'

import { SCOPES } from '../../../enums'
import { OpenId4VcSiopCreateVerifierOptions, OpenId4VcUpdateVerifierRecordOptions } from '../types/verifier.types'
import { VerifierService } from '../verifiers/verifier.service'

@Tags('oid4vc verifiers')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@Route('openid4vc/verifier')
export class VerifierController {
  private verifierService: VerifierService

  public constructor() {
    this.verifierService = new VerifierService()
  }

  /**
   * Create a new verifier and store the verifier record
   */
  @Post('/')
  public async createVerifier(@Request() request: Req, @Body() options: OpenId4VcSiopCreateVerifierOptions) {
    return await this.verifierService.createVerifier(request, options)
  }

  /**
   * Update verifier metadata
   */
  @Put('{publicVerifierId}')
  public async updateVerifierMetadata(
    @Request() request: Req,
    @Path('publicVerifierId') publicVerifierId: string,
    @Body() verifierRecordOptions: OpenId4VcUpdateVerifierRecordOptions,
  ) {
    return await this.verifierService.updateVerifierMetadata(request, {
      verifierId: publicVerifierId,
      clientMetadata: verifierRecordOptions.clientMetadata,
    })
  }

  /**
   * Get verifiers by query
   */
  @Get('/')
  public async getVerifiersByQuery(@Request() request: Req, @Query() publicVerifierId?: string) {
    return await this.verifierService.getVerifiersByQuery(request, publicVerifierId)
  }

  /**
   * Get single verifier by ID
   */
  @Get('{publicVerifierId}')
  public async getVerifier(@Request() request: Req, @Path('publicVerifierId') publicVerifierId: string) {
    return await this.verifierService.getVerifier(request, publicVerifierId)
  }

  /**
   * Delete verifier by ID
   */
  @Delete('{verifierId}')
  public async deleteVerifier(
    @Request() request: Req,
    @Path('verifierId') verifierId: string,
  ): Promise<{ message: string }> {
    return await this.verifierService.deleteVerifier(request, verifierId)
  }
}
