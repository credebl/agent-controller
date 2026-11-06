import { transformPayloadForVersion as transform } from '../src/utils/vcContext'

const V1_CONTEXT = 'https://www.w3.org/2018/credentials/v1'
const V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2'
const STATUS_CONTEXT = 'https://www.w3.org/ns/credentials/status/v1'

const status = {
  id: 'https://status.example.com/status-lists/1#1',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListIndex: '1',
  statusListCredential: 'https://status.example.com/status-lists/1',
}

describe('OID4VC JSON-LD status context', () => {
  it('appends the status context for V1 JSON-LD credentials', () => {
    const result = transform(
      {
        '@context': [V1_CONTEXT],
        type: ['VerifiableCredential'],
        issuanceDate: '2026-01-01T00:00:00Z',
        credentialStatus: status,
      },
      undefined,
      true,
    )

    expect(result['@context']).toEqual([V1_CONTEXT, STATUS_CONTEXT])
    expect(result.issuanceDate).toBe('2026-01-01T00:00:00Z')
  })

  it('does not add the V1 status context for V2 JSON-LD credentials', () => {
    const result = transform(
      {
        '@context': [V1_CONTEXT],
        type: ['VerifiableCredential'],
        issuanceDate: '2026-01-01T00:00:00Z',
        credentialStatus: status,
      },
      'v2.0',
      true,
    )

    expect(result['@context']).not.toContain(STATUS_CONTEXT)
    expect(result['@context'][0]).toBe(V2_CONTEXT)
    expect(result.validFrom).toBe('2026-01-01T00:00:00.000Z')
    expect(result.issuanceDate).toBeUndefined()
  })

  it('leaves the context untouched for non-JSON-LD payloads', () => {
    const result = transform({ '@context': [V1_CONTEXT] }, undefined, false)

    expect(result['@context']).toEqual([V1_CONTEXT])
  })
})
