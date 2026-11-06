/**
 * Phase 6.0 gate: proves Bitstring Status List fields survive Credo's VCDM 1.0
 * `W3cCredential` + `W3cCredentialStatus` JSON transformation and signing.
 *
 *   yarn test:v1-status-roundtrip
 */
import '@openwallet-foundation/askar-nodejs'

import type { InitConfig } from '@credo-ts/core'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ClaimFormat,
  ConsoleLogger,
  DidsModule,
  JsonTransformer,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  W3cCredential,
  W3cCredentialsModule,
  W3cV2CredentialsModule,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'

import { CustomDocumentLoader } from '../src/utils/customDocumentLoader'

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

async function main(): Promise<void> {
  const config: InitConfig = {
    label: 'v1-bitstring-roundtrip-smoke',
    logger: new ConsoleLogger(LogLevel.off),
  }

  const agent = new Agent({
    config,
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `v1-bitstring-smoke-${uuid()}`,
          key: 'v1-bitstring-smoke-key',
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
    const verificationMethod = created.didState.didDocument?.verificationMethod?.[0]?.id as string

    const credentialStatus = {
      id: 'https://status.example.com/status-lists/1#1',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '1',
      statusListCredential: 'https://status.example.com/status-lists/1',
    }

    const credential = JsonTransformer.fromJSON(
      {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://w3id.org/security/suites/ed25519-2020/v1',
          'https://w3id.org/vc/status-list/2021/v1',
        ],
        id: 'https://example.com/credentials/1',
        type: ['VerifiableCredential'],
        issuer: did,
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: 'did:key:z6Mkholder' },
        credentialStatus,
      },
      W3cCredential,
    )

    const transformed = JsonTransformer.toJSON(credential) as { credentialStatus?: Record<string, unknown> }
    assert(
      transformed.credentialStatus?.statusPurpose === 'revocation',
      'statusPurpose survives W3cCredential JSON transformation',
    )
    assert(transformed.credentialStatus?.statusListIndex === '1', 'statusListIndex survives transformation')
    assert(
      transformed.credentialStatus?.statusListCredential === credentialStatus.statusListCredential,
      'statusListCredential survives transformation',
    )

    const signed = await agent.w3cCredentials.signCredential({
      credential,
      format: ClaimFormat.LdpVc,
      verificationMethod,
      proofType: 'Ed25519Signature2018',
    })
    const signedJson = signed.toJson() as { credentialStatus?: Record<string, unknown> }
    assert(
      signedJson.credentialStatus?.statusPurpose === 'revocation',
      'statusPurpose survives VCDM 1.0 signing',
    )
    assert(signedJson.credentialStatus?.statusListIndex === '1', 'statusListIndex survives signing')
    assert(
      signedJson.credentialStatus?.statusListCredential === credentialStatus.statusListCredential,
      'statusListCredential survives signing',
    )

    console.log('\nPHASE 6.0 GATE PASSED')
  } finally {
    await agent.shutdown()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
