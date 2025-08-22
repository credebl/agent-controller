import type { RestMultiTenantAgentModules } from '../cliAgent'
import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'

import { CredentialEventTypes, CredentialStateChangedEvent } from '@credo-ts/didcomm'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const credentialEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(CredentialEventTypes.CredentialStateChanged, async (event: CredentialStateChangedEvent) => {
    const record = event.payload.credentialRecord

    const body: Record<string, unknown> = {
      ...record.toJSON(),
      ...event.metadata,
      outOfBandId: null,
      credentialData: null,
    }

    if (record?.connectionId) {
      const connectionRecord = await agent.modules.connections.findById(record.connectionId!)
      body.outOfBandId = connectionRecord?.outOfBandId
    }

    const data = await agent.modules.credentials.getFormatData(record.id)
    body.credentialData = data

    if (config.webhookUrl) {
      await sendWebhookEvent(config.webhookUrl + '/credentials', body, agent.config.logger)
    }

    if (config.socketServer) {
      // Always emit websocket event to clients (could be 0)
      sendWebSocketEvent(config.socketServer, {
        ...event,
        payload: {
          ...event.payload,
          credentialRecord: body,
        },
      })
    }
  })
}
