/**
 * Integration check for the bitstring status list flow against a running
 * status-list-server.
 *
 *   STATUS_LIST_SERVER_URL=http://localhost:3003 \
 *   STATUS_LIST_API_KEY=dev-key \
 *   node -r ts-node/register/transpile-only tests/bitstring-status-list.integration.ts
 */
import '@openwallet-foundation/askar-nodejs'

import type { InitConfig, JsonObject } from '@credo-ts/core'

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
import { decodeBitstring, getBit } from '../src/utils/bitstring'
import {
  checkAndCreateBitstringStatusList,
  getServerUrl,
  revokeBitstringInStatusList,
} from '../src/utils/statusListService'
import { verifyV2Credential } from '../src/vc-jsonld/verifyV2Credential'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
  console.log(`  ok - ${message}`)
}

async function fetchCredential(listId: string): Promise<JsonObject> {
  const res = await fetch(`${getServerUrl()}/status-lists/${listId}`)
  assert(res.ok, `GET /status-lists/${listId} returned ${res.status}`)
  return (await res.json()) as JsonObject
}

function readBits(credential: JsonObject): Uint8Array {
  const subjectValue = credential.credentialSubject
  const subject = (Array.isArray(subjectValue) ? subjectValue[0] : subjectValue) as
    | Record<string, unknown>
    | undefined
  if (!subject || typeof subject.encodedList !== 'string') {
    throw new Error('credentialSubject.encodedList is missing')
  }
  return decodeBitstring(subject.encodedList)
}

async function main(): Promise<void> {
  if (!process.env.STATUS_LIST_SERVER_URL) {
    throw new Error('STATUS_LIST_SERVER_URL is required')
  }
  if (!process.env.STATUS_LIST_API_KEY) {
    throw new Error('STATUS_LIST_API_KEY is required')
  }

  const config: InitConfig = {
    label: 'bitstring-status-list-integration',
    logger: new ConsoleLogger(LogLevel.off),
  }

  const agent = new Agent({
    config,
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `bitstring-integration-${uuid()}`,
          key: 'bitstring-integration-key',
          database: { type: 'sqlite', config: { inMemory: true } },
        },
      }),
      dids: new DidsModule({ registrars: [new KeyDidRegistrar()], resolvers: [new KeyDidResolver()] }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: CustomDocumentLoader }),
      w3cV2Credentials: new W3cV2CredentialsModule(),
    },
  })

  await agent.initialize()

  try {
    const created = await agent.dids.create({
      method: 'key',
      options: { createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
    })
    const did = created.didState.did as string
    const listId = uuid()

    await checkAndCreateBitstringStatusList(agent, listId, did)
    console.log(`\n[1] created bitstring list ${listId}`)

    const before = await fetchCredential(listId)
    assert(!getBit(readBits(before), 0), 'bit 0 starts unset')
    assert((await verifyV2Credential(agent.context, { credential: before })).isValid, 'published list verifies')

    await revokeBitstringInStatusList(agent, listId, 0, did)
    console.log('\n[2] revoked index 0')

    const after = await fetchCredential(listId)
    assert(getBit(readBits(after), 0), 'bit 0 is set after revoke')
    assert((await verifyV2Credential(agent.context, { credential: after })).isValid, 're-signed list verifies')

    console.log('\nALL BITSTRING STATUS LIST CHECKS PASSED')
  } finally {
    await agent.shutdown()
  }
}

main().catch((error) => {
  console.error('\nBITSTRING STATUS LIST CHECK FAILED:\n', error)
  process.exit(1)
})
