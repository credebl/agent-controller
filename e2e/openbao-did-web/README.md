# did:web + OpenBao live integration tests

These tests exercise the encrypted key-import flow end to end against a **real** agent-controller and a **real**
OpenBao Transit backend. Nothing is mocked: keys are created in OpenBao, the DID document is checked against the
Transit public key, and signatures are produced by the agent through OpenBao.

They are local-only by design:

- `jest.config.base.ts` adds `e2e/` to `testPathIgnorePatterns`, so the default `yarn test` (and therefore CI) never
  discovers them.
- The suite also skips itself unless `OPENBAO_INTEGRATION=1` is set. The `yarn test:integration` script sets it.

## Prerequisites

- Node 20+ and Yarn, Docker, and a Postgres reachable at `localhost:5432` (`postgres` / `postgres`).
- No other agent listening on the ports below.
- Run `yarn build` after changing `src/`, because the agents start from `build/`.

## Start the stack

```bash
# 1. Fresh OpenBao with Transit (in-memory dev server; safe to throw away)
docker run -d --rm --name openbao-did-web-integration \
  -p 8201:8200 openbao/openbao:2.7.2 \
  server -dev -dev-root-token-id=root-dev-token
docker exec -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN=root-dev-token \
  openbao-did-web-integration bao secrets enable transit

# 2. Build the agent and export the OpenBao/API-key environment
yarn build
set -a; . e2e/openbao-did-web/fixtures/agent.env.example; set +a

# 3. Start the dedicated agent (admin :4101, DIDComm :4102)
./bin/afj-rest.js --config e2e/openbao-did-web/fixtures/cliConfig.dedicated.json &

# 4. Start the multi-tenant agent (admin :4201, DIDComm :4202)
./bin/afj-rest.js --config e2e/openbao-did-web/fixtures/cliConfig.tenant.json &
```

Wait until `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4101/docs` and `http://127.0.0.1:4201/docs`
return a status (a `301` is expected), then run:

```bash
yarn test:integration
```

Tear down with `kill %1 %2` and `docker rm -f openbao-did-web-integration`.

## Configuration

The suite reads these variables (defaults match the fixtures above):

| Variable                            | Default                        | Purpose                                     |
| ----------------------------------- | ------------------------------ | ------------------------------------------- |
| `OPENBAO_INTEGRATION`               | unset                          | Must be `1`; set by `yarn test:integration` |
| `OPENBAO_INTEGRATION_DEDICATED_URL` | `http://127.0.0.1:4101`        | Dedicated-mode agent admin URL              |
| `OPENBAO_INTEGRATION_TENANT_URL`    | `http://127.0.0.1:4201`        | Multi-tenant agent admin URL                |
| `OPENBAO_INTEGRATION_OPENBAO_URL`   | `http://127.0.0.1:8201`        | OpenBao address                             |
| `OPENBAO_INTEGRATION_OPENBAO_TOKEN` | `root-dev-token`               | OpenBao token used to inspect Transit       |
| `OPENBAO_INTEGRATION_API_KEY`       | `local-integration-api-key-16` | Agent API key used to get a JWT             |

Both agents must run with `OPENBAO_DID_WEB_ENABLED=true`. The `did:key` check additionally needs
`OPENBAO_DID_KEY_ENABLED=true` (both are set in `fixtures/agent.env.example`). The fixture also raises
`KEY_IMPORT_RATE_LIMIT` to `200`, because the suite requests many single-use import sessions and repeated local runs can
exhaust the default limit of 30 per minute.

## What is covered

`didWeb.dedicated.integration.test.ts` (dedicated agent):

- `POST /dids/write` with an encrypted envelope creates `did:web` and exactly one OpenBao Transit key.
- The published `publicKeyBase58` equals the OpenBao key bytes, and the key is `ed25519`.
- The DID is stored and resolvable through `/dids/:did/resolve`.
- Signing uses the OpenBao key; the signature verifies locally and through `/agent/verify`.
- Re-importing the same key keeps the DID and does not duplicate the Transit key.
- Path, port and `~` domains are encoded correctly.
- Invalid or missing domains are rejected before the single-use session is consumed, and the same envelope then works
  for a valid domain.
- A consumed envelope cannot be replayed.
- `POST /dids/web/import` stores an authority's document verbatim, binds a key to its custom verification method and
  signs through OpenBao; re-importing the same document and key is idempotent.
- A relative verification method id is accepted and reported as an absolute id.
- Several keys are imported in one request while a public-only `keyAgreement` method stays in the document.
- An unknown verification method id, a mismatched private key, a mismatched document id and an invalid DID are rejected
  before their sessions are consumed, and the same envelope then succeeds after correction.
- Rebinding an existing DID needs `replace:true`; the rejected request leaves its session usable.
- Two key entries cannot share one import session, and neither key is imported when the request is rejected.
- Plaintext key material is refused while the migration flag is disabled.
- A supplied document that cannot be resolved is refused without `allowUnresolvedDocument`, and the same envelope then
  works with the flag.
- `did:key` opt-in also creates its key in OpenBao.

`didWeb.tenant.integration.test.ts` (multi-tenant agent):

- Tenant A creates a `did:web` with one tenant-scoped Transit key matching the published key.
- Tenant A signs through its OpenBao key.
- Tenant B cannot sign with tenant A's DID or key.
- The same key material imported by both tenants maps to two Transit keys in different scopes with the same public
  key. Tenants are deleted afterwards, which also purges their OpenBao scopes.
- Tenant A imports an authority's `did:web` document and signs through the tenant-scoped OpenBao key.
- Tenant B cannot sign with tenant A's imported authority DID, and importing the same authority key material in tenant
  B creates a separate scoped Transit key that still verifies against the authority's published key.
