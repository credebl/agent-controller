# Stage 1: Builder - full dependencies, compiles TypeScript and generates tsoa routes
FROM node:26.8.1 AS builder

WORKDIR /app

# Install yarn (not bundled with node:26)
RUN npm install -g --ignore-scripts yarn@1.22.22

# Install dependencies first so this layer is cached until the manifests change.
# Lifecycle scripts are skipped; the patches are applied explicitly (the build needs them).
COPY package.json yarn.lock ./
COPY patches ./patches
RUN yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000 && \
    yarn patch-package

# Build the application
COPY . .
RUN yarn build

# Stage 2: Production dependencies only (devDependencies such as jest, eslint, typescript are left out)
FROM node:26.8.1 AS deps

ARG TARGETARCH

WORKDIR /app

RUN npm install -g --ignore-scripts yarn@1.22.22

COPY package.json yarn.lock ./
COPY patches ./patches
# Lifecycle scripts are skipped for every package. The only ones the runtime needs are the
# install scripts that download the native askar, indy-vdr and anoncreds libraries, so those
# three are run explicitly.
RUN yarn install --production --frozen-lockfile --ignore-scripts --network-timeout 600000 && \
    yarn patch-package && \
    for pkg in @openwallet-foundation/askar-nodejs @hyperledger/indy-vdr-nodejs @hyperledger/anoncreds-nodejs; do \
      (cd "node_modules/${pkg}" && node scripts/install.js) || exit 1; \
    done && \
    yarn cache clean

# koffi ships prebuilt binaries for every platform; keep only the one for this image.
# Source maps are only useful for debugging and are not needed at runtime.
RUN case "${TARGETARCH}" in \
      amd64) KOFFI_ARCH=x64 ;; \
      arm64) KOFFI_ARCH=arm64 ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    find node_modules/koffi/build/koffi -mindepth 1 -maxdepth 1 ! -name "linux_${KOFFI_ARCH}" -exec rm -rf {} + && \
    find node_modules -type f -name "*.map" -delete

# Stage 3: Production stage
FROM node:26.8.1-slim

# Update system packages and install security updates, then create the non-root user.
# /app is created owned by appuser (non-recursive, so it adds no file copies).
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    groupadd -r appuser && useradd -r -g appuser appuser && \
    mkdir -p /app && chown appuser:appuser /app

WORKDIR /app

# Copy with the right owner up front; a recursive chown/chmod afterwards would
# duplicate every file into a new layer and roughly double the image size.
COPY --from=builder --chown=appuser:appuser /app/build ./build
COPY --from=builder --chown=appuser:appuser /app/bin ./bin
COPY --from=builder --chown=appuser:appuser /app/package.json ./
COPY --from=deps --chown=appuser:appuser /app/node_modules ./node_modules

USER appuser

# Set entry point
ENTRYPOINT ["node", "./bin/afj-rest.js", "start"]
