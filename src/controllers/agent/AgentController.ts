import type { 
  AgentInfo, 
  AgentToken, 
  SafeW3cJsonLdVerifyCredentialOptions, 
  CustomW3cJsonLdSignCredentialOptions, 
  SignDataOptions,
  VerifyDataOptions
} from '../types'

import { 
  JsonTransformer, 
  W3cJsonLdVerifiableCredential, 
  TypedArrayEncoder, 
  ClaimFormat, 
  W3cCredentialRecord,
  DidDocument,
  verkeyToPublicJwk
} from '@credo-ts/core'
import { getKmsKeyIdForVerifiacationMethod } from '@credo-ts/core'
import { Request as Req } from 'express'
import jwt from 'jsonwebtoken'
import { Controller, Get, Route, Tags, Security, Request, Post, Body, Query } from 'tsoa'
import { injectable } from 'tsyringe'

import { AgentRole, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError } from '../../errors/errors'

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
  public async verify(@Request() request: Req, @Body() body: VerifyDataOptions) {
    try {
      const algorithmMap: Record<string, string> = {
        'ed25519': 'EdDSA',
        'p256': 'ES256',
        'secp256k1': 'ES256K'
      }

      // Convert verkey to JWK
      const publicJwkWrapper = verkeyToPublicJwk(body.publicKeyBase58) as any
      const publicJwk = publicJwkWrapper.jwk?.jwk || publicJwkWrapper.jwk || publicJwkWrapper

      const result = await request.agent.kms.verify({
        data: TypedArrayEncoder.fromBase64(body.data),
        signature: TypedArrayEncoder.fromBase64(body.signature),
        key: {
          publicJwk: publicJwk as any
        },
        algorithm: (algorithmMap[body.keyType.toLowerCase()] || body.keyType) as any
      })
      
      return result.verified
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
    @Query('dataTypeToSign') dataTypeToSign: 'rawData' | 'jsonLd' | string,
    @Body() data: any,
  ) {
    try {
      const typeToSign = (dataTypeToSign || 'rawData').toLowerCase()
      request.agent.config.logger.info(`[SignCredential] dataTypeToSign: ${dataTypeToSign}, typeToSign: ${typeToSign}, storeCredential: ${storeCredential}`);

      // JSON-LD VC Signing
      if (typeToSign === 'jsonld') {
        const credentialData = data as any
        
        // Ensure signerOptions is populated if top-level fields are provided
        if (!credentialData.signerOptions && (credentialData.verificationMethod || credentialData.proofType)) {
          credentialData.signerOptions = {
            verificationMethod: credentialData.verificationMethod,
            type: credentialData.proofType,
            method: 'did' // default to did if not specified
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

      // Raw Data Signing
      const rawData = data as SignDataOptions
      if (!rawData.data) throw new BadRequestError('Missing "data" for raw data signing.')

      const hasDidOrMethod = rawData.did || rawData.method
      const hasPublicKey = rawData.publicKeyBase58 && rawData.keyType
      if (!hasDidOrMethod && !hasPublicKey) {
        throw new BadRequestError('Either (did or method) OR (publicKeyBase58 and keyType) must be provided.')
      }

      let kmsKeyId: string | undefined = undefined
      if (hasDidOrMethod) {
        let didDocument: DidDocument | undefined | null = undefined
        const dids = await request.agent.dids.getCreatedDids({
          method: rawData.method || undefined,
          did: rawData.did || undefined,
        })
        
        const didRecord = dids[0]
        if (didRecord) {
          didDocument = didRecord.didDocument
          if (didRecord.keys && didRecord.keys.length > 0) {
            kmsKeyId = didRecord.keys[0].kmsKeyId
          }
        }

        if (!didDocument && rawData.did) {
          const resolution = await request.agent.dids.resolve(rawData.did)
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
          
          request.agent.config.logger.info(`[SignCredential] Resolved kmsKeyId via fallback: ${kmsKeyId}`);
        }
      } else {
        kmsKeyId = rawData.publicKeyBase58
      }

      const algorithmMap: Record<string, string> = {
        'ed25519': 'EdDSA',
        'p256': 'ES256',
        'secp256k1': 'ES256K'
      }

      const signature = await request.agent.kms.sign({
        data: TypedArrayEncoder.fromBase64(rawData.data),
        keyId: kmsKeyId as string,
        algorithm: (rawData.keyType ? (algorithmMap[rawData.keyType.toLowerCase()] || rawData.keyType) : 'EdDSA') as any
      })

      return TypedArrayEncoder.toBase64(signature.signature)
    } catch (error) {
      const err = error as any
      request.agent.config.logger.error(`[SignCredential] Error: ${err.message}`, { stack: err.stack });
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
