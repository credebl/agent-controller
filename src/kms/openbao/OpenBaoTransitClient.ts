import type { ResolvedOpenBaoKmsConfig } from './OpenBaoKmsConfig'
import type { AxiosInstance } from 'axios'

import axios, { AxiosError } from 'axios'

import { OpenBaoHttpError, toSafeOpenBaoError } from './OpenBaoError'

type OpenBaoResponse<T> = { data: T }

export interface OpenBaoTransitKey {
  name: string
  type: string
  latest_version: number
  keys: Record<string, { public_key?: string } | number>
}

export class OpenBaoTransitClient {
  private readonly http: AxiosInstance
  private token?: string
  private tokenExpiresAt = 0
  private loginPromise?: Promise<string>

  public constructor(private readonly config: ResolvedOpenBaoKmsConfig) {
    this.token = config.token
    this.http = axios.create({
      baseURL: `${config.url}/v1`,
      timeout: 10_000,
      headers: config.namespace ? { 'X-Vault-Namespace': config.namespace } : undefined,
    })
  }

  public async createKey(name: string, type: 'ed25519' | 'ecdsa-p256') {
    await this.request('post', `/${this.config.transitMount}/keys/${encodeURIComponent(name)}`, {
      type,
      exportable: false,
      allow_plaintext_backup: false,
    })
  }

  public async readKey(name: string): Promise<OpenBaoTransitKey | null> {
    try {
      return await this.request<OpenBaoTransitKey>(
        'get',
        `/${this.config.transitMount}/keys/${encodeURIComponent(name)}`,
      )
    } catch (error) {
      if (error instanceof OpenBaoHttpError && error.status === 404) return null
      throw toSafeOpenBaoError(error)
    }
  }

  public async sign(name: string, input: Uint8Array, algorithm: 'EdDSA' | 'Ed25519' | 'ES256') {
    const body: Record<string, unknown> = { input: Buffer.from(input).toString('base64') }
    if (algorithm === 'ES256') {
      body.hash_algorithm = 'sha2-256'
      body.marshaling_algorithm = 'jws'
    }
    const result = await this.request<{ signature: string }>(
      'post',
      `/${this.config.transitMount}/sign/${encodeURIComponent(name)}`,
      body,
    )
    const encoded = result.signature.split(':').at(-1)
    if (!encoded) throw new Error('OpenBao returned an invalid signature')
    return new Uint8Array(Buffer.from(encoded, 'base64'))
  }

  public async verify(
    name: string,
    input: Uint8Array,
    signature: Uint8Array,
    algorithm: 'EdDSA' | 'Ed25519' | 'ES256',
    keyVersion: number,
  ) {
    const body: Record<string, unknown> = {
      input: Buffer.from(input).toString('base64'),
      signature: `vault:v${keyVersion}:${Buffer.from(signature).toString(algorithm === 'ES256' ? 'base64url' : 'base64')}`,
    }
    if (algorithm === 'ES256') {
      body.hash_algorithm = 'sha2-256'
      body.marshaling_algorithm = 'jws'
    }
    const result = await this.request<{ valid: boolean }>(
      'post',
      `/${this.config.transitMount}/verify/${encodeURIComponent(name)}`,
      body,
    )
    return result.valid
  }

  private async request<T>(method: 'get' | 'post', path: string, data?: unknown, retry = true): Promise<T> {
    const token = await this.getToken()
    try {
      const response = await this.http.request<OpenBaoResponse<T>>({
        method,
        url: path,
        data,
        headers: { 'X-Vault-Token': token },
      })
      return response.data.data
    } catch (error) {
      if (retry && this.config.appRole && error instanceof AxiosError && error.response?.status === 403) {
        this.token = undefined
        this.tokenExpiresAt = 0
        return this.request(method, path, data, false)
      }
      throw error
    }
  }

  private async getToken() {
    if (this.token && (!this.config.appRole || Date.now() < this.tokenExpiresAt)) return this.token
    if (!this.config.appRole) throw new Error('OpenBao token is not configured')
    if (!this.loginPromise) this.loginPromise = this.login().finally(() => (this.loginPromise = undefined))
    return this.loginPromise
  }

  private async login() {
    const { roleId, secretId, mountPath } = this.config.appRole!
    let response
    try {
      response = await this.http.post<{
        auth: { client_token: string; lease_duration: number }
      }>(`/auth/${mountPath}/login`, { role_id: roleId, secret_id: secretId })
    } catch (error) {
      throw toSafeOpenBaoError(error)
    }
    this.token = response.data.auth.client_token
    const refreshAfterSeconds = Math.max(1, Math.floor(response.data.auth.lease_duration * 0.8))
    this.tokenExpiresAt = Date.now() + refreshAfterSeconds * 1000
    return this.token
  }
}
