// Note: For now we need to import askar-nodejs at the top to handle the undefined askar issue
// Refer from: https://github.com/credebl/mobile-sdk/blob/main/packages/ssi/src/wallet/wallet.ts
import '@openwallet-foundation/askar-nodejs'
import '@hyperledger/indy-vdr-nodejs'
import '@hyperledger/anoncreds-nodejs'
import type { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import type { InitConfig } from '@credo-ts/core'
import type { IndyVdrPoolConfig } from '@credo-ts/indy-vdr'

import { PolygonDidRegistrar, PolygonDidResolver, PolygonModule } from '@ayanworks/credo-polygon-w3c-module'
import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsModule,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
  DidCommCredentialV1Protocol,
  DidCommProofV1Protocol,
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
  Agent,
  X509Module,
  JwkDidRegistrar,
  JwkDidResolver,
  SdJwtVcModule,
  PeerDidNumAlgo,
} from '@credo-ts/core'
import {
  DidCommHttpOutboundTransport,
  DidCommWsOutboundTransport,
  DidCommJsonLdCredentialFormatService,
  DidCommDifPresentationExchangeProofFormatService,
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommProofV2Protocol,
  DidCommCredentialV2Protocol,
  DidCommModule,
  DidCommDiscoverFeaturesModule,
} from '@credo-ts/didcomm'
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
  IndyVdrIndyDidRegistrar,
} from '@credo-ts/indy-vdr'
import { agentDependencies, DidCommHttpInboundTransport, DidCommWsInboundTransport } from '@credo-ts/node'
import { OpenId4VcHolderModule, OpenId4VcModule } from '@credo-ts/openid4vc'
import { QuestionAnswerModule } from '@credo-ts/question-answer'
import { TenantsModule } from '@credo-ts/tenants'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import axios from 'axios'
import bodyParser from 'body-parser'
import express from 'express'
import { readFile } from 'fs/promises'

import { IndicioAcceptanceMechanism, IndicioTransactionAuthorAgreement, Network, NetworkName } from './enums'
import { validatePurgeConfig } from './purge/PurgeConfigValidator'
import {
  initPurgeSchedulers,
  stopPurgeSchedulers,
  getNatsPurgeScheduler,
  getCronPurgeScheduler,
} from './purge/PurgeSchedulerFactory'
import { buildPurgeConfig } from './purge/PurgeTypes'
import { setupServer } from './server'
import { AuthTypes, getAuthType } from './utils/auth'
import { isCustomDocumentLoaderEnabled } from './utils/config'
import { CustomDocumentLoader } from './utils/customDocumentLoader'
import { generateSecretKey } from './utils/helpers'
import { TsLogger } from './utils/logger'
import {
  getMixedCredentialRequestToCredentialMapper,
  getX509CertsByClientToken,
  getX509CertsByUrl,
} from './utils/oid4vc-agent'

export type Transports = 'ws' | 'http'
export type InboundTransport = {
  transport: Transports
  port: number
}

const inboundTransportMapping = {
  http: DidCommHttpInboundTransport,
  ws: DidCommWsInboundTransport,
} as const

const outboundTransportMapping = {
  http: DidCommHttpOutboundTransport,
  ws: DidCommWsOutboundTransport,
} as const

interface indyLedger {
  genesisTransactions: string
  indyNamespace: string
}
export interface AriesRestConfig {
  label: string
  walletConfig: AskarModuleConfigStoreOptions
  indyLedger: indyLedger[]
  adminPort: number
  publicDidSeed?: string
  endpoints?: string[]
  autoAcceptConnections?: boolean
  autoAcceptCredentials?: DidCommAutoAcceptCredential
  autoAcceptProofs?: DidCommAutoAcceptProof
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
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
const expressApp = express()
expressApp.disable('x-powered-by')
expressApp.use(express.json({ limit: process.env.APP_JSON_BODY_SIZE ?? '5mb' }))
expressApp.use(express.urlencoded({ limit: process.env.APP_URL_ENCODED_BODY_SIZE ?? '5mb', extended: true }))
// TODO: add object
const getModules = (
  networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]],
  didRegistryContractAddress: string,
  fileServerToken: string,
  fileServerUrl: string,
  rpcUrl: string,
  schemaManagerContractAddress: string,
  autoAcceptConnections: boolean,
  autoAcceptCredentials: DidCommAutoAcceptCredential,
  autoAcceptProofs: DidCommAutoAcceptProof,
  walletScheme: AskarMultiWalletDatabaseScheme,
  storeOptions: AskarModuleConfigStoreOptions,
  endpoints: string[],
) => {
  const legacyIndyCredentialFormat = new LegacyIndyDidCommCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyDidCommProofFormatService()
  const jsonLdCredentialFormatService = new DidCommJsonLdCredentialFormatService()
  const anonCredsCredentialFormatService = new AnonCredsDidCommCredentialFormatService()
  const anonCredsProofFormatService = new AnonCredsDidCommProofFormatService()
  const presentationExchangeProofFormatService = new DidCommDifPresentationExchangeProofFormatService()

  return {
    askar: new AskarModule({
      askar,
      store: {
        ...storeOptions,
      },
      multiWalletDatabaseScheme: walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
    }),

    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: networkConfig,
    }),
    dids: new DidsModule({
      registrars: [
        new IndyVdrIndyDidRegistrar(),
        new KeyDidRegistrar(),
        new JwkDidRegistrar(),
        new PolygonDidRegistrar(),
      ],
      resolvers: [
        new IndyVdrIndyDidResolver(),
        new KeyDidResolver(),
        new WebDidResolver(),
        new JwkDidResolver(),
        new PolygonDidResolver(),
      ],
    }),

    anoncreds: new AnonCredsModule({
      registries: [new IndyVdrAnonCredsRegistry()],
      anoncreds,
    }),
    w3cCredentials: isCustomDocumentLoaderEnabled()
      ? new W3cCredentialsModule({
          documentLoader: CustomDocumentLoader,
        })
      : new W3cCredentialsModule(),
    didcomm: new DidCommModule({
      processDidCommMessagesConcurrently: true,
      mediationRecipient: true,
      messagePickup: true,
      mediator: false,
      endpoints: endpoints || [],

      basicMessages: true,
      connections: {
        autoAcceptConnections: autoAcceptConnections ?? true,
        peerNumAlgoForDidExchangeRequests: PeerDidNumAlgo.GenesisDoc,
        peerNumAlgoForDidRotation: PeerDidNumAlgo.ShortFormAndLongForm,
      },
      proofs: {
        autoAcceptProofs: autoAcceptProofs || DidCommAutoAcceptProof.ContentApproved,
        proofProtocols: [
          new DidCommProofV1Protocol({
            indyProofFormat: legacyIndyProofFormat,
          }),
          new DidCommProofV2Protocol({
            proofFormats: [legacyIndyProofFormat, anonCredsProofFormatService, presentationExchangeProofFormatService],
          }),
        ],
      },
      credentials: {
        autoAcceptCredentials: autoAcceptCredentials || DidCommAutoAcceptCredential.Always,
        credentialProtocols: [
          new DidCommCredentialV1Protocol({
            indyCredentialFormat: legacyIndyCredentialFormat,
          }),
          new DidCommCredentialV2Protocol({
            credentialFormats: [
              legacyIndyCredentialFormat,
              jsonLdCredentialFormatService,
              anonCredsCredentialFormatService,
            ],
          }),
        ],
      },
    }),
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
    sdJwtVc: new SdJwtVcModule(),
    openid4vc: new OpenId4VcModule({
      app: expressApp,
      issuer: {
        baseUrl:
          process.env.NODE_ENV === 'PROD'
            ? `https://${requireEnv('APP_URL')}/oid4vci`
            : `${requireEnv('AGENT_HTTP_URL')}/oid4vci`,
        app: expressApp,
        statefulCredentialOfferExpirationInSeconds: Number(process.env.OID4VCI_CRED_OFFER_EXPIRY) || 3600,
        accessTokenExpiresInSeconds: Number(process.env.OID4VCI_ACCESS_TOKEN_EXPIRY) || 3600,
        authorizationCodeExpiresInSeconds: Number(process.env.OID4VCI_AUTH_CODE_EXPIRY) || 3600,
        cNonceExpiresInSeconds: Number(process.env.OID4VCI_CNONCE_EXPIRY) || 3600,
        dpopRequired: false,
        credentialRequestToCredentialMapper: (...args) => getMixedCredentialRequestToCredentialMapper()(...args),
      },
      verifier: {
        baseUrl:
          process.env.NODE_ENV === 'PROD'
            ? `https://${requireEnv('APP_URL')}/oid4vp`
            : `${requireEnv('AGENT_HTTP_URL')}/oid4vp`,
        // app: openId4VpApp,
        authorizationRequestExpirationInSeconds: Number(process.env.OID4VP_AUTH_REQUEST_PROOF_REQUEST_EXPIRY) || 3600,
      },
    }),
    openId4VcHolderModule: new OpenId4VcHolderModule(),
    x509: new X509Module({
      getTrustedCertificatesForVerification: async (
        agentContext,
        { certificateChain, verification: _verification },
      ) => {
        //TODO: We need to trust the certificate tenant wise, for that we need to fetch those details from platform
        const tenantId = agentContext.contextCorrelationId

        const authType = getAuthType()

        if (authType === AuthTypes.ClientAuth) {
          return await getX509CertsByClientToken(tenantId, certificateChain)
        }

        // NoAuth: return all certs from the static trust list URL
        return await getX509CertsByUrl()
      },
    }),
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
  autoAcceptCredentials: DidCommAutoAcceptCredential,
  autoAcceptProofs: DidCommAutoAcceptProof,
  walletScheme: AskarMultiWalletDatabaseScheme,
  walletConfig: AskarModuleConfigStoreOptions,
  endpoints: string[],
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
    walletConfig,
    endpoints,
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
    endpoints,
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
    ...afjConfig,
    logger,
    autoUpdateStorageOnStartup: true,
    // Ideally for testing connection between tenant agent we need to set this to 'true'. Default is 'false'
    // TODO: triage: not sure if we want it to be 'true', as it would mean parallel requests on BW
    // Setting it for now //TODO: check if this is needed
    allowInsecureHttpUrls: process.env.ALLOW_INSECURE_HTTP_URLS === 'true',
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

  const parseIndyLedger = afjConfig?.indyLedger ?? []
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
  let modules

  if (afjConfig.tenancy) {
    modules = getWithTenantModules(
      networkConfig,
      didRegistryContractAddress || '',
      fileServerToken || '',
      fileServerUrl || '',
      rpcUrl || '',
      schemaManagerContractAddress || '',
      autoAcceptConnections ?? true,
      autoAcceptCredentials || DidCommAutoAcceptCredential.Always,
      autoAcceptProofs || DidCommAutoAcceptProof.ContentApproved,
      walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
      walletConfig,
      endpoints || [],
    )
  } else {
    modules = getModules(
      networkConfig,
      didRegistryContractAddress || '',
      fileServerToken || '',
      fileServerUrl || '',
      rpcUrl || '',
      schemaManagerContractAddress || '',
      autoAcceptConnections ?? true,
      autoAcceptCredentials || DidCommAutoAcceptCredential.Always,
      autoAcceptProofs || DidCommAutoAcceptProof.ContentApproved,
      walletScheme || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
      walletConfig,
      endpoints || [],
    )
  }

  const agent = new Agent({
    config: agentConfig,
    modules: {
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
  for (const inboundTransport of inboundTransports) {
    const InboundTransport = inboundTransportMapping[inboundTransport.transport]
    const transport = new InboundTransport({ port: inboundTransport.port })
    agent.modules.didcomm.registerInboundTransport(transport)

    // Configure the oid4vc routers on the http inbound transport
    if (transport instanceof DidCommHttpInboundTransport) {
      transport.app.use(
        bodyParser.urlencoded({
          extended: true,
          limit: process.env.APP_URL_ENCODED_BODY_SIZE ?? '5mb',
        }),
      )
      transport.app.use(bodyParser.json({ limit: process.env.APP_JSON_BODY_SIZE ?? '5mb' }))
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
      app: expressApp,
    },
    apiKey,
  )

  logger.info(`*** API Key: ${apiKey}`)

  // Start purge schedulers if enabled (NATS and Cron are independent)
  const purgeConfig = buildPurgeConfig()
  if (purgeConfig) {
    await validatePurgeConfig(purgeConfig)
    initPurgeSchedulers(purgeConfig.natsConfig.enabled, purgeConfig.cronConfig.enabled)

    const purgeWebhookUrl = purgeConfig.webhookEnabled ? webhookUrl : undefined

    if (purgeConfig.natsConfig.enabled) {
      await getNatsPurgeScheduler()!.start(agent, purgeConfig, purgeWebhookUrl)
    }

    if (purgeConfig.cronConfig.enabled) {
      await getCronPurgeScheduler()!.start(agent, purgeConfig, purgeWebhookUrl)
    }
  }

  const server = app.listen(adminPort, () => {
    logger.info(`Successfully started server on port ${adminPort}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    agent.config.logger.info('[Shutdown] Stopping services...')
    server.close()
    await stopPurgeSchedulers()
    await agent.shutdown()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
