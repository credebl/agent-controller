# Changelog

## [2.3.3](https://github.com/credebl/agent-controller/compare/v2.3.2...v2.3.3) (2026-11-23)

Paired with CREDEBL platform `v2.3.0`.

### Behaviour changes

What existing callers may notice after upgrading from 2.3.2:

- **oid4vc holder:** `POST /openid4vc/holder/request-credential` sends OID4VCI notifications to the issuer by default (`sendNotification` defaults to `true`). Send `sendNotification: false` to keep the 2.3.2 behaviour.
- **oid4vc holder:** each credential returned by `request-credential` has a new `notification` field. Clients that validate the response strictly must allow it.
- **did:web:** `POST /dids/write` with `method: web` validates `domain` (#484). It must be a host name with at least one dot, or `localhost`, optionally followed by a `%3A`-encoded port and `:`-separated path segments of letters, numbers, `.`, `_`, `~` or `-`. IP addresses, URLs (`https://…`), slash-separated paths, empty segments and `..` now return 400; before, they created a DID that could not be resolved. A `~` in a path segment is written as `%7E` in the DID.
- **did:web:** `POST /dids/write` with `method: web` rejects a supplied `didDocument` with 400 and points to `POST /dids/web/import`. Before, the document was silently ignored and a new one generated from `domain`.
- **Key import:** private keys sent in plaintext (`privateKey`, `privateKeyJwk`, `passphrase`, and the did:polygon `privatekey`) are rejected with 400 unless `ALLOW_PLAINTEXT_KEY_IMPORT=true`. Send the key in `encryptedKey` from `POST /dids/import/session` instead. This covers `POST /dids/write` (did:key, did:web and **did:polygon, whose `privatekey` was required in 2.3.2**), `POST /dids/web/import` `POST /dids/x509/import` and, since #485, `POST /x509/import` (session `method: x509-certificate`).
- **oid4vc issuer:** credential, deferred credential and notification requests save the issuance session under a per-session lock that is held per process. With several controller instances, route all requests for an issuance session to one instance (sticky sessions), or a notification and a credential response can overwrite each other.
- **Credo patch:** the `@credo-ts/openid4vc` 0.7.4 patch carries the issuer notification endpoint from the unreleased openwallet-foundation/credo-ts#3215. Issuers advertise a `notification_endpoint` and return a `notification_id`; set `OID4VCI_NOTIFICATION_ENDPOINT_ENABLED=false` to turn the endpoint off.
- **mDoc validity (#486):** an `mso_mdoc` credential needs `validityInfo.validFrom` and `validityInfo.validUntil`. A missing value, a value that is not a date, or a `validUntil` that is not after `validFrom` now returns 400 before signing. The `signed` date is capped at `validFrom`, so a `validFrom` in the past or present no longer makes wallets reject the mDoc.
- **Holder error messages (#486):** a failed `resolve-credential-offer`, authorization or `request-credential` returns a plain-language reason (offer expired or already used, transaction code missing, issuer metadata not reachable, root certificate not trusted, credential not valid now), with the original error text kept at the end in brackets. Clients that match the old error text must be updated. Unknown errors are unchanged.
- **X.509 trust list fallback (#456):** in NoAuth mode, when `TRUST_LIST_URL` cannot be reached, the agent falls back to the certificates trusted with `POST /x509/trusted`. This is **on by default when `NODE_ENV` is not `PROD`/`PRODUCTION`**, and off in production unless `ALLOW_TRUST_LIST_FALLBACK=true`. With no locally trusted certificates the original error is returned. ClientAuth mode is unchanged.
- **Key import sessions** are kept in memory per process, are single use and expire after `KEY_IMPORT_SESSION_TTL_MS` (default 5 minutes). Send the session request and the import to the same instance.

### Features

- **did:x509 import (#473):** `POST /dids/x509/import` imports a CA-issued certificate chain (PEM, PEM bundle or base64 DER, leaf first) with the leaf private key and creates a `did:x509` the agent can sign with. The DID is built from the root fingerprint and policies (default `subject:CN`), checked by resolving it against the chain, and the chain is stored with the DID record. Re-importing the same chain is idempotent. `GET /dids/x509/chain/{did}` returns the stored chain. P-256, P-384, P-521, Ed25519 and RSA keys are supported; secp256k1 returns 400. See `docs/did-x509.md`.
  - A persistent Node KMS backend, stored in the tenant's encrypted storage, holds the keys Askar cannot (RSA, P-521). Askar stays the default.
- **oid4vc issuer: sign SD-JWT VCs with did:x509 (#474):** `signerOptions: { method: "did", did: "did:x509:…" }` on `dc+sd-jwt` / `vc+sd-jwt` offers. The header carries the `kid` and the full stored chain in `x5c` (leaf first, root last); `iss` is the did:x509. `mso_mdoc` and W3C formats refuse a did:x509 signer with a clear error (use the `x5c` signer for `mso_mdoc`).
- **oid4vc verifier: verify SD-JWT VCs from did:x509 issuers (#475):** credentials whose `iss` is a did:x509 and whose header carries `x5c` are verified for DIDs the agent does not own. The chain's root must be trusted through the existing X.509 trust configuration (`TRUST_LIST_URL` / trust service); the DID is resolved with the chain, so a certificate from a trusted CA cannot claim another organisation's did:x509.
- **OpenBao KMS (#476, #477):** an optional OpenBao Transit KMS backend (`OPENBAO_ENABLED`, off by default). When enabled it holds did:x509 and X.509 keys; did:key and did:web keys only with `OPENBAO_DID_KEY_ENABLED` / `OPENBAO_DID_WEB_ENABLED`. Askar stays the default and nothing existing is moved. Key ids are prefixed `ob_`. Startup fails when OpenBao is enabled but sealed, uninitialised or unreachable. `OPENBAO_WRITE_ENABLED=false` is the rollback switch: existing keys keep signing, new keys go to Askar or the Node KMS. Deleting a tenant purges its OpenBao keys first. See `docs/openbao.md` and `docs/openbao-e2e.md`.
- **Encrypted key import (#478):** `POST /dids/import/session` (`method`: `key`, `web`, `x509` or `polygon`) returns a single-use, short-lived session with a public key; the client sends the private key as a compact JWE in `encryptedKey`, so it never crosses the gateway, NATS or logs in plaintext. `POST /dids/write` can import an existing did:key or did:web key this way. The endpoint is rate limited (`KEY_IMPORT_RATE_LIMIT`, default 30 per `KEY_IMPORT_WINDOW_MS`, default 60 s). See `docs/key-import-security.md`.
- **Encrypted X.509 certificate import (#485):** `POST /x509/import` takes the private key as `encryptedKey` from a key import session with `method: x509-certificate`. A plaintext `privateKey` works only with `ALLOW_PLAINTEXT_KEY_IMPORT=true`; missing or conflicting key inputs return 400.
- **KMS backend of a DID (#485):** `GET /dids/{did}/kms` returns which backend holds the DID's keys (`askar`, `node`, `openbao` or `mixed`) and the key ids. Read only; a DID the agent holds no keys for returns `kmsBackend: null`. DID create and X.509 import responses report the backend too.
- **KMS backend reporting (#478):** `POST /x509`, `POST /x509/import` and the self-signed DCS flow return `kmsBackend` (`askar`, `node` or `openbao`). X.509 and did:x509 keys go through the same backend selection.
- **did:web paths (#484):** a did:web `domain` can carry a port and a path, for example `ayanworks.github.io:iec:0522012345`, and is validated (see Behaviour changes).
- **did:web import (#489):** `POST /dids/web/import` imports a `did:web` created and hosted by an external authority. A supplied `didDocument` is stored as is (custom verification method ids, `service`, `alsoKnownAs`, public-only `keyAgreement`); without one the DID is resolved and the published document imported. A supplied document must match the published one unless `allowUnresolvedDocument: true`. `keys[]` binds one or more encrypted private keys to the verification methods they were published for, each checked by JWK thumbprint. `replace: true` is needed to rebind an existing DID; re-importing the same document and keys is idempotent.
- **oid4vc holder:** `POST /openid4vc/holder/request-credential` sends OID4VCI notifications to the issuer's `notification_endpoint` for each credential response that has a `notification_id`: `credential_accepted` once the credential is stored, and `credential_failure` when it cannot be stored or fails the holder DID binding check. A failed store still fails the request; a notification that cannot be sent is logged and never fails it.
  - Notifications are sent one at a time, after all credentials are stored, so an issuer that records them on the issuance session cannot lose one to a concurrent update.
  - Each returned credential has a `notification` field: `{ status: "sent", event }`, `{ status: "skipped", reason }` (no `notification_endpoint`, no `notification_id`, or turned off) or `{ status: "failed", event, reason }`. The reason includes the issuer's HTTP status and error code, e.g. `HTTP 400 invalid_notification_id`.
  - An issuer that does not answer within `OID4VCI_NOTIFICATION_TIMEOUT_MS` (default 5000) is reported as `failed`, and no further notifications are sent for that offer, since the timed-out call may still reach the issuer.
  - When a credential cannot be stored, the request fails without waiting for the other stores to finish; a credential still being stored then gets no notification.
  - Turn notifications off with `sendNotification: false` in the request body.
- **oid4vc verifier:** `POST /openid4vc/verification-sessions/create-presentation-request` accepts the whole DCQL query of OpenID4VP 1.0: claim `id` and `values` (match a claim only when it has one of these values), `null` and numeric path segments, and on a credential query `multiple`, `trusted_authorities` and `claim_sets`. They were refused with 422 by request validation.
- **oid4vc holder:** `POST /openid4vc/holder/accept-proof-request` returns the verifier's response body as `verifierResponse` (for example `error` and `error_description` when the verifier rejects the presentation). `status` and `body` are unchanged.
- **oid4vc holder:** `accept-proof-request` answers 400 instead of 500 when Credo cannot select credentials for the request (a DCQL query or Presentation Exchange definition the wallet's credentials cannot satisfy).
- **oid4vc holder:** with DCQL `credential_sets` and `selectedCredentials`, queries the caller left out are not presented automatically, so the option made of the chosen queries is the one presented. Without credential sets, queries left out stay automatic as before.
- **revocation:** W3C JSON-LD credentials (`ldp_vc` and `jwt_vc_json-ld`, including VCDM 2.0) can be revoked with a W3C Bitstring Status List. OID4VCI issuance creates a `BitstringStatusListEntry` in `credentialStatus` and records `mechanism: "bitstring"` in the session metadata; SD-JWT credentials keep using `status_list`. See [docs/bitstring-status-list.md](docs/bitstring-status-list.md).
  - `revokeBySessionId` dispatches by the stored mechanism, so existing SD-JWT sessions continue to revoke as before.
  - `POST /agent/credential/verify` detects VCDM 2.0, verifies the signature with the matching Credo API, checks bitstring status and returns `verified` plus a `revocation` summary. `isValid` now also reflects revocation verification. Credo's built-in status check is disabled only for bitstring entries, which are verified explicitly.
  - Verification-session responses include an aggregated `revocation` summary for presented credentials. The outcome is persisted on the session and returned by the stored-response endpoint.
  - Status-list verification allowlists origins from `STATUS_LIST_ALLOWED_ORIGINS` (plus the origin of `STATUS_LIST_SERVER_URL`), verifies the status-list credential proof, and fails closed when no origin is configured.
- **Optional Indy ledger:** with an empty or missing `indyLedger` and no `BCOVRIN_TEST_GENESIS`, the controller starts without the Indy VDR module, the `did:indy` registrar and resolver, and the Indy AnonCreds registry, and never contacts an Indy pool. Startup used to fail with `IndyVdrError: Invalid pool create parameters`. With a ledger or `BCOVRIN_TEST_GENESIS` configured, nothing changes. See [docs/indy-ledger.md](docs/indy-ledger.md).
  - New `indyEnabled` config field / `--indy-enabled` / `AFJ_REST_INDY_ENABLED`: `false` turns Indy off even when a ledger is configured; `true` fails startup when no ledger is configured. Unset keeps the automatic behaviour.
  - Without Indy, `POST /dids/write` with `method: indy` and `/anoncreds/schemas` and `/anoncreds/credential-definitions` requests for Indy identifiers answer 501 `Indy ledger is not configured`, before anything is created. Identifiers served by other AnonCreds registries are not affected. A blank `AFJ_REST_INDY_ENABLED=` counts as unset. The AnonCreds module stays registered with a placeholder registry that gives the same message for Indy identifiers.
  - `yarn test:no-indy` starts the built controller without a ledger and checks it end to end.

### API

- New endpoints: `POST /dids/x509/import`, `GET /dids/x509/chain/{did}`, `POST /dids/import/session`, `POST /dids/web/import`, `GET /dids/{did}/kms`.
- OpenAPI: the X.509 import body gains `encryptedKey`; `privateKey` is deprecated and gated (#485). The key import session `method` accepts `x509-certificate`.
- OpenAPI: `DidCreate` gains `encryptedKey`, `privateKey`, `privateKeyJwk` and `passphrase` (the plaintext fields are deprecated and gated); `privatekey` is deprecated. X.509 create and import responses gain `kmsBackend`.
- OpenAPI: `RequestCredentialBody` gains `sendNotification` (default `true`). Each credential returned by `request-credential` gains `notification`; the record fields are unchanged.
- **oid4vc issuer:** issuers advertise a `notification_endpoint` (`{baseUrl}/{issuerId}/notification`) and return a `notification_id` with each credential response (OpenID4VCI 1.0 §11). A wallet notification (`credential_accepted`, `credential_failure` or `credential_deleted`) is checked against the access token of the session that issued the `notification_id`, recorded on the issuance session (`notifications[]`), and posted to the issuance webhook topic `/openid4vc-issuance`: the session record, whose state is unchanged, plus a `notification` object (`notificationId`, `credentialConfigurationId`, `event`, `eventDescription?`, `receivedAt`). It is also sent on the web socket. Webhooks posted on a state change also carry `notifications[]`. Set `OID4VCI_NOTIFICATION_ENDPOINT_ENABLED=false` to turn the endpoint off.
  - A repeated identical notification (same `notification_id`, `event` and `event_description`) returns 204 without being recorded or posted again.
  - Credential and deferred credential responses save the issuance session under the same per-session lock as notifications and keep notifications stored in the meantime, so neither overwrites the other. The lock is per process: with several controller instances serving the same wallet, route all requests for an issuance session to one instance.
  - **Limitation:** the endpoint needs the session's access token, which expires after `OID4VCI_ACCESS_TOKEN_EXPIRY` (default 3600 s), and the controller issues no refresh token. A wallet can therefore report `credential_deleted` only within that time; later deletions are not received. Raise `OID4VCI_ACCESS_TOKEN_EXPIRY` if issuers need a longer window.
- OpenAPI: `POST /didcomm/credentials/revoke` revokes a bitstring status-list entry. The body is `RevokeBitstringCredentialOptions` (`listId`, `index`, `issuerDid`) and the response is `{ revoked: true, listId, index }`. The wallet must control `issuerDid`, and the list's `issuer` must match it, or the request returns 403 before signing or sending an update. Bitstring `listSize` values are bit counts: invalid values (below 131072 or not a multiple of 8) return 400.
- OpenAPI: `/agent/credential/verify` responses gain `verified` and `revocation` and are typed as `VerifyCredentialResponse`; `isValid` is now false when a valid credential is revoked or its status cannot be verified. Unsupported VCDM 2.0 proof types and `trustedIssuers` on a JSON-LD object credential return a verification failure / 400 instead of throwing. OID4VC verification responses gain a `revocation` summary.
- Environment: `STATUS_LIST_ALLOWED_ORIGINS` is a comma-separated list of additional status-list origins accepted during verification. The origin of `STATUS_LIST_SERVER_URL` is always accepted.
- OpenAPI: `POST /dids/write` and the `/anoncreds/schemas` and `/anoncreds/credential-definitions` routes document a 501 response.
- **oid4vc holder:** `POST /openid4vc/holder/accept-proof-request` accepts optional `selectedCredentials`, a map of Presentation Exchange input descriptor ids or DCQL credential query ids to credential record ids. The caller can therefore choose which of the credentials that satisfy the request are presented. Unspecified descriptors keep Credo's automatic selection, so existing callers are unaffected. Unknown descriptor/query ids, credential ids that were not offered, malformed selections, and unsupported credential record types return 400. A Presentation Exchange selection replaces the automatic choice for its submission requirement and is checked against the requirement's `count`/`min`/`max`; a DCQL selection with more than one credential per query is rejected with 400 when the resolved OpenID4VP version cannot carry multiple presentations. OpenAPI: `AcceptProofRequest` gains `selectedCredentials` (`ProofRequestCredentialSelection`).

### Bug Fixes

- **x509:** `POST /x509/import` accepts a PEM private key as well as base64 DER.
- **mDoc and SD-JWT VC with `x5c` (#486):** the whole issuer chain (intermediates and root) is embedded after the signing certificate. Before, only the leaf and one intermediate were included, so a verifier that trusts only the root could not build the path.
- **x509 (#486):** an OpenSSL-style `issuer` or `subject` (`/C=IN/O=Example/CN=name`) is parsed into its parts when creating a certificate. Before, the whole string became the country. The comma form and the name object work as before.
- **mDoc (#486):** the `signed` date is never after `validFrom` (see Behaviour changes).

### Dependencies

- Added `@didx509/core` 0.1.3 and `@didx509/credo` 0.1.2 (did:x509), and `@sovio-id/credo-openbao-kms` 0.2.2 (OpenBao KMS).
- `resolutions` pin the `@peculiar/asn1-*` packages to 2.11.1; two copies broke RSA and P-521 certificate parsing.
- The `@credo-ts/core` 0.7.4 patch also emits `x5c` next to `kid` for DID issuers of SD-JWT VCs, and resolves and trust-checks did:x509 issuers with the `x5c` chain. Credo-based holders and verifiers without this change reject did:x509-signed SD-JWT VCs.
- The `@credo-ts/openid4vc` 0.7.4 patch adds the issuer notification endpoint from openwallet-foundation/credo-ts#3215, which is not released yet. The existing changes in the patch are kept. Remove this part of the patch once a Credo release includes it.
- `@opentelemetry/instrumentation-http` 0.221.0 → 0.222.0 (#494); `@sovio-id/credo-openbao-kms` 0.2.0 → 0.2.2, and the development dependencies `supertest` 7.3.1 → 7.3.2 and `ts-jest` 29.4.14 → 29.4.15 (#495).
- `@opentelemetry/api` ^1.9.1, `cors` ^2.8.6 and `ws` ^8.21.3, plus development-only bumps (#456).
- `@digitalcredentials/credentials-v2-context` supplies the bundled VCDM 2.0 JSON-LD context, so signing and verification do not fetch it over the network.
- `@openid4vc/openid4vp` `^0.6.0` is now a direct dependency (it was already installed transitively by `@credo-ts/openid4vc`); the holder uses its authorization-request version parser to reject DCQL selections that a draft OpenID4VP response cannot carry.

## [2.3.2](https://github.com/credebl/agent-controller/compare/v2.3.1...v2.3.2) (2026-11-04)

### Features

- **did:web:** `POST /dids/write` with `method: web` accepts `verificationMethodType` (`Ed25519VerificationKey2018` by default, or `Ed25519VerificationKey2020`, which publishes `publicKeyMultibase` with the `ed25519-2020/v1` context).
- **JSON-LD signing follows the key type:** OID4VCI `ldp_vc` issuance and DCQL / Presentation Exchange `ldp_vp` presentations use `Ed25519Signature2020` for an `Ed25519VerificationKey2020` key and `Ed25519Signature2018` for an `Ed25519VerificationKey2018` key (Credo picked the 2018 suite for every Ed25519 key, which rejects a 2020 key). `did:key` keeps signing with `Ed25519Signature2018`.
- **oid4vc holder:** with `holderDidUrl` and `bindingPolicy: require`, a W3C credential whose `credentialSubject` is not the holder DID returns 422 and is not stored.

### Bug Fixes

- **oid4vc issuer:** the `credentialSubject.id` of `ldp_vc` and `jwt_vc_json(-ld)` credentials is the holder's bare DID (`did:web:example.com`), not the verification method of the proof key (`did:web:example.com#key-1`). A subject `id` in the offer payload must name the same DID; otherwise the credential request fails, as the holder could not present it.
- **oid4vc holder:** an `ldp_vc` configuration that lists JWA algorithms (`EdDSA`) in `proof_signing_alg_values_supported` is accepted; Credo only looked for signature suite names there (`Ed25519Signature2018`). Suite names still work.
- **oid4vc verifier:** a DCQL `ldp_vc` query whose `meta.type_values` are not expanded JSON-LD type IRIs (`MyCredential` instead of `https://example.org/vocab#MyCredential`) returns 400; wallets could never match it.
- **sign raw data:** the key of a DID whose verification method only has `publicKeyMultibase` is found.

### Behaviour changes

- Consumers that compare `credentialSubject.id` of newly issued W3C credentials with a verification method URL now receive the bare DID. Credo verifiers accept both.

### Security

- `joi` 17.13.8 → 17.13.9 (high), `follow-redirects` 1.16.1 → 1.16.2 (high) and `@hapi/content` 6.0.2 → 6.0.3 (high), as lockfile updates within existing ranges

## [2.3.1](https://github.com/credebl/agent-controller/compare/v2.3.0...v2.3.1) (2026-11-04)

### Features

- **oid4vc holder:** `POST /openid4vc/holder/request-credential` accepts optional `holderDidUrl` (a verification method, or a DID to use its first authentication key) and `bindingPolicy` (`require` by default, or `prefer`), so credentials can be bound to an existing DID of the tenant instead of a new key. Without `holderDidUrl` nothing changes.
- **w3c verify:** `/agent/credential/verify` accepts `trustedIssuers`, a list of issuers to accept such as `[{ "method": "did", "issuance": "did:web:issuer.example" }]` (Credo 0.7.4); an empty list trusts no issuer.

### Bug Fixes

- **oid4vc holder:** `credentialsToRequest` is now honoured (all offered configurations were requested before); ids that are not in the offer return 400.
- **oid4vc holder:** with `bindingPolicy: require`, a holder DID that the issuer cannot bind to (DID method, `jwt` proof type, key attestations or signature algorithm) is rejected before the token request, so the pre-authorized code and transaction code are not used up; with `prefer`, those credentials fall back to a new key. A malformed `holderDidUrl`, or a DID or verification method that is not in the tenant, returns 400 under either policy.

### Dependencies

- Credo `0.7.0` → `0.7.4` (all `@credo-ts/*` packages and `resolutions`; `@credo-ts/push-notifications` stays at `^0.7.1`, its latest release). Storage version is unchanged (0.5), so existing wallets open without migration.
- patch-package patches regenerated for 0.7.4; the core patch drops the `defaultDocumentLoader` exports that Credo now provides.

### Security

- `body-parser` 1.20.8 → 1.20.9 and 2.3.0 → 2.4.0, `decode-uri-component` 0.5.0 → 0.5.1, `qs` 6.16.0 → 6.16.2 / 6.17.1, `fast-uri` 3.1.8 → 3.1.9 (lockfile only, within existing ranges)

### API

- OpenAPI: `RequestCredentialBody` gains `holderDidUrl` and `bindingPolicy`, and `credentialsToRequest` is optional. Credo 0.7.4 renames proof schemas used by `/agent/credential/verify` (`DataIntegrityProof` → `AnonCredsW3cCredentialProof`); request and response shapes are unchanged.

## [2.3.0](https://github.com/credebl/agent-controller/compare/v2.2.0...v2.3.0) (2026-10-30)

### Features

- W3C JSON-LD credential issuance, presentation, sign and verify
- **oid4vc:** `ldp_vc` support for W3C JSON-LD credentials
- **dcql:** DCQL JSON-LD credential verification
- **holder:** pagination, search and filters on the credential list endpoints `GET /openid4vc/holder/sd-jwt-vcs`, `/mdoc-vcs` and `/w3c-vcs` (`q`, `page`, `pageSize`, `credentialType`, `vct`, `docType`, `types`), and optional `tags` on credential requests ([#458](https://github.com/credebl/agent-controller/pull/458))
- support X.509 certificate chains and fix mdoc date encoding

### Bug Fixes

- allow `vc+sd-jwt` issuance by routing `SdJwtVc` to the sd-jwt signing path ([#454](https://github.com/credebl/agent-controller/pull/454))
- **dcql:** resolve `ldp_vc` query filtering and JSON-LD serialization errors
- release tenant sessions after proof events
- repair Jest configuration so `yarn test` runs again
- resolve data type issues in `handleMsoMdocFormat`
- enhance W3C VC 2.0 detection and prevent crashes on empty `x5c`

### Security

- bump `undici` pin 6.24.0 → 6.29.1 (fixes multiple DoS, header/CRLF injection and cookie handling advisories)
- bump `flatted` pin 3.4.0 → 3.4.2, pin `ts-deepmerge` to 8.0.0 and `ngrok`'s `uuid` to 11.1.1
- CI workflow now runs `yarn test`, declares `permissions: contents: read` and installs with `--frozen-lockfile --ignore-scripts` (patches applied explicitly)
- Dockerfile pins `yarn` (1.22.22) and `patch-package` (8.0.1)
- dependency bumps across `axios`, `protobufjs`, `tar`, `ws`, `form-data`, `nanoid`, `fast-uri` and others

### Refactors, Build and Docs

- rename patch files for Windows compatibility ([#422](https://github.com/credebl/agent-controller/pull/422))
- message type added for mediator message forwarding
- Docker base image bumped to Node 26.8.1
- Dependabot configuration added; README rewritten (Agent Controller naming, setup, wallet connection-pool docs)
- project renamed to `agent-controller` in `package.json`, the OpenAPI title, `compass.yml`, issue templates, CI and Jest display name; the Docker image, ECS task definitions and telemetry names keep the legacy `credo-controller` name for now
- `package.json` / `swagger.json` version aligned to 2.3.0 (was 2.1.3)

> Releases before 2.3.0 were not recorded here. The entries below are inherited from the upstream `aries-framework-javascript-ext` REST package.

### [0.9.4](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.9.3...rest-v0.9.4) (2022-10-07)

### Features

- **rest:** added did resolver endpoint and tests ([#172](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/172)) ([9a1a24e](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/9a1a24ee2c958d09fff13075e0f56e0d3ed9ce7c))

### [0.9.3](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.9.2...rest-v0.9.3) (2022-09-21)

### Features

- **rest:** added create-offer endpoint and tests ([#169](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/169)) ([5458e9e](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/5458e9ee06c8a8d61fb6a812ea04f4d1a59b21dc))
- **rest:** added filters to getAllCredentials ([#166](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/166)) ([af7ec19](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/af7ec197b317b16cb5d2083d880006f29d0272c6))
- **rest:** added WebSocket event server ([#170](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/170)) ([e190821](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/e190821b3f71c97e03cc92222fedceeadb514aab))

### [0.9.2](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.9.1...rest-v0.9.2) (2022-09-07)

### Bug Fixes

- **rest:** accept proof properties now optional ([#162](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/162)) ([f927fdc](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/f927fdcd4a6142a6bc086d82d3b6e6ed1317108d))

### [0.9.1](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.9.0...rest-v0.9.1) (2022-09-05)

### Bug Fixes

- **rest:** moved route generation to compile ([#160](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/160)) ([8c70864](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/8c70864cacaada486b0ca7a7f9ba0ca2395f9efd))

## [0.9.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.8.1...rest-v0.9.0) (2022-09-02)

### ⚠ BREAKING CHANGES

- **rest:** update to AFJ 0.2.0 (#148)

### Features

- **rest:** update to AFJ 0.2.0 ([#148](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/148)) ([8ec4dc4](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/8ec4dc4548305d5cc8180b657f5865002eb3ee4a))

### [0.8.1](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.8.0...rest-v0.8.1) (2022-06-28)

### Features

- **rest:** added multi use param to create invitation ([#100](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/100)) ([d00f11d](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/d00f11d78e9f65de3907bd6bf94dd6c38e2ddc3b))
- **rest:** improved class validation ([#108](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/108)) ([cb48752](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/cb48752f0e222080f46c0699528e901de1226211))

### Bug Fixes

- **rest:** changed webhook event topic to type ([#117](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/117)) ([fed645e](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/fed645ec4ba77313e092bce097444a96aa66cf6e))
- **rest:** ledger not found error ([2374b42](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/2374b4232a0b11738fb57e23dd2a3ac1b81ad073))

## [0.8.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.7.0...rest-v0.8.0) (2022-02-26)

### Features

- **rest:** add cli and docker image publishing ([#96](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/96)) ([87d0205](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/87d02058e4b7d1fba1039265f5d595880f862097))
- **rest:** add webhooks ([#93](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/93)) ([9fc020d](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/9fc020d7db0f002894e520766987eec327a2ed69))
- **rest:** added basic messages and receive invitation by url ([#97](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/97)) ([956c928](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/956c928e3599925c65d8f99852bf06cebc06dba7))

## [0.7.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.6.1...rest-v0.7.0) (2022-01-04)

### ⚠ BREAKING CHANGES

- update aries framework javascript version to 0.1.0 (#86)

### Miscellaneous Chores

- update aries framework javascript version to 0.1.0 ([#86](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/86)) ([ebaa11a](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/ebaa11a8f1c4588b020e870abd092a5813ec28ef))

### [0.6.1](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.6.0...rest-v0.6.1) (2021-12-07)

### Bug Fixes

- **rest:** made nonce optional on proofrequest ([#84](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/84)) ([c1efe58](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/c1efe58055639e1c3df0429df6a0efe8fcdeb850))

## [0.6.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.5.0...rest-v0.6.0) (2021-12-06)

### ⚠ BREAKING CHANGES

- **rest:** proof request indy fields are now snake_case as used by indy instead of camelCase as used by AFJ.

### Bug Fixes

- **deps:** update dependencies ([#78](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/78)) ([ca38eba](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/ca38eba50dbb524269865d4fbfcb2d33720d0b48))
- **rest:** remove record transformer ([#77](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/77)) ([cda30f5](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/cda30f56b557a11645e9201ecf3e615ce8c890f5))

## [0.5.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.4.0...rest-v0.5.0) (2021-11-15)

### ⚠ BREAKING CHANGES

- **rest:** the 'extraControllers' config property has been removed in favor of a custom 'app' property. This allows for a more flexible wat to customize the express app. See the sample for an example.

### Features

- **rest:** allow app instance for custom configuration ([#73](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/73)) ([35400df](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/35400df5bdf1f621109e38aca4fa6644664612c8))

## [0.4.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.3.0...rest-v0.4.0) (2021-11-07)

### ⚠ BREAKING CHANGES

- **rest:** changed oob proof parameter from c_i to d_m (#67)

### Features

- **rest:** added outofband offer to credentialController ([#70](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/70)) ([d514688](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/d514688e2ca2c36312ef27b4d4a59ee3059e33de))
- **rest:** added support for custom label and custom imageUrl ([#71](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/71)) ([686bddd](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/686bddd58d0947ab4dda1b1d4a49ce721c6b464b))

### Code Refactoring

- **rest:** changed oob proof parameter from c_i to d_m ([#67](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/67)) ([5f9b1ae](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/5f9b1aeabcd81b5d3a084f69b280ceff84298b7e))

## [0.3.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.2.0...rest-v0.3.0) (2021-11-01)

### ⚠ BREAKING CHANGES

- **rest:** The credentential-definitions endpoint topic contained a typo (credential-defintions instead of credential-definitions)
- **rest:** The connection id is moved from the path to the request body for credential and proof endpoints

### Bug Fixes

- **rest:** typo in credential definition endpoint ([b4d345e](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/b4d345ed2af112679389ad4d8ed76760e442cc26))

### Code Refactoring

- **rest:** moved connectionId from path to requestbody ([#59](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/59)) ([1d37f0b](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/1d37f0bdde96742fc947213f8b934353872c570c))

## [0.2.0](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.1.2...rest-v0.2.0) (2021-10-05)

### ⚠ BREAKING CHANGES

- **rest:** The port property has been moved into a new configuration object.

### Features

- **rest:** added support for custom controllers ([#39](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/39)) ([8362e30](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/8362e30d8a4c9ef24779769f81b6e74f7f5978cc))

### [0.1.2](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.1.1...rest-v0.1.2) (2021-09-17)

### Bug Fixes

- **rest:** routing fix and moved cors to dependencies ([#31](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/31)) ([0999658](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/09996580a0015004ca18d36487276588460d0dfd))

### [0.1.1](https://www.github.com/hyperledger/aries-framework-javascript-ext/compare/rest-v0.1.0...rest-v0.1.1) (2021-09-16)

### Bug Fixes

- **rest:** require package.json to avoid error ([43e683a](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/43e683a11f4eed1d848f612c6e32e82d62141769))

## 0.1.0 (2021-09-16)

### Features

- add rest package ([#10](https://www.github.com/hyperledger/aries-framework-javascript-ext/issues/10)) ([e761767](https://www.github.com/hyperledger/aries-framework-javascript-ext/commit/e7617670c3cc05ee63e827cc5a5c5079a5e8eea5))
