# Choosing which credentials to present (OID4VP holder)

`POST /openid4vc/holder/accept-proof-request` answers an OpenID4VP proof request. By default the agent picks the
credentials itself. A caller that wants to decide, for example a wallet app showing the holder a choice, can pass
`selectedCredentials`.

## Request

```json
{
  "proofRequestUri": "openid4vp://?request_uri=...",
  "selectedCredentials": {
    "<descriptor-or-query-id>": ["<credential-record-id>"]
  }
}
```

- Keys are the ids in the proof request: Presentation Exchange **input descriptor ids**, or DCQL **credential query
  ids**.
- Values are the ids of the credential records to present for that key. Each list must contain at least one id.
- Omit `selectedCredentials` (or send `{}`) to keep the automatic selection. Entries you leave out also keep it.

Call `POST /openid4vc/holder/resolve-proof-request` first. It lists the credentials that match each descriptor or
query, which are the only valid choices.

## Rules

- A credential must satisfy the descriptor or query it is chosen for, otherwise the request fails with `400`.
- More than one credential per DCQL query is allowed only when the query sets `multiple: true`, and only for
  OpenID4VP 1.0 requests. Older versions answer `400` before anything is signed.
- Presentation Exchange: a selection replaces the automatic choice for the submission requirements it belongs to. The
  result must still meet each requirement's minimum and maximum, otherwise `400`.
- Supported credential formats for DCQL selection: `dc+sd-jwt`, `mso_mdoc`, W3C `ldp_vc` and `jwt_vc`, and W3C
  VCDM 2.0 `vc+jwt` and `vc+sd-jwt`. W3C VCDM 2.0 Data Integrity credentials (`di_vc`) are rejected with `400`,
  because Credo does not support selecting them yet.
