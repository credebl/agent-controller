# OpenBao KMS end-to-end checklist

Verification for the optional OpenBao Transit backend across agent-controller, platform, and studio. The gate was
signed off on 2026-11-07 after the service-layer e2e and studio build/contract checks below; the full Keycloak +
api-gateway HTTP/UI flow remains outstanding (see the blockers in section 13).

Configuration and rollback semantics are in [`openbao.md`](./openbao.md). Seal, storage, disaster recovery, and the
rotation prohibitions are in the plugin's
[`docs/seal.md`](https://github.com/sovio-id/credo-ts-openbao/blob/main/docs/seal.md).

## Merge record

| Component        | PR                                                      | Merged `main` commit                                                                     |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| agent-controller | #473, #474, #475, #476 (retargeted and merged in order) | `ec46825` (`Merge pull request #476 from credebl/feat/openbao-kms`)                      |
| platform         | #1823                                                   | `94ce4da35` (`Merge pull request #1823 from credebl/feat/did-x509-import`)               |
| studio           | #1344 (follow-up to the already merged #1265)           | `447e9479` (`Merge pull request #1344 from credebl/fix/x509-certificates-platform-enum`) |
| credo-ts-openbao | sovio-id/credo-ts-openbao#10                            | `d55a67a` (vendored in agent-controller; npm publication pending)                        |

## Branches under test

| Component        | Branch                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| agent-controller | `feat/openbao-kms`                                                                    |
| credo-ts-openbao | `main` (`d55a67a`, merged from PR #10; vendored as `@credebl/credo-ts-openbao@0.2.0`) |
| platform         | `feat/did-x509-import`                                                                |
| studio           | `fix/x509-certificates-platform-enum` (follow-up to the merged `#1265`)               |

Record the exact SHAs used for the run. Re-run this checklist after any rebase of those branches.

Run under test (2026-11-07):

| Component        | SHA                                                                                |
| ---------------- | ---------------------------------------------------------------------------------- |
| agent-controller | `f740356990bc580dd3f5a776f2734274502c284a` (`feat/openbao-kms`)                    |
| credo-ts-openbao | `d55a67a40ec0097be06b6ad3a120d8dd6c2aeff1` (`main`, vendored tarball `0.2.0`)      |
| platform         | `90c167cf09bbbbb3f5296daa9e2e5eb38245e988` (`feat/did-x509-import`)                |
| studio           | `605006a18a0ca4250ff1aff6de68647051663cd0` (`fix/x509-certificates-platform-enum`) |

OpenBao `2.7.2`, PostgreSQL `16.15` storage in database `credebl_openbao`, schema `openbao`
(`openbao_kv_store`), AppRole auth. Local e2e configuration is in
`$TMPDIR/opencode/openbao-e2e/openbao-postgres.hcl`; production storage settings are in the plugin's
[`docs/seal.md`](https://github.com/sovio-id/credo-ts-openbao/blob/main/docs/seal.md#12-postgresql-storage-notes).

## 1. Preconditions

- [ ] OpenBao is reachable and unsealed; PostgreSQL storage points at the `credebl_openbao` database, schema `openbao`.
- [ ] Transit is enabled at the mount agent-controller uses (`OPENBAO_TRANSIT_MOUNT`, default `transit`).
- [ ] An AppRole exists with the policy in section 2; `OPENBAO_ROLE_ID` and `OPENBAO_SECRET_ID_FILE` are available.
- [ ] agent-controller is built from `feat/openbao-kms` with the vendored plugin tarball.
- [ ] platform and studio are built from their branches above.
- [ ] Test certificates are available for each key family: Ed25519, P-256, P-384, P-521, RSA-2048, RSA-4096.
- [ ] A baseline Askar-only run of the same flows has passed (see section 4) so regressions are distinguishable from
      OpenBao problems.

## 2. AppRole for the agent (e2e only)

The platform's KV AppRole (`openbao-init.sh`) is not enough: the KMS needs Transit permissions. For a local run:

```sh
bao auth enable approle

bao policy write agent-controller - <<'POLICY'
path "transit/keys" {
  capabilities = ["list"]
}
path "transit/keys/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "transit/keys/*/config" {
  capabilities = ["update"]
}
path "transit/keys/*/import" {
  capabilities = ["update"]
}
path "transit/sign/*" {
  capabilities = ["update"]
}
path "transit/verify/*" {
  capabilities = ["update"]
}
path "transit/wrapping_key" {
  capabilities = ["read"]
}

# Rotating or exporting a key breaks every DID and credential that references it.
path "transit/keys/*/rotate" {
  capabilities = ["deny"]
}
path "transit/export/*" {
  capabilities = ["deny"]
}
path "transit/backup/*" {
  capabilities = ["deny"]
}
POLICY

bao write auth/approle/role/agent-controller \
  token_policies=agent-controller \
  token_ttl=1h \
  token_max_ttl=8h \
  secret_id_ttl=0 \
  bind_secret_id=true
```

- [ ] `bao read -field=role_id auth/approle/role/agent-controller/role-id` returns a role id.
- [ ] A secret id from `bao write -f -field=secret_id auth/approle/role/agent-controller/secret-id` can log in and run
      `bao list transit/keys`.
- [ ] A write-enabled test role can create a key; a read/sign-only role cannot (used in section 9).
- [ ] `bao list transit/keys` works with the agent's token; `transit/export/*` is denied.

> Production uses the same policy shape but a sealed, auto-unsealed cluster and a read/sign-only role once
> `OPENBAO_WRITE_ENABLED=false`.

## 3. Configuration profiles

Baseline Askar run:

```sh
OPENBAO_ENABLED=false
```

OpenBao run (start with DID opt-ins off):

```sh
OPENBAO_ENABLED=true
OPENBAO_WRITE_ENABLED=true
OPENBAO_ADDRESS=https://openbao.test:8200
OPENBAO_ROLE_ID=<role id>
OPENBAO_SECRET_ID_FILE=/run/secrets/openbao-secret-id
OPENBAO_AUTH_MOUNT=approle
OPENBAO_TRANSIT_MOUNT=transit
OPENBAO_HEALTH_CHECK=true
OPENBAO_DID_KEY_ENABLED=false
OPENBAO_DID_WEB_ENABLED=false
```

## 4. Startup and health

- [ ] With `OPENBAO_ENABLED=false` the agent starts and all existing Askar flows work.
- [ ] With OpenBao enabled and healthy the agent starts.
- [ ] Sealed cluster: startup fails with a clear sealed error, not a generic 500.
- [ ] Stopped/unreachable cluster: startup fails with a clear unreachable error.
- [ ] Wrong `OPENBAO_ROLE_ID` or secret id: startup fails (or the first KMS call fails) with an auth error.
- [ ] Empty `OPENBAO_AUTH_MOUNT`/`OPENBAO_TRANSIT_MOUNT` falls back to `approle`/`transit` (CLI and env paths behave
      the same).

## 5. Multi-tenant flow

Use a tenant agent token for all calls unless stated otherwise.

### 5.1 X.509 create

- [ ] `POST /x509/{orgId}` through platform creates a certificate.
- [ ] The response `keyId` starts with `ob_`.
- [ ] `bao list transit/keys` shows a new `ac_<scope>_<keyId>` entry and `bao read transit/keys/<name>` reports the
      expected type (e.g. `ecdsa-p256`, `ed25519`, `rsa-2048`).
- [ ] The key is **not** present in the tenant's Askar wallet.
- [ ] Repeat for Ed25519, P-384, P-521, RSA-2048, RSA-4096.

### 5.2 X.509 import (BYOK)

- [ ] `POST /x509/{orgId}/import` with `authorityKey.seed` and `subjectPublicKey.seed` stores the authority key in
      OpenBao and returns an `ob_` key id.
- [ ] Importing the same seed twice does not create a second Transit key.
- [ ] A key imported into OpenBao is usable for signing without ever being returned to the client.

### 5.3 did:x509 import

- [ ] `POST /orgs/{orgId}/agents/did/x509/import` with a leaf-first chain and matching private key returns `did`,
      `didDocument`, `keyId` (`ob_...`), and `verificationMethodId`.
- [ ] `GET /dids/x509/chain/{did}` returns the stored chain.
- [ ] Re-posting the same payload returns the **same** `keyId` and does not rebind the DID.
- [ ] Re-posting with a different private key is rejected with the leaf-mismatch error.
- [ ] Re-posting after deleting the bound key from OpenBao is rejected with the unreadable-key error (no silent
      rebind).
- [ ] Resolving the DID in platform/studio works and the verification method resolves to public material.

### 5.4 did:key / did:web opt-in

- [ ] With `OPENBAO_DID_KEY_ENABLED=false`, create `did:key`; the key id does **not** start with `ob_`.
- [ ] With the flag `true` (restart), create `did:key`; the key id starts with `ob_` and appears in Transit.
- [ ] Repeat for `did:web` with `OPENBAO_DID_WEB_ENABLED`.
- [ ] Re-import an existing `did:key`/`did:web`: no duplicate key and the DID document is unchanged.

### 5.5 Credentials, status lists, DIDComm

- [ ] Issue an OID4VC credential with an `ob_`-backed DID; the signature verifies.
- [ ] Verify the credential in platform/studio.
- [ ] Issue and verify a status list credential; no unhandled KMS backend error.
- [ ] Create/rotate a status list and confirm the signing key id is the DID's binding, not a new key.
- [ ] Create an Indy DID and a DIDComm connection: keys stay in Askar and routing still works.
- [ ] X25519 and secp256k1 flows never produce `ob_` key ids.

### 5.6 Tenant isolation

- [ ] Keys created for tenant A use the scope `<deployment id>:tenant-<tenantA>`.
- [ ] Tenant B's token cannot resolve or sign with tenant A's key id.
- [ ] The same key material imported by two tenants creates two scoped Transit keys (no cross-tenant sharing).

## 6. Dedicated agent flow

Repeat 5.1–5.4 with a dedicated agent:

- [ ] The key scope uses the root context (`default`) rather than a tenant correlation id.
- [ ] `OPENBAO_DEPLOYMENT_ID` changes the scope prefix without breaking existing keys.
- [ ] Restarting the agent can still resolve and sign with keys created before the restart.

## 7. Tenant deletion and purge

- [ ] Record the tenant's Transit key names (`bao list transit/keys`, filtered by the tenant scope).
- [ ] Delete the tenant through the platform (`DELETE /multi-tenancy/{tenantId}` path used by platform).
- [ ] The tenant record is gone.
- [ ] None of the tenant's `ac_<scope>_*` keys remain in OpenBao.
- [ ] The root/default scope and other tenants' keys are untouched.
- [ ] Failure injection: stop OpenBao before deletion. Deletion fails and the tenant remains, so it can be retried
      after OpenBao recovers.
- [ ] In rollback mode (`OPENBAO_WRITE_ENABLED=false`) deletion intentionally keeps keys. Note this and purge them
      manually after re-enabling writes; do not treat leftover keys as a test failure.

## 8. Rollback

- [ ] Set `OPENBAO_WRITE_ENABLED=false` (keep `OPENBAO_ENABLED=true`) and restart.
- [ ] Existing `ob_` DIDs still resolve, sign, and verify credentials.
- [ ] New X.509 / did:key / did:web keys go to Askar or the Node KMS (key ids do not start with `ob_`).
- [ ] Deleting a tenant during rollback leaves its keys (intentional; see 7).
- [ ] Re-enable writes and confirm existing `ob_` keys still work and new keys go to OpenBao again.
- [ ] Never unregister the backend while `ob_` keys exist; test that a restart with `OPENBAO_ENABLED=false` does not
      silently break those DIDs (expected: signing fails with a clear key-not-found error, not a crash loop).

## 9. Read/sign-only role

- [ ] With `OPENBAO_WRITE_ENABLED=false` and the read/sign-only AppRole, existing keys sign and verify.
- [ ] Key creation/import/delete is denied by OpenBao even if the application flag is bypassed.
- [ ] Startup health checks still pass with the restricted role.
- [ ] `transit/keys/*/rotate`, `transit/export/*`, and `transit/backup/*` are denied.

## 10. Restart, storage, and disaster recovery

- [ ] Restart OpenBao: keys survive (PostgreSQL storage).
- [ ] Seal and unseal OpenBao following `docs/seal.md`; keys survive and the agent recovers.
- [ ] Restore the `credebl_openbao` database into a clean cluster; `bao list transit/keys` and signing still work.
- [ ] Confirm the plugin does not require KV v2 for any agent-controller flow
      (`OPENBAO_KV_MOUNT` can stay empty).

## 11. Evidence to capture

For the sign-off comment on the PR, attach or paste:

- Exact component SHAs and the OpenBao version.
- `bao list transit/keys` output before/after the X.509 and did:x509 flows.
- Example API responses showing `ob_` key ids and the `did:x509` re-import returning the same `keyId`.
- Credential/status-list verification results from platform and studio.
- Tenant-delete proof (keys before/after).
- Rollback proof (existing key still signs; new key id is not `ob_`).
- Any OpenBao audit log lines for sign/verify/key creation.

## 12. Agent-controller run record (2026-11-07)

This run covers sections 1–10 for agent-controller only. Platform and studio have not been exercised yet, so
the cross-component gate is still open. Evidence was collected against the PostgreSQL-backed OpenBao above;
an earlier pass used PebbleDB and produced the same key behaviour.

| Area                             | Result | Evidence                                                                                                                                       |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, healthy                 | pass   | agent starts with `OPENBAO_ENABLED=true`; `/agent/token` returns 200                                                                           |
| Startup, unreachable             | pass   | `OpenBaoUnreachableError: OpenBao at http://127.0.0.1:8200 is unreachable: connect ECONNREFUSED`; process exits                                |
| Startup, sealed                  | pass   | `OpenBaoSealedError: ... status 503: OpenBao is sealed`; process exits                                                                         |
| Wrong AppRole secret             | pass   | first KMS call: `authentication failed with HTTP 400: invalid role or secret ID`                                                               |
| Empty auth/transit mounts        | pass   | defaults `approle` and `transit` are used (unit tests plus startup)                                                                            |
| X.509 create (P-256)             | pass   | `keyId ob_b6d7429b-...`, Transit key type `ecdsa-p256`; key absent from Askar                                                                  |
| X.509 create (Ed25519)           | pass   | `keyId ob_ba3ab682-...`, Transit key type `ed25519`                                                                                            |
| X.509 create (P-384/P-521)       | known  | pre-existing Credo error `Unsupported hash algorithm for ECDSA with P384/P521: SHA-256`; no OpenBao regression (import path passes)            |
| did:x509 import, six families    | pass   | `p256`, `p384`, `p521`, `ed25519`, `rsa2048`, `rsa4096` all return `ob_` ids; Transit types `ecdsa-p256/p384/p521`, `ed25519`, `rsa-2048/4096` |
| did:x509 chain                   | pass   | `GET /dids/x509/chain/{did}` returns `{ did, x509chain: [leaf, root] }`                                                                        |
| did:x509 re-import               | pass   | same DID and same `keyId`; zero new Transit keys                                                                                               |
| did:x509 deleted key             | pass   | re-import rejected: `bound to KMS key ob_..., which cannot be read`                                                                            |
| did:x509 wrong key               | pass   | re-import rejected: `does not match the private key of the first (leaf) certificate`                                                           |
| did:key opt-out / opt-in         | pass   | opt-out uses an Askar UUID; opt-in uses `ob_...` (`ed25519`, `p256`) and creates one Transit key per key                                       |
| did:key re-import                | pass   | same DID/document, binding preserved, zero new Transit keys, signing still verifies                                                            |
| did:web re-import                | pass   | same seed reuses one Transit key, same DID/document, zero new Transit keys, signing still verifies                                             |
| X25519 / secp256k1               | pass   | both keep Askar UUID key ids even with `OPENBAO_DID_KEY_ENABLED=true`; zero new Transit keys                                                   |
| Tenant isolation                 | pass   | tenant B cannot sign with tenant A's key (`not found in backends 'askar', 'node', 'openbao'`); same material in two tenants → two scoped keys  |
| Tenant delete / purge            | pass   | `DELETE /multi-tenancy/{id}` → 204, tenant 404, only that tenant's `ac_<scope>_*` keys removed, other tenants unchanged                        |
| Tenant delete failure injection  | pass   | OpenBao stopped → delete returns 500 with the unreachable error and the tenant remains; delete succeeds after recovery                         |
| Rollback (`WRITE_ENABLED=false`) | pass   | existing `ob_` DID signs/verifies; new did:key and X.509 keys use Askar UUIDs; zero new Transit keys; tenant delete keeps keys                 |
| Re-enable writes                 | pass   | existing `ob_` DID still signs; new X.509 key returns `ob_...` and adds exactly one Transit key                                                |
| Backend unregistered             | pass   | `OPENBAO_ENABLED=false` starts; signing an `ob_` DID fails clearly with `not found in backends 'askar', 'node'` and the agent stays up         |
| Askar baseline                   | pass   | did:key create/sign/verify and X.509 create use non-`ob_` ids; zero new Transit keys                                                           |
| Read/sign-only role              | pass   | existing key signs; key create/config/delete/rotate/export/backup return 403; with `WRITE_ENABLED=true` the app surfaces the 403               |
| Restart / seal recovery          | pass   | restart with PostgreSQL storage: 11 keys before and after; signing verifies; stop → clear error, unseal → signing works                        |
| PostgreSQL restore               | pass   | cold `pg_dump -n openbao` restored into a clean database; a second OpenBao listed the same 11 keys and signed with a restored Transit key      |
| KV v2 not required               | pass   | all flows run without `OPENBAO_KV_MOUNT`                                                                                                       |

Still open for the cross-component gate:

- OID4VC credential issue/verify, status list, Indy DID + DIDComm, and platform/studio flows (section 5.5 and
  the platform/studio parts of section 11).
- Dedicated-agent scope and restart persistence were exercised locally (`default` scope,
  `ac_21418f9aa040e5a6_*`) but are not yet repeated through platform.

## 13. Platform and studio run record (2026-11-07)

The platform `x509` and `agent-service` microservices were run directly over NATS against a seeded platform database
(user `11111111-1111-4111-8111-111111111111`, organisation `22222222-2222-4222-8222-222222222222`, dedicated
org-agent `33333333-3333-4333-8333-333333333333`, agent endpoint `http://127.0.0.1:4001`) and the live
agent-controller/OpenBao stack. Requests use the platform's NATS envelope (`{ pattern, data, id }`); a bare payload is
treated as an event and never replied to.

This exercises the platform service layer and the studio build/contract. A full platform HTTP/UI flow (Keycloak,
api-gateway, browser) was not available in this environment; see the blockers below.

| Area                                   | Result | Evidence                                                                                                                                     |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `import-did-x509` over NATS            | pass   | `did` and `org_dids.id a58956b9-7802-4dd7-ad61-ffba9b2df8be`; `keyId ob_rnMYkvg9LNltR2Gfkx2nA3hqQTZ_8xUxjG680kID4UQ`                         |
| `import-did-x509` re-import            | pass   | same `org_dids.id`, same DID, same `keyId`; zero duplicate rows and zero new Transit keys                                                    |
| `get-did-x509-chain` over NATS         | pass   | `{ did, x509chain: [leaf, root] }`                                                                                                           |
| `create-x509-certificate` P-256        | pass   | record `e88bb3f0-9a41-458e-b5ec-d87d37b3cca6`, `keyId ob_db421c17-...`, status `Active`, one matching Transit key, self-signed cert verifies |
| `create-x509-certificate` Ed25519      | pass   | record `a99e0260-63bc-4637-9e5f-a1dd00e310a0`, `keyId ob_170b3e90-...`, status `Active`, one matching Transit key, self-signed cert verifies |
| `get-all-certificates` / get one       | pass   | returns the created and imported records with the same `ob_` key ids                                                                         |
| `import-x509-certificate` (base64 DER) | pass   | record `2e2e6855-...`, `keyId ob_22d76889-...`, status `Pending activation` because its validity overlaps an active record                   |
| `import-x509-certificate` (PEM key)    | pass   | no `keyType` supplied; platform derived `Ed25519` from the certificate, `keyId ob_a3062ae9-...`, `isImported: true`                          |
| Transit key count                      | pass   | tenant scope `ac_6ba806f9a2bcab26_*` grew only by the key ids returned by the create/import calls                                            |
| Studio build and lint                  | pass   | `next build`; `/x509-certificate` route built; `eslint` passes on the changed files                                                          |
| Studio-to-platform contract            | pass   | routes `/x509/:orgId`, `/x509/:orgId/import`, `/x509/:orgId/activate/:id` match the platform controller; key-type and key-format fixes below |

### Contract fixes found by this run

- Platform X.509 create rejects a `subject` when no `subjectPublicKey` is supplied (Credo self-signed rule). The
  working create request omits `subject`.
- Platform validates `authorityKey.keyType` against `x5cKeyType` (`P-256`, `Ed25519`). Studio sent `p256`/`ed25519`
  and now sends the enum values.
- Platform import now derives `keyType` from the decoded certificate and forwards that to the agent, so callers may
  omit it or use a different spelling.
- agent-controller certificate import now accepts a PEM private key in addition to base64 DER PKCS#8.
- Platform import records now persist `isImported: true`; previously the column kept its `false` default.

Studio PR #1265 was already squash-merged into `main` before these fixes, so the studio changes ship separately in
`fix/x509-certificates-platform-enum` (PR #1344). `main` now runs Next 16, where `next lint` no longer exists; lint
coverage for that PR is `eslint` on the changed files.

### Blockers and remaining gate

- Full platform/studio HTTP/UI e2e is blocked: no Keycloak realm/client/admin setup or platform `.env` in the repos;
  the compose files use prebuilt `ghcr.io/credebl/*:latest` images, and building the ~10 services from source is not
  feasible with the available disk (~4.5 GiB).
- Still to repeat through platform once that environment exists: OID4VC credential issue/verify, status list,
  Indy DID + DIDComm, and the dedicated-agent flow.
- The SBOM & CBOM workflow remains disabled for this work; re-enable it with approval.

## Exit criteria

- Every non-negotiable item in sections 4–9 passes.
- No Askar/DID/X.509/OID4VC/status-list behavior regressed in the baseline run.
- The only acceptable leftover keys after tenant deletion are those intentionally retained in rollback mode, and they
  are recorded with a purge follow-up.
