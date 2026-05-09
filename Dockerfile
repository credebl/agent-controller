# Stage 1: Builder stage
FROM node:22.22.2 AS builder

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
FROM node:22.22.2-slim

# Update system packages and install security updates
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Copy built files and node_modules from the builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/patches ./patches

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app && \
    chmod -R 755 /app

USER appuser

# Set entry point
ENTRYPOINT ["node", "./bin/afj-rest.js", "start"]
