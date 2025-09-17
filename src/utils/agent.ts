import type { InitConfig } from '@credo-ts/core'

import { PolygonModule } from '@ayanworks/credo-polygon-w3c-module'
import {
  AnonCredsModule,
  LegacyIndyCredentialFormatService,
  LegacyIndyProofFormatService,
  V1CredentialProtocol,
  V1ProofProtocol,
  AnonCredsCredentialFormatService,
  AnonCredsProofFormatService,
} from '@credo-ts/anoncreds'
import { AskarModule } from '@credo-ts/askar'
import {
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  WebDidResolver,
  Agent,
  LogLevel,
} from '@credo-ts/core'

import {
  HttpOutboundTransport,
  JsonLdCredentialFormatService,
  DifPresentationExchangeProofFormatService,
  ProofsModule,
  AutoAcceptCredential,
  V2ProofProtocol,
  CredentialsModule,
  V2CredentialProtocol,
  DidCommModule,
  OutOfBandModule,
  MediationRecipientModule,
  BasicMessagesModule,
  ConnectionInvitationMessage
} from '@credo-ts/didcomm'
import { IndyVdrAnonCredsRegistry, IndyVdrModule } from '@credo-ts/indy-vdr'
import { agentDependencies, HttpInboundTransport } from '@credo-ts/node'
import { TenantsModule } from '@credo-ts/tenants'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'

import { TsLogger } from './logger'

export const setupAgent = async ({ name, endpoints, port }: { name: string; endpoints: string[]; port: number }) => {
  const logger = new TsLogger(LogLevel.debug)

  const config: InitConfig = {
    label: name,
    // endpoints: endpoints,
    walletConfig: {
      id: name,
      key: name,
    },
    logger: logger,
    allowInsecureHttpUrls: process.env.ALLOW_INSECURE_HTTP_URLS === 'true'
  }

  const legacyIndyCredentialFormat = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyProofFormatService()
  const agent = new Agent({
    config: config,
    modules: {
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            isProduction: false,
            indyNamespace: 'bcovrin:test',
            genesisTransactions: process.env.BCOVRIN_TEST_GENESIS as string,
            connectOnStartup: true,
          },
        ],
      }),
      askar: new AskarModule({
        askar,
      }),

      anoncreds: new AnonCredsModule({
        registries: [new IndyVdrAnonCredsRegistry()],
        anoncreds,
      }),

      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new WebDidResolver()],
      }),
      proofs: new ProofsModule({
        proofProtocols: [
          new V1ProofProtocol({
            indyProofFormat: legacyIndyProofFormat,
          }),
          new V2ProofProtocol({
            proofFormats: [
              legacyIndyProofFormat,
              new AnonCredsProofFormatService(),
              new DifPresentationExchangeProofFormatService(),
            ],
          }),
        ],
      }),
      credentials: new CredentialsModule({
        autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
        credentialProtocols: [
          new V1CredentialProtocol({
            indyCredentialFormat: legacyIndyCredentialFormat,
          }),
          new V2CredentialProtocol({
            credentialFormats: [
              legacyIndyCredentialFormat,
              new JsonLdCredentialFormatService(),
              new AnonCredsCredentialFormatService(),
            ],
          }),
        ],
      }),
      tenants: new TenantsModule(),
      didcomm: new DidCommModule({
        processDidCommMessagesConcurrently: true,
      }),
      oob: new OutOfBandModule(),
      mediationRecipient: new MediationRecipientModule(),
      basicMessages: new BasicMessagesModule(),
      polygon: new PolygonModule({
        didContractAddress: '',
        schemaManagerContractAddress: '',
        fileServerToken: '',
        rpcUrl: '',
        serverUrl: '',
      }),
    },
    dependencies: agentDependencies,
  })

  const httpInbound = new HttpInboundTransport({
    port: port,
  })

  agent.modules.didcomm.registerInboundTransport(httpInbound)

  agent.modules.didcomm.registerOutboundTransport(new HttpOutboundTransport())

  httpInbound.app.get('/invitation', async (req, res) => {
    if (typeof req.query.d_m === 'string') {
      const invitation = await ConnectionInvitationMessage.fromUrl(req.url.replace('d_m=', 'c_i='))
      res.send(invitation.toJSON())
    }
    if (typeof req.query.c_i === 'string') {
      const invitation = await ConnectionInvitationMessage.fromUrl(req.url)
      res.send(invitation.toJSON())
    } else {
      const { outOfBandInvitation } = await agent.modules.oob.createInvitation()

      res.send(outOfBandInvitation.toUrl({ domain: endpoints + '/invitation' }))
    }
  })

  await agent.initialize()

  return agent
}
