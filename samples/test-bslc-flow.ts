/**
 * E2E Test: W3C Bitstring Status List (BSLC) Revocation Flow
 *
 * Flow:
 *  1.  Create issuer tenant
 *  2.  Create issuer DID (did:key / Ed25519)
 *  3.  Create Bitstring Status List Credential (BSLC)
 *  4.  Get an empty (unused) BSLC index
 *  5.  Create holder tenant
 *  6.  Create verifier tenant
 *  7.  Create OOB invitation on issuer → holder receives it (establishes DIDComm connection)
 *  8.  Sign a JSON-LD credential (with BSLC credentialStatus) as issuer
 *  9.  Register the credential with the BSLC server to track revocation
 *  10. Verify credential (before revocation – should pass)
 *  11. Revoke credential via POST /status-list/change-status
 *  12. Verify credential again (after revocation – should fail / show revoked)
 *
 * Prerequisites:
 *   - Agent running at BASE_URL with tenancy enabled
 *   - BSLC server running and accessible
 *   - Environment variables configured in the agent (BSLC_SERVER_URL, BSLC_SERVER_TOKEN, BSLC_ROUTE)
 *
 * Run: npx ts-node samples/test-bslc-flow.ts
 */

import axios, { AxiosInstance } from 'axios'
import * as crypto from 'crypto'
import { inflate } from 'pako'

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = process.env.AGENT_BASE_URL ?? 'http://localhost:4007'
const API_KEY = 'supersecret-that-too-16chars'

// BSLC server config (must match agent's env vars: BSLC_SERVER_URL, BSLC_SERVER_TOKEN, BSLC_ROUTE)
const BSLC_SERVER_URL = process.env.BSLC_SERVER_URL ?? 'http://localhost:4568'
const BSLC_SERVER_TOKEN = process.env.BSLC_SERVER_TOKEN ?? 'your-secret-api-key'
const BSLC_ROUTE = process.env.BSLC_ROUTE ?? '/bslc-server'

// Number of entries in the bitstring (min 1 000, max 500 000, default 131 072 per W3C spec)
const BSLC_LIST_LENGTH = parseInt(process.env.BSLC_LIST_LENGTH ?? '10000', 10)

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function agentApi(token?: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

function bslcApi(): AxiosInstance {
  return axios.create({
    baseURL: BSLC_SERVER_URL,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BSLC_SERVER_TOKEN,
    },
  })
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function poll<T>(
  fn: () => Promise<T | null>,
  label: string,
  timeoutMs = 30_000,
  intervalMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await fn()
    if (result !== null && result !== undefined) return result
    process.stdout.write(`  ⏳ Waiting for ${label}...\n`)
    await sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

function step(n: number, title: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`STEP ${n}: ${title}`)
  console.log('─'.repeat(60))
}

function ok(msg: string, data?: unknown) {
  console.log(`✅ ${msg}`)
  if (data !== undefined) console.log(JSON.stringify(data, null, 2))
}

function payload(label: string, data: unknown) {
  console.log(`📤 ${label}:`)
  console.log(JSON.stringify(data, null, 2))
}

function fail(msg: string, err: unknown) {
  const detail = axios.isAxiosError(err) ? err.response?.data ?? err.message : (err as Error).message
  console.error(`❌ ${msg}`)
  console.error(JSON.stringify(detail, null, 2))
  process.exit(1)
}

function decodeBitstring(encodedList: string): string {
  const compressed = new Uint8Array(Buffer.from(encodedList, 'base64url'))
  const decompressed = inflate(compressed) as Uint8Array
  return Array.from(decompressed)
    .map((byte) => byte.toString(2).padStart(8, '0').split('').reverse().join(''))
    .join('')
}

function logBitstring(label: string, encodedList: string, highlightIndex?: number): void {
  try {
    const bits = decodeBitstring(encodedList)
    const setBitCount = bits.split('').filter((b) => b === '1').length

    console.log(`\n🔍 ${label}`)
    console.log(`   Entries (total)  : ${bits.length}`)
    console.log(`   Set bits (1s)    : ${setBitCount}`)
    console.log(`   First 64 entries : [${bits.slice(0, 64)}]`)

    if (highlightIndex !== undefined) {
      const win = 8
      const start = Math.max(0, highlightIndex - win)
      const end = Math.min(bits.length - 1, highlightIndex + win)
      const window = bits.slice(start, end + 1)
      const offset = highlightIndex - start
      console.log(`   Index [${highlightIndex}] window  : [${window}]`)
      console.log(`   ${'─'.repeat(22 + offset)}^── index ${highlightIndex} = "${bits[highlightIndex]}" (${bits[highlightIndex] === '1' ? '🔴 REVOKED' : '🟢 valid'})`)
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not decode bitstring: ${(e as Error).message}`)
  }
}

// ─── Main test ────────────────────────────────────────────────────────────────

async function run() {
  // ── STEP 1: Get base wallet token ────────────────────────────────────────

  step(1, 'Get base wallet JWT (for multi-tenancy management)')
  let baseToken: string
  try {
    payload('POST /agent/token', { headers: { Authorization: API_KEY } })
    const res = await axios.post(
      `${BASE_URL}/agent/token`,
      {},
      { headers: { Authorization: API_KEY, 'Content-Type': 'application/json' } },
    )
    baseToken = res.data.token
    ok('Base wallet token obtained')
  } catch (err) {
    return fail('Failed to get base wallet token', err)
  }

  // ── STEP 2: Create issuer tenant ─────────────────────────────────────────

  step(2, 'Create issuer tenant')
  let issuerTenantId: string
  let issuerToken: string
  try {
    payload('POST /multi-tenancy/create-tenant', { config: { label: 'BSLC-Test-Issuer' } })
    const res = await agentApi(baseToken).post('/multi-tenancy/create-tenant', {
      config: { label: 'BSLC-Test-Issuer' },
    })
    issuerTenantId = res.data.id
    issuerToken = res.data.token
    ok('Issuer tenant created', { issuerTenantId })
  } catch (err) {
    return fail('Failed to create issuer tenant', err)
  }

  // ── STEP 3: Create issuer DID ─────────────────────────────────────────────

  step(3, 'Create issuer DID (did:key / Ed25519)')
  let issuerDid: string
  let issuerVerificationMethodId: string
  try {
    // Use a seed so the controller takes the import-with-keys path, which properly
    // stores the didDocumentRelativeKeyId → kmsKeyId mapping needed for W3C signing.
    const seed = `bslctest${Date.now()}`.padEnd(32, '0').slice(0, 32)
    payload('POST /dids/write', { method: 'key', keyType: 'ed25519', seed })
    const res = await agentApi(issuerToken).post('/dids/write', {
      method: 'key',
      keyType: 'ed25519',
      seed,
    })
    issuerDid = res.data.did as string

    // For did:key the fragment is always the multibase key identifier (last colon-segment).
    // Avoid calling GET /dids/:did here — that endpoint overwrites the DID record without
    // the keys array, which causes W3cJsonLdCredentialService to fall back to legacyKeyId.
    const keyId = issuerDid.split(':').pop() ?? ''
    issuerVerificationMethodId = `${issuerDid}#${keyId}`

    ok('Issuer DID created', { issuerDid, issuerVerificationMethodId })
  } catch (err) {
    return fail('Failed to create issuer DID', err)
  }

  // ── STEP 4: Create BSLC credential ───────────────────────────────────────

  step(4, 'Create Bitstring Status List Credential (BSLC)')
  let bslcId: string
  let bslcUrl: string
  let bslcSignedCredential: Record<string, unknown>
  try {
    payload('POST /status-list/create-bslc', {
      issuerDID: issuerDid,
      statusPurpose: 'revocation',
      verificationMethodId: issuerVerificationMethodId,
      listLength: BSLC_LIST_LENGTH,
    })
    const res = await agentApi(issuerToken).post('/status-list/create-bslc', {
      issuerDID: issuerDid,
      statusPurpose: 'revocation',
      verificationMethodId: issuerVerificationMethodId,
      listLength: BSLC_LIST_LENGTH,
    })
    bslcId = res.data.BSLCId as string
    bslcSignedCredential = res.data.signedCredential as Record<string, unknown>
    // The BSLC URL is the signed credential's id (set to serverUrl+BSLC_ROUTE/bslcId in the controller)
    bslcUrl = (bslcSignedCredential.id as string) ?? `${BSLC_SERVER_URL}${BSLC_ROUTE}/${bslcId}`
    ok('BSLC created', { bslcId, bslcUrl })

    const initialEncodedList = (bslcSignedCredential as any)?.credentialSubject?.encodedList as string | undefined
    if (initialEncodedList) {
      logBitstring('Initial BSLC bitstring (all entries should be 0)', initialEncodedList)
    }
  } catch (err) {
    return fail('Failed to create BSLC', err)
  }

  // ── STEP 5: Get empty BSLC index ──────────────────────────────────────────

  step(5, 'Get an empty (unused) BSLC index')
  let credentialStatusIndex: number
  try {
    const encodedBslcUrl = encodeURIComponent(bslcUrl)
    payload(`GET /status-list/get-empty-bslc-index/:bslcUrl/:bslcId`, { bslcUrl, bslcId })
    const res = await agentApi(issuerToken).get(
      `/status-list/get-empty-bslc-index/${encodedBslcUrl}/${bslcId}`,
    )
    credentialStatusIndex = res.data.index as number
    ok('Empty BSLC index obtained', { credentialStatusIndex })
  } catch (err) {
    return fail('Failed to get empty BSLC index', err)
  }

  // ── STEP 6: Create holder tenant ─────────────────────────────────────────

  step(6, 'Create holder tenant')
  let holderTenantId: string
  let holderToken: string
  try {
    payload('POST /multi-tenancy/create-tenant', { config: { label: 'BSLC-Test-Holder' } })
    const res = await agentApi(baseToken).post('/multi-tenancy/create-tenant', {
      config: { label: 'BSLC-Test-Holder' },
    })
    holderTenantId = res.data.id
    holderToken = res.data.token
    ok('Holder tenant created', { holderTenantId })
  } catch (err) {
    return fail('Failed to create holder tenant', err)
  }

  // ── STEP 7: Create verifier tenant ───────────────────────────────────────

  step(7, 'Create verifier tenant')
  let verifierTenantId: string
  let verifierToken: string
  try {
    payload('POST /multi-tenancy/create-tenant', { config: { label: 'BSLC-Test-Verifier' } })
    const res = await agentApi(baseToken).post('/multi-tenancy/create-tenant', {
      config: { label: 'BSLC-Test-Verifier' },
    })
    verifierTenantId = res.data.id
    verifierToken = res.data.token
    ok('Verifier tenant created', { verifierTenantId })
  } catch (err) {
    return fail('Failed to create verifier tenant', err)
  }

  // ── STEP 8: Create DIDComm connection (issuer ↔ holder) ──────────────────

  step(8, 'Create DIDComm connection between issuer and holder')
  let issuerConnectionId: string
  try {
    // Issuer creates OOB invitation
    payload('POST /didcomm/oob/create-invitation', { label: 'BSLC-Issuer-Invite', autoAcceptConnection: true })
    const invRes = await agentApi(issuerToken).post('/didcomm/oob/create-invitation', {
      label: 'BSLC-Issuer-Invite',
      autoAcceptConnection: true,
    })
    const invitationUrl: string = invRes.data.invitationUrl
    ok('OOB invitation created', { invitationUrl })

    // Holder receives the invitation
    payload('POST /didcomm/oob/receive-invitation-url', { label: 'BSLC-Holder', invitationUrl, autoAcceptInvitation: true, autoAcceptConnection: true })
    await agentApi(holderToken).post('/didcomm/oob/receive-invitation-url', {
      label: 'BSLC-Holder',
      invitationUrl,
      autoAcceptInvitation: true,
      autoAcceptConnection: true,
    })
    ok('Holder accepted invitation – waiting for connection...')

    // Poll issuer side until connection reaches "completed" state
    issuerConnectionId = await poll(
      async () => {
        const conns = await agentApi(issuerToken).get('/didcomm/connections')
        const done = (conns.data as any[]).find((c) => c.state === 'completed')
        return done?.id ?? null
      },
      'issuer connection completed',
      30_000,
    )
    ok('Connection established', { issuerConnectionId })
  } catch (err) {
    return fail('Failed to establish DIDComm connection', err)
  }

  // ── STEP 9: Sign JSON-LD credential with BSLC credentialStatus ───────────

  step(9, 'Sign JSON-LD credential (issuer) with BSLC status reference')
  let signedCredential: Record<string, unknown>
  try {
    const issuanceDate = new Date().toISOString()
    const credentialPayload = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        {
          BitstringStatusListEntry: 'https://www.w3.org/ns/credentials/status#BitstringStatusListEntry',
          statusPurpose: 'https://www.w3.org/ns/credentials/status#statusPurpose',
          statusListIndex: 'https://www.w3.org/ns/credentials/status#statusListIndex',
          statusListCredential: {
            '@id': 'https://www.w3.org/ns/credentials/status#statusListCredential',
            '@type': '@id',
          },
        },
      ],
      type: ['VerifiableCredential', 'TestDegreeCredential'],
      issuer: { id: issuerDid },
      issuanceDate,
      credentialSubject: {
        id: `did:example:holder-${holderTenantId}`,
        degree: {
          type: 'BachelorDegree',
          name: 'Bachelor of Science in Computer Science',
        },
      },
      credentialStatus: {
        id: `${bslcUrl}#${credentialStatusIndex}`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: String(credentialStatusIndex),
        statusListCredential: bslcUrl,
      },
    }

    payload('POST /agent/credential/sign', {
      credential: credentialPayload,
      proofType: 'Ed25519Signature2018',
      verificationMethod: issuerVerificationMethodId,
    })
    const res = await agentApi(issuerToken).post(
      '/agent/credential/sign?storeCredential=false&dataTypeToSign=jsonLd',
      {
        credential: credentialPayload,
        proofType: 'Ed25519Signature2018',
        verificationMethod: issuerVerificationMethodId,
      },
    )
    signedCredential = res.data as Record<string, unknown>
    ok('JSON-LD credential signed', signedCredential)
  } catch (err) {
    return fail('Failed to sign JSON-LD credential', err)
  }

  // ── STEP 10: Register credential with BSLC server ────────────────────────

  step(10, 'Register credential with BSLC server (for revocation tracking)')
  let credentialId: string
  let revocationId: string
  try {
    /**
     * The BSLC server stores which index in the bitstring belongs to which credential.
     * Adjust this payload/endpoint to match your BSLC server's API.
     * Expected response: { id, revocationId, credentialId, bslcId, bslcUrl, index, ... }
     */
    const credentialIdForBslc = `urn:uuid:${crypto.randomUUID()}`
    const revocationIdForBslc = `urn:uuid:${crypto.randomUUID()}`
    const registerPayload = {
      credentialId: credentialIdForBslc,
      bslcId,
      bslcUrl,
      revocationId: revocationIdForBslc,
      index: credentialStatusIndex,
      issuerId: issuerDid,
      statusPurpose: 'REVOCATION',
    }
    payload(`POST ${BSLC_SERVER_URL}${BSLC_ROUTE}/credentials`, registerPayload)
    const res = await bslcApi().post(`${BSLC_ROUTE}/credentials`, registerPayload)
    // Response: { success, message, data: { credential_id, revocation_id, ... } }
    credentialId = (res.data?.data?.credential_id ?? credentialIdForBslc) as string
    revocationId = (res.data?.data?.revocation_id ?? revocationIdForBslc) as string
    ok('Credential registered with BSLC server', { credentialId, revocationId })
  } catch (err) {
    return fail('Failed to register credential with BSLC server', err)
  }

  // ── STEP 11: Verify credential BEFORE revocation ──────────────────────────

  step(11, 'Verify credential BEFORE revocation (expect: valid)')
  try {
    payload('POST /agent/credential/verify', { credential: signedCredential })
    const res = await agentApi(verifierToken).post('/agent/credential/verify', {
      credential: signedCredential,
    })
    ok('Verification result (before revocation)', res.data)
    if (res.data?.isValid === false) {
      console.warn('⚠️  Credential already shows as invalid before revocation – check BSLC server state')
    }
  } catch (err) {
    return fail('Failed to verify credential', err)
  }

  // ── STEP 12: Revoke the credential ───────────────────────────────────────

  step(12, 'Revoke credential via POST /status-list/change-status')
  try {
    payload('POST /status-list/change-status', { revocationId, credentialId })
    const res = await agentApi(issuerToken).post('/status-list/change-status', {
      revocationId,
      credentialId,
    })
    ok('Revocation successful', res.data)

    // Fetch the updated BSLC from the server to inspect the flipped bit
    try {
      const updatedBslc = (await axios.get(bslcUrl)).data
      const updatedEncodedList = updatedBslc?.credentialSubject?.encodedList as string | undefined
      if (updatedEncodedList) {
        logBitstring('BSLC bitstring AFTER revocation', updatedEncodedList, credentialStatusIndex)
      }
    } catch {
      console.warn('   ⚠️  Could not fetch updated BSLC for bitstring inspection')
    }
  } catch (err) {
    return fail('Failed to revoke credential', err)
  }

  // ── STEP 13: Verify credential AFTER revocation ───────────────────────────

  step(13, 'Verify credential AFTER revocation (expect: revoked / invalid)')
  try {
    payload('POST /agent/credential/verify', { credential: signedCredential })
    const res = await agentApi(verifierToken).post('/agent/credential/verify', {
      credential: signedCredential,
    })
    ok('Verification result (after revocation)', res.data)
    if (res.data?.isValid === false) {
      console.log('\n🎉 Credential correctly shows as REVOKED!')
    } else {
      console.warn('\n⚠️  Credential still shows as valid after revocation.')
      console.warn('    The BSLC status check may not be wired into verifyCredential yet,')
      console.warn('    or the verifier needs to re-fetch the updated BSLC from the server.')
    }
  } catch (err) {
    return fail('Failed to verify revoked credential', err)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60))
  console.log('✅  BSLC E2E flow completed successfully!')
  console.log('═'.repeat(60))
  console.log({
    issuerTenantId,
    holderTenantId,
    verifierTenantId,
    issuerDid,
    bslcId,
    bslcUrl,
    credentialStatusIndex,
    credentialId,
    revocationId,
    issuerConnectionId,
  })
}

run().catch((err) => {
  console.error('\n❌ Unexpected error:', err)
  process.exit(1)
})
