import type {
  PeerDidNumAlgo2CreateOptions,
} from '@credo-ts/core'

import {
  AcceptProofRequestOptions,
  DidCommProofExchangeRecordProps,
  ProofsProtocolVersionType,
  DidCommRouting,
} from '@credo-ts/didcomm'

import { PeerDidNumAlgo, createPeerDidDocumentFromServices } from '@credo-ts/core'
import { Request as Req } from 'express'
import { Body, Controller, Example, Get, Path, Post, Query, Route, Tags, Security, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { SCOPES } from '../../../enums'
import ErrorHandlingService from '../../../errorHandlingService'
import { ProofRecordExample, RecordId } from '../../examples'
import {
  AcceptProofProposal,
  CreateProofRequestOobOptions,
  RequestProofOptions,
  RequestProofProposalOptions,
} from '../../types'

@Tags('DIDComm - Proofs')
@Route('/didcomm/proofs')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class ProofController extends Controller {
  /**
   * Retrieve all proof records
   *
   * @param threadId
   * @returns ProofRecord[]
   */
  @Example<DidCommProofExchangeRecordProps[]>([ProofRecordExample])
  @Get('/')
  public async getAllProofs(@Request() request: Req, @Query('threadId') threadId?: string) {
    try {
      const query = threadId ? { threadId } : {}
      const proofs = await request.agent.modules.didcomm.proofs.findAllByQuery(query)

      return proofs.map((proof) => proof.toJSON())
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve proof record by proof record id
   *
   * @param proofRecordId
   * @returns ProofRecord
   */
  @Get('/:proofRecordId')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async getProofById(@Request() request: Req, @Path('proofRecordId') proofRecordId: RecordId) {
    try {
      const proof = await request.agent.modules.didcomm.proofs.getById(proofRecordId)

      return proof.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Initiate a new presentation exchange as prover by sending a presentation proposal request
   * to the connection with the specified connection id.
   *
   * @param proposal
   * @returns ProofRecord
   */
  @Post('/propose-proof')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async proposeProof(@Request() request: Req, @Body() requestProofProposalOptions: RequestProofProposalOptions) {
    try {
      const proof = await request.agent.modules.didcomm.proofs.proposeProof({
        connectionId: requestProofProposalOptions.connectionId,
        protocolVersion: requestProofProposalOptions.protocolVersion as ProofsProtocolVersionType<[]>,
        proofFormats: requestProofProposalOptions.proofFormats,
        comment: requestProofProposalOptions.comment,
        autoAcceptProof: requestProofProposalOptions.autoAcceptProof,
        goalCode: requestProofProposalOptions.goalCode,
        parentThreadId: requestProofProposalOptions.parentThreadId,
      })

      return proof
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a presentation proposal as verifier by sending an accept proposal message
   * to the connection associated with the proof record.
   *
   * @param proofRecordId
   * @param proposal
   * @returns ProofRecord
   */
  @Post('/accept-proposal')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async acceptProposal(@Request() request: Req, @Body() acceptProposal: AcceptProofProposal) {
    try {
      const proof = await request.agent.modules.didcomm.proofs.acceptProposal(acceptProposal)

      return proof
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates a presentation request bound to existing connection
   */
  @Post('/request-proof')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async requestProof(@Request() request: Req, @Body() requestProofOptions: RequestProofOptions) {
    try {
      const requestProofPayload = {
        connectionId: requestProofOptions.connectionId,
        protocolVersion: requestProofOptions.protocolVersion as ProofsProtocolVersionType<[]>,
        comment: requestProofOptions.comment,
        proofFormats: requestProofOptions.proofFormats,
        autoAcceptProof: requestProofOptions.autoAcceptProof,
        goalCode: requestProofOptions.goalCode,
        parentThreadId: requestProofOptions.parentThreadId,
        willConfirm: requestProofOptions.willConfirm,
      }
      const proof = await request.agent.modules.didcomm.proofs.requestProof(requestProofPayload)

      return proof
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Creates a presentation request not bound to any proposal or existing connection
   */
  @Post('create-request-oob')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async createRequest(@Request() request: Req, @Body() createRequestOptions: CreateProofRequestOobOptions) {
    try {
      let routing: DidCommRouting
      let invitationDid: string | undefined

      if (createRequestOptions?.invitationDid) {
        invitationDid = createRequestOptions?.invitationDid
      } else {
        routing = await request.agent.modules.didcomm.mediationRecipient.getRouting({})
        const {didDocument, keys} = createPeerDidDocumentFromServices([
          {
            id: 'didcomm',
            recipientKeys: [routing.recipientKey],
            routingKeys: routing.routingKeys,
            serviceEndpoint: routing.endpoints[0],
          }
        ],
        true)
        const did = await request.agent.dids.create<PeerDidNumAlgo2CreateOptions>({
          didDocument,
          method: 'peer',
          options: {
            numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
            keys
          },
        })
        invitationDid = did.didState.did
      }

      const proof = await request.agent.modules.didcomm.proofs.createRequest({
        protocolVersion: createRequestOptions.protocolVersion as ProofsProtocolVersionType<[]>,
        proofFormats: createRequestOptions.proofFormats,
        goalCode: createRequestOptions.goalCode,
        willConfirm: createRequestOptions.willConfirm,
        parentThreadId: createRequestOptions.parentThreadId,
        autoAcceptProof: createRequestOptions.autoAcceptProof,
        comment: createRequestOptions.comment,
      })
      const proofMessage = proof.message
      const outOfBandRecord = await request.agent.modules.didcomm.oob.createInvitation({
        label: createRequestOptions.label,
        messages: [proofMessage],
        autoAcceptConnection: true,
        imageUrl: createRequestOptions?.imageUrl,
        goalCode: createRequestOptions?.goalCode,
        invitationDid,
      })

      return {
        invitationUrl: outOfBandRecord.outOfBandInvitation.toUrl({
          domain: request.agent.modules.didcomm.config.endpoints[0],
        }),
        invitation: outOfBandRecord.outOfBandInvitation.toJSON({
          useDidSovPrefixWhereAllowed: request.agent.modules.didcomm.config.useDidSovPrefixWhereAllowed,
        }),
        outOfBandRecord: outOfBandRecord.toJSON(),
        invitationDid,
        proofRecordThId: proof.proofRecord.threadId,
        proofMessageId: proof.message.thread?.threadId || proof.message.threadId || proof.message.id,
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a presentation request as prover by sending an accept request message
   * to the connection associated with the proof record.
   *
   * @param proofRecordId
   * @param request
   * @returns ProofRecord
   */
  @Post('/:proofRecordId/accept-request')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async acceptRequest(
    @Request() request: Req,
    @Path('proofRecordId') proofRecordId: string,
    @Body()
    body: {
      // TODO: Check if we can remove the below body options as they are not used
      filterByPresentationPreview?: boolean
      filterByNonRevocationRequirements?: boolean
      comment?: string
    },
  ) {
    try {
      const requestedCredentials = await request.agent.modules.didcomm.proofs.selectCredentialsForRequest({
        proofExchangeRecordId: proofRecordId,
      })

      const acceptProofRequest: AcceptProofRequestOptions = {
        proofExchangeRecordId: proofRecordId,
        comment: body.comment,
        proofFormats: requestedCredentials.proofFormats,
      }

      const proof = await request.agent.modules.didcomm.proofs.acceptRequest(acceptProofRequest)

      return proof.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a presentation as prover by sending an accept presentation message
   * to the connection associated with the proof record.
   *
   * @param proofRecordId
   * @returns ProofRecord
   */
  @Post('/:proofRecordId/accept-presentation')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  public async acceptPresentation(@Request() request: Req, @Path('proofRecordId') proofRecordId: string) {
    try {
      const proof = await request.agent.modules.didcomm.proofs.acceptPresentation({ proofExchangeRecordId:proofRecordId })
      return proof
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Return proofRecord
   *
   * @param proofRecordId
   * @returns ProofRecord
   */
  @Get('/:proofRecordId/form-data')
  @Example<DidCommProofExchangeRecordProps>(ProofRecordExample)
  // TODO: Add return type
  public async proofFormData(@Request() request: Req, @Path('proofRecordId') proofRecordId: string) {
    try {
      const proof = await request.agent.modules.didcomm.proofs.getFormatData(proofRecordId)
      return proof
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
