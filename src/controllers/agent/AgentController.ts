import type { RestAgentModules } from '../../cliAgent'
import type {
  AgentInfo,
  AgentToken,
  CustomW3cJsonLdSignCredentialOptions,
  SafeW3cJsonLdVerifyCredentialOptions,
  SignDataOptions,
  VerifyDataOptions,
} from '../types'

import { assertAskarWallet } from '@credo-ts/askar/build/utils/assertAskarWallet'
import {
  Agent,
  ClaimFormat,
  JsonTransformer,
  Key,
  TypedArrayEncoder,
  W3cJsonLdSignCredentialOptions,
  W3cJsonLdVerifiableCredential,
} from '@credo-ts/core'
import { Request as Req } from 'express'
import jwt from 'jsonwebtoken'
import { Controller, Delete, Get, Route, Tags, Security, Request, Post, Body, Path, Query } from 'tsoa'
import { injectable } from 'tsyringe'

import { AgentRole, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError } from '../../errors'

@Tags('Agent')
@Route('/agent')
@injectable()
export class AgentController extends Controller {
  /**
   * Retrieve basic agent information
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT, SCOPES.MULTITENANT_BASE_AGENT])
  @Get('/')
  public async getAgentInfo(@Request() request: Req): Promise<AgentInfo> {
    try {
      return {
        label: request.agent.config.label,
        endpoints: request.agent.modules.didcomm.config.endpoints,
        isInitialized: request.agent.isInitialized,
        publicDid: undefined,
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve agent token
   */
  @Post('/token')
  @Security('apiKey')
  public async getAgentToken(@Request() request: Req): Promise<AgentToken> {
    let token
    const genericRecords = await request.agent.genericRecords.findAllByQuery({ hasSecretKey: 'true' })
    const secretKey = genericRecords[0]?.content.secretKey as string
    if (!secretKey) {
      throw new Error('SecretKey not found')
    }
    if (!('tenants' in request.agent.modules)) {
      token = jwt.sign({ role: AgentRole.RestRootAgent }, secretKey)
    } else {
      token = jwt.sign({ role: AgentRole.RestRootAgentWithTenants }, secretKey)
    }
    return {
      token: token,
    }
  }

  /**
   * Delete wallet
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Delete('/wallet')
  public async deleteWallet(@Request() request: Req) {
    try {
      const deleteWallet = await request.agent.wallet.delete()
      return deleteWallet
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Verify data using a key
   *
   * @param tenantId Tenant identifier
   * @param request Verify options
   *  data - Data has to be in base64 format
   *  publicKeyBase58 - Public key in base58 format
   *  signature - Signature in base64 format
   * @returns isValidSignature - true if signature is valid, false otherwise
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/verify')
  public async verify(@Request() request: Req, @Body() body: VerifyDataOptions) {
    try {
      assertAskarWallet(request.agent.context.wallet)
      const isValidSignature = await request.agent.context.wallet.verify({
        data: TypedArrayEncoder.fromBase64(body.data),
        key: Key.fromPublicKeyBase58(body.publicKeyBase58, body.keyType),
        signature: TypedArrayEncoder.fromBase64(body.signature),
      })
      return isValidSignature
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  //Triage: Do we want the BW to be able to sign and verify as well?
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/credential/sign')
  public async signCredential(
    @Request() request: Req,
    @Query('storeCredential') storeCredential: boolean,
    @Query('dataTypeToSign') dataTypeToSign: 'rawData' | 'jsonLd',
    @Body() data: CustomW3cJsonLdSignCredentialOptions | SignDataOptions | unknown,
  ) {
    try {
      // JSON-LD VC Signing
      if (dataTypeToSign === 'jsonLd') {
        const credentialData = data as unknown as W3cJsonLdSignCredentialOptions
        credentialData.format = ClaimFormat.LdpVc
        const signedCredential = (await request.agent.w3cCredentials.signCredential(
          credentialData,
        )) as W3cJsonLdVerifiableCredential
        if (storeCredential) {
          return await request.agent.w3cCredentials.storeCredential({ credential: signedCredential })
        }
        return signedCredential.toJson()
      }

      // Raw Data Signing
      const rawData = data as SignDataOptions
      if (!rawData.data) throw new BadRequestError('Missing "data" for raw data signing.')

      const hasDidOrMethod = rawData.did || rawData.method
      const hasPublicKey = rawData.publicKeyBase58 && rawData.keyType
      if (!hasDidOrMethod && !hasPublicKey) {
        throw new BadRequestError('Either (did or method) OR (publicKeyBase58 and keyType) must be provided.')
      }

      let keyToUse: Key
      if (hasDidOrMethod) {
        const dids = await request.agent.dids.getCreatedDids({
          method: rawData.method || undefined,
          did: rawData.did || undefined,
        })
        const verificationMethod = dids[0]?.didDocument?.verificationMethod?.[0]?.publicKeyBase58
        if (!verificationMethod) {
          throw new BadRequestError('No publicKeyBase58 found for the given DID or method.')
        }
        keyToUse = Key.fromPublicKeyBase58(verificationMethod, rawData.keyType)
      } else {
        keyToUse = Key.fromPublicKeyBase58(rawData.publicKeyBase58, rawData.keyType)
      }

      if (!keyToUse) {
        throw new Error('Unable to construct signing key. ')
      }

      const signature = await request.agent.context.wallet.sign({
        data: TypedArrayEncoder.fromBase64(rawData.data),
        key: keyToUse,
      })

      return TypedArrayEncoder.toBase64(signature)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/credential/verify')
  public async verifyCredential(
    @Request() request: Req,
    @Body() credentialToVerify: SafeW3cJsonLdVerifyCredentialOptions | any,
  ) {
    try {
      const { credential, ...credentialOptions } = credentialToVerify
      const transformedCredential = JsonTransformer.fromJSON(
        credentialToVerify?.credential,
        W3cJsonLdVerifiableCredential,
      )
      const signedCred = await request.agent.w3cCredentials.verifyCredential({
        credential: transformedCredential,
        ...credentialOptions,
      })
      return signedCred
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
