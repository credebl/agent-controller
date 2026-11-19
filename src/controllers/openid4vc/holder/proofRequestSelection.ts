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

/** The subset of a PEX definition that determines how many submissions a requirement accepts. */
interface PexDefinitionForSelection {
  input_descriptors?: Array<{ id: string; group?: string[] }>
  submission_requirements?: Array<{ from?: string; count?: number; min?: number; max?: number }>
}

function requirementBounds(
  requirement: DifPexCredentialsForRequest['requirements'][number],
  definition: PexDefinitionForSelection | undefined,
): { min: number; max: number } {
  const descriptorIds = requirement.submissionEntry.map((entry) => entry.inputDescriptorId)
  const min = requirement.needsCount
  const max = min

  if (!definition?.submission_requirements?.length) return { min, max }

  const groupsByDescriptor = new Map<string, string[]>()
  for (const descriptor of definition.input_descriptors ?? []) {
    if (descriptor.id) groupsByDescriptor.set(descriptor.id, descriptor.group ?? [])
  }

  for (const submissionRequirement of definition.submission_requirements) {
    if (!submissionRequirement.from) continue

    const matches = descriptorIds.filter((id) => groupsByDescriptor.get(id)?.includes(submissionRequirement.from!))
    if (matches.length !== descriptorIds.length) continue

    const submissionMin = submissionRequirement.count ?? submissionRequirement.min ?? min
    const submissionMax = submissionRequirement.count ?? submissionRequirement.max ?? submissionMin
    return { min: submissionMin, max: submissionMax }
  }

  // The resolved requirement already normalizes count/min into needsCount. Without a matching
  // definition entry we cannot know a separate max, so we keep the automatic selection's cardinality.
  return { min, max }
}

function assertRequirementCount(
  requirement: DifPexCredentialsForRequest['requirements'][number],
  selection: DifPexInputDescriptorToCredentials,
  min: number,
  max: number,
): void {
  const descriptorIds = requirement.submissionEntry.map((entry) => entry.inputDescriptorId)
  const selectedCount = descriptorIds.filter((id) => (selection[id]?.length ?? 0) > 0).length
  const requirementName = requirement.name ? ` "${requirement.name}"` : ''

  if (selectedCount < min) {
    throw new BadRequestError(
      `The selected credentials do not satisfy submission requirement${requirementName}: expected at least ${min}, received ${selectedCount}`,
    )
  }
  if (selectedCount > max) {
    throw new BadRequestError(
      `The selected credentials do not satisfy submission requirement${requirementName}: expected at most ${max}, received ${selectedCount}`,
    )
  }
}

export function applyPresentationExchangeSelection(
  credentialsForRequest: DifPexCredentialsForRequest,
  autoSelection: DifPexInputDescriptorToCredentials,
  selection?: ProofRequestCredentialSelection,
  definition?: PexDefinitionForSelection,
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
  const selectedDescriptorIds = new Set(Object.keys(selection as ProofRequestCredentialSelection))
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

  // Credo's automatic selection stops at needsCount. A caller selection for a descriptor that was
  // not auto-selected would otherwise add an extra submission and break the requirement's count.
  const requirementDescriptorIds = credentialsForRequest.requirements.map((requirement) =>
    requirement.submissionEntry.map((entry) => entry.inputDescriptorId),
  )
  credentialsForRequest.requirements.forEach((requirement, requirementIndex) => {
    const descriptorIds = requirementDescriptorIds[requirementIndex]
    const selectedHere = descriptorIds.filter((id) => selectedDescriptorIds.has(id))
    if (selectedHere.length === 0) return

    const { min } = requirementBounds(requirement, definition)
    const autoHere = descriptorIds.filter(
      (id) => (autoSelection[id]?.length ?? 0) > 0 && !selectedDescriptorIds.has(id),
    )
    const keepFromAuto = autoHere.slice(0, Math.max(0, min - selectedHere.length))

    for (const id of autoHere) {
      if (keepFromAuto.includes(id)) continue

      // A descriptor can appear in more than one requirement. Keep it if another requirement
      // still relies on its automatic selection.
      const shared = requirementDescriptorIds.some(
        (ids, index) => index !== requirementIndex && ids.includes(id) && !selectedDescriptorIds.has(id),
      )
      if (!shared) delete result[id]
    }
  })

  credentialsForRequest.requirements.forEach((requirement, requirementIndex) => {
    if (!requirementDescriptorIds[requirementIndex].some((id) => selectedDescriptorIds.has(id))) return

    const { min, max } = requirementBounds(requirement, definition)
    assertRequirementCount(requirement, result, min, max)
  })

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

const OPENID4VP_CLIENT_ID_PREFIXES = [
  'pre-registered',
  'redirect_uri',
  'verifier_attestation',
  'https',
  'openid_federation',
  'did',
  'decentralized_identifier',
  'x509_san_uri',
  'x509_hash',
  'x509_san_dns',
  'origin',
  'web-origin',
]
const DC_API_RESPONSE_MODES = ['dc_api', 'dc_api.jwt', 'w3c_dc_api.jwt', 'w3c_dc_api']
const IAE_RESPONSE_MODES = ['iae_post', 'iae_post.jwt']

type VersionRequirement = readonly [operator: '<' | '>=', version: number]

function asRecord(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' ? (value as Record<string, any>) : {}
}

/**
 * Local equivalent of the version inference Credo uses. The upstream helper lives in an ESM-only
 * package that the repository's CommonJS Jest setup cannot import, so this mirrors only its
 * version-boundary rules.
 */
function parseAuthorizationRequestVersionNumber(payload: unknown): number {
  const request = asRecord(payload)
  const requirements: VersionRequirement[] = []
  const clientId = typeof request.client_id === 'string' ? request.client_id : undefined
  const responseMode = typeof request.response_mode === 'string' ? request.response_mode : undefined
  const clientMetadata = asRecord(request.client_metadata)
  const vpFormatsSupported = asRecord(clientMetadata.vp_formats_supported)
  const mdocFormats = asRecord(vpFormatsSupported.mso_mdoc)
  const isDcApi = responseMode !== undefined && DC_API_RESPONSE_MODES.includes(responseMode)

  if (responseMode !== undefined && IAE_RESPONSE_MODES.includes(responseMode)) requirements.push(['>=', 101])
  if (request.verifier_info) requirements.push(['>=', 100])
  if (request.verifier_attestations) requirements.push(['<', 100])
  if (mdocFormats.deviceauth_alg_values || mdocFormats.issuerauth_alg_values) requirements.push(['>=', 28])
  if (mdocFormats.issuer_signed_alg_values || mdocFormats.device_signed_alg_values) requirements.push(['<', 28])
  if (clientMetadata.vp_formats_supported) requirements.push(['>=', 27])
  if (clientMetadata.vp_formats) requirements.push(['<', 27])
  if (clientId?.startsWith('openid_federation:') || clientId?.startsWith('decentralized_identifier:')) {
    requirements.push(['>=', 26])
  }
  if (clientId?.startsWith('did:')) requirements.push(['<', 26])
  if (request.presentation_definition || request.presentation_definition_uri) requirements.push(['<', 26])
  if (request.verifier_attestations) requirements.push(['>=', 26])
  if (clientId?.startsWith('x509_san_uri:')) requirements.push(['<', 25])
  if (clientId?.startsWith('x509_hash:')) requirements.push(['>=', 25])
  if (clientId?.startsWith('web-origin:')) requirements.push(['<', 25])
  if (clientId?.startsWith('origin:')) requirements.push(['>=', 25])
  if (isDcApi && (responseMode === 'w3c_dc_api' || responseMode === 'w3c_dc_api.jwt')) {
    requirements.push(['<', 23], ['>=', 21])
  }
  if (isDcApi && (responseMode === 'dc_api' || responseMode === 'dc_api.jwt')) requirements.push(['>=', 23])
  if (isDcApi && (request.transaction_data || request.dcql_query)) requirements.push(['>=', 23])
  if (request.transaction_data) requirements.push(['>=', 22])
  if (request.client_id_scheme) requirements.push(['<', 22])
  if (clientId) {
    const scheme = clientId.substring(0, clientId.indexOf(':'))
    if (OPENID4VP_CLIENT_ID_PREFIXES.includes(scheme) && scheme !== 'did' && scheme !== 'https') {
      requirements.push(['>=', 22])
    }
  }
  if (!clientId) requirements.push(['>=', 21])
  if (request.dcql_query) requirements.push(['>=', 21])
  if (request.client_metadata_uri) requirements.push(['<', 21])
  if (isDcApi) requirements.push(['>=', 21])
  if (request.request_uri_method || request.wallet_nonce) requirements.push(['>=', 21])
  if (request.client_id_scheme === 'verifier_attestation') requirements.push(['>=', 20])
  if (request.client_id_scheme === 'x509_san_dns' || request.client_id_scheme === 'x509_san_uri') {
    requirements.push(['>=', 19])
  }

  const upperBounds = requirements.filter(([operator]) => operator === '<').map(([, version]) => version)
  const lowerBounds = requirements.filter(([operator]) => operator === '>=').map(([, version]) => version)
  const highestPossibleVersion = upperBounds.length > 0 ? Math.max(Math.min(...upperBounds) - 1, 18) : 101
  const lowestRequiredVersion = lowerBounds.length > 0 ? Math.max(...lowerBounds) : 18

  if (lowestRequiredVersion > highestPossibleVersion) {
    throw new BadRequestError(
      `Unable to infer OpenID4VP version from the authorization request (required ${lowestRequiredVersion}, allowed up to ${highestPossibleVersion})`,
    )
  }

  // Credo treats these ambiguous draft-25-looking requests as draft 24.
  if (
    highestPossibleVersion >= 24 &&
    highestPossibleVersion < 27 &&
    (!clientId || clientId.startsWith('x509_san_dns:'))
  ) {
    return 24
  }

  return highestPossibleVersion
}

/**
 * Credo can only encode multiple presentations per DCQL query when the resolved request uses
 * OpenID4VP 1.0. Earlier versions throw after signing every presentation, which surfaces as a 500.
 * Validate caller-supplied selections before that work starts.
 */
export function assertDcqlSelectionResponseCompatibility(
  selection: ProofRequestCredentialSelection | undefined,
  authorizationRequestPayload: unknown,
): void {
  if (!hasSelection(selection)) return

  const multiCredentialQueries = Object.entries(selection as ProofRequestCredentialSelection).filter(
    ([, credentialIds]) => credentialIds.length > 1,
  )
  if (multiCredentialQueries.length === 0) return

  const version = parseAuthorizationRequestVersionNumber(authorizationRequestPayload)
  if (version > 24) return

  const [queryId] = multiCredentialQueries[0]
  throw new BadRequestError(
    `OpenID4VP version ${version} cannot carry multiple presentations for DCQL query "${queryId}". Select one credential per query.`,
  )
}
