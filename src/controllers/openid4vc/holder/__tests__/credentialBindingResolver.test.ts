import { selectKmsBackendForCreate } from '../../../../utils/kms/backend'
import { BINDING_ERROR_CODES } from '../credentialBindingOptions'
import {
  HolderBindingMismatchError,
  HolderBindingNotSupportedError,
  assertOfferAcceptsHolderDid,
  assertOfferAcceptsNewKeyBinding,
  assertW3cCredentialsBoundToHolderDid,
  getCredentialBindingResolver,
} from '../credentialBindingResolver'

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbols the resolver touches are stubbed.
jest.mock('../../../../utils/kms/backend', () => ({
  ASKAR_KMS_BACKEND: 'askar',
  NODE_KMS_BACKEND: 'node',
  selectKmsBackendForCreate: jest.fn((type: { kty: string; crv?: string }) =>
    type.kty === 'RSA' || (type.kty === 'EC' && type.crv === 'P-521')
      ? { backend: 'node', name: 'node' }
      : { name: 'askar' },
  ),
}))
jest.mock('@credo-ts/core', () => {
  const parseDid = (didUrl: string) => {
    if (!didUrl.startsWith('did:')) throw new Error(`Error parsing did '${didUrl}'`)
    const [did, fragment] = didUrl.split('#')
    return { did, method: did.split(':')[1], fragment, didUrl }
  }
  class W3cCredentialRecord {
    public constructor(public firstCredential: { credentialSubjectIds: string[] }) {}
  }
  return {
    W3cCredentialRecord,
    tryParseDid: (didUrl: string) => (didUrl.startsWith('did:') ? parseDid(didUrl) : undefined),
    DidsApi: 'DidsApi',
    Kms: {
      KeyManagementApi: 'KeyManagementApi',
      PublicJwk: { fromUnknown: (jwk: object) => jwk },
    },
    DidJwk: { fromDid: (did: string) => ({ verificationMethodId: `${did}#0` }) },
    DidKey: { fromDid: (did: string) => ({ did, publicJwk: { fingerprint: 'z6Mk' } }) },
    parseDid,
    getPublicJwkFromVerificationMethod: (vm: { type: string }) => ({
      supportedSignatureAlgorithms: vm.type === 'Ed25519VerificationKey2018' ? ['EdDSA', 'Ed25519'] : ['ES256'],
    }),
  }
})
jest.mock('@credo-ts/openid4vc', () => ({
  OpenId4VciCredentialFormatProfile: {
    SdJwtVc: 'vc+sd-jwt',
    SdJwtDc: 'dc+sd-jwt',
    JwtVcJsonLd: 'jwt_vc_json-ld',
    JwtVcJson: 'jwt_vc_json',
    LdpVc: 'ldp_vc',
    MsoMdoc: 'mso_mdoc',
  },
}))

const WALLET_DID = 'did:web:wallet.example.com'
const WALLET_KEY = `${WALLET_DID}#key-1`

const walletDidDocument = {
  id: WALLET_DID,
  authentication: ['#key-1'],
  dereferenceKey: (keyId: string) => {
    if (keyId !== '#key-1' && keyId !== WALLET_KEY) throw new Error('not found')
    return { id: '#key-1', type: 'Ed25519VerificationKey2018' }
  },
}

function setup(issuer: {
  supportedDidMethods?: string[]
  supportsAllDidMethods?: boolean
  supportsJwk?: boolean
  algorithms?: string[]
  credentialFormat?: string
  availableBackends?: string[]
  failDidCreation?: boolean
}) {
  const kms = {
    createKeyForSignatureAlgorithm: jest.fn().mockResolvedValue({ publicJwk: { keyId: 'new-key' } }),
    supportedBackendsForOperation: jest.fn(() => issuer.availableBackends ?? ['askar', 'node']),
  }
  const dids = {
    resolveCreatedDidDocumentWithKeys: jest.fn(async (did: string) => {
      if (did !== WALLET_DID) throw new Error(`Created did '${did}' not found`)
      return { didDocument: walletDidDocument, keys: [] }
    }),
    create: jest.fn(async ({ method }: { method: string }) => {
      if (issuer.failDidCreation) throw new Error('DID creation failed.')
      return { didState: { state: 'finished', did: `did:${method}:new` } }
    }),
  }
  const agentContext = {
    resolve: (token: string) => (token === 'DidsApi' ? dids : kms),
    dependencyManager: { resolve: () => dids },
    config: { logger: { warn: jest.fn() } },
  }
  const options = {
    agentContext,
    supportedDidMethods: issuer.supportedDidMethods,
    supportsAllDidMethods: issuer.supportsAllDidMethods ?? false,
    supportsJwk: issuer.supportsJwk ?? false,
    issuerMaxBatchSize: 1,
    credentialFormat: issuer.credentialFormat ?? 'dc+sd-jwt',
    proofTypes: { jwt: { supportedSignatureAlgorithms: issuer.algorithms ?? ['ES256', 'EdDSA'] } },
  } as any
  return { options, kms, dids }
}

// CREDEBL dev issuer: SD-JWT allows did:key/web/jwk and jwk; ldp_vc allows did:key only
const sdJwtIssuer = { supportedDidMethods: ['did:key', 'did:web', 'did:jwk'], supportsJwk: true }

describe('getCredentialBindingResolver', () => {
  describe('with holderDidUrl', () => {
    it('binds to the given verification method without creating a key', async () => {
      const { options, kms, dids } = setup(sdJwtIssuer)

      const binding = await getCredentialBindingResolver({ holderDidUrl: WALLET_KEY })(options)

      expect(binding).toEqual({ method: 'did', didUrls: [WALLET_KEY] })
      expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
      expect(dids.create).not.toHaveBeenCalled()
    })

    it('resolves a bare DID to its first authentication key', async () => {
      const { options } = setup(sdJwtIssuer)

      const binding = await getCredentialBindingResolver({ holderDidUrl: WALLET_DID })(options)

      expect(binding).toEqual({ method: 'did', didUrls: [WALLET_KEY] })
    })

    it('accepts any DID method when the issuer supports all of them', async () => {
      const { options } = setup({ supportedDidMethods: [], supportsAllDidMethods: true })

      const binding = await getCredentialBindingResolver({ holderDidUrl: WALLET_KEY })(options)

      expect(binding).toEqual({ method: 'did', didUrls: [WALLET_KEY] })
    })

    it('fails with require when the issuer does not support the DID method', async () => {
      const { options, kms } = setup({ supportedDidMethods: ['did:key'], credentialFormat: 'ldp_vc' })

      const resolve = getCredentialBindingResolver({ holderDidUrl: WALLET_KEY, bindingPolicy: 'require' })(options)

      await expect(resolve).rejects.toThrow(HolderBindingNotSupportedError)
      await expect(resolve).rejects.toThrow(/does not support did:web/)
      expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
    })

    it('defaults to require', async () => {
      const { options } = setup({ supportedDidMethods: ['did:key'] })

      await expect(getCredentialBindingResolver({ holderDidUrl: WALLET_KEY })(options)).rejects.toThrow(
        HolderBindingNotSupportedError,
      )
    })

    it('falls back to a new key with prefer when the issuer does not support the DID method', async () => {
      const { options, kms } = setup({ supportedDidMethods: ['did:key'], credentialFormat: 'ldp_vc' })

      const binding = await getCredentialBindingResolver({ holderDidUrl: WALLET_KEY, bindingPolicy: 'prefer' })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:key:new#z6Mk'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'EdDSA' })
      expect(options.agentContext.config.logger.warn).toHaveBeenCalled()
    })

    it('fails with require when the issuer does not accept the key algorithm', async () => {
      const { options } = setup({ ...sdJwtIssuer, algorithms: ['ES256'] })

      await expect(
        getCredentialBindingResolver({ holderDidUrl: WALLET_KEY, bindingPolicy: 'require' })(options),
      ).rejects.toThrow(/signs with EdDSA, Ed25519, but the issuer accepts ES256/)
    })

    it('falls back to a new key with prefer when the issuer does not accept the key algorithm', async () => {
      const { options } = setup({ ...sdJwtIssuer, algorithms: ['ES256'] })

      const binding = await getCredentialBindingResolver({ holderDidUrl: WALLET_KEY, bindingPolicy: 'prefer' })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
    })

    it('fails with require for mso_mdoc', async () => {
      const { options } = setup({ ...sdJwtIssuer, credentialFormat: 'mso_mdoc' })

      await expect(getCredentialBindingResolver({ holderDidUrl: WALLET_KEY })(options)).rejects.toThrow(
        BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT,
      )
    })

    it('rejects mso_mdoc even with prefer (N-V-10)', async () => {
      const { options } = setup({ ...sdJwtIssuer, credentialFormat: 'mso_mdoc' })

      await expect(
        getCredentialBindingResolver({ holderDidUrl: WALLET_KEY, bindingPolicy: 'prefer' })(options),
      ).rejects.toThrow(BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT)
    })

    it('fails even with prefer when the DID was not created in this wallet', async () => {
      const { options, kms } = setup(sdJwtIssuer)

      const resolve = getCredentialBindingResolver({
        holderDidUrl: 'did:web:example.com#key-1',
        bindingPolicy: 'prefer',
      })(options)

      await expect(resolve).rejects.toThrow(/was not created in this wallet/)
      await expect(resolve).rejects.not.toThrow(HolderBindingNotSupportedError)
      expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
    })

    it('answers a malformed holder DID URL with a bad request', async () => {
      const { options } = setup(sdJwtIssuer)

      await expect(
        getCredentialBindingResolver({ holderDidUrl: 'not-a-did', bindingPolicy: 'prefer' })(options),
      ).rejects.toThrow(/is not a valid DID or DID URL/)
    })

    it('fails even with prefer when the verification method is not in the DID document', async () => {
      const { options } = setup(sdJwtIssuer)

      await expect(
        getCredentialBindingResolver({ holderDidUrl: `${WALLET_DID}#key-2`, bindingPolicy: 'prefer' })(options),
      ).rejects.toThrow(BINDING_ERROR_CODES.DID_NOT_CONTROLLED_BY_HOLDER_TENANT)
    })
  })

  describe('without holderDidUrl', () => {
    it('creates a new did:jwk key with the preferred issuer algorithm', async () => {
      const { options, kms, dids } = setup(sdJwtIssuer)

      const binding = await getCredentialBindingResolver({ requestBatch: false })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'EdDSA' })
      expect(dids.create).toHaveBeenCalledWith({ method: 'jwk', options: { keyId: 'new-key' } })
      expect(dids.resolveCreatedDidDocumentWithKeys).not.toHaveBeenCalled()
    })

    it('creates a new did:key when the issuer only supports did:key', async () => {
      const { options } = setup({ supportedDidMethods: ['did:key'], credentialFormat: 'ldp_vc' })

      const binding = await getCredentialBindingResolver({})(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:key:new#z6Mk'] })
    })

    it('uses a plain jwk when the issuer supports no DID method', async () => {
      const { options } = setup({ supportedDidMethods: [], supportsJwk: true })

      const binding = await getCredentialBindingResolver({})(options)

      expect(binding).toEqual({ method: 'jwk', keys: [{ keyId: 'new-key' }] })
    })

    it('selects EdDSA instead of crashing on RS256 with only Askar registered (P-FK-01)', async () => {
      const { options, kms } = setup({
        ...sdJwtIssuer,
        algorithms: ['ES256', 'EdDSA', 'RS256'],
        availableBackends: ['askar'],
      })

      await expect(getCredentialBindingResolver({})(options)).resolves.toEqual({
        method: 'did',
        didUrls: ['did:jwk:new#0'],
      })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'EdDSA' })
    })

    it('creates an Ed25519 did:key for did:key + EdDSA (P-FK-03)', async () => {
      const { options, kms, dids } = setup({ supportedDidMethods: ['did:key'], credentialFormat: 'ldp_vc' })

      const binding = await getCredentialBindingResolver({
        didMethod: 'did:key',
        signatureAlgorithm: 'EdDSA',
      })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:key:new#z6Mk'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'EdDSA' })
      expect(dids.create).toHaveBeenCalledWith({ method: 'key', options: { keyId: 'new-key' } })
    })

    it('creates a P-256 did:jwk for did:jwk + ES256 (P-FK-04)', async () => {
      const { options, kms, dids } = setup(sdJwtIssuer)

      const binding = await getCredentialBindingResolver({
        didMethod: 'did:jwk',
        signatureAlgorithm: 'ES256',
      })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256' })
      expect(dids.create).toHaveBeenCalledWith({ method: 'jwk', options: { keyId: 'new-key' } })
    })

    it('creates an RSA key in the Node KMS for did:jwk + RS256 (P-FK-05)', async () => {
      const { options, kms } = setup({
        ...sdJwtIssuer,
        algorithms: ['ES256', 'EdDSA', 'RS256'],
        availableBackends: ['askar', 'node'],
      })

      await expect(
        getCredentialBindingResolver({ didMethod: 'did:jwk', signatureAlgorithm: 'RS256' })(options),
      ).resolves.toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'RS256', backend: 'node' })
    })

    it('uses the OpenBao backend when it is configured and supports the key (P-FK-15)', async () => {
      const { options, kms } = setup({ ...sdJwtIssuer, availableBackends: ['askar', 'node', 'openbao'] })
      const selectBackend = jest.mocked(selectKmsBackendForCreate)
      const defaultImplementation = selectBackend.getMockImplementation()
      selectBackend.mockImplementation(() => ({ backend: 'openbao', name: 'openbao' }) as any)
      try {
        await expect(
          getCredentialBindingResolver({ didMethod: 'did:jwk', signatureAlgorithm: 'EdDSA' })(options),
        ).resolves.toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
        expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'EdDSA', backend: 'openbao' })
      } finally {
        selectBackend.mockImplementation(defaultImplementation!)
      }
    })

    it('selects the DID method automatically when only a signature algorithm is given (P-FK-06)', async () => {
      const { options } = setup({ ...sdJwtIssuer, supportedDidMethods: ['did:key'] })

      await expect(getCredentialBindingResolver({ signatureAlgorithm: 'EdDSA' })(options)).resolves.toEqual({
        method: 'did',
        didUrls: ['did:key:new#z6Mk'],
      })
    })

    it('binds mso_mdoc with a fresh JWK and ES256 (P-FK-13)', async () => {
      const { options, kms } = setup({
        supportedDidMethods: [],
        supportsJwk: true,
        algorithms: ['ES256'],
        credentialFormat: 'mso_mdoc',
      })

      await expect(getCredentialBindingResolver({ signatureAlgorithm: 'ES256' })(options)).resolves.toEqual({
        method: 'jwk',
        keys: [{ keyId: 'new-key' }],
      })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256' })
    })

    it('binds ldp_vc to a fresh did:key with EdDSA (P-FK-14)', async () => {
      const { options } = setup({
        supportedDidMethods: ['did:key'],
        algorithms: ['EdDSA'],
        credentialFormat: 'ldp_vc',
      })

      await expect(
        getCredentialBindingResolver({ didMethod: 'did:key', signatureAlgorithm: 'EdDSA' })(options),
      ).resolves.toEqual({ method: 'did', didUrls: ['did:key:new#z6Mk'] })
    })

    it('rejects an unsupported fresh-key algorithm before creating a key (N-V-08)', async () => {
      const { options, kms } = setup({ ...sdJwtIssuer, algorithms: ['ES256'] })

      await expect(
        getCredentialBindingResolver({ didMethod: 'did:jwk', signatureAlgorithm: 'RS256' })(options),
      ).rejects.toThrow(BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM)
      expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
    })

    it('rejects RSA without a Node KMS backend instead of downgrading (N-R-01, N-R-02)', async () => {
      const { options, kms } = setup({
        ...sdJwtIssuer,
        algorithms: ['RS256'],
        availableBackends: ['askar'],
      })

      await expect(
        getCredentialBindingResolver({ didMethod: 'did:jwk', signatureAlgorithm: 'RS256' })(options),
      ).rejects.toThrow(BINDING_ERROR_CODES.KEY_CREATION_FAILED)
      expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
    })

    it('fails with KEY_CREATION_FAILED when key creation itself fails (N-R-02)', async () => {
      const { options, kms } = setup({ ...sdJwtIssuer, algorithms: ['EdDSA'] })
      kms.createKeyForSignatureAlgorithm.mockRejectedValueOnce(new Error("backend 'askar' does not support 'RSA'"))

      await expect(getCredentialBindingResolver({ signatureAlgorithm: 'EdDSA' })(options)).rejects.toThrow(
        BINDING_ERROR_CODES.KEY_CREATION_FAILED,
      )
    })

    it('reports a DID creation failure after key creation (N-R-04)', async () => {
      const { options } = setup({ ...sdJwtIssuer, failDidCreation: true })

      await expect(getCredentialBindingResolver({ didMethod: 'did:jwk' })(options)).rejects.toThrow(
        'DID creation failed.',
      )
    })
  })

  describe('assertOfferAcceptsHolderDid', () => {
    // Shaped like the CREDEBL dev issuer's offer: SD-JWT and JSON-LD together
    const offer = {
      offeredCredentialConfigurations: {
        IecSdJwt: {
          format: 'dc+sd-jwt',
          cryptographic_binding_methods_supported: ['did:key', 'did:web', 'did:jwk', 'jwk'],
        },
        IecLdp: { format: 'ldp_vc', cryptographic_binding_methods_supported: ['did:key'] },
      },
    } as any

    it('accepts configurations that allow the DID method', async () => {
      const { options } = setup({})

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, offer, ['IecSdJwt'], { holderDidUrl: WALLET_KEY }),
      ).resolves.toBeUndefined()
    })

    it('names the configuration that does not allow the DID method', async () => {
      const { options } = setup({})

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, offer, ['IecSdJwt', 'IecLdp'], { holderDidUrl: WALLET_KEY }),
      ).rejects.toThrow(/^IecLdp: Issuer does not support did:web binding for 'ldp_vc'/)
    })

    it('skips the configuration checks with prefer', async () => {
      const { options } = setup({})

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, offer, ['IecSdJwt', 'IecLdp'], {
          holderDidUrl: WALLET_KEY,
          bindingPolicy: 'prefer',
        }),
      ).resolves.toBeUndefined()
    })

    it('names the configuration whose jwt proof algorithms the key cannot sign', async () => {
      const { options } = setup({})
      const es256Only = {
        offeredCredentialConfigurations: {
          IecSdJwt: {
            format: 'dc+sd-jwt',
            cryptographic_binding_methods_supported: ['did:web'],
            proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
          },
        },
      } as any

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, es256Only, ['IecSdJwt'], { holderDidUrl: WALLET_KEY }),
      ).rejects.toThrow(/^IecSdJwt: Key '.*#key-1' signs with EdDSA, Ed25519, but the issuer accepts ES256/)
    })

    it('rejects a configuration that requires key attestations or no jwt proof', async () => {
      const { options } = setup({})
      const offerWith = (proofTypes: object) =>
        ({
          offeredCredentialConfigurations: {
            IecSdJwt: {
              format: 'dc+sd-jwt',
              cryptographic_binding_methods_supported: ['did:web'],
              proof_types_supported: proofTypes,
            },
          },
        }) as any

      await expect(
        assertOfferAcceptsHolderDid(
          options.agentContext,
          offerWith({ jwt: { proof_signing_alg_values_supported: ['EdDSA'], key_attestations_required: {} } }),
          ['IecSdJwt'],
          { holderDidUrl: WALLET_KEY },
        ),
      ).rejects.toThrow(HolderBindingNotSupportedError)
      await expect(
        assertOfferAcceptsHolderDid(
          options.agentContext,
          offerWith({ attestation: { proof_signing_alg_values_supported: ['EdDSA'] } }),
          ['IecSdJwt'],
          { holderDidUrl: WALLET_KEY },
        ),
      ).rejects.toThrow(/does not accept a jwt proof/)
    })

    it('rejects a jwt proof type that lists no signing algorithms', async () => {
      const { options } = setup({})
      const noAlgorithms = {
        offeredCredentialConfigurations: {
          IecSdJwt: {
            format: 'dc+sd-jwt',
            cryptographic_binding_methods_supported: ['did:web'],
            proof_types_supported: { jwt: {} },
          },
        },
      } as any

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, noAlgorithms, ['IecSdJwt'], { holderDidUrl: WALLET_KEY }),
      ).rejects.toThrow(/^IecSdJwt: Issuer metadata does not list proof_signing_alg_values_supported/)
    })

    it('accepts a configuration whose jwt proof the key can sign', async () => {
      const { options } = setup({})
      const edDsa = {
        offeredCredentialConfigurations: {
          IecSdJwt: {
            format: 'dc+sd-jwt',
            cryptographic_binding_methods_supported: ['did:web'],
            proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
          },
        },
      } as any

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, edDsa, ['IecSdJwt'], { holderDidUrl: WALLET_KEY }),
      ).resolves.toBeUndefined()
    })

    it('rejects a DID that was not created in this wallet even with prefer', async () => {
      const { options } = setup({})

      await expect(
        assertOfferAcceptsHolderDid(options.agentContext, offer, ['IecSdJwt'], {
          holderDidUrl: 'did:web:example.com',
          bindingPolicy: 'prefer',
        }),
      ).rejects.toThrow(/was not created in this wallet/)
    })
  })
})

describe('assertOfferAcceptsNewKeyBinding', () => {
  it('accepts a fresh-key selection that every configuration supports', () => {
    const { options } = setup({})
    const offer = {
      offeredCredentialConfigurations: {
        IecSdJwt: {
          format: 'dc+sd-jwt',
          cryptographic_binding_methods_supported: ['did:jwk', 'jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
        },
        IecMdoc: {
          format: 'mso_mdoc',
          cryptographic_binding_methods_supported: ['jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
        },
      },
    } as any

    expect(() =>
      assertOfferAcceptsNewKeyBinding(options.agentContext, offer, ['IecSdJwt', 'IecMdoc'], {
        signatureAlgorithm: 'ES256',
      }),
    ).not.toThrow()
  })

  it('rejects a DID method that one configuration in a multi-credential offer does not support (N-V-18)', () => {
    const { options } = setup({})
    const offer = {
      offeredCredentialConfigurations: {
        IecSdJwt: {
          format: 'dc+sd-jwt',
          cryptographic_binding_methods_supported: ['did:jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
        },
        IecMdoc: {
          format: 'mso_mdoc',
          cryptographic_binding_methods_supported: ['jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
        },
      },
    } as any

    expect(() =>
      assertOfferAcceptsNewKeyBinding(options.agentContext, offer, ['IecSdJwt', 'IecMdoc'], {
        didMethod: 'did:jwk',
        signatureAlgorithm: 'ES256',
      }),
    ).toThrow(`IecMdoc: ${BINDING_ERROR_CODES.DID_BINDING_NOT_SUPPORTED_FOR_FORMAT}`)
  })

  it('rejects an algorithm that one configuration does not accept before token redemption (N-V-18)', () => {
    const { options } = setup({})
    const offer = {
      offeredCredentialConfigurations: {
        IecSdJwt: {
          format: 'dc+sd-jwt',
          cryptographic_binding_methods_supported: ['did:jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
        },
        IecOther: {
          format: 'vc+sd-jwt',
          cryptographic_binding_methods_supported: ['did:jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['EdDSA'] } },
        },
      },
    } as any

    expect(() =>
      assertOfferAcceptsNewKeyBinding(options.agentContext, offer, ['IecSdJwt', 'IecOther'], {
        didMethod: 'did:jwk',
        signatureAlgorithm: 'EdDSA',
      }),
    ).toThrow(`IecSdJwt: ${BINDING_ERROR_CODES.UNSUPPORTED_PROOF_ALGORITHM}`)
  })
})

describe('assertW3cCredentialsBoundToHolderDid', () => {
  const HOLDER_DID = 'did:web:holder.example.com'
  const HOLDER_KEY = `${HOLDER_DID}#key-1`
  const { W3cCredentialRecord } = jest.requireMock('@credo-ts/core')
  const w3cRecord = (...credentialSubjectIds: string[]) => new W3cCredentialRecord({ credentialSubjectIds })

  it('accepts a subject that is the holder DID, bare or as a verification method url', () => {
    expect(() =>
      assertW3cCredentialsBoundToHolderDid([w3cRecord(HOLDER_DID), w3cRecord(HOLDER_KEY)], HOLDER_KEY),
    ).not.toThrow()
    expect(() => assertW3cCredentialsBoundToHolderDid([w3cRecord(HOLDER_DID)], HOLDER_DID)).not.toThrow()
  })

  it('rejects a credential bound to another DID', () => {
    expect(() => assertW3cCredentialsBoundToHolderDid([w3cRecord('did:key:z6MkOther#z6MkOther')], HOLDER_KEY)).toThrow(
      HolderBindingMismatchError,
    )
  })

  it('rejects a credential without a subject id', () => {
    expect(() => assertW3cCredentialsBoundToHolderDid([w3cRecord()], HOLDER_KEY)).toThrow(
      /subject \(none\) is not the holder DID/,
    )
  })

  it('ignores records that are not W3C credentials', () => {
    expect(() => assertW3cCredentialsBoundToHolderDid([{ type: 'SdJwtVcRecord' }], HOLDER_KEY)).not.toThrow()
  })
})
