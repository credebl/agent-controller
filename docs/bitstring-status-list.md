# Bitstring Status List revocation

Agent Controller supports [W3C Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/) revocation for W3C JSON-LD credentials (`ldp_vc` and `jwt_vc_json-ld`, including VCDM 2.0). SD-JWT credentials continue to use the SD-JWT `status_list` mechanism.

## Configuration

| Variable                      | Purpose                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATUS_LIST_SERVER_URL`      | Base URL of the status-list server. Required for revocable issuance and revocation.                                                           |
| `STATUS_LIST_API_KEY`         | Value sent as `x-api-key` to the status-list server.                                                                                          |
| `STATUS_LIST_DEFAULT_SIZE`    | Default size for SD-JWT status lists.                                                                                                         |
| `STATUS_LIST_ALLOWED_ORIGINS` | Optional comma-separated allowlist of status-list origins used during verification. The origin of `STATUS_LIST_SERVER_URL` is always allowed. |

Status-list verification fails closed if no origins are configured. A status list hosted on any other origin is rejected before it is fetched.

## Issuance

When a credential offer has `isRevocable: true`, the issuer creates or reuses a status list and adds a status entry to the credential:

- JSON-LD credentials receive `credentialStatus` with type `BitstringStatusListEntry`, purpose `revocation`, the status list URL and the zero-based index.
- SD-JWT credentials keep the existing `status_list` block.

The issuance session stores `StatusListInfo` with the list id, index, issuer DID and, for bitstring lists, `mechanism: "bitstring"`. Revoking by session id uses that field to select the correct revoker.

## Revocation

DIDComm credentials can also be revoked directly:

```http
POST /didcomm/credentials/revoke
Content-Type: application/json

{
  "listId": "example-list",
  "index": 42,
  "issuerDid": "did:web:issuer.example"
}
```

The response is `{ "revoked": true, "listId": "...", "index": 42 }`. The caller's wallet must control `issuerDid`, and the fetched list's `issuer` must match it; otherwise the request returns HTTP 403 before anything is signed or sent. For OID4VCI sessions, use the existing session revocation endpoint; it dispatches to bitstring or SD-JWT revocation automatically.

Updates use the status-list server's `If-Match`/ETag protocol and retry conflicts (HTTP 412) a bounded number of times. Per-list locking serializes concurrent updates inside one controller process. Multiple controller instances still need to share or front the same status-list server; configure sticky routing for issuance sessions when notifications or per-session locks matter.

## Verification

`POST /agent/credential/verify` detects VCDM 1.1 and VCDM 2.0 credentials, verifies the signature with the matching Credo API, and then checks any bitstring status entry. The response adds:

- `verified`: both the signature and status verification passed.
- `revocation`: `{ checked, revoked, verified, statusListUri?, statusListIndex?, statusPurpose?, error? }`.

`isValid` is set to the same value as `verified`, so a valid signature over a revoked credential returns `isValid: false`. A credential with no bitstring status entry returns `checked: false`, `revoked: false`, `verified: true`.

OID4VC verification-session responses include an aggregated `revocation` summary with `checked`, `revoked`, `verified` and per-presentation/per-credential details.

## Local checks

The following scripts are available:

- `yarn test:vc-jsonld` — VCDM 2.0 / `ldp_vc` signing and verification smoke checks.
- `yarn test:v1-status-roundtrip` — SD-JWT / VCDM 1.1 status-list round trip. This script fetches the legacy `https://w3id.org/vc/status-list/2021/v1` context, so it requires network access.
- `yarn test:bitstring-status-list` — integration check against a running status-list server. Set `STATUS_LIST_SERVER_URL` and `STATUS_LIST_API_KEY` first.

## Limitations

- The inline `credentials/v2` and `status/v1` contexts cannot be combined in one JSON-LD document when a status term is redefined as protected; keep status entries in credentials that use a compatible context set.
- `Ed25519Signature2020` can sign with an `Ed25519VerificationKey2018` key, but verification with that key type is not supported. Use a matching 2020 key and suite for VCDM 2.0 credentials.
- Only `statusSize: 1` bitstring lists are supported.
- Status-list index values must be non-negative safe integers inside the published list.
