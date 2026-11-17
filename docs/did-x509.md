# did:x509 support

An issuer, verifier or holder that already has a certificate issued by a CA (and its private key) can import them into the agent and get a `did:x509` identifier. The DID is derived from the certificate chain, the leaf key is stored in the agent's key management system (KMS), and the agent can sign with it like with any other DID.

This guide covers the import flow. Using a did:x509 as the signer of SD-JWT VC credentials is covered below. Verifying credentials from did:x509 issuers is covered as well. Holder binding with a did:x509 and the trust registry are planned and not covered yet.

## What is a did:x509

A `did:x509` anchors a DID in an X.509 certificate chain instead of a ledger. See the [did:x509 specification](https://github.com/microsoft/did-x509).

```
did:x509:0:sha256:<fingerprint of the root CA>::<policy>[::<policy>]
```

- The **fingerprint** is the SHA-256 hash of the last certificate of the chain (the root CA), base64url encoded. It ties the DID to that CA.
- The **policies** narrow down which leaf certificates may use the DID, for example `subject:CN:issuer.example.com`.

The DID document is not stored on a ledger. It is computed from the DID and the certificate chain, so **resolving a did:x509 always needs the chain**. The agent resolves the DIDs it imported by itself (the chain is stored with the DID). For DIDs it does not own, the chain has to come from the credential, normally the `x5c` header.

The agent registers the [`@didx509/credo`](https://www.npmjs.com/package/@didx509/credo) resolver with `jsonWebKey2020VerificationMethod: true`, because Credo only understands the `JsonWebKey2020` verification method type and the specification emits `JsonWebKey`.

## Import a certificate chain

`POST /dids/x509/import` (scope: tenant agent or dedicated agent)

| Field              | Required | Description                                                                                                                                                 |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `certificateChain` | yes      | The certificates, **leaf first and root CA last**. Every entry is a PEM certificate, a PEM bundle with several certificates, or a base64 (DER) certificate. |
| `privateKey`       | yes      | Private key of the **leaf** certificate. PEM (PKCS#8, SEC1 or PKCS#1) or base64 DER (PKCS#8).                                                               |
| `passphrase`       | no       | Passphrase if the private key is encrypted.                                                                                                                 |
| `policies`         | no       | Policies of the DID. Defaults to the common name of the leaf certificate (`subject:CN`). See [Policies](#policies).                                         |
| `did`              | no       | Import an existing did:x509 instead of deriving one from the chain. It is validated against the chain. `policies` is ignored when `did` is given.           |

```bash
curl -X POST "$AGENT_URL/dids/x509/import" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "certificateChain": [
      "-----BEGIN CERTIFICATE-----\n...leaf...\n-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----\n...issuing CA...\n-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----\n...root CA...\n-----END CERTIFICATE-----"
    ],
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  }'
```

Response:

```json
{
  "did": "did:x509:0:sha256:JAsSSeWsY5gMqdlgdAzlzw0Z58r0jdA4rWzHP-Ju0r4::subject:CN:issuer.example.com",
  "didDocument": {
    "id": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com",
    "verificationMethod": [
      {
        "id": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com#0",
        "type": "JsonWebKey2020",
        "controller": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com",
        "publicKeyJwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
      }
    ],
    "assertionMethod": ["did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com#0"]
  },
  "keyId": "dVD6pXEPBlStv7pWUpa2Cpl1kw3ui7v8uYPrgjI7lTo",
  "verificationMethodId": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com#0"
}
```

What the endpoint does:

1. Reads the chain and the private key and checks that the key belongs to the leaf certificate.
2. Builds the DID from the root fingerprint and the policies.
3. Resolves the DID against the chain. This validates the fingerprint, the policies, the chain order and signatures, the basic constraints (CA flag and path length) and the validity period of every certificate.
4. Imports the leaf key into the KMS. The key id is the JWK thumbprint, so importing the same key again reuses it.
5. Imports the DID with a binding to that key, and stores the chain with the DID record.

Importing the same chain and key again returns the same DID. Use the returned `did` (or `verificationMethodId`) wherever the agent expects a DID.

### Other endpoints

| Endpoint                      | Description                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dids/x509/chain/{did}`  | The certificate chain stored for an imported did:x509 (base64url DER, leaf first).                                                                                                                                                                                                                          |
| `GET /dids/{did}`             | Resolves the DID. Works without passing the chain for DIDs imported into this agent.                                                                                                                                                                                                                        |
| `GET /dids`                   | Lists the DIDs created or imported by the agent, including the did:x509 ones.                                                                                                                                                                                                                               |
| `POST /agent/credential/sign` | Signs raw data with the DID's key: `?dataTypeToSign=rawData` and `{ "did": "...", "keyType": "ES256", "data": "<base64>", "publicKeyBase58": "unused" }`. The endpoint requires `publicKeyBase58` even when `did` is given, the value is ignored then. `keyType` is the JWS algorithm from the table below. |

A did:x509 contains `:` and, with some policies, percent-encoded characters (`Acme%20Corp`). **URL-encode the whole DID** when it is part of a path, otherwise the `%` sequences are decoded twice.

## Preparing the inputs

Certificates and keys from CAs usually come as PEM files. If you have a PKCS#12 bundle (`.p12` / `.pfx`):

```bash
# the leaf certificate and the chain
openssl pkcs12 -in bundle.p12 -clcerts -nokeys -out leaf.pem
openssl pkcs12 -in bundle.p12 -cacerts -nokeys -out ca-chain.pem
# the private key (unencrypted PKCS#8)
openssl pkcs12 -in bundle.p12 -nocerts -nodes -out leaf.key
```

Notes:

- The order matters: the leaf first, then the issuing CA(s), the root last. The root is required, because the DID is anchored in its fingerprint.
- Send the certificates as separate entries or as one PEM bundle per entry, both work.
- The agent does not check that the root is trusted by anything. Trust is established separately (the agent's trusted certificates / the trust list).

## Key types and the KMS

| Key type of the leaf certificate | Algorithm | KMS backend |
| -------------------------------- | --------- | ----------- |
| EC P-256                         | ES256     | Askar       |
| EC P-384                         | ES384     | Askar       |
| EC P-521                         | ES512     | Node        |
| Ed25519                          | EdDSA     | Askar       |
| RSA                              | RS256     | Node        |

Askar, the default KMS, only holds EC and Ed25519 keys and has no ES512 signing. For RSA and P-521 keys the agent registers a second KMS backend based on `node:crypto` (`src/utils/kms/nodeKms.ts`). Its keys are kept as records in the agent's own wallet storage, scoped per tenant, so they are encrypted at rest and survive restarts like any other agent data. Askar stays the default backend, the Node backend is only used for keys Askar cannot handle.

secp256k1 certificates are not supported: the did:x509 resolver only supports P-256, P-384 and P-521 EC keys.

## Policies

If `policies` is omitted, the DID is restricted to the common name of the leaf certificate (`subject:CN:<common name>`). The request fails if the leaf has no common name, pass `policies` in that case.

```json
{ "type": "subject", "fields": { "CN": "issuer.example.com", "O": "Acme Corp" } }
{ "type": "san", "sanType": "dns", "value": "issuer.example.com" }
{ "type": "eku", "value": "1.3.6.1.5.5.7.3.3" }
{ "type": "fulcio-issuer", "value": "https://accounts.example.com" }
```

| Type            | Restricts the DID to leaf certificates with              | DID segment                     |
| --------------- | -------------------------------------------------------- | ------------------------------- |
| `subject`       | the given subject attributes (`CN`, `O`, `OU`, `C`, ...) | `subject:CN:issuer.example.com` |
| `san`           | a subject alternative name (`dns`, `email`, `uri`)       | `san:dns:issuer.example.com`    |
| `eku`           | an extended key usage OID                                | `eku:1.3.6.1.5.5.7.3.3`         |
| `fulcio-issuer` | a Fulcio issuer extension                                | `fulcio-issuer:<value>`         |

Several policies are joined with `::`. Values are percent-encoded as the specification requires. Pick the narrowest policy that still covers the certificates you will rotate to: a DID with `subject:CN:...` keeps working after the leaf certificate is renewed, as long as the subject stays the same and the same root CA issues it. Import the renewed chain and key again under the same DID.

## Issue SD-JWT VC credentials with a did:x509

Use the imported DID as the signer of an OpenID4VCI credential offer. Only SD-JWT VC (`dc+sd-jwt` and `vc+sd-jwt`) is supported with a did:x509. For `mso_mdoc` keep using the `x5c` signer method, and W3C formats are not supported (the request fails with a clear error).

```bash
curl -X POST "$AGENT_URL/openid4vc/issuance-sessions/create-credential-offer" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "publicIssuerId": "my-issuer",
    "credentials": [{
      "credentialSupportedId": "IdentityCredential-sdjwt",
      "format": "dc+sd-jwt",
      "signerOptions": { "method": "did", "did": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com" },
      "payload": { "vct": "urn:acme:identity", "given_name": "Alice" },
      "disclosureFrame": { "_sd": ["given_name"] }
    }],
    "preAuthorizedCodeFlowConfig": { "authorizationServerUrl": "https://agent.example.com/oid4vci/my-issuer" }
  }'
```

The `credential_signing_alg_values_supported` of the credential configuration must include the algorithm of the imported key (`ES256`, `ES384`, `ES512`, `EdDSA` or `RS256`, see [Key types](#key-types-and-the-kms)).

The issued credential looks like this:

```json
// header
{ "typ": "dc+sd-jwt", "alg": "ES256", "kid": "#0", "x5c": ["<leaf>", "<issuing CA>", "<root CA>"] }
// payload
{ "iss": "did:x509:0:sha256:JAsS...::subject:CN:issuer.example.com", "vct": "urn:acme:identity", "cnf": { "jwk": { "...": "..." } }, "_sd": ["..."] }
```

- `iss` is the did:x509 and `kid` is the relative id of its verification method.
- The **full chain is carried in `x5c`** (leaf first, root last, the root is needed because the DID is anchored in its fingerprint). A verifier that knows did:x509 resolves the DID with this chain. A verifier that does not can still validate the signature and the chain through `x5c`.
- The chain comes from the one stored when the DID was imported, so the DID has to be imported into the agent that issues.

### Credo patch

Credo 0.7 can put either a `kid` (DID signer) or an `x5c` chain (x5c signer) in the header, not both, and its verifier picks the `x5c` branch as soon as the header has one, which then rejects an `iss` that is a DID. The `patches/@credo-ts+core+0.7.4.patch` patch adds an optional `x5c` to the DID issuer and makes the verifier use the DID when `iss` is a DID and a `kid` is present. The patch also covers verification (see [Verify credentials from did:x509 issuers](#verify-credentials-from-didx509-issuers)): for a did:x509 issuer with an `x5c` chain, the chain is trusted like an `x5c` chain and is passed to the DID resolver. Credo-based holders and verifiers that do not carry this change reject these credentials. The change is meant to go upstream, it is discussed in [credo-ts#3187](https://github.com/openwallet-foundation/credo-ts/issues/3187).

## Verify credentials from did:x509 issuers

When the agent verifies an SD-JWT VC (a presentation in an OpenID4VP flow, or any credential it checks) whose `iss` is a did:x509 and whose header has an `x5c` chain, it treats the credential as **bound to the DID**, with `x5c` as the evidence needed to resolve it. The DIDs do not have to be imported into the agent, the chain comes with the credential:

1. **Trust:** the chain from `x5c` goes through the same check as the chain of an `x5c` issuer. Its root must be trusted by the agent's X.509 trust configuration, which is the trust list (`TRUST_LIST_URL`) or the trust service (`TRUST_SERVICE_*`). Nothing new has to be configured, list the root CA there.
2. **Resolution:** the DID is resolved with the chain (`x509chain`). This checks the CA fingerprint in the DID, the policies against the leaf certificate (`subject`, `san`, ...), the chain and the validity period.
3. **Signature:** the credential signature is verified with the key in the resolved DID document, which is the key of the leaf certificate.

Because `iss` is resolved and not only the certificate checked, a certificate from a trusted CA cannot claim the did:x509 of another organisation: the policies of that DID do not match its leaf certificate and the resolution fails.

| Case                                                                     | Result                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Root of the chain is in the trust list                                   | accepted                                                                             |
| No trusted certificates configured                                       | rejected: `No trusted certificates configured for X509 certificate chain validation` |
| Another root is trusted, not the one of the chain                        | rejected: `No trusted certificate was found while validating the X.509 chain`        |
| `iss` is a did:x509 that the chain's leaf does not satisfy (same CA)     | rejected: `Unable to resolve did document ...`                                       |
| `x5c` header missing (a verifier that does not own the DID has no chain) | rejected: `Unable to resolve did document ...`                                       |
| Payload changed after signing                                            | rejected: `Invalid JWT Signature`                                                    |

Not covered yet: an allowlist of trusted DIDs (the trust decision is by root CA only), revocation and status list checks with the chain, and presenting with a did:x509 as holder binding.

## Errors

| Status | Message                                                                                        | Cause                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `privateKey does not match the public key of the first (leaf) certificate in certificateChain` | Wrong key, or the chain is not leaf first.                                                                                                                                                   |
| 400    | `did:x509 does not validate against certificateChain: ...`                                     | The DID does not match the chain, for example a missing intermediate, a policy that does not match the leaf, an expired certificate, a CA path length violation, or an unsupported EC curve. |
| 400    | `certificateChain contains an invalid certificate: ...`                                        | An entry is not a PEM / base64 DER certificate.                                                                                                                                              |
| 400    | `Unable to read privateKey: ...`                                                               | The key is not PEM / DER, or the passphrase is wrong.                                                                                                                                        |
| 400    | `The leaf certificate has no common name (CN), provide policies ...`                           | No `policies` and no `did` were given and the leaf has no CN.                                                                                                                                |
| 401    | `Unauthorized`                                                                                 | Missing or invalid token.                                                                                                                                                                    |

## Security notes

- The private key is sent to the agent in the request body. Only call the endpoint over TLS and do not put the key in logs or URLs. The agent does not log request bodies.
- The key is stored in the agent's encrypted wallet (Askar, or the Node backend's records in the same wallet). It cannot be read back through the API.
- Importing a key you do not control the certificate for is not possible: the key has to match the leaf certificate.

## Limitations and what is planned

- Outside credential verification, only DIDs imported into the agent resolve without the chain. For credentials the chain comes from `x5c`, see [Verify credentials from did:x509 issuers](#verify-credentials-from-didx509-issuers).
- Holder binding with a did:x509, the did:x509 as verifier request signer, an allowlist of trusted DIDs and the trust registry integration are planned.
- The resolver does not cache DID documents, every resolution validates the chain.
- Keys can only be imported through the API for now. Keeping the key in an external KMS (OpenBao) is tracked in [#437](https://github.com/credebl/agent-controller/pull/437).
- Requires `@didx509/core` 0.1.3 or newer: earlier versions reject chains whose issuing CA has `pathlen:0`.

## Trying it locally

A throwaway chain to test the endpoint (root CA, issuing CA with `pathlen:0`, leaf):

```bash
K="-algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve"
for f in root int leaf; do openssl genpkey $K -out $f.key; done

openssl req -x509 -sha256 -new -key root.key -subj "/CN=Test Root CA" -days 30 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.pem

openssl req -new -key int.key -subj "/CN=Test Issuing CA" -out int.csr
printf "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n" > int.ext
openssl x509 -req -sha256 -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -days 30 -extfile int.ext -out int.pem

openssl req -new -key leaf.key -subj "/CN=issuer.example.com" -out leaf.csr
printf "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectAltName=DNS:issuer.example.com\n" > leaf.ext
openssl x509 -req -sha256 -in leaf.csr -CA int.pem -CAkey int.key -CAcreateserial -days 30 -extfile leaf.ext -out leaf.pem

openssl verify -CAfile root.pem -untrusted int.pem leaf.pem
```

Then send `leaf.pem`, `int.pem`, `root.pem` as `certificateChain` and the content of `leaf.key` as `privateKey`. On macOS the system `openssl` is LibreSSL, which writes EC keys with explicit curve parameters and signs with SHA-1 by default: keep the `ec_param_enc:named_curve` option and `-sha256` as above.
