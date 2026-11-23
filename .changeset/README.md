# Changesets

This folder holds pending release notes. Each pull request that changes the
agent controller adds a small markdown file here; when a release is prepared,
the files are turned into the version bump and the `CHANGELOG.md` entry.

The repository is a single package, `agent-controller`, and its version is the
number in the `vX.Y.Z` release tags. It is released as a Docker image, not as
an npm package, so `access` is `restricted` and nothing is ever published to npm.

Add a changeset with:

```bash
yarn changeset
```

Use `yarn changeset --empty` when a change needs no release note. See the
"Release notes and versioning" section of the [README](../README.md) for what
patch, minor and major mean here and how a release is cut.

More about Changesets: <https://github.com/changesets/changesets>
