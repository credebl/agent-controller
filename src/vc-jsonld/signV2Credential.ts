import type { SupportedV2ProofType } from './constants'
import type { AgentContext, JsonObject } from '@credo-ts/core'

import {
  DidsApi,
  Ed25519Signature2018,
  Ed25519Signature2020,
  JsonTransformer,
  VerificationMethod,
  W3cCredentialsModuleConfig,
  getPublicJwkFromVerificationMethod,
  parseDid,
  vcLibraries,
} from '@credo-ts/core'

import { DEFAULT_V2_PROOF_TYPE, SUPPORTED_V2_PROOF_TYPES } from './constants'
import { createKmsKeyPairClass } from './kmsKeyPair'

type DocumentLoader = (url: string) => Promise<any>

const SUITE_CLASSES: Record<string, any> = {
  Ed25519Signature2018,
  Ed25519Signature2020,
}

export interface SignV2CredentialOptions {
  credential: JsonObject
  verificationMethod: string
  proofType?: SupportedV2ProofType
  proofPurpose?: any
  created?: string
  documentLoader?: DocumentLoader
}

function resolveDocumentLoader(agentContext: AgentContext): DocumentLoader {
  const config = agentContext.dependencyManager.resolve(W3cCredentialsModuleConfig)
  return config.documentLoader(agentContext) as unknown as DocumentLoader
}

function resolveIssuerId(credential: JsonObject): string {
  const issuer = credential.issuer
  if (typeof issuer === 'string') return issuer
  if (issuer && typeof issuer === 'object' && typeof (issuer as { id?: unknown }).id === 'string') {
    return (issuer as { id: string }).id
  }
  throw new Error('Unable to resolve issuer id from credential')
}

function getSuiteClass(proofType: string): any {
  const SuiteClass = SUITE_CLASSES[proofType]
  if (!SuiteClass) {
    throw new Error(`Unsupported VCDM 2.0 proof type '${proofType}'. Supported: ${SUPPORTED_V2_PROOF_TYPES.join(', ')}`)
  }
  return SuiteClass
}

async function resolveSigningKey(
  agentContext: AgentContext,
  verificationMethod: string,
  documentLoader: DocumentLoader,
) {
  const dids = agentContext.dependencyManager.resolve(DidsApi)
  const verificationMethodObject = await documentLoader(verificationMethod)
  const verificationMethodInstance = JsonTransformer.fromJSON(verificationMethodObject.document, VerificationMethod)
  const did = parseDid(verificationMethod)
  const publicJwk = getPublicJwkFromVerificationMethod(verificationMethodInstance)
  const [didRecord] = await dids.getCreatedDids({ did: did.did })
  if (didRecord) {
    publicJwk.keyId =
      didRecord.keys?.find(({ didDocumentRelativeKeyId }) => didDocumentRelativeKeyId === `#${did.fragment}`)
        ?.kmsKeyId ?? publicJwk.legacyKeyId
  } else {
    publicJwk.keyId = publicJwk.legacyKeyId
  }
  return publicJwk
}

/**
 * Signs a VCDM 2.0 (`ldp_vc`) credential using Credo's low-level Data Integrity
 * primitives, working around the (V1-only) `W3cJsonLdVerifiableCredential` model.
 *
 * @returns The signed credential as a plain JSON object (raw proof, no V1 model).
 */
export async function signV2Credential(
  agentContext: AgentContext,
  options: SignV2CredentialOptions,
): Promise<Record<string, unknown>> {
  const documentLoader = options.documentLoader ?? resolveDocumentLoader(agentContext)
  const WalletKeyPair = createKmsKeyPairClass(agentContext)
  const signingKey = await resolveSigningKey(agentContext, options.verificationMethod, documentLoader)
  const proofType = options.proofType ?? DEFAULT_V2_PROOF_TYPE
  const SuiteClass = getSuiteClass(proofType)

  const keyPair = new WalletKeyPair({
    controller: resolveIssuerId(options.credential),
    id: options.verificationMethod,
    publicJwk: signingKey,
  })

  const suite = new SuiteClass({
    key: keyPair,
    LDKeyClass: WalletKeyPair,
    proof: { verificationMethod: options.verificationMethod },
    useNativeCanonize: false,
    date: options.created ?? new Date().toISOString(),
  })

  const issueOptions: Record<string, unknown> = {
    credential: options.credential,
    suite,
    documentLoader,
  }
  if (options.proofPurpose) issueOptions.purpose = options.proofPurpose

  return await vcLibraries.vc.issue(issueOptions)
}
