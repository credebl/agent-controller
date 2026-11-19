import { ClaimFormat } from '@credo-ts/core'

import { applyDcqlSelection, applyPresentationExchangeSelection } from '../proofRequestSelection'

// Avoid loading Credo's ESM/native dependencies in Jest; the selection helper only needs the ClaimFormat values.
jest.mock('@credo-ts/core', () => ({
  ClaimFormat: {
    SdJwtDc: 'dc+sd-jwt',
    SdJwtW3cVc: 'vc+sd-jwt',
    DiVc: 'di_vc',
    MsoMdoc: 'mso_mdoc',
  },
}))

const pexCredential = (id: string) =>
  ({
    claimFormat: ClaimFormat.SdJwtDc,
    credentialRecord: { id },
    disclosedPayload: { role: 'member' },
  }) as never

const pexRequest = {
  areRequirementsSatisfied: true,
  requirements: [
    {
      isRequirementSatisfied: true,
      needsCount: 1,
      rule: 'pick',
      submissionEntry: [
        { inputDescriptorId: 'role', verifiableCredentials: [pexCredential('auto-1'), pexCredential('chosen-2')] },
        { inputDescriptorId: 'mandate', verifiableCredentials: [pexCredential('mandate-1')] },
      ],
    },
  ],
} as never

const pexAutoSelection = {
  role: [pexCredential('auto-1')],
  mandate: [pexCredential('mandate-1')],
} as never

describe('applyPresentationExchangeSelection', () => {
  it('keeps Credo auto-selection when the caller did not choose anything', () => {
    expect(applyPresentationExchangeSelection(pexRequest, pexAutoSelection)).toBe(pexAutoSelection)
    expect(applyPresentationExchangeSelection(pexRequest, pexAutoSelection, {})).toBe(pexAutoSelection)
  })

  it('uses the credential the caller chose instead of the automatic one', () => {
    const result = applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: ['chosen-2'] })

    expect((result.role[0] as { credentialRecord: { id: string } }).credentialRecord.id).toBe('chosen-2')
  })

  it('leaves descriptors the caller did not mention on automatic selection', () => {
    const result = applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: ['chosen-2'] })

    expect((result.mandate[0] as { credentialRecord: { id: string } }).credentialRecord.id).toBe('mandate-1')
  })

  it('rejects an unknown input descriptor id', () => {
    expect(() => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { missing: ['chosen-2'] })).toThrow(
      'no input descriptor "missing"',
    )
  })

  it('rejects a credential that does not satisfy the descriptor', () => {
    expect(() => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: ['mandate-1'] })).toThrow(
      'Credential "mandate-1" does not satisfy input descriptor "role"',
    )
  })

  it('rejects an empty selection for a descriptor', () => {
    expect(() => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: [] })).toThrow(
      'must contain at least one credential id',
    )
  })
})

const dcqlValidCredential = (id: string, output: Record<string, unknown>) =>
  ({
    record: { id, type: 'SdJwtVcRecord' },
    claims: { valid_claim_sets: [{ output, disclosed_paths: [['role']] }] },
  }) as never

const dcqlQueryResult = {
  can_be_satisfied: true,
  credentials: [{ id: 'query-1' }],
  credential_matches: {
    'query-1': {
      success: true,
      valid_credentials: [
        dcqlValidCredential('auto-1', { role: 'member' }),
        dcqlValidCredential('chosen-2', { role: 'auditor' }),
      ],
    },
  },
} as never

const dcqlAutoSelection = {
  'query-1': [
    {
      claimFormat: ClaimFormat.SdJwtDc,
      credentialRecord: { id: 'auto-1' },
      disclosedPaths: [['role']],
      disclosedPayload: { role: 'member' },
    },
  ],
} as never

describe('applyDcqlSelection', () => {
  it('keeps Credo auto-selection when the caller did not choose anything', () => {
    expect(applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection)).toBe(dcqlAutoSelection)
    expect(applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, {})).toBe(dcqlAutoSelection)
  })

  it('builds a selection entry from the chosen credential, keeping its disclosed claims', () => {
    const result = applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { 'query-1': ['chosen-2'] })
    const entry = result['query-1'][0] as {
      credentialRecord: { id: string }
      claimFormat: ClaimFormat
      disclosedPayload: Record<string, unknown>
      disclosedPaths: unknown[]
    }

    expect(entry.credentialRecord.id).toBe('chosen-2')
    expect(entry.claimFormat).toBe(ClaimFormat.SdJwtDc)
    expect(entry.disclosedPayload).toEqual({ role: 'auditor' })
    expect(entry.disclosedPaths).toEqual([['role']])
  })

  it('rejects an unknown credential query id', () => {
    expect(() => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { missing: ['chosen-2'] })).toThrow(
      'no DCQL credential query "missing"',
    )
  })

  it('rejects a credential that does not satisfy the query', () => {
    expect(() => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { 'query-1': ['auto-9'] })).toThrow(
      'does not satisfy DCQL credential query "query-1"',
    )
  })

  it('rejects a query that cannot be satisfied', () => {
    const unsatisfied = {
      credential_matches: { 'query-1': { success: false } },
    } as never

    expect(() => applyDcqlSelection(unsatisfied, dcqlAutoSelection, { 'query-1': ['auto-1'] })).toThrow(
      'cannot be satisfied',
    )
  })
})
