# Agent Controller v2.3.0

Release date: 2026-10-30 · Previous stable release: v2.2.0

## Highlights

- **W3C JSON-LD credentials end to end**: issuance, presentation, signing and verification, including `ldp_vc` over OpenID4VC and DCQL-based verification of JSON-LD credentials.
- **Holder credential lists**: search, filtering and pagination on the SD-JWT, mdoc and W3C list endpoints, and optional tags when requesting a credential.
- **X.509 improvements**: certificate chain support, and mdoc date encoding fixed.
- **Security hardening**: the `undici` runtime dependency is moved from 6.24.0 to 6.29.1, clearing all open undici advisories, plus CI and Docker hardening.

## New features

| Area   | Change                                                                                     |
| ------ | ------------------------------------------------------------------------------------------ |
| W3C    | JSON-LD credential issuance and presentation; sign/verify logic (including Polygon module) |
| OID4VC | `ldp_vc` support for W3C JSON-LD credentials                                               |
| DCQL   | Verification of JSON-LD credentials via DCQL queries                                       |
| X.509  | Certificate chains supported; mdoc date encoding fixed                                     |

## Bug fixes

- `vc+sd-jwt` issuance now routes `SdJwtVc` through the sd-jwt signing path (#454).
- DCQL `ldp_vc` query filtering and JSON-LD serialization errors resolved.
- Tenant sessions are released after proof events (a session leak in multi-tenant mode); a test covers proof delivery recovering after a read failure.
- Data type issues in `handleMsoMdocFormat` fixed.
- W3C VC 2.0 detection improved, and empty `x5c` no longer crashes.

## Security

Resolved from GitHub Dependabot alerts:

- `undici` 6.24.0 → 6.29.1 (runtime; 9 advisories: WebSocket DoS, CRLF/header injection, cookie handling, retry interceptor desync)
- Note: these pins are Yarn `resolutions`, which only apply when this repository is the install root (Docker image, source builds). Projects that install the controller as a dependency should add their own override, e.g. `"resolutions": { "undici": "^6.29.1" }`, because `@digitalcredentials/http-client` still accepts `undici@^6.6.2`.
- `flatted` → 3.4.2, `ts-deepmerge` → 8.0.0, `ngrok`'s `uuid` → 11.1.1 (via `resolutions`)

Resolved from code scanning:

- CI workflow now has least-privilege `permissions: contents: read` and installs with `--frozen-lockfile --ignore-scripts` and applies patches explicitly.
- Dockerfile pins `yarn` and `patch-package` versions.

Not changed (see "Known issues").

## Other changes

- Node base image 22 → 26.8.1; patch files renamed for Windows compatibility (#422); mediator message-forwarding message type; Dependabot configured; README and wallet connection-pool docs revised; routine dependency bumps.
- CI now runs `yarn test` on pull requests and pushes.
- Jest configuration repaired (removed the invalid `name` option and moved the ts-jest `isolatedModules` setting to `transform`), so `yarn test` runs again.
- Version in `package.json` and the generated `swagger.json` corrected to 2.3.0.

## Renaming: Credo Controller → Agent Controller

The project is now named `agent-controller` in `package.json`, the OpenAPI spec title, `compass.yml`, issue templates, CI and the Jest display name. Deployment-facing names are **unchanged** in this release to avoid breaking existing setups:

- Docker image: `ghcr.io/credebl/credo-controller`
- ECS/Fargate task definition container names
- OpenTelemetry service and logger names

These will be migrated in a later release, with a deprecation period for the image name.

## Upgrade notes

- **Holder list response shape:** the three holder list endpoints still return a plain array when called with no query parameters. If any parameter is sent (including only `q`), the response becomes an envelope: `{ data, pagination: { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage }, filters? }`. Invalid `page`/`pageSize` return 400.

- Run `yarn install` to pick up new `resolutions`; `ts-deepmerge` jumps a major version (a transitive dependency of the tsoa CLI, build-time only).
- Docker users: the image now builds on Node 26. Rebuild images rather than reusing cached layers.
- No API or configuration breaking changes were identified in the commit history.

## Verification

`yarn check-types`, `yarn lint` (0 errors, 158 existing warnings), `yarn check-format`, `yarn compile` and `yarn test` (1 suite, 4 tests) pass.

## Known issues / follow-ups

- Remaining Dependabot alerts have no upstream patch: `braces` (advisory withdrawn), `elliptic` (low), and dev-only `extract-zip` and `ngrok`.
- Package install scripts still run in the Docker build (Sonar S6505); `postinstall` runs `patch-package`, which the build relies on, so this was not changed.
