import {
  HolderBindingNotSupportedError,
  assertOfferAcceptsHolderDid,
  getCredentialBindingResolver,
} from '../credentialBindingResolver'

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbols the resolver touches are stubbed.
jest.mock('@credo-ts/core', () => {
  const parseDid = (didUrl: string) => {
    const [did, fragment] = didUrl.split('#')
    return { did, method: did.split(':')[1], fragment, didUrl }
  }
  return {
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

const WALLET_DID = 'did:web:ayanworks.github.io:iec:0522012345'
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
}) {
  const kms = {
    createKeyForSignatureAlgorithm: jest.fn().mockResolvedValue({ publicJwk: { keyId: 'new-key' } }),
  }
  const dids = {
    resolveCreatedDidDocumentWithKeys: jest.fn(async (did: string) => {
      if (did !== WALLET_DID) throw new Error(`Created did '${did}' not found`)
      return { didDocument: walletDidDocument, keys: [] }
    }),
    create: jest.fn(async ({ method }: { method: string }) => ({
      didState: { state: 'finished', did: `did:${method}:new` },
    })),
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
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256', backend: 'askar' })
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
        HolderBindingNotSupportedError,
      )
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

    it('fails even with prefer when the verification method is not in the DID document', async () => {
      const { options } = setup(sdJwtIssuer)

      await expect(
        getCredentialBindingResolver({ holderDidUrl: `${WALLET_DID}#key-2`, bindingPolicy: 'prefer' })(options),
      ).rejects.toThrow(/not found in the DID document/)
    })
  })

  describe('without holderDidUrl', () => {
    it('creates a new did:jwk key with the first issuer algorithm', async () => {
      const { options, kms, dids } = setup(sdJwtIssuer)

      const binding = await getCredentialBindingResolver({ requestBatch: false })(options)

      expect(binding).toEqual({ method: 'did', didUrls: ['did:jwk:new#0'] })
      expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256', backend: 'askar' })
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
