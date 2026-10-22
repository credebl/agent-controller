import type { AgentContext, DependencyManager, Module } from '@credo-ts/core'

import { Kms } from '@credo-ts/core'

import { KeyManagementPolicyConfig, type KeyManagementPolicyOptions } from './KeyManagementPolicyConfig'

export class KeyManagementPolicyModule implements Module {
  public readonly config: KeyManagementPolicyConfig

  public constructor(options: KeyManagementPolicyOptions) {
    this.config = new KeyManagementPolicyConfig(options)
  }

  public register(dependencyManager: DependencyManager) {
    dependencyManager.registerInstance(KeyManagementPolicyConfig, this.config)
  }

  public async initialize(agentContext: AgentContext) {
    const registeredBackends = agentContext
      .resolve(Kms.KeyManagementModuleConfig)
      .backends.map(({ backend }) => backend)

    if (!registeredBackends.includes(this.config.holderCredentialBinding)) {
      throw new Error(
        `KMS backend '${this.config.holderCredentialBinding}' configured for holder credential binding is not registered`,
      )
    }
  }
}
