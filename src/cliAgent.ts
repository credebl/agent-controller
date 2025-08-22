import type { InitConfig } from '@credo-ts/core'
import type { WalletConfig } from '@credo-ts/core/build/types'
import type { IndyVdrPoolConfig } from '@credo-ts/indy-vdr'

import { PolygonDidRegistrar, PolygonDidResolver, PolygonModule } from '@ayanworks/credo-polygon-w3c-module'
import {
  AnonCredsCredentialFormatService,
  AnonCredsModule,
  AnonCredsProofFormatService,
  LegacyIndyCredentialFormatService,
  LegacyIndyProofFormatService,
  V1CredentialProtocol,
  V1ProofProtocol,
} from '@credo-ts/anoncreds'
import { AskarModule, AskarMultiWalletDatabaseScheme } from '@credo-ts/askar'
import {
  DidsModule,
  W3cCredentialsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  CacheModule,
  InMemoryLruCache,
  WebDidResolver,
  LogLevel,
  Agent
} from '@credo-ts/core'
import {
  HttpOutboundTransport,
  WsOutboundTransport,
  JsonLdCredentialFormatService,
  DifPresentationExchangeProofFormatService,
  ConnectionsModule,
  ProofsModule,
  AutoAcceptCredential,
  AutoAcceptProof,
  V2ProofProtocol,
  CredentialsModule,
  V2CredentialProtocol,
  DidCommModule,
  OutOfBandModule,
  MediationRecipientModule,
  BasicMessagesModule,
  MessagePickupModule,
  DiscoverFeaturesModule,
} from '@credo-ts/didcomm'
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
  IndyVdrIndyDidRegistrar,
} from '@credo-ts/indy-vdr'
import { agentDependencies, HttpInboundTransport, WsInboundTransport } from '@credo-ts/node'
import { QuestionAnswerModule } from '@credo-ts/question-answer'
import { TenantsModule } from '@credo-ts/tenants'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar} from '@openwallet-foundation/askar-nodejs'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'
import axios from 'axios'
import { readFile } from 'fs/promises'

import { IndicioAcceptanceMechanism, IndicioTransactionAuthorAgreement, Network, NetworkName } from './enums'
import { setupServer } from './server'
import { isCustomDocumentLoaderEnabled } from './utils/config'
import { CustomDocumentLoader } from './utils/customDocumentLoader'
import { generateSecretKey } from './utils/helpers'
import { TsLogger } from './utils/logger'
import { OpenId4VcHolderModule, OpenId4VcIssuerModule, OpenId4VcVerifierModule } from '@credo-ts/openid4vc'
import { Router } from 'express'
import { getCredentialRequestToCredentialMapper } from './utils/oid4vc-agent'

const openId4VciRouter = Router()
const openId4VpRouter = Router()

export type Transports = 'ws' | 'http'
export type InboundTransport = {
  transport: Transports
  port: number
}

const inboundTransportMapping = {
  http: HttpInboundTransport,
  ws: WsInboundTransport,
} as const

const outboundTransportMapping = {
  http: HttpOutboundTransport,
  ws: WsOutboundTransport,
} as const

interface indyLedger {
  genesisTransactions: string
  indyNamespace: string
}
export interface AriesRestConfig {
  label: string
  walletConfig: WalletConfig
  indyLedger: indyLedger[]
  adminPort: number
  publicDidSeed?: string
  endpoints?: string[]
  autoAcceptConnections?: boolean
  autoAcceptCredentials?: AutoAcceptCredential
  autoAcceptProofs?: AutoAcceptProof
  logLevel?: LogLevel
  inboundTransports?: InboundTransport[]
  outboundTransports?: Transports[]
  autoAcceptMediationRequests?: boolean
  connectionImageUrl?: string
  tenancy?: boolean
  webhookUrl?: string
  didRegistryContractAddress?: string
  schemaManagerContractAddress?: string
  rpcUrl?: string
  fileServerUrl?: string
  fileServerToken?: string
  walletScheme?: AskarMultiWalletDatabaseScheme
  schemaFileServerURL?: string
  apiKey: string
  updateJwtSecret?: boolean
}

export async function readRestConfig(path: string) {
  const configString = await readFile(path, { encoding: 'utf-8' })
  const config = JSON.parse(configString)

  return config
}

export type RestMultiTenantAgentModules = Awaited<ReturnType<typeof getWithTenantModules>>

export type RestAgentModules = Awaited<ReturnType<typeof getModules>>

// TODO: add object
const getModules = (
  networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]],
  didRegistryContractAddress: string,
  fileServerToken: string,
  fileServerUrl: string,
  rpcUrl: string,
  schemaManagerContractAddress: string,
  autoAcceptConnections: boolean,
  autoAcceptCredentials: AutoAcceptCredential,
  autoAcceptProofs: AutoAcceptProof,
  walletScheme: AskarMultiWalletDatabaseScheme,
) => {
  const legacyIndyCredentialFormat = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyProofFormatService()
  const jsonLdCredentialFormatService = new JsonLdCredentialFormatService()
  const anonCredsCredentialFormatService = new AnonCredsCredentialFormatService()
  const anonCredsProofFormatService = new AnonCredsProofFormatService()
  const presentationExchangeProofFormatService = new DifPresentationExchangeProofFormatService()
  return {
    askar: new AskarModule({
      askar,
      multiWalletDatabaseScheme: walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
    }),

    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: networkConfig,
    }),

    dids: new DidsModule({
      registrars: [new IndyVdrIndyDidRegistrar(), new KeyDidRegistrar(), new PolygonDidRegistrar()],
      resolvers: [new IndyVdrIndyDidResolver(), new KeyDidResolver(), new WebDidResolver(), new PolygonDidResolver()],
    }),

    anoncreds: new AnonCredsModule({
      registries: [new IndyVdrAnonCredsRegistry()],
      anoncreds,
    }),

    connections: new ConnectionsModule({
      autoAcceptConnections: autoAcceptConnections || true,
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: autoAcceptProofs || AutoAcceptProof.ContentApproved,
      proofProtocols: [
        new V1ProofProtocol({
          indyProofFormat: legacyIndyProofFormat,
        }),
        new V2ProofProtocol({
          proofFormats: [legacyIndyProofFormat, anonCredsProofFormatService, presentationExchangeProofFormatService],
        }),
      ],
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: autoAcceptCredentials || AutoAcceptCredential.Always,
      credentialProtocols: [
        new V1CredentialProtocol({
          indyCredentialFormat: legacyIndyCredentialFormat,
        }),
        new V2CredentialProtocol({
          credentialFormats: [
            legacyIndyCredentialFormat,
            jsonLdCredentialFormatService,
            anonCredsCredentialFormatService,
          ],
        }),
      ],
    }),
    w3cCredentials: isCustomDocumentLoaderEnabled()
      ? new W3cCredentialsModule({
          documentLoader: CustomDocumentLoader,
        })
      : new W3cCredentialsModule(),
    didcomm: new DidCommModule({
      processDidCommMessagesConcurrently: true   
    }),
    oob: new OutOfBandModule(),
    mediationRecipient: new MediationRecipientModule(),
    discovery: new DiscoverFeaturesModule(),
    messagePickup: new MessagePickupModule(),
    basicMessages: new BasicMessagesModule(),
    cache: new CacheModule({
      cache: new InMemoryLruCache({ limit: Number(process.env.INMEMORY_LRU_CACHE_LIMIT) || Infinity }),
    }),

    questionAnswer: new QuestionAnswerModule(),
    polygon: new PolygonModule({
      didContractAddress: didRegistryContractAddress
        ? didRegistryContractAddress
        : (process.env.DID_CONTRACT_ADDRESS as string),
      schemaManagerContractAddress:
        schemaManagerContractAddress || (process.env.SCHEMA_MANAGER_CONTRACT_ADDRESS as string),
      fileServerToken: fileServerToken ? fileServerToken : (process.env.FILE_SERVER_TOKEN as string),
      rpcUrl: rpcUrl ? rpcUrl : (process.env.RPC_URL as string),
      serverUrl: fileServerUrl ? fileServerUrl : (process.env.SERVER_URL as string),
    }),
    openId4VcVerifier: new OpenId4VcVerifierModule({
      baseUrl: `http://${process.env.APP_URL}/oid4vp`,
      router: openId4VpRouter,
    }),
    openId4VcIssuer: new OpenId4VcIssuerModule({
      baseUrl: `http://${process.env.APP_URL}/oid4vci`,
      router: openId4VciRouter,
      statefulCredentialOfferExpirationInSeconds: Number(process.env.OPENID_CRED_OFFER_EXPIRY) || 3600,
      accessTokenExpiresInSeconds: Number(process.env.OPENID_ACCESS_TOKEN_EXPIRY) || 3600,
      authorizationCodeExpiresInSeconds: Number(process.env.OPENID_AUTH_CODE_EXPIRY) || 3600,
      cNonceExpiresInSeconds: Number(process.env.OPENID_CNONCE_EXPIRY) || 3600,
      dpopRequired: false,
      credentialRequestToCredentialMapper: (...args) => getCredentialRequestToCredentialMapper()(...args),
    }),
    openId4VcHolderModule: new OpenId4VcHolderModule(),
  }
}

// TODO: add object
const getWithTenantModules = (
  networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]],
  didRegistryContractAddress: string,
  fileServerToken: string,
  fileServerUrl: string,
  rpcUrl: string,
  schemaManagerContractAddress: string,
  autoAcceptConnections: boolean,
  autoAcceptCredentials: AutoAcceptCredential,
  autoAcceptProofs: AutoAcceptProof,
  walletScheme: AskarMultiWalletDatabaseScheme,
) => {
  const modules = getModules(
    networkConfig,
    didRegistryContractAddress,
    fileServerToken,
    fileServerUrl,
    rpcUrl,
    schemaManagerContractAddress,
    autoAcceptConnections,
    autoAcceptCredentials,
    autoAcceptProofs,
    walletScheme,
  )
  return {
    tenants: new TenantsModule<typeof modules>({
      sessionAcquireTimeout: Number(process.env.SESSION_ACQUIRE_TIMEOUT) || Infinity,
      sessionLimit: Number(process.env.SESSION_LIMIT) || Infinity,
    }),
    ...modules,
  }
}

// async function generateSecretKey(length: number = 32): Promise<string> {
//   // Asynchronously generate a buffer containing random values
//   const buffer: Buffer = await new Promise((resolve, reject) => {
//     randomBytes(length, (error, buf) => {
//       if (error) {
//         reject(error)
//       } else {
//         resolve(buf)
//       }
//     })
//   })

//   // Convert the buffer to a hexadecimal string
//   const secretKey: string = buffer.toString('hex')

//   return secretKey
// }

export async function runRestAgent(restConfig: AriesRestConfig) {
  const {
    schemaFileServerURL,
    logLevel,
    inboundTransports = [],
    outboundTransports = [],
    webhookUrl,
    adminPort,
    didRegistryContractAddress,
    fileServerToken,
    fileServerUrl,
    rpcUrl,
    schemaManagerContractAddress,
    walletConfig,
    autoAcceptConnections,
    autoAcceptCredentials,
    autoAcceptProofs,
    walletScheme,
    apiKey,
    updateJwtSecret,
    ...afjConfig
  } = restConfig

  const logger = new TsLogger(logLevel ?? LogLevel.error)

  const agentConfig: InitConfig = {
    walletConfig: {
      id: walletConfig.id,
      key: walletConfig.key,
      storage: walletConfig.storage,
    },
    ...afjConfig,
    logger,
    autoUpdateStorageOnStartup: true,
    // As backup is only supported for sqlite storage
    // we need to manually take backup of the storage before updating the storage
    backupBeforeStorageUpdate: false,
    // Ideally for testing connection between tenant agent we need to set this to 'true'. Default is 'false'
    // TODO: triage: not sure if we want it to be 'true', as it would mean parallel requests on BW
    // Setting it for now //TODO: check if this is needed
  }

  async function fetchLedgerData(ledgerConfig: {
    genesisTransactions: string
    indyNamespace: string
  }): Promise<IndyVdrPoolConfig> {
    const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$/

    if (!urlPattern.test(ledgerConfig.genesisTransactions)) {
      throw new Error('Not a valid URL')
    }

    const genesisTransactions = await axios.get(ledgerConfig.genesisTransactions)

    const networkConfig: IndyVdrPoolConfig = {
      genesisTransactions: genesisTransactions.data,
      indyNamespace: ledgerConfig.indyNamespace,
      isProduction: false,
      connectOnStartup: true,
    }

    if (ledgerConfig.indyNamespace.includes(NetworkName.Indicio)) {
      if (ledgerConfig.indyNamespace === (Network.Indicio_Mainnet as string)) {
        networkConfig.transactionAuthorAgreement = {
          version: IndicioTransactionAuthorAgreement.Indicio_Testnet_Mainnet_Version,
          acceptanceMechanism: IndicioAcceptanceMechanism.Wallet_Agreement,
        }
      } else {
        networkConfig.transactionAuthorAgreement = {
          version: IndicioTransactionAuthorAgreement.Indicio_Demonet_Version,
          acceptanceMechanism: IndicioAcceptanceMechanism.Wallet_Agreement,
        }
      }
    }

    return networkConfig
  }

  let networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]]

  const parseIndyLedger = afjConfig?.indyLedger
  if (parseIndyLedger.length !== 0) {
    networkConfig = [
      await fetchLedgerData(parseIndyLedger[0]),
      ...(await Promise.all(parseIndyLedger.slice(1).map(fetchLedgerData))),
    ]
  } else {
    networkConfig = [
      {
        genesisTransactions: process.env.BCOVRIN_TEST_GENESIS as string,
        indyNamespace: Network.Bcovrin_Testnet,
        isProduction: false,
        connectOnStartup: true,
      },
    ]
  }

  const tenantModule = await getWithTenantModules(
    networkConfig,
    didRegistryContractAddress || '',
    fileServerToken || '',
    fileServerUrl || '',
    rpcUrl || '',
    schemaManagerContractAddress || '',
    autoAcceptConnections || true,
    autoAcceptCredentials || AutoAcceptCredential.Always,
    autoAcceptProofs || AutoAcceptProof.ContentApproved,
    walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
  )
  const modules = getModules(
    networkConfig,
    didRegistryContractAddress || '',
    fileServerToken || '',
    fileServerUrl || '',
    rpcUrl || '',
    schemaManagerContractAddress || '',
    autoAcceptConnections || true,
    autoAcceptCredentials || AutoAcceptCredential.Always,
    autoAcceptProofs || AutoAcceptProof.ContentApproved,
    walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
  )
  const agent = new Agent({
    config: agentConfig,
    modules: {
      ...(afjConfig.tenancy
        ? {
          ...tenantModule,
        }
        : {}),
      ...modules,
    },
    dependencies: agentDependencies,
  })

  // Register outbound transports
  for (const outboundTransport of outboundTransports) {
    const OutboundTransport = outboundTransportMapping[outboundTransport]
    agent.modules.didcomm.registerOutboundTransport(new OutboundTransport())
  }

  // Register inbound transports
  // for (const inboundTransport of inboundTransports) {
  //   const InboundTransport = inboundTransportMapping[inboundTransport.transport]
  //   agent.modules.didcomm.registerInboundTransport(new InboundTransport({ port: inboundTransport.port }))
  // }

  // Register inbound transports
  for (const inboundTransport of inboundTransports) {
    const InboundTransport = inboundTransportMapping[inboundTransport.transport]
    const transport = new InboundTransport({ port: inboundTransport.port })
    agent.modules.didcomm.registerInboundTransport(transport)

    // Configure the oid4vc routers on the http inbound transport
    if (transport instanceof HttpInboundTransport) {
      transport.app.use('/oid4vci', modules.openId4VcIssuer.config.router as any)
      transport.app.use('/oid4vp', modules.openId4VcVerifier.config.router as any)
    }
  }

  await agent.initialize()

  const genericRecord = await agent.genericRecords.findAllByQuery({ hasSecretKey: 'true' })
  const recordsWithSecretKey = genericRecord[0]

  if (!recordsWithSecretKey) {
    // If secretKey doesn't exist in genericRecord: i.e. Agent initialized for the first time or secretKey not found
    // Generate and store secret key for agent while initialization
    const secretKeyInfo = await generateSecretKey()

    await agent.genericRecords.save({
      content: {
        secretKey: secretKeyInfo,
      },
      tags: {
        hasSecretKey: 'true', // custom tag to support query
      },
    })
  } else if (updateJwtSecret && recordsWithSecretKey) {
    // If secretKey already exist in genericRecord: i.e. Agent is not initialized for the first time or secretKey already found
    // And we are requested to store a new secret, with the flag: 'updateJwtSecret'
    // Generate and store secret key for agent while initialization
    recordsWithSecretKey.content.secretKey = await generateSecretKey()
    recordsWithSecretKey.setTag('hasSecretKey', true)
    await agent.genericRecords.update(recordsWithSecretKey)
  }
  const app = await setupServer(
    agent,
    {
      webhookUrl,
      port: adminPort,
      schemaFileServerURL,
    },
    apiKey,
  )

  logger.info(`*** API Key: ${apiKey}`)

  app.listen(adminPort, () => {
    logger.info(`Successfully started server on port ${adminPort}`)
  })
}
