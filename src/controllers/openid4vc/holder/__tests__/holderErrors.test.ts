import { StatusException } from '../../../../errors/StatusException'
import { readableHolderError, withReadableErrors } from '../holderErrors'

const readable = (message: string): StatusException => {
  const result = readableHolderError(new Error(message))
  if (!result) {
    throw new Error(`not recognised: ${message}`)
  }
  return result
}

describe('readableHolderError', () => {
  it('explains a missing transaction code', () => {
    const error = readable(
      "Retrieving access token requires a 'tx_code' in the request, but the 'txCode' parameter was not provided.",
    )
    expect(error.status).toBe(400)
    expect(error.message).toContain('needs a transaction code (PIN)')
  })

  it('explains an offer that cannot be fetched any more', () => {
    const error = readable(
      "Fetching credential offer from 'http://localhost:4001/oid4vci/x/offers/1' resulted in an unsuccessful response with status '404'",
    )
    expect(error.status).toBe(404)
    expect(error.message).toContain('already used, has expired or was withdrawn')
  })

  it('names the issuer address and status when its metadata cannot be read', () => {
    const error = readable(
      "Fetching well known metadata from 'http://localhost:4001/.well-known/openid-credential-issuer/oid4vci/x' resulted in an unsuccessful response with status '500'.",
    )
    expect(error.status).toBe(502)
    expect(error.message).toContain('answered 500')
  })

  it('explains the mDoc checks a wallet makes', () => {
    expect(
      readable(
        'Failed to validate mdoc credential(s). \n - (0) No trusted certificate was found while validating the X.509 chain',
      ).message,
    ).toContain('does not trust the certificate that signed the credential')
    expect(
      readable(
        "Failed to validate mdoc credential(s). \n - (0) The 'issuing_country' (IN) must match the 'countryName' (US) in the subject field",
      ).message,
    ).toContain('issuing country (IN)')
    expect(
      readable("(0) Country name (C) must be present in the issuer certificate's subject distinguished name").message,
    ).toContain('has no country (C)')
    expect(readable("Using a did for credential binding is not supported for the 'mso_mdoc' format.").status).toBe(422)
  })

  it('says when the credential is not valid at this time, with the dates', () => {
    const error = readable(
      'The MSO must be valid at the time of verification (Mon, 09 Nov 2026 19:14:40 GMT); its validity period is Mon, 09 Nov 2026 19:18:40 GMT to Wed, 09 Dec 2026 19:14:40 GMT (allowed clock skew 30s)',
    )
    expect(error.message).toContain('valid from Mon, 09 Nov 2026 19:18:40 GMT to Wed, 09 Dec 2026 19:14:40 GMT')
  })

  it('keeps the original text for whoever has to look into it', () => {
    const error = readable('No trusted certificate was found while validating the X.509 chain')
    expect(error.message.endsWith('[No trusted certificate was found while validating the X.509 chain]')).toBe(true)
  })

  it('leaves an error it does not know alone', () => {
    expect(readableHolderError(new Error('something else'))).toBeUndefined()
    expect(readableHolderError('not an error')).toBeUndefined()
  })
})

describe('withReadableErrors', () => {
  it('passes a result through, rewrites a known error and rethrows an unknown one as it was', async () => {
    await expect(withReadableErrors(async () => 'ok')).resolves.toBe('ok')

    await expect(
      withReadableErrors(async () => {
        throw new Error('No trusted certificate was found while validating the X.509 chain')
      }),
    ).rejects.toBeInstanceOf(StatusException)

    const unknown = new Error('boom')
    await expect(
      withReadableErrors(async () => {
        throw unknown
      }),
    ).rejects.toBe(unknown)
  })
})
