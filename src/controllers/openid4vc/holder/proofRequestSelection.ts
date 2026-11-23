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
  input_descriptors?: Array<{ id: string; group?: string[]; name?: string }>
  submission_requirements?: Array<{
    from?: string
    rule?: string
    name?: string
    count?: number
    min?: number
    max?: number
  }>
}

interface EffectivePexRequirement {
  descriptorIds: string[]
  min: number
  max: number
  name?: string
}

function fromResolvedRequirement(
  requirement: DifPexCredentialsForRequest['requirements'][number],
): EffectivePexRequirement {
  const descriptorIds = requirement.submissionEntry.map((entry) => entry.inputDescriptorId)
  const min = requirement.needsCount ?? 1

  // Without the definition, needsCount is the only bound Credo exposes.
  return {
    descriptorIds,
    min,
    max: min,
    name: requirement.name ?? requirement.submissionEntry[0]?.name,
  }
}

/**
 * Credo creates one resolved requirement per definition entry and filters entries whose
 * needsCount is zero. Matching by group alone is ambiguous when several entries use the same
 * group, so keep the definition entries in their original order and pair them with the resolved
 * requirements.
 */
function effectivePexRequirements(
  definition: PexDefinitionForSelection | undefined,
  resolved: DifPexCredentialsForRequest['requirements'],
): EffectivePexRequirement[] {
  if (!definition) return resolved.map(fromResolvedRequirement)

  const descriptors = definition.input_descriptors ?? []
  const submissionRequirements = definition.submission_requirements ?? []
  const resolvedRequirements = resolved.filter((requirement) => (requirement.needsCount ?? 1) > 0)

  if (submissionRequirements.length === 0) {
    const candidates: EffectivePexRequirement[] = descriptors.map((descriptor) => ({
      descriptorIds: [descriptor.id],
      min: 1,
      max: 1,
      name: descriptor.name,
    }))
    if (candidates.length !== resolvedRequirements.length) return resolved.map(fromResolvedRequirement)
    return candidates.map((candidate, index) => ({
      ...candidate,
      name: candidate.name ?? resolvedRequirements[index].name,
    }))
  }

  const candidates: EffectivePexRequirement[] = []
  for (const submissionRequirement of submissionRequirements) {
    const from = submissionRequirement.from
    const descriptorIds = from
      ? descriptors.filter((descriptor) => descriptor.group?.includes(from)).map(({ id }) => id)
      : []
    const available = descriptorIds.length
    const ruleAll = submissionRequirement.rule === 'all'
    const min = ruleAll ? available : (submissionRequirement.count ?? submissionRequirement.min ?? 1)
    if (min <= 0) continue

    const max = ruleAll ? available : (submissionRequirement.count ?? submissionRequirement.max ?? available)
    candidates.push({ descriptorIds, min, max: Math.max(min, max), name: submissionRequirement.name })
  }

  if (candidates.length !== resolvedRequirements.length) return resolved.map(fromResolvedRequirement)
  return candidates.map((candidate, index) => ({
    ...candidate,
    name: candidate.name ?? resolvedRequirements[index].name,
  }))
}

function hasCredentialInSelection(selection: DifPexInputDescriptorToCredentials, descriptorId: string): boolean {
  return (selection[descriptorId]?.length ?? 0) > 0
}

function assertRequirementCount(
  requirement: EffectivePexRequirement,
  selection: DifPexInputDescriptorToCredentials,
): void {
  const selectedCount = requirement.descriptorIds.filter((id) => hasCredentialInSelection(selection, id)).length
  const requirementName = requirement.name ? ` "${requirement.name}"` : ''

  if (selectedCount < requirement.min) {
    throw new BadRequestError(
      `The selected credentials do not satisfy submission requirement${requirementName}: expected at least ${requirement.min}, received ${selectedCount}`,
    )
  }
  if (selectedCount > requirement.max) {
    throw new BadRequestError(
      `The selected credentials do not satisfy submission requirement${requirementName}: expected at most ${requirement.max}, received ${selectedCount}`,
    )
  }
}

function offeredPexCredentials(credentialsForRequest: DifPexCredentialsForRequest) {
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
  return offered
}

function resolveSelectedPexCredentials(
  offered: Map<string, SubmissionEntryCredential[]>,
  selection: ProofRequestCredentialSelection,
): DifPexInputDescriptorToCredentials {
  const selectedCredentials: DifPexInputDescriptorToCredentials = {}
  for (const [inputDescriptorId, credentialIds] of Object.entries(selection)) {
    const available = offered.get(inputDescriptorId)
    if (!available) {
      throw new BadRequestError(`The proof request has no input descriptor "${inputDescriptorId}"`)
    }
    assertCredentialIds(inputDescriptorId, credentialIds)

    selectedCredentials[inputDescriptorId] = credentialIds.map((credentialId) => {
      const credential = available.find((candidate) => candidate.credentialRecord.id === credentialId)
      if (!credential) {
        throw new BadRequestError(
          `Credential "${credentialId}" does not satisfy input descriptor "${inputDescriptorId}"`,
        )
      }
      return credential
    })
  }
  return selectedCredentials
}

/**
 * A caller selection replaces Credo's automatic choice for the requirements it belongs to.
 * Automatic entries stay untouched for requirements the caller did not select. Shared entries
 * are only added back when an affected requirement still needs them to reach its minimum.
 */
function retainedAutoDescriptorIds(
  requirements: EffectivePexRequirement[],
  autoSelection: DifPexInputDescriptorToCredentials,
  selectedDescriptorIds: Set<string>,
): Set<string> {
  const autoDescriptorIds = Object.entries(autoSelection)
    .filter(([, credentials]) => credentials.length > 0)
    .map(([descriptorId]) => descriptorId)

  const retainedDescriptorIds = new Set(selectedDescriptorIds)
  const untouchedRequirements = requirements.filter(
    (requirement) => !requirement.descriptorIds.some((id) => selectedDescriptorIds.has(id)),
  )
  for (const descriptorId of autoDescriptorIds) {
    if (untouchedRequirements.some((requirement) => requirement.descriptorIds.includes(descriptorId))) {
      retainedDescriptorIds.add(descriptorId)
    }
  }

  const touchedRequirements = requirements.filter((requirement) =>
    requirement.descriptorIds.some((id) => selectedDescriptorIds.has(id)),
  )
  for (const requirement of touchedRequirements) {
    const retainedCount = () => requirement.descriptorIds.filter((id) => retainedDescriptorIds.has(id)).length
    for (const descriptorId of requirement.descriptorIds) {
      if (retainedCount() >= requirement.min) break
      if (selectedDescriptorIds.has(descriptorId) || !autoDescriptorIds.includes(descriptorId)) continue
      retainedDescriptorIds.add(descriptorId)
    }
  }
  return retainedDescriptorIds
}

export function applyPresentationExchangeSelection(
  credentialsForRequest: DifPexCredentialsForRequest,
  autoSelection: DifPexInputDescriptorToCredentials,
  selection?: ProofRequestCredentialSelection,
  definition?: PexDefinitionForSelection,
): DifPexInputDescriptorToCredentials {
  if (!hasSelection(selection)) return autoSelection

  const selectedCredentials = resolveSelectedPexCredentials(
    offeredPexCredentials(credentialsForRequest),
    selection as ProofRequestCredentialSelection,
  )
  const selectedDescriptorIds = new Set(Object.keys(selectedCredentials))
  const requirements = effectivePexRequirements(definition, credentialsForRequest.requirements)
  const retainedDescriptorIds = retainedAutoDescriptorIds(requirements, autoSelection, selectedDescriptorIds)

  const result: DifPexInputDescriptorToCredentials = {}
  for (const [descriptorId, credentials] of Object.entries(autoSelection)) {
    if (retainedDescriptorIds.has(descriptorId)) result[descriptorId] = credentials
  }
  Object.assign(result, selectedCredentials)

  for (const requirement of requirements) {
    assertRequirementCount(requirement, result)
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

/**
 * With DCQL `credential_sets`, Credo's automatic selection presents the first option it can fulfil, which may be an
 * option the caller did not choose. When the caller selected credentials, every query they left out is emptied, so
 * only the option made of the chosen queries (plus options without any query) can be fulfilled. Without credential
 * sets, or without a selection, the result is returned unchanged and unselected queries stay automatic.
 */
export function restrictDcqlQueryResultToSelection(
  queryResult: DcqlQueryResult,
  selection?: ProofRequestCredentialSelection,
): DcqlQueryResult {
  if (!hasSelection(selection) || !queryResult.credential_sets?.length) return queryResult

  const credentialMatches = Object.fromEntries(
    Object.entries(queryResult.credential_matches).map(([queryId, match]) => [
      queryId,
      queryId in (selection as ProofRequestCredentialSelection) ? match : { ...match, valid_credentials: [] },
    ]),
  )
  return { ...queryResult, credential_matches: credentialMatches } as DcqlQueryResult
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

    const credentialQuery = queryResult.credentials?.find(({ id }) => id === credentialQueryId)
    if (credentialIds.length > 1 && credentialQuery?.multiple !== true) {
      throw new BadRequestError(
        `DCQL credential query "${credentialQueryId}" does not allow multiple credentials. Select one credential per query.`,
      )
    }

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

const OPENID4VP_CLIENT_ID_PREFIXES = new Set([
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
])
const DC_API_RESPONSE_MODES = new Set(['dc_api', 'dc_api.jwt', 'w3c_dc_api.jwt', 'w3c_dc_api'])
const IAE_RESPONSE_MODES = new Set(['iae_post', 'iae_post.jwt'])

type VersionRequirement = readonly [operator: '<' | '>=', version: number]

type PayloadRecord = Record<string, unknown>

function asRecord(value: unknown): PayloadRecord {
  return value !== null && typeof value === 'object' ? (value as PayloadRecord) : {}
}

function clientIdRequirements(request: PayloadRecord, clientId: string | undefined): VersionRequirement[] {
  const requirements: VersionRequirement[] = []
  if (clientId?.startsWith('openid_federation:') || clientId?.startsWith('decentralized_identifier:')) {
    requirements.push(['>=', 26])
  }
  if (clientId?.startsWith('did:')) requirements.push(['<', 26])
  if (clientId?.startsWith('x509_san_uri:')) requirements.push(['<', 25])
  if (clientId?.startsWith('x509_hash:')) requirements.push(['>=', 25])
  if (clientId?.startsWith('web-origin:')) requirements.push(['<', 25])
  if (clientId?.startsWith('origin:')) requirements.push(['>=', 25])
  if (clientId) {
    const scheme = clientId.substring(0, clientId.indexOf(':'))
    if (OPENID4VP_CLIENT_ID_PREFIXES.has(scheme) && scheme !== 'did' && scheme !== 'https') {
      requirements.push(['>=', 22])
    }
  } else {
    requirements.push(['>=', 21])
  }
  if (request.client_id_scheme) requirements.push(['<', 22])
  if (request.client_id_scheme === 'verifier_attestation') requirements.push(['>=', 20])
  if (request.client_id_scheme === 'x509_san_dns' || request.client_id_scheme === 'x509_san_uri') {
    requirements.push(['>=', 19])
  }
  return requirements
}

function responseModeRequirements(request: PayloadRecord, responseMode: string | undefined) {
  const requirements: VersionRequirement[] = []
  const isDcApi = responseMode !== undefined && DC_API_RESPONSE_MODES.has(responseMode)

  if (responseMode !== undefined && IAE_RESPONSE_MODES.has(responseMode)) requirements.push(['>=', 101])
  if (responseMode === 'w3c_dc_api' || responseMode === 'w3c_dc_api.jwt') requirements.push(['<', 23], ['>=', 21])
  if (responseMode === 'dc_api' || responseMode === 'dc_api.jwt') requirements.push(['>=', 23])
  if (isDcApi && (request.transaction_data || request.dcql_query)) requirements.push(['>=', 23])
  if (isDcApi) requirements.push(['>=', 21])
  return requirements
}

function clientMetadataRequirements(clientMetadata: PayloadRecord): VersionRequirement[] {
  const requirements: VersionRequirement[] = []
  const mdocFormats = asRecord(asRecord(clientMetadata.vp_formats_supported).mso_mdoc)

  if (mdocFormats.deviceauth_alg_values || mdocFormats.issuerauth_alg_values) requirements.push(['>=', 28])
  if (mdocFormats.issuer_signed_alg_values || mdocFormats.device_signed_alg_values) requirements.push(['<', 28])
  if (clientMetadata.vp_formats_supported) requirements.push(['>=', 27])
  if (clientMetadata.vp_formats) requirements.push(['<', 27])
  return requirements
}

function payloadFieldRequirements(request: PayloadRecord): VersionRequirement[] {
  const requirements: VersionRequirement[] = []
  if (request.verifier_info) requirements.push(['>=', 100])
  if (request.verifier_attestations) requirements.push(['<', 100], ['>=', 26])
  if (request.presentation_definition || request.presentation_definition_uri) requirements.push(['<', 26])
  if (request.transaction_data) requirements.push(['>=', 22])
  if (request.dcql_query) requirements.push(['>=', 21])
  if (request.client_metadata_uri) requirements.push(['<', 21])
  if (request.request_uri_method || request.wallet_nonce) requirements.push(['>=', 21])
  return requirements
}

/**
 * Local equivalent of the version inference Credo uses. The upstream helper lives in an ESM-only
 * package that the repository's CommonJS Jest setup cannot import, so this mirrors only its
 * version-boundary rules.
 */
function parseAuthorizationRequestVersionNumber(payload: unknown): number {
  const request = asRecord(payload)
  const clientId = typeof request.client_id === 'string' ? request.client_id : undefined
  const responseMode = typeof request.response_mode === 'string' ? request.response_mode : undefined
  const requirements: VersionRequirement[] = [
    ...responseModeRequirements(request, responseMode),
    ...clientMetadataRequirements(asRecord(request.client_metadata)),
    ...clientIdRequirements(request, clientId),
    ...payloadFieldRequirements(request),
  ]

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
