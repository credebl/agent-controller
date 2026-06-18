<p align="center">
  <br />
  <img
    alt="Credo logo"
    src="https://raw.githubusercontent.com/openwallet-foundation/credo-ts/main/images/credo-logo.png"
    height="250px"
  />
</p>

# Credo Controller REST API

<p align="center">
  <a
    href="https://raw.githubusercontent.com/hyperledger/aries-framework-javascript-ext/main/LICENSE"
    ><img
      alt="License"
      src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"
  /></a>
  <a href="https://www.typescriptlang.org/"
    ><img
      alt="typescript"
      src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg"
  /></a>
  <a href="https://github.com/credebl/credo-controller"
    ><img
      alt="GitHub"
      src="https://img.shields.io/github/stars/credebl/credo-controller?style=social"
  /></a>
</p>
<br />

The Credo Controller REST API is the most convenient way for self-sovereign identity (SSI) developers to interact with SSI agents.

- ⭐ **Endpoints** to create connections, issue credentials, and request proofs.
- 💻 **CLI** that makes it super easy to start an instance of the REST API.
- 🌐 **Interoperable** with all major Aries implementations.

## Quick Start

The REST API provides an OpenAPI schema that can easily be viewed using the SwaggerUI that is provided with the server. The docs can be viewed on the `/docs` endpoint (e.g. http://localhost:3000/docs).

> The OpenAPI spec is generated from the model classes used by Credo-TS. Due to limitations in the inspection of these classes, the generated schema does not always exactly match the expected format. Keep this in mind when using this package. If you encounter any issues, feel free to open an issue.

### Using the CLI

Using the CLI is the easiest way to get started with the REST API.

> **Note**: The preferred operating system for development and deployment is **Ubuntu LTS (20.04 or later)**.

### Clone the Repository

```sh
git clone https://github.com/credebl/credo-controller.git
cd credo-controller
```

## Getting Started

### Method 1: Local Development (Recommended for Development)

<details>
<summary><strong>Local Development Setup</strong></summary>

#### Prerequisites
- Node.js version **18.19.0** (tested and recommended)
- Yarn package manager

> **Note**: This project requires Node.js 18.19.0. It has been tested and may not work properly with newer versions like Node.js 24.x.

> **Compatibility**: While Node.js 18.19.0 is recommended, the project should also work with Node.js versions >20 (major versions). However, thorough testing is recommended when using newer Node.js versions.

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
   docker build -t credo-controller:local .
   ```

2. **Run the container:**
   ```sh
   docker run --network host \
     -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
     credo-controller:local --config /app/cliConfig.json
   ```

This method gives you full control over the Docker build process and allows you to customize the image as needed.

> **OS Compatibility**: This containerized method has been tested and works on **WSL**, **Ubuntu**, and **Fedora**. It should work on any system with Docker support.

</details>

### Method 3: Using Prebuilt Docker Image with PostgreSQL

<details>
<summary><strong>PostgreSQL + Prebuilt Image Setup</strong></summary>

This method uses the official prebuilt Docker image with a PostgreSQL database setup.

#### Prerequisites

First, you need to add these required parameters to `samples/cliConfig.json`:

```json
{
  // ...existing configuration...
  "walletConnectTimeout": 30,
  "walletMaxConnections": 90,
  "walletIdleTimeout": 30
  // ...rest of configuration...
}
```

> **Note**: These parameters are required to avoid wallet connection errors when using PostgreSQL.

#### Steps

1. **Start PostgreSQL database:**
   ```sh
   docker run --name credo-postgres -d \
     -e POSTGRES_DB=postgres \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -p 5432:5432 \
     postgres:13
   ```

2. **Run the Credo Controller:**
   ```sh
   docker run --network host \
     -v "$(pwd)/samples/cliConfig.json:/app/cliConfig.json" \
     ghcr.io/credebl/credo-controller:latest \
     --config /app/cliConfig.json
   ```

This method uses the official prebuilt image and connects to your local PostgreSQL instance.

> **OS Compatibility**: This containerized method has been tested and works on **WSL**, **Ubuntu**, and **Fedora**. It should work on any system with Docker support.

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

</details>

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
      // ... Credo Config ... //
    },
    agentDependencies,
  )
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
