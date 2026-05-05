import { getUnqualifiedSchemaId, parseIndySchemaId, RegisterSchemaReturnStateFinished } from '@credo-ts/anoncreds'
import { Request as Req } from 'express'
import { Example, Get, Post, Route, Tags, Security, Path, Body, Controller, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { CredentialEnum, EndorserMode, SchemaError, SCOPES } from '../../../enums'
import ErrorHandlingService from '../../../errorHandlingService'
import { ENDORSER_DID_NOT_PRESENT } from '../../../errorMessages'
import { BadRequestError, InternalServerError, NotFoundError } from '../../../errors/errors'
import { CreateSchemaSuccessful, SchemaExample, SchemaId } from '../../examples'
import { CreateSchemaInput, RegisterSchemaReturn, SchemaResponseDTO } from '../../types'

@Tags('Anoncreds - Schemas')
@Route('/anoncreds/schemas')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class SchemaController extends Controller {
  /**
   * Get schema by schemaId
   * @param schemaId
   * @param notFoundErrormessage
   * @param forbiddenError
   * @param badRequestError
   * @param internalServerError
   * @returns get schema by Id
   */
  @Example(SchemaExample)
  @Get('/:schemaId')
  public async getSchemaById(
    @Request() request: Req,
    @Path('schemaId') schemaId: SchemaId,
  ): Promise<SchemaResponseDTO> {
    try {
      const schemBySchemaId = await request.agent.modules.anoncreds.getSchema(schemaId)

      if (
        (schemBySchemaId &&
          schemBySchemaId?.resolutionMetadata &&
          schemBySchemaId?.resolutionMetadata?.error === SchemaError.NotFound) ||
        schemBySchemaId?.resolutionMetadata?.error === SchemaError.UnSupportedAnonCredsMethod
      ) {
        throw new NotFoundError(
          schemBySchemaId?.resolutionMetadata?.message || `schema details with schema id "${schemaId}" not found.`,
        )
      }

      return schemBySchemaId
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Create schema
   * @param schema
   * @param notFoundError
   * @param forbiddenError
   * @param badRequestError
   * @param internalServerError
   * @returns get schema
   */
  @Post('/')
  @Example(CreateSchemaSuccessful)
  public async createSchema(
    @Request() request: Req,
    @Body() schema: CreateSchemaInput,
  ): Promise<RegisterSchemaReturn | RegisterSchemaReturnStateFinished> {
    try {
      const { issuerId, name, version, attributes } = schema

      const schemaPayload = {
        issuerId,
        name,
        version,
        attrNames: attributes,
      }
      const createSchemaPayload = {
        schema: schemaPayload,
        options: {
          endorserMode: '',
          endorserDid: '',
        },
      }

      if (!schema.endorse) {
        createSchemaPayload.options.endorserMode = EndorserMode.Internal
        createSchemaPayload.options.endorserDid = issuerId
      } else {
        if (!schema.endorserDid) {
          throw new BadRequestError(ENDORSER_DID_NOT_PRESENT)
        }
        createSchemaPayload.options.endorserMode = EndorserMode.External
        createSchemaPayload.options.endorserDid = schema.endorserDid
      }

      const createSchemaTxResult = await request.agent.modules.anoncreds.registerSchema(createSchemaPayload)

      if (createSchemaTxResult.schemaState.state === CredentialEnum.Failed) {
        throw new InternalServerError(`Schema creation failed. Reason: ${createSchemaTxResult.schemaState.reason}`)
      }

      if (createSchemaTxResult.schemaState.state === CredentialEnum.Wait) {
        this.setStatus(202)
        return createSchemaTxResult
      }

      if (createSchemaTxResult.schemaState.state === CredentialEnum.Action) {
        return createSchemaTxResult
      }

      if (createSchemaTxResult.schemaState.state === CredentialEnum.Finished) {
        // TODO: Return uniform response for both Internally and Externally endorsed Schemas
        if (!schema.endorse) {
          const indySchemaId = parseIndySchemaId(createSchemaTxResult.schemaState.schemaId as string)

          const getSchemaUnqualifiedId = await getUnqualifiedSchemaId(
            indySchemaId.namespaceIdentifier,
            indySchemaId.schemaName,
            indySchemaId.schemaVersion,
          )

          createSchemaTxResult.schemaState.schemaId = getSchemaUnqualifiedId
          return createSchemaTxResult.schemaState
        }
        return createSchemaTxResult
      }
      // If none of the above conditions are met, throw an error or return a default value
      throw new InternalServerError('Unexpected schema creation state.')
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
