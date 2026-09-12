jest.mock('@credo-ts/core', () => ({
  Kms: { KeyManagementModuleConfig: class KeyManagementModuleConfig {} },
}))

import type { AgentContext, DependencyManager } from '@credo-ts/core'

import { KeyManagementPolicyConfig } from '../KeyManagementPolicyConfig'
import { KeyManagementPolicyModule } from '../KeyManagementPolicyModule'

describe('KeyManagementPolicyModule', () => {
  test('registers the resolved policy', () => {
    const dependencyManager = { registerInstance: jest.fn() } as unknown as DependencyManager
    const module = new KeyManagementPolicyModule({ holderCredentialBinding: 'openbao' })

    module.register(dependencyManager)

    expect(dependencyManager.registerInstance).toHaveBeenCalledWith(KeyManagementPolicyConfig, module.config)
  })

  test('rejects a policy that selects an unavailable backend', async () => {
    const module = new KeyManagementPolicyModule({ holderCredentialBinding: 'openbao' })
    const agentContext = {
      resolve: jest.fn().mockReturnValue({ backends: [{ backend: 'askar' }] }),
    } as unknown as AgentContext

    await expect(module.initialize(agentContext)).rejects.toThrow(
      "KMS backend 'openbao' configured for holder credential binding is not registered",
    )
  })

  test('accepts a policy that selects a registered backend', async () => {
    const module = new KeyManagementPolicyModule({ holderCredentialBinding: 'openbao' })
    const agentContext = {
      resolve: jest.fn().mockReturnValue({ backends: [{ backend: 'askar' }, { backend: 'openbao' }] }),
    } as unknown as AgentContext

    await expect(module.initialize(agentContext)).resolves.toBeUndefined()
  })
})
