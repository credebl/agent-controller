import type { ProofRequestCredentialSelection } from '../types/holder.types'
import type {
  DcqlCredentialsForRequest,
  DcqlQueryResult,
  DcqlValidCredential,
  DifPexCredentialsForRequest,
  DifPexInputDescriptorToCredentials,
  JsonObject,
  MdocNameSpaces,
  SubmissionEntryCredential,
} from '@credo-ts/core'

import { ClaimFormat } from '@credo-ts/core'

import { BadRequestError } from '../../../errors/errors'

/**
 * The caller chooses credentials by record id. Credo's accept API needs the full credential entries, so we start from
 * Credo's automatic selection (which is structurally correct for every format) and replace only the descriptors the
 * caller selected with entries looked up from what the resolved request actually offered.
 *
 * Unspecified descriptors keep the automatic selection, so adding `selectedCredentials` is backwards compatible.
 */

function hasSelection(selection: ProofRequestCredentialSelection | undefined): boolean {
  return selection !== undefined && Object.keys(selection).length > 0
}

function assertCredentialIds(key: string, credentialIds: string[]): void {
  if (
    !Array.isArray(credentialIds) ||
    credentialIds.length === 0 ||
    credentialIds.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    throw new BadRequestError(`selectedCredentials["${key}"] must contain at least one credential id`)
  }
}

export function applyPresentationExchangeSelection(
  credentialsForRequest: DifPexCredentialsForRequest,
  autoSelection: DifPexInputDescriptorToCredentials,
  selection?: ProofRequestCredentialSelection,
): DifPexInputDescriptorToCredentials {
  if (!hasSelection(selection)) return autoSelection

  const offered = new Map<string, SubmissionEntryCredential[]>()
  for (const requirement of credentialsForRequest.requirements) {
    for (const entry of requirement.submissionEntry) {
      const credentials = offered.get(entry.inputDescriptorId) ?? []
      for (const credential of entry.verifiableCredentials) {
        if (!credentials.some((candidate) => candidate.credentialRecord.id === credential.credentialRecord.id)) {
          credentials.push(credential)
        }
      }
      offered.set(entry.inputDescriptorId, credentials)
    }
  }

  const result: DifPexInputDescriptorToCredentials = { ...autoSelection }
  for (const [inputDescriptorId, credentialIds] of Object.entries(selection as ProofRequestCredentialSelection)) {
    const available = offered.get(inputDescriptorId)
    if (!available) {
      throw new BadRequestError(`The proof request has no input descriptor "${inputDescriptorId}"`)
    }
    assertCredentialIds(inputDescriptorId, credentialIds)

    result[inputDescriptorId] = credentialIds.map((credentialId) => {
      const credential = available.find((candidate) => candidate.credentialRecord.id === credentialId)
      if (!credential) {
        throw new BadRequestError(
          `Credential "${credentialId}" does not satisfy input descriptor "${inputDescriptorId}"`,
        )
      }
      return credential
    })
  }

  return result
}

function firstClaimSet(credential: DcqlValidCredential) {
  const claimSets = credential.claims?.valid_claim_sets
  if (!Array.isArray(claimSets) || claimSets.length === 0) {
    throw new BadRequestError('DCQL credential has no disclosable claim set')
  }
  return claimSets[0]
}

function selectiveDisclosure(credential: DcqlValidCredential) {
  const { output, disclosed_paths } = firstClaimSet(credential)
  const disclosedPayload = output as JsonObject
  return disclosed_paths ? { disclosedPaths: disclosed_paths, disclosedPayload } : { disclosedPayload }
}

/** Mirrors Credo's credential-query -> selection entry conversion, which is otherwise internal to DcqlService. */
function dcqlCredentialForRequest(credential: DcqlValidCredential): DcqlCredentialsForRequest[string][number] {
  const record = credential.record

  if (record.type === 'MdocRecord') {
    return {
      claimFormat: ClaimFormat.MsoMdoc,
      credentialRecord: record,
      disclosedPayload: firstClaimSet(credential).output as MdocNameSpaces,
    }
  }
  if (record.type === 'SdJwtVcRecord') {
    return {
      claimFormat: ClaimFormat.SdJwtDc,
      credentialRecord: record,
      ...selectiveDisclosure(credential),
    }
  }
  if (record.type === 'W3cCredentialRecord') {
    return {
      claimFormat: record.firstCredential.claimFormat,
      credentialRecord: record,
      disclosedPayload: record.firstCredential.jsonCredential as JsonObject,
    }
  }
  if (record.type === 'W3cV2CredentialRecord') {
    const claimFormat = record.firstCredential.claimFormat
    if (claimFormat === ClaimFormat.DiVc) {
      throw new BadRequestError('W3C V2 Data Integrity credentials are not supported for DCQL selection')
    }
    if (claimFormat === ClaimFormat.SdJwtW3cVc) {
      return { claimFormat, credentialRecord: record, ...selectiveDisclosure(credential) }
    }
    return {
      claimFormat,
      credentialRecord: record,
      disclosedPayload: firstClaimSet(credential).output as JsonObject,
    }
  }

  throw new BadRequestError('Unsupported credential record type for DCQL selection')
}

export function applyDcqlSelection(
  queryResult: DcqlQueryResult,
  autoSelection: DcqlCredentialsForRequest,
  selection?: ProofRequestCredentialSelection,
): DcqlCredentialsForRequest {
  if (!hasSelection(selection)) return autoSelection

  const result: DcqlCredentialsForRequest = { ...autoSelection }
  for (const [credentialQueryId, credentialIds] of Object.entries(selection as ProofRequestCredentialSelection)) {
    const match = queryResult.credential_matches[credentialQueryId]
    if (!match) {
      throw new BadRequestError(`The proof request has no DCQL credential query "${credentialQueryId}"`)
    }
    if (!match.success || !match.valid_credentials) {
      throw new BadRequestError(`DCQL credential query "${credentialQueryId}" cannot be satisfied`)
    }
    assertCredentialIds(credentialQueryId, credentialIds)

    const validCredentials = match.valid_credentials as DcqlValidCredential[]
    result[credentialQueryId] = credentialIds.map((credentialId) => {
      const credential = validCredentials.find((candidate) => candidate.record.id === credentialId)
      if (!credential) {
        throw new BadRequestError(
          `Credential "${credentialId}" does not satisfy DCQL credential query "${credentialQueryId}"`,
        )
      }
      return dcqlCredentialForRequest(credential)
    }) as DcqlCredentialsForRequest[string]
  }

  return result
}
