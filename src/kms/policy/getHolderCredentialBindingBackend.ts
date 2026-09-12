import type { AgentContext } from '@credo-ts/core'

import { KeyManagementPolicyConfig, type KeyManagementBackend } from './KeyManagementPolicyConfig'

export const getHolderCredentialBindingBackend = (agentContext: AgentContext): KeyManagementBackend => {
  const dependencyManager = agentContext.dependencyManager

  return dependencyManager.isRegistered(KeyManagementPolicyConfig, true)
    ? dependencyManager.resolve(KeyManagementPolicyConfig).holderCredentialBinding
    : 'askar'
}
