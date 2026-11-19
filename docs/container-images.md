# Container images

The Agent Controller is published as a container image for **AMD64** and **ARM64**.

## Where to pull from

The images are published to GitHub Container Registry only:

```
ghcr.io/credebl/credo-controller
```

> The image keeps the legacy name `credo-controller`.

## Tags

For every release tag, for example `v2.4.0`, these tags are published:

| Tag            | What it is                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `v2.4.0`       | Multi-arch manifest (AMD64 + ARM64)                                                                      |
| `2.4.0`        | Same as above, without the `v`                                                                           |
| `latest`       | Multi-arch manifest of the highest stable release (pre-release tags such as `v2.4.0-rc1` do not move it) |
| `v2.4.0-amd64` | AMD64 image only                                                                                         |
| `v2.4.0-arm64` | ARM64 image only                                                                                         |

Both architectures are built from the same commit in the same workflow run.

## How to choose

- Use the multi-arch tag (`v2.4.0` or `latest`) in most cases. Docker, Kubernetes and ECS pick the right architecture for the host.
- Pin a release tag (or digest) in production instead of `latest`.
- Use the `-amd64` or `-arm64` tag only if you need to force one architecture. For example, to run the same architecture in all environments.
- Check what a tag contains with:

  ```sh
  docker buildx imagetools inspect ghcr.io/credebl/credo-controller:latest
  ```

## How the images are built

The workflow is [`continuous-delivery.yml`](../.github/workflows/continuous-delivery.yml). On a `v*` tag push:

1. AMD64 and ARM64 images are built on native runners (no QEMU emulation).
2. Each image is smoke tested: the container starts and the native Askar library (`@openwallet-foundation/askar-nodejs`) is loaded.
3. Per-architecture tags are pushed, and then the multi-arch manifest is created from them.

## PostgreSQL with TLS (for example AWS RDS)

The agent does not set any TLS options itself. The wallet connection is opened by the native Askar library, so TLS behaviour comes from Askar.

Tests done with Askar `0.6.1` (the version in the lock file) and `0.7.1`, against PostgreSQL 16 with TLS enabled and a private CA:

| Server certificate                | `linux/arm64` (native)                   | `linux/amd64` (emulated) |
| --------------------------------- | ---------------------------------------- | ------------------------ |
| RSA 2048, signed by private CA    | `invalid peer certificate: BadSignature` | connects                 |
| ECDSA P-256, signed by private CA | connects                                 | connects                 |

What this means:

- On ARM64 the connection failed with `BadSignature` for an RSA server certificate, even with `sslmode=require`, which should not verify the CA. The same RSA setup works on AMD64. An ECDSA certificate works on both. So a missing or wrong CA bundle is unlikely to be the cause. A possible cause is the signature checking in Askar's native TLS code on ARM64 for RSA certificates, but this is a hypothesis: the tests do not prove it and other causes are not ruled out.
- AWS RDS uses RSA certificates, which matches the failure seen on ARM64 Fargate.
- The failure is the same with Askar 0.6.0, 0.6.1 and 0.7.1, so upgrading Askar did not help in our tests. Older versions (0.4.x) could not be compared with our test script.
- This was reproduced on one machine only (Apple Silicon, native ARM64 vs emulated AMD64). It should be confirmed on real AMD64 hardware and reported upstream to Askar.

Other things to know:

- With `sslmode=verify-ca` / `verify-full` and a CA that Askar does not trust, you get `UnknownIssuer`. That one is a CA setup issue.
- Askar joins multiple query parameters in the wallet URL wrongly (`?sslmode=verify-full&sslrootcert=...` becomes an invalid `ssl_mode` value). Only one query parameter works.

Workarounds until this is fixed upstream:

- Run the AMD64 image (`-amd64` tag) on the AMD64 hosts, if that is possible for you.
- Use a Postgres server certificate with an ECDSA key, if you control the certificate (not possible on RDS).
- Do not disable TLS in production just to get around this.
