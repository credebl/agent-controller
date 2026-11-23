# Optional Indy ledger

The Indy ledger is optional. A controller that only uses `did:web`, `did:key`, `did:jwk`, `did:x509`, `did:polygon`,
OID4VC, SD-JWT VC or JSON-LD credentials can start without any Indy configuration and without network access to an Indy
pool.

## When Indy is enabled

| `indyEnabled` / `AFJ_REST_INDY_ENABLED` | `indyLedger`  | `BCOVRIN_TEST_GENESIS` | Result                                                     |
| --------------------------------------- | ------------- | ---------------------- | ---------------------------------------------------------- |
| unset                                   | one or more   | any                    | Indy on, connected to the configured ledgers (as before)   |
| unset                                   | empty/missing | set                    | Indy on, connected to the BCovrin test network (as before) |
| unset                                   | empty/missing | unset or empty         | **Indy off**                                               |
| `false`                                 | any           | any                    | **Indy off**, no genesis file is downloaded                |
| `true`                                  | empty/missing | unset or empty         | Startup fails: "no Indy ledger is configured"              |
| `true`                                  | one or more   | any                    | Same as unset                                              |

With a ledger or `BCOVRIN_TEST_GENESIS` configured, nothing changes compared to earlier releases.

The startup log says which mode the agent runs in:

```
Indy ledger enabled: indicio:testnet, bcovrin:testnet
Indy ledger not configured: running without Indy (no did:indy, no Indy AnonCreds registry)
```

### Why an explicit switch as well

Leaving the ledger out is enough in most deployments. `indyEnabled` covers two cases that implicit detection does not:

- `false`: turn Indy off in a deployment whose image or shared environment still sets `BCOVRIN_TEST_GENESIS` or an
  `indyLedger` list, without editing those.
- `true`: a deployment that needs Indy fails at startup with a clear message when its ledger configuration goes
  missing, instead of starting without Indy and failing later on the first Indy request.

Unset (the default) keeps the automatic behaviour.

## Without Indy

The agent leaves out:

- the Indy VDR module (no pool connection, no genesis download),
- the `did:indy` registrar and resolver,
- the Indy VDR AnonCreds registry.

The AnonCreds module stays registered, because Credo needs it for link secrets, stored AnonCreds credentials and the
DIDComm AnonCreds formats, and it requires at least one registry. A placeholder registry takes the Indy one's place. It
claims the same Indy identifiers and answers every lookup or write with "Indy ledger is not configured", so DIDComm
flows that need an Indy object fail with that message instead of "no registry found".

Requests that need Indy answer **501** with `{"message": "Indy ledger is not configured"}`, before anything is
created or stored:

| Route                                        | Answers 501 when                                   |
| -------------------------------------------- | -------------------------------------------------- |
| `POST /dids/write` with `method: indy`       | the agent has no `did:indy` registrar              |
| `POST /anoncreds/schemas`                    | `issuerId` is an Indy identifier                   |
| `GET /anoncreds/schemas/{schemaId}`          | `schemaId` is an Indy identifier                   |
| `POST /anoncreds/credential-definitions`     | `issuerId` or `schemaId` is an Indy identifier     |
| `GET /anoncreds/credential-definitions/{id}` | the credential definition id is an Indy identifier |

The AnonCreds checks follow the registry Credo would pick for the identifier, so an agent embedded with
`startServer` that registers another AnonCreds registry keeps using it for that registry's identifiers.

Resolving a `did:indy` DID answers 404 with the usual "No did resolver registered for did method indy" message. Polygon schemas
(`/polygon/...`) do not use the AnonCreds registry and keep working.

Multi-tenant agents behave the same: tenants share the root agent's modules.

## Example

```json
{
  "label": "Issuer without Indy",
  "indyLedger": [],
  "...": "..."
}
```

```sh
# No BCOVRIN_TEST_GENESIS in the environment
./bin/afj-rest.js start --config cliConfig.json

# Or switch Indy off explicitly
AFJ_REST_INDY_ENABLED=false ./bin/afj-rest.js start --config cliConfig.json
```

## Tests

- `yarn test` covers the module selection, the placeholder registry and the 501 answers.
- `yarn test:no-indy` builds the controller, starts it with `indyLedger: []`, no `BCOVRIN_TEST_GENESIS` and a
  throw-away SQLite wallet, and checks over HTTP that it issues an admin token, creates a tenant and a `did:web`, and
  answers 501 on the Indy routes.
