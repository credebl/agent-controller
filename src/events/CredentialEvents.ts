import type { RestMultiTenantAgentModules } from '../cliAgent'
import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent, CredentialStateChangedEvent } from '@credo-ts/core'

import { CredentialEventTypes } from '@credo-ts/core'

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
      let connectionRecord
      if (event.metadata.contextCorrelationId && event.metadata.contextCorrelationId !== 'default') {
        await (agent as Agent<RestMultiTenantAgentModules>).modules.tenants.withTenantAgent(
          { tenantId: body.contextCorrelationId as string },
          async (tenantAgent) => {
            connectionRecord = await tenantAgent.connections.findById(record.connectionId ? record.connectionId : '')
          },
        )
      } else {
        connectionRecord = await agent.connections.getById(record.connectionId)
      }
      body.outOfBandId = connectionRecord?.outOfBandId
    }

    let formatData = null
    if (event.metadata.contextCorrelationId && event.metadata.contextCorrelationId !== 'default') {
      await (agent as Agent<RestMultiTenantAgentModules>).modules.tenants.withTenantAgent(
        { tenantId: body.contextCorrelationId as string },
        async (tenantAgent) => {
          formatData = await tenantAgent.credentials.getFormatData(record.id)
        },
      )
    } else {
      formatData = await agent.credentials.getFormatData(record.id)
    }

    body.credentialData = formatData

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
