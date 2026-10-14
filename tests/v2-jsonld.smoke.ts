/**
 * Phase 0 spike / smoke test for VCDM 2.0 (`ldp_vc`) JSON-LD signing and verification.
 *
 * Credo 0.6.2 is ESM-only (`.mjs`, no `require` condition) and the repository's Jest
 * setup runs with ts-jest in CJS mode, which cannot load Credo. This smoke test is
 * therefore executed directly with Node 22's native `require(esm)` support via ts-node:
 *
 *   yarn test:vc-jsonld
 *
 * It validates that a VCDM 2.0 `ldp_vc` credential can be signed and verified using
 * Credo's low-level Data Integrity primitives (see `src/vc-jsonld`).
 */
import '@openwallet-foundation/askar-nodejs'

import type { InitConfig, JsonObject } from '@credo-ts/core'

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
  W3cCredentialsModule,
  W3cV2Credential,
  W3cV2CredentialService,
  W3cV2CredentialsModule,
  W3cV2JwtVerifiableCredential,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'

import { CustomDocumentLoader } from '../src/utils/customDocumentLoader'
import { CREDENTIALS_V2_CONTEXT_URL, STATUS_V1_CONTEXT_URL } from '../src/vc-jsonld/constants'
import { getInlineContext } from '../src/vc-jsonld/contexts'
import { signV2Credential } from '../src/vc-jsonld/signV2Credential'
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

async function main(): Promise<void> {
  const config: InitConfig = {
    label: 'v2-jsonld-smoke',
    logger: new ConsoleLogger(LogLevel.off),
  }

  const agent = new Agent({
    config,
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `v2-smoke-${uuid()}`,
          key: 'v2-jsonld-smoke-key',
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
    const verificationMethod = created.didState.didDocument?.assertionMethod?.[0] as string
    console.log('did:', did)
    console.log('vm type:', (created.didState.didDocument as any)?.verificationMethod?.[0]?.type)

    console.log('\n[1] inline contexts')
    assert(getInlineContext(CREDENTIALS_V2_CONTEXT_URL), 'credentials/v2 served inline')
    assert(getInlineContext(STATUS_V1_CONTEXT_URL), 'status/v1 served inline')

    console.log('\n[2] sign + verify VCDM 2.0 ldp_vc')
    const credential: JsonObject = {
      '@context': [CREDENTIALS_V2_CONTEXT_URL],
      id: `urn:uuid:${uuid()}`,
      type: ['VerifiableCredential'],
      issuer: did,
      validFrom: new Date().toISOString(),
      credentialSubject: { id: 'did:example:subject', name: 'Alice' },
    }
    const signed = await signV2Credential(agent.context, { credential, verificationMethod })
    assert((signed.proof as JsonObject)?.type === 'Ed25519Signature2018', 'proof type Ed25519Signature2018')
    const verified = await verifyV2Credential(agent.context, { credential: signed as JsonObject })
    assert(verified.isValid, 'signed V2 credential verifies')
    if (!verified.isValid) console.log('  verify error:', verified.error)

    console.log('\n[3] tamper detection')
    const tampered: JsonObject = { ...signed, credentialSubject: { id: 'did:example:subject', name: 'Mallory' } }
    const bad = await verifyV2Credential(agent.context, { credential: tampered })
    assert(!bad.isValid, 'tampered credential rejected')

    console.log('\n[4] BitstringStatusListCredential (credentials/v2 provides the Bitstring terms)')
    const statusCredential: JsonObject = {
      '@context': [CREDENTIALS_V2_CONTEXT_URL],
      id: 'https://example.com/status-lists/1',
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: did,
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: 'https://example.com/status-lists/1#list',
        type: 'BitstringStatusList',
        statusPurpose: 'revocation',
        encodedList: 'uH4sIAAAAAAAAA-3BMQ0AAAgDsPm_BQcQ7KCqAAAAAAAAAAAAAAAAAOA3Aw',
      },
    }
    const signedStatus = (await signV2Credential(agent.context, {
      credential: statusCredential,
      verificationMethod,
    })) as JsonObject
    const statusVerified = await verifyV2Credential(agent.context, { credential: signedStatus })
    assert(statusVerified.isValid, 'status list credential verifies')

    console.log('\n[5] credential with BitstringStatusListEntry credentialStatus')
    const withStatus: JsonObject = {
      '@context': [CREDENTIALS_V2_CONTEXT_URL],
      id: `urn:uuid:${uuid()}`,
      type: ['VerifiableCredential'],
      issuer: did,
      validFrom: new Date().toISOString(),
      credentialSubject: { id: 'did:example:subject', name: 'Alice' },
      credentialStatus: {
        id: 'https://example.com/status-lists/1#7',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '7',
        statusListCredential: 'https://example.com/status-lists/1',
      },
    }
    const signedWithStatus = (await signV2Credential(agent.context, {
      credential: withStatus,
      verificationMethod,
    })) as JsonObject
    const wsVerified = await verifyV2Credential(agent.context, { credential: signedWithStatus })
    assert(wsVerified.isValid, 'credential with status entry verifies')

    console.log('\n[6] Ed25519Signature2020 with did:key Ed25519 (Documented limitation)')
    const signed2020 = (await signV2Credential(agent.context, {
      credential: { ...credential, id: `urn:uuid:${uuid()}` },
      verificationMethod,
      proofType: 'Ed25519Signature2020',
    })) as JsonObject
    const v2020 = await verifyV2Credential(agent.context, { credential: signed2020 })
    assert(!v2020.isValid, 'Ed25519Signature2020 signs but fails verification with Ed25519VerificationKey2018 VM')

    console.log('\n[7] status/v1 alongside credentials/v2 (Documented conflict)')
    let conflictThrown = false
    try {
      await signV2Credential(agent.context, {
        credential: {
          ...statusCredential,
          id: 'https://example.com/status-lists/2',
          '@context': [CREDENTIALS_V2_CONTEXT_URL, STATUS_V1_CONTEXT_URL],
        },
        verificationMethod,
      })
    } catch (error) {
      conflictThrown = (error as Error).message.includes('protected term')
    }
    assert(conflictThrown, 'credentials/v2 + status/v1 fails with a protected term redefinition')

    console.log('\n[8] jwt_vc_json-ld (VCDM 2.0 payload inside a JWT, via Credo V2 service)')
    const v2JwtCredentialService = agent.context.dependencyManager.resolve(W3cV2CredentialService)
    const v2Credential = JsonTransformer.fromJSON(
      {
        '@context': [CREDENTIALS_V2_CONTEXT_URL],
        id: `urn:uuid:${uuid()}`,
        type: ['VerifiableCredential'],
        issuer: did,
        validFrom: new Date().toISOString(),
        credentialSubject: { id: 'did:example:subject', name: 'Alice' },
      },
      W3cV2Credential,
    )
    const signedJwt = await v2JwtCredentialService.signCredential(agent.context, {
      format: ClaimFormat.JwtW3cVc,
      credential: v2Credential,
      verificationMethod,
      alg: 'EdDSA',
    })
    assert(signedJwt.encoded.split('.').length === 3, 'jwt_vc_json-ld produced a compact JWS')
    const jwtVerified = await v2JwtCredentialService.verifyCredential(agent.context, {
      credential: W3cV2JwtVerifiableCredential.fromCompact(signedJwt.encoded),
    })
    assert(jwtVerified.isValid, 'jwt_vc_json-ld verifies')

    console.log('\nALL SPIKE CHECKS PASSED')
  } finally {
    await agent.shutdown()
  }
}

main().catch((error) => {
  console.error('\nSPIKE FAILED:\n', error)
  process.exit(1)
})
