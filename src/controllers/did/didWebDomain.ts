import { BadRequestError } from '../../errors'

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
// A host whose labels are all numeric is an IPv4 address, which did:web excludes.
const IPV4_HOST = /^(\d{1,3}\.){3}\d{1,3}$/
// Unreserved URI characters; a `:` separates path segments and `%3A` encodes a port.
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/
// DNS limits from RFC 1035: 253 presentation characters for a host, 63 for a label. Ports above 65535 cannot appear
// in a URL, so the resulting DID would not resolve to the expected location.
const MAX_HOST_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const MAX_PORT = 65535

/**
 * Checks the part of a did:web identifier after `did:web:`, for example `example.com` or
 * `ayanworks.github.io:iec:0522012345`: a host, an optional `%3A`-encoded port, then path segments separated by `:`.
 */
export const assertValidDidWebDomain = (domain: string): void => {
  const [hostPart, ...segments] = domain.split(':')
  const [host, port, ...extra] = hostPart.split('%3A')

  const validHost =
    host.length <= MAX_HOST_LENGTH &&
    !IPV4_HOST.test(host) &&
    (host === 'localhost' ||
      (host.includes('.') &&
        host.split('.').every((label) => label.length <= MAX_LABEL_LENGTH && HOST_LABEL.test(label))))
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
