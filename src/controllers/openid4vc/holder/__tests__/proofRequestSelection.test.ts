import { ClaimFormat } from '@credo-ts/core'

import { BadRequestError } from '../../../../errors/errors'
import {
  applyDcqlSelection,
  applyPresentationExchangeSelection,
  assertDcqlSelectionResponseCompatibility,
} from '../proofRequestSelection'

// Avoid loading Credo's ESM/native dependencies in Jest; the selection helper only needs the ClaimFormat values.
jest.mock('@credo-ts/core', () => ({
  ClaimFormat: {
    SdJwtDc: 'dc+sd-jwt',
    SdJwtW3cVc: 'vc+sd-jwt',
    DiVc: 'di_vc',
    MsoMdoc: 'mso_mdoc',
    LdpVc: 'ldp_vc',
    JwtVc: 'jwt_vc',
    JwtW3cVc: 'vc+jwt',
  },
}))

const pexCredential = (id: string) =>
  ({
    claimFormat: ClaimFormat.SdJwtDc,
    credentialRecord: { id },
    disclosedPayload: { role: 'member' },
  }) as never

const pexRequestWithTwoDescriptors = () =>
  ({
    areRequirementsSatisfied: true,
    requirements: [
      {
        isRequirementSatisfied: true,
        needsCount: 1,
        rule: 'pick',
        submissionEntry: [
          { inputDescriptorId: 'role', verifiableCredentials: [pexCredential('chosen-2')] },
          { inputDescriptorId: 'mandate', verifiableCredentials: [pexCredential('mandate-1')] },
        ],
      },
    ],
  }) as never

const pexDefinitionWithGroup = (min: number, max: number) => ({
  input_descriptors: [
    { id: 'role', group: ['identity'] },
    { id: 'mandate', group: ['identity'] },
  ],
  submission_requirements: [{ from: 'identity', min, max }],
})

const pexRequest = {
  areRequirementsSatisfied: true,
  requirements: [
    {
      isRequirementSatisfied: true,
      needsCount: 2,
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

  it('rejects an unknown input descriptor id with BadRequestError', () => {
    const act = () => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { missing: ['chosen-2'] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('no input descriptor "missing"')
  })

  it('rejects a credential that does not satisfy the descriptor', () => {
    const act = () => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: ['mandate-1'] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('Credential "mandate-1" does not satisfy input descriptor "role"')
  })

  it('rejects an empty selection for a descriptor', () => {
    const act = () => applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: [] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('must contain at least one credential id')
  })

  it('rejects a malformed selection value', () => {
    const act = () =>
      applyPresentationExchangeSelection(pexRequest, pexAutoSelection, { role: '' as unknown as string[] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('must contain at least one credential id')
  })

  it('replaces the automatic submission when the caller selects a different descriptor', () => {
    const request = {
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
    const autoSelection = { role: [pexCredential('auto-1')] } as never

    const result = applyPresentationExchangeSelection(request, autoSelection, { mandate: ['mandate-1'] })

    expect(result.role).toBeUndefined()
    expect((result.mandate[0] as { credentialRecord: { id: string } }).credentialRecord.id).toBe('mandate-1')
  })

  it('rejects selections that exceed the submission requirement max', () => {
    const definition = pexDefinitionWithGroup(1, 1)

    const act = () =>
      applyPresentationExchangeSelection(
        pexRequestWithTwoDescriptors(),
        { role: [pexCredential('auto-1')] } as never,
        {
          role: ['chosen-2'],
          mandate: ['mandate-1'],
        },
        definition,
      )

    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('expected at most 1')
  })

  it('fills unselected slots from the automatic selection within a min/max range', () => {
    const definition = pexDefinitionWithGroup(2, 2)

    const result = applyPresentationExchangeSelection(
      pexRequestWithTwoDescriptors(),
      { mandate: [pexCredential('mandate-1')] } as never,
      { role: ['chosen-2'] },
      definition,
    )

    expect(Object.keys(result).sort()).toEqual(['mandate', 'role'])
  })

  it('replaces the automatic choice when the caller selects another descriptor in the same count', () => {
    const request = {
      requirements: [
        {
          needsCount: 1,
          rule: 'pick',
          submissionEntry: [
            { inputDescriptorId: 'role', verifiableCredentials: [pexCredential('auto-1'), pexCredential('chosen-2')] },
            { inputDescriptorId: 'mandate', verifiableCredentials: [pexCredential('mandate-1')] },
          ],
        },
      ],
    } as never
    const definition = {
      input_descriptors: [
        { id: 'role', group: ['identity'] },
        { id: 'mandate', group: ['identity'] },
      ],
      submission_requirements: [{ from: 'identity', rule: 'pick', count: 1 }],
    }

    const result = applyPresentationExchangeSelection(
      request,
      { role: [pexCredential('auto-1')] } as never,
      { mandate: ['mandate-1'] },
      definition,
    )

    expect(result.role).toBeUndefined()
    expect((result.mandate[0] as { credentialRecord: { id: string } }).credentialRecord.id).toBe('mandate-1')
  })

  it('keeps bounds from separate definition entries that use the same group', () => {
    const descriptorIds = ['role', 'mandate', 'extra']
    const submissionEntry = descriptorIds.map((id) => ({
      inputDescriptorId: id,
      verifiableCredentials: [pexCredential(`${id}-1`)],
    }))
    const request = {
      requirements: [
        { needsCount: 1, rule: 'pick', submissionEntry },
        { needsCount: 2, rule: 'pick', submissionEntry },
      ],
    } as never
    const definition = {
      input_descriptors: descriptorIds.map((id) => ({ id, group: ['identity'] })),
      submission_requirements: [
        { from: 'identity', rule: 'pick', min: 1, max: 3 },
        { from: 'identity', rule: 'pick', count: 2 },
      ],
    }

    const act = () =>
      applyPresentationExchangeSelection(
        request,
        { role: [pexCredential('role-1')] } as never,
        Object.fromEntries(descriptorIds.map((id) => [id, [`${id}-1`]])),
        definition,
      )

    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('expected at most 2')
  })

  it('allows more submissions when the definition has a min but no max', () => {
    const request = pexRequestWithTwoDescriptors()
    const definition = {
      input_descriptors: [
        { id: 'role', group: ['identity'] },
        { id: 'mandate', group: ['identity'] },
      ],
      submission_requirements: [{ from: 'identity', rule: 'pick', min: 1 }],
    }

    const result = applyPresentationExchangeSelection(
      request,
      { role: [pexCredential('auto-1')] } as never,
      { role: ['chosen-2'], mandate: ['mandate-1'] },
      definition,
    )

    expect(Object.keys(result).sort()).toEqual(['mandate', 'role'])
  })

  it('does not retain a shared automatic entry when the caller already satisfies both requirements', () => {
    const request = {
      requirements: [
        {
          needsCount: 1,
          rule: 'pick',
          submissionEntry: [
            { inputDescriptorId: 'role', verifiableCredentials: [pexCredential('role-1')] },
            { inputDescriptorId: 'mandate', verifiableCredentials: [pexCredential('mandate-1')] },
          ],
        },
        {
          needsCount: 1,
          rule: 'pick',
          submissionEntry: [
            { inputDescriptorId: 'mandate', verifiableCredentials: [pexCredential('mandate-1')] },
            { inputDescriptorId: 'extra', verifiableCredentials: [pexCredential('extra-1')] },
          ],
        },
      ],
    } as never
    const definition = {
      input_descriptors: [
        { id: 'role', group: ['first'] },
        { id: 'mandate', group: ['first', 'second'] },
        { id: 'extra', group: ['second'] },
      ],
      submission_requirements: [
        { from: 'first', rule: 'pick', count: 1 },
        { from: 'second', rule: 'pick', count: 1 },
      ],
    }

    const result = applyPresentationExchangeSelection(
      request,
      { role: [pexCredential('role-1')] } as never,
      { mandate: ['mandate-1'] },
      definition,
    )

    expect(Object.keys(result)).toEqual(['mandate'])
  })
})

const dcqlValidCredential = (id: string, output: Record<string, unknown>) =>
  ({
    record: { id, type: 'SdJwtVcRecord' },
    claims: { valid_claim_sets: [{ output, disclosed_paths: [['role']] }] },
  }) as never

const dcqlQueryResult = {
  can_be_satisfied: true,
  credentials: [{ id: 'query-1', multiple: false }],
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

  it('rejects an unknown credential query id with BadRequestError', () => {
    const act = () => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { missing: ['chosen-2'] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('no DCQL credential query "missing"')
  })

  it('rejects a credential that does not satisfy the query', () => {
    const act = () => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { 'query-1': ['auto-9'] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('does not satisfy DCQL credential query "query-1"')
  })

  it('rejects a query that cannot be satisfied', () => {
    const unsatisfied = {
      credential_matches: { 'query-1': { success: false } },
    } as never

    const act = () => applyDcqlSelection(unsatisfied, dcqlAutoSelection, { 'query-1': ['auto-1'] })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('cannot be satisfied')
  })

  it('rejects a malformed selection value', () => {
    const act = () => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { 'query-1': [42] as never })
    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('must contain at least one credential id')
  })

  it('rejects multiple credentials when the DCQL query did not enable multiple', () => {
    const act = () => applyDcqlSelection(dcqlQueryResult, dcqlAutoSelection, { 'query-1': ['auto-1', 'chosen-2'] })

    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('does not allow multiple credentials')
  })

  it('allows multiple credentials when the DCQL query enabled multiple', () => {
    const queryResult = {
      ...dcqlQueryResult,
      credentials: [{ id: 'query-1', multiple: true }],
    } as never

    const result = applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['auto-1', 'chosen-2'] })

    expect(result['query-1']).toHaveLength(2)
  })

  it('rejects a credential with no disclosable claim set', () => {
    const noClaimSet = {
      credential_matches: {
        'query-1': {
          success: true,
          valid_credentials: [{ record: { id: 'no-claims', type: 'SdJwtVcRecord' }, claims: {} }],
        },
      },
    } as never

    expect(() => applyDcqlSelection(noClaimSet, dcqlAutoSelection, { 'query-1': ['no-claims'] })).toThrow(
      BadRequestError,
    )
  })

  it('builds an mdoc selection entry from the first claim set', () => {
    const mdoc = {
      record: { id: 'mdoc-1', type: 'MdocRecord' },
      claims: { valid_claim_sets: [{ output: { 'org.iso.18013.5.1': { family_name: 'Doe' } } }] },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [mdoc] } },
    } as never

    const result = applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['mdoc-1'] })
    const entry = result['query-1'][0] as {
      claimFormat: ClaimFormat
      credentialRecord: { id: string }
      disclosedPayload: Record<string, unknown>
    }

    expect(entry.claimFormat).toBe(ClaimFormat.MsoMdoc)
    expect(entry.credentialRecord.id).toBe('mdoc-1')
    expect(entry.disclosedPayload).toEqual({ 'org.iso.18013.5.1': { family_name: 'Doe' } })
  })

  it('builds a W3C credential selection entry from the JSON credential', () => {
    const jsonCredential = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'] }
    const w3c = {
      record: {
        id: 'w3c-1',
        type: 'W3cCredentialRecord',
        firstCredential: { claimFormat: ClaimFormat.LdpVc, jsonCredential },
      },
      claims: { valid_claim_sets: [{ output: { ignored: true } }] },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [w3c] } },
    } as never

    const result = applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['w3c-1'] })
    const entry = result['query-1'][0] as {
      claimFormat: ClaimFormat
      credentialRecord: { id: string }
      disclosedPayload: Record<string, unknown>
    }

    expect(entry.claimFormat).toBe(ClaimFormat.LdpVc)
    expect(entry.credentialRecord.id).toBe('w3c-1')
    expect(entry.disclosedPayload).toBe(jsonCredential)
  })

  it('builds a JWT W3C credential selection entry from the JSON credential', () => {
    const jsonCredential = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'] }
    const jwtVc = {
      record: {
        id: 'jwt-vc-1',
        type: 'W3cCredentialRecord',
        firstCredential: { claimFormat: ClaimFormat.JwtVc, jsonCredential },
      },
      claims: { valid_claim_sets: [{ output: { ignored: true } }] },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [jwtVc] } },
    } as never

    const result = applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['jwt-vc-1'] })
    const entry = result['query-1'][0] as {
      claimFormat: ClaimFormat
      credentialRecord: { id: string }
      disclosedPayload: Record<string, unknown>
    }

    expect(entry.claimFormat).toBe(ClaimFormat.JwtVc)
    expect(entry.credentialRecord.id).toBe('jwt-vc-1')
    expect(entry.disclosedPayload).toBe(jsonCredential)
  })

  it('builds a W3C V2 SD-JWT selection entry with selective disclosure', () => {
    const w3cV2 = {
      record: {
        id: 'w3c-v2-1',
        type: 'W3cV2CredentialRecord',
        firstCredential: { claimFormat: ClaimFormat.SdJwtW3cVc },
      },
      claims: {
        valid_claim_sets: [{ output: { role: 'member' }, disclosed_paths: [['role']] }],
      },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [w3cV2] } },
    } as never

    const result = applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['w3c-v2-1'] })
    const entry = result['query-1'][0] as {
      claimFormat: ClaimFormat
      disclosedPayload: Record<string, unknown>
      disclosedPaths: unknown[]
    }

    expect(entry.claimFormat).toBe(ClaimFormat.SdJwtW3cVc)
    expect(entry.disclosedPayload).toEqual({ role: 'member' })
    expect(entry.disclosedPaths).toEqual([['role']])
  })

  it('rejects W3C V2 Data Integrity credentials for DCQL selection', () => {
    const w3cV2Di = {
      record: { id: 'w3c-v2-di', type: 'W3cV2CredentialRecord', firstCredential: { claimFormat: ClaimFormat.DiVc } },
      claims: { valid_claim_sets: [{ output: {} }] },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [w3cV2Di] } },
    } as never

    expect(() => applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['w3c-v2-di'] })).toThrow(
      BadRequestError,
    )
  })

  it('rejects unsupported credential record types', () => {
    const unknown = {
      record: { id: 'unknown', type: 'SomethingElse' },
      claims: { valid_claim_sets: [{ output: {} }] },
    } as never
    const queryResult = {
      credential_matches: { 'query-1': { success: true, valid_credentials: [unknown] } },
    } as never

    expect(() => applyDcqlSelection(queryResult, dcqlAutoSelection, { 'query-1': ['unknown'] })).toThrow(
      BadRequestError,
    )
  })
})

describe('assertDcqlSelectionResponseCompatibility', () => {
  it('does not infer a version when no multi-credential selection was supplied', () => {
    const conflictingPayload = { client_id: 'web-origin:https://example.com', verifier_attestations: {} }

    expect(() => assertDcqlSelectionResponseCompatibility(undefined, conflictingPayload)).not.toThrow()
    expect(() => assertDcqlSelectionResponseCompatibility({}, conflictingPayload)).not.toThrow()
    expect(() => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one'] }, conflictingPayload)).not.toThrow()
  })

  it('allows multiple presentations for OpenID4VP 1.0 requests', () => {
    const payload = { client_id: 'x509_hash:abc' }

    expect(() => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one', 'two'] }, payload)).not.toThrow()
  })

  it('rejects multiple presentations before signing for draft requests', () => {
    const payload = { client_id: 'x509_san_uri:https://example.com' }
    const act = () => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one', 'two'] }, payload)

    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('OpenID4VP version 24')
    expect(act).toThrow('cannot carry multiple presentations for DCQL query "query-1"')
  })

  it("treats Credo's ambiguous x509_san_dns PEX requests as draft 24", () => {
    const payload = { client_id: 'x509_san_dns:example.com', presentation_definition: {} }
    const act = () => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one', 'two'] }, payload)

    expect(act).toThrow('OpenID4VP version 24')
  })

  it('treats x509_san_dns requests with legacy vp_formats as draft 24', () => {
    const payload = { client_id: 'x509_san_dns:example.com', client_metadata: { vp_formats: {} } }
    const act = () => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one', 'two'] }, payload)

    expect(act).toThrow('OpenID4VP version 24')
  })

  it('rejects an authorization request whose version bounds conflict', () => {
    const payload = { client_id: 'web-origin:https://example.com', verifier_attestations: {} }
    const act = () => assertDcqlSelectionResponseCompatibility({ 'query-1': ['one', 'two'] }, payload)

    expect(act).toThrow(BadRequestError)
    expect(act).toThrow('Unable to infer OpenID4VP version')
  })
})
