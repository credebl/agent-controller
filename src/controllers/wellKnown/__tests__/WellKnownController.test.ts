/* eslint-disable import/order -- jest.mock calls must sit between the imports they mock */
import 'reflect-metadata'
import { container } from 'tsyringe'

// Avoid loading Credo's ESM/native dependencies in Jest (same approach as
// src/controllers/openid4vc/holder/__tests__/holder.service.test.ts) - Agent
// is only needed here as a DI token, not for its real implementation.
jest.mock('@credo-ts/core', () => ({
  Agent: class {},
}))

// errorHandlingService pulls in @credo-ts/anoncreds, @credo-ts/didcomm, etc.
// (real ESM, unparseable by ts-jest) just to classify errors it doesn't
// recognize - replicate its documented pass-through behavior for an
// already-typed BaseError (convertError looks it up by constructor name and
// rethrows the same class) without loading any of that.
jest.mock('../../../errorHandlingService', () => ({
  __esModule: true,
  default: {
    handle: (error: unknown) => {
      throw error
    },
  },
}))

import { Agent } from '@credo-ts/core'
import { NotFoundError } from '../../../errors'
import { WellKnownController } from '../WellKnownController'

describe('WellKnownController', () => {
  afterEach(() => {
    container.clearInstances()
  })

  const didRecord = (did: string, createdAt: string) => ({
    did,
    createdAt: new Date(createdAt),
    didDocument: { toJSON: () => ({ id: did }) },
  })

  const registerMockAgent = (
    getCreatedDids: jest.Mock,
    findAllByQuery: jest.Mock = jest.fn().mockResolvedValue([]),
  ) => {
    container.registerInstance(Agent, {
      dids: { getCreatedDids },
      genericRecords: { findAllByQuery },
    } as never)
  }

  it("returns this agent's own did:web document as plain JSON", async () => {
    const toJSON = jest.fn().mockReturnValue({ id: 'did:web:example.com', verificationMethod: [] })
    registerMockAgent(
      jest.fn().mockResolvedValue([{ did: 'did:web:example.com', createdAt: new Date(), didDocument: { toJSON } }]),
    )

    const controller = new WellKnownController()
    const result = await controller.getDidWebDocument()

    expect(result).toEqual({ id: 'did:web:example.com', verificationMethod: [] })
    expect(toJSON).toHaveBeenCalled()
  })

  it('asks the agent for created DIDs filtered to the web method', async () => {
    const getCreatedDids = jest.fn().mockResolvedValue([didRecord('did:web:example.com', '2024-01-01T00:00:00Z')])
    registerMockAgent(getCreatedDids)

    await new WellKnownController().getDidWebDocument()

    expect(getCreatedDids).toHaveBeenCalledWith({ method: 'web' })
  })

  it('throws NotFoundError when this agent has not created a did:web DID', async () => {
    registerMockAgent(jest.fn().mockResolvedValue([]))

    await expect(new WellKnownController().getDidWebDocument()).rejects.toThrow(NotFoundError)
  })

  it('throws NotFoundError when the created DID record has no document', async () => {
    registerMockAgent(
      jest.fn().mockResolvedValue([{ did: 'did:web:example.com', createdAt: new Date(), didDocument: undefined }]),
    )

    await expect(new WellKnownController().getDidWebDocument()).rejects.toThrow(NotFoundError)
  })

  it('serves the single did:web when no primary pointer is tagged', async () => {
    const getCreatedDids = jest.fn().mockResolvedValue([didRecord('did:web:only.example.com', '2024-01-01T00:00:00Z')])
    registerMockAgent(getCreatedDids, jest.fn().mockResolvedValue([]))

    const result = await new WellKnownController().getDidWebDocument()

    expect(result).toEqual({ id: 'did:web:only.example.com' })
  })

  it('serves the DID tagged as primary, even when it is not the first one created', async () => {
    const getCreatedDids = jest
      .fn()
      .mockResolvedValue([
        didRecord('did:web:old.example.com', '2024-01-01T00:00:00Z'),
        didRecord('did:web:new.example.com', '2024-06-01T00:00:00Z'),
      ])
    const findAllByQuery = jest.fn().mockResolvedValue([{ content: { did: 'did:web:new.example.com' } }])
    registerMockAgent(getCreatedDids, findAllByQuery)

    const result = await new WellKnownController().getDidWebDocument()

    expect(findAllByQuery).toHaveBeenCalledWith({ primaryDidWeb: 'true' })
    expect(result).toEqual({ id: 'did:web:new.example.com' })
  })

  it('serves the primary DID even when it is NOT index 0 in wallet-creation order', async () => {
    // Created first (index 0) but NOT primary - must not be served.
    const getCreatedDids = jest
      .fn()
      .mockResolvedValue([
        didRecord('did:web:created-first.example.com', '2024-01-01T00:00:00Z'),
        didRecord('did:web:marked-primary.example.com', '2024-02-01T00:00:00Z'),
        didRecord('did:web:created-last.example.com', '2024-03-01T00:00:00Z'),
      ])
    const findAllByQuery = jest.fn().mockResolvedValue([{ content: { did: 'did:web:marked-primary.example.com' } }])
    registerMockAgent(getCreatedDids, findAllByQuery)

    const result = await new WellKnownController().getDidWebDocument()

    expect(result).toEqual({ id: 'did:web:marked-primary.example.com' })
  })

  it('falls back to the most recently created did:web when multiple exist and none is tagged primary', async () => {
    const getCreatedDids = jest
      .fn()
      .mockResolvedValue([
        didRecord('did:web:older.example.com', '2024-01-01T00:00:00Z'),
        didRecord('did:web:newest.example.com', '2024-06-01T00:00:00Z'),
        didRecord('did:web:middle.example.com', '2024-03-01T00:00:00Z'),
      ])
    registerMockAgent(getCreatedDids, jest.fn().mockResolvedValue([]))

    const result = await new WellKnownController().getDidWebDocument()

    expect(result).toEqual({ id: 'did:web:newest.example.com' })
  })

  it('falls back instead of 404ing when the primary pointer refers to a did that no longer exists', async () => {
    const getCreatedDids = jest
      .fn()
      .mockResolvedValue([didRecord('did:web:still-here.example.com', '2024-01-01T00:00:00Z')])
    const findAllByQuery = jest.fn().mockResolvedValue([{ content: { did: 'did:web:deleted.example.com' } }])
    registerMockAgent(getCreatedDids, findAllByQuery)

    const result = await new WellKnownController().getDidWebDocument()

    expect(result).toEqual({ id: 'did:web:still-here.example.com' })
  })
})
