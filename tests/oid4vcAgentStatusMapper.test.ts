import 'reflect-metadata'

import { SignerMethod } from '../src/enums/enum'
import { getMixedCredentialRequestToCredentialMapper } from '../src/utils/oid4vc-agent'

jest.mock('@credo-ts/core', () => ({
  Agent: class Agent {},
  ClaimFormat: {
    SdJwtDc: 'dc+sd-jwt',
    LdpVc: 'ldp_vc',
    JwtVc: 'jwt_vc_json',
    MsoMdoc: 'mso_mdoc',
  },
  BaseLogger: class BaseLogger {
    public constructor(public logLevel: unknown) {}
  },
  CredoError: class CredoError extends Error {},
  DidsApi: class DidsApi {},
  LogLevel: {
    Test: 'test',
    Trace: 'trace',
    Debug: 'debug',
    Info: 'info',
    Warn: 'warn',
    Error: 'error',
    Fatal: 'fatal',
    Off: 'off',
  },
  X509Certificate: class X509Certificate {},
  X509ModuleConfig: class X509ModuleConfig {},
  X509Service: { parseCertificate: jest.fn() },
  parseDid: jest.fn((didUrl: string) => ({ did: didUrl.split('#')[0] })),
  tryParseDid: jest.fn((didUrl: string) => ({ did: didUrl.split('#')[0] })),
  W3cCredential: class W3cCredential {},
  W3cV2Credential: class W3cV2Credential {},
  JsonTransformer: {
    fromJSON: jest.fn((value) => value),
    toJSON: jest.fn((value) => value),
  },
  CREDENTIALS_CONTEXT_V1_URL: 'https://www.w3.org/2018/credentials/v1',
  CREDENTIALS_CONTEXT_V2_URL: 'https://www.w3.org/2018/credentials/v2',
}))

jest.mock('@credo-ts/openid4vc', () => ({
  OpenId4VciCredentialFormatProfile: {
    SdJwtDc: 'dc+sd-jwt',
    SdJwtVc: 'vc+sd-jwt',
    MsoMdoc: 'mso_mdoc',
    JwtVcJson: 'jwt_vc_json',
    JwtVcJsonLd: 'jwt_vc_json-ld',
    LdpVc: 'ldp_vc',
  },
}))

jest.mock('../src/controllers/x509/didX509.utils', () => ({
  getStoredX509Chain: jest.fn(),
}))

jest.mock('../src/utils/helpers', () => ({
  checkX509Certificates: jest.fn(),
  processIsoImages: jest.fn((value) => value),
}))

jest.mock('../src/tracer', () => ({
  otelLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const ISSUER_DID = 'did:web:issuer.example'

function makeAgentContext() {
  return {
    dependencyManager: {
      resolve: jest.fn(() => ({
        resolveDidDocument: jest.fn(async () => ({
          verificationMethod: [{ id: `${ISSUER_DID}#key-1` }],
        })),
      })),
    },
  } as any
}

describe('getMixedCredentialRequestToCredentialMapper', () => {
  it('keeps credentialStatus on signed JSON-LD credentials', async () => {
    const credentialStatus = {
      id: 'https://status.example.com/status-lists/list-1#7',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '7',
      statusListCredential: 'https://status.example.com/status-lists/list-1',
    }
    const mapper = getMixedCredentialRequestToCredentialMapper()

    const result: any = await mapper({
      holderBinding: { keys: [{ method: 'did', didUrl: 'did:web:holder.example#key-1' }] },
      issuanceSession: {
        issuanceMetadata: {
          credentials: [
            {
              credentialSupportedId: 'ldp-credential',
              format: 'ldp_vc',
              isRevocable: true,
              signerOptions: { method: SignerMethod.Did, did: ISSUER_DID },
              payload: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiableCredential', 'TestCredential'],
                credentialSubject: { id: 'did:web:holder.example', name: 'Alice' },
                issuanceDate: '2024-01-01T00:00:00Z',
                credentialStatus,
              },
            },
          ],
        },
      },
      credentialConfigurationId: 'ldp-credential',
      credentialConfiguration: { format: 'ldp_vc' },
      agentContext: makeAgentContext(),
      authorization: {},
    } as any)

    expect(result.credentials[0].credential.credentialStatus).toEqual(credentialStatus)
  })

  it('rejects revocable mdoc credentials', async () => {
    const mapper = getMixedCredentialRequestToCredentialMapper()

    await expect(
      mapper({
        holderBinding: { keys: [{ method: 'did', didUrl: 'did:web:holder.example#key-1' }] },
        issuanceSession: {
          issuanceMetadata: {
            credentials: [
              {
                credentialSupportedId: 'mdoc-credential',
                format: 'mso_mdoc',
                isRevocable: true,
                signerOptions: { method: SignerMethod.X5c, x5c: ['encoded-certificate'] },
                payload: { namespaces: {} },
              },
            ],
          },
        },
        credentialConfigurationId: 'mdoc-credential',
        credentialConfiguration: {
          format: 'mso_mdoc',
          doctype: 'com.example.test',
        },
        agentContext: makeAgentContext(),
        authorization: {},
      } as any),
    ).rejects.toThrow('Revocation is not supported for mdoc credentials')
  })
})
