# Stage 1: Builder stage
FROM node:18 AS builder

WORKDIR /app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./

# Copy the rest of the application code
COPY . .

# Install dependencies
RUN rm -rf node_modules
RUN yarn install --frozen-lockfile --network-timeout 600000

RUN yarn global add patch-package

# Build the application
RUN yarn build

# Stage 2: Production stage
FROM node:18-slim

WORKDIR /app

# Apply OS-level security patches and patch npm-bundled vulnerable packages
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* && \
    cd /tmp && npm install tar@7.5.11 cross-spawn@7.0.6 glob@10.5.0 minimatch@9.0.7 2>/dev/null && \
    NPM_MODS=/usr/local/lib/node_modules/npm/node_modules && \
    cp -r node_modules/tar $NPM_MODS/ && \
    cp -r node_modules/cross-spawn $NPM_MODS/ && \
    cp -r node_modules/glob $NPM_MODS/ && \
    cp -r node_modules/minimatch $NPM_MODS/ && \
    rm -rf /tmp/node_modules /tmp/package*.json

# Copy built files and node_modules from the builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/patches ./patches

# Remove build-time-only packages that contain vulnerabilities and aren't needed at runtime:
# - ngrok: devDependency with vulnerable Go binary
# - tar: only used by node-pre-gyp during native module installation (already done at build time)
# Patch glob inside @tsoa/cli to fix CVE-2025-64756
RUN rm -rf /app/node_modules/ngrok \
           /app/node_modules/tar && \
    cd /tmp && npm install glob@10.5.0 2>/dev/null && \
    cp -r node_modules/glob /app/node_modules/@tsoa/cli/node_modules/ && \
    rm -rf /tmp/node_modules /tmp/package*.json && \
    chown -R node:node /app

# Run as non-root user for security
USER node

# Set entry point
ENTRYPOINT ["node", "./bin/afj-rest.js", "start"]
