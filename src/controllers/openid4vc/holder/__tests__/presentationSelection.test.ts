import type { DcqlQueryResult, DifPexCredentialsForRequest } from '@credo-ts/core'

import { BadRequestError } from '../../../../errors/errors'
import { restrictDcqlQueryResult, restrictPexCredentials } from '../presentationSelection'

const match = (...ids: string[]) => ({
  success: true,
  valid_credentials: ids.map((id) => ({ success: true, record: { id } })),
})

const dcql = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    can_be_satisfied: true,
    credentials: [{ id: 'authvc' }, { id: 'pid' }],
    credential_matches: { authvc: match('used', 'fresh'), pid: match('pid-1') },
    ...overrides,
  }) as unknown as DcqlQueryResult

const recordIds = (result: DcqlQueryResult, queryId: string) =>
  (result.credential_matches[queryId] as any).valid_credentials.map((candidate: any) => candidate.record.id)

describe('restrictDcqlQueryResult', () => {
  it('keeps only the chosen record for a chosen query, and leaves the other queries to the agent', () => {
    const result = restrictDcqlQueryResult(dcql(), { authvc: ['used'] })
    expect(recordIds(result, 'authvc')).toEqual(['used'])
    expect(recordIds(result, 'pid')).toEqual(['pid-1'])
  })

  it('with credential sets, drops the queries not chosen so the chosen option is presented', () => {
    const result = restrictDcqlQueryResult(dcql({ credential_sets: [{ options: [['pid'], ['authvc']] }] }), {
      authvc: ['fresh'],
    })
    expect(recordIds(result, 'authvc')).toEqual(['fresh'])
    expect(recordIds(result, 'pid')).toEqual([])
  })

  it('refuses an unknown query, a record that does not match, and anything but one record', () => {
    expect(() => restrictDcqlQueryResult(dcql(), { other: ['used'] })).toThrow(BadRequestError)
    expect(() => restrictDcqlQueryResult(dcql(), { authvc: ['pid-1'] })).toThrow(
      "Credential pid-1 does not satisfy credential query 'authvc'. Matching credentials: used, fresh.",
    )
    expect(() => restrictDcqlQueryResult(dcql(), { authvc: ['used', 'fresh'] })).toThrow(/exactly one/)
    expect(() => restrictDcqlQueryResult(dcql(), { authvc: [] })).toThrow(/exactly one/)
  })

  it('refuses a record for a query that has no valid match', () => {
    const result = dcql({ credential_matches: { authvc: { success: false, valid_credentials: [] }, pid: match('p') } })
    expect(() => restrictDcqlQueryResult(result, { authvc: ['used'] })).toThrow('Matching credentials: none.')
  })
})

describe('restrictPexCredentials', () => {
  const pex = () =>
    ({
      areRequirementsSatisfied: true,
      requirements: [
        {
          rule: 'pick',
          needsCount: 1,
          submissionEntry: [
            { inputDescriptorId: 'pan', verifiableCredentials: [{ credentialRecord: { id: 'pan-1' } }] },
            {
              inputDescriptorId: 'authvc',
              verifiableCredentials: [{ credentialRecord: { id: 'a1' } }, { credentialRecord: { id: 'a2' } }],
            },
          ],
        },
      ],
    }) as unknown as DifPexCredentialsForRequest

  it('keeps only the chosen record and moves its descriptor first, so a pick requirement presents it', () => {
    const [requirement] = restrictPexCredentials(pex(), { authvc: ['a2'] }).requirements
    expect(requirement.submissionEntry.map((entry) => entry.inputDescriptorId)).toEqual(['authvc', 'pan'])
    expect(requirement.submissionEntry[0].verifiableCredentials.map((vc: any) => vc.credentialRecord.id)).toEqual([
      'a2',
    ])
  })

  it('refuses an unknown descriptor, a record that does not match, and anything but one record', () => {
    expect(() => restrictPexCredentials(pex(), { other: ['a1'] })).toThrow(/not an input descriptor/)
    expect(() => restrictPexCredentials(pex(), { authvc: ['pan-1'] })).toThrow(
      "Credential pan-1 does not satisfy input descriptor 'authvc'. Matching credentials: a1, a2.",
    )
    expect(() => restrictPexCredentials(pex(), { authvc: ['a1', 'a2'] })).toThrow(/exactly one/)
  })
})
