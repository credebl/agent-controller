import { CREDENTIALS_V2_CONTEXT_URL, STATUS_V1_CONTEXT_URL } from '../src/vc-jsonld/constants'
import { getInlineContext } from '../src/vc-jsonld/contexts'

jest.mock('@digitalcredentials/credentials-v2-context', () => ({
  contexts: new Map([
    [
      'https://www.w3.org/ns/credentials/v2',
      {
        '@context': {
          id: '@id',
          type: '@type',
          VerifiableCredential: 'https://www.w3.org/ns/credentials#VerifiableCredential',
        },
      },
    ],
  ]),
}))

describe('getInlineContext', () => {
  it('returns the bundled VCDM 2.0 context', () => {
    expect(getInlineContext(CREDENTIALS_V2_CONTEXT_URL)).toMatchObject({
      '@context': expect.objectContaining({ id: '@id', type: '@type' }),
    })
  })

  it('returns the inline bitstring status context', () => {
    expect(getInlineContext(STATUS_V1_CONTEXT_URL)).toMatchObject({
      '@context': expect.objectContaining({
        BitstringStatusListCredential: expect.any(String),
        BitstringStatusList: expect.any(Object),
        BitstringStatusListEntry: expect.any(Object),
      }),
    })
  })

  it('returns undefined for contexts that are not cached', () => {
    expect(getInlineContext('https://example.com/context/v1')).toBeUndefined()
  })
})
