import 'reflect-metadata'

import type { JsonWebKey } from 'node:crypto'

import { encryptKeyImportEnvelope } from '../../../utils/keyImport/jwe'
import {
  agentBindingFor,
  createImportSession,
  resetImportSessions,
  type KeyImportMethod,
} from '../../../utils/keyImport/session'
import { x509ServiceT } from '../x509.service'

jest.mock('@credo-ts/askar', () => ({
  transformPrivateKeyToPrivateJwk: jest.fn(() => ({ privateJwk: { kty: 'EC', crv: 'P-256' } })),
  transformSeedToPrivateJwk: jest.fn(),
}))
jest.mock('@openwallet-foundation/askar-nodejs', () => ({ KeyAlgorithm: {} }))
jest.mock('@sovio-id/credo-openbao-kms', () => ({
  OPENBAO_KEY_ID_PREFIX: 'ob_',
  openBaoKeyId: (keyId: string) => keyId,
}))
jest.mock('../../../utils/kms/nodeKms', () => ({ NODE_KMS_BACKEND: 'node' }))
jest.mock('../../../utils/kms/backend', () => ({
  selectKmsBackendForCreate: jest.fn(),
  selectKmsBackendForJwk: jest.fn(() => ({ name: 'askar' })),
}))
jest.mock('../../../utils/helpers', () => ({
  generateSecretKey: jest.fn(),
  getCertificateValidityForSystem: jest.fn(),
  getTypeFromCurve: jest.fn(() => ({ kty: 'EC', crv: 'P-256' })),
}))
jest.mock('../crypto-util', () => ({ pemToRawPrivateKey: jest.fn(async () => 'aabbcc') }))

const mockPublicJwk = { publicKey: { kty: 'EC' }, equals: jest.fn(() => true) }
jest.mock('@credo-ts/core', () => ({
  injectable: () => (target: unknown) => target,
  TypedArrayEncoder: { fromHex: jest.fn(() => new Uint8Array([1])), fromUtf8String: jest.fn() },
  X509Certificate: class {},
  X509ExtendedKeyUsage: {},
  X509KeyUsage: {},
  X509ModuleConfig: class {},
  X509Service: { parseCertificate: jest.fn(() => ({ toString: () => 'cert', publicJwk: mockPublicJwk })) },
  Kms: {
    KeyManagementKeyExistsError: class KeyManagementKeyExistsError extends Error {},
    PublicJwk: { fromPublicJwk: jest.fn((jwk: unknown) => jwk) },
  },
}))

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'

function makeAgent(tenant = 'tenant-1') {
  return {
    context: { contextCorrelationId: tenant },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    kms: { importKey: jest.fn(async () => ({ keyId: 'kid-1', publicJwk: { kty: 'EC' } })) },
  }
}

async function encryptedKeyFor(agent: unknown, method: KeyImportMethod, payload: Record<string, unknown>) {
  const session = await createImportSession(method, agentBindingFor(agent))
  const jwe = encryptKeyImportEnvelope(
    session.publicKeyJwk as JsonWebKey,
    Buffer.from(JSON.stringify(payload)),
    session.protectedHeader,
  )
  return { sessionId: session.sessionId, jwe }
}

const run = (agent: ReturnType<typeof makeAgent>, options: Record<string, unknown>) =>
  x509ServiceT.ImportX509Certificates(
    { agent } as never,
    { certificate: 'cert', keyType: 'P-256', ...options } as never,
  )

describe('X.509 certificate import key material', () => {
  const originalFlag = process.env.ALLOW_PLAINTEXT_KEY_IMPORT

  beforeEach(() => {
    resetImportSessions()
    delete process.env.ALLOW_PLAINTEXT_KEY_IMPORT
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.ALLOW_PLAINTEXT_KEY_IMPORT
    else process.env.ALLOW_PLAINTEXT_KEY_IMPORT = originalFlag
  })

  it('rejects a plaintext private key unless the migration flag is enabled', async () => {
    const agent = makeAgent()

    await expect(run(agent, { privateKey: PRIVATE_KEY })).rejects.toThrow('Plaintext private key import is disabled')
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })

  it('accepts a plaintext private key when the migration flag is enabled', async () => {
    process.env.ALLOW_PLAINTEXT_KEY_IMPORT = 'true'
    const agent = makeAgent()

    await expect(run(agent, { privateKey: PRIVATE_KEY })).resolves.toMatchObject({ keyId: 'kid-1' })
  })

  it('rejects a request with neither privateKey nor encryptedKey', async () => {
    await expect(run(makeAgent(), {})).rejects.toThrow('privateKey or encryptedKey is required')
  })

  it('rejects encryptedKey together with a plaintext private key', async () => {
    process.env.ALLOW_PLAINTEXT_KEY_IMPORT = 'true'
    const agent = makeAgent()
    const encryptedKey = await encryptedKeyFor(agent, 'x509-certificate', { privateKey: PRIVATE_KEY })

    await expect(run(agent, { encryptedKey, privateKey: PRIVATE_KEY })).rejects.toThrow(
      'Provide either encryptedKey or plaintext key material, not both',
    )
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })

  it('imports the key from an encrypted envelope', async () => {
    const agent = makeAgent()
    const encryptedKey = await encryptedKeyFor(agent, 'x509-certificate', { privateKey: PRIVATE_KEY })

    await expect(run(agent, { encryptedKey })).resolves.toMatchObject({ keyId: 'kid-1', kmsBackend: 'askar' })
    expect(agent.kms.importKey).toHaveBeenCalledTimes(1)
  })

  it('rejects an envelope created for another method', async () => {
    const agent = makeAgent()
    const encryptedKey = await encryptedKeyFor(agent, 'x509', { privateKey: PRIVATE_KEY })

    await expect(run(agent, { encryptedKey })).rejects.toThrow('The key import session is invalid or has expired')
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })

  it('rejects an envelope created for another agent', async () => {
    const encryptedKey = await encryptedKeyFor(makeAgent('tenant-2'), 'x509-certificate', { privateKey: PRIVATE_KEY })

    await expect(run(makeAgent('tenant-1'), { encryptedKey })).rejects.toThrow('invalid or has expired')
  })

  it.each([
    ['privateKeyJwk', { privateKeyJwk: { kty: 'EC', crv: 'P-256', d: 'x' } }],
    ['passphrase', { privateKey: PRIVATE_KEY, passphrase: 'pw' }],
  ])('rejects %s inside the encrypted payload', async (_name, payload) => {
    const agent = makeAgent()
    const encryptedKey = await encryptedKeyFor(agent, 'x509-certificate', payload)

    await expect(run(agent, { encryptedKey })).rejects.toThrow('Only privateKey is supported')
    expect(agent.kms.importKey).not.toHaveBeenCalled()
  })
})
