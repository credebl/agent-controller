# Vendored `@credebl/credo-ts-openbao`

This directory is a temporary distribution channel for the OpenBao KMS plugin
until the package is published to npm.

| Field         | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Package       | `@credebl/credo-ts-openbao@0.2.0`                                  |
| Source        | <https://github.com/sovio-id/credo-ts-openbao>                     |
| Source commit | `118fa78c6d83f9d28210ca5b1ad7b6b670e1eca3`                         |
| Merged as     | `d55a67a40ec0097be06b6ad3a120d8dd6c2aeff1` (PR #10)                |
| Tarball       | `credebl-credo-ts-openbao-0.2.0.tgz`                               |
| SHA-256       | `d5c3f4e1a207b7e2bc74b4cc28f157574033ce638ad72489e00e584d4f44f9bd` |
| SHA-1         | `55d247b9ba708ae5b8b4f2f2b6345bc394e16afb`                         |

Agent-controller CI runs `yarn install --frozen-lockfile --ignore-scripts`, so
it cannot build a git dependency and cannot fetch an unpublished package. The
tarball therefore contains the compiled `build/` output.

PR #10 is merged, but the runtime source is identical between `118fa78` and the
merge commit `d55a67a`, so the tarball does not need to be rebuilt. Only rebuild
when a file under `src/`, `test/`, `docs/seal.md`, or the package metadata
changes.

## Updating the plugin

1. Check out the new plugin commit and run its CI (`bun run ci`).
2. Build and pack from the plugin checkout:

   ```sh
   cd /path/to/credo-ts-openbao
   npm run build
   npm pack --pack-destination /path/to/agent-controller/vendor/credo-ts-openbao
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
   node -e "console.log(require('@credebl/credo-ts-openbao').openBaoKeyId('test'))"
   ```

## Removing the vendor directory

When `@credebl/credo-ts-openbao@0.2.0` (or newer) is published to npm, replace
the `file:` dependency in `package.json` with a normal semver range, run
`yarn install --ignore-scripts` to update `yarn.lock`, and delete this
directory.
