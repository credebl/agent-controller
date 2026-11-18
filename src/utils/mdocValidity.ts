import { BadRequestError } from '../errors'

export interface MdocValidityInput {
  signed?: string | Date
  validFrom?: string | Date
  validUntil?: string | Date
}

export interface MdocValidityInfo {
  signed: Date
  validFrom: Date
  validUntil: Date
}

/**
 * Builds the validity info of an mDoc from the issuance request.
 *
 * The mDoc library requires `signed` to be on or before `validFrom`, while the holder checks the document is valid when
 * it receives it. `signed` defaults to the moment of signing, which is when the holder redeems the offer, so a
 * `validFrom` chosen when the offer was created (now or earlier) would always be earlier than `signed` and be rejected.
 * Cap `signed` at `validFrom` so a `validFrom` in the past or the present works.
 */
export function buildMdocValidityInfo(input: MdocValidityInput | undefined, now: Date = new Date()): MdocValidityInfo {
  if (!input?.validFrom || !input?.validUntil) {
    throw new BadRequestError('validityInfo.validFrom and validityInfo.validUntil are required for an mDoc')
  }

  const validFrom = new Date(input.validFrom)
  const validUntil = new Date(input.validUntil)
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
    throw new BadRequestError('validityInfo.validFrom and validityInfo.validUntil must be valid dates')
  }
  if (validUntil.getTime() <= validFrom.getTime()) {
    throw new BadRequestError('validityInfo.validUntil must be after validityInfo.validFrom')
  }

  const requested = input.signed ? new Date(input.signed) : now
  const signed = Number.isNaN(requested.getTime()) || requested.getTime() > validFrom.getTime() ? validFrom : requested

  return { signed, validFrom, validUntil }
}
