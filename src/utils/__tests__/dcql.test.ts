import { assertDcqlLdpVcTypeValuesExpanded } from '../dcql'

const query = (credentials: unknown[]) => ({ query: { credentials } })

describe('assertDcqlLdpVcTypeValuesExpanded', () => {
  it('accepts expanded type IRIs', () => {
    expect(() =>
      assertDcqlLdpVcTypeValuesExpanded(
        query([
          {
            id: 'membership',
            format: 'ldp_vc',
            meta: {
              type_values: [
                ['https://www.w3.org/2018/credentials#VerifiableCredential', 'https://example.org/vocab#MyCredential'],
              ],
            },
          },
        ]),
      ),
    ).not.toThrow()
  })

  it('rejects short type names with a hint', () => {
    expect(() =>
      assertDcqlLdpVcTypeValuesExpanded(
        query([
          { id: 'membership', format: 'ldp_vc', meta: { type_values: [['VerifiableCredential', 'MyCredential']] } },
        ]),
      ),
    ).toThrow(
      "DCQL credential query 'membership': meta.type_values for ldp_vc must be expanded JSON-LD type IRIs (e.g. 'https://www.w3.org/2018/credentials#VerifiableCredential'), not 'VerifiableCredential', 'MyCredential'",
    )
  })

  it('checks a query passed as a JSON string', () => {
    const dcql = JSON.stringify(query([{ id: 'a', format: 'ldp_vc', meta: { type_values: [['MyCredential']] } }]))
    expect(() => assertDcqlLdpVcTypeValuesExpanded(dcql)).toThrow(/'MyCredential'/)
  })

  it('ignores other formats and queries without type_values', () => {
    expect(() =>
      assertDcqlLdpVcTypeValuesExpanded(
        query([
          { id: 'jwt', format: 'jwt_vc_json', meta: { type_values: [['MyCredential']] } },
          { id: 'sd', format: 'dc+sd-jwt', meta: { vct_values: ['https://example.org/vct/membership'] } },
          { id: 'ldp', format: 'ldp_vc' },
        ]),
      ),
    ).not.toThrow()
  })

  it('leaves an unparseable string to Credo', () => {
    expect(() => assertDcqlLdpVcTypeValuesExpanded('{not json')).not.toThrow()
  })
})
