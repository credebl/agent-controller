import { assertValidDidWebDomain } from '../didWebDomain'

describe('assertValidDidWebDomain', () => {
  it.each([
    'example.com',
    'ayanworks.github.io:iec:0522012345',
    'localhost%3A3000',
    'example.com:users:bob',
    'example.com%3A65535',
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
    `${'a'.repeat(64)}.com`,
    `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
  ])('rejects %s', (domain) => {
    expect(() => assertValidDidWebDomain(domain)).toThrow()
  })
})
