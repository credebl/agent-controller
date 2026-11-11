import { BadRequestError } from '../../errors'

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
// URL parsing treats a host whose last label is an IPv4 number (decimal or `0x`-prefixed hex) as an IPv4 address
// and then fails on the other labels: `https://foo.123/` is not a valid URL, and did:web excludes IP addresses.
const IPV4_NUMBER = /^(0[xX][0-9a-fA-F]*|[0-9]+)$/
// Unreserved URI characters; a `:` separates path segments and `%3A` encodes a port.
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/
// DNS limits from RFC 1035: 253 presentation characters for a host, 63 for a label. Ports above 65535 cannot appear
// in a URL, so the resulting DID would not resolve to the expected location.
const MAX_HOST_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const MAX_PORT = 65535

/**
 * Checks the `domain` of a did:web create request: a host name, an optional `%3A`-encoded port, then path segments
 * separated by `:`, for example `example.com` or `ayanworks.github.io:iec:0522012345`. The domain is required.
 */
export const assertValidDidWebDomain = (domain: string | undefined): void => {
  if (!domain) {
    throw new BadRequestError('For create did:web, domain is required')
  }

  const [hostPart, ...segments] = domain.split(':')
  const [host, port, ...extra] = hostPart.split('%3A')
  const labels = host.split('.')

  const validHost =
    host.length <= MAX_HOST_LENGTH &&
    (host === 'localhost' ||
      (host.includes('.') &&
        labels.every((label) => label.length <= MAX_LABEL_LENGTH && HOST_LABEL.test(label)) &&
        !IPV4_NUMBER.test(labels[labels.length - 1])))
  const validPort = port === undefined || (/^\d{1,5}$/.test(port) && Number(port) <= MAX_PORT)

  if (!validHost || !validPort || extra.length > 0) {
    throw new BadRequestError(
      'domain must start with a valid host name, for example example.com (a port is written as example.com%3A3000)',
    )
  }

  // URL parsing removes a `.` segment and normalizes `..`, so both collide with shorter identifiers that resolve to
  // the same document URL.
  const badSegment = segments.find((segment) => !PATH_SEGMENT.test(segment) || segment === '.' || segment === '..')
  if (badSegment !== undefined) {
    throw new BadRequestError(
      `domain path segment "${badSegment}" is not valid; separate folders with ":" and use letters, numbers, ".", "_", "~" or "-"`,
    )
  }
}

/**
 * Encodes a validated domain into the part of the identifier after `did:web:`. DID Core allows only letters, digits,
 * `.`, `-`, `_` and percent-encoded octets there, so `~` becomes `%7E`: the domain `example.com:~` produces
 * `did:web:example.com:%7E`, whose document URL URL-parses back to the `~` folder. A host cannot contain `~`, so
 * only path segments are affected.
 */
export const encodeDidWebDomain = (domain: string): string => domain.replace(/~/g, '%7E')
