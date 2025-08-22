import type { DidResolutionResultProps } from '../types'
import type { PolygonDidCreateOptions } from '@ayanworks/credo-polygon-w3c-module/build/dids'
import type { DidDocument, KeyDidCreateOptions, PeerDidNumAlgo2CreateOptions } from '@credo-ts/core'

import {
  KeyType,
  TypedArrayEncoder,
  DidDocumentBuilder,
  getEd25519VerificationKey2018,
  getBls12381G2Key2020,
  createPeerDidDocumentFromServices,
  PeerDidNumAlgo,
} from '@credo-ts/core'
import axios from 'axios'
import { Request as Req } from 'express'
import { Body, Controller, Example, Get, Path, Post, Route, Tags, Security, Request } from 'tsoa'
import { injectable } from 'tsyringe'

import { DidMethod, Network, Role, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BadRequestError, InternalServerError } from '../../errors'
import { AgentType } from '../../types'
import { CreateDidResponse, Did, DidRecordExample } from '../examples'
import { DidCreate } from '../types'

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

    const didRouting = await agent.modules.mediationRecipient.getRouting({})
    const didDocument = createPeerDidDocumentFromServices([
      {
        id: 'didcomm',
        recipientKeys: [didRouting.recipientKey],
        routingKeys: didRouting.routingKeys,
        serviceEndpoint: didRouting.endpoints[0],
      },
    ])

    const didPeerResponse = await agent.dids.create<PeerDidNumAlgo2CreateOptions>({
      didDocument,
      method: DidMethod.Peer,
      options: {
        numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
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

    if (createDidOptions.keyType !== KeyType.Ed25519) {
      throw new BadRequestError('Only ed25519 key type supported')
    }

    if (!Network.Bcovrin_Testnet && !Network.Indicio_Demonet && !Network.Indicio_Testnet) {
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
        await this.importDid(agent, didMethod, createDidOptions.did, createDidOptions.seed)
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
        const BCOVRIN_REGISTER_URL = process.env.BCOVRIN_REGISTER_URL as string
        const res = await axios.post(BCOVRIN_REGISTER_URL, {
          role: 'ENDORSER',
          alias: 'Alias',
          seed: createDidOptions.seed,
        })
        const { did } = res?.data || {}
        await this.importDid(agent, didMethod, did, createDidOptions.seed)
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
        const key = await this.createIndicioKey(agent, createDidOptions)
        const INDICIO_NYM_URL = process.env.INDICIO_NYM_URL as string
        const res = await axios.post(INDICIO_NYM_URL, key)
        if (res.data.statusCode === 200) {
          await this.importDid(agent, didMethod, key.did, createDidOptions.seed)
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
    const key = await agent.wallet.createKey({
      privateKey: TypedArrayEncoder.fromString(createDidOptions.seed),
      keyType: KeyType.Ed25519,
    })

    const buffer = TypedArrayEncoder.fromBase58(key.publicKeyBase58)
    const did = TypedArrayEncoder.toBase58(buffer.slice(0, 16))

    let body
    if (createDidOptions.network === Network.Indicio_Testnet) {
      body = {
        network: 'testnet',
        did,
        verkey: TypedArrayEncoder.toBase58(buffer),
      }
    } else if (createDidOptions.network === Network.Indicio_Demonet) {
      body = {
        network: 'demonet',
        did,
        verkey: TypedArrayEncoder.toBase58(buffer),
      }
    } else {
      throw new BadRequestError('Please provide a valid did method')
    }
    return body
  }

  private async importDid(agent: AgentType, didMethod: string, did: string, seed: string) {
    await agent.dids.import({
      did: `${didMethod}:${did}`,
      overwrite: true,
      privateKeys: [
        {
          keyType: KeyType.Ed25519,
          privateKey: TypedArrayEncoder.fromString(seed),
        },
      ],
    })
  }

  public async handleKey(agent: AgentType, didOptions: DidCreate) {
    let did
    let didResponse
    let didDocument

    if (!didOptions.seed) {
      throw new BadRequestError('Seed is required')
    }
    if (!didOptions.keyType) {
      throw new BadRequestError('keyType is required')
    }
    if (didOptions.keyType !== KeyType.Ed25519 && didOptions.keyType !== KeyType.Bls12381g2) {
      throw new BadRequestError('Only ed25519 and bls12381g2 key type supported')
    }

    if (!didOptions.did) {
      await agent.wallet.createKey({
        keyType: didOptions.keyType,
        seed: TypedArrayEncoder.fromString(didOptions.seed),
      })

      didResponse = await agent.dids.create<KeyDidCreateOptions>({
        method: DidMethod.Key,
        options: {
          keyType: KeyType.Ed25519,
        },
        secret: {
          privateKey: TypedArrayEncoder.fromString(didOptions.seed),
        },
      })
      did = `${didResponse.didState.did}`
      didDocument = didResponse.didState.didDocument
    } else {
      did = didOptions.did
      const createdDid = await agent.dids.getCreatedDids({
        method: DidMethod.Key,
        did: didOptions.did,
      })
      didDocument = createdDid[0]?.didDocument
    }

    await agent.dids.import({
      did,
      overwrite: true,
      didDocument,
    })
    return { did: did, didDocument: didDocument }
  }

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

    if (didOptions.keyType !== KeyType.Ed25519 && didOptions.keyType !== KeyType.Bls12381g2) {
      throw new BadRequestError('Only ed25519 and bls12381g2 key type supported')
    }

    const domain = didOptions.domain
    const did = `did:${didOptions.method}:${domain}`
    const keyId = `${did}#key-1`

    const key = await agent.wallet.createKey({
      keyType: didOptions.keyType,
      // Commenting for now, as per the multi-tenant endpoint
      // privateKey: TypedArrayEncoder.fromString(didOptions.seed),
      seed: TypedArrayEncoder.fromString(didOptions.seed),
    })

    if (didOptions.keyType === KeyType.Ed25519) {
      didDocument = new DidDocumentBuilder(did)
        .addContext('https://w3id.org/security/suites/ed25519-2018/v1')
        .addVerificationMethod(getEd25519VerificationKey2018({ key, id: keyId, controller: did }))
        .addAuthentication(keyId)
        .addAssertionMethod(keyId)
        .build()
    } else if (didOptions.keyType === KeyType.Bls12381g2) {
      didDocument = new DidDocumentBuilder(did)
        .addContext('https://w3id.org/security/bbs/v1')
        .addVerificationMethod(getBls12381G2Key2020({ key, id: keyId, controller: did }))
        .addAuthentication(keyId)
        .addAssertionMethod(keyId)
        .build()
    } else {
      throw new BadRequestError('Unsupported key type') // fallback, but this won't hit due to earlier check
    }

    await agent.dids.import({
      did,
      overwrite: true,
      didDocument,
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
