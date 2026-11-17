# Agent Controller v2.3.3-rc.1 (release candidate)

Release date: 2026-11-17 · Previous release: v2.3.2 · Status: **release candidate, not for production**

This is a release candidate. It is paired with CREDEBL platform `v2.3.0-rc.3` and is tested with it on a development environment before `v2.3.3` is released. The full list of changes is in [CHANGELOG.md](CHANGELOG.md).

- **Image:** `ghcr.io/credebl/credo-controller:v2.3.3-rc.1`. The `latest` tag is not moved for a release candidate; it stays on `v2.3.2` until `v2.3.3` is released.
- **Git tag:** `v2.3.3-rc.1`, published as a GitHub prerelease.

## Highlights

- **did:x509.** Import a CA-issued certificate chain as a `did:x509`, sign OID4VCI SD-JWT VCs with it, and verify SD-JWT VCs from did:x509 issuers whose root CA is trusted.
- **Optional OpenBao KMS.** An OpenBao Transit backend for did:x509 and X.509 keys, and optionally for did:key and did:web keys. Off by default; Askar stays the default KMS.
- **Encrypted key import.** Private keys are imported through a single-use session as an encrypted JWE, and plaintext key import is turned off by default.
- **did:web.** Identifiers with ports and paths are validated, and `POST /dids/web/import` imports a did:web document and keys issued by an external authority.
- **OID4VCI notifications.** The holder notifies the issuer when a credential is stored or fails, and the issuer accepts wallet notifications and posts them on the issuance webhook.

## New features

- **did:x509 import** (#473): `POST /dids/x509/import` takes a certificate chain (leaf first) and the leaf private key, builds the DID from the root fingerprint and policies (default `subject:CN`), and stores the chain with the DID. `GET /dids/x509/chain/{did}` returns it. P-256, P-384, P-521, Ed25519 and RSA keys are supported; RSA and P-521 keys are held in a persistent Node KMS backend because Askar cannot hold them. Guide: `docs/did-x509.md`.
- **Issue SD-JWT VCs with did:x509** (#474): `signerOptions: { method: "did", did: "did:x509:…" }` on `dc+sd-jwt` / `vc+sd-jwt` offers. The credential header carries the `kid` and the full chain in `x5c`.
- **Verify SD-JWT VCs from did:x509 issuers** (#475): the chain in `x5c` must lead to a root trusted by the existing X.509 trust configuration (`TRUST_LIST_URL` / trust service). The DID is resolved with the chain, so a certificate from a trusted CA cannot claim another organisation's did:x509.
- **OpenBao KMS** (#476, #477): enable with `OPENBAO_ENABLED=true` and the `OPENBAO_*` settings in `.env.sample`. did:key and did:web keys go to OpenBao only with `OPENBAO_DID_KEY_ENABLED` / `OPENBAO_DID_WEB_ENABLED`. Startup fails if OpenBao is enabled but sealed or unreachable. `OPENBAO_WRITE_ENABLED=false` is the rollback switch. Deleting a tenant purges its OpenBao keys. Guides: `docs/openbao.md`, `docs/openbao-e2e.md`.
- **Encrypted key import and KMS backend reporting** (#478): `POST /dids/import/session` returns a short-lived, single-use session; the key is sent as `encryptedKey`. `POST /dids/write` can import an existing did:key or did:web key this way. X.509 create and import responses return `kmsBackend` (`askar`, `node` or `openbao`). Guide: `docs/key-import-security.md`.
- **did:web domain and path validation** (#484): `domain` may be `example.com`, `example.com%3A3000` or `example.com:path:to:folder`.
- **did:web import** (#489): `POST /dids/web/import` stores an authority's did:web document as published and binds one or more encrypted private keys to its verification methods, each checked by JWK thumbprint. A supplied document must match the published one unless `allowUnresolvedDocument: true`; `replace: true` is needed to rebind an existing DID.
- **OID4VCI notifications** (#491 holder, #492 issuer): the holder sends `credential_accepted` / `credential_failure` and reports the result in a `notification` field per credential. Issuers advertise a `notification_endpoint`, record wallet notifications on the issuance session and post them to the `/openid4vc-issuance` webhook.

## Bug fixes

- `POST /x509/import` accepts a PEM private key as well as base64 DER.

## Behaviour changes (read before upgrading)

1. **Holder notifications are on by default.** `request-credential` sends notifications unless the body has `sendNotification: false`.
2. **`request-credential` responses** have a new `notification` field on each credential.
3. **Stricter did:web identifiers** (#484). `POST /dids/write` with `method: web` returns 400 for a `domain` that is a URL, an IP address, a slash-separated path, or has empty or `..` segments. A `~` in a path segment becomes `%7E` in the DID.
4. **`POST /dids/write` with `method: web` rejects `didDocument`** and points to `POST /dids/web/import`. Before, the document was ignored and a new one generated.
5. **Plaintext key import is disabled** unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. This covers `privateKey`, `privateKeyJwk` and `passphrase` on `POST /dids/write`, `POST /dids/web/import` and `POST /dids/x509/import`, **and the did:polygon `privatekey` on `POST /dids/write`, which existing did:polygon callers send today**. Move callers to `encryptedKey`, or set `ALLOW_PLAINTEXT_KEY_IMPORT=true` for the migration. `POST /x509/import` is not affected.
6. **Per-process locks and sessions.** The issuance session lock (credential, deferred credential and notification requests) and key import sessions are held in memory per process. With several controller instances, route all requests for one issuance session, and a key import session request with its import, to the same instance.
7. **Credo patch.** The `@credo-ts/openid4vc` 0.7.4 patch carries the issuer notification endpoint from the unreleased openwallet-foundation/credo-ts#3215. Set `OID4VCI_NOTIFICATION_ENDPOINT_ENABLED=false` to turn it off. The `@credo-ts/core` 0.7.4 patch also changes SD-JWT VC issuer handling for did:x509 (`kid` and `x5c` together); Credo-based wallets and verifiers without this change reject did:x509-signed SD-JWT VCs.

## Upgrade notes

- **New environment variables** (all optional): `ALLOW_PLAINTEXT_KEY_IMPORT`, `KEY_IMPORT_SESSION_TTL_MS`, `KEY_IMPORT_RATE_LIMIT`, `KEY_IMPORT_WINDOW_MS`, `OID4VCI_NOTIFICATION_TIMEOUT_MS`, `OID4VCI_NOTIFICATION_ENDPOINT_ENABLED` and the `OPENBAO_*` settings. See `.env.sample`.
- **No storage migration.** Existing wallets, DIDs, keys and credentials stay where they are; OpenBao only receives new keys.
- **Docker:** pull `ghcr.io/credebl/credo-controller:v2.3.3-rc.1`. Deployments that track `latest` stay on `v2.3.2`.

## Dependencies

- Added: `@didx509/core` 0.1.3, `@didx509/credo` 0.1.2, `@sovio-id/credo-openbao-kms` 0.2.2.
- `resolutions` pin `@peculiar/asn1-*` to 2.11.1.
- Bumped: `@opentelemetry/instrumentation-http` 0.221.0 → 0.222.0 (#494); `@sovio-id/credo-openbao-kms` 0.2.0 → 0.2.2, `supertest` 7.3.1 → 7.3.2, `ts-jest` 29.4.14 → 29.4.15 (#495).

## What to test on the development environment

- did:x509 import, SD-JWT VC issuance with did:x509, and verification against a trusted root.
- X.509 create/import with and without OpenBao, checking `kmsBackend`.
- did:web create with paths and ports, and `POST /dids/web/import`.
- did:key, did:web and did:polygon key import through `POST /dids/import/session` and `encryptedKey`.
- OID4VCI issuance with a holder that sends notifications, and the issuer webhook carrying them.
