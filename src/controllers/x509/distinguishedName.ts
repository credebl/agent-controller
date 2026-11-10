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

  // Split on `/`, reading `\/` as a slash and `\\` as a backslash inside a value.
  const parts: string[] = ['']
  const body = name.slice(1)
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    const next = body[index + 1]
    if (char === '\\' && (next === '/' || next === '\\')) {
      parts[parts.length - 1] += next
      index += 1
    } else if (char === '/') {
      parts.push('')
    } else {
      parts[parts.length - 1] += char
    }
  }

  const attributes = parts
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf('=')
      const key = part.slice(0, separator).trim()
      // The comma form escapes `\` and `,` with a backslash.
      const value = part.slice(separator + 1).replace(/[\\,]/g, '\\$&')
      return `${key}=${value}`
    })

  return attributes.join(', ')
}
