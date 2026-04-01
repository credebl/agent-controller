import type { DidResolutionResultProps } from '../types'
import type { PolygonDidCreateOptions } from '@ayanworks/credo-polygon-w3c-module/build/dids/PolygonDidRegistrar.mjs'
import type { DidDocument, KeyDidCreateOptions, PeerDidNumAlgo2CreateOptions } from '@credo-ts/core'

import { transformPrivateKeyToPrivateJwk, transformSeedToPrivateJwk } from '@credo-ts/askar'
import {
  TypedArrayEncoder,
  DidDocumentBuilder,
  getEd25519VerificationKey2018,
  createPeerDidDocumentFromServices,
  PeerDidNumAlgo,
  Kms,
  Hasher,
  LogLevel,
  Agent,
  DidKey,
} from '@credo-ts/core'
import { Key, KeyAlgorithm, askar } from '@openwallet-foundation/askar-nodejs'
import axios from 'axios'
import { Request as Req } from 'express'
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
import { CreateDidResponse, Did, DidRecordExample } from '../examples'
import { DidCreate, supportedKeyTypesDID } from '../types'

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

    this.agent.config.logger.info(`askar version ${askar.version()}`)
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
    //     privateKey: TypedArrayEncoder.fromString(createDidOptions.seed),
    //     keyType: KeyAlgorithm.Ed25519,
    // })

    // const buffer = TypedArrayEncoder.fromBase58(key.publicKeyBase58)
    // const did = TypedArrayEncoder.toBase58(buffer.slice(0, 16))

    const privateJwk = transformSeedToPrivateJwk({
      seed: TypedArrayEncoder.fromString(createDidOptions.seed),
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
            privateKey: TypedArrayEncoder.fromString(privateKey),
          })
        : seed
          ? transformSeedToPrivateJwk({
              seed: TypedArrayEncoder.fromString(seed),
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
  public async handleKey(agent: AgentType, didOptions: DidCreate) {
    let did
    let didResponse
    let didDocument

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

    if (!didOptions.did) {
      if (didOptions.seed) {
        this.agent.config.logger.info('Creating DID:key with provided seed')
        const privateJwk = transformPrivateKeyToPrivateJwk({
          privateKey: TypedArrayEncoder.fromString(didOptions.seed),
          type: getTypeFromCurve(didOptions.keyType ?? KeyAlgorithm.Ed25519),
        }).privateJwk

        const { keyId, publicJwk } = await agent.kms.importKey({
          privateJwk,
        })

        this.agent.config.logger.info(`This is keyId:::::: ${keyId}`)
        const publicKey = Kms.PublicJwk.fromPublicJwk(publicJwk)

        const didKey = new DidKey(publicKey)
        didDocument = didKey.didDocument
        did = didDocument.id

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
      } else {
        this.agent.config.logger.info('Creating DID:key without seed')
        const { keyId } = await agent.kms.createKey({
          type: getTypeFromCurve(didOptions.keyType ?? KeyAlgorithm.Ed25519),
        })
        this.agent.config.logger.info(`This is did:::::: ${did}`)
        const didCreateResult = await agent.dids.create<KeyDidCreateOptions>({
          method: 'key',
          options: { keyId },
        })
        didDocument = didCreateResult.didState.didDocument
        did = didCreateResult.didState.did
      }
    } else {
      did = didOptions.did
      const createdDid = await agent.dids.getCreatedDids({
        method: DidMethod.Key,
        did: didOptions.did,
      })
      didDocument = createdDid[0]?.didDocument

      await agent.dids.import({
        did,
        overwrite: true,
        didDocument,
      })
    }

    this.agent.config.logger.info(`This is did ${did}`)
    this.agent.config.logger.info(`This is didDocument ${JSON.stringify(didDocument)}`)

    return { did: did, didDocument: didDocument }
  }

  // TODO: Right now we are using seed as privateKey for did creation. Fix this is API payload
  public async handleWeb(agent: AgentType, didOptions: DidCreate) {
    let didDocument: DidDocument
    if (!didOptions.domain) {
      throw new BadRequestError('For create did:web, domain is required')
    }

    if (!didOptions.seed) {
      throw new BadRequestError('Seed is required')
    }

    if (!didOptions.keyType) {
      throw new BadRequestError('keyType is required')
    }

    if (didOptions.keyType !== KeyAlgorithm.Ed25519) {
      throw new BadRequestError('Only ed25519 key type supported')
    }

    const domain = didOptions.domain
    const did = `did:${didOptions.method}:${domain}`
    const keyId = `${did}#key-1`

    let key
    let publicJwk

    if (didOptions.keyType === KeyAlgorithm.Ed25519) {
      const { privateJwk } = transformPrivateKeyToPrivateJwk({
        type: {
          crv: 'Ed25519',
          kty: 'OKP',
        },
        privateKey: TypedArrayEncoder.fromString(didOptions.seed),
      })

      key = await agent.kms.importKey({ privateJwk })

      publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk)
      didDocument = new DidDocumentBuilder(did)
        .addContext('https://w3id.org/security/suites/ed25519-2018/v1')
        .addVerificationMethod(getEd25519VerificationKey2018({ id: keyId, publicJwk, controller: did }))
        .addAuthentication(keyId)
        .addAssertionMethod(keyId)
        .build()
    } else if (didOptions.keyType === KeyAlgorithm.Bls12381G2) {
      // Support for BBS signature is discontinued from credo-ts version 0.6.0
      throw new BadRequestError(`Support for ${KeyAlgorithm.Bls12381G2} has been deprecated`)
    } else {
      throw new BadRequestError('Unsupported key type') // fallback, but this won't hit due to earlier check
    }

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
