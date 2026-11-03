import { BadRequestError } from '../../errors'
import { assertPublicWebDomain, validatePublicWebDomain } from '../domainValidation'

describe('validatePublicWebDomain', () => {
  it('accepts a plain public domain', () => {
    expect(validatePublicWebDomain('issuer.example.com')).toEqual({ valid: true })
  })

  it('accepts a public domain with a port', () => {
    expect(validatePublicWebDomain('issuer.example.com:8013')).toEqual({ valid: true })
  })

  it('accepts a public devtunnel-style domain', () => {
    expect(validatePublicWebDomain('7wkh080x-9013.inc1.devtunnels.ms')).toEqual({ valid: true })
  })

  it('accepts a public IPv4 literal', () => {
    expect(validatePublicWebDomain('8.8.8.8')).toEqual({ valid: true })
  })

  it('rejects localhost', () => {
    const result = validatePublicWebDomain('localhost')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/loopback/i)
  })

  it('rejects localhost with a port', () => {
    const result = validatePublicWebDomain('localhost:8013')
    expect(result.valid).toBe(false)
  })

  it('rejects the Docker bridge private IPv4 address that caused this bug (172.17.0.1)', () => {
    const result = validatePublicWebDomain('172.17.0.1:8017')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/private\/internal/i)
  })

  it.each(['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1', '169.254.1.1'])(
    'rejects private/loopback/link-local IPv4 address %s',
    (ip) => {
      expect(validatePublicWebDomain(ip).valid).toBe(false)
    },
  )

  it('rejects loopback IPv6 (::1)', () => {
    const result = validatePublicWebDomain('::1')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/ipv6/i)
  })

  it('rejects bracketed loopback IPv6 ([::1]) with a port', () => {
    const result = validatePublicWebDomain('[::1]:8013')
    expect(result.valid).toBe(false)
  })

  it('rejects unique-local IPv6 (fc00::/7)', () => {
    expect(validatePublicWebDomain('fd00::1').valid).toBe(false)
  })

  it('rejects an empty domain', () => {
    expect(validatePublicWebDomain('').valid).toBe(false)
  })

  it('rejects a malformed hostname', () => {
    expect(validatePublicWebDomain('not a valid host!!').valid).toBe(false)
  })

  it('rejects a bare single-label hostname (no public TLD)', () => {
    expect(validatePublicWebDomain('myagent').valid).toBe(false)
  })
})

describe('assertPublicWebDomain', () => {
  it('does not throw for a valid public domain', () => {
    expect(() => assertPublicWebDomain('issuer.example.com')).not.toThrow()
  })

  it('throws BadRequestError with a specific message for a private IP', () => {
    expect(() => assertPublicWebDomain('172.17.0.1:8017')).toThrow(BadRequestError)
    expect(() => assertPublicWebDomain('172.17.0.1:8017')).toThrow(/172\.17\.0\.1:8017/)
  })
})
