import type { ServerConfig } from '../../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'

import { sendWebSocketEvent } from '../WebSocketEvents'
import { sendWebhookEvent } from '../WebhookEvent'
import { openId4VcIssuanceSessionEvents } from '../openId4VcIssuanceSessionEvents'

jest.mock('../WebSocketEvents', () => ({ sendWebSocketEvent: jest.fn() }))
jest.mock('../WebhookEvent', () => ({ sendWebhookEvent: jest.fn() }))
jest.mock('@credo-ts/openid4vc', () => ({
  OpenId4VcIssuerEvents: {
    IssuanceSessionStateChanged: 'OpenId4VcIssuer.IssuanceSessionStateChanged',
    IssuanceSessionNotificationReceived: 'OpenId4VcIssuer.IssuanceSessionNotificationReceived',
  },
}))

type Handler = (event: any) => Promise<void>

const createFixture = async (config: Partial<ServerConfig> = { webhookUrl: 'http://webhook.example' }) => {
  const handlers = new Map<string, Handler>()
  const logger = { debug: jest.fn(), error: jest.fn() }
  const agent = {
    events: { on: jest.fn((type: string, handler: Handler) => handlers.set(type, handler)) },
    config: { logger },
  } as unknown as Agent
  await openId4VcIssuanceSessionEvents(agent, { port: 3000, ...config } as ServerConfig)
  return { handlers, logger }
}

const sessionJson = {
  id: 'session-1',
  state: 'Completed',
  issuerId: 'issuer-1',
  notifications: [
    {
      notificationId: 'n-1',
      credentialConfigurationId: 'IecSdJwt',
      events: [{ event: 'credential_accepted', receivedAt: '2026-11-03T10:00:00.000Z' }],
    },
  ],
}

const notificationEvent = {
  type: 'OpenId4VcIssuer.IssuanceSessionNotificationReceived',
  payload: {
    issuanceSession: { toJSON: () => sessionJson },
    notification: {
      notificationId: 'n-1',
      credentialConfigurationId: 'IecSdJwt',
      event: 'credential_accepted',
      receivedAt: new Date('2026-11-03T10:00:00.000Z'),
    },
  },
  metadata: { contextCorrelationId: 'tenant-abc' },
}

describe('openId4VcIssuanceSessionEvents', () => {
  beforeEach(() => {
    jest.mocked(sendWebhookEvent).mockReset()
    jest.mocked(sendWebSocketEvent).mockReset()
  })

  it('sends a state change on the openid4vc-issuance topic', async () => {
    const { handlers, logger } = await createFixture()

    await handlers.get('OpenId4VcIssuer.IssuanceSessionStateChanged')!({
      payload: { issuanceSession: { toJSON: () => sessionJson } },
      metadata: { contextCorrelationId: 'tenant-abc' },
    })

    expect(sendWebhookEvent).toHaveBeenCalledWith(
      'http://webhook.example/openid4vc-issuance',
      { ...sessionJson, contextCorrelationId: 'tenant-abc' },
      logger,
    )
  })

  it('sends a wallet notification on the openid4vc-issuance topic with the session and the notification', async () => {
    const { handlers, logger } = await createFixture()

    await handlers.get('OpenId4VcIssuer.IssuanceSessionNotificationReceived')!(notificationEvent)

    expect(sendWebhookEvent).toHaveBeenCalledWith(
      'http://webhook.example/openid4vc-issuance',
      {
        ...sessionJson,
        notification: {
          notificationId: 'n-1',
          credentialConfigurationId: 'IecSdJwt',
          event: 'credential_accepted',
          receivedAt: '2026-11-03T10:00:00.000Z',
        },
        contextCorrelationId: 'tenant-abc',
      },
      logger,
    )
  })

  it('sends a wallet notification on the web socket when one is configured', async () => {
    const socketServer = {} as ServerConfig['socketServer']
    const { handlers } = await createFixture({ socketServer })

    await handlers.get('OpenId4VcIssuer.IssuanceSessionNotificationReceived')!(notificationEvent)

    expect(sendWebhookEvent).not.toHaveBeenCalled()
    expect(sendWebSocketEvent).toHaveBeenCalledWith(
      socketServer,
      expect.objectContaining({
        type: 'OpenId4VcIssuer.IssuanceSessionNotificationReceived',
        payload: expect.objectContaining({
          issuanceRecord: expect.objectContaining({ id: 'session-1', notification: expect.anything() }),
        }),
      }),
    )
  })
})
