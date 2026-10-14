import type { AgentContext, JsonObject } from '@credo-ts/core'

import {
  Ed25519Signature2018,
  Ed25519Signature2020,
  W3cCredentialsModuleConfig,
  asArray,
  vcLibraries,
} from '@credo-ts/core'

import { SUPPORTED_V2_PROOF_TYPES } from './constants'
import { createKmsKeyPairClass } from './kmsKeyPair'

type DocumentLoader = (url: string) => Promise<any>

const SUITE_CLASSES: Record<string, any> = {
  Ed25519Signature2018,
  Ed25519Signature2020,
}

export interface VerifyV2CredentialOptions {
  credential: JsonObject
  proofPurpose?: any
  /**
   * Custom credential-status checker. Defaults to a no-op that always passes
   * (Bitstring Status List verification is handled separately by the platform).
   */
  checkStatus?: (options: { credential: JsonObject }) => { verified: boolean; error?: Error }
  documentLoader?: DocumentLoader
}

export interface VerifyV2CredentialResult {
  isValid: boolean
  error?: Error
  validations: Record<string, unknown>
}

function resolveDocumentLoader(agentContext: AgentContext): DocumentLoader {
  const config = agentContext.dependencyManager.resolve(W3cCredentialsModuleConfig)
  return config.documentLoader(agentContext) as unknown as DocumentLoader
}

function getSuiteClass(proofType: string): any {
  const SuiteClass = SUITE_CLASSES[proofType]
  if (!SuiteClass) {
    throw new Error(`Unsupported VCDM 2.0 proof type '${proofType}'. Supported: ${SUPPORTED_V2_PROOF_TYPES.join(', ')}`)
  }
  return SuiteClass
}

/**
 * Verifies a VCDM 2.0 (`ldp_vc`) JSON-LD credential signature using Credo's
 * low-level Data Integrity primitives.
 */
export async function verifyV2Credential(
  agentContext: AgentContext,
  options: VerifyV2CredentialOptions,
): Promise<VerifyV2CredentialResult> {
  const documentLoader = options.documentLoader ?? resolveDocumentLoader(agentContext)
  const WalletKeyPair = createKmsKeyPairClass(agentContext)

  const proofs = asArray((options.credential as { proof?: unknown }).proof) as Array<Record<string, unknown>>
  if (proofs.length === 0 || typeof proofs[0] !== 'object') {
    return { isValid: false, error: new Error('Credential has no proof to verify'), validations: {} }
  }

  const suites = proofs.map((proof) => {
    const SuiteClass = getSuiteClass(proof.type as string)
    return new SuiteClass({
      LDKeyClass: WalletKeyPair,
      proof: { verificationMethod: proof.verificationMethod },
      date: proof.created,
      useNativeCanonize: false,
    })
  })

  const verifyOptions: Record<string, unknown> = {
    credential: options.credential,
    suite: suites,
    documentLoader,
    checkStatus: options.checkStatus ?? (() => ({ verified: true })),
  }
  if (options.proofPurpose) verifyOptions.purpose = options.proofPurpose

  const result = await vcLibraries.vc.verifyCredential(verifyOptions)
  const { verified: isValid, ...remainingResult } = result

  return {
    isValid,
    validations: { vcJs: { isValid, ...remainingResult } },
    error: result.error,
  }
}
