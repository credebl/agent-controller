/**
 * The API documents an issuer or subject written as an OpenSSL style string, for example `/C=IN/O=Example/CN=Example CA`.
 * The X.509 module only parses the comma separated form (`C=IN, O=Example, CN=Example CA`) and takes a whole slash
 * separated string as one value, so the country of that example would become `IN/O=Example/CN=Example CA`. Convert the
 * slash form and pass anything else (the comma form or the name object) through unchanged.
 */
export function normalizeDistinguishedName<T>(name: T): T | string {
  if (typeof name !== 'string' || !name.startsWith('/')) {
    return name
  }

  const attributes = name
    .slice(1)
    // A `/` inside a value is escaped as `\/`.
    .split(/(?<!\\)\//)
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf('=')
      const key = part.slice(0, separator).trim()
      const value = part
        .slice(separator + 1)
        .replace(/\\\//g, '/')
        .replace(/,/g, '\\,')
      return `${key}=${value}`
    })

  return attributes.join(', ')
}
