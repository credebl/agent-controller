import express from 'express'
import request from 'supertest'

import { normalizeCredentialBinding } from '../../controllers/openid4vc/holder/credentialBindingOptions'
import { RegisterRoutes } from '../routes'

// Keep Jest away from Credo's ESM build: this test only exercises tsoa's generated body validation.
jest.mock('@tsoa/runtime', () => ({
  ...jest.requireActual('@tsoa/runtime'),
  fetchMiddlewares: jest.fn(() => []),
}))
jest.mock('../../utils/kms/backend', () => ({
  ASKAR_KMS_BACKEND: 'askar',
  NODE_KMS_BACKEND: 'node',
  selectKmsBackendForCreate: jest.fn(() => ({ name: 'askar' })),
}))
jest.mock('../../authentication', () => ({
  expressAuthentication: jest.fn(async () => true),
}))
jest.mock('../../utils/tsyringeTsoaIocContainer', () => ({
  iocContainer: {
    get: jest.fn(() => {
      class MockController {
        public async requestCredential(_request: unknown, body: unknown) {
          return body
        }
      }
      return new MockController()
    }),
  },
}))
jest.mock('../../controllers/x509/x509.Controller', () => ({ X509Controller: class {} }))
jest.mock('../../controllers/polygon/PolygonController', () => ({ Polygon: class {} }))
jest.mock('../../controllers/openid4vc/verifier-sessions/verification-sessions.Controller', () => ({
  VerificationSessionsController: class {},
}))
jest.mock('../../controllers/openid4vc/issuers/issuer.Controller', () => ({ IssuerController: class {} }))
jest.mock('../../controllers/openid4vc/issuance-sessions/issuance-sessions.Controller', () => ({
  IssuanceSessionsController: class {},
}))
jest.mock('../../controllers/openid4vc/holder/holder.Controller', () => ({
  HolderController: class {
    public async requestCredential() {}
  },
}))
jest.mock('../../controllers/multi-tenancy/MultiTenancyController', () => ({ MultiTenancyController: class {} }))
jest.mock('../../controllers/didcomm/question-answer/QuestionAnswerController', () => ({
  QuestionAnswerController: class {},
}))
jest.mock('../../controllers/didcomm/outofband/OutOfBandController', () => ({ OutOfBandController: class {} }))
jest.mock('../../controllers/didcomm/connections/ConnectionController', () => ({ ConnectionController: class {} }))
jest.mock('../../controllers/did/DidController', () => ({ DidController: class {} }))
jest.mock('../../controllers/auth/AuthController', () => ({ AuthController: class {} }))
jest.mock('../../controllers/agent/AgentController', () => ({ AgentController: class {} }))
jest.mock('../../controllers/anoncreds/schema/SchemaController', () => ({ SchemaController: class {} }))
jest.mock('../../controllers/anoncreds/cred-def/CredentialDefinitionController', () => ({
  CredentialDefinitionController: class {},
}))
jest.mock('../../controllers/didcomm/credentials/CredentialController', () => ({ CredentialController: class {} }))
jest.mock('../../controllers/didcomm/proofs/ProofController', () => ({ ProofController: class {} }))
jest.mock('../../controllers/openid4vc/verifiers/verifier.Controller', () => ({ VerifierController: class {} }))

/** Returns the body as tsoa validated and coerced it, before the controller sees it. */
async function validatedBody(body: object): Promise<any> {
  const app = express()
  app.use(express.json())
  RegisterRoutes(app)

  const response = await request(app).post('/openid4vc/holder/request-credential').send(body)
  expect(response.status).toBe(200)
  return response.body
}

describe('request credential body validation', () => {
  it.each(['new-key', 'existing-did'])(
    'keeps a nested-only prefer policy for %s without injecting a flat bindingPolicy',
    async (mode) => {
      const holderDidUrl = 'did:web:wallet.example.com#key-1'
      const body = await validatedBody({
        credentialOfferUri: 'openid-credential-offer://x',
        binding: {
          mode,
          ...(mode === 'existing-did' ? { holderDidUrl } : {}),
          policy: 'prefer',
        },
      })

      expect(body).not.toHaveProperty('bindingPolicy')
      expect(normalizeCredentialBinding(body)).toEqual({
        mode,
        ...(mode === 'existing-did' ? { holderDidUrl } : {}),
        policy: 'prefer',
      })
    },
  )

  it('passes an explicit flat policy through so the service can detect a conflict', async () => {
    const body = await validatedBody({
      credentialOfferUri: 'openid-credential-offer://x',
      bindingPolicy: 'require',
      binding: { mode: 'new-key', policy: 'prefer' },
    })

    expect(body.bindingPolicy).toBe('require')
    expect(() => normalizeCredentialBinding(body)).toThrow('INVALID_BINDING_MODE')
  })
})
