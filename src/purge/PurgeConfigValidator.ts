import { connect } from 'nats'

import { buildNatsAuthenticator } from '../utils/NatsAuthenticator'
import type { NatsConfig, PurgeConfig } from './PurgeTypes'

export async function validatePurgeConfig(config: PurgeConfig): Promise<void> {
  const { natsConfig, cronConfig } = config

  if (!natsConfig.enabled && !cronConfig.enabled) {
    throw new Error(
      '[Purge] PURGE_ENABLED=true but neither PURGE_NATS_ENABLED nor PURGE_CRON_ENABLED is set to true. ' +
        'Enable at least one mode.',
    )
  }

  if (natsConfig.enabled) {
    await verifyNatsJetStream(natsConfig.nats)
  }
}

async function verifyNatsJetStream(nats: NatsConfig): Promise<void> {
  let nc: Awaited<ReturnType<typeof connect>> | null = null

  try {
    nc = await connect({
      servers: nats.servers,
      ...buildNatsAuthenticator(nats),
      timeout: 5000,
      maxReconnectAttempts: 0,
    })
  } catch (err: any) {
    throw new Error(
      `[Purge] PURGE_NATS_ENABLED=true but cannot connect to NATS at ${nats.servers.join(', ')}: ${err?.message}`,
    )
  }

  try {
    await nc.jetstreamManager()
  } catch (err: any) {
    throw new Error(
      `[Purge] Connected to NATS but JetStream is not enabled. Start NATS with the -js flag. Error: ${err?.message}`,
    )
  } finally {
    await nc.close()
  }
}
