<p align="center">
  <br />
  <img
    alt="CREDEBL logo"
    src="https://raw.githubusercontent.com/credebl/.github/main/logo.svg"
    height="150px"
  />
</p>

# Agent Controller REST API

<p align="center">
  <a
    href="https://raw.githubusercontent.com/credebl/agent-controller/main/LICENSE"
    ><img
      alt="License"
      src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"
  /></a>
  <a href="https://www.typescriptlang.org/"
    ><img
      alt="typescript"
      src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg"
  /></a>
  <a href="https://github.com/credebl/agent-controller"
    ><img
      alt="GitHub"
      src="https://img.shields.io/github/stars/credebl/agent-controller?style=social"
  /></a>
</p>
<br />

The Agent Controller REST API is the most convenient way for self-sovereign identity (SSI) developers to interact with SSI agents.

- ⭐ **Endpoints** to create connections, issue credentials, and request proofs.
- 💻 **CLI** that makes it super easy to start an instance of the REST API.
- 🌐 **Interoperable** with all major Aries implementations.

## Quick Start

The REST API provides an OpenAPI schema that can easily be viewed using the SwaggerUI that is provided with the server. The docs can be viewed on the `/docs` endpoint (e.g. http://localhost:4001/docs, where `4001` is the admin port configured in `samples/cliConfig.json`).

> The OpenAPI spec is generated from the model classes used by Credo-TS. Due to limitations in the inspection of these classes, the generated schema does not always exactly match the expected format. Keep this in mind when using this package. If you encounter any issues, feel free to open an issue.

### Using the CLI

Using the CLI is the easiest way to get started with the REST API.

> **Note**: The preferred operating system for development and deployment is **Ubuntu LTS (20.04 or later)**.

### Clone the Repository

```sh
git clone https://github.com/credebl/agent-controller.git
cd agent-controller
```

## Getting Started

### Method 1: Local Development (Recommended for Development)

<details>
<summary><strong>Local Development Setup</strong></summary>

#### Prerequisites

- Node.js version **20 (LTS)** (tested and recommended)
- Yarn package manager

> **Note**: Node.js 20 (LTS) is used in CI and is the recommended version. The Docker image builds and runs on Node.js 22, so newer LTS versions should also work, but thorough testing is recommended before using them.

#### Steps

1. **Install dependencies:**

   ```sh
   yarn install
   ```

2. **Build the project:**

   ```sh
   yarn build
   ```

3. **Start development server:**
   ```sh
   yarn dev
   ```

The application will start in development mode with hot reloading enabled.

</details>

### Method 2: Build and Run Local Docker Image

<details>
<summary><strong>Docker Build Instructions</strong></summary>

If you want to build your own Docker image locally and run it:

#### Steps

1. **Build the Docker image:**

   ```sh
   docker build -t agent-controller:local .
   ```

2. **Run the container:**
   ```sh
   docker run --network host \
     -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
     agent-controller:local --config /app/cliConfig.json
   ```

This method gives you full control over the Docker build process and allows you to customize the image as needed.

> **OS Compatibility**: This containerized method has been tested and works on **WSL**, **Ubuntu**, and **Fedora**.
>
> `--network host` is Linux-only. On **macOS / Windows (Docker Desktop)** use port mapping instead:
>
> ```sh
> docker run -p 4001:4001 -p 4002:4002 \
>   -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
>   agent-controller:local --config /app/cliConfig.json
> ```
>
> When using port mapping, set `walletUrl` to `host.docker.internal:5432` in the config so the container can reach a PostgreSQL instance running on your host.

</details>

### Method 3: Using Prebuilt Docker Image with PostgreSQL

<details>
<summary><strong>PostgreSQL + Prebuilt Image Setup</strong></summary>

This method uses the official prebuilt Docker image with a PostgreSQL database setup.

#### Prerequisites

The `samples/cliConfig.json` file must reference a PostgreSQL wallet (it already uses `walletType: "postgres"`). Optionally, you can tune the connection pool by adding these settings:

```json
{
  "walletConnectTimeout": 30,
  "walletMaxConnections": 90,
  "walletIdleTimeout": 30
}
```

> **Note**: These settings are optional connection-pool tunables for the PostgreSQL wallet. They map to the `wallet-connect-timeout`, `wallet-max-connections`, and `wallet-idle-timeout` CLI options, the `AFJ_REST_WALLET_CONNECT_TIMEOUT`, `AFJ_REST_WALLET_MAX_CONNECTIONS`, and `AFJ_REST_WALLET_IDLE_TIMEOUT` environment variables, or the `CONNECT_TIMEOUT`, `MAX_CONNECTIONS`, and `IDLE_TIMEOUT` environment-variable fallbacks. They are not required for the agent to start.

#### Steps

1. **Start PostgreSQL database:**

   ```sh
   docker run --name agent-controller-postgres -d \
     -e POSTGRES_DB=postgres \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -p 5432:5432 \
     postgres:16
   ```

2. **Run the Agent Controller:**
   ```sh
   docker run --network host \
     -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
     ghcr.io/credebl/credo-controller:latest \
     --config /app/cliConfig.json
   ```

This method uses the official prebuilt image and connects to your local PostgreSQL instance.

> **Note**: The Docker image is still published under the legacy name `ghcr.io/credebl/credo-controller`. The prebuilt image and `docker compose` entry points have not yet been renamed to match the new "Agent Controller" project name.
>
> **OS Compatibility**: This containerized method has been tested and works on **WSL**, **Ubuntu**, and **Fedora**.
>
> `--network host` is Linux-only. On **macOS / Windows (Docker Desktop)** use port mapping instead:
>
> ```sh
> docker run -p 4001:4001 -p 4002:4002 \
>   -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
>   ghcr.io/credebl/credo-controller:latest \
>   --config /app/cliConfig.json
> ```
>
> When using port mapping, set `walletUrl` to `host.docker.internal:5432` in the config so the container can reach the PostgreSQL instance running on your host.

#### Alternative: Using .env File

The repository includes an agent environment sample file. For a quick start:

1. **Rename the sample environment file:**

   ```sh
   cp .env.sample .env  # (if available in the repository)
   ```

2. **Run using the binary directly:**
   ```sh
   yarn build
   ./bin/afj-rest.js --config ./samples/cliConfig.json
   ```

> **Note**: `afj-rest.js` is the legacy binary name, kept for backward compatibility. The CLI entrypoint is defined in the `bin` field of `package.json`.

</details>

## Configuration

The agent can be configured in three ways:

1. **CLI options**: Run the CLI with `--help` to print the full list of available options.

   ```sh
   # With Docker
   docker run ghcr.io/credebl/credo-controller:latest --help

   # Directly on computer
   ./bin/afj-rest.js start --help
   ```

2. **JSON config file**: When providing a lot of configuration options, pass a JSON file with `--config`. All properties should use camelCase for the key names. See [samples/cliConfig.json](samples/cliConfig.json) for a complete example.
3. **Environment variables**: All properties are prefixed with `AFJ_REST` and use UPPER_SNAKE_CASE (e.g. `AFJ_REST_WALLET_KEY=my-secret-key ./bin/afj-rest.js start ...`).

### Optional OpenBao KMS backend

OpenBao Transit can be registered as an additional KMS backend while Askar remains the wallet storage and default KMS backend. Add `openBaoKms` to the JSON config:

```json
{
  "openBaoKms": {
    "url": "https://openbao.example.com",
    "transitMount": "transit",
    "keyPrefix": "credebl",
    "appRole": {
      "roleId": "agent-controller",
      "secretId": "provide-through-your-secret-manager",
      "mountPath": "approle"
    }
  }
}
```

The backend identifier is `openbao`. Existing operations continue to use Askar unless a purpose is explicitly routed to OpenBao. To protect keys created for Holder OpenID4VC credential binding proofs, add this alongside `openBaoKms`:

```json
{
  "keyManagement": {
    "holderCredentialBinding": "openbao"
  }
}
```

If `keyManagement` or `holderCredentialBinding` is omitted, Holder credential binding continues to use Askar. Selecting `openbao` without configuring `openBaoKms` fails agent startup instead of silently falling back. Issuer signing, DIDComm keys, and all other key purposes remain unchanged.

Ed25519 and P-256 key creation, public-key lookup, signing, and verification are supported. Private keys are generated inside Transit and are configured as non-exportable. Import, encryption, decryption, and deletion are intentionally not advertised by this backend.

Each Transit key name is scoped to the Credo agent context (the tenant record id in multi-tenant mode). A key id from one tenant is rejected in another tenant context. OpenBao failures are returned to the caller and never fall back to Askar.

AppRole is recommended for deployments. A static `token` can be configured instead for development, but `token` and `appRole` are mutually exclusive. Do not commit either the AppRole secret id or a static token to source control.

## Development

### Starting Your Own Server

Starting your own server is more involved than using the CLI, but allows more fine-grained control over the settings and allows you to extend the REST API with custom endpoints.

You can create an agent instance and import the `startServer` method from the `rest` package. That's all you have to do.

```ts
import { startServer } from '@credo-ts/rest'
import { Agent } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'

// The startServer function requires an initialized agent and a port.
// An example of how to setup an agent is located in the `samples` directory.
const run = async () => {
  const agent = new Agent(
    {
      // ... Agent Config ... //
    },
    agentDependencies,
  )
  await agent.initialize()
  await startServer(agent, { port: 3000 })
}

// A Swagger (OpenAPI) definition is exposed on http://localhost:3000/docs
run()
```

### WebSocket & Webhooks

The REST API provides the option to connect as a client and receive events emitted from your agent using WebSocket and webhooks.

You can hook into the events listener using webhooks, or connect a WebSocket client directly to the default server.

The currently supported events are:

- `Basic messages`
- `Connections`
- `Credentials`
- `Proofs`

When using the CLI, a webhook url can be specified using the `--webhook-url` config option.

When using the REST server as a library, the WebSocket server and webhook url can be configured in the `startServer` and `setupServer` methods.

```ts
// You can either call startServer() or setupServer() and pass the ServerConfig interface with a webhookUrl and/or a WebSocket server

const run = async (agent: Agent) => {
  const config = {
    port: 3000,
    webhookUrl: 'http://test.com',
    socketServer: new Server({ port: 8080 }),
  }
  await startServer(agent, config)
}
run()
```

The `startServer` method will create and start a WebSocket server on the default http port if no socketServer is provided, and will use the provided socketServer if available.

However, the `setupServer` method does not automatically create a socketServer, if one is not provided in the config options.

In case of an event, we will send the event to the webhookUrl with the topic of the event added to the url (http://test.com/{topic}).

So in this case when a connection event is triggered, it will be sent to: http://test.com/connections

The payload of the webhook contains the serialized record related to the topic of the event. For the `connections` topic this will be a `ConnectionRecord`, for the `credentials` topic it will be a `CredentialRecord`, and so on.

For the WebSocket clients, the events are sent as JSON stringified objects
