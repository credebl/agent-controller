import { assertValidDidWebDomain, encodeDidWebDomain } from '../didWebDomain'

describe('assertValidDidWebDomain', () => {
  it('rejects a missing domain', () => {
    expect(() => assertValidDidWebDomain(undefined)).toThrow('For create did:web, domain is required')
    expect(() => assertValidDidWebDomain('')).toThrow('For create did:web, domain is required')
  })

  it.each([
    'example.com',
    'ayanworks.github.io:iec:0522012345',
    'localhost%3A3000',
    'example.com:users:bob',
    'example.com%3A65535',
    'example.com:~',
    `${'a'.repeat(63)}.com`,
  ])('accepts %s', (domain) => {
    expect(() => assertValidDidWebDomain(domain)).not.toThrow()
  })

  it.each([
    'https://example.com',
    'example.com/iec/0522',
    'not a domain',
    'example',
    'example.com::x',
    'example.com:..:x',
    'example.com:.:users',
    'example.com:a b',
    'example.com%3Aabc',
    'example.com%3A65536',
    '127.0.0.1',
    'foo.123',
    `${'a'.repeat(64)}.com`,
    `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
  ])('rejects %s', (domain) => {
    expect(() => assertValidDidWebDomain(domain)).toThrow()
  })
})

describe('encodeDidWebDomain', () => {
  it('percent-encodes `~` so the identifier conforms to DID Core syntax', () => {
    expect(`did:web:${encodeDidWebDomain('example.com:~')}`).toBe('did:web:example.com:%7E')
    expect(encodeDidWebDomain('example.com:~:users')).toBe('example.com:%7E:users')
  })

  it('leaves domains that DID Core already allows unchanged', () => {
    expect(encodeDidWebDomain('ayanworks.github.io:iec:0522012345')).toBe('ayanworks.github.io:iec:0522012345')
  })
})
