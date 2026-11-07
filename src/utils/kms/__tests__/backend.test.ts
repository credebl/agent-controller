jest.mock('../openBao', () => ({
  OPENBAO_KMS_BACKEND: 'openbao',
  openBaoBackendForCreate: jest.fn(),
  openBaoBackendForJwk: jest.fn(),
}))

import {
  ASKAR_KMS_BACKEND,
  NODE_KMS_BACKEND,
  needsNodeKms,
  selectKmsBackendForCreate,
  selectKmsBackendForJwk,
} from '../backend'
import { openBaoBackendForCreate, openBaoBackendForJwk } from '../openBao'

const mockOpenBaoCreate = openBaoBackendForCreate as jest.Mock
const mockOpenBaoJwk = openBaoBackendForJwk as jest.Mock

describe('KMS backend selection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockOpenBaoCreate.mockReturnValue(undefined)
    mockOpenBaoJwk.mockReturnValue(undefined)
  })

  it('routes RSA and EC P-521 to the Node KMS', () => {
    expect(needsNodeKms({ kty: 'RSA' })).toBe(true)
    expect(needsNodeKms({ kty: 'EC', crv: 'P-521' })).toBe(true)
    expect(needsNodeKms({ kty: 'EC', crv: 'P-256' })).toBe(false)
    expect(needsNodeKms({ kty: 'OKP', crv: 'Ed25519' })).toBe(false)
  })

  it('uses OpenBao when it supports the key type', () => {
    mockOpenBaoCreate.mockReturnValue('openbao')

    expect(selectKmsBackendForCreate({ kty: 'EC', crv: 'P-256' })).toEqual({
      backend: 'openbao',
      name: 'openbao',
    })
  })

  it('uses the Node KMS when OpenBao is disabled and Askar cannot handle the key', () => {
    expect(selectKmsBackendForCreate({ kty: 'RSA' })).toEqual({ backend: NODE_KMS_BACKEND, name: 'node' })
    expect(selectKmsBackendForJwk({ kty: 'EC', crv: 'P-521' })).toEqual({ backend: NODE_KMS_BACKEND, name: 'node' })
  })

  it('defaults to Askar with no explicit backend', () => {
    expect(selectKmsBackendForCreate({ kty: 'EC', crv: 'P-256' })).toEqual({ name: ASKAR_KMS_BACKEND })
    expect(selectKmsBackendForJwk({ kty: 'OKP', crv: 'Ed25519' })).toEqual({ name: ASKAR_KMS_BACKEND })
  })
})
