import { connect } from 'nats'

import type { PurgeConfig } from './PurgeTypes'

export async function validatePurgeConfig(config: PurgeConfig): Promise<void> {
  const { natsConfig, cronConfig } = config

  // At least one mode must be enabled when PURGE_ENABLED=true
  if (!natsConfig.enabled && !cronConfig.enabled) {
    throw new Error(
      '[Purge] PURGE_ENABLED=true but neither PURGE_NATS_ENABLED nor PURGE_CRON_ENABLED is set to true. ' +
        'Enable at least one mode.',
    )
  }

  // If NATS mode is enabled, verify the server is reachable and JetStream is on
  if (natsConfig.enabled) {
    await verifyNatsJetStream(natsConfig.nats.servers, natsConfig.nats.credentialsFile)
  }
}

async function verifyNatsJetStream(servers: string[], credentialsFile?: string): Promise<void> {
  let nc: Awaited<ReturnType<typeof connect>> | null = null

  try {
    nc = await connect({
      servers,
      ...(credentialsFile ? { credentialsFile } : {}),
      timeout: 5000,
      maxReconnectAttempts: 0,
    })
  } catch (err: any) {
    throw new Error(
      `[Purge] PURGE_NATS_ENABLED=true but cannot connect to NATS at ${servers.join(', ')}: ${err?.message}`,
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
