# Optional OpenBao KMS

agent-controller uses Askar as its default KMS. OpenBao Transit is an optional, opt-in backend for the key types Askar
cannot hold or that an operator wants in a centrally managed KMS. Existing wallets and DIDs keep working unchanged: no
key is re-imported, and Askar remains the default for implicit key creation, DIDComm, routing, X25519, and secp256k1.

The backend itself is the Apache-2.0 [`@credebl/credo-ts-openbao`](https://github.com/sovio-id/credo-ts-openbao) plugin.
Unseal options, PostgreSQL storage, disaster recovery, and the key-rotation prohibitions are documented in its
[`docs/seal.md`](https://github.com/sovio-id/credo-ts-openbao/blob/main/docs/seal.md).

## What goes to OpenBao

| Flow                        | Key types                         | Backend                                          |
| --------------------------- | --------------------------------- | ------------------------------------------------ |
| `did:x509` import           | Ed25519, P-256, P-384, P-521, RSA | OpenBao when enabled                             |
| X.509 create/import         | Ed25519, P-256, P-384, P-521, RSA | OpenBao when enabled                             |
| `did:key` (opt-in)          | Ed25519                           | OpenBao only with `OPENBAO_DID_KEY_ENABLED=true` |
| `did:web` (opt-in)          | Ed25519                           | OpenBao only with `OPENBAO_DID_WEB_ENABLED=true` |
| OID4VC, status lists        | whatever the issuing DID uses     | Routed by the DID's existing key binding         |
| Indy DIDs, DIDComm, routing | Ed25519 / X25519                  | Always Askar                                     |
| secp256k1                   | secp256k1                         | Always Askar                                     |

OpenBao key ids are namespaced with `ob_` so a key imported into both stores can never be resolved by Askar first. Use
the `keyId` returned by agent-controller, never a JWK thumbprint you computed yourself.

## Configuration

OpenBao is disabled by default. Enable it with environment variables or the equivalent `--openbao-*` CLI options:

```sh
OPENBAO_ENABLED=true
OPENBAO_WRITE_ENABLED=true
OPENBAO_ADDRESS=https://openbao.internal:8200
OPENBAO_ROLE_ID=...
OPENBAO_SECRET_ID_FILE=/run/secrets/openbao-secret-id
OPENBAO_AUTH_MOUNT=approle
OPENBAO_TRANSIT_MOUNT=transit
OPENBAO_HEALTH_CHECK=true
OPENBAO_DID_KEY_ENABLED=false
OPENBAO_DID_WEB_ENABLED=false
```

`OPENBAO_TOKEN` is supported for local development only; deployments should use AppRole with a short-lived secret ID.
The agent fails startup when `OPENBAO_ENABLED=true` and the cluster is sealed, uninitialised, or unreachable.

## Rollback

`OPENBAO_ENABLED` registers the backend. `OPENBAO_WRITE_ENABLED` controls whether new keys may be created, imported, or
deleted. To roll back:

1. Set `OPENBAO_WRITE_ENABLED=false` and restart. Existing `ob_` keys stay readable and signing keeps working.
2. Do not unregister the backend while OpenBao-backed keys exist; their DIDs would stop signing.
3. Delete a tenant only through the API, so its OpenBao scope is purged before the tenant record is removed.

Tenant isolation uses the key scope `<deployment id>:tenant-<tenantId>`. The deployment id defaults to the wallet id and
can be set with `OPENBAO_DEPLOYMENT_ID`.
