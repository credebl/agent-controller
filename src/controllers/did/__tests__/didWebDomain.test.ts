import { assertValidDidWebDomain } from '../didWebDomain'

describe('assertValidDidWebDomain', () => {
  it.each(['example.com', 'ayanworks.github.io:iec:0522012345', 'localhost%3A3000', 'example.com:users:bob'])(
    'accepts %s',
    (domain) => {
      expect(() => assertValidDidWebDomain(domain)).not.toThrow()
    },
  )

  it.each([
    'https://example.com',
    'example.com/iec/0522',
    'not a domain',
    'example',
    'example.com::x',
    'example.com:..:x',
    'example.com:a b',
    'example.com%3Aabc',
  ])('rejects %s', (domain) => {
    expect(() => assertValidDidWebDomain(domain)).toThrow()
  })
})
