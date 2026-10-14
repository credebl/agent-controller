import type { AgentContext } from '@credo-ts/core'

import {
  CredoError,
  JsonTransformer,
  Kms,
  LdKeyPair,
  MessageValidator,
  VerificationMethod,
  getPublicJwkFromVerificationMethod,
} from '@credo-ts/core'

/**
 * Local re-implementation of Credo's internal `createKmsKeyPairClass`.
 *
 * Credo does not export this helper from its public entrypoints and does not
 * expose `@credo-ts/core/build/crypto/KmsKeyPair.mjs` through package `exports`,
 * so we rebuild the same KMS-backed `LdKeyPair` from public APIs. The signature
 * and verification operations are routed through the agent's `KeyManagementApi`.
 */
export function createKmsKeyPairClass(agentContext: AgentContext): any {
  return class KmsKeyPair extends LdKeyPair {
    public readonly type = 'KmsKeyPair'
    private readonly publicJwk: any

    public constructor(options: { id: string; controller: string; publicJwk: any }) {
      super({ id: options.id, controller: options.controller })
      this.publicJwk = options.publicJwk
    }

    public static async generate(): Promise<any> {
      throw new Error('Not implemented')
    }

    public fingerprint(): string {
      throw new Error('Method not implemented.')
    }

    public verifyFingerprint(): boolean {
      throw new Error('Method not implemented.')
    }

    public static async from(verificationMethod: any): Promise<any> {
      const vMethod = JsonTransformer.fromJSON(verificationMethod, VerificationMethod)
      MessageValidator.validateSync(vMethod)
      const publicJwk = getPublicJwkFromVerificationMethod(vMethod)
      return new KmsKeyPair({ id: vMethod.id, controller: vMethod.controller, publicJwk })
    }

    public signer(): { sign: (data: any) => Promise<any> } {
      const wrappedSign = async (data: any) => {
        if (Array.isArray(data.data)) throw new CredoError('Signing array of data entries is not supported')
        const result = await agentContext.dependencyManager.resolve(Kms.KeyManagementApi).sign({
          data: data.data,
          keyId: this.publicJwk.keyId,
          algorithm: this.publicJwk.signatureAlgorithm,
        })
        return result.signature
      }
      return { sign: wrappedSign.bind(this) }
    }

    public verifier(): { verify: (data: any) => Promise<boolean> } {
      const wrappedVerify = async (data: any) => {
        const result = await agentContext.dependencyManager.resolve(Kms.KeyManagementApi).verify({
          data: data.data,
          signature: data.signature,
          key: { publicJwk: this.publicJwk.toJson() },
          algorithm: this.publicJwk.signatureAlgorithm,
        })
        return result.verified
      }
      return { verify: wrappedVerify.bind(this) }
    }

    public get publicKeyBuffer(): Uint8Array {
      const publicKey = this.publicJwk.publicKey
      if (publicKey.kty === 'RSA') throw new CredoError(`kty 'RSA' not supported for publicKeyBuffer`)
      return publicKey.publicKey
    }
  }
}
