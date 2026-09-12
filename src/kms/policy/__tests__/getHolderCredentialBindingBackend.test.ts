jest.mock('@credo-ts/core', () => ({}))

import type { AgentContext } from '@credo-ts/core'

import { KeyManagementPolicyConfig } from '../KeyManagementPolicyConfig'
import { getHolderCredentialBindingBackend } from '../getHolderCredentialBindingBackend'

const context = (policy?: KeyManagementPolicyConfig) =>
  ({
    dependencyManager: {
      isRegistered: jest.fn().mockReturnValue(Boolean(policy)),
      resolve: jest.fn().mockReturnValue(policy),
    },
  }) as unknown as AgentContext

describe('getHolderCredentialBindingBackend', () => {
  test('preserves Askar when no policy is registered', () => {
    expect(getHolderCredentialBindingBackend(context())).toBe('askar')
  })

  test('returns the explicitly configured backend', () => {
    expect(
      getHolderCredentialBindingBackend(context(new KeyManagementPolicyConfig({ holderCredentialBinding: 'openbao' }))),
    ).toBe('openbao')
  })
})
