import type { ResolvedOpenBaoKmsConfig } from './OpenBaoKmsConfig'

import { Kms, type AgentContext } from '@credo-ts/core'
import { createHash, createPublicKey, randomBytes } from 'crypto'

import { toSafeOpenBaoError } from './OpenBaoError'
import { OpenBaoTransitClient, type OpenBaoTransitKey } from './OpenBaoTransitClient'

const backend = 'openbao'

export class OpenBaoKeyManagementService implements Kms.KeyManagementService {
  public readonly backend = backend

  public constructor(
    private readonly config: ResolvedOpenBaoKmsConfig,
    private readonly client = new OpenBaoTransitClient(config),
  ) {}

  public isOperationSupported(agentContext: AgentContext, operation: Kms.KmsOperation): boolean {
    if (operation.operation === 'createKey') return this.isSupportedType(operation.type)
    if (operation.operation === 'sign' || operation.operation === 'verify')
      return this.isSupportedAlg(operation.algorithm)
    return false
  }

  public async createKey<Type extends Kms.KmsCreateKeyType>(
    agentContext: AgentContext,
    options: Kms.KmsCreateKeyOptions<Type>,
  ): Promise<Kms.KmsCreateKeyReturn<Type>> {
    if (!this.isSupportedType(options.type)) throw this.unsupported(`key type '${JSON.stringify(options.type)}'`)
    const context = this.contextId(agentContext)
    const logicalId = options.keyId ?? randomBytes(16).toString('hex')
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(logicalId)) {
      throw new Kms.KeyManagementError('OpenBao keyId must contain only letters, numbers, underscores, or hyphens')
    }
    const keyId = `${backend}:${context}:${logicalId}`
    const transitName = this.transitName(context, logicalId)
    try {
      await this.client.createKey(transitName, options.type.kty === 'OKP' ? 'ed25519' : 'ecdsa-p256')
      const key = await this.client.readKey(transitName)
      if (!key) throw new Error('key was not readable after creation')
      return { keyId, publicJwk: this.publicJwk(key, keyId) } as Kms.KmsCreateKeyReturn<Type>
    } catch (error) {
      if (error instanceof Kms.KeyManagementError) throw error
      throw new Kms.KeyManagementError('Error creating OpenBao key', { cause: this.asError(error) })
    }
  }

  public async getPublicKey(agentContext: AgentContext, keyId: string): Promise<Kms.KmsJwkPublic | null> {
    const { context, logicalId } = this.parseKeyId(agentContext, keyId)
    const key = await this.client.readKey(this.transitName(context, logicalId))
    return key ? this.publicJwk(key, keyId) : null
  }

  public async sign(agentContext: AgentContext, options: Kms.KmsSignOptions): Promise<Kms.KmsSignReturn> {
    if (!this.isSupportedAlg(options.algorithm)) throw this.unsupported(`signing algorithm '${options.algorithm}'`)
    const { context, logicalId } = this.parseKeyId(agentContext, options.keyId)
    try {
      const signature = await this.client.sign(this.transitName(context, logicalId), options.data, options.algorithm)
      return { signature }
    } catch (error) {
      throw new Kms.KeyManagementError('Error signing with OpenBao key', { cause: this.asError(error) })
    }
  }

  public async verify(agentContext: AgentContext, options: Kms.KmsVerifyOptions): Promise<Kms.KmsVerifyReturn> {
    if (!this.isSupportedAlg(options.algorithm)) throw this.unsupported(`verification algorithm '${options.algorithm}'`)
    if (!options.key.keyId) return { verified: false }
    const { context, logicalId } = this.parseKeyId(agentContext, options.key.keyId)
    try {
      const transitName = this.transitName(context, logicalId)
      const key = await this.client.readKey(transitName)
      if (!key) return { verified: false }
      const verified = await this.client.verify(
        transitName,
        options.data,
        options.signature,
        options.algorithm,
        key.latest_version,
      )
      if (!verified) return { verified: false }
      return { verified: true, publicJwk: this.publicJwk(key, options.key.keyId) }
    } catch (error) {
      throw new Kms.KeyManagementError('Error verifying with OpenBao key', { cause: this.asError(error) })
    }
  }

  public async deleteKey(agentContext: AgentContext, options: Kms.KmsDeleteKeyOptions): Promise<boolean> {
    this.parseKeyId(agentContext, options.keyId)
    throw new Kms.KeyManagementAlgorithmNotSupportedError('deleting Transit keys', this.backend)
  }

  public async importKey<Jwk extends Kms.KmsJwkPrivate>(
    _agentContext: AgentContext,
    _options: Kms.KmsImportKeyOptions<Jwk>,
  ): Promise<Kms.KmsImportKeyReturn<Jwk>> {
    throw new Kms.KeyManagementAlgorithmNotSupportedError('importing keys', this.backend)
  }

  public async encrypt(_agentContext: AgentContext, _options: Kms.KmsEncryptOptions): Promise<Kms.KmsEncryptReturn> {
    throw new Kms.KeyManagementAlgorithmNotSupportedError('encryption', this.backend)
  }

  public async decrypt(_agentContext: AgentContext, _options: Kms.KmsDecryptOptions): Promise<Kms.KmsDecryptReturn> {
    throw new Kms.KeyManagementAlgorithmNotSupportedError('decryption', this.backend)
  }

  public randomBytes(_agentContext: AgentContext, options: Kms.KmsRandomBytesOptions): Kms.KmsRandomBytesReturn {
    return new Uint8Array(randomBytes(options.length))
  }

  private isSupportedType(type: Kms.KmsCreateKeyType): type is Kms.KmsCreateKeyTypeOkp | Kms.KmsCreateKeyTypeEc {
    return (type.kty === 'OKP' && type.crv === 'Ed25519') || (type.kty === 'EC' && type.crv === 'P-256')
  }

  private isSupportedAlg(algorithm: string): algorithm is 'EdDSA' | 'Ed25519' | 'ES256' {
    return algorithm === 'EdDSA' || algorithm === 'Ed25519' || algorithm === 'ES256'
  }

  private contextId(agentContext: AgentContext) {
    return createHash('sha256').update(agentContext.contextCorrelationId).digest('hex').slice(0, 20)
  }

  private parseKeyId(agentContext: AgentContext, keyId: string) {
    const match = /^openbao:([a-f0-9]{20}):([a-zA-Z0-9_-]{1,128})$/.exec(keyId)
    if (!match || match[1] !== this.contextId(agentContext)) {
      throw new Kms.KeyManagementKeyNotFoundError(keyId, [this.backend])
    }
    return { context: match[1], logicalId: match[2] }
  }

  private transitName(context: string, logicalId: string) {
    return `${this.config.keyPrefix}-${context}-${logicalId}`
  }

  private publicJwk(key: OpenBaoTransitKey, keyId: string): Kms.KmsJwkPublic & { kid: string } {
    const version = key.keys[String(key.latest_version)]
    const publicKey = typeof version === 'object' ? version.public_key : undefined
    if (!publicKey) throw new Kms.KeyManagementError(`OpenBao key '${keyId}' has no public key`)
    const jwk =
      key.type === 'ed25519'
        ? { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') }
        : createPublicKey(publicKey).export({ format: 'jwk' })
    return Kms.PublicJwk.fromUnknown({ ...jwk, kid: keyId, use: 'sig', key_ops: ['verify'] }).toJson({
      includeKid: true,
    }) as Kms.KmsJwkPublic & { kid: string }
  }

  private unsupported(operation: string) {
    return new Kms.KeyManagementAlgorithmNotSupportedError(operation, this.backend)
  }

  private asError(error: unknown) {
    return toSafeOpenBaoError(error)
  }
}
