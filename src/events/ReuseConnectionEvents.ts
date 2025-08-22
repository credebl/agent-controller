import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'

import { OutOfBandEventTypes, HandshakeReusedEvent } from '@credo-ts/didcomm'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const reuseConnectionEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(OutOfBandEventTypes.HandshakeReused, async (event: HandshakeReusedEvent) => {
    const body = {
      ...event.payload.connectionRecord.toJSON(),
      outOfBandRecord: event.payload.outOfBandRecord.toJSON(),
      reuseThreadId: event.payload.reuseThreadId,
      ...event.metadata,
    }

    // Only send webhook if webhook url is configured
    if (config.webhookUrl) {
      await sendWebhookEvent(config.webhookUrl + '/connections', body, agent.config.logger)
    }

    if (config.socketServer) {
      // Always emit websocket event to clients (could be 0)
      sendWebSocketEvent(config.socketServer, {
        ...event,
        payload: {
          ...event.payload,
          connectionRecord: body,
        },
      })
    }
  })
}
