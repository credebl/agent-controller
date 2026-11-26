jest.mock('../../../../utils/kms/backend', () => ({
  ASKAR_KMS_BACKEND: 'askar',
  NODE_KMS_BACKEND: 'node',
  selectKmsBackendForCreate: (type: { kty: string; crv?: string }) =>
    type.kty === 'RSA' || (type.kty === 'EC' && type.crv === 'P-521')
      ? { backend: 'node', name: 'node' }
      : { name: 'askar' },
}))

import {
  BINDING_ERROR_CODES,
  BindingValidationError,
  normalizeCredentialBinding,
  requiredBackendForAlgorithm,
  selectFreshKeyDidMethod,
  selectFreshKeySignatureAlgorithm,
} from '../credentialBindingOptions'

const issuer = {
  supportedDidMethods: ['did:key', 'did:web', 'did:jwk'],
  supportsAllDidMethods: false,
  supportsJwk: true,
  credentialFormat: 'dc+sd-jwt',
}

describe('normalizeCredentialBinding', () => {
  it('defaults to a fresh key with require, preserving the flat legacy fields', () => {
    expect(normalizeCredentialBinding({})).toEqual({ mode: 'new-key', policy: 'require' })
    expect(normalizeCredentialBinding({ bindingPolicy: 'prefer' })).toEqual({ mode: 'new-key', policy: 'prefer' })
    expect(normalizeCredentialBinding({ holderDidUrl: 'did:web:example.com#key-1', bindingPolicy: 'prefer' })).toEqual({
      mode: 'existing-did',
      holderDidUrl: 'did:web:example.com#key-1',
      policy: 'prefer',
    })
  })

  it('accepts a nested fresh-key selection and an explicit proof algorithm (P-FK-02, P-FK-03, P-FK-04, P-FK-05)', () => {
    expect(
      normalizeCredentialBinding({
        binding: { mode: 'new-key', didMethod: 'did:key', signatureAlgorithm: 'EdDSA' },
      }),
    ).toEqual({ mode: 'new-key', policy: 'require', didMethod: 'did:key', signatureAlgorithm: 'EdDSA' })
    expect(
      normalizeCredentialBinding({
        binding: { mode: 'new-key', didMethod: 'did:jwk', signatureAlgorithm: 'ES256' },
      }),
    ).toEqual({ mode: 'new-key', policy: 'require', didMethod: 'did:jwk', signatureAlgorithm: 'ES256' })
    expect(
      normalizeCredentialBinding({
        binding: { mode: 'new-key', didMethod: 'did:jwk', signatureAlgorithm: 'RS256' },
      }),
    ).toEqual({ mode: 'new-key', policy: 'require', didMethod: 'did:jwk', signatureAlgorithm: 'RS256' })
    expect(normalizeCredentialBinding({ binding: { mode: 'new-key' } })).toEqual({
      mode: 'new-key',
      policy: 'require',
    })
  })

  it('accepts a nested existing-DID selection and agrees with a matching flat DID (P-ED-02)', () => {
    const holderDidUrl = 'did:web:example.com#key-1'
    expect(normalizeCredentialBinding({ binding: { mode: 'existing-did', holderDidUrl } })).toEqual({
      mode: 'existing-did',
      holderDidUrl,
      policy: 'require',
    })
    expect(normalizeCredentialBinding({ holderDidUrl, binding: { mode: 'existing-did', holderDidUrl } })).toEqual({
      mode: 'existing-did',
      holderDidUrl,
      policy: 'require',
    })
  })

  it('rejects an unknown binding mode with 400 INVALID_BINDING_MODE (N-V-01)', () => {
    expect(() => normalizeCredentialBinding({ binding: { mode: 'bogus' } as any })).toThrow(
      BINDING_ERROR_CODES.INVALID_BINDING_MODE,
    )
    try {
      normalizeCredentialBinding({ binding: { mode: 'bogus' } as any })
    } catch (error) {
      expect(error).toBeInstanceOf(BindingValidationError)
      expect((error as BindingValidationError).statusCode).toBe(400)
      expect((error as BindingValidationError).code).toBe(BINDING_ERROR_CODES.INVALID_BINDING_MODE)
    }
  })

  it('rejects existing-did without a DID (N-V-02) and conflicting flat/nested DIDs (N-V-03)', () => {
    expect(() => normalizeCredentialBinding({ binding: { mode: 'existing-did' } })).toThrow(
      BINDING_ERROR_CODES.MISSING_HOLDER_DID_URL,
    )
    expect(() =>
      normalizeCredentialBinding({
        holderDidUrl: 'did:web:one.example.com#key-1',
        binding: { mode: 'existing-did', holderDidUrl: 'did:web:two.example.com#key-1' },
      }),
    ).toThrow(BINDING_ERROR_CODES.CONFLICTING_HOLDER_DID_URL)
    expect(() =>
      normalizeCredentialBinding({
        bindingPolicy: 'require',
        binding: { mode: 'existing-did', holderDidUrl: 'did:web:example.com#key-1', policy: 'prefer' },
      }),
    ).toThrow(BINDING_ERROR_CODES.INVALID_BINDING_MODE)
  })

  it('rejects fresh-key-only fields in existing-did mode (N-V-04, N-V-05)', () => {
    const holderDidUrl = 'did:web:example.com#key-1'
    expect(() =>
      normalizeCredentialBinding({ binding: { mode: 'existing-did', holderDidUrl, didMethod: 'did:key' } }),
    ).toThrow(BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD)
    expect(() =>
      normalizeCredentialBinding({ binding: { mode: 'existing-did', holderDidUrl, signatureAlgorithm: 'ES256' } }),
    ).toThrow(BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM)
  })

  it('rejects a DID in new-key mode, flat or nested (N-V-06)', () => {
    expect(() =>
      normalizeCredentialBinding({
        holderDidUrl: 'did:web:example.com#key-1',
        binding: { mode: 'new-key' },
      }),
    ).toThrow(BINDING_ERROR_CODES.CONFLICTING_HOLDER_DID_URL)
    expect(() =>
      normalizeCredentialBinding({
        binding: { mode: 'new-key', holderDidUrl: 'did:web:example.com#key-1' },
      }),
    ).toThrow(BINDING_ERROR_CODES.CONFLICTING_HOLDER_DID_URL)
  })

  it('rejects unsupported DID methods and algorithms up front (N-V-07, N-V-08)', () => {
    expect(() => normalizeCredentialBinding({ binding: { mode: 'new-key', didMethod: 'did:web' } })).toThrow(
      BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
    )
    expect(() => normalizeCredentialBinding({ binding: { mode: 'new-key', didMethod: 'key' } })).not.toThrow()
    expect(() => normalizeCredentialBinding({ binding: { mode: 'new-key', signatureAlgorithm: 'HS256' } })).toThrow(
      BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM,
    )
  })
})

describe('selectFreshKeyDidMethod', () => {
  it('prefers did:jwk, then did:key, then plain JWK (P-FK-07, P-FK-08)', () => {
    expect(selectFreshKeyDidMethod({ ...issuer, supportsAllDidMethods: true })).toBe('did:jwk')
    expect(selectFreshKeyDidMethod({ ...issuer, supportedDidMethods: ['did:key'] })).toBe('did:key')
    expect(selectFreshKeyDidMethod({ ...issuer, supportedDidMethods: [], supportsJwk: true })).toBeUndefined()
  })

  it('defaults to did:key when the issuer advertises no binding methods (P-FK-09)', () => {
    expect(
      selectFreshKeyDidMethod({
        ...issuer,
        supportedDidMethods: undefined,
        supportsJwk: false,
        credentialFormat: 'vc+sd-jwt',
      }),
    ).toBe('did:key')
  })

  it('keeps mso_mdoc on plain JWK and rejects DID methods for it', () => {
    expect(
      selectFreshKeyDidMethod({ ...issuer, supportedDidMethods: [], credentialFormat: 'mso_mdoc' }),
    ).toBeUndefined()
    expect(() =>
      selectFreshKeyDidMethod({
        ...issuer,
        didMethod: 'did:jwk',
        supportedDidMethods: [],
        credentialFormat: 'mso_mdoc',
      }),
    ).toThrow(BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT)
  })

  it('rejects plain JWK for ldp_vc and methods the issuer does not support (N-V-07, N-V-11)', () => {
    expect(() => selectFreshKeyDidMethod({ ...issuer, supportedDidMethods: [], credentialFormat: 'ldp_vc' })).toThrow(
      BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD,
    )
    expect(() =>
      selectFreshKeyDidMethod({ ...issuer, didMethod: 'did:web', supportedDidMethods: ['did:key'] }),
    ).toThrow(BINDING_ERROR_CODES.UNSUPPORTED_DID_METHOD)
  })
})

describe('selectFreshKeySignatureAlgorithm', () => {
  it('prefers EdDSA over RS256 and keeps RSA/PS256 supported (P-FK-01, P-FK-05)', () => {
    expect(
      selectFreshKeySignatureAlgorithm({ algorithms: ['ES256', 'EdDSA', 'RS256'], availableBackends: ['askar'] }),
    ).toBe('EdDSA')
    expect(requiredBackendForAlgorithm('RS256')).toBe('node')
    expect(
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'RS256',
        algorithms: ['ES256', 'EdDSA', 'RS256'],
        didMethod: 'did:jwk',
        availableBackends: ['askar', 'node'],
      }),
    ).toBe('RS256')
  })

  it('honours an explicit algorithm and detects incompatible DID methods (P-FK-03, P-FK-04, N-V-09)', () => {
    expect(
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'EdDSA',
        algorithms: ['EdDSA', 'ES256'],
        didMethod: 'did:key',
        availableBackends: ['askar'],
      }),
    ).toBe('EdDSA')
    expect(
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'ES256',
        algorithms: ['EdDSA', 'ES256'],
        didMethod: 'did:jwk',
        availableBackends: ['askar'],
      }),
    ).toBe('ES256')
    expect(() =>
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'RS256',
        algorithms: ['EdDSA', 'RS256'],
        didMethod: 'did:key',
        availableBackends: ['askar', 'node'],
      }),
    ).toThrow(BINDING_ERROR_CODES.INCOMPATIBLE_DID_METHOD_AND_ALGORITHM)
  })

  it('rejects an algorithm the issuer does not accept (N-V-08)', () => {
    expect(() =>
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'ES512',
        algorithms: ['ES256', 'EdDSA'],
        availableBackends: ['askar', 'node'],
      }),
    ).toThrow(BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM)
  })

  it('fails without silent downgrade when no backend can create the selected algorithm (N-R-01, N-R-02)', () => {
    expect(() =>
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'RS256',
        algorithms: ['RS256'],
        availableBackends: ['askar'],
      }),
    ).toThrow(BindingValidationError)
    try {
      selectFreshKeySignatureAlgorithm({
        signatureAlgorithm: 'RS256',
        algorithms: ['RS256'],
        availableBackends: ['askar'],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(BindingValidationError)
      expect((error as BindingValidationError).statusCode).toBe(400)
      expect((error as BindingValidationError).code).toBe(BINDING_ERROR_CODES.KEY_CREATION_FAILED)
    }
    // Implicit selection skips algorithms the wallet cannot create instead of crashing later
    expect(selectFreshKeySignatureAlgorithm({ algorithms: ['RS256', 'EdDSA'], availableBackends: ['askar'] })).toBe(
      'EdDSA',
    )
  })
})
