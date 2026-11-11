import type { DidDocument, VerificationMethod } from '@credo-ts/core'

import {
  deepEquality,
  DidDocument as CredoDidDocument,
  getPublicJwkFromVerificationMethod,
  Kms,
  TypedArrayEncoder,
} from '@credo-ts/core'
import { createPrivateKey, createPublicKey, type JsonWebKey } from 'node:crypto'

import { BadRequestError } from '../../errors'

import { assertValidDidWebDomain } from './didWebDomain'

const DID_WEB_PREFIX = 'did:web:'

// Every array that can hold a verification method, including inline methods that are not repeated in `verificationMethod`.
const DID_PURPOSES = [
  'verificationMethod',
  'authentication',
  'assertionMethod',
  'keyAgreement',
  'capabilityInvocation',
  'capabilityDelegation',
] as const

/**
 * Accepts a syntactically valid `did:web` identifier and rejects anything else before an import session is consumed.
 * The method-specific id has the same host / encoded port / `:` separated path grammar as a create request, except that
 * `~` is already percent-encoded (`%7E`) by `encodeDidWebDomain`, so it is decoded again for validation.
 */
export function assertValidDidWebIdentifier(did: unknown): asserts did is string {
  if (typeof did !== 'string' || !did.startsWith(DID_WEB_PREFIX)) {
    throw new BadRequestError('did must be a did:web identifier, for example did:web:example.com')
  }

  const methodSpecificId = did.slice(DID_WEB_PREFIX.length)
  if (!methodSpecificId || /[#?/]/.test(methodSpecificId)) {
    throw new BadRequestError(
      'did must be a did:web identifier without a fragment, query or URL path, for example did:web:example.com',
    )
  }

  try {
    assertValidDidWebDomain(methodSpecificId.replace(/%7E/gi, '~'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new BadRequestError(`did is not a valid did:web identifier: ${message}`)
  }
}

/**
 * Turns the externally supplied JSON into a Credo DID document. The document belongs to the authority, so it is used
 * as-is: no verification method is generated and no service is dropped.
 */
export function parseDidWebDocument(raw: unknown, did: string): DidDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('didDocument must be a JSON object')
  }

  let document: DidDocument
  try {
    document = CredoDidDocument.fromJSON(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new BadRequestError(`didDocument is not a valid DID document: ${message}`)
  }

  if (document.id !== did) {
    throw new BadRequestError(`didDocument.id "${document.id}" does not match did "${did}"`)
  }

  return document
}

/** A DID document can use relative (`#key-1`) or absolute verification method ids; lookups accept both forms. */
export function normalizeVerificationMethodId(did: string, id: string): string {
  return id.startsWith('#') ? `${did}${id}` : id
}

/** The `#fragment` Credo stores as `didDocumentRelativeKeyId`. */
export function verificationMethodRelativeId(id: string): string {
  const index = id.indexOf('#')
  if (index === -1) throw new BadRequestError(`Verification method id "${id}" has no fragment`)
  return id.slice(index)
}

/**
 * All verification methods the document defines, keyed by absolute id. Embedded methods are included in addition to the
 * ones listed under `verificationMethod`, so a key can be bound to a method the authority only references by purpose.
 */
export function verificationMethodsById(document: DidDocument): Map<string, VerificationMethod> {
  const methods = new Map<string, VerificationMethod>()

  try {
    for (const purpose of DID_PURPOSES) {
      for (const entry of document[purpose] ?? []) {
        const method = typeof entry === 'string' ? document.dereferenceVerificationMethod(entry) : entry
        methods.set(normalizeVerificationMethodId(document.id, method.id), method)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new BadRequestError(`didDocument has an invalid verification method reference: ${message}`)
  }

  return methods
}

function publicJwkThumbprint(publicJwk: Kms.PublicJwk): string {
  return TypedArrayEncoder.toBase64Url(publicJwk.getJwkThumbprint())
}

/** The thumbprint of the public half of a private JWK, used to compare it with a published verification method. */
export function privateJwkThumbprint(privateJwk: Kms.KmsJwkPrivate): string {
  let publicJwk: Kms.KmsJwkPublicAsymmetric
  try {
    const privateKey = createPrivateKey({ key: privateJwk as unknown as JsonWebKey, format: 'jwk' })
    publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as Kms.KmsJwkPublicAsymmetric
  } catch {
    throw new BadRequestError('The private key is not a valid JWK')
  }

  return publicJwkThumbprint(Kms.PublicJwk.fromPublicJwk(publicJwk))
}

/** The thumbprint of the public key published in a verification method. */
export function verificationMethodThumbprint(method: VerificationMethod): string {
  try {
    return publicJwkThumbprint(getPublicJwkFromVerificationMethod(method))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new BadRequestError(`Verification method "${method.id}" does not contain a supported public key: ${message}`)
  }
}

/**
 * Confirms that the supplied private key is the one the authority published. Without this check a caller could bind an
 * unrelated key to the document and sign credentials that no verifier can validate against the hosted document.
 */
export function assertPrivateKeyMatchesVerificationMethod(
  privateJwk: Kms.KmsJwkPrivate,
  method: VerificationMethod,
): void {
  if (privateJwkThumbprint(privateJwk) !== verificationMethodThumbprint(method)) {
    throw new BadRequestError(`The private key does not match verification method "${method.id}" in didDocument`)
  }
}

/** Compares the supplied document with the one the authority actually hosts, so the local copy cannot diverge. */
export function didDocumentsEqual(left: DidDocument, right: DidDocument): boolean {
  return deepEquality(left.toJSON(), right.toJSON())
}
