import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent,  } from '@credo-ts/core'
import { ProofStateChangedEvent, ProofEventTypes } from '@credo-ts/didcomm'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const proofEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(ProofEventTypes.ProofStateChanged, async (event: ProofStateChangedEvent) => {
    const record = event.payload.proofRecord
    const body = { ...record.toJSON(), ...event.metadata } as { proofData?: any }
    if (event.metadata.contextCorrelationId !== 'default') {
      const tenantAgent = await agent.modules.tenants.getTenantAgent({
        tenantId: event.metadata.contextCorrelationId,
      })
      const data = await tenantAgent.proofs.getFormatData(record.id)
      body.proofData = data
    }

    //Emit webhook for dedicated agent
    if (event.metadata.contextCorrelationId === 'default') {
      const data = await agent.modules.proofs.getFormatData(record.id)
      body.proofData = data
    }

    // Only send webhook if webhook url is configured
    if (config.webhookUrl) {
      await sendWebhookEvent(config.webhookUrl + '/proofs', body, agent.config.logger)
    }

    if (config.socketServer) {
      // Always emit websocket event to clients (could be 0)
      sendWebSocketEvent(config.socketServer, {
        ...event,
        payload: {
          ...event.payload,
          proofRecord: body,
        },
      })
    }
  })
}
