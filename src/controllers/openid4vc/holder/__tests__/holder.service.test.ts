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
jest.mock('@credo-ts/openid4vc', () => ({}))
jest.mock('../credentialBindingResolver', () => ({ getCredentialBindingResolver: jest.fn() }))

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
