# Choosing which credentials to present (OID4VP holder)

`POST /openid4vc/holder/accept-proof-request` answers an OpenID4VP proof request. By default the agent picks the
credentials itself. A caller that wants to decide, for example a wallet app showing the holder a choice, can pass
`selectedCredentials`.

The queries a wallet answers are written by the verifier; see [DCQL queries in presentation requests](oid4vp-dcql-query.md).

## Request

```json
{
  "proofRequestUri": "openid4vp://?request_uri=...",
  "selectedCredentials": {
    "<descriptor-or-query-id>": ["<credential-record-id>"]
  }
}
```

- Keys are the ids in the proof request: DCQL **credential query ids** or Presentation Exchange **input descriptor
  ids**.
- Values are the ids of the credential records to present for that key. Each list must contain at least one id.
- Omit `selectedCredentials` (or send `{}`) to keep the automatic selection. Keys you leave out also keep it.

## Finding the ids

Call `POST /openid4vc/holder/resolve-proof-request` with the same `proofRequestUri` first. Only the credentials it
offers are valid choices:

- **DCQL:** `dcql.queryResult.credential_matches.<queryId>.valid_credentials[].record.id`. The query ids are the
  `id` fields of `dcql.queryResult.credentials[]`.
- **Presentation Exchange:**
  `presentationExchange.credentialsForRequest.requirements[].submissionEntry[]`, where `inputDescriptorId` is the key
  and `verifiableCredentials[].credentialRecord.id` are the choices.

## DCQL examples, one per credential format

The query ids (`pid`, `licence`, ...) come from the verifier's DCQL query. The credential ids are example values.

### SD-JWT VC (`dc+sd-jwt`)

```json
{ "selectedCredentials": { "pid": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"] } }
```

The credential is presented with the claims the query asks for, disclosed selectively.

### mdoc (`mso_mdoc`)

```json
{ "selectedCredentials": { "mdl": ["a8d2e4f0-71b6-4c3d-8e55-0b9a6c1d2e34"] } }
```

### W3C JSON-LD (`ldp_vc`)

```json
{ "selectedCredentials": { "university_degree": ["c5b7a901-2d4e-4f68-a3b1-7e9d0c8f1a22"] } }
```

### W3C JWT (`jwt_vc` / `jwt_vc_json`)

```json
{ "selectedCredentials": { "employee_badge": ["e19f6d02-84ac-4b37-9d10-5c3a7b2e8f46"] } }
```

`ldp_vc` and `jwt_vc` credentials (W3C VCDM 1.x) are presented whole: the claim list of the query selects the
credential but does not redact it.

### W3C VCDM 2.0 JWT (`vc+jwt`) and SD-JWT (`vc+sd-jwt`)

```json
{
  "selectedCredentials": {
    "membership": ["7a40c3d8-5e19-4b02-8f6a-1d9e2b3c4a57"],
    "loyalty": ["0b6e8d41-93f7-4a25-b8c0-6f1a2d3e4b98"]
  }
}
```

`vc+sd-jwt` is disclosed selectively like `dc+sd-jwt`. `vc+jwt` is presented whole.

### Not supported: W3C VCDM 2.0 Data Integrity (`di_vc`)

Selecting such a credential answers `400` (`W3C V2 Data Integrity credentials are not supported for DCQL selection`),
because Credo does not support it yet.

## DCQL selection variations

### One query, several candidates: pick one

The wallet holds two matching credentials for query `pid`. Choose the second:

```json
{ "selectedCredentials": { "pid": ["second-credential-id"] } }
```

### Several queries: select each one

```json
{
  "selectedCredentials": {
    "pid": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"],
    "licence": ["a8d2e4f0-71b6-4c3d-8e55-0b9a6c1d2e34"]
  }
}
```

### Select only some queries

Queries you do not list keep the automatic selection. Here only `pid` is chosen by the caller:

```json
{ "selectedCredentials": { "pid": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"] } }
```

### `credential_sets`: choosing which alternative to present

A DCQL query can group queries into `credential_sets`, each with `options` (alternatives) and `required`. Example: the
verifier accepts a `pid` **or** a `passport`:

```json
{
  "credentials": [
    { "id": "pid", "format": "dc+sd-jwt" },
    { "id": "passport", "format": "dc+sd-jwt" }
  ],
  "credential_sets": [{ "required": true, "options": [["pid"], ["passport"]] }]
}
```

Without a selection the agent presents the first option it can fulfil, which is `pid` when the wallet holds one. To
present the passport, select a credential for `passport` only:

```json
{ "selectedCredentials": { "passport": ["d4a1b2c3-5e6f-4789-a0b1-c2d3e4f5a6b7"] } }
```

When the request has `credential_sets` and you send `selectedCredentials`, **queries you leave out are not presented**,
so the option made of the queries you chose is the one answered. Select every query of the option you want:

```json
{
  "selectedCredentials": {
    "pid": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"],
    "address": ["9c2e7f10-4b3a-4d58-8a61-e0f1a2b3c4d5"]
  }
}
```

for `"options": [["pid", "address"], ["passport"]]`. If the queries you chose do not complete any option of a required
set, the request fails with `400` (Credo reports that the query cannot be satisfied).

Without `credential_sets`, queries you leave out stay automatic, as described above.

### Several credentials for one query (`multiple: true`)

Allowed only when the DCQL query has `"multiple": true`, and only for OpenID4VP 1.0 requests:

```json
{
  "selectedCredentials": {
    "diploma": ["11111111-aaaa-4bbb-8ccc-000000000001", "11111111-aaaa-4bbb-8ccc-000000000002"]
  }
}
```

Without `multiple: true` the request fails with `400`: `DCQL credential query "diploma" does not allow multiple
credentials. Select one credential per query.` On older OpenID4VP versions it fails with `400` before anything is
signed.

### Mixed formats in one request

Each query is independent, so formats can be mixed:

```json
{
  "selectedCredentials": {
    "pid": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"],
    "mdl": ["a8d2e4f0-71b6-4c3d-8e55-0b9a6c1d2e34"],
    "degree": ["c5b7a901-2d4e-4f68-a3b1-7e9d0c8f1a22"]
  }
}
```

### Errors

| Situation                                                 | Result |
| --------------------------------------------------------- | ------ |
| Unknown query id                                          | `400`  |
| Query cannot be satisfied by any credential in the wallet | `400`  |
| Credential id does not satisfy that query                 | `400`  |
| Empty list for a key                                      | `400`  |
| More than one id without `multiple: true`                 | `400`  |
| More than one id on a request older than OpenID4VP 1.0    | `400`  |
| `di_vc` credential selected                               | `400`  |

## Presentation Exchange examples

Keys are input descriptor ids. A selection replaces the automatic choice for the submission requirements it belongs to,
and the result must still meet each requirement's minimum and maximum.

Single descriptor:

```json
{ "selectedCredentials": { "id_card": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"] } }
```

Submission requirement `pick` with `count: 1` over descriptors `passport` and `id_card`: select exactly one of them.

```json
{ "selectedCredentials": { "id_card": ["3f1c9b7e-0a53-4a47-9b8c-2f6d1e7a9c10"] } }
```

Selecting both descriptors in that case answers `400` (`expected at most 1, received 2`). Selecting fewer than the
minimum answers `400` (`expected at least N`). A credential not offered for a descriptor, or an unknown descriptor id,
also answers `400`.

## Response

The endpoint returns the HTTP outcome of the submission to the verifier:

```json
{
  "status": 200,
  "body": { "presentationExchange": {}, "dcql": {} },
  "verifierResponse": { "redirect_uri": "https://verifier.example/done" }
}
```

- `status` is the verifier's HTTP status.
- `body` is what the holder submitted. It is unchanged, so existing clients keep working.
- `verifierResponse` is the verifier's own response body. When the verifier rejects the presentation, it carries the
  reason, which `body` never did:

```json
{
  "status": 400,
  "body": { "dcql": {} },
  "verifierResponse": {
    "error": "invalid_request",
    "error_description": "One or more presentations failed verification."
  }
}
```

`verifierResponse` is present when the verifier answered; show its `error_description` to the user or log it for support.
When the verifier sends no body, it is absent or empty.

## Errors when no credentials can be selected

If the wallet cannot satisfy the request at all, for example no credential matches a required query, the endpoint
answers `400` with Credo's message. Before this change it answered `500`. Nothing is sent to the verifier in that case.
Other failures, such as storage errors, stay `500`.
