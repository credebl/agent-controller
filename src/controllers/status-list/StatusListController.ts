import type { BSLCSignedPayload, BSLCredentialPayload, CredentialMetadata } from '../types'
import type { W3cJsonLdVerifiableCredential } from '@credo-ts/core'

import { ClaimFormat, utils } from '@credo-ts/core'
import * as crypto from 'crypto'
import { Request as Req } from 'express'
import { Controller, Get, Path, Security, Tags, Example, Response, Route, Post, Body, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { initialBitsEncoded, BSLC_ENDPOINT } from '../../utils/constant'
import { CredentialContext, BSLCredentialType, RevocationListType, BSLSignatureType, SCOPES } from '../../enums/enum'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError, InternalServerError } from '../../errors/errors'
import { ApiService } from '../../services/apiService'
import { customDeflate, customInflate } from '../../utils/helpers'

@injectable()
@Tags('Status List')
@Route('/status-list')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
export class StatusListController extends Controller {
  private readonly apiService: ApiService

  public constructor(apiService: ApiService) {
    super()
    this.apiService = apiService
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private getBslcConfig(): { serverUrl: string; apiKey: string } {
    const serverUrl = process.env.BSLC_SERVER_URL
    const apiKey = process.env.BSLC_SERVER_TOKEN
    if (!serverUrl) throw new InternalServerError('BSLC_SERVER_URL is not configured')
    if (!apiKey) throw new InternalServerError('BSLC_SERVER_TOKEN is not configured')
    return { serverUrl, apiKey }
  }

  private buildBSLCPayload(issuerDID: string, statusPurpose: string, bslcId: string): BSLCredentialPayload {
    const { serverUrl } = this.getBslcConfig()
    const credentialId = `${serverUrl}${process.env.BSLC_ROUTE}/${bslcId}`

    return {
      '@context': [CredentialContext.V1, CredentialContext.V2],
      id: credentialId,
      type: [BSLCredentialType.VerifiableCredential, BSLCredentialType.BitstringStatusListCredential],
      issuer: { id: issuerDID },
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: credentialId,
        type: RevocationListType.Bitstring,
        statusPurpose,
        encodedList: initialBitsEncoded,
      },
      credentialStatus: {
        id: credentialId,
        type: RevocationListType.Bitstring,
      },
    }
  }

  // ─── Endpoints ────────────────────────────────────────────────────────────

  /**
   * Create a Bitstring Status List Credential (BSLC) and upload it to the BSLC server.
   */
  //TODO: Add logic to create initial bitstring based on the input for total credentials supported in the BSLC
  @Post('/create-bslc')
  public async createBitstringStatusListCredential(
    @Request() request: Req,
    @Body() body: { issuerDID: string; statusPurpose: string; verificationMethodId: string },
  ) {
    try {
      const { issuerDID, statusPurpose, verificationMethodId } = body

      const missingField = [['issuerDID', issuerDID], ['statusPurpose', statusPurpose], ['verificationMethodId', verificationMethodId]].find(([, v]) => !v)?.[0]
      if (missingField) throw new BadRequestError(`${missingField} is required`)

      const { serverUrl, apiKey } = this.getBslcConfig()
      if (!process.env.BSLC_ROUTE) throw new InternalServerError('BSLC_ROUTE is not configured')

      const bslcId = utils.uuid()
      const credentialPayload = this.buildBSLCPayload(issuerDID, statusPurpose, bslcId)

      let signedCredential: W3cJsonLdVerifiableCredential
      try {
        const signedResult = await request.agent.w3cCredentials.signCredential({
          credential: credentialPayload as any,
          format: ClaimFormat.LdpVc,
          proofType: BSLSignatureType.Ed25519Signature2018,
          verificationMethod: verificationMethodId,
        })

        if (!('proof' in signedResult)) {
          throw new InternalServerError('Signed result is not a W3cJsonLdVerifiableCredential')
        }
        signedCredential = signedResult as W3cJsonLdVerifiableCredential
      } catch (signingError) {
        throw new InternalServerError(`Failed to sign the BitstringStatusListCredential: ${signingError}`)
      }

      const uploadUrl = `${serverUrl}${process.env.BSLC_ROUTE}${BSLC_ENDPOINT}`
      const bslcPayload: BSLCSignedPayload = {
        id: bslcId,
        bslcObject: signedCredential.toJson() as Record<string, unknown>,
      }

      try {
        await this.apiService.postRequest(uploadUrl, bslcPayload, apiKey)
      } catch (error) {
        throw new InternalServerError(`Error uploading the BitstringStatusListCredential: ${error}`)
      }

      return { signedCredential: signedCredential.toJson(), BSLCId: bslcId }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Get an unused index from the Bitstring Status List Credential.
   *
   * @param bslcUrl URL of the BSLC
   * @param bslcId ID of the BSLC
   * @returns An unused index from the Bitstring Status List
   */
  @Get('/get-empty-bslc-index/:bslcUrl/:bslcId')
  @Example({ index: 132 })
  @Response<BadRequestError>(400, 'Invalid request parameters')
  @Response<InternalServerError>(500, 'Internal server error')
  public async getEmptyIndexForBSLC(
    @Path('bslcUrl') bslcUrl: string,
    @Path('bslcId') bslcId: string,
  ): Promise<{ index: number }> {
    try {
      if (!bslcUrl) throw new BadRequestError('bslcUrl is required')
      if (!bslcId) throw new BadRequestError('bslcId is required')

      const { serverUrl, apiKey } = this.getBslcConfig()
      if (!process.env.BSLC_CREDENTIAL_INDEXES_ROUTE) {
        throw new InternalServerError('BSLC_CREDENTIAL_INDEXES_ROUTE is not configured')
      }
      console.log('Fetching BSLC credential from URL:', bslcUrl)
      const bslcResponse = await this.apiService.getRequest(bslcUrl)
      console.log('BSLC Response::', bslcResponse)
      if (!bslcResponse) throw new InternalServerError('Failed to fetch the Bitstring Status List Credential')
      //TODO: Validate the correct place of encodedList (Might inside claims or credentialSubject based on the implementation of BSLC)
      const encodedList = bslcResponse?.credentialSubject?.encodedList
      if (!encodedList) throw new InternalServerError('Encoded list not found in the credential')

      const bitstring = customInflate(encodedList)
      console.log('Decoded Bitstring:', bitstring)
      const indexesUrl = `${serverUrl}/bslc-server/credentials/indexes/${bslcId}`
      console.log('Fetching used indexes from URL:', indexesUrl)
      let fetchedIndexes: number[] = []
      try {
        const indexResponse = await this.apiService.getRequest(indexesUrl, apiKey)
        if (indexResponse?.data) {
          fetchedIndexes = indexResponse.data
        }
      } catch (error) {
        throw new InternalServerError(
          `Error fetching used credential indexes: ${error instanceof Error ? error.message : error}`,
        )
      }

      const usedIndexes = new Set(fetchedIndexes)
      const unusedIndexes: number[] = []
      for (let i = 0; i < bitstring.length; i++) {
        if (bitstring[i] === '0' && !usedIndexes.has(i)) unusedIndexes.push(i)
      }

      if (unusedIndexes.length === 0) throw new InternalServerError('No unused index found in the BitstringStatusList')

      const randomIndex = unusedIndexes[crypto.getRandomValues(new Uint32Array(1))[0] % unusedIndexes.length]
      return { index: randomIndex }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Revoke or change the status of a W3C credential using its revocationId.
   */
  @Post('/change-status')
  public async changeStatus(
    @Request() request: Req,
    @Body() body: { revocationId: string; credentialId: string },
  ) {
    try {
      const { revocationId, credentialId } = body

      if (!revocationId) throw new BadRequestError('revocationId is required')
      if (!credentialId) throw new BadRequestError('credentialId is required')

      const { serverUrl, apiKey } = this.getBslcConfig()

      // Fetch credential metadata
      const metaResponse = (await this.apiService.getRequest(`${serverUrl}/credentials/${credentialId}`, apiKey)) as {
        data: { data: object }
      }
      if (!metaResponse || typeof metaResponse.data?.data !== 'object') {
        throw new InternalServerError('Failed to fetch the credential details')
      }

      const credentialDetails = metaResponse.data.data as CredentialMetadata
      if (!credentialDetails) throw new InternalServerError('Credential details not found')
      if (!credentialDetails.isValid) throw new BadRequestError('The credential is already revoked')
      if (!credentialDetails.bslcUrl) throw new InternalServerError('bslcUrl not found in credential details')

      // Fetch the existing BSLC credential
      const bslcResponse = await this.apiService.getRequest(credentialDetails.bslcUrl, apiKey)
      if (!bslcResponse?.data) throw new InternalServerError('Invalid response while fetching the BSLC credential')

      const bslcCredential = bslcResponse.data
      if (!bslcCredential?.credentialSubject?.claims?.encodedList) {
        throw new InternalServerError('Invalid BSLC credential: encodedList missing')
      }

      // Flip the bit at the revocation index
      const bitstring = customInflate(bslcCredential.credentialSubject.claims.encodedList)
      const revocationIndex = parseInt(credentialDetails.index.toString(), 10)

      if (isNaN(revocationIndex) || revocationIndex < 0 || revocationIndex >= bitstring.length) {
        throw new BadRequestError('Invalid revocation index: out of range')
      }
      if (bitstring[revocationIndex] === '1') throw new BadRequestError('The credential is already revoked')

      bslcCredential.credentialSubject.claims.encodedList = customDeflate(
        bitstring.substring(0, revocationIndex) + '1' + bitstring.substring(revocationIndex + 1),
      )

      // Re-sign the updated BSLC credential
      let signedCredential
      try {
        signedCredential = await request.agent.w3cCredentials.signCredential<ClaimFormat.LdpVc>({
          credential: bslcCredential as any,
          format: ClaimFormat.LdpVc,
          proofType: bslcCredential.proof?.type ?? BSLSignatureType.Ed25519Signature2018,
          verificationMethod: bslcCredential.proof?.verificationMethod,
        })
      } catch (signingError) {
        throw new InternalServerError(`Failed to re-sign the updated BSLC credential: ${signingError}`)
      }

      // Upload updated BSLC back to the server
      const uploadResponse = await this.apiService.putRequest(
        `${serverUrl}${process.env.BSLC_ROUTE}`,
        signedCredential,
        apiKey,
      )
      if (!uploadResponse?.data) throw new InternalServerError('Failed to upload the updated BSLC credential')

      // Mark the credential as revoked in the BSLC server
      const statusUpdateResponse = await this.apiService.patchRequest(
        `${serverUrl}/credentials/status/${revocationId}`,
        { isValid: false },
        apiKey,
      )
      if (!statusUpdateResponse?.data) {
        throw new InternalServerError('Failed to update the credential status in the BSLC server')
      }

      return statusUpdateResponse
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
