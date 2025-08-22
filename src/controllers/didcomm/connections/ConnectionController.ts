import type { ConnectionRecordProps } from '@credo-ts/didcomm'

import { DidExchangeState } from '@credo-ts/didcomm'
import { Request as Req } from 'express'
import { Controller, Delete, Example, Get, Path, Post, Query, Route, Tags, Security, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { SCOPES } from '../../../enums'
import ErrorHandlingService from '../../../errorHandlingService'
import { NotFoundError } from '../../../errors'
import { ConnectionRecordExample, RecordId } from '../../examples'

@Tags('DIDComm - Connections')
@Route()
@injectable()
export class ConnectionController extends Controller {
  /**
   * Retrieve all connections records
   * @param alias Alias
   * @param state Connection state
   * @param myDid My DID
   * @param theirDid Their DID
   * @param theirLabel Their label
   * @returns ConnectionRecord[]
   */
  @Example<ConnectionRecordProps[]>([ConnectionRecordExample])
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Get('/didcomm/connections')
  public async getAllConnections(
    @Request() request: Req,
    @Query('outOfBandId') outOfBandId?: string,
    @Query('alias') alias?: string,
    @Query('state') state?: DidExchangeState,
    @Query('myDid') myDid?: string,
    @Query('theirDid') theirDid?: string,
    @Query('theirLabel') theirLabel?: string,
  ) {
    try {
      const connections = await request.agent.modules.connections.findAllByQuery({
        outOfBandId,
        alias,
        myDid,
        theirDid,
        theirLabel,
        state,
      })

      return connections.map((c) => c.toJSON())
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve connection record by connection id
   * @param connectionId Connection identifier
   * @returns ConnectionRecord
   */
  @Example<ConnectionRecordProps>(ConnectionRecordExample)
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Get('/didcomm/connections/:connectionId')
  public async getConnectionById(@Request() request: Req, @Path('connectionId') connectionId: RecordId) {
    try {
      const connection = await request.agent.modules.connections.findById(connectionId)

      if (!connection) throw new NotFoundError(`Connection with connection id "${connectionId}" not found.`)

      return connection.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Deletes a connection record from the connection repository.
   *
   * @param connectionId Connection identifier
   */
  @Delete('/didcomm/connections/:connectionId')
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  public async deleteConnection(@Request() request: Req, @Path('connectionId') connectionId: RecordId) {
    try {
      this.setStatus(204)
      await request.agent.modules.connections.deleteById(connectionId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a connection request as inviter by sending a connection response message
   * for the connection with the specified connection id.
   *
   * This is not needed when auto accepting of connection is enabled.
   *
   * @param connectionId Connection identifier
   * @returns ConnectionRecord
   */
  @Example<ConnectionRecordProps>(ConnectionRecordExample)
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/didcomm/connections/:connectionId/accept-request')
  public async acceptRequest(@Request() request: Req, @Path('connectionId') connectionId: RecordId) {
    try {
      const connection = await request.agent.modules.connections.acceptRequest(connectionId)
      return connection.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a connection response as invitee by sending a trust ping message
   * for the connection with the specified connection id.
   *
   * This is not needed when auto accepting of connection is enabled.
   *
   * @param connectionId Connection identifier
   * @returns ConnectionRecord
   */
  @Example<ConnectionRecordProps>(ConnectionRecordExample)
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/didcomm/connections/:connectionId/accept-response')
  public async acceptResponse(@Request() request: Req, @Path('connectionId') connectionId: RecordId) {
    try {
      const connection = await request.agent.modules.connections.acceptResponse(connectionId)
      return connection.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Get('/didcomm/url/:invitationId')
  public async getInvitation(@Request() request: Req, @Path('invitationId') invitationId: string) {
    try {
      const outOfBandRecord = await request.agent.modules.connections.findByInvitationDid(invitationId)

      if (!outOfBandRecord)
        throw new NotFoundError(`connection with invitationId "${invitationId}" not found.`)

      return outOfBandRecord
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
