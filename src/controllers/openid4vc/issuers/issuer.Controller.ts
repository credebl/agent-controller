import { Agent } from '@credo-ts/core'
import {
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Route,
  Tags,
  Path,
  Query,
  Body,
  Security,
  Request
} from 'tsoa'
import { injectable } from 'tsyringe'

import ErrorHandlingService from '../../../errorHandlingService'
import { UpdateIssuerRecordOptions } from '../types/issuer.types'
import { Request as Req } from 'express'

import { issuerService } from './issuer.service'
import { SCOPES } from '../../../enums'
@Route('/openid4vc/issuer')
@Tags('oid4vc issuers')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class IssuerController extends Controller {
  /**
   * Creates an issuer with issuer metadata.
   */
  @Post()
  public async createIssuer(@Request() request: Req, @Body() createIssuerOptions: any) {
    try {
      return await issuerService.createIssuerAgent(request, createIssuerOptions)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Updates issuer metadata for a given publicIssuerId.
   */
  @Put('{publicIssuerId}')
  public async updateIssuerMetadata(
    @Request() request: Req,
    @Path() publicIssuerId: string,
    @Body() updateIssuerRecordOptions: UpdateIssuerRecordOptions,
  ) {
    try {
      return await issuerService.updateIssuerMetadata(request, publicIssuerId, updateIssuerRecordOptions)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Returns metadata for a specific issuer.
   */
  @Get('{issuerId}/metadata')
  public async getIssuerAgentMetaData(@Request() request: Req, @Path() issuerId: string) {
    try {
      return await issuerService.getIssuerAgentMetaData(request, issuerId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Query issuers by optional publicIssuerId.
   */
  @Get()
  public async getIssuersByQuery(@Request() request: Req, @Query() publicIssuerId?: string) {
    try {
      return await issuerService.getIssuersByQuery(request, publicIssuerId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Returns a specific issuer by publicIssuerId.
   */
  @Get('{publicIssuerId}')
  public async getIssuer(@Request() request: Req, @Path() publicIssuerId: string) {
    try {
      return await issuerService.getIssuer(request, publicIssuerId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Deletes a specific issuer by record id.
   */
  @Delete('{id}')
  public async deleteIssuer(@Request() request: Req, @Path() id: string): Promise<void> {
    try {
      await issuerService.deleteIssuer(request, id)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
