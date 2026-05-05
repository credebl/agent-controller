// -1 means retry forever — the agent should not stop trying to reconnect.
export const NATS_MAX_RECONNECT_ATTEMPTS = -1

// How long (ms) to wait between reconnect attempts.
export const NATS_RECONNECT_TIME_WAIT_MS = 2000

// JetStream API error codes returned when a stream or consumer already exists.
export const NATS_ERR_STREAM_ALREADY_EXISTS = 10058
export const NATS_ERR_CONSUMER_ALREADY_EXISTS = 10148
