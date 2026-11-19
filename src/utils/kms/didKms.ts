import type { KmsBackendName } from './backend'
import type { AgentType } from '../../types'

import { DidRepository } from '@credo-ts/core'

import { ASKAR_KMS_BACKEND, NODE_KMS_BACKEND } from './backend'
import { NodeKeyRepository } from './nodeKms'
import { OPENBAO_KMS_BACKEND } from './openBao'

/** OpenBao namespaces every key id it hands out with this prefix. */
const OPENBAO_KEY_ID_PREFIX = 'ob_'

export type DidKmsBackend = KmsBackendName | 'mixed'

export interface DidKeyKms {
  didDocumentRelativeKeyId: string
  kmsKeyId: string
  kmsBackend: KmsBackendName
}

export interface DidKmsDetails {
  /** The backend holding the keys of the DID, `mixed` when they are spread over several, `null` when none are known. */
  kmsBackend: DidKmsBackend | null
  keys: DidKeyKms[]
}

/**
 * Works out which backend stores a key. OpenBao key ids carry the `ob_` prefix and the Node KMS keeps its keys as agent
 * records, so anything else was stored in Askar (the default backend).
 */
export async function kmsBackendForKeyId(agent: AgentType, keyId: string): Promise<KmsBackendName> {
  if (keyId.startsWith(OPENBAO_KEY_ID_PREFIX)) return OPENBAO_KMS_BACKEND

  const nodeKey = await agent.context.resolve(NodeKeyRepository).findById(agent.context, keyId)
  return nodeKey ? NODE_KMS_BACKEND : ASKAR_KMS_BACKEND
}

/**
 * Describes where the keys of a DID created or imported by this agent are stored. A DID the agent holds no keys for
 * (for example one it only resolves) has no backend.
 */
export async function describeDidKms(agent: AgentType, did: string): Promise<DidKmsDetails> {
  const [record] = await agent.context.resolve(DidRepository).getCreatedDids(agent.context, { did })

  const keys: DidKeyKms[] = []
  for (const key of record?.keys ?? []) {
    keys.push({
      didDocumentRelativeKeyId: key.didDocumentRelativeKeyId,
      kmsKeyId: key.kmsKeyId,
      kmsBackend: await kmsBackendForKeyId(agent, key.kmsKeyId),
    })
  }

  const backends = new Set(keys.map((key) => key.kmsBackend))
  let kmsBackend: DidKmsBackend | null = null
  if (backends.size === 1) kmsBackend = keys[0].kmsBackend
  else if (backends.size > 1) kmsBackend = 'mixed'

  return { kmsBackend, keys }
}
