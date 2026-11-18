import { buildMdocValidityInfo } from '../mdocValidity'

const now = new Date('2026-11-09T12:00:00.000Z')

describe('buildMdocValidityInfo', () => {
  it('signs now when validFrom is in the future', () => {
    const info = buildMdocValidityInfo({ validFrom: '2026-11-10T00:00:00Z', validUntil: '2027-11-10T00:00:00Z' }, now)
    expect(info.signed).toEqual(now)
    expect(info.validFrom).toEqual(new Date('2026-11-10T00:00:00Z'))
  })

  it('does not sign after validFrom when it is now or in the past', () => {
    const past = buildMdocValidityInfo({ validFrom: '2026-11-09T11:00:00Z', validUntil: '2027-11-09T11:00:00Z' }, now)
    expect(past.signed).toEqual(new Date('2026-11-09T11:00:00Z'))
    expect(past.signed.getTime()).toBeLessThanOrEqual(past.validFrom.getTime())

    const present = buildMdocValidityInfo({ validFrom: now, validUntil: '2027-11-09T12:00:00Z' }, now)
    expect(present.signed).toEqual(now)
  })

  it('caps a requested signing time at validFrom', () => {
    const info = buildMdocValidityInfo(
      { signed: '2026-12-01T00:00:00Z', validFrom: '2026-11-09T11:00:00Z', validUntil: '2027-11-09T11:00:00Z' },
      now,
    )
    expect(info.signed).toEqual(new Date('2026-11-09T11:00:00Z'))
  })

  it('keeps an earlier requested signing time', () => {
    const info = buildMdocValidityInfo(
      { signed: '2026-11-01T00:00:00Z', validFrom: '2026-11-09T11:00:00Z', validUntil: '2027-11-09T11:00:00Z' },
      now,
    )
    expect(info.signed).toEqual(new Date('2026-11-01T00:00:00Z'))
  })

  it('rejects missing, invalid or reversed dates', () => {
    expect(() => buildMdocValidityInfo(undefined, now)).toThrow('required')
    expect(() => buildMdocValidityInfo({}, now)).toThrow('required')
    expect(() => buildMdocValidityInfo({ validFrom: 'nope', validUntil: '2027-01-01' }, now)).toThrow('valid dates')
    expect(() => buildMdocValidityInfo({ validFrom: '2027-01-01', validUntil: '2026-01-01' }, now)).toThrow('after')
  })
})
