import { getPrimaryDidWeb, setPrimaryDidWeb } from '../primaryDidWeb'

describe('setPrimaryDidWeb', () => {
  it('saves a new genericRecord when no primary pointer exists yet', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const update = jest.fn()
    const agent = { genericRecords: { findAllByQuery: jest.fn().mockResolvedValue([]), save, update } }

    await setPrimaryDidWeb(agent, 'did:web:example.com')

    expect(save).toHaveBeenCalledWith({
      content: { did: 'did:web:example.com' },
      tags: { primaryDidWeb: 'true' },
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('updates the existing pointer in place when one is already tagged primary', async () => {
    const existingRecord = {
      content: { did: 'did:web:old.example.com' },
      setTag: jest.fn(),
    }
    const save = jest.fn()
    const update = jest.fn().mockResolvedValue(undefined)
    const agent = {
      genericRecords: { findAllByQuery: jest.fn().mockResolvedValue([existingRecord]), save, update },
    }

    await setPrimaryDidWeb(agent, 'did:web:new.example.com')

    expect(existingRecord.content.did).toBe('did:web:new.example.com')
    expect(existingRecord.setTag).toHaveBeenCalledWith('primaryDidWeb', 'true')
    expect(update).toHaveBeenCalledWith(existingRecord)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('getPrimaryDidWeb', () => {
  it('returns undefined when no pointer is tagged', async () => {
    const agent = { genericRecords: { findAllByQuery: jest.fn().mockResolvedValue([]) } }

    await expect(getPrimaryDidWeb(agent)).resolves.toBeUndefined()
  })

  it('returns the did stored on the tagged pointer', async () => {
    const agent = {
      genericRecords: {
        findAllByQuery: jest.fn().mockResolvedValue([{ content: { did: 'did:web:example.com' } }]),
      },
    }

    await expect(getPrimaryDidWeb(agent)).resolves.toBe('did:web:example.com')
    expect(agent.genericRecords.findAllByQuery).toHaveBeenCalledWith({ primaryDidWeb: 'true' })
  })
})
