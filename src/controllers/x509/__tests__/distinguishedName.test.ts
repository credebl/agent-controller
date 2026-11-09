import { normalizeDistinguishedName } from '../distinguishedName'

describe('normalizeDistinguishedName', () => {
  it('converts the OpenSSL style string to the comma separated form', () => {
    expect(normalizeDistinguishedName('/C=IN/O=IBDIC Test/CN=IBDIC mDoc DS')).toBe(
      'C=IN, O=IBDIC Test, CN=IBDIC mDoc DS',
    )
  })

  it('keeps an escaped slash and escapes a comma inside a value', () => {
    expect(normalizeDistinguishedName('/O=A\\/B, Inc/CN=Example')).toBe('O=A/B\\, Inc, CN=Example')
  })

  it('leaves the comma form and the name object alone', () => {
    expect(normalizeDistinguishedName('C=IN, CN=Example')).toBe('C=IN, CN=Example')
    const object = { countryName: 'IN', commonName: 'Example' }
    expect(normalizeDistinguishedName(object)).toBe(object)
    expect(normalizeDistinguishedName(undefined)).toBeUndefined()
  })
})
