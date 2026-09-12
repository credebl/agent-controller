import { KeyManagementPolicyConfig } from '../KeyManagementPolicyConfig'

describe('KeyManagementPolicyConfig', () => {
  test('uses Askar for holder credential binding by default', () => {
    expect(new KeyManagementPolicyConfig().holderCredentialBinding).toBe('askar')
  })

  test('allows holder credential binding to opt in to OpenBao', () => {
    expect(new KeyManagementPolicyConfig({ holderCredentialBinding: 'openbao' }).holderCredentialBinding).toBe(
      'openbao',
    )
  })
})
