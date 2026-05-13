import type {
  AgentInfo,
  AgentToken,
  SafeW3cJsonLdVerifyCredentialOptions,
  CustomW3cJsonLdSignCredentialOptions,
  SignDataOptions,
  VerifyDataOptions,
} from '../types'

import {
  JsonTransformer,
  W3cJsonLdVerifiableCredential,
  TypedArrayEncoder,
  ClaimFormat,
  W3cCredentialRecord,
  DidDocument,
  verkeyToPublicJwk,
  getKmsKeyIdForVerifiacationMethod,
} from '@credo-ts/core'
import { Request as Req } from 'express'
import jwt from 'jsonwebtoken'
import { Controller, Get, Route, Tags, Security, Request, Post, Body, Query } from 'tsoa'
import { injectable } from 'tsyringe'

import { AgentRole, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError } from '../../errors/errors'
import { ALGORITHM_MAP } from '../../utils/constant'

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
      // TODO: Need to update this config payload based on modules like didcom amd openid4vc
      return {
        label: request.agent.context.contextCorrelationId,
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
   * Verify data using a key
   *
   * @param body Verify options
   *  data - Data has to be in base64 format
   *  publicKeyBase58 - Public key in base58 format
   *  signature - Signature in base64 format
   * @returns isValidSignature - true if signature is valid, false otherwise
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/verify')
  public async verify(@Request() request: Req, @Body() body: VerifyDataOptions): Promise<{ verified: boolean }> {
    try {
      if (!body.data || !body.signature || !body.publicKeyBase58 || !body.keyType) {
        throw new BadRequestError(
          'Missing required fields: data, signature, publicKeyBase58, and keyType are required.',
        )
      }

      // Convert verkey to JWK
      const publicJwkWrapper = verkeyToPublicJwk(body.publicKeyBase58)
      const publicJwk = (publicJwkWrapper as any).jwk?.jwk ?? (publicJwkWrapper as any).jwk ?? publicJwkWrapper

      const result = await request.agent.kms.verify({
        data: TypedArrayEncoder.fromBase64(body.data),
        signature: TypedArrayEncoder.fromBase64(body.signature),
        key: {
          publicJwk: publicJwk as any,
        },
        algorithm: (ALGORITHM_MAP[body.keyType.toLowerCase()] || body.keyType) as any,
      })

      return { verified: result.verified }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Sign credential or raw data
   */
  @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
  @Post('/credential/sign')
  public async signCredential(
    @Request() request: Req,
    @Query('storeCredential') storeCredential: boolean,
    @Query('dataTypeToSign') dataTypeToSign: 'rawData' | 'jsonLd',
    @Body() body: CustomW3cJsonLdSignCredentialOptions | SignDataOptions,
  ) {
    try {
      const typeToSign = (dataTypeToSign || 'rawData').toLowerCase()
      request.agent.config.logger.info(
        `[SignCredential] dataTypeToSign: ${dataTypeToSign}, typeToSign: ${typeToSign}, storeCredential: ${storeCredential}`,
      )

      if (typeToSign === 'jsonld') {
        return await this.signJsonLd(request, body as CustomW3cJsonLdSignCredentialOptions, storeCredential)
      }

      return await this.signRawData(request, body as SignDataOptions)
    } catch (error) {
      const err = error as any
      request.agent.config.logger.error(`[SignCredential] Error: ${err.message}`, { stack: err.stack })
      throw ErrorHandlingService.handle(error)
    }
  }

  private async signJsonLd(request: Req, body: CustomW3cJsonLdSignCredentialOptions, storeCredential: boolean) {
    const credentialData = body as any

    // Ensure signerOptions is populated if top-level fields are provided
    if (!credentialData.signerOptions && (credentialData.verificationMethod || credentialData.proofType)) {
      credentialData.signerOptions = {
        verificationMethod: credentialData.verificationMethod,
        type: credentialData.proofType,
        method: 'did', // default to did if not specified
      }
    }

    credentialData.format = ClaimFormat.LdpVc
    const signedCredential = (await request.agent.w3cCredentials.signCredential(
      credentialData,
    )) as W3cJsonLdVerifiableCredential

    if (storeCredential) {
      const record = W3cCredentialRecord.fromCredential(signedCredential)
      return await request.agent.w3cCredentials.store({ record })
    }
    return signedCredential.toJson()
  }

  private async signRawData(request: Req, body: SignDataOptions) {
    if (!body.data) throw new BadRequestError('Missing "data" for raw data signing.')

    const kmsKeyId = await this.resolveKmsKeyId(request, body)

    const signature = await request.agent.kms.sign({
      data: TypedArrayEncoder.fromBase64(body.data),
      keyId: kmsKeyId as string,
      algorithm: (body.keyType ? ALGORITHM_MAP[body.keyType.toLowerCase()] || body.keyType : 'EdDSA') as any,
    })

    return TypedArrayEncoder.toBase64(signature.signature)
  }

  private async resolveKmsKeyId(request: Req, body: SignDataOptions): Promise<string> {
    const hasDidOrMethod = body.did || body.method
    const hasPublicKey = body.publicKeyBase58 && body.keyType
    if (!hasDidOrMethod && !hasPublicKey) {
      throw new BadRequestError('Either (did or method) OR (publicKeyBase58 and keyType) must be provided.')
    }

    if (!hasDidOrMethod) {
      return body.publicKeyBase58
    }

    let kmsKeyId: string | undefined = undefined
    let didDocument: DidDocument | undefined | null = undefined

    const dids = await request.agent.dids.getCreatedDids({
      method: body.method || undefined,
      did: body.did || undefined,
    })

    const didRecord = dids[0]
    if (didRecord) {
      didDocument = didRecord.didDocument
      if (didRecord.keys && didRecord.keys.length > 0) {
        kmsKeyId = didRecord.keys[0].kmsKeyId
      }
    }

    if (!didDocument && body.did) {
      const resolution = await request.agent.dids.resolve(body.did)
      didDocument = resolution.didDocument
    }

    if (!didDocument) {
      throw new BadRequestError('No DID document found.')
    }

    if (!kmsKeyId) {
      const verificationMethod = didDocument.verificationMethod?.[0]
      if (!verificationMethod) {
        throw new BadRequestError('No verification method found on DID document.')
      }

      // Try multiple ways to get the kmsKeyId
      const derivedKeyId = getKmsKeyIdForVerifiacationMethod(verificationMethod)
      const publicKeyBase58 = (verificationMethod as any).publicKeyBase58
      const vmId = verificationMethod.id || ''
      const idPart = vmId.includes('#') ? vmId.split('#')[1] : undefined

      kmsKeyId = (derivedKeyId || publicKeyBase58 || idPart || vmId) as string

      request.agent.config.logger.info(`[SignCredential] Resolved kmsKeyId via fallback: ${kmsKeyId}`)
    }

    return kmsKeyId
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
