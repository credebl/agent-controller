import { Agent } from '@credo-ts/core'
import { Body, Delete, Get, Path, Post, Put, Query, Route, Tags } from 'tsoa'

// import { OpenId4VcSiopCreateVerifierOptions, OpenId4VcUpdateVerifierRecordOptions } from '../types/verifier.types'
import { VerifierService } from '../verifiers/verifier.service'

@Tags('oid4vc verifiers')
@Route('openid4vc/verifier')
export class VerifierController {
  private agent: Agent
  private verifierService: VerifierService

  public constructor(agent: Agent) {
    this.agent = agent
    this.verifierService = new VerifierService()
  }

  /**
   * Create a new verifier and store the verifier record
   */
  @Post('/')
  public async createVerifier(@Body() options: any) {
    return await this.verifierService.createVerifier(this.agent, options)
  }

  /**
   * Update verifier metadata
   */
  @Put('{publicVerifierId}')
  public async updateVerifierMetadata(
    @Path('publicVerifierId') publicVerifierId: string,
    @Body() verifierRecordOptions: any,
  ) {
    return await this.verifierService.updateVerifierMetadata(this.agent, {
      verifierId: publicVerifierId,
      clientMetadata: verifierRecordOptions.clientMetadata,
    })
  }

  /**
   * Get verifiers by query
   */
  @Get('/')
  public async getVerifiersByQuery(@Query() publicVerifierId?: string) {
    return await this.verifierService.getVerifiersByQuery(this.agent, publicVerifierId)
  }

  /**
   * Get single verifier by ID
   */
  @Get('{publicVerifierId}')
  public async getVerifier(@Path('publicVerifierId') publicVerifierId: string) {
    return await this.verifierService.getVerifier(this.agent, publicVerifierId)
  }

  /**
   * Delete verifier by ID
   */
  @Delete('{verifierId}')
  public async deleteVerifier(@Path('verifierId') verifierId: string): Promise<void> {
    await this.verifierService.deleteVerifier(this.agent, verifierId)
  }
}
