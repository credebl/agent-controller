import type { OutOfBandInvitationProps, OutOfBandRecordWithInvitationProps } from '../../examples'
import type { AgentMessageType, RecipientKeyOption, CreateInvitationOptions } from '../../types'
import type {
  PeerDidNumAlgo2CreateOptions,
} from '@credo-ts/core'

import {
  JsonTransformer,
  Key,
  KeyType,
  createPeerDidDocumentFromServices,
  PeerDidNumAlgo,
} from '@credo-ts/core'

import {
  ConnectionRecordProps,
  CreateLegacyInvitationConfig,
  Routing,
  OutOfBandInvitation,
  AgentMessage
} from '@credo-ts/didcomm'
import { Request as Req } from 'express'
import { Body, Controller, Delete, Example, Get, Path, Post, Query, Route, Tags, Security, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { SCOPES } from '../../../enums'
import ErrorHandlingService from '../../../errorHandlingService'
import { InternalServerError, NotFoundError } from '../../../errors'
import { ConnectionRecordExample, outOfBandInvitationExample, outOfBandRecordExample, RecordId } from '../../examples'
import { AcceptInvitationConfig, ReceiveInvitationByUrlProps, ReceiveInvitationProps } from '../../types'

@Tags('DIDComm - Out Of Band')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@Route('/didcomm/oob')
@injectable()
export class OutOfBandController extends Controller {
  /**
   * Retrieve all out of band records
   * @param invitationId invitation identifier
   * @returns OutOfBandRecord[]
   */
  @Example<OutOfBandRecordWithInvitationProps[]>([outOfBandRecordExample])
  @Get()
  public async getAllOutOfBandRecords(@Request() request: Req, @Query('invitationId') invitationId?: RecordId) {
    try {
      const query = invitationId
        ? {
            invitationId: invitationId,
          }
        : {}
      const outOfBandRecords = await request.agent.modules.oob.findAllByQuery(query)

      return outOfBandRecords.map((c) => c.toJSON())
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve an out of band record by id
   * @param recordId record identifier
   * @returns OutOfBandRecord
   */
  @Example<OutOfBandRecordWithInvitationProps>(outOfBandRecordExample)
  @Get('/:outOfBandId')
  public async getOutOfBandRecordById(@Request() request: Req, @Path('outOfBandId') outOfBandId: RecordId) {
    try {
      const outOfBandRecord = await request.agent.modules.oob.findById(outOfBandId)

      if (!outOfBandRecord) throw new NotFoundError(`Out of band record with id "${outOfBandId}" not found.`)

      return outOfBandRecord.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates an outbound out-of-band record containing out-of-band invitation message defined in
   * Aries RFC 0434: Out-of-Band Protocol 1.1.
   * @param config configuration of how out-of-band invitation should be created
   * @returns Out of band record
   */
  @Example<{
    invitationUrl: string
    invitation: OutOfBandInvitationProps
    outOfBandRecord: OutOfBandRecordWithInvitationProps
  }>({
    invitationUrl: 'string',
    invitation: outOfBandInvitationExample,
    outOfBandRecord: outOfBandRecordExample,
  })
  @Post('/create-invitation')
  public async createInvitation(
    @Request() request: Req,
    @Body() config: CreateInvitationOptions & RecipientKeyOption, // props removed because of issues with serialization
  ) {
    try {
      let invitationDid: string | undefined
      if (config?.invitationDid) {
        invitationDid = config?.invitationDid
      } else {
        const didRouting = await request.agent.modules.mediationRecipient.getRouting({})
        const didDocument = createPeerDidDocumentFromServices([
          {
            id: 'didcomm',
            recipientKeys: [didRouting.recipientKey],
            routingKeys: didRouting.routingKeys,
            serviceEndpoint: didRouting.endpoints[0],
          },
        ])
        const did = await request.agent.dids.create<PeerDidNumAlgo2CreateOptions>({
          didDocument,
          method: 'peer',
          options: {
            numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
          },
        })

        invitationDid = did.didState.did

        if (!invitationDid) {
          throw new InternalServerError('Error in creating invitationDid')
        }
      }

      const outOfBandRecord = await request.agent.modules.oob.createInvitation({ ...config, invitationDid })
      return {
        invitationUrl: outOfBandRecord.outOfBandInvitation.toUrl({
          domain: request.agent.modules.didcomm.config.endpoints[0],
        }),
        invitation: outOfBandRecord.outOfBandInvitation.toJSON({
          useDidSovPrefixWhereAllowed: request.agent.modules.didcomm.config.useDidSovPrefixWhereAllowed,
        }),
        outOfBandRecord: outOfBandRecord.toJSON(),
        invitationDid: config?.invitationDid ? '' : invitationDid,
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates an outbound out-of-band record in the same way how `createInvitation` method does it,
   * but it also converts out-of-band invitation message to an "legacy" invitation message defined
   * in RFC 0160: Connection Protocol and returns it together with out-of-band record.
   *
   * @param config configuration of how a invitation should be created
   * @returns out-of-band record and invitation
   */
  @Example<{ invitation: OutOfBandInvitationProps; outOfBandRecord: OutOfBandRecordWithInvitationProps }>({
    invitation: outOfBandInvitationExample,
    outOfBandRecord: outOfBandRecordExample,
  })
  @Post('/create-legacy-invitation')
  public async createLegacyInvitation(
    @Request() request: Req,
    @Body() config?: Omit<CreateLegacyInvitationConfig, 'routing'> & RecipientKeyOption,
  ) {
    try {
      let routing: Routing
      if (config?.recipientKey) {
        routing = {
          endpoints: request.agent.modules.didcomm.config.endpoints,
          routingKeys: [],
          recipientKey: Key.fromPublicKeyBase58(config.recipientKey, KeyType.Ed25519),
          mediatorId: undefined,
        }
      } else {
        routing = await request.agent.modules.mediationRecipient.getRouting({})
      }
      const { outOfBandRecord, invitation } = await request.agent.modules.oob.createLegacyInvitation({
        ...config,
        routing,
      })
      return {
        invitationUrl: invitation.toUrl({
          domain: request.agent.modules.didcomm.config.endpoints[0],
          useDidSovPrefixWhereAllowed: request.agent.modules.didcomm.config.useDidSovPrefixWhereAllowed,
        }),
        invitation: invitation.toJSON({
          useDidSovPrefixWhereAllowed: request.agent.modules.didcomm.config.useDidSovPrefixWhereAllowed,
        }),
        outOfBandRecord: outOfBandRecord.toJSON(),
        ...(config?.recipientKey ? {} : { recipientKey: routing.recipientKey.publicKeyBase58 }),
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates a new connectionless legacy invitation.
   *
   * @param config configuration of how a connection invitation should be created
   * @returns a message and a invitationUrl
   */
  @Example<{ message: AgentMessageType; invitationUrl: string }>({
    message: {
      '@id': 'eac4ff4e-b4fb-4c1d-aef3-b29c89d1cc00',
      '@type': 'https://didcomm.org/connections/1.0/invitation',
    },
    invitationUrl: 'http://example.com/invitation_url',
  })
  @Post('/create-legacy-connectionless-invitation')
  public async createLegacyConnectionlessInvitation(
    @Request() request: Req,
    @Body()
    config: {
      recordId: string
      message: Record<string, unknown>;
      domain: string,
      routing?: Routing;
    },
  ) {
    try {
      const agentMessage = JsonTransformer.fromJSON(config.message, AgentMessage) as AgentMessage

      return await request.agent.modules.oob.createLegacyConnectionlessInvitation({
        ...config,
        message: agentMessage,
      })
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates inbound out-of-band record and assigns out-of-band invitation message to it if the
   * message is valid.
   *
   * @param invitation either OutOfBandInvitation or ConnectionInvitationMessage
   * @param config config for handling of invitation
   * @returns out-of-band record and connection record if one has been created.
   */
  @Example<{ outOfBandRecord: OutOfBandRecordWithInvitationProps; connectionRecord: ConnectionRecordProps }>({
    outOfBandRecord: outOfBandRecordExample,
    connectionRecord: ConnectionRecordExample,
  })
  @Post('/receive-invitation')
  public async receiveInvitation(@Request() request: Req, @Body() invitationRequest: ReceiveInvitationProps) {
    const { invitation, ...config } = invitationRequest

    try {
      const invite = new OutOfBandInvitation({ ...invitation, handshakeProtocols: invitation.handshake_protocols })
      const { outOfBandRecord, connectionRecord } = await request.agent.modules.oob.receiveInvitation(invite, config)

      return {
        outOfBandRecord: outOfBandRecord.toJSON(),
        connectionRecord: connectionRecord?.toJSON(),
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates inbound out-of-band record and assigns out-of-band invitation message to it if the
   * message is valid.
   *
   * @param invitationUrl invitation url
   * @param config config for handling of invitation
   * @returns out-of-band record and connection record if one has been created.
   */
  @Example<{ outOfBandRecord: OutOfBandRecordWithInvitationProps; connectionRecord: ConnectionRecordProps }>({
    outOfBandRecord: outOfBandRecordExample,
    connectionRecord: ConnectionRecordExample,
  })
  @Post('/receive-invitation-url')
  public async receiveInvitationFromUrl(
    @Request() request: Req,
    @Body() invitationRequest: ReceiveInvitationByUrlProps,
  ) {
    const { invitationUrl, ...config } = invitationRequest

    try {
      // const linkSecretIds = await request.agent.modules.anoncreds.getLinkSecretIds()
      // if (linkSecretIds.length === 0) {
      //   await request.agent.modules.anoncreds.createLinkSecret()
      // }
      const { outOfBandRecord, connectionRecord } = await request.agent.modules.oob.receiveInvitationFromUrl(
        invitationUrl,
        config,
      )
      return {
        outOfBandRecord: outOfBandRecord.toJSON(),
        connectionRecord: connectionRecord?.toJSON(),
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a connection invitation as invitee (by sending a connection request message) for the connection with the specified connection id.
   * This is not needed when auto accepting of connections is enabled.
   */
  @Example<{ outOfBandRecord: OutOfBandRecordWithInvitationProps; connectionRecord: ConnectionRecordProps }>({
    outOfBandRecord: outOfBandRecordExample,
    connectionRecord: ConnectionRecordExample,
  })
  @Post('/:outOfBandId/accept-invitation')
  public async acceptInvitation(
    @Request() request: Req,
    @Path('outOfBandId') outOfBandId: RecordId,
    @Body() acceptInvitationConfig: AcceptInvitationConfig,
  ) {
    try {
      const { outOfBandRecord, connectionRecord } = await request.agent.modules.oob.acceptInvitation(
        outOfBandId,
        acceptInvitationConfig,
      )

      return {
        outOfBandRecord: outOfBandRecord.toJSON(),
        connectionRecord: connectionRecord?.toJSON(),
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Deletes an out of band record from the repository.
   *
   * @param outOfBandId Record identifier
   */
  @Delete('/:outOfBandId')
  public async deleteOutOfBandRecord(@Request() request: Req, @Path('outOfBandId') outOfBandId: RecordId) {
    try {
      this.setStatus(204)
      await request.agent.modules.oob.deleteById(outOfBandId)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
