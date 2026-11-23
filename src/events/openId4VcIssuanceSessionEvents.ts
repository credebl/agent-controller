import type { ServerConfig } from '../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionNotificationReceivedEvent,
  OpenId4VcIssuanceSessionStateChangedEvent,
} from '@credo-ts/openid4vc'

import { OpenId4VcIssuerEvents } from '@credo-ts/openid4vc'

import { sendWebSocketEvent } from './WebSocketEvents'
import { sendWebhookEvent } from './WebhookEvent'

export const openId4VcIssuanceSessionEvents = async (agent: Agent, config: ServerConfig) => {
  agent.events.on(
    OpenId4VcIssuerEvents.IssuanceSessionStateChanged,
    async (event: OpenId4VcIssuanceSessionStateChangedEvent) => {
      const record = event.payload.issuanceSession

      const body = { ...record.toJSON(), ...event.metadata }

      if (config.webhookUrl) {
        await sendWebhookEvent(config.webhookUrl + '/openid4vc-issuance', body, agent.config.logger)
      }

      if (config.socketServer) {
        sendWebSocketEvent(config.socketServer, {
          ...event,
          payload: {
            ...event.payload,
            issuanceRecord: body,
          },
        })
      }
    },
  )

  // A wallet's OID4VCI notification (credential_accepted, credential_deleted, credential_failure) does not
  // change the session state, so it is sent on the same topic as the state changes: the session record,
  // with its `notifications` history, plus the `notification` that was just received.
  agent.events.on(
    OpenId4VcIssuerEvents.IssuanceSessionNotificationReceived,
    async (event: OpenId4VcIssuanceSessionNotificationReceivedEvent) => {
      const { issuanceSession, notification } = event.payload

      const body = {
        ...issuanceSession.toJSON(),
        notification: { ...notification, receivedAt: notification.receivedAt.toISOString() },
        ...event.metadata,
      }

      if (config.webhookUrl) {
        await sendWebhookEvent(config.webhookUrl + '/openid4vc-issuance', body, agent.config.logger)
      }

      if (config.socketServer) {
        sendWebSocketEvent(config.socketServer, {
          ...event,
          payload: {
            ...event.payload,
            issuanceRecord: body,
          },
        })
      }
    },
  )
}
