export type KeyManagementBackend = 'askar' | 'openbao'

export interface KeyManagementPolicyOptions {
  holderCredentialBinding?: KeyManagementBackend
}

export class KeyManagementPolicyConfig {
  public readonly holderCredentialBinding: KeyManagementBackend

  public constructor(options: KeyManagementPolicyOptions = {}) {
    this.holderCredentialBinding = options.holderCredentialBinding ?? 'askar'
  }
}
