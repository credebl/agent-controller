# Agent Controller v2.3.1

Release date: 2026-11-04 · Previous release: v2.3.0

## Highlights

- **Holder binding to an existing DID**: an OID4VCI holder can bind a received credential to a DID it already controls, such as an organisation's `did:web`, instead of a new `did:jwk` / `did:key` created for every credential.
- **Credo 0.7.4**: patch upgrade from 0.7.0, with no storage migration.
- **Security**: clears the open runtime Dependabot alerts that have a fix (`body-parser`, `decode-uri-component`, `qs`, `fast-uri`).

## New features

`POST /openid4vc/holder/request-credential` takes two optional fields:

| Field           | Description                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `holderDidUrl`  | Verification method to bind to, e.g. `did:web:example.com#key-1`, or a bare DID to use its first authentication key. The DID must exist in the tenant. |
| `bindingPolicy` | `require` (default): fail if the issuer cannot bind to the DID. `prefer`: bind where the issuer allows it, and use a new key for the rest.             |

With `holderDidUrl`, the controller checks for each credential configuration that:

- the format supports DID binding (not `mso_mdoc`);
- the issuer accepts a `jwt` proof without key attestations;
- the DID method is in the issuer's `cryptographic_binding_methods_supported`;
- the issuer accepts one of the key's signature algorithms (an Ed25519 key needs `EdDSA`).

With `require`, the DID method and the `jwt` proof checks (proof type, key attestations, signature algorithm) also run against the offer's metadata before the token request: a credential the issuer cannot bind fails with a 400 that names the configuration, and the pre-authorized code and transaction code stay unused. With `prefer`, these checks are skipped and such credentials fall back to a new key. A malformed `holderDidUrl`, a DID that is not in the tenant, or a verification method that is not in its DID document is always a 400, whatever the policy.

Example:

```json
{
  "credentialOfferUri": "openid-credential-offer://?credential_offer_uri=…",
  "txCode": "1234",
  "holderDidUrl": "did:web:example.com#key-1",
  "bindingPolicy": "prefer"
}
```

## Bug fixes

- `credentialsToRequest` is now honoured. Before, every configuration in the offer was requested whatever the body said. Ids that are not in the offer return 400 before anything is requested.
- A binding that will fail is now rejected before the token request instead of after it. Before, the failure came after the pre-authorized code had been redeemed, so the offer could not be retried.

## Dependencies

- All `@credo-ts/*` packages and the `resolutions` for `@credo-ts/core` and `@credo-ts/askar`: 0.7.0 → 0.7.4. `@credo-ts/push-notifications` stays at `^0.7.1`, its latest release.
- The storage version is still 0.5. Existing wallets open with "Agent storage is up to date", checked against multi-tenant Postgres wallets created on 0.6.2 and 2.3.0.
- patch-package patches regenerated for 0.7.4:
  - `@credo-ts/core` keeps the DCQL `ldp_vc` fix, the `W3cCredential` / `W3cPresentation` id and expiration guards, and `VersionString`. It drops the document loader exports, because Credo now exports `defaultDocumentLoader` itself.
  - `@credo-ts/didcomm` (forward message type) and `@credo-ts/openid4vc` (`OpenId4VcIssuerRepository` export) are unchanged.

## Security

Lockfile updates, all within existing version ranges:

- `body-parser` 1.20.8 → 1.20.9 and 2.3.0 → 2.4.0 (high)
- `decode-uri-component` 0.5.0 → 0.5.1 (high)
- `qs` 6.16.0 → 6.16.2 / 6.17.1 (medium)
- `fast-uri` 3.1.8 → 3.1.9 (medium, low)

## Upgrade notes

- **No breaking API changes.** The new fields are optional. Without `holderDidUrl`, binding works as in 2.3.0: a new `did:jwk`, `did:key` or JWK, depending on what the issuer supports.
- **`credentialsToRequest` is now honoured.** A client that sent a subset of the offered configurations now receives only that subset. To receive everything, omit the field.
- **Offers that mix formats** may allow different DID methods per format. For example, an issuer may allow `did:web` for `dc+sd-jwt` but only `did:key` for `ldp_vc`. With `require`, such an offer is rejected as a whole. Use `prefer`, or request only the configurations that can be bound.
- **OpenAPI schema renames.** Credo 0.7.4 renames the proof schemas behind `/agent/credential/verify` (`DataIntegrityProof` → `AnonCredsW3cCredentialProof`, `SingleOrArray_LinkedDataProof-or-DataIntegrityProof_` → `SingleOrArray_LinkedDataProof-or-AnonCredsW3cCredentialProof_`) and loosens `proofPurpose`. Request and response shapes are unchanged, but clients generated from `swagger.json` may see new type names.
- **`trustedIssuers` on `/agent/credential/verify`.** Credo 0.7.4 adds `trustedIssuers` to the JSON-LD verify options. The request body accepts it as a list of `{ "method": "did", "issuance": "<issuer DID>" }`: a credential from any other DID then fails verification, and an empty list trusts no issuer. Credo's callback form is not exposed.
- **Docker:** rebuild the image. The Node 26 base image is unchanged.

## Verification

- `yarn check-types`, `yarn lint` (0 errors), `yarn check-format`, `yarn compile` and `yarn test` (3 suites, 47 tests, 43 of them new: credential binding resolver and `requestCredential`) pass.
- End to end on 2026-11-03, against local multi-tenant Postgres wallets:
  - **Binding to a `did:web`.** An Entity wallet tenant bound an SD-JWT to its `did:web#key-1`, and the issuer resolved the `did:web` to verify the proof.
  - **`require` and the code.** With `require`, a mixed offer was rejected before the token request, and the same offer then succeeded for the SD-JWT alone.
  - **`prefer` fallback.** With `prefer`, the SD-JWT bound to the `did:web` and the `ldp_vc` fell back to a new `did:key`.
  - **Default unchanged.** Without `holderDidUrl`, a new `did:jwk` was created, as in 2.3.0.
  - **Issue and verify between tenants.** Between an Entity and an Individual tenant, both on 2.3.1, a `dc+sd-jwt` and an `ldp_vc` credential were issued (signed by a `did:web`, bound to the holder's `did:key`) and presented back over OID4VP with DCQL. Result: `ResponseVerified`, with selective disclosure.

## Known issues / follow-ups

- **DCQL `ldp_vc` types.** In a DCQL `ldp_vc` query, `meta.type_values` must be expanded JSON-LD IRIs, e.g. `https://example.org/vocab#MyCredential`, not short type names, as the DCQL specification defines.
- **`ldp_vc` subject id.** For `ldp_vc`, `credentialSubject.id` is set to the holder's verification method URL (`did:key:…#z6Mk…`) rather than the bare DID. This is unchanged from 2.3.0.
- **Relative SD-JWT `kid`.** An issuer whose DID document uses relative verification method ids (`#key-1`) produces SD-JWTs with a relative `kid` header. Credo verifies these, but other verifiers may expect an absolute DID URL.
- **Remaining Dependabot alerts have no upstream fix:**
  - `elliptic` (low, runtime);
  - `extract-zip`, `ngrok` and `deepmerge` (development only).
