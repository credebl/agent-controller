import type { DidResolutionResultProps } from '../types'
import type { PolygonDidCreateOptions } from '@ayanworks/credo-polygon-w3c-module/build/dids/PolygonDidRegistrar.mjs'
import type { DidDocument, KeyDidCreateOptions, PeerDidNumAlgo2CreateOptions } from '@credo-ts/core'

import { openBaoKeyId } from '@credebl/credo-ts-openbao'
import { transformPrivateKeyToPrivateJwk, transformSeedToPrivateJwk } from '@credo-ts/askar'
import {
  TypedArrayEncoder,
  DidDocumentBuilder,
  getEd25519VerificationKey2018,
  getEd25519VerificationKey2020,
  getJsonWebKey2020,
  SECURITY_ED25519_2018_CONTEXT_URL,
  SECURITY_ED25519_2020_CONTEXT_URL,
  SECURITY_JWS_CONTEXT_URL,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
  createPeerDidDocumentFromServices,
  PeerDidNumAlgo,
  Kms,
  Hasher,
  LogLevel,
  Agent,
  DidKey,
} from '@credo-ts/core'
import { Key, KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'
import axios from 'axios'
import { Request as Req } from 'express'
import { createPublicKey } from 'node:crypto'
import { Body, Controller, Example, Get, Path, Post, Route, Tags, Security, Request } from 'tsoa'
import { injectable } from 'tsyringe'
import { container } from 'tsyringe'

import { RestMultiTenantAgentModules } from '../../cliAgent'
import { DidMethod, KeyAlgorithmCurve, Network, Role, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError, InternalServerError } from '../../errors'
import { AgentType } from '../../types'
import { keyAlgorithmToCurve, p521, verkey } from '../../utils/constant'
import { getTypeFromCurve } from '../../utils/helpers'
import { needsNodeKms, NODE_KMS_BACKEND, selectKmsBackendForJwk } from '../../utils/kms/backend'
import {
  OPENBAO_KMS_BACKEND,
  openBaoBackendForCreate,
  openBaoBackendForDidMethod,
  openBaoBackendForJwk,
  openBaoKeyIdForPrivateJwk,
} from '../../utils/kms/openBao'
import { CreateDidResponse, Did, DidRecordExample } from '../examples'
import { DidCreate, supportedKeyTypesDID } from '../types'
import { didX509Service } from '../x509/didX509.service'
import { parsePrivateKey, parsePrivateKeyJwk, privateKeyToJwk } from '../x509/didX509.utils'
import { DidX509ImportOptionsDto } from '../x509/x509.types'

@Tags('Dids')
@Route('/dids')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@injectable()
export class DidController extends Controller {
  /**
   * Resolves did and returns did resolution result
   * @param did Decentralized Identifier
   * @returns DidResolutionResult
   */
  private agent = container.resolve(Agent<RestMultiTenantAgentModules>)

  @Example<DidResolutionResultProps>(DidRecordExample)
  @Get('/:did')
  public async getDidRecordByDid(@Request() request: Req, @Path('did') did: Did) {
    try {
      const resolveResult = await request.agent.dids.resolve(did)
      const importDid = await request.agent.dids.import({
        did,
        overwrite: true,
      })
      if (!resolveResult.didDocument) {
        throw new InternalServerError(`Error resolving DID docs for did: ${importDid}`)
      }

      return { ...resolveResult, didDocument: resolveResult.didDocument.toJSON() }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Did nym registration
   * @body DidCreateOptions
   * @returns DidResolutionResult
   */
  // @Example<DidResolutionResultProps>(DidRecordExample)
  @Example(CreateDidResponse)
  @Post('/write')
  public async writeDid(@Request() request: Req, @Body() createDidOptions: DidCreate) {
    let didRes

    try {
      if (!createDidOptions.method) {
        throw new BadRequestError('Method is required')
      }

      let result
      switch (createDidOptions.method) {
        case DidMethod.Indy:
          result = await this.handleIndy(request.agent, createDidOptions)
          break

        case DidMethod.Key:
          result = await this.handleKey(request.agent, createDidOptions)
          break

        case DidMethod.Web:
          result = await this.handleWeb(request.agent, createDidOptions)
          break

        case DidMethod.Polygon:
          result = await this.handlePolygon(request.agent, createDidOptions)
          break

        case DidMethod.Peer:
          result = await this.handleDidPeer(request.agent, createDidOptions)
          break

        default:
          throw new BadRequestError(`Invalid method: ${createDidOptions.method}`)
      }

      didRes = { ...result }

      return didRes
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  private async handleDidPeer(agent: AgentType, createDidOptions: DidCreate) {
    let didResponse
    let did

    if (!createDidOptions.keyType) {
      throw Error('keyType is required')
    }

    const didRouting = await agent.modules.didcomm.mediationRecipient.getRouting({})
    const { didDocument, keys } = createPeerDidDocumentFromServices(
      [
        {
          id: 'didcomm',
          recipientKeys: [didRouting.recipientKey],
          routingKeys: didRouting.routingKeys,
          serviceEndpoint: didRouting.endpoints[0],
        },
      ],
      true,
    )

    const didPeerResponse = await agent.dids.create<PeerDidNumAlgo2CreateOptions>({
      didDocument,
      method: DidMethod.Peer,
      options: {
        numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
        keys,
      },
    })

    did = didPeerResponse.didState.did
    didResponse = {
      did,
    }
    return didResponse
  }

  private async handleIndy(agent: AgentType, createDidOptions: DidCreate) {
    let result
    if (!createDidOptions.keyType) {
      throw new BadRequestError('keyType is required')
    }

    if (!createDidOptions.network) {
      throw new BadRequestError('For indy method network is required')
    }

    if (createDidOptions.keyType !== KeyAlgorithm.Ed25519) {
      throw new BadRequestError('Only ed25519 key type supported')
    }

    if (!Object.values(Network).includes(createDidOptions.network as Network)) {
      throw new BadRequestError(`Invalid network for 'indy' method: ${createDidOptions.network}`)
    }

    switch (createDidOptions?.network?.toLowerCase()) {
      case Network.Bcovrin_Testnet:
        result = await this.handleBcovrin(
          agent,
          createDidOptions,
          `did:${createDidOptions.method}:${createDidOptions.network}`,
        )
        break

      case Network.Indicio_Demonet:
      case Network.Indicio_Testnet:
        result = await this.handleIndicio(
          agent,
          createDidOptions,
          `did:${createDidOptions.method}:${createDidOptions.network}`,
        )
        break

      default:
        throw new BadRequestError(`Network does not exists`)
    }
    return result
  }

  private async handleBcovrin(agent: AgentType, createDidOptions: DidCreate, didMethod: string) {
    let didDocument
    if (!createDidOptions.seed) {
      throw new BadRequestError('Seed is required')
    }
    if (createDidOptions?.role?.toLowerCase() === Role.Endorser) {
      if (createDidOptions.did) {
        // Hint: Bcovrin uses seed as private key when creating key. But seed is written as a NYM transaction
        // Triage: Make sure what to use, seed or privateKey when accepting from API itself
        await this.importDid(agent, didMethod, createDidOptions.did, '', createDidOptions.seed)
        const getDid = await agent.dids.getCreatedDids({
          method: createDidOptions.method,
          did: `did:${createDidOptions.method}:${createDidOptions.network}:${createDidOptions.did}`,
        })
        if (getDid.length > 0) {
          didDocument = getDid[0].didDocument
        }

        return {
          did: `${didMethod}:${createDidOptions.did}`,
          didDocument: didDocument,
        }
      } else {
        if (!process.env.BCOVRIN_REGISTER_URL) {
          throw new InternalServerError('BCOVRIN_REGISTER_URL is not set in environment variables')
        }
        const BCOVRIN_REGISTER_URL = process.env.BCOVRIN_REGISTER_URL as string
        const res = await axios.post(BCOVRIN_REGISTER_URL, {
          role: 'ENDORSER',
          alias: 'Alias',
          seed: createDidOptions.seed,
        })
        const { did } = res?.data || {}
        await this.importDid(agent, didMethod, did, '', createDidOptions.seed)
        const didRecord = await agent.dids.getCreatedDids({
          method: DidMethod.Indy,
          did: `did:${DidMethod.Indy}:${Network.Bcovrin_Testnet}:${res.data.did}`,
        })

        if (didRecord.length > 0) {
          didDocument = didRecord[0].didDocument
        }

        return {
          did: `${didMethod}:${res.data.did}`,
          didDocument: didDocument,
        }
      }
    } else {
      if (!createDidOptions.endorserDid) {
        throw new BadRequestError('Please provide the endorser DID or role')
      }
      const didCreateTxResult = await this.createEndorserDid(agent, createDidOptions.endorserDid)
      return { did: didCreateTxResult.didState.did, didDocument: didCreateTxResult.didState.didDocument }
    }
  }

  private async handleIndicio(agent: AgentType, createDidOptions: DidCreate, didMethod: string) {
    let didDocument
    if (!createDidOptions.seed) {
      throw new BadRequestError('Seed is required')
    }
    if (createDidOptions?.role?.toLowerCase() === Role.Endorser) {
      if (createDidOptions.did) {
        await this.importDid(agent, didMethod, createDidOptions.did, createDidOptions.seed)
        const didRecord = await agent.dids.getCreatedDids({
          method: createDidOptions.method,
          did: `did:${createDidOptions.method}:${createDidOptions.network}:${createDidOptions.did}`,
        })

        if (didRecord.length > 0) {
          didDocument = didRecord[0].didDocument
        }

        return {
          did: `${didMethod}:${createDidOptions.did}`,
          didDocument: didDocument,
        }
      } else {
        const { keyId, ...key } = await this.createIndicioKey(agent, createDidOptions)
        const INDICIO_NYM_URL = process.env.INDICIO_NYM_URL as string
        const res = await axios.post(INDICIO_NYM_URL, key)
        if (res.data.statusCode === 200) {
          await this.importDid(agent, didMethod, key.did, createDidOptions.seed, undefined, keyId)
          const didRecord = await agent.dids.getCreatedDids({
            method: DidMethod.Indy,
            did: `${didMethod}:${key.did}`,
          })

          if (didRecord.length > 0) {
            didDocument = didRecord[0].didDocument
          }

          return {
            did: `${didMethod}:${key.did}`,
            didDocument: didDocument,
          }
        } else {
          throw new InternalServerError(
            `Failed to register DID with Indicio: ${res.data.message || res.data.body || 'Unknown error'}`,
          )
        }
      }
    } else {
      if (!createDidOptions.endorserDid) {
        throw new BadRequestError('Please provide the endorser DID or role')
      }
      const didCreateTxResult = await this.createEndorserDid(agent, createDidOptions.endorserDid)
      return didCreateTxResult
    }
  }

  private async createEndorserDid(agent: AgentType, endorserDid: string) {
    return agent.dids.create({
      method: 'indy',
      options: {
        endorserMode: 'external',
        endorserDid: endorserDid || '',
      },
    })
  }

  private async createIndicioKey(agent: AgentType, createDidOptions: DidCreate) {
    if (!createDidOptions.seed) {
      throw new BadRequestError('Seed is required')
    }
    // TODO: Remove comments afterwards
    // const key = await agent.kms.createKey({
    //     privateKey: TypedArrayEncoder.fromUtf8String(createDidOptions.seed),
    //     keyType: KeyAlgorithm.Ed25519,
    // })

    // const buffer = TypedArrayEncoder.fromBase58(key.publicKeyBase58)
    // const did = TypedArrayEncoder.toBase58(buffer.slice(0, 16))

    const privateJwk = transformSeedToPrivateJwk({
      seed: TypedArrayEncoder.fromUtf8String(createDidOptions.seed),
      type: {
        crv: 'Ed25519',
        kty: 'OKP',
      },
    }).privateJwk

    const key = await agent.kms.importKey({
      privateJwk,
    })

    const verificationKey = Kms.PublicJwk.fromPublicJwk(key.publicJwk) as Kms.PublicJwk<Kms.Ed25519PublicJwk>

    // Create a new key and calculate did according to the rules for indy did method
    const publicKeyBytes = verificationKey.publicKey.publicKey

    const did = TypedArrayEncoder.toBase58(publicKeyBytes.slice(0, 16))

    let body
    if (createDidOptions.network === Network.Indicio_Testnet) {
      body = {
        network: 'testnet',
        did,
        verkey: TypedArrayEncoder.toBase58(publicKeyBytes),
        keyId: key.keyId,
      }
    } else if (createDidOptions.network === Network.Indicio_Demonet) {
      body = {
        network: 'demonet',
        did,
        verkey: TypedArrayEncoder.toBase58(publicKeyBytes),
        keyId: key.keyId,
      }
    } else {
      throw new BadRequestError('Please provide a valid did method')
    }
    return body
  }

  private async importDid(
    agent: AgentType,
    didMethod: string,
    did: string,
    seed: string,
    privateKey?: string,
    keyId?: string,
  ) {
    let _keyId: string

    if (!keyId) {
      const { privateJwk } = privateKey
        ? transformPrivateKeyToPrivateJwk({
            type: {
              crv: 'Ed25519',
              kty: 'OKP',
            },
            privateKey: TypedArrayEncoder.fromUtf8String(privateKey),
          })
        : seed
          ? transformSeedToPrivateJwk({
              seed: TypedArrayEncoder.fromUtf8String(seed),
              type: {
                crv: 'Ed25519',
                kty: 'OKP',
              },
            })
          : {
              privateJwk: undefined,
            }

      if (!privateJwk) {
        throw new Error('Either privateKey or seed is required')
      }

      const key = await agent.kms.importKey({ privateJwk })
      _keyId = key.keyId
    } else {
      _keyId = keyId
    }

    const completeDid = `${didMethod}:${did}`
    await agent.dids.import({
      did: completeDid,
      keys: [
        {
          kmsKeyId: _keyId,
          didDocumentRelativeKeyId: verkey,
        },
      ],
    })
  }
  /**
   * `did:key` and `did:web` accept an existing private key instead of deriving one from a seed. The key can be a PEM /
   * base64 DER string (`privateKey`) or a JWK (`privateKeyJwk`).
   */
  private hasImportedPrivateKey(didOptions: DidCreate): boolean {
    return Boolean(didOptions.privateKey || didOptions.privateKeyJwk)
  }

  private readImportedPrivateKey(didOptions: DidCreate): Kms.KmsJwkPrivate {
    if (didOptions.privateKey && didOptions.privateKeyJwk) {
      throw new BadRequestError('Provide either privateKey or privateKeyJwk, not both')
    }

    const privateKey = didOptions.privateKeyJwk
      ? parsePrivateKeyJwk(didOptions.privateKeyJwk)
      : didOptions.privateKey?.trim().startsWith('{')
        ? parsePrivateKeyJwk(didOptions.privateKey)
        : parsePrivateKey(didOptions.privateKey as string, didOptions.passphrase)

    return privateKeyToJwk(privateKey) as Kms.KmsJwkPrivate
  }

  /**
   * `did:key` can represent the key types Credo knows how to embed in a did:key document. `did:web` publishes a
   * JsonWebKey2020 verification method, so it additionally accepts RSA keys. X25519 cannot sign and is therefore not
   * accepted for did:web.
   */
  private assertImportedKeySupported(method: 'key' | 'web', jwk: { kty: string; crv?: string }): void {
    const description = jwk.crv ? `${jwk.kty} ${jwk.crv}` : jwk.kty

    if (method === 'key') {
      const supported = supportedKeyTypesDID[DidMethod.Key].some(
        (keyType) => keyType.kty === jwk.kty && keyType.crv === jwk.crv,
      )
      if (!supported) {
        throw new BadRequestError(
          `did:key cannot be created from a ${description} key. Supported key types are Ed25519, X25519, P-256, P-384, P-521 and secp256k1. Use did:web or did:x509 for RSA keys.`,
        )
      }
      return
    }

    const supportedWebKeyTypes: { kty: string; crv?: string }[] = [
      { kty: 'OKP', crv: 'Ed25519' },
      { kty: 'EC', crv: 'P-256' },
      { kty: 'EC', crv: 'P-384' },
      { kty: 'EC', crv: 'P-521' },
      { kty: 'EC', crv: 'secp256k1' },
      { kty: 'RSA' },
    ]
    const supported = supportedWebKeyTypes.some(
      (keyType) => keyType.kty === jwk.kty && (keyType.crv === undefined || keyType.crv === jwk.crv),
    )
    if (!supported) {
      throw new BadRequestError(
        `did:web cannot be created from a ${description} key. Supported key types are Ed25519, P-256, P-384, P-521, secp256k1 and RSA.`,
      )
    }
  }

  /**
   * OpenBao only holds did:key / did:web keys when the matching opt-in flag is enabled. Otherwise Askar handles the key,
   * except for key types it cannot sign with, which go to the Node KMS.
   */
  private importedKeyBackend(method: 'key' | 'web', jwk: { kty: string; crv?: string }): string | undefined {
    const selection = selectKmsBackendForJwk(jwk)
    if (selection.name !== OPENBAO_KMS_BACKEND || openBaoBackendForDidMethod(method)) {
      return selection.backend
    }
    return needsNodeKms(jwk) ? NODE_KMS_BACKEND : undefined
  }

  private firstVerificationMethodId(didDocument: DidDocument): string | undefined {
    const verificationMethod = didDocument.verificationMethod?.[0]
    if (verificationMethod) {
      return typeof verificationMethod === 'string' ? verificationMethod : verificationMethod.id
    }

    const keyAgreement = didDocument.keyAgreement?.[0]
    if (keyAgreement) {
      return typeof keyAgreement === 'string' ? keyAgreement : keyAgreement.id
    }

    return undefined
  }

  private validateDidKeyOptions(didOptions: DidCreate): void {
    // The key material determines the DID when an existing key is imported, so `keyType` is not required then.
    if (this.hasImportedPrivateKey(didOptions)) {
      return
    }

    if (!didOptions.keyType) {
      throw new BadRequestError('keyType is required')
    }
    if (didOptions.keyType === KeyAlgorithm.Bls12381G2) {
      throw new BadRequestError('didOptions.keyType for type "bls12381g2" has been deprecated')
    }
    if (didOptions.keyType === (p521 as KeyAlgorithm)) {
      throw new BadRequestError('didOptions.keyType for type p521 is not supported')
    }

    const normalizedCurve = keyAlgorithmToCurve[didOptions.keyType as KeyAlgorithm]
    if (!(normalizedCurve && supportedKeyTypesDID[DidMethod.Key]?.some((kt) => kt.crv === normalizedCurve))) {
      throw new BadRequestError(`Invalid keyType: ${didOptions.keyType}`)
    }
  }

  /**
   * Imports a private JWK into the selected backend. OpenBao imports use the public key thumbprint as the key id so
   * importing the same key twice (for example re-creating a did:web from the same seed) reuses the existing Transit
   * key instead of leaving an orphaned duplicate behind.
   */
  private async importKey(
    agent: AgentType,
    privateJwk: Kms.KmsJwkPrivate,
    backend?: string,
  ): Promise<{ keyId: string; publicJwk: Kms.KmsJwkPublicAsymmetric }> {
    if (!backend) {
      const imported = await agent.kms.importKey({ privateJwk })
      return { keyId: imported.keyId, publicJwk: imported.publicJwk as Kms.KmsJwkPublicAsymmetric }
    }

    const thumbprint = openBaoKeyIdForPrivateJwk(privateJwk)
    try {
      const imported = await agent.kms.importKey({
        privateJwk: { ...privateJwk, kid: thumbprint },
        backend,
      })
      return { keyId: imported.keyId, publicJwk: imported.publicJwk as Kms.KmsJwkPublicAsymmetric }
    } catch (error) {
      if (!(error instanceof Kms.KeyManagementKeyExistsError)) throw error
      // The key was imported before. Its id is the thumbprint, prefixed when it lives in OpenBao.
      const keyId = backend === OPENBAO_KMS_BACKEND ? openBaoKeyId(thumbprint) : thumbprint
      const publicJwk = (await agent.kms.getPublicKey({ keyId })) as Kms.KmsJwkPublicAsymmetric
      return { keyId, publicJwk }
    }
  }

  private async createKeyDidFromSeed(
    agent: AgentType,
    didOptions: DidCreate,
    keyType: KeyAlgorithm,
  ): Promise<{ did: string; didDocument: DidDocument }> {
    this.agent.config.logger.info('Creating DID:key with provided seed')
    const privateJwk = transformPrivateKeyToPrivateJwk({
      privateKey: TypedArrayEncoder.fromUtf8String(didOptions.seed as string),
      type: getTypeFromCurve(keyType),
    }).privateJwk

    const openBao = openBaoBackendForDidMethod('key')
    const backend = openBao && openBaoBackendForJwk(privateJwk) ? openBao : undefined
    const { keyId, publicJwk } = await this.importKey(agent, privateJwk, backend)

    this.agent.config.logger.info(`This is keyId:::::: ${keyId}`)
    const publicKey = Kms.PublicJwk.fromPublicJwk(publicJwk)

    const didKey = new DidKey(publicKey)
    const didDocument = didKey.didDocument
    const did = didDocument.id

    const verificationMethodId = didDocument.verificationMethod?.[0]?.id
    const relativeKeyId = verificationMethodId?.split('#')[1]

    this.agent.config.logger.info(`This is did:::::: ${did}`)
    this.agent.config.logger.info(`This is verificationMethodId:::::: ${verificationMethodId}`)

    await agent.dids.import({
      did,
      didDocument,
      overwrite: true,
      keys: [
        {
          didDocumentRelativeKeyId: `#${relativeKeyId}`,
          kmsKeyId: keyId,
        },
      ],
    })

    return { did, didDocument }
  }

  private async createKeyDidFromPrivateKey(
    agent: AgentType,
    didOptions: DidCreate,
  ): Promise<{ did: string; didDocument: DidDocument }> {
    this.agent.config.logger.info('Creating DID:key from an imported private key')

    const privateJwk = this.readImportedPrivateKey(didOptions)
    this.assertImportedKeySupported('key', privateJwk)

    const { keyId, publicJwk } = await this.importKey(agent, privateJwk, this.importedKeyBackend('key', privateJwk))

    const didKey = new DidKey(Kms.PublicJwk.fromPublicJwk(publicJwk))
    const didDocument = didKey.didDocument
    const did = didDocument.id

    const verificationMethodId = this.firstVerificationMethodId(didDocument)
    if (!verificationMethodId) {
      throw new BadRequestError('The key does not produce a usable did:key document')
    }
    const relativeKeyId = verificationMethodId.split('#')[1]

    await agent.dids.import({
      did,
      didDocument,
      overwrite: true,
      keys: [
        {
          didDocumentRelativeKeyId: `#${relativeKeyId}`,
          kmsKeyId: keyId,
        },
      ],
    })

    return { did, didDocument }
  }

  private async createKeyDid(
    agent: AgentType,
    keyType: KeyAlgorithm,
  ): Promise<{ did: string; didDocument: DidDocument | undefined }> {
    this.agent.config.logger.info('Creating DID:key without seed')
    const type = getTypeFromCurve(keyType)
    const openBao = openBaoBackendForDidMethod('key')
    const backend = openBao && openBaoBackendForCreate(type) ? openBao : undefined
    const { keyId } = await agent.kms.createKey({
      type,
      ...(backend ? { backend } : {}),
    })
    const didCreateResult = await agent.dids.create<KeyDidCreateOptions>({
      method: 'key',
      options: { keyId },
    })
    return {
      did: didCreateResult.didState.did as string,
      didDocument: didCreateResult.didState.didDocument,
    }
  }

  private async importExistingKeyDid(
    agent: AgentType,
    did: string,
  ): Promise<{ did: string; didDocument: DidDocument | undefined }> {
    // `DidsApi.import` replaces the record's key bindings with the ones passed in, so re-importing an existing DID
    // without its keys would silently unbind it from the KMS key it signs with. Return the stored record instead.
    const createdDids = await agent.dids.getCreatedDids({ did })
    const existingDid = createdDids[0]
    if (existingDid) {
      // did:key records are stored without a document (it is derived from the DID), so resolve it rather than
      // overwriting the record.
      const didDocument = existingDid.didDocument ?? (await agent.dids.resolve(did)).didDocument
      if (!didDocument) {
        throw new BadRequestError(`Unable to resolve the existing DID ${did}`)
      }
      return { did: existingDid.did, didDocument }
    }

    const { didDocument } = await agent.dids.resolve(did)
    if (!didDocument) {
      throw new BadRequestError(`Unable to resolve DID ${did}`)
    }
    await agent.dids.import({ did, didDocument })
    return { did, didDocument }
  }

  public async handleKey(agent: AgentType, didOptions: DidCreate) {
    this.validateDidKeyOptions(didOptions)
    const keyType = didOptions.keyType as KeyAlgorithm

    let did: string
    let didDocument: DidDocument | undefined

    if (didOptions.did) {
      const result = await this.importExistingKeyDid(agent, didOptions.did)
      did = result.did
      didDocument = result.didDocument
    } else if (this.hasImportedPrivateKey(didOptions)) {
      const result = await this.createKeyDidFromPrivateKey(agent, didOptions)
      did = result.did
      didDocument = result.didDocument
    } else if (didOptions.seed) {
      const result = await this.createKeyDidFromSeed(agent, didOptions, keyType)
      did = result.did
      didDocument = result.didDocument
    } else {
      const result = await this.createKeyDid(agent, keyType)
      did = result.did
      didDocument = result.didDocument
    }

    this.agent.config.logger.info(`This is did ${did}`)
    this.agent.config.logger.info(`This is didDocument ${JSON.stringify(didDocument)}`)

    return { did: did, didDocument: didDocument }
  }

  private validateDidWebOptions(didOptions: DidCreate): string {
    if (!didOptions.domain) {
      throw new BadRequestError('For create did:web, domain is required')
    }

    const hasImportedKey = this.hasImportedPrivateKey(didOptions)
    if (!hasImportedKey && !didOptions.seed) {
      throw new BadRequestError('Seed or privateKey is required')
    }

    if (!hasImportedKey) {
      if (!didOptions.keyType) {
        throw new BadRequestError('keyType is required')
      }

      if (didOptions.keyType !== KeyAlgorithm.Ed25519) {
        throw new BadRequestError('Only ed25519 key type supported')
      }
    }

    const verificationMethodType =
      didOptions.verificationMethodType ?? VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018
    if (
      verificationMethodType !== VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018 &&
      verificationMethodType !== VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020
    ) {
      throw new BadRequestError(
        `verificationMethodType must be ${VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018} or ${VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020}`,
      )
    }

    return verificationMethodType
  }

  private async createWebDidDocument(
    agent: AgentType,
    didOptions: DidCreate,
    did: string,
    keyId: string,
    verificationMethodType: string,
  ): Promise<{ key: { keyId: string }; didDocument: DidDocument }> {
    const hasImportedKey = this.hasImportedPrivateKey(didOptions)

    let privateJwk: Kms.KmsJwkPrivate
    if (hasImportedKey) {
      privateJwk = this.readImportedPrivateKey(didOptions)
      this.assertImportedKeySupported('web', privateJwk)
    } else {
      privateJwk = transformPrivateKeyToPrivateJwk({
        type: {
          crv: 'Ed25519',
          kty: 'OKP',
        },
        privateKey: TypedArrayEncoder.fromUtf8String(didOptions.seed as string),
      }).privateJwk
    }

    const backend = hasImportedKey
      ? this.importedKeyBackend('web', privateJwk)
      : openBaoBackendForDidMethod('web') && openBaoBackendForJwk(privateJwk)
        ? OPENBAO_KMS_BACKEND
        : undefined
    const key = await this.importKey(agent, privateJwk, backend)

    if (privateJwk.kty === 'OKP' && privateJwk.crv === 'Ed25519') {
      const publicJwk = Kms.PublicJwk.fromPublicJwk(
        key.publicJwk as Kms.KmsJwkPublicOkp,
      ) as Kms.PublicJwk<Kms.Ed25519PublicJwk>
      const didDocument = new DidDocumentBuilder(did)
        .addContext(
          verificationMethodType === VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020
            ? SECURITY_ED25519_2020_CONTEXT_URL
            : SECURITY_ED25519_2018_CONTEXT_URL,
        )
        .addVerificationMethod(
          verificationMethodType === VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020
            ? getEd25519VerificationKey2020({ id: keyId, publicJwk, controller: did })
            : getEd25519VerificationKey2018({ id: keyId, publicJwk, controller: did }),
        )
        .addAuthentication(keyId)
        .addAssertionMethod(keyId)
        .build()

      return { key, didDocument }
    }

    // EC and RSA keys are published as a JsonWebKey2020 verification method.
    const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk)
    const didDocument = new DidDocumentBuilder(did)
      .addContext(SECURITY_JWS_CONTEXT_URL)
      .addVerificationMethod(getJsonWebKey2020({ did, publicJwk, verificationMethodId: keyId }))
      .addAuthentication(keyId)
      .addAssertionMethod(keyId)
      .addCapabilityInvocation(keyId)
      .addCapabilityDelegation(keyId)
      .build()

    return { key, didDocument }
  }

  // TODO: Right now we are using seed as privateKey for did creation. Fix this is API payload
  public async handleWeb(agent: AgentType, didOptions: DidCreate) {
    const verificationMethodType = this.validateDidWebOptions(didOptions)

    const domain = didOptions.domain as string
    const did = `did:${didOptions.method}:${domain}`
    const keyId = `${did}#key-1`

    const { key, didDocument } = await this.createWebDidDocument(agent, didOptions, did, keyId, verificationMethodType)

    await agent.dids.import({
      did,
      overwrite: true,
      didDocument,
      keys: [
        {
          didDocumentRelativeKeyId: `#key-1`,
          kmsKeyId: key.keyId,
        },
      ],
    })
    return { did, didDocument }
  }

  public async handlePolygon(agent: AgentType, createDidOptions: DidCreate) {
    // need to discuss try catch logic
    const { endpoint, network, privatekey } = createDidOptions

    if (!network) {
      throw new BadRequestError('Network is required for Polygon method')
    }

    const networkName = network?.split(':')[1]

    if (networkName !== 'mainnet' && networkName !== 'testnet') {
      throw new BadRequestError('Invalid network type')
    }
    if (!privatekey || typeof privatekey !== 'string' || !privatekey.trim() || privatekey.length !== 64) {
      throw new BadRequestError('Invalid private key or key not supported')
    }

    const createDidResponse = await agent.dids.create<PolygonDidCreateOptions>({
      method: DidMethod.Polygon,
      options: {
        network: networkName,
        endpoint,
      },
      secret: {
        privateKey: TypedArrayEncoder.fromHex(`${privatekey}`),
      },
    })
    const didResponse = {
      did: createDidResponse?.didState?.did,
      didDocument: createDidResponse?.didState?.didDocument,
    }
    return didResponse
  }

  /**
   * Creates a did:x509 from an existing CA issued certificate chain and its private key
   * @body DidX509ImportOptionsDto
   * @returns did, didDocument and the KMS key id
   */
  @Post('/x509/import')
  public async importDidX509(@Request() request: Req, @Body() options: DidX509ImportOptionsDto) {
    try {
      return await didX509Service.importDidX509(request.agent, options)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Returns the certificate chain stored with a did:x509 imported into this agent
   */
  @Get('/x509/chain/:did')
  public async getDidX509Chain(@Request() request: Req, @Path('did') did: Did) {
    try {
      return await didX509Service.getChain(request.agent, did)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Get('/')
  public async getDids(@Request() request: Req) {
    try {
      const createdDids = await request.agent.dids.getCreatedDids()
      return createdDids
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
