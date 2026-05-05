import type { RestMultiTenantAgentModules } from '../cliAgent'
import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'
import type { DidCommCredentialStateChangedEvent } from '@credo-ts/didcomm'

import { DidCommCredentialEventTypes } from '@credo-ts/didcomm'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const credentialEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(
    DidCommCredentialEventTypes.DidCommCredentialStateChanged,
    async (event: DidCommCredentialStateChangedEvent) => {
      const record = event.payload.credentialExchangeRecord
      const tenantId =
        !event.metadata.contextCorrelationId || event.metadata.contextCorrelationId === 'default'
          ? event.metadata.contextCorrelationId
          : event.metadata.contextCorrelationId.split('tenant-')[1]

      const body: Record<string, unknown> = {
        ...record.toJSON(),
        ...event.metadata,
        contextCorrelationId: tenantId,
        outOfBandId: null,
        credentialData: null,
      }

      if (record?.connectionId) {
        let connectionRecord
        if (tenantId && tenantId !== 'default') {
          await (agent as Agent<RestMultiTenantAgentModules>).modules.tenants.withTenantAgent(
            { tenantId: body.contextCorrelationId as string },
            async (tenantAgent) => {
              connectionRecord = await tenantAgent.modules.didcomm.connections.findById(
                record.connectionId ? record.connectionId : '',
              )
            },
          )
        } else {
          connectionRecord = await agent.modules.didcomm.connections.findById(record.connectionId)
        }
        body.outOfBandId = connectionRecord?.outOfBandId
      }

      let formatData = null
      if (tenantId && tenantId !== 'default') {
        await (agent as Agent<RestMultiTenantAgentModules>).modules.tenants.withTenantAgent(
          { tenantId: body.contextCorrelationId as string },
          async (tenantAgent) => {
            formatData = await tenantAgent.modules.didcomm.credentials.getFormatData(record.id)
          },
        )
      } else {
        formatData = await agent.modules.didcomm.credentials.getFormatData(record.id)
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
    },
  )
}
