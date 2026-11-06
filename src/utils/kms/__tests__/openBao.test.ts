// The plug-in and Credo ship as ESM; these tests exercise the local config and backend-selection helpers only.
jest.mock('@credo-ts/core', () => ({
  inject: () => () => undefined,
  injectable: () => (target: unknown) => target,
  Kms: { KeyManagementModuleConfig: class {} },
}))

jest.mock('@credebl/credo-ts-openbao', () => ({
  AppRoleAuth: class {},
  FetchOpenBaoClient: class {},
  OpenBaoKeyManagementService: class {},
  StaticTokenAuth: class {},
  openBaoKeyId: (keyId: string) => (keyId.startsWith('ob_') ? keyId : `ob_${keyId}`),
}))

import {
  OPENBAO_KMS_BACKEND,
  getOpenBaoConfigFromEnv,
  isOpenBaoEnabled,
  isOpenBaoWriteEnabled,
  openBaoBackendForCreate,
  openBaoBackendForDidMethod,
  openBaoBackendForJwk,
} from '../openBao'

const OPENBAO_ENV = [
  'OPENBAO_ENABLED',
  'OPENBAO_WRITE_ENABLED',
  'OPENBAO_ADDRESS',
  'OPENBAO_TOKEN',
  'OPENBAO_ROLE_ID',
  'OPENBAO_SECRET_ID',
  'OPENBAO_SECRET_ID_FILE',
  'OPENBAO_AUTH_MOUNT',
  'OPENBAO_NAMESPACE',
  'OPENBAO_TRANSIT_MOUNT',
  'OPENBAO_KV_MOUNT',
  'OPENBAO_DEPLOYMENT_ID',
  'OPENBAO_TIMEOUT_MS',
  'OPENBAO_HEALTH_CHECK',
  'OPENBAO_DID_KEY_ENABLED',
  'OPENBAO_DID_WEB_ENABLED',
]

describe('OpenBao KMS configuration', () => {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original }
    for (const name of OPENBAO_ENV) delete process.env[name]
  })

  afterAll(() => {
    process.env = original
  })

  it('is disabled and read-only by default', () => {
    const config = getOpenBaoConfigFromEnv()

    expect(config).toMatchObject({
      enabled: false,
      writeEnabled: true,
      authMount: 'approle',
      transitMount: 'transit',
      timeoutMs: 10_000,
      healthCheck: true,
      didKeyEnabled: false,
      didWebEnabled: false,
    })
    expect(isOpenBaoEnabled()).toBe(false)
    expect(isOpenBaoWriteEnabled()).toBe(false)
  })

  it('parses AppRole, Transit and opt-in DID settings from the environment', () => {
    process.env.OPENBAO_ENABLED = 'true'
    process.env.OPENBAO_WRITE_ENABLED = 'false'
    process.env.OPENBAO_ADDRESS = 'https://bao.example.com:8200'
    process.env.OPENBAO_ROLE_ID = 'role'
    process.env.OPENBAO_SECRET_ID_FILE = '/run/secrets/openbao-secret-id'
    process.env.OPENBAO_AUTH_MOUNT = 'custom-approle'
    process.env.OPENBAO_NAMESPACE = 'credebl'
    process.env.OPENBAO_TRANSIT_MOUNT = 'custom-transit'
    process.env.OPENBAO_KV_MOUNT = 'kv'
    process.env.OPENBAO_DEPLOYMENT_ID = 'wallet-1'
    process.env.OPENBAO_TIMEOUT_MS = '2500'
    process.env.OPENBAO_HEALTH_CHECK = 'false'
    process.env.OPENBAO_DID_KEY_ENABLED = 'true'
    process.env.OPENBAO_DID_WEB_ENABLED = 'yes'

    expect(getOpenBaoConfigFromEnv()).toEqual({
      enabled: true,
      writeEnabled: false,
      address: 'https://bao.example.com:8200',
      roleId: 'role',
      secretIdFile: '/run/secrets/openbao-secret-id',
      authMount: 'custom-approle',
      namespace: 'credebl',
      transitMount: 'custom-transit',
      kvMount: 'kv',
      deploymentId: 'wallet-1',
      timeoutMs: 2500,
      healthCheck: false,
      didKeyEnabled: true,
      didWebEnabled: true,
    })
  })
})

describe('OpenBao backend selection', () => {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original }
    for (const name of OPENBAO_ENV) delete process.env[name]
  })

  afterAll(() => {
    process.env = original
  })

  function enableOpenBao(writeEnabled = true) {
    process.env.OPENBAO_ENABLED = 'true'
    process.env.OPENBAO_WRITE_ENABLED = writeEnabled ? 'true' : 'false'
  }

  it('never routes keys to OpenBao while it is disabled', () => {
    expect(openBaoBackendForCreate({ kty: 'OKP', crv: 'Ed25519' })).toBeUndefined()
    expect(openBaoBackendForJwk({ kty: 'OKP', crv: 'Ed25519' })).toBeUndefined()
    expect(openBaoBackendForDidMethod('key')).toBeUndefined()
  })

  it.each([
    [{ kty: 'OKP', crv: 'Ed25519' }],
    [{ kty: 'EC', crv: 'P-256' }],
    [{ kty: 'EC', crv: 'P-384' }],
    [{ kty: 'EC', crv: 'P-521' }],
    [{ kty: 'RSA', modulusLength: 2048 }],
  ] as const)('routes %j to OpenBao Transit', (type) => {
    enableOpenBao()

    expect(openBaoBackendForCreate(type)).toBe(OPENBAO_KMS_BACKEND)
    expect(openBaoBackendForJwk(type)).toBe(OPENBAO_KMS_BACKEND)
  })

  it.each([[{ kty: 'OKP', crv: 'X25519' }], [{ kty: 'EC', crv: 'secp256k1' }]] as const)(
    'keeps %j in Askar',
    (type) => {
      enableOpenBao()

      expect(openBaoBackendForCreate(type)).toBeUndefined()
      expect(openBaoBackendForJwk(type)).toBeUndefined()
    },
  )

  it('stops creating keys in rollback mode but keeps the backend registered', () => {
    enableOpenBao(false)

    expect(isOpenBaoEnabled()).toBe(true)
    expect(isOpenBaoWriteEnabled()).toBe(false)
    expect(openBaoBackendForCreate({ kty: 'OKP', crv: 'Ed25519' })).toBeUndefined()
    expect(openBaoBackendForJwk({ kty: 'OKP', crv: 'Ed25519' })).toBeUndefined()
  })

  it('routes did:key and did:web only when explicitly opted in', () => {
    enableOpenBao()

    expect(openBaoBackendForDidMethod('key')).toBeUndefined()
    expect(openBaoBackendForDidMethod('web')).toBeUndefined()

    process.env.OPENBAO_DID_KEY_ENABLED = 'true'
    process.env.OPENBAO_DID_WEB_ENABLED = 'true'

    expect(openBaoBackendForDidMethod('key')).toBe(OPENBAO_KMS_BACKEND)
    expect(openBaoBackendForDidMethod('web')).toBe(OPENBAO_KMS_BACKEND)
  })
})
