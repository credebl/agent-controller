import type { SchemaMetadata } from '../types'

import { generateSecp256k1KeyPair } from '@ayanworks/credo-polygon-w3c-module'
import { DidOperation, DidOperationOptions } from '@ayanworks/credo-polygon-w3c-module'
import { Request as Req } from 'express'
import * as fs from 'fs'
import { Route, Tags, Security, Controller, Post, Body, Get, Path, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { CredentialEnum, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError, UnprocessableEntityError } from '../../errors'

@Tags('Polygon')
@Route('/polygon')
@injectable()
export class Polygon extends Controller {
  /**
   * Create Secp256k1 key pair for polygon DID
   *
   * @returns Secp256k1KeyPair
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT, SCOPES.MULTITENANT_BASE_AGENT])
  @Post('create-keys')
  public async createKeyPair(): Promise<{
    privateKey: string
    publicKeyBase58: string
    address: string
  }> {
    try {
      return await generateSecp256k1KeyPair()
    } catch (error) {
      // Handle the error here
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Create polygon based W3C schema
   *
   * @returns Schema JSON
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('create-schema')
  public async createSchema(
    @Request() request: Req,
    @Body()
    createSchemaRequest: {
      did: string
      schemaName: string
      schema: Record<string, unknown>
    },
  ): Promise<unknown> {
    try {
      const { did, schemaName, schema } = createSchemaRequest
      if (!did || !schemaName || !schema) {
        throw new BadRequestError('One or more parameters are empty or undefined.')
      }

      const schemaResponse = await request.agent.modules.polygon.createSchema({
        did,
        schemaName,
        schema,
      })
      if (schemaResponse.schemaState?.state === CredentialEnum.Failed) {
        const reason = schemaResponse.schemaState?.reason?.toLowerCase()
        if (reason && reason.includes('insufficient') && reason.includes('funds')) {
          throw new UnprocessableEntityError(
            'Insufficient funds to the address, Please add funds to perform this operation',
          )
        } else {
          throw new Error(schemaResponse.schemaState?.reason)
        }
      }
      const schemaServerConfig = fs.readFileSync('config.json', 'utf-8')
      const configJson = JSON.parse(schemaServerConfig)
      if (!configJson.schemaFileServerURL) {
        throw new Error('Please provide valid schema file server URL')
      }

      if (!schemaResponse?.schemaId) {
        throw new BadRequestError('Error in getting schema response or Invalid schema response')
      }
      const schemaPayload: SchemaMetadata = {
        schemaUrl: configJson.schemaFileServerURL + schemaResponse?.schemaId,
        did: schemaResponse?.did,
        schemaId: schemaResponse?.schemaId,
        schemaTxnHash: schemaResponse?.resourceTxnHash,
      }
      return schemaPayload
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Estimate transaction
   *
   * @returns Transaction Object
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT, SCOPES.MULTITENANT_BASE_AGENT])
  @Post('estimate-transaction')
  public async estimateTransaction(
    @Request() request: Req,
    @Body()
    estimateTransactionRequest: DidOperationOptions,
  ): Promise<unknown> {
    try {
      const { operation } = estimateTransactionRequest
      if (!Object.values(DidOperation).includes(operation)) {
        throw new BadRequestError('Invalid method parameter!')
      }
      if (operation === DidOperation.Create) {
        return request.agent.modules.polygon.estimateFeeForDidOperation({ operation })
      } else if (operation === DidOperation.Update) {
        return request.agent.modules.polygon.estimateFeeForDidOperation({ ...estimateTransactionRequest })
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Fetch schema details
   *
   * @returns Schema Object
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Get(':did/:schemaId')
  public async getSchemaById(
    @Request() request: Req,
    @Path('did') did: string,
    @Path('schemaId') schemaId: string,
  ): Promise<unknown> {
    try {
      if (!did || !schemaId) {
        throw new BadRequestError('Missing or invalid parameters.')
      }
      const schemaDetails = await request.agent.modules.polygon.getSchemaById(did, schemaId)
      return schemaDetails
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
