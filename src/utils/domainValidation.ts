import { BadRequestError } from '../errors'

// did:web only resolves against a real, publicly reachable domain (the DID
// method fetches https://<domain>/.well-known/did.json). A private IP,
// loopback, or localhost address is only reachable from the machine the
// agent happens to be running on, so a did:web created with one of these
// can never be resolved by anyone else - silently producing an unusable
// DID. This is a syntax/range check only; it deliberately makes no network
// call, since reachability (is anything actually listening there) is a
// separate concern from whether the domain is even the right *kind* of
// address to try.

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

// Inclusive [start, end] ranges, as 32-bit integers, for the private/
// special-use IPv4 blocks that can never be reached from outside the host.
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')], // RFC1918
  [ipv4ToInt('172.16.0.0'), ipv4ToInt('172.31.255.255')], // RFC1918 (covers 172.17.0.1)
  [ipv4ToInt('192.168.0.0'), ipv4ToInt('192.168.255.255')], // RFC1918
  [ipv4ToInt('127.0.0.0'), ipv4ToInt('127.255.255.255')], // loopback
  [ipv4ToInt('169.254.0.0'), ipv4ToInt('169.254.255.255')], // link-local
  [ipv4ToInt('0.0.0.0'), ipv4ToInt('0.255.255.255')], // "this network"
]

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

// RFC-1123-ish: labels of letters/digits/hyphens, no leading/trailing
// hyphen, and (for did:web's purposes) at least one dot - a bare
// single-label name is almost always an internal/private hostname rather
// than something with real public DNS delegation.
const HOSTNAME_REGEX = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/

function ipv4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split('.').map(Number)
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function isPrivateIpv4(host: string): boolean {
  const match = IPV4_REGEX.exec(host)
  if (!match) return false

  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return false

  const value = ipv4ToInt(host)
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end)
}

function isLoopbackOrPrivateIpv6(host: string): boolean {
  // Strip brackets if present (e.g. "[::1]").
  const normalized = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  // Not an IPv6 literal at all (plain hostnames/IPv4 never contain "::" or
  // multiple colons outside of a port separator).
  if (!normalized.includes(':')) return false

  const lower = normalized.toLowerCase()
  if (lower === '::1') return true // loopback
  if (lower === '::' || lower.startsWith('::ffff:0:')) return true // unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true // link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // unique local (fc00::/7)

  return false
}

// Splits a "host" or "host:port" string into its host part. Only strips a
// trailing ":<digits>" - this intentionally does not attempt full bracketed
// IPv6-with-port parsing, since that's not a realistic did:web domain shape
// in this codebase (handleWeb() builds the DID as a plain `did:web:${domain}`
// string with no bracket handling either).
function stripPort(domain: string): string {
  if (domain.startsWith('[')) {
    const closeBracket = domain.indexOf(']')
    return closeBracket === -1 ? domain : domain.slice(0, closeBracket + 1)
  }

  // A bare (unbracketed) IPv6 literal is itself made of multiple colons -
  // "host:port" splitting only makes sense for hostnames/IPv4, which have
  // at most one colon (the port separator). Leave anything with 2+ colons
  // untouched so e.g. "::1" isn't misread as host ":" + port "1".
  if ((domain.match(/:/g) ?? []).length >= 2) {
    return domain
  }

  const portMatch = /^(.*):(\d+)$/.exec(domain)
  return portMatch ? portMatch[1] : domain
}

export interface DomainValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Pure syntax/range check - no network I/O. Returns why a domain is
 * unsuitable for did:web instead of throwing, so callers can decide how to
 * surface it (API error, form validation message, etc).
 */
export function validatePublicWebDomain(domain: string): DomainValidationResult {
  if (!domain || !domain.trim()) {
    return { valid: false, reason: 'Domain is required' }
  }

  const host = stripPort(domain.trim())
  const unbracketedHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  if (LOOPBACK_HOSTNAMES.has(unbracketedHost.toLowerCase())) {
    return {
      valid: false,
      reason: `'${domain}' is a loopback address and cannot be used for did:web - did:web requires a publicly resolvable domain.`,
    }
  }

  if (isLoopbackOrPrivateIpv6(unbracketedHost)) {
    return {
      valid: false,
      reason: `'${domain}' is a loopback or private IPv6 address and cannot be used for did:web - did:web requires a publicly resolvable domain.`,
    }
  }

  if (isPrivateIpv4(unbracketedHost)) {
    return {
      valid: false,
      reason: `'${domain}' is a private/internal IP address and cannot be used for did:web - did:web requires a publicly resolvable domain.`,
    }
  }

  // If it parses as an IPv4 address but wasn't caught by isPrivateIpv4,
  // it's a public IPv4 literal - allowed, skip hostname syntax checking
  // (a bare public IP is a valid, if unusual, did:web domain).
  if (IPV4_REGEX.test(unbracketedHost)) {
    return { valid: true }
  }

  if (!HOSTNAME_REGEX.test(unbracketedHost)) {
    return {
      valid: false,
      reason: `'${domain}' is not a valid hostname for did:web - expected a fully-qualified public domain name (e.g. 'issuer.example.com').`,
    }
  }

  return { valid: true }
}

/** Throws BadRequestError with a specific, actionable message if invalid. */
export function assertPublicWebDomain(domain: string): void {
  const result = validatePublicWebDomain(domain)
  if (!result.valid) {
    throw new BadRequestError(result.reason)
  }
}
