import type { DependencyManager, Kms, Module } from '@credo-ts/core'

import { inject, injectable, Kms as CredoKms, TypedArrayEncoder } from '@credo-ts/core'
import {
  AppRoleAuth,
  FetchOpenBaoClient,
  OpenBaoKeyManagementService,
  StaticTokenAuth,
  type AuthProvider,
} from '@sovio-id/credo-openbao-kms'
import { createPrivateKey, createPublicKey, type JsonWebKey } from 'node:crypto'

/**
 * Optional OpenBao Transit KMS. It is registered after Askar and the Node KMS so neither of those changes behaviour when
 * OpenBao is disabled, and Askar stays the default backend for implicit key creation.
 */
export const OPENBAO_KMS_BACKEND = 'openbao'

export interface OpenBaoKmsConfig {
  enabled: boolean
  writeEnabled: boolean
  address?: string
  token?: string
  roleId?: string
  secretId?: string
  secretIdFile?: string
  authMount: string
  namespace?: string
  transitMount: string
  kvMount?: string
  deploymentId?: string
  timeoutMs: number
  healthCheck: boolean
  didKeyEnabled: boolean
  didWebEnabled: boolean
}

function envBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envNumber(name: string): number | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Reads the OpenBao configuration. Every setting is optional and defaults preserve the existing Askar-only behaviour.
 * The values are read on each call so a test can change the environment without reloading the module.
 */
export function getOpenBaoConfigFromEnv(): OpenBaoKmsConfig {
  const config: OpenBaoKmsConfig = {
    enabled: envBoolean('OPENBAO_ENABLED', false),
    writeEnabled: envBoolean('OPENBAO_WRITE_ENABLED', true),
    authMount: process.env.OPENBAO_AUTH_MOUNT || 'approle',
    transitMount: process.env.OPENBAO_TRANSIT_MOUNT || 'transit',
    timeoutMs: envNumber('OPENBAO_TIMEOUT_MS') ?? 10_000,
    healthCheck: envBoolean('OPENBAO_HEALTH_CHECK', true),
    didKeyEnabled: envBoolean('OPENBAO_DID_KEY_ENABLED', false),
    didWebEnabled: envBoolean('OPENBAO_DID_WEB_ENABLED', false),
  }

  if (process.env.OPENBAO_ADDRESS) config.address = process.env.OPENBAO_ADDRESS
  if (process.env.OPENBAO_TOKEN) config.token = process.env.OPENBAO_TOKEN
  if (process.env.OPENBAO_ROLE_ID) config.roleId = process.env.OPENBAO_ROLE_ID
  if (process.env.OPENBAO_SECRET_ID) config.secretId = process.env.OPENBAO_SECRET_ID
  if (process.env.OPENBAO_SECRET_ID_FILE) config.secretIdFile = process.env.OPENBAO_SECRET_ID_FILE
  if (process.env.OPENBAO_NAMESPACE) config.namespace = process.env.OPENBAO_NAMESPACE
  if (process.env.OPENBAO_KV_MOUNT) config.kvMount = process.env.OPENBAO_KV_MOUNT
  if (process.env.OPENBAO_DEPLOYMENT_ID) config.deploymentId = process.env.OPENBAO_DEPLOYMENT_ID

  return config
}

/**
 * The config resolved at startup. `runRestAgent` can receive OpenBao settings through the CLI, in which case the
 * request-time backend helpers must use that config instead of reading the environment again.
 */
let effectiveConfig: OpenBaoKmsConfig | undefined

export function setOpenBaoConfig(config: OpenBaoKmsConfig): void {
  effectiveConfig = config
}

export function getOpenBaoConfig(): OpenBaoKmsConfig {
  return effectiveConfig ?? getOpenBaoConfigFromEnv()
}

/** True when the OpenBao backend should be registered and used for key selection. */
export function isOpenBaoEnabled(): boolean {
  return getOpenBaoConfig().enabled
}

/** True when OpenBao may create, import, or delete keys. Rollback is `OPENBAO_WRITE_ENABLED=false`. */
export function isOpenBaoWriteEnabled(): boolean {
  const config = getOpenBaoConfig()
  return config.enabled && config.writeEnabled
}

function isTransitCreateKeyTypeSupported(type: { kty: string; crv?: string }): boolean {
  if (type.kty === 'RSA') return true
  if (type.kty === 'OKP') return type.crv === 'Ed25519'
  if (type.kty === 'EC') return type.crv === 'P-256' || type.crv === 'P-384' || type.crv === 'P-521'
  return false
}

function isTransitJwkSupported(jwk: { kty: string; crv?: string }): boolean {
  if (jwk.kty === 'RSA') return true
  if (jwk.kty === 'OKP') return jwk.crv === 'Ed25519'
  if (jwk.kty === 'EC') return jwk.crv === 'P-256' || jwk.crv === 'P-384' || jwk.crv === 'P-521'
  return false
}

/**
 * The OpenBao backend to use when creating a key, or `undefined` to fall through to the default backend. X25519 and
 * secp256k1 are deliberately never routed to OpenBao.
 */
export function openBaoBackendForCreate(type: Kms.KmsCreateKeyType): string | undefined {
  if (!isOpenBaoWriteEnabled()) return undefined
  return isTransitCreateKeyTypeSupported(type) ? OPENBAO_KMS_BACKEND : undefined
}

/** The OpenBao backend to use when importing an existing private JWK, or `undefined` to use another backend. */
export function openBaoBackendForJwk(jwk: { kty: string; crv?: string }): string | undefined {
  if (!isOpenBaoWriteEnabled()) return undefined
  return isTransitJwkSupported(jwk) ? OPENBAO_KMS_BACKEND : undefined
}

/**
 * Deterministic key id for a JWK imported into OpenBao: the RFC 7638 thumbprint of its public key. Passing it as the
 * JWK `kid` makes importing the same key twice reuse the existing Transit key instead of leaving an orphan behind.
 */
export function openBaoKeyIdForPrivateJwk(privateJwk: Kms.KmsJwkPrivate): string {
  const privateKey = createPrivateKey({ key: privateJwk as unknown as JsonWebKey, format: 'jwk' })
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as Kms.KmsJwkPublicAsymmetric
  return TypedArrayEncoder.toBase64Url(CredoKms.PublicJwk.fromPublicJwk(publicJwk).getJwkThumbprint())
}

/** The OpenBao backend to use for a DID method, honouring the opt-in flags for did:key and did:web. */
export function openBaoBackendForDidMethod(method: 'key' | 'web'): string | undefined {
  const config = getOpenBaoConfig()
  if (!config.enabled || !config.writeEnabled) return undefined
  if (method === 'key' && config.didKeyEnabled) return OPENBAO_KMS_BACKEND
  if (method === 'web' && config.didWebEnabled) return OPENBAO_KMS_BACKEND
  return undefined
}

function createAuth(config: OpenBaoKmsConfig): AuthProvider {
  if (config.token) return new StaticTokenAuth(config.token)

  if (!config.roleId) {
    throw new Error('OPENBAO_ROLE_ID is required when OPENBAO_ENABLED=true and OPENBAO_TOKEN is not set')
  }
  if (!config.secretId && !config.secretIdFile) {
    throw new Error('OPENBAO_SECRET_ID or OPENBAO_SECRET_ID_FILE is required for AppRole authentication')
  }

  return new AppRoleAuth({
    address: requireAddress(config),
    roleId: config.roleId,
    ...(config.secretId ? { secretId: config.secretId } : {}),
    ...(config.secretIdFile ? { secretIdFile: config.secretIdFile } : {}),
    mountPath: config.authMount,
    ...(config.namespace ? { namespace: config.namespace } : {}),
    timeoutMs: config.timeoutMs,
  })
}

function requireAddress(config: OpenBaoKmsConfig): string {
  if (!config.address) {
    throw new Error('OPENBAO_ADDRESS is required when OPENBAO_ENABLED=true')
  }
  return config.address
}

function createService(config: OpenBaoKmsConfig, deploymentId?: string): OpenBaoKeyManagementService {
  const auth = createAuth(config)
  const client = new FetchOpenBaoClient({
    address: requireAddress(config),
    token: () => auth.getToken(),
    mountPath: config.transitMount,
    ...(config.namespace ? { namespace: config.namespace } : {}),
    timeoutMs: config.timeoutMs,
  })

  return new OpenBaoKeyManagementService({
    client,
    ...(config.deploymentId || deploymentId ? { deploymentId: config.deploymentId ?? deploymentId } : {}),
    writeEnabled: config.writeEnabled,
    ...(config.kvMount ? { kvMount: config.kvMount } : {}),
  })
}

/**
 * Registers the OpenBao backend. The module is always present so controllers can ask whether it is enabled, but it does
 * nothing unless `OPENBAO_ENABLED=true`.
 */
const OPENBAO_MODULE_TOKEN = 'OpenBaoKmsModule'

export class OpenBaoKmsModule implements Module {
  public readonly api = OpenBaoApi
  public readonly config: OpenBaoKmsConfig
  readonly #deploymentId?: string
  #service?: OpenBaoKeyManagementService

  public constructor(options: { config?: OpenBaoKmsConfig; deploymentId?: string } = {}) {
    this.config = options.config ?? getOpenBaoConfigFromEnv()
    setOpenBaoConfig(this.config)
    if (options.deploymentId) this.#deploymentId = options.deploymentId
  }

  public get enabled(): boolean {
    return this.config.enabled
  }

  public get writeEnabled(): boolean {
    return this.config.enabled && this.config.writeEnabled
  }

  public register(dependencyManager: DependencyManager) {
    // Registered before the early return so `agent.modules.openBao` is available even when OpenBao is disabled.
    dependencyManager.registerInstance(OPENBAO_MODULE_TOKEN, this)
    if (!this.enabled) return

    const kmsConfig = dependencyManager.resolve(CredoKms.KeyManagementModuleConfig)
    if (!kmsConfig.backends.some((backend) => backend.backend === OPENBAO_KMS_BACKEND)) {
      kmsConfig.registerBackend(this.service)
    }
  }

  /** Fail fast when OpenBao is enabled but sealed, uninitialised, or unreachable. */
  public async assertHealthy(): Promise<void> {
    if (!this.enabled || !this.config.healthCheck) return
    await this.service.assertHealthy()
  }

  /**
   * Drops cached public keys so the next read reflects OpenBao state. A key deleted out of band (an operator or another
   * replica) would otherwise stay readable from the cache and look usable for a few minutes.
   */
  public clearPublicKeyCache(): void {
    if (!this.enabled) return
    this.service.clearPublicKeyCache()
  }

  /**
   * Deletes every OpenBao key in a tenant's scope. Called before the tenant record is removed so a deleted tenant does
   * not leave undecryptable keys behind. In rollback mode (`OPENBAO_WRITE_ENABLED=false`) keys are intentionally kept.
   */
  public purgeTenant(tenantId: string): Promise<number> {
    if (!this.writeEnabled) return Promise.resolve(0)
    const service = this.service
    return service.purgeScope(service.scopeForCorrelationId(`tenant-${tenantId}`))
  }

  private get service(): OpenBaoKeyManagementService {
    this.#service ??= createService(this.config, this.#deploymentId)
    return this.#service
  }
}

/**
 * The `agent.modules.openBao` façade. Credo only exposes modules that declare an api class, and the tenant controller
 * needs to purge a tenant's keys before deleting the tenant.
 */
@injectable()
export class OpenBaoApi {
  public constructor(@inject(OPENBAO_MODULE_TOKEN) private readonly module: OpenBaoKmsModule) {}

  public get enabled(): boolean {
    return this.module.enabled
  }

  public get writeEnabled(): boolean {
    return this.module.writeEnabled
  }

  public async assertHealthy(): Promise<void> {
    await this.module.assertHealthy()
  }

  public clearPublicKeyCache(): void {
    this.module.clearPublicKeyCache()
  }

  public purgeTenant(tenantId: string): Promise<number> {
    return this.module.purgeTenant(tenantId)
  }
}
