// Credo and the KMS modules ship as ESM; only the lookups used by the helper are needed here.
jest.mock('@credo-ts/core', () => ({ DidRepository: class DidRepository {} }))
jest.mock('../nodeKms', () => ({ NodeKeyRepository: class NodeKeyRepository {} }))
jest.mock('../openBao', () => ({
  OPENBAO_KMS_BACKEND: 'openbao',
  openBaoBackendForCreate: () => undefined,
  openBaoBackendForJwk: () => undefined,
}))

import { DidRepository } from '@credo-ts/core'

import { describeDidKms, kmsBackendForKeyId } from '../didKms'
import { NodeKeyRepository } from '../nodeKms'

const nodeKeyIds = new Set<string>(['node-key'])
const didKeys: Record<string, Array<{ didDocumentRelativeKeyId: string; kmsKeyId: string }>> = {}

const context = {
  resolve: (token: unknown) => {
    if (token === NodeKeyRepository) {
      return { findById: async (_ctx: unknown, id: string) => (nodeKeyIds.has(id) ? { id } : null) }
    }
    if (token === DidRepository) {
      return {
        getCreatedDids: async (_ctx: unknown, { did }: { did: string }) =>
          didKeys[did] ? [{ keys: didKeys[did] }] : [],
      }
    }
    throw new Error('unexpected token')
  },
}
const agent = { context } as never

describe('kmsBackendForKeyId', () => {
  it('recognises OpenBao, Node and Askar keys', async () => {
    expect(await kmsBackendForKeyId(agent, 'ob_abc')).toBe('openbao')
    expect(await kmsBackendForKeyId(agent, 'node-key')).toBe('node')
    expect(await kmsBackendForKeyId(agent, 'some-askar-uuid')).toBe('askar')
  })
})

describe('describeDidKms', () => {
  it('reports the backend of a single key', async () => {
    didKeys['did:key:a'] = [{ didDocumentRelativeKeyId: '#a', kmsKeyId: 'ob_1' }]
    expect(await describeDidKms(agent, 'did:key:a')).toEqual({
      kmsBackend: 'openbao',
      keys: [{ didDocumentRelativeKeyId: '#a', kmsKeyId: 'ob_1', kmsBackend: 'openbao' }],
    })
  })

  it('reports mixed when keys live in different backends', async () => {
    didKeys['did:web:b'] = [
      { didDocumentRelativeKeyId: '#k1', kmsKeyId: 'ob_1' },
      { didDocumentRelativeKeyId: '#k2', kmsKeyId: 'askar-1' },
    ]
    expect((await describeDidKms(agent, 'did:web:b')).kmsBackend).toBe('mixed')
  })

  it('has no backend for a DID without keys', async () => {
    expect(await describeDidKms(agent, 'did:web:none')).toEqual({ kmsBackend: null, keys: [] })
  })
})
