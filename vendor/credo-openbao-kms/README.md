# Vendored `@sovio-id/credo-openbao-kms`

This directory is a temporary distribution channel for the OpenBao KMS plugin
until the package is published to npm.

| Field         | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| Package       | `@sovio-id/credo-openbao-kms@0.2.0`                                 |
| Source        | <https://github.com/sovio-id/credo-openbao-kms>                     |
| Source commit | `f74b70983be18f6cccc6f2d31d3fbc03e821f476` (`chore/public-release`) |
| Merged as     | pending                                                             |
| Tarball       | `sovio-id-credo-openbao-kms-0.2.0.tgz`                              |
| SHA-256       | `073b091bad9897518004fdb426a134b994cf1025f5557034046360de1faa072b`  |
| SHA-1         | `b4bc708f7c46681b8e5d46151411ab092ae40eed`                          |

Agent-controller CI runs `yarn install --frozen-lockfile --ignore-scripts`, so
it cannot build a git dependency and cannot fetch an unpublished package. The
tarball therefore contains the compiled `build/` output.

The package was renamed from `@credebl/credo-ts-openbao` to
`@sovio-id/credo-openbao-kms`. The compiled `build/` output is byte-identical to
the previous tarball (`118fa78`); only the package name, repository URLs and
documentation changed. Only rebuild when a file under `src/`, `test/`,
`docs/seal.md`, or the package metadata changes.

## Updating the plugin

1. Check out the new plugin commit and run its CI (`bun run ci`).
2. Build and pack from the plugin checkout:

   ```sh
   cd /path/to/credo-openbao-kms
   npm run build
   npm pack --pack-destination /path/to/agent-controller/vendor/credo-openbao-kms
   ```

3. Update the version, commit, and checksums in this file.
4. Refresh the lockfile:

   ```sh
   cd /path/to/agent-controller
   yarn install --ignore-scripts
   ```

5. Verify a clean install still resolves the vendored package:

   ```sh
   yarn install --frozen-lockfile --ignore-scripts
   node -e "console.log(require('@sovio-id/credo-openbao-kms').openBaoKeyId('test'))"
   ```

## Removing the vendor directory

When `@sovio-id/credo-openbao-kms@0.2.0` (or newer) is published to npm, replace
the `file:` dependency in `package.json` with a normal semver range, run
`yarn install --ignore-scripts` to update `yarn.lock`, and delete this
directory.
