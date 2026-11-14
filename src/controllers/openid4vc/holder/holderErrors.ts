import { StatusException } from '../../../errors/StatusException'

interface Rule {
  pattern: RegExp
  status: number
  message: (match: RegExpMatchArray) => string
}

// What the holder libraries say when an offer or a credential cannot be used, in words that mean something to the
// person using the wallet. The rule order matters: the first match wins.
const RULES: Rule[] = [
  {
    pattern: /Retrieving access token requires a 'tx_code'/,
    status: 400,
    message: () => 'This offer needs a transaction code (PIN). Ask the issuer for it and send it as txCode.',
  },
  {
    pattern: /Fetching credential offer from '[^']*' resulted in an unsuccessful response with status '404'/,
    status: 404,
    message: () =>
      'This credential offer was already used, has expired or was withdrawn. An offer works only once: ask the issuer for a new one.',
  },
  {
    pattern: /Fetching well known metadata from '([^']*)' resulted in an unsuccessful response with status '(\d+)'/,
    status: 502,
    message: (match) =>
      `The issuer's configuration could not be read (${match[1]} answered ${match[2]}). Tell the issuer: no credential can be issued until it is fixed.`,
  },
  {
    pattern: /No trusted certificate was found while validating the X\.509 chain/,
    status: 422,
    message: () =>
      "This wallet does not trust the certificate that signed the credential. The issuer's root certificate has to be in the wallet's trust list.",
  },
  {
    pattern: /The MSO must be valid at the time of verification .*its validity period is (.+?) to (.+?) \(/,
    status: 422,
    message: (match) =>
      `The credential is not valid at this time. It is valid from ${match[1]} to ${match[2]}. The issuer may need to issue it with other dates.`,
  },
  {
    pattern: /The MSO signed date .* must be within the validity period of the certificate/,
    status: 422,
    message: () => 'The credential was signed outside the validity of the certificate that signed it.',
  },
  {
    pattern: /The 'issuing_country' \((.+?)\) must match the 'countryName'/,
    status: 422,
    message: (match) =>
      `The credential's issuing country (${match[1]}) does not match the country of the certificate that signed it. The issuer has to fix the credential or use a certificate of the same country.`,
  },
  {
    pattern: /Country name \(C\) must be present in the issuer certificate/,
    status: 422,
    message: () =>
      'The certificate that signed this credential has no country (C) in its subject, which an mDoc requires. The issuer needs a certificate with a country.',
  },
  {
    pattern: /Using a did for credential binding is not supported for the 'mso_mdoc' format/,
    status: 422,
    message: () =>
      'An mDoc can be bound to a key but not to a DID. The issuer has to offer key (jwk) binding for this credential.',
  },
]

/**
 * A readable version of an error from resolving or requesting a credential, or undefined when the error is not one
 * of the known ones. The original text stays at the end, in brackets, for whoever has to look into it.
 */
export function readableHolderError(error: unknown): StatusException | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }

  for (const rule of RULES) {
    const match = error.message.match(rule.pattern)
    if (match) {
      return new StatusException(`${rule.message(match)} [${error.message.replace(/\s+/g, ' ').trim()}]`, rule.status)
    }
  }
  return undefined
}

/** Runs a holder call and turns a known failure into a readable error; any other error is passed on unchanged. */
export async function withReadableErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw readableHolderError(error) ?? error
  }
}
