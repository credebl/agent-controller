import '@openwallet-foundation/askar-nodejs'

import type { InitConfig } from '@credo-ts/core'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ConsoleLogger,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  W3cCredentialsModule,
  W3cV2CredentialsModule,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'

import { CustomDocumentLoader } from '../src/utils/customDocumentLoader'

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
  console.log(`  ok - ${message}`)
}

export function createSmokeAgent(options: { label: string; storeId: string; storeKey: string }) {
  const config: InitConfig = {
    label: options.label,
    logger: new ConsoleLogger(LogLevel.off),
  }

  return new Agent({
    config,
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: options.storeId,
          key: options.storeKey,
          database: { type: 'sqlite', config: { inMemory: true } },
        },
      }),
      dids: new DidsModule({ registrars: [new KeyDidRegistrar()], resolvers: [new KeyDidResolver()] }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: CustomDocumentLoader }),
      w3cV2Credentials: new W3cV2CredentialsModule(),
    },
  })
}
