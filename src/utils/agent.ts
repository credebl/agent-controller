import type { InitConfig } from '@credo-ts/core'

// import { PolygonModule } from '@ayanworks/credo-polygon-w3c-module'
import {
  AnonCredsModule,
  LegacyIndyDidCommProofFormatService,
  DidCommCredentialV1Protocol,
  DidCommProofV1Protocol,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  AnonCredsDidCommCredentialFormatService,
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
  DidCommHttpOutboundTransport,
  DidCommJsonLdCredentialFormatService,
  DidCommDifPresentationExchangeProofFormatService,
  DidCommAutoAcceptCredential,
  DidCommProofV2Protocol,
  DidCommCredentialV2Protocol,
  DidCommModule,
  DidCommConnectionInvitationMessage
} from '@credo-ts/didcomm'
import { IndyVdrAnonCredsRegistry, IndyVdrModule } from '@credo-ts/indy-vdr'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { TenantsModule } from '@credo-ts/tenants'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'

import { TsLogger } from './logger'

export const setupAgent = async ({ name, endpoints, port }: { name: string; endpoints: string[]; port: number }) => {
  const logger = new TsLogger(LogLevel.debug)

  const config: InitConfig = {
    // endpoints: endpoints,
    logger: logger,
    allowInsecureHttpUrls: process.env.ALLOW_INSECURE_HTTP_URLS === 'true'
  }

  const legacyIndyCredentialFormat = new LegacyIndyDidCommCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyDidCommProofFormatService()
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
        store: {
          id: name,
          key: name
        },
      }),

      anoncreds: new AnonCredsModule({
        registries: [new IndyVdrAnonCredsRegistry()],
        anoncreds,
      }),

      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new WebDidResolver()],
      }),
      tenants: new TenantsModule(),
      didcomm: new DidCommModule({
        processDidCommMessagesConcurrently: true,
        anoncreds: new AnonCredsModule({
          registries: [new IndyVdrAnonCredsRegistry()],
          anoncreds,
        }),
        oob: true,
        mediationRecipient: true,
        messagePickup: true,
        basicMessages: true,
        connections: {
          autoAcceptConnections: true,
        },
        proofs: {
          proofProtocols: [
            new DidCommProofV1Protocol({
              indyProofFormat: legacyIndyProofFormat,
            }),
            new DidCommProofV2Protocol({
              proofFormats: [legacyIndyProofFormat, new AnonCredsDidCommProofFormatService, new DidCommDifPresentationExchangeProofFormatService],
            }),
          ],
        },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.Always,
          credentialProtocols: [
            new DidCommCredentialV1Protocol({
              indyCredentialFormat: legacyIndyCredentialFormat,
            }),
            new DidCommCredentialV2Protocol({
              credentialFormats: [legacyIndyCredentialFormat, new DidCommJsonLdCredentialFormatService(), new AnonCredsDidCommCredentialFormatService()],
            }),
          ],
        },
      }),
      // polygon: new PolygonModule({
      //   didContractAddress: '',
      //   schemaManagerContractAddress: '',
      //   fileServerToken: '',
      //   rpcUrl: '',
      //   serverUrl: '',
      // }),
    },
    dependencies: agentDependencies,
  })

  const httpInbound = new DidCommHttpInboundTransport({
    port: port,
  })

  agent.modules.didcomm.registerInboundTransport(httpInbound)

  agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())

  httpInbound.app.get('/invitation', async (req: { query: { d_m: any; c_i: any }; url: string }, res: { send: (arg0: any) => void }) => {
    if (typeof req.query.d_m === 'string') {
      const invitation = await DidCommConnectionInvitationMessage.fromUrl(req.url.replace('d_m=', 'c_i='))
      res.send(invitation.toJSON())
    }
    if (typeof req.query.c_i === 'string') {
      const invitation = await DidCommConnectionInvitationMessage.fromUrl(req.url)
      res.send(invitation.toJSON())
    } else {
      const { outOfBandInvitation } = await agent.modules.didcomm.oob.createInvitation()

      res.send(outOfBandInvitation.toUrl({ domain: endpoints + '/invitation' }))
    }
  })

  await agent.initialize()

  return agent
}
