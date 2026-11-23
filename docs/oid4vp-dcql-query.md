# DCQL queries in presentation requests (OID4VP verifier)

`POST /openid4vc/verification-sessions/create-presentation-request` creates an OpenID4VP authorization request. The
`dcql` field carries a [DCQL](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#name-digital-credentials-query-l)
query, which says which credentials the verifier wants and which claims of them.

The controller accepts the whole DCQL query of OpenID4VP 1.0, section 6. Fields that were not in the request schema
(claim `id` and `values`, `null` and numeric path segments, and `multiple`, `trusted_authorities` and `claim_sets` on a
credential query) used to be refused with `422` by request validation, before the request reached Credo. They are now
passed through.

Which credentials a wallet presents in answer is described in
[Choosing which credentials to present](oid4vp-credential-selection.md).

## Request

```json
{
  "verifierId": "<verifier id>",
  "requestSigner": { "method": "did", "didUrl": "did:web:verifier.example#key-1" },
  "responseMode": "direct_post.jwt",
  "dcql": {
    "query": {
      "credentials": [
        {
          "id": "pid",
          "format": "dc+sd-jwt",
          "meta": { "vct_values": ["https://credentials.example/pid"] },
          "claims": [{ "path": ["given_name"] }, { "path": ["family_name"] }]
        }
      ]
    }
  }
}
```

`dcql` is that object, or the same object as a JSON string. Send either `dcql` or `presentationExchange`, not both. The
query has these parts:

| Field                                  | Where            | Meaning                                                          |
| -------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `credentials`                          | query            | The credential queries. At least one. Each has a unique `id`.    |
| `credential_sets`                      | query            | Which combinations of credential queries satisfy the request.    |
| `id`, `format`                         | credential query | Required. The query id and the credential format.                |
| `meta`                                 | credential query | Format specific filters, for example `vct_values`.               |
| `claims`                               | credential query | The claims to request. Without it, the credential as a whole.    |
| `claim_sets`                           | credential query | Alternative combinations of claims, by claim `id`.               |
| `multiple`                             | credential query | Whether the wallet may return several credentials for the query. |
| `trusted_authorities`                  | credential query | Restricts which issuers are acceptable.                          |
| `require_cryptographic_holder_binding` | credential query | Default `true`. `false` asks for no key binding.                 |
| `id`                                   | claim            | Names the claim, so `claim_sets` can refer to it.                |
| `path`                                 | claim            | Required. Where the claim is.                                    |
| `values`                               | claim            | The claim matches only if its value is one of these.             |
| `intent_to_retain`                     | claim            | `mso_mdoc` only: whether the verifier keeps the value.           |

## Claim paths

`path` is an array. A string selects an object key, a number an array index, and `null` every element of an array.

```json
{ "path": ["credentialSubject", "role"] }
{ "path": ["nationalities", null] }
{ "path": ["address", 0, "city"] }
```

For `mso_mdoc`, the path has two entries: the namespace and the element name.

```json
{ "path": ["org.iso.18013.5.1", "family_name"], "intent_to_retain": false }
```

## Matching on a value: `values`

A claim with `values` matches only when the credential's value is one of them. Strings, numbers and booleans are
allowed. Use it to ask for one specific value instead of requesting the claim and checking it afterwards:

```json
{
  "id": "employee",
  "format": "dc+sd-jwt",
  "meta": { "vct_values": ["https://credentials.example/employment"] },
  "claims": [{ "path": ["role"], "values": ["manager", "director"] }, { "path": ["department"] }]
}
```

A wallet whose credential has `role: "intern"` does not match this query.

## Examples per format

Only `meta` differs between formats.

**SD-JWT VC (`dc+sd-jwt`)**

```json
{ "id": "pid", "format": "dc+sd-jwt", "meta": { "vct_values": ["https://credentials.example/pid"] } }
```

**mdoc (`mso_mdoc`)**

```json
{
  "id": "mdl",
  "format": "mso_mdoc",
  "meta": { "doctype_value": "org.iso.18013.5.1.mDL" },
  "claims": [{ "path": ["org.iso.18013.5.1", "family_name"] }]
}
```

**W3C JSON-LD (`ldp_vc`)**. `type_values` is a list of alternatives, each a list of **expanded** type IRIs, the ones the
credential's `@context` defines. A short name such as `Degree` is refused with `400`, because it would never match and the
wallet would only answer that the query cannot be satisfied.

```json
{
  "id": "degree",
  "format": "ldp_vc",
  "meta": {
    "type_values": [["https://www.w3.org/2018/credentials#VerifiableCredential", "https://example.org/Degree"]]
  },
  "claims": [{ "path": ["credentialSubject", "degree"] }]
}
```

**W3C JWT (`jwt_vc_json`)**. `type_values` is a list of alternatives.

```json
{
  "id": "badge",
  "format": "jwt_vc_json",
  "meta": { "type_values": [["VerifiableCredential", "EmployeeBadge"]] }
}
```

## `multiple`

By default a wallet returns one credential for a query. With `"multiple": true` it may return several, for example all
of a person's diplomas:

```json
{
  "id": "diploma",
  "format": "dc+sd-jwt",
  "multiple": true,
  "meta": { "vct_values": ["https://credentials.example/diploma"] }
}
```

Several credentials for one query are possible only in OpenID4VP 1.0 requests. A holder choosing them with
`selectedCredentials` is described in the selection guide.

## `claim_sets`: alternative claim combinations

`claim_sets` lists the combinations of claims, by claim `id`, that are acceptable, in order of preference. Every claim
that a set names must have an `id`:

```json
{
  "id": "pid",
  "format": "dc+sd-jwt",
  "meta": { "vct_values": ["https://credentials.example/pid"] },
  "claims": [
    { "id": "a", "path": ["given_name"] },
    { "id": "b", "path": ["family_name"] },
    { "id": "c", "path": ["birthdate"] },
    { "id": "d", "path": ["age_over_18"] }
  ],
  "claim_sets": [
    ["a", "b", "c"],
    ["a", "b", "d"]
  ]
}
```

The wallet discloses the first combination it can: name and birthdate, or, if the birthdate is not available, name and
the `age_over_18` claim.

## `trusted_authorities`: restricting issuers

Only credentials from an acceptable issuer match. `type` says how the authority is identified, and `values` lists the
acceptable ones:

```json
{
  "id": "pid",
  "format": "dc+sd-jwt",
  "meta": { "vct_values": ["https://credentials.example/pid"] },
  "trusted_authorities": [{ "type": "aki", "values": ["s9tIpPmhxdiuNkHMEWNpYim8S8Y"] }]
}
```

Types in OpenID4VP 1.0 include `aki` (the authority key identifier of the issuer certificate), `etsi_tl` (an ETSI trusted
list) and `openid_federation`. The controller passes the type through; whether a wallet understands it is up to the
wallet.

## `credential_sets`: several credentials, with alternatives

`credential_sets` says which credential queries must be answered. Each set has `options`, alternatives made of query
ids, and `required` (default `true`):

```json
{
  "dcql": {
    "query": {
      "credentials": [
        { "id": "pid", "format": "dc+sd-jwt", "meta": { "vct_values": ["https://credentials.example/pid"] } },
        { "id": "passport", "format": "mso_mdoc", "meta": { "doctype_value": "org.iso.23220.1.passport" } },
        { "id": "loyalty", "format": "dc+sd-jwt", "meta": { "vct_values": ["https://credentials.example/loyalty"] } }
      ],
      "credential_sets": [{ "options": [["pid"], ["passport"]] }, { "required": false, "options": [["loyalty"]] }]
    }
  }
}
```

This asks for a `pid` **or** a `passport`, and optionally a `loyalty` credential. Without `credential_sets`, every
credential query is required.

## Errors

| Situation                                                       | Result                                          |
| --------------------------------------------------------------- | ----------------------------------------------- |
| A field that is not part of DCQL, or a claim without `path`     | `422` from request validation                   |
| A credential query without `id` or `format`                     | `422`                                           |
| `ldp_vc` `meta.type_values` with a short name instead of an IRI | `400`, naming the query and the offending value |
| Both `dcql` and `presentationExchange`, or neither              | An error: only one of them may be provided      |
| A `dcql` string that is not valid JSON                          | Credo reports the invalid query                 |

The controller validates the shape of the query. Whether a wallet can satisfy it is decided on the wallet's side.
