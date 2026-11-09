import { BadRequestError } from '../../errors'

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
// Unreserved URI characters; a `:` separates path segments and `%3A` encodes a port.
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/

/**
 * Checks the part of a did:web identifier after `did:web:`, for example `example.com` or
 * `ayanworks.github.io:iec:0522012345`: a host, an optional `%3A`-encoded port, then path segments separated by `:`.
 */
export const assertValidDidWebDomain = (domain: string): void => {
  const [hostPart, ...segments] = domain.split(':')
  const [host, port, ...extra] = hostPart.split('%3A')

  const validHost =
    host === 'localhost' || (host.includes('.') && host.split('.').every((label) => HOST_LABEL.test(label)))
  const validPort = port === undefined || /^\d{1,5}$/.test(port)

  if (!validHost || !validPort || extra.length > 0) {
    throw new BadRequestError(
      'domain must start with a valid host name, for example example.com (a port is written as example.com%3A3000)',
    )
  }

  const badSegment = segments.find((segment) => !PATH_SEGMENT.test(segment) || segment === '..')
  if (badSegment !== undefined) {
    throw new BadRequestError(
      `domain path segment "${badSegment}" is not valid; separate folders with ":" and use letters, numbers, ".", "_", "~" or "-"`,
    )
  }
}
