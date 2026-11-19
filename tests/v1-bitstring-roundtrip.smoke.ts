/**
 * Phase 6.0 gate: proves Bitstring Status List fields survive Credo's VCDM 1.0
 * `W3cCredential` + `W3cCredentialStatus` JSON transformation and signing.
 *
 *   yarn test:v1-status-roundtrip
 */
import { ClaimFormat, JsonTransformer, W3cCredential } from '@credo-ts/core'

import { assert, createSmokeAgent, uuid } from './smokeTestHelpers'

async function main(): Promise<void> {
  const agent = createSmokeAgent({
    label: 'v1-bitstring-roundtrip-smoke',
    storeId: `v1-bitstring-smoke-${uuid()}`,
    storeKey: 'v1-bitstring-smoke-key',
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
    assert(signedJson.credentialStatus?.statusPurpose === 'revocation', 'statusPurpose survives VCDM 1.0 signing')
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
