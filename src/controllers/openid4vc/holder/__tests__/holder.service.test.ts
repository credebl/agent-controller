import { SdJwtVcRecord } from '@credo-ts/core'

import {
  assertOfferAcceptsHolderDid,
  assertW3cCredentialsBoundToHolderDid,
  getCredentialBindingResolver,
} from '../credentialBindingResolver'
import { HolderService } from '../holder.service'

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbols the service touches are stubbed.
jest.mock('@credo-ts/core', () => ({
  Mdoc: {},
  SdJwtVcRecord: class {},
  MdocRecord: class {},
  W3cCredentialRecord: class {},
  W3cCredentialRepository: class {},
  W3cCredentialService: class {},
  JsonTransformer: { toJSON: (record: object) => ({ ...record }) },
}))
jest.mock('@credo-ts/openid4vc', () => ({
  preAuthorizedCodeGrantIdentifier: 'urn:ietf:params:oauth:grant-type:pre-authorized_code',
}))
jest.mock('../credentialBindingResolver', () => ({
  getCredentialBindingResolver: jest.fn(),
  assertOfferAcceptsHolderDid: jest.fn(),
  assertW3cCredentialsBoundToHolderDid: jest.fn(),
}))

describe('HolderService pagination and search', () => {
  let holderService: HolderService

  beforeEach(() => {
    holderService = new HolderService()
  })

  const createMockRecord = (tags: Record<string, unknown> = {}, extra: any = {}) => {
    return {
      getTags: () => tags,
      ...extra,
    } as any
  }

  describe('getSdJwtCredentials', () => {
    it('should return all records when no query params provided', async () => {
      const records = [createMockRecord({ vct: 'https://example.com/vct1' })]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result = await holderService.getSdJwtCredentials(agentReq, {})
      expect(result).toEqual(records)
      expect(agentReq.agent.sdJwtVc.findAllByQuery).toHaveBeenCalledWith({})
    })

    it('should build tag query from filters', async () => {
      const records: any[] = []
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      await holderService.getSdJwtCredentials(agentReq, { credentialType: 'sd-jwt-vc', vct: 'vct1' })
      expect(agentReq.agent.sdJwtVc.findAllByQuery).toHaveBeenCalledWith({
        credentialType: 'sd-jwt-vc',
        vct: 'vct1',
      })
    })

    it('should paginate results with defaults and metadata', async () => {
      const records = Array.from({ length: 25 }, (_, i) => createMockRecord({ name: `cred${i}` }))
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getSdJwtCredentials(agentReq, { page: 1 })
      expect(result.data).toHaveLength(20)
      expect(result.pagination.page).toBe(1)
      expect(result.pagination.pageSize).toBe(20)
      expect(result.pagination.total).toBe(25)
      expect(result.pagination.totalPages).toBe(2)
      expect(result.pagination.hasNextPage).toBe(true)
      expect(result.pagination.hasPreviousPage).toBe(false)
    })

    it('should search by q in allowlisted tags', async () => {
      const records = [
        createMockRecord({ name: 'University Degree', issuer: 'University' }),
        createMockRecord({ name: 'Driving License', issuer: 'DMV' }),
      ]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getSdJwtCredentials(agentReq, { q: 'degree' })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].tags.name).toBe('University Degree')
    })

    it('should search across multiple fields case-insensitively', async () => {
      const records = [
        createMockRecord({ issuer: 'Example Corp', reference: 'ref123' }),
        createMockRecord({ issuer: 'Other', reference: 'xyz' }),
      ]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getSdJwtCredentials(agentReq, { q: 'EXAMPLE' })
      expect(result.data).toHaveLength(1)
    })

    it('should handle array tags in search', async () => {
      const records = [
        createMockRecord({ types: ['BachelorDegree', 'Education'] }),
        createMockRecord({ types: ['ID'] }),
      ]
      const findByQuery = jest.fn().mockResolvedValue(records)
      const agentReq: any = {
        agent: {
          dependencyManager: {
            resolve: jest.fn().mockReturnValue({ findByQuery }),
          },
        },
      }

      // `types` is a searchable tag for W3C credentials only
      const result: any = await holderService.getW3cCredentials(agentReq, { q: 'bachelor' })
      expect(result.data).toHaveLength(1)
    })

    it('should validate page size max limit', async () => {
      const records = [createMockRecord({})]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      await expect(holderService.getSdJwtCredentials(agentReq, { pageSize: 101 })).rejects.toThrow(
        'Invalid pageSize. pageSize must be an integer between 1 and 100',
      )
    })

    it('should validate page minimum', async () => {
      const records = [createMockRecord({})]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      await expect(holderService.getSdJwtCredentials(agentReq, { page: 0 })).rejects.toThrow(
        'Invalid page. page must be an integer >= 1',
      )
    })

    it('should include filters in response', async () => {
      const records = [createMockRecord({})]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getSdJwtCredentials(agentReq, {
        page: 1,
        credentialType: 'sd-jwt-vc',
        q: 'test',
      })
      expect(result.filters).toBeDefined()
      expect(result.filters.credentialType).toBe('sd-jwt-vc')
      expect(result.filters.q).toBe('test')
    })

    it('should handle records without tags in search gracefully', async () => {
      const records = [createMockRecord(undefined), { name: 'test-cred', getTags: () => undefined } as any]
      const agentReq: any = {
        agent: {
          sdJwtVc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getSdJwtCredentials(agentReq, { q: 'test' })
      expect(result.data.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getMdocCredentials', () => {
    it('should build tag query with docType', async () => {
      const records: any[] = []
      const agentReq: any = {
        agent: {
          mdoc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      await holderService.getMdocCredentials(agentReq, { docType: 'org.iso.18013.5.1.mDL' })
      expect(agentReq.agent.mdoc.findAllByQuery).toHaveBeenCalledWith({ docType: 'org.iso.18013.5.1.mDL' })
    })

    it('should paginate mdoc credentials', async () => {
      const records = Array.from({ length: 15 }, (_, i) => createMockRecord({ docType: 'mDL' }))
      const agentReq: any = {
        agent: {
          mdoc: {
            findAllByQuery: jest.fn().mockResolvedValue(records),
          },
        },
      }

      const result: any = await holderService.getMdocCredentials(agentReq, { page: 2, pageSize: 5 })
      expect(result.pagination.page).toBe(2)
      expect(result.pagination.pageSize).toBe(5)
      expect(result.data).toHaveLength(5)
      expect(result.pagination.hasPreviousPage).toBe(true)
    })
  })

  describe('getW3cCredentials', () => {
    it('should use repository and build tag query with types', async () => {
      const records: any[] = []
      const findByQuery = jest.fn().mockResolvedValue(records)
      const agentReq: any = {
        agent: {
          dependencyManager: {
            resolve: jest.fn().mockReturnValue({ findByQuery }),
          },
        },
      }

      await holderService.getW3cCredentials(agentReq, { types: 'VerifiableCredential,UniversityDegreeCredential' })
      expect(agentReq.agent.dependencyManager.resolve).toHaveBeenCalled()
      expect(findByQuery).toHaveBeenCalled()
    })

    it('should paginate w3c credentials', async () => {
      const records = Array.from({ length: 3 }, () => createMockRecord({ credentialType: 'w3c-vc' }))
      const findByQuery = jest.fn().mockResolvedValue(records)
      const agentReq: any = {
        agent: {
          dependencyManager: {
            resolve: jest.fn().mockReturnValue({ findByQuery }),
          },
        },
      }

      const result: any = await holderService.getW3cCredentials(agentReq, { pageSize: 10 })
      expect(result.data).toHaveLength(3)
      expect(result.pagination.pageSize).toBe(10)
    })
  })
})

describe('HolderService requestCredential', () => {
  const offeredIds = ['IecSdJwt', 'IecLdp']
  const metadata = {
    credentialIssuer: {
      credential_issuer: 'https://issuer.example.com',
      notification_endpoint: 'https://issuer.example.com/notification',
    },
  }

  const createAgentReq = (
    options: {
      credentials?: any[]
      credentialOffer?: any
    } = {},
  ) => {
    const holder = {
      resolveCredentialOffer: jest.fn().mockResolvedValue(
        options.credentialOffer ?? {
          metadata,
          credentialOfferPayload: {
            credential_configuration_ids: offeredIds,
            grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': {} },
          },
        },
      ),
      requestToken: jest.fn().mockResolvedValue({ accessToken: 'token' }),
      requestCredentials: jest.fn().mockResolvedValue({ credentials: options.credentials ?? [] }),
      sendNotification: jest.fn().mockResolvedValue(undefined),
    }
    const agentReq = {
      agent: {
        context: 'agentContext',
        config: { logger: { warn: jest.fn() } },
        modules: { openid4vc: { holder } },
        w3cCredentials: { store: jest.fn(async ({ record }: any) => record) },
        mdoc: { store: jest.fn(async ({ record }: any) => record) },
        sdJwtVc: { store: jest.fn(async ({ record }: any) => record) },
      },
    } as any
    return { agentReq, holder }
  }

  beforeEach(() => {
    jest.mocked(getCredentialBindingResolver).mockReset()
    jest.mocked(assertOfferAcceptsHolderDid).mockReset()
    jest.mocked(assertW3cCredentialsBoundToHolderDid).mockReset()
  })

  it('requests all offered credentials when credentialsToRequest is not given', async () => {
    const { agentReq, holder } = createAgentReq()

    await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'openid-credential-offer://x' })

    expect(holder.requestCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ credentialConfigurationIds: offeredIds }),
    )
  })

  it('requests only credentialsToRequest when given', async () => {
    const { agentReq, holder } = createAgentReq()

    await new HolderService().requestCredential(agentReq, {
      credentialOfferUri: 'openid-credential-offer://x',
      credentialsToRequest: ['IecSdJwt'],
    })

    expect(holder.requestCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ credentialConfigurationIds: ['IecSdJwt'] }),
    )
  })

  it('rejects credentialsToRequest that are not in the offer before requesting a token', async () => {
    const { agentReq, holder } = createAgentReq()

    await expect(
      new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'openid-credential-offer://x',
        credentialsToRequest: ['Other'],
      }),
    ).rejects.toThrow('Credentials not in the offer: Other')
    expect(holder.requestToken).not.toHaveBeenCalled()
  })

  it('passes holderDidUrl and bindingPolicy to the binding resolver', async () => {
    const { agentReq } = createAgentReq()

    await new HolderService().requestCredential(agentReq, {
      credentialOfferUri: 'openid-credential-offer://x',
      holderDidUrl: 'did:web:example.com#key-1',
      bindingPolicy: 'prefer',
    })

    expect(getCredentialBindingResolver).toHaveBeenCalledWith({
      requestBatch: false,
      holderDidUrl: 'did:web:example.com#key-1',
      bindingPolicy: 'prefer',
    })
  })

  it('checks the holder DID against the offer before requesting a token', async () => {
    const { agentReq, holder } = createAgentReq()
    jest.mocked(assertOfferAcceptsHolderDid).mockRejectedValue(new Error('IecLdp: did:web not supported'))

    await expect(
      new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'openid-credential-offer://x',
        holderDidUrl: 'did:web:example.com#key-1',
      }),
    ).rejects.toThrow('IecLdp: did:web not supported')
    expect(assertOfferAcceptsHolderDid).toHaveBeenCalledWith('agentContext', expect.anything(), offeredIds, {
      holderDidUrl: 'did:web:example.com#key-1',
      bindingPolicy: undefined,
    })
    expect(holder.requestToken).not.toHaveBeenCalled()
  })

  it('does not check the offer without holderDidUrl', async () => {
    const { agentReq } = createAgentReq()

    await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'openid-credential-offer://x' })

    expect(assertOfferAcceptsHolderDid).not.toHaveBeenCalled()
  })

  it('checks that W3C credentials are bound to the holder DID before storing them, with require', async () => {
    const { agentReq, holder } = createAgentReq()
    const record = { type: 'W3cCredentialRecord' }
    holder.requestCredentials.mockResolvedValue({ credentials: [{ record }] })
    agentReq.agent.w3cCredentials = { store: jest.fn() }
    jest.mocked(assertW3cCredentialsBoundToHolderDid).mockImplementation(() => {
      throw new Error('not the holder DID')
    })

    await expect(
      new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'openid-credential-offer://x',
        holderDidUrl: 'did:web:example.com#key-1',
      }),
    ).rejects.toThrow('not the holder DID')
    expect(assertW3cCredentialsBoundToHolderDid).toHaveBeenCalledWith([record], 'did:web:example.com#key-1')
    expect(agentReq.agent.w3cCredentials.store).not.toHaveBeenCalled()
  })

  it('does not check the credential binding with prefer or without holderDidUrl', async () => {
    const { agentReq } = createAgentReq()

    await new HolderService().requestCredential(agentReq, {
      credentialOfferUri: 'openid-credential-offer://x',
      holderDidUrl: 'did:web:example.com#key-1',
      bindingPolicy: 'prefer',
    })
    await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'openid-credential-offer://x' })

    expect(assertW3cCredentialsBoundToHolderDid).not.toHaveBeenCalled()
  })

  describe('credential notifications', () => {
    // The mocked record class ignores constructor arguments, so set the fields the tests read
    const sdJwt = (id: string) =>
      Object.assign(new SdJwtVcRecord({ id, credentialInstances: [{ compactSdJwtVc: 'sd-jwt' }] }), { id })
    const accepted = { status: 'sent', event: 'credential_accepted' }
    const events = (holder: any) =>
      holder.sendNotification.mock.calls.map(([options]: any[]) => options.notificationEvent)

    it('sends credential_accepted after storing a credential with notificationId', async () => {
      const record = sdJwt('cred-1')
      const { agentReq, holder } = createAgentReq({ credentials: [{ record, notificationId: 'notif-1' }] })

      const result = await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      expect(agentReq.agent.sdJwtVc.store).toHaveBeenCalledWith({ record })
      expect(holder.sendNotification).toHaveBeenCalledWith({
        metadata,
        accessToken: 'token',
        dpop: undefined,
        notificationId: 'notif-1',
        notificationEvent: 'credential_accepted',
      })
      expect(result).toEqual([{ ...record, notification: accepted }])
    })

    it('sends credential_failure and rejects when storing fails', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [{ record: sdJwt('cred-2'), notificationId: 'notif-2' }],
      })
      agentReq.agent.sdJwtVc.store.mockRejectedValue(new Error('store failed'))

      await expect(new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })).rejects.toThrow(
        'store failed',
      )

      expect(holder.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ notificationId: 'notif-2', notificationEvent: 'credential_failure' }),
      )
      expect(holder.sendNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ notificationEvent: 'credential_accepted' }),
      )
    })

    it('sends credential_failure and rejects for an unsupported record type', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [{ record: { type: 'UnknownRecord' }, notificationId: 'notif-u' }],
      })

      await expect(new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })).rejects.toThrow(
        'Unsupported credential record type: UnknownRecord',
      )
      expect(events(holder)).toEqual(['credential_failure'])
    })

    it('stores the other credentials and reports each outcome when one of them fails', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record: sdJwt('ok'), notificationId: 'notif-ok' },
          { record: sdJwt('bad'), notificationId: 'notif-bad' },
        ],
      })
      agentReq.agent.sdJwtVc.store.mockImplementation(async ({ record }: any) => {
        if (record.id === 'bad') throw new Error('store failed')
        return record
      })

      await expect(new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })).rejects.toThrow(
        'store failed',
      )

      expect(agentReq.agent.sdJwtVc.store).toHaveBeenCalledTimes(2)
      expect(holder.sendNotification.mock.calls.map(([o]: any[]) => [o.notificationId, o.notificationEvent])).toEqual([
        ['notif-ok', 'credential_accepted'],
        ['notif-bad', 'credential_failure'],
      ])
    })

    it('fails promptly when a store fails while another one never settles', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record: sdJwt('bad'), notificationId: 'notif-bad' },
          { record: sdJwt('stuck'), notificationId: 'notif-stuck' },
        ],
      })
      agentReq.agent.sdJwtVc.store.mockImplementation(({ record }: any) =>
        record.id === 'bad' ? Promise.reject(new Error('store failed')) : new Promise(() => undefined),
      )

      await expect(new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })).rejects.toThrow(
        'store failed',
      )

      // Only the credential known to have failed is reported; the one still being stored is not
      expect(holder.sendNotification.mock.calls.map(([o]: any[]) => [o.notificationId, o.notificationEvent])).toEqual([
        ['notif-bad', 'credential_failure'],
      ])
    })

    it('sends credential_failure for every credential when the holder DID binding check fails', async () => {
      const record = { type: 'W3cCredentialRecord' }
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record, notificationId: 'notif-w3c' },
          { record: sdJwt('cred'), notificationId: 'notif-sd' },
        ],
      })
      jest.mocked(assertW3cCredentialsBoundToHolderDid).mockImplementation(() => {
        throw new Error('not the holder DID')
      })

      await expect(
        new HolderService().requestCredential(agentReq, {
          credentialOfferUri: 'offer',
          holderDidUrl: 'did:web:example.com#key-1',
        }),
      ).rejects.toThrow('not the holder DID')

      expect(agentReq.agent.w3cCredentials.store).not.toHaveBeenCalled()
      expect(agentReq.agent.sdJwtVc.store).not.toHaveBeenCalled()
      expect(holder.sendNotification.mock.calls.map(([o]: any[]) => [o.notificationId, o.notificationEvent])).toEqual([
        ['notif-w3c', 'credential_failure'],
        ['notif-sd', 'credential_failure'],
      ])
    })

    it('notifies only after every credential is stored', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record: sdJwt('a'), notificationId: 'notif-a' },
          { record: sdJwt('b'), notificationId: 'notif-b' },
        ],
      })

      await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      const lastStore = Math.max(...agentReq.agent.sdJwtVc.store.mock.invocationCallOrder)
      expect(Math.min(...holder.sendNotification.mock.invocationCallOrder)).toBeGreaterThan(lastStore)
    })

    it('sends the notifications one at a time', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record: sdJwt('a'), notificationId: 'notif-a' },
          { record: sdJwt('b'), notificationId: 'notif-b' },
        ],
      })
      holder.sendNotification.mockImplementation(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
      })

      await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      expect(holder.sendNotification).toHaveBeenCalledTimes(2)
      expect(maxInFlight).toBe(1)
    })

    it('uses the DPoP options returned with the credential response', async () => {
      const dpop = { alg: 'ES256', jwk: 'jwk', nonce: 'nonce-2' }
      const { agentReq, holder } = createAgentReq()
      holder.requestCredentials.mockResolvedValue({
        credentials: [{ record: sdJwt('a'), notificationId: 'notif-a' }],
        dpop,
      })

      await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      expect(holder.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ dpop }))
    })

    it('skips notifications when the issuer does not return a notificationId', async () => {
      const record = sdJwt('cred-3')
      const { agentReq, holder } = createAgentReq({ credentials: [{ record }] })

      const result = await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      expect(holder.sendNotification).not.toHaveBeenCalled()
      expect(result).toEqual([
        { ...record, notification: { status: 'skipped', reason: 'Credential response has no notification_id' } },
      ])
    })

    it('skips notifications when the issuer has no notification_endpoint', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [{ record: sdJwt('cred'), notificationId: 'notif-1' }],
        credentialOffer: {
          metadata: { credentialIssuer: { credential_issuer: 'https://issuer.example.com' } },
          credentialOfferPayload: { credential_configuration_ids: offeredIds, grants: {} },
        },
      })

      const [credential] = (await new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'offer',
      })) as any[]

      expect(holder.sendNotification).not.toHaveBeenCalled()
      expect(agentReq.agent.config.logger.warn).not.toHaveBeenCalled()
      expect(credential.notification).toEqual({
        status: 'skipped',
        reason: 'Issuer metadata has no notification_endpoint',
      })
    })

    it('sends nothing when sendNotification is false, also when storing fails', async () => {
      const { agentReq, holder } = createAgentReq({ credentials: [{ record: sdJwt('a'), notificationId: 'notif-a' }] })

      const [credential] = (await new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'offer',
        sendNotification: false,
      })) as any[]
      expect(credential.notification).toEqual({ status: 'skipped', reason: 'sendNotification is false' })

      agentReq.agent.sdJwtVc.store.mockRejectedValue(new Error('store failed'))
      await expect(
        new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer', sendNotification: false }),
      ).rejects.toThrow('store failed')

      expect(holder.sendNotification).not.toHaveBeenCalled()
    })

    it('does not fail issuance when the notification cannot be sent', async () => {
      const record = sdJwt('cred-4')
      const { agentReq, holder } = createAgentReq({ credentials: [{ record, notificationId: 'notif-3' }] })
      holder.sendNotification.mockRejectedValue(new Error('network error'))

      const result = await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })

      expect(result).toEqual([
        { ...record, notification: { status: 'failed', event: 'credential_accepted', reason: 'network error' } },
      ])
      expect(agentReq.agent.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("'credential_accepted'"), {
        notificationId: 'notif-3',
        credentialIssuer: 'https://issuer.example.com',
      })
    })

    it("adds the issuer's HTTP status and error code to the failure reason", async () => {
      const { agentReq, holder } = createAgentReq({ credentials: [{ record: sdJwt('a'), notificationId: 'notif-a' }] })
      holder.sendNotification.mockRejectedValue(
        Object.assign(new Error("Error sending notification to 'https://issuer.example.com'"), {
          response: {
            response: { status: 400 },
            notificationErrorResponseResult: { success: true, data: { error: 'invalid_notification_id' } },
          },
        }),
      )

      const [credential] = (await new HolderService().requestCredential(agentReq, {
        credentialOfferUri: 'offer',
      })) as any[]

      expect(credential.notification).toEqual({
        status: 'failed',
        event: 'credential_accepted',
        reason: "Error sending notification to 'https://issuer.example.com': HTTP 400 invalid_notification_id",
      })
    })

    it('sends no further notifications after one times out', async () => {
      process.env.OID4VCI_NOTIFICATION_TIMEOUT_MS = '20'
      try {
        const { agentReq, holder } = createAgentReq({
          credentials: [
            { record: sdJwt('a'), notificationId: 'notif-a' },
            { record: sdJwt('b'), notificationId: 'notif-b' },
          ],
        })
        holder.sendNotification.mockReturnValue(new Promise(() => undefined))

        const result = (await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })) as any[]

        // The timed-out call may still reach the issuer, so a second call could overlap it
        expect(holder.sendNotification).toHaveBeenCalledTimes(1)
        expect(result.map((c) => c.notification)).toEqual([
          { status: 'failed', event: 'credential_accepted', reason: 'No answer from the issuer within 20 ms' },
          { status: 'skipped', reason: 'An earlier notification to this issuer timed out' },
        ])
      } finally {
        delete process.env.OID4VCI_NOTIFICATION_TIMEOUT_MS
      }
    })

    it('keeps sending after a notification that failed without timing out', async () => {
      const { agentReq, holder } = createAgentReq({
        credentials: [
          { record: sdJwt('a'), notificationId: 'notif-a' },
          { record: sdJwt('b'), notificationId: 'notif-b' },
        ],
      })
      holder.sendNotification.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(undefined)

      const result = (await new HolderService().requestCredential(agentReq, { credentialOfferUri: 'offer' })) as any[]

      expect(holder.sendNotification).toHaveBeenCalledTimes(2)
      expect(result.map((c) => c.notification.status)).toEqual(['failed', 'sent'])
    })

    it('gives up on an issuer that does not answer the notification', async () => {
      process.env.OID4VCI_NOTIFICATION_TIMEOUT_MS = '20'
      try {
        const { agentReq, holder } = createAgentReq({
          credentials: [{ record: sdJwt('a'), notificationId: 'notif-a' }],
        })
        holder.sendNotification.mockReturnValue(new Promise(() => undefined))

        const [credential] = (await new HolderService().requestCredential(agentReq, {
          credentialOfferUri: 'offer',
        })) as any[]

        expect(credential.notification).toEqual({
          status: 'failed',
          event: 'credential_accepted',
          reason: 'No answer from the issuer within 20 ms',
        })
      } finally {
        delete process.env.OID4VCI_NOTIFICATION_TIMEOUT_MS
      }
    })
  })
})
