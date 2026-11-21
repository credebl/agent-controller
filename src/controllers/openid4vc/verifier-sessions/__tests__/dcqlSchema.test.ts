import swagger from '../../../../routes/swagger.json'

/**
 * The request validator is generated from these schemas, so a DCQL field missing here is refused with 422 before the
 * request reaches Credo. These are the fields of OpenID4VP 1.0 section 6.
 */
describe('DCQL request schema', () => {
  const schemas = (swagger as any).components.schemas

  it('accepts claim ids, values and null or numeric path segments', () => {
    const claim = schemas.DcqlClaim
    expect(Object.keys(claim.properties)).toEqual(expect.arrayContaining(['id', 'path', 'values', 'intent_to_retain']))
    expect(claim.required).toEqual(['path'])
    const pathItems = JSON.stringify(claim.properties.path.items)
    expect(pathItems).toMatch(/"string"/)
    expect(pathItems).toMatch(/"number"/)
    expect(pathItems).toMatch(/"nullable":true|"null"/)
    expect(JSON.stringify(claim.properties.values.items)).toMatch(/"boolean"/)
  })

  it('accepts multiple, trusted_authorities and claim_sets on a credential query', () => {
    const credential = schemas.DcqlCredential
    expect(Object.keys(credential.properties)).toEqual(
      expect.arrayContaining(['id', 'format', 'multiple', 'meta', 'trusted_authorities', 'claims', 'claim_sets']),
    )
    expect(credential.required).toEqual(['id', 'format'])
    expect(schemas.DcqlTrustedAuthority.required).toEqual(['type', 'values'])
  })
})
