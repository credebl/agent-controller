import type { DcqlQueryResult, DifPexCredentialsForRequest } from '@credo-ts/core'

import { BadRequestError } from '../../../errors/errors'

/**
 * The credential records a holder chose to present, by DCQL credential query id or Presentation Exchange input
 * descriptor id.
 */
export type SelectedCredentials = Record<string, string[]>

/**
 * Restricts a resolved DCQL query result to the credentials the holder chose, so that Credo's automatic selection
 * presents exactly those.
 *
 * - A query in `selected` keeps only the chosen record. Credo presents one credential per query, so a query takes one
 *   record id.
 * - A query not in `selected` keeps its matches, and Credo picks as before, unless the query has credential sets. Then
 *   every query not chosen is dropped, so the option made of the chosen queries is the one presented.
 *
 * Throws a 400 for an unknown query id, a record that does not satisfy its query, or more than one record for a query.
 */
export function restrictDcqlQueryResult(queryResult: DcqlQueryResult, selected: SelectedCredentials): DcqlQueryResult {
  const queryIds = new Set(queryResult.credentials.map((query) => query.id))
  for (const [queryId, recordIds] of Object.entries(selected)) {
    if (!queryIds.has(queryId)) {
      throw new BadRequestError(
        `selectedCredentials names '${queryId}', which is not a credential query of this request. Queries: ${[...queryIds].join(', ')}.`,
      )
    }
    assertOneRecord(queryId, recordIds)
  }

  const hasCredentialSets = Boolean(queryResult.credential_sets?.length)
  const credentialMatches: Record<string, any> = {}
  for (const [queryId, match] of Object.entries(queryResult.credential_matches)) {
    const recordIds = selected[queryId]
    if (!recordIds) {
      credentialMatches[queryId] = hasCredentialSets ? { ...match, valid_credentials: [] } : match
      continue
    }
    const valid = match.success ? match.valid_credentials : []
    const chosen = valid.filter((candidate: any) => recordIds.includes(candidate.record?.id))
    if (chosen.length === 0) {
      throw new BadRequestError(
        `Credential ${recordIds[0]} does not satisfy credential query '${queryId}'. ` +
          `Matching credentials: ${idsOf(valid.map((candidate: any) => candidate.record?.id))}.`,
      )
    }
    credentialMatches[queryId] = { ...match, valid_credentials: chosen }
  }
  return { ...queryResult, credential_matches: credentialMatches } as DcqlQueryResult
}

/**
 * Restricts a Presentation Exchange result to the credentials the holder chose, so that Credo's automatic selection
 * presents exactly those.
 *
 * - An input descriptor in `selected` keeps only the chosen record. Credo presents one credential per descriptor.
 * - In a `pick` requirement, Credo presents the first `needsCount` submission entries, so the chosen descriptors are
 *   moved to the front.
 *
 * Throws a 400 for an unknown descriptor id, a record that does not satisfy its descriptor, or more than one record for
 * a descriptor.
 */
export function restrictPexCredentials(
  credentialsForRequest: DifPexCredentialsForRequest,
  selected: SelectedCredentials,
): DifPexCredentialsForRequest {
  const entries = credentialsForRequest.requirements.flatMap((requirement) => requirement.submissionEntry)
  const descriptorIds = new Set(entries.map((entry) => entry.inputDescriptorId))
  for (const [descriptorId, recordIds] of Object.entries(selected)) {
    if (!descriptorIds.has(descriptorId)) {
      throw new BadRequestError(
        `selectedCredentials names '${descriptorId}', which is not an input descriptor of this request. Input descriptors: ${[...descriptorIds].join(', ')}.`,
      )
    }
    assertOneRecord(descriptorId, recordIds)
  }

  const requirements = credentialsForRequest.requirements.map((requirement) => {
    const submissionEntry = requirement.submissionEntry.map((entry) => {
      const recordIds = selected[entry.inputDescriptorId]
      if (!recordIds) return entry
      const chosen = entry.verifiableCredentials.filter((candidate: any) =>
        recordIds.includes(candidate.credentialRecord?.id),
      )
      if (chosen.length === 0) {
        throw new BadRequestError(
          `Credential ${recordIds[0]} does not satisfy input descriptor '${entry.inputDescriptorId}'. ` +
            `Matching credentials: ${idsOf(entry.verifiableCredentials.map((candidate: any) => candidate.credentialRecord?.id))}.`,
        )
      }
      return { ...entry, verifiableCredentials: chosen }
    })
    // Stable: chosen descriptors first, the rest in their original order.
    const ordered = [
      ...submissionEntry.filter((entry) => selected[entry.inputDescriptorId]),
      ...submissionEntry.filter((entry) => !selected[entry.inputDescriptorId]),
    ]
    return { ...requirement, submissionEntry: ordered }
  })
  return { ...credentialsForRequest, requirements } as DifPexCredentialsForRequest
}

function assertOneRecord(id: string, recordIds: unknown) {
  if (!Array.isArray(recordIds) || recordIds.length !== 1 || typeof recordIds[0] !== 'string' || !recordIds[0]) {
    throw new BadRequestError(
      `selectedCredentials['${id}'] must list exactly one credential record id: one credential is presented per query.`,
    )
  }
}

function idsOf(ids: unknown[]): string {
  const present = ids.filter((id): id is string => typeof id === 'string')
  return present.length > 0 ? present.join(', ') : 'none'
}
