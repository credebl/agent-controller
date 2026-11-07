# Encrypted DID key import

This document describes how CREDEBL imports an existing private key for `did:key`, `did:web` and `did:x509`
without letting the key travel in plaintext through the API gateway, NATS, the agent service, the agent's HTTP
layer or any log.

The same protocol is used by Studio, by any browser client and by non-browser API clients and CLIs. The only
difference is which HTTP endpoint the client calls: the platform gateway (mediated flow) or the agent controller
directly (CLI / agent credential flow).

## Problem

The legacy API accepted `privateKey` (PEM or base64 DER) and `privateKeyJwk` in the create DID body. That body is
serialized by the API gateway, published over NATS as a JSON message, received by the agent service and forwarded
to the agent over HTTP. Any error path that echoed the request body, any request logger, any NATS trace and any
reverse proxy access log could capture the private key.

Encrypting only the transport is not enough: TLS terminates at every hop. The key must be encrypted to the agent
that will own it, before it leaves the client.

## Flow

```
client                         gateway / NATS / agent-service                 agent
  |                                        |                                     |
  |-- POST .../did/import/session -------->|------------------------------------>|
  |                                        |                          create RSA-3072 key pair
  |<-- sessionId, publicKeyJwk, exp -------|<------------------------------------|
  |                                                                              |
  |  encrypt { privateKey | privateKeyJwk, passphrase? } to the public key       |
  |  as a compact JWE (RSA-OAEP-256 + A256GCM)                                   |
  |                                                                              |
  |-- POST .../did { encryptedKey: { sessionId, jwe } } ------------------------>|
  |                                        |        ciphertext only              |
  |                                        |------------------------------------>| decrypt, import into KMS,
  |                                        |                                     | create DID, persist DID
  |<-- did, didDocument, kmsBackend ---------------------------------------------|
```

The platform stores the DID in the same call, so a direct browser → agent request is not required. If a client
calls the agent directly, the client must update the platform (or use the platform-mediated flow) so the
organization's DID list contains the new DID.

### Session creation

`POST /orgs/:orgId/agents/did/import/session` (gateway) or `POST /dids/import/session` (agent controller)

```json
{ "method": "key" }
```

`method` is `key`, `web` or `x509`. The response is:

```json
{
  "sessionId": "…",
  "kid": "…",
  "method": "key",
  "expiresAt": "2026-11-07T12:00:00.000Z",
  "alg": "RSA-OAEP-256",
  "enc": "A256GCM",
  "publicKeyJwk": { "kty": "RSA", "n": "…", "e": "AQAB" },
  "protectedHeader": {
    "alg": "RSA-OAEP-256",
    "enc": "A256GCM",
    "kid": "…",
    "sid": "…",
    "method": "key",
    "exp": 1794052800
  }
}
```

The private half of the RSA key pair is generated fresh per session, kept only in the agent process memory and
never serialized. Sessions expire after five minutes by default (`KEY_IMPORT_SESSION_TTL_MS`) and are deleted on
first successful use. `POST /dids/import/session` is rate limited separately from the rest of the API
(`KEY_IMPORT_RATE_LIMIT`, default 30 per minute) because each session generates an RSA key pair.

### Envelope

The envelope is standard JWE compact serialization:

```
BASE64URL(protected header) . BASE64URL(encrypted CEK) . BASE64URL(iv) . BASE64URL(ciphertext) . BASE64URL(tag)
```

* Key management: `RSA-OAEP-256` to the session's RSA-3072 public key.
* Content encryption: `A256GCM` with a fresh 256-bit CEK and a fresh 96-bit IV per envelope.
* The protected header is used as the JWE AAD, so it is authenticated by the GCM tag.

The payload is exactly one key representation plus an optional PEM passphrase:

```json
{ "privateKey": "-----BEGIN ENCRYPTED PRIVATE KEY-----\n…" }
{ "privateKeyJwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "d": "…" } }
{ "privateKey": "…", "passphrase": "…" }
```

Sending both `privateKey` and `privateKeyJwk` is rejected.

The agent verifies that the authenticated header matches the stored session:

* `sid` and `kid` equal the session id,
* `method` equals the DID method of the create request,
* `exp` equals the session expiry,

and that the session belongs to the same agent identity (tenant correlation id, or the dedicated agent) that
created it. The session is consumed before the key is handed to the KMS, so a captured envelope cannot be
replayed, including under concurrent requests. Envelope size (`200 000` characters) and decrypted payload size
(`50 000` bytes) are capped before parsing.

Every decryption failure returns the same generic error so a caller cannot probe sessions or ciphertexts. After
five failed attempts the session is destroyed.

## Client examples

### Studio / browsers

`studio/src/utils/keyImport.ts` implements the envelope with WebCrypto:

```ts
const session = await createDidImportSession(orgId, 'key');
const encryptedKey = await encryptKeyMaterialForImport(
  session,
  parseKeyMaterial(pemOrJwk, passphrase),
);
await createDid(orgId, { method: 'key', encryptedKey });
```

### Node / CLI

`platform-did-x509/scripts/import-did-key.mjs` is a dependency-free reference client (Node 18+):

```bash
# Platform-mediated flow: the platform persists the DID.
node scripts/import-did-key.mjs \
  --token "$ACCESS_TOKEN" --org "$ORG_ID" \
  --method web --domain example.com --key ./leaf.key

# Direct agent flow: for agent-credential clients and CLIs.
node scripts/import-did-key.mjs \
  --agent http://127.0.0.1:4001 --api-key "$AGENT_API_KEY" \
  --method key --key ./ed25519.pem
```

Any JOSE library can produce the same envelope; the client only has to use the returned `protectedHeader` as
the protected header and AAD, and put the key material in the payload shape above.

### curl

```bash
# 1. session
curl -s -X POST "http://127.0.0.1:5050/orgs/$ORG_ID/agents/did/import/session" \
  -H "authorization: Bearer $ACCESS_TOKEN" -H 'content-type: application/json' \
  -d '{"method":"key"}'

# 2. create the DID with the envelope produced by a JOSE client
curl -s -X POST "http://127.0.0.1:5050/orgs/$ORG_ID/agents/did" \
  -H "authorization: Bearer $ACCESS_TOKEN" -H 'content-type: application/json' \
  -d '{"method":"key","encryptedKey":{"sessionId":"…","jwe":"…"}}'
```

## Where the KMS stores an imported key

The agent selects the same backend for an imported key as it would for a generated key, and reports the actual
backend as `kmsBackend` in the response so the platform can persist it per DID:

| Key | Backend |
| --- | --- |
| RSA, EC P-521 | Node KMS (Askar cannot hold/sign them) |
| Ed25519, EC P-256/P-384, secp256k1 | Askar by default |
| Ed25519, RSA, EC P-256/P-384/P-521 when OpenBao is enabled and the DID method opt-in flag is set | OpenBao Transit |

OpenBao is the root of trust when enabled. Imported keys use Transit's BYOK API, so the OpenBao server never
receives the private key in plaintext either:

1. `GET /v1/transit/wrapping_key` returns a 4096-bit RSA public key.
2. The client (the agent, using `@credebl/credo-ts-openbao`) wraps the key material with the OpenBao wrapping key
   (`RSA-OAEP` + AES key wrap) and posts it to `/v1/transit/keys/:name/import`.
3. OpenBao decrypts the wrapping and stores the key non-exportably. Signing happens inside OpenBao.

This requires `OPENBAO_ENABLED=true`, `OPENBAO_WRITE_ENABLED=true`, and the per-method opt-in
(`OPENBAO_DID_KEY_ENABLED` / `OPENBAO_DID_WEB_ENABLED`) for `did:key` / `did:web`. `did:x509` already imports its
leaf key through the same path. The agent policy needs `transit/wrapping_key` (read) and
`transit/keys/*/import` (update); `admin` tokens do not necessarily have them.

OpenBao can forward transit operations to an HSM-backed cloud KMS when that is configured on the OpenBao side. The
credential flow does not change.

## Plaintext removal and compatibility

The production create DID and x509 import APIs no longer document `privateKey`, `privateKeyJwk` or `passphrase`:
the fields are hidden from the OpenAPI document (`@ApiHideProperty`).

They are rejected at three independent layers unless the explicit migration flag is enabled:

1. the gateway (`AgentService.assertNoPlaintextKeyMaterial`), before the body is published to NATS;
2. the agent service, which redacts key material and request bodies from error logs;
3. the agent controller (`ALLOW_PLAINTEXT_KEY_IMPORT`), which is the final authority.

Set `ALLOW_PLAINTEXT_KEY_IMPORT=true` only on a trusted, non-production deployment to keep an old integration
working during migration. With the flag unset (the default) a request containing plaintext key material fails
with a message pointing at the session endpoint, and the body never crosses NATS or reaches the agent logs.

Recommended migration path:

1. Deploy the session endpoint and the envelope support (this change). Plaintext remains rejected by default.
2. Move each client to the two-step flow. Studio does this automatically; server-side clients can call the
   gateway session endpoint or the agent endpoint directly.
3. If an old client cannot be changed immediately, enable `ALLOW_PLAINTEXT_KEY_IMPORT=true` on one agent/gateway
   pair, migrate that client, then remove the flag.
4. Remove the plaintext fields from the DTOs entirely in the next major API version. Until then they stay hidden
   from the OpenAPI document so new integrations do not discover them.

Compatibility options for clients that cannot use the envelope:

* **Same-host trusted client**: run the client on the agent host and call `POST /dids/write` with the plaintext
  fields while the migration flag is enabled, then turn the flag off.
* **Proxy-side wrapping**: perform the same two calls from a small sidecar next to the client. The sidecar holds
  the key, requests the session, wraps the key and forwards only the envelope.
* **Out-of-band import**: for OpenBao, import the key with `bao write transit/keys/<name>/import …` and register
  the DID with the existing `keyId`. This keeps the key out of CREDEBL entirely but does not work for Askar.

## Logging and error handling

* Gateway validation is configured with `validationError: { target: false, value: false }`, so class-validator
  never echoes the rejected value.
* The agent controller's tsoa `ValidateError` handler logs field names and returns field names plus messages, never
  `fields[].value`.
* Agent service and common HTTP clients serialize errors through a recursive `redactForLog` that removes
  `privateKey`, `privateKeyJwk`, `privatekey`, `passphrase`, `encryptedKey`, `jwe`, request `data`, `headers`,
  `authorization` and nested validation `value` fields.
* The import session response is served with `Cache-Control: no-store` and `Pragma: no-cache`.

## Limits and failure modes

| Control | Default |
| --- | --- |
| Session TTL | 5 minutes (`KEY_IMPORT_SESSION_TTL_MS`) |
| Session reuse | single use |
| Failed decrypt attempts | 5, then the session is deleted |
| Envelope length | 200 000 characters |
| Decrypted payload | 50 000 bytes |
| Live sessions per process | 1 000 |
| Session creation rate | 30 per minute (`KEY_IMPORT_RATE_LIMIT`) |

Sessions live in process memory. A load-balanced agent must route the session creation and the create DID call
for one import to the same instance (sticky affinity), or the client will receive "session is invalid or has
expired" and must request a new session.
