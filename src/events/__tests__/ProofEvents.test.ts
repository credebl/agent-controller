import type { ServerConfig } from '../../utils/ServerConfig'
import type { Agent } from '@credo-ts/core'
import type { DidCommProofStateChangedEvent } from '@credo-ts/didcomm'

import { DidCommProofEventTypes } from '@credo-ts/didcomm'

import { proofEvents } from '../ProofEvents'
import { sendWebSocketEvent } from '../WebSocketEvents'
import { sendWebhookEvent } from '../WebhookEvent'

jest.mock('../WebSocketEvents', () => ({ sendWebSocketEvent: jest.fn() }))
jest.mock('../WebhookEvent', () => ({ sendWebhookEvent: jest.fn() }))
jest.mock('@credo-ts/didcomm', () => ({ DidCommProofEventTypes: { ProofStateChanged: 'DidCommProofStateChanged' } }))

const createFixture = async () => {
  let activeSessions = 0
  const logger = { debug: jest.fn(), error: jest.fn() }
  const getFormatData = jest.fn().mockResolvedValue({ presentation: { anoncreds: { revealed: 'value' } } })
  const endSession = jest.fn(async () => {
    activeSessions--
  })
  const getTenantAgent = jest.fn(async (_options: { tenantId: string }) => {
    if (activeSessions === 1) throw new Error('Tenant session limit reached')
    activeSessions++
    return { modules: { didcomm: { proofs: { getFormatData } } }, endSession }
  })
  // Model Credo's scoped-session contract without loading its ESM/native dependencies in Jest.
  const tenants = {
    getTenantAgent,
    async withTenantAgent(
      options: { tenantId: string },
      callback: (tenantAgent: Awaited<ReturnType<typeof getTenantAgent>>) => Promise<unknown>,
    ) {
      const tenantAgent = await getTenantAgent(options)
      try {
        return await callback(tenantAgent)
      } finally {
        await tenantAgent.endSession()
      }
    },
  }
  const getDedicatedFormatData = jest.fn().mockResolvedValue({ presentation: { dedicated: true } })
  const on = jest.fn<void, [string, (event: DidCommProofStateChangedEvent) => Promise<void>]>()
  const agent = {
    events: { on },
    modules: { tenants, didcomm: { proofs: { getFormatData: getDedicatedFormatData } } },
    config: { logger },
  } as unknown as Agent
  const config: ServerConfig = {
    port: 3000,
    webhookUrl: 'https://example.com/hooks',
    socketServer: {} as NonNullable<ServerConfig['socketServer']>,
  }
  await proofEvents(agent, config)
  const handleEvent = on.mock.calls[0][1]
  const event = {
    type: DidCommProofEventTypes.ProofStateChanged,
    metadata: { contextCorrelationId: 'tenant-test-tenant' },
    payload: { proofRecord: { id: 'proof-id', toJSON: () => ({ id: 'proof-id', state: 'done' }) } },
  } as unknown as DidCommProofStateChangedEvent

  return {
    handleEvent,
    event,
    config,
    logger,
    getFormatData,
    getDedicatedFormatData,
    getTenantAgent,
    endSession,
    activeSessions: () => activeSessions,
  }
}

describe('proofEvents tenant session lifecycle', () => {
  beforeEach(() => jest.clearAllMocks())

  test('releases each tenant session so consecutive proof events do not exhaust the limit', async () => {
    const fixture = await createFixture()

    for (let index = 0; index < 3; index++) {
      await fixture.handleEvent(fixture.event)
    }

    expect(fixture.getTenantAgent).toHaveBeenCalledTimes(3)
    expect(fixture.getTenantAgent).toHaveBeenCalledWith({ tenantId: 'test-tenant' })
    expect(fixture.endSession).toHaveBeenCalledTimes(3)
    expect(fixture.activeSessions()).toBe(0)
    expect(sendWebhookEvent).toHaveBeenCalledTimes(3)
    expect(sendWebSocketEvent).toHaveBeenCalledTimes(3)
  })

  test('releases the session before delivery and preserves the proof payload', async () => {
    const fixture = await createFixture()
    jest.mocked(sendWebhookEvent).mockImplementationOnce(async () => {
      expect(fixture.activeSessions()).toBe(0)
    })

    await fixture.handleEvent(fixture.event)

    const body = {
      id: 'proof-id',
      state: 'done',
      contextCorrelationId: 'tenant-test-tenant',
      proofData: await fixture.getFormatData.mock.results[0].value,
    }
    expect(fixture.getFormatData).toHaveBeenCalledWith('proof-id')
    expect(sendWebhookEvent).toHaveBeenCalledWith('https://example.com/hooks/proofs', body, fixture.logger)
    expect(sendWebSocketEvent).toHaveBeenCalledWith(fixture.config.socketServer, {
      ...fixture.event,
      payload: { ...fixture.event.payload, proofRecord: body },
    })
  })

  test('releases the session when reading proof data fails and allows a subsequent event', async () => {
    const fixture = await createFixture()
    const error = new Error('Proof data unavailable')
    fixture.getFormatData.mockRejectedValueOnce(error)

    await expect(fixture.handleEvent(fixture.event)).rejects.toBe(error)

    expect(fixture.endSession).toHaveBeenCalledTimes(1)
    expect(fixture.activeSessions()).toBe(0)
    expect(sendWebhookEvent).not.toHaveBeenCalled()
    expect(sendWebSocketEvent).not.toHaveBeenCalled()
    await expect(fixture.handleEvent(fixture.event)).resolves.toBeUndefined()
    expect(fixture.endSession).toHaveBeenCalledTimes(2)
  })

  test('keeps dedicated-agent proof processing independent of tenant sessions', async () => {
    const fixture = await createFixture()
    fixture.event.metadata.contextCorrelationId = 'default'

    await fixture.handleEvent(fixture.event)

    expect(fixture.getDedicatedFormatData).toHaveBeenCalledWith('proof-id')
    expect(fixture.getTenantAgent).not.toHaveBeenCalled()
    expect(fixture.endSession).not.toHaveBeenCalled()
    expect(sendWebhookEvent).toHaveBeenCalledWith(
      'https://example.com/hooks/proofs',
      expect.objectContaining({ contextCorrelationId: 'default', proofData: { presentation: { dedicated: true } } }),
      fixture.logger,
    )
  })
})
