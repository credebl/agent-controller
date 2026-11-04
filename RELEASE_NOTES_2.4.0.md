# Agent Controller v2.4.0

Release date: 2026-11-04 · Previous release: v2.3.1

## Highlights

- **`ldp_vc` credentials bind to a `did:web` holder**, the same way SD-JWT credentials have since 2.3.1. The issuer sets `credentialSubject.id` to the holder's bare DID, and a holder that requires binding rejects a credential for a different subject.
- **`Ed25519VerificationKey2020` support.** A `did:web` can be created with a 2020 key, and JSON-LD signing picks the signature suite that matches the key type.
- **Security**: three high-severity runtime Dependabot alerts cleared (`joi`, `follow-redirects`, `@hapi/content`).

## New features

- **`did:web` with a 2020 key.** `POST /dids/write` with `method: web` takes an optional `verificationMethodType`:
  - `Ed25519VerificationKey2018` (default, unchanged);
  - `Ed25519VerificationKey2020`, which publishes `publicKeyMultibase` and adds the `ed25519-2020/v1` context.
- **JSON-LD signing follows the key type.** OID4VCI `ldp_vc` issuance and DCQL / Presentation Exchange `ldp_vp` presentations sign with `Ed25519Signature2020` for a 2020 key and `Ed25519Signature2018` for a 2018 key. Before, Credo chose the 2018 suite for every Ed25519 key, which rejects a 2020 key. `did:key` still signs with `Ed25519Signature2018`.
- **Holder binding check for W3C credentials.** With `holderDidUrl` and `bindingPolicy: require`, a W3C credential whose `credentialSubject` is not the holder DID is rejected with 422 (`HolderBindingMismatchError`) and is not stored.

## Bug fixes

- **Issuer: `credentialSubject.id`.** For `ldp_vc` and `jwt_vc_json(-ld)` credentials it is now the holder's bare DID (`did:web:example.com`) instead of the verification method of the proof key (`did:web:example.com#key-1`). A subject `id` in the offer payload must name the same DID, or the credential request fails; in an array of subjects, at least one must be the holder. This resolves the "`ldp_vc` subject id" known issue from 2.3.1.
- **Holder: proof algorithms.** An `ldp_vc` configuration that lists JWA algorithms such as `EdDSA` in `proof_signing_alg_values_supported` is accepted. Credo only looked for suite names (`Ed25519Signature2018`). Suite names still work.
- **Verifier: DCQL `ldp_vc` types.** In a DCQL query, every `meta.type_values` entry must be an expanded JSON-LD IRI, for example `https://example.org/vocab#MyCredential`. A non-IRI value returns 400 with a hint. Before, such a query never matched anything.
- **Sign raw data.** The key of a DID whose verification method only has `publicKeyMultibase` is now found.

## Upgrade notes

- **No breaking API changes.** `verificationMethodType` is optional and defaults to the old behaviour. Existing DIDs keep their 2018 keys; only new DIDs that ask for 2020 get one.
- **`credentialSubject.id` changes for newly issued W3C credentials.** Consumers that compare it with a verification method URL now receive the bare DID. Credo verifiers accept both.
- **DCQL clients.** A DCQL `ldp_vc` query with short type names (`MyCredential`) now returns 400. Use expanded IRIs.
- **Holder behaviour.** A W3C credential that does not match the holder DID is rejected only when `holderDidUrl` is set with `bindingPolicy: require`. Other requests are unchanged.
- **Docker:** rebuild the image. The Node 26 base image is unchanged.

## Dependencies and patches

- The `@credo-ts/core` and `@credo-ts/openid4vc` patch-package patches for 0.7.4 carry the signature-suite selection until it lands upstream. The `@credo-ts/core` patch also covers DCQL and PEX `ldp_vp` presentations.

## Security

Lockfile updates, all within existing version ranges:

- `joi` 17.13.8 → 17.13.9 (high)
- `follow-redirects` 1.16.1 → 1.16.2 (high)
- `@hapi/content` 6.0.2 → 6.0.3 (high)

## Verification

- `yarn check-types`, `yarn lint` (0 errors), `yarn check-format`, `yarn compile` and `yarn test` (5 suites, 66 tests) pass.
- #471 was also checked in process against the patched Credo 0.7.4, with both 2020 and 2018 `did:web` keys: the issuer picks the matching suite, the `ldp_vc` verifies, DCQL matches the expanded type, and a VP signed by the holder key verifies while one signed by another DID is rejected.
- Not run: a Docker end-to-end test of issuance and presentation between two tenants.

## Known issues / follow-ups

- **Remaining Dependabot alerts have no fix or need a major upgrade:**
  - `@sd-jwt/decode` (high, runtime, up to 0.19.0): tampered disclosures are silently dropped. It has no patched release.
  - `elliptic` (low, runtime): no fix.
  - `minimatch` (medium) and `glob` (medium): they come from `@tsoa/cli`, eslint and jest, and the fix is a major-version jump. They count as runtime only because `tsoa` is still a runtime dependency (see PR #463).
  - `extract-zip`, `ngrok` and `deepmerge`: development only, no fix.
- **Docker image size.** The image is still about 1.9 GB. PR #463 (slimmer image, `tsoa` and build-only packages moved to dev) is open and not part of this release.
- The 2.3.0 secret-scanning alert (a 2023 Atlassian token) is still open and should be confirmed revoked.
- Docker image and ECS names remain `credo-controller`.
