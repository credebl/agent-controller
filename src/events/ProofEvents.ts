import type { RestMultiTenantAgentModules } from '../cliAgent'
import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'
import type { DidCommProofStateChangedEvent } from '@credo-ts/didcomm'

import { DidCommProofEventTypes } from '@credo-ts/didcomm'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const proofEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(DidCommProofEventTypes.ProofStateChanged, async (event: DidCommProofStateChangedEvent) => {
    const record = event.payload.proofRecord
    const body = { ...record.toJSON(), ...event.metadata } as { proofData?: any }
    if (event.metadata.contextCorrelationId && event.metadata.contextCorrelationId !== 'default') {
      body.proofData = await (agent as Agent<RestMultiTenantAgentModules>).modules.tenants.withTenantAgent(
        { tenantId: event.metadata.contextCorrelationId.split('tenant-')[1] },
        (tenantAgent) => tenantAgent.modules.didcomm.proofs.getFormatData(record.id),
      )
    }

    //Emit webhook for dedicated agent
    if (event.metadata.contextCorrelationId === 'default') {
      const data = await agent.modules.didcomm.proofs.getFormatData(record.id)
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
