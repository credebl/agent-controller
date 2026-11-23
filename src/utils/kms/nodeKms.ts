import type { AgentContext, DependencyManager, Kms, Module, StorageService } from '@credo-ts/core'
import type { NodeKeyManagementStorage } from '@credo-ts/node'

import {
  BaseRecord,
  EventEmitter,
  InjectionSymbols,
  Kms as CredoKms,
  Repository,
  inject,
  injectable,
} from '@credo-ts/core'
import { NodeKeyManagementService } from '@credo-ts/node'

import { NODE_KMS_BACKEND } from './backend'

/**
 * Askar's KMS only handles EC / OKP / oct keys. The Node (node:crypto) KMS is registered next to it so keys that Askar
 * cannot hold, such as the RSA keys that many CA-issued X.509 certificates use, can still be imported and used for
 * signing. Askar stays the default backend, the Node backend is only picked for operations Askar does not support.
 */
export { NODE_KMS_BACKEND }

export class NodeKeyRecord extends BaseRecord {
  public static readonly type = 'NodeKeyRecord'
  public readonly type = NodeKeyRecord.type

  public privateJwk!: Kms.KmsJwkPrivate

  public constructor(props?: { id: string; privateJwk: Kms.KmsJwkPrivate }) {
    super()
    if (props) {
      this.id = props.id
      this.privateJwk = props.privateJwk
      this.createdAt = new Date()
    }
  }

  public getTags() {
    return { ...this._tags }
  }
}

@injectable()
export class NodeKeyRepository extends Repository<NodeKeyRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<NodeKeyRecord>,
    eventEmitter: EventEmitter,
  ) {
    super(NodeKeyRecord, storageService, eventEmitter)
  }
}

/**
 * Stores the Node KMS private keys in the agent's (encrypted) storage, scoped to the agent context so every tenant
 * only sees its own keys.
 */
export class RecordNodeKeyManagementStorage implements NodeKeyManagementStorage {
  public async get(agentContext: AgentContext, keyId: string) {
    const record = await agentContext.resolve(NodeKeyRepository).findById(agentContext, keyId)
    return record?.privateJwk ?? null
  }

  public async has(agentContext: AgentContext, keyId: string) {
    return (await agentContext.resolve(NodeKeyRepository).findById(agentContext, keyId)) !== null
  }

  public async set(agentContext: AgentContext, keyId: string, jwk: Kms.KmsJwkPrivate) {
    await agentContext.resolve(NodeKeyRepository).save(agentContext, new NodeKeyRecord({ id: keyId, privateJwk: jwk }))
  }

  public async delete(agentContext: AgentContext, keyId: string) {
    const repository = agentContext.resolve(NodeKeyRepository)
    const record = await repository.findById(agentContext, keyId)
    if (!record) return false
    await repository.delete(agentContext, record)
    return true
  }
}

export class NodeKmsModule implements Module {
  public register(dependencyManager: DependencyManager) {
    dependencyManager.registerSingleton(NodeKeyRepository)

    const kmsConfig = dependencyManager.resolve(CredoKms.KeyManagementModuleConfig)
    if (!kmsConfig.backends.some((backend) => backend.backend === NODE_KMS_BACKEND)) {
      kmsConfig.registerBackend(new NodeKeyManagementService(new RecordNodeKeyManagementStorage()))
    }
  }
}
