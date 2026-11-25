/**
 * Smoke test: OID4VCI issuance of VCDM 2.0 W3C credentials (`ldp_vc` and `jwt_vc_json-ld`).
 *
 * Runs an in-process issuer (the real `getMixedCredentialRequestToCredentialMapper`, the patched
 * `@credo-ts/openid4vc` issuer and the `registerOid4vciV2Signer` hook) and an in-process Credo holder,
 * and redeems a pre-authorized offer for each format. A v1.0 offer is redeemed as a control.
 *
 *   yarn test:oid4vci-v2
 *
 * Like the other smoke tests it runs through Node's native `require(esm)` (Credo is ESM-only).
 */
import type { Server } from 'http'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ConsoleLogger,
  DidJwk,
  DidKey,
  DidsApi,
  DidsModule,
  JwkDidRegistrar,
  JwkDidResolver,
  KeyDidRegistrar,
  KeyDidResolver,
  Kms,
  LogLevel,
  W3cCredentialsModule,
  W3cV2CredentialService,
  W3cV2CredentialsModule,
  W3cV2JwtVerifiableCredential,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { OpenId4VcModule } from '@credo-ts/openid4vc'
import { askar } from '@openwallet-foundation/askar-nodejs'
import express from 'express'

import { CustomDocumentLoader } from '../src/utils/customDocumentLoader'
import { getMixedCredentialRequestToCredentialMapper } from '../src/utils/oid4vc-agent'
import { transformPayloadForVersion } from '../src/utils/vcContext'
import { verifyV2Credential } from '../src/vc-jsonld/verifyV2Credential'
import { assert, uuid } from './smokeTestHelpers'

let lastCredentialResponse: any
const capturingFetch: typeof fetch = async (input: any, init?: any) => {
  const response = await fetch(input, init)
  if (String(typeof input === 'string' ? input : input.url).endsWith('/credential')) {
    lastCredentialResponse = await response.clone().json().catch(() => undefined)
  }
  return response
}

const PORT = 4789
const BASE_URL = `http://localhost:${PORT}/oid4vci`
const ISSUER_ID = 'smoke-issuer'

const SUBJECT = { full_name: 'Ankita Test', date_of_birth: '1995-05-20', country: 'India' }

interface Case {
  name: string
  format: 'ldp_vc' | 'jwt_vc_json-ld'
  version: 'v1.0' | 'v2.0'
}

const CASES: Case[] = [
  { name: 'ldp_vc v1.0 (control)', format: 'ldp_vc', version: 'v1.0' },
  { name: 'jwt_vc_json-ld v1.0 (control)', format: 'jwt_vc_json-ld', version: 'v1.0' },
  { name: 'ldp_vc v2.0', format: 'ldp_vc', version: 'v2.0' },
  { name: 'jwt_vc_json-ld v2.0', format: 'jwt_vc_json-ld', version: 'v2.0' },
]

function configurationId(format: string): string {
  return `Person-${format.replace(/[^a-z]/g, '-')}`
}

function decodeJwt(compact: string): { header: Record<string, unknown>; payload: Record<string, any> } {
  const [header, payload] = compact.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  }
}

async function main(): Promise<void> {
  const app = express()
  const issuerAgent = new Agent({
    config: { allowInsecureHttpUrls: true, label: 'smoke-issuer', logger: new ConsoleLogger(process.env.DEBUG ? LogLevel.error : LogLevel.off) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `issuer-${uuid()}`, key: 'smoke', database: { type: 'sqlite', config: { inMemory: true } } },
      }),
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new JwkDidResolver()],
      }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: CustomDocumentLoader }),
      w3cV2Credentials: new W3cV2CredentialsModule(),
      openid4vc: new OpenId4VcModule({
        app,
        issuer: {
          baseUrl: BASE_URL,
          app,
          dpopRequired: false,
          credentialRequestToCredentialMapper: (...args) => getMixedCredentialRequestToCredentialMapper()(...args),
        },
      }),
    },
  })
  const holderAgent = new Agent({
    config: { allowInsecureHttpUrls: true, label: 'smoke-holder', logger: new ConsoleLogger(process.env.DEBUG ? LogLevel.error : LogLevel.off) },
    dependencies: { ...agentDependencies, fetch: capturingFetch as any },
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `holder-${uuid()}`, key: 'smoke', database: { type: 'sqlite', config: { inMemory: true } } },
      }),
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar(), new JwkDidRegistrar()],
        resolvers: [new KeyDidResolver(), new JwkDidResolver()],
      }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: CustomDocumentLoader }),
      w3cV2Credentials: new W3cV2CredentialsModule(),
      openid4vc: new OpenId4VcModule(),
    },
  })

  await issuerAgent.initialize()
  await holderAgent.initialize()
  const server: Server = app.listen(PORT)

  const failures: string[] = []
  try {
    const created = await issuerAgent.dids.create({
      method: 'key',
      options: { createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
    })
    const issuerDid = created.didState.did as string

    const credentialConfigurationsSupported: Record<string, any> = {}
    for (const format of ['ldp_vc', 'jwt_vc_json-ld']) {
      credentialConfigurationsSupported[configurationId(format)] = {
        format,
        scope: `openid4vc:${configurationId(format)}`,
        cryptographic_binding_methods_supported: ['did:key', 'did:jwk'],
        proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
        credential_definition: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'PersonCredential'],
        },
      }
    }
    await issuerAgent.modules.openid4vc.issuer.createIssuer({
      issuerId: ISSUER_ID,
      credentialConfigurationsSupported,
    })

    for (const testCase of CASES) {
      console.log(`\n[${testCase.name}]`)
      const supportedId = configurationId(testCase.format)
      // The same payload the platform sends, passed through the agent's own version transform.
      const payload = transformPayloadForVersion(
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'PersonCredential'],
          credentialSubject: { ...SUBJECT },
          issuanceDate: '2026-11-25T00:00:00.000Z',
          expirationDate: '2027-11-25T00:00:00.000Z',
        },
        testCase.version === 'v2.0' ? 'v2.0' : undefined,
      )

      try {
        const { credentialOffer, issuanceSession } = await issuerAgent.modules.openid4vc.issuer.createCredentialOffer({
          issuerId: ISSUER_ID,
          credentialConfigurationIds: [supportedId],
          preAuthorizedCodeFlowConfig: {},
          issuanceMetadata: {
            credentials: [
              {
                credentialSupportedId: supportedId,
                signerOptions: { method: 'did', did: issuerDid },
                format: testCase.format,
                payload,
              },
            ],
          },
        })

        const holder = holderAgent.modules.openid4vc.holder
        const resolved = await holder.resolveCredentialOffer(credentialOffer)
        const token = await holder.requestToken({ resolvedCredentialOffer: resolved })
        lastCredentialResponse = undefined
        try {
          await holder.requestCredentials({
            resolvedCredentialOffer: resolved,
            ...token,
            credentialConfigurationIds: [supportedId],
            credentialBindingResolver: async ({ supportedDidMethods, proofTypes, agentContext }) => {
              const algorithm = proofTypes.jwt?.supportedSignatureAlgorithms?.[0] ?? 'EdDSA'
              const kms = agentContext.resolve(Kms.KeyManagementApi)
              const key = await kms.createKeyForSignatureAlgorithm({ algorithm, backend: 'askar' })
              const publicJwk = Kms.PublicJwk.fromUnknown(key.publicJwk)
              const method = supportedDidMethods?.includes('did:jwk') ? 'jwk' : 'key'
              const dids = agentContext.dependencyManager.resolve(DidsApi)
              const didResult = await dids.create({ method, options: { keyId: publicJwk.keyId } })
              const did = didResult.didState.did as string
              const vm =
                method === 'jwk'
                  ? DidJwk.fromDid(did).verificationMethodId
                  : `${did}#${DidKey.fromDid(did).publicJwk.fingerprint}`
              return { method: 'did', didUrls: [vm] }
            },
          })
        } catch (error) {
          // Credo 0.7.4's holder parses W3C credentials as VCDM 1.1 only, so it rejects a v2.0 credential
          // after the issuer has already signed and returned it. The issuer's raw response is checked below.
          if (testCase.version !== 'v2.0') throw error
          console.log(`  (holder could not parse the v2.0 credential: ${error instanceof Error ? error.message.split('\n')[0] : error})`)
        }

        const raw = lastCredentialResponse
        const rawCredential = raw?.credentials?.[0]?.credential ?? raw?.credential
        assert(rawCredential, 'the issuer returned a credential (no server_error)')
        if (testCase.format === 'ldp_vc') {
          assert(rawCredential.proof, 'ldp credential has an embedded proof')
          const context = JSON.stringify(rawCredential['@context'])
          if (testCase.version === 'v2.0') {
            assert(context.includes('credentials/v2'), 'ldp credential uses the credentials/v2 context')
            assert(rawCredential.validFrom, 'ldp credential has validFrom')
            const verified = await verifyV2Credential(issuerAgent.context, { credential: rawCredential })
            assert(verified.isValid, 'the v2.0 ldp credential signature verifies')
          } else {
            assert(context.includes('credentials/v1'), 'ldp credential uses the credentials/v1 context')
          }
          assert(rawCredential.credentialSubject?.full_name === SUBJECT.full_name, 'claims are in the credential')
        } else {
          assert(typeof rawCredential === 'string', 'JWT credential is a compact JWS')
          const { header, payload: jwtPayload } = decodeJwt(rawCredential)
          console.log(`  typ=${String(header.typ)} alg=${String(header.alg)}`)
          const body = jwtPayload.vc ?? jwtPayload
          assert(body.credentialSubject?.full_name === SUBJECT.full_name, 'claims are in the JWT credential')
          if (testCase.version === 'v2.0') {
            const verified = await issuerAgent.dependencyManager
              .resolve(W3cV2CredentialService)
              .verifyCredential(issuerAgent.context, { credential: W3cV2JwtVerifiableCredential.fromCompact(rawCredential) })
            assert(verified.isValid, 'the v2.0 vc+jwt signature verifies')
          }
        }
        void issuanceSession
      } catch (error) {
        const message = error instanceof Error ? `${error.message} | ${error.cause instanceof Error ? error.cause.message : ''}` : String(error)
        console.log(`  FAILED: ${message}`)
        if (process.env.DEBUG && error instanceof Error) console.log(error.stack)
        failures.push(testCase.name)
      }
    }
  } finally {
    server.close()
    await issuerAgent.shutdown()
    await holderAgent.shutdown()
  }

  console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nALL CASES PASSED')
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
