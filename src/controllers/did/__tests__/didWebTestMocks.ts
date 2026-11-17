import { createHash } from 'node:crypto'

/**
 * A small, functional stand-in for the parts of `@credo-ts/core` the did:web import code touches. Credo ships ESM and
 * cannot be loaded by the default Jest configuration, but the did:web import logic (document parsing, verification
 * method lookup, key thumbprints and document comparison) is plain enough to exercise against this subset.
 */
const PURPOSES = [
  'authentication',
  'assertionMethod',
  'keyAgreement',
  'capabilityInvocation',
  'capabilityDelegation',
] as const

type DidDocumentJson = Record<string, unknown>

function stripDid(did: string, id: string): string {
  return id.startsWith(did) ? id.slice(did.length) : id
}

function sameKeyId(did: string, left: string, right: string): boolean {
  return stripDid(did, left) === stripDid(did, right)
}

/** RFC 7638 thumbprint, only the members required for the key types used in these tests. */
function thumbprint(jwk: Record<string, unknown>): Buffer {
  let canonical: string
  if (jwk.kty === 'OKP') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })
  } else if (jwk.kty === 'EC') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  } else {
    canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })
  }
  return createHash('sha256').update(canonical).digest()
}

class VerificationMethod {
  public id!: string
  public type!: string
  public controller!: string
  public publicKeyBase58?: string
  public publicKeyJwk?: Record<string, unknown>
  public publicKeyMultibase?: string

  public constructor(options: Record<string, unknown>) {
    Object.assign(this, options)
  }
}

class DidDocument {
  public context?: string | string[]
  public id!: string
  public alsoKnownAs?: string[]
  public controller?: string | string[]
  public verificationMethod?: VerificationMethod[]
  public service?: unknown[]
  public authentication?: Array<string | VerificationMethod>
  public assertionMethod?: Array<string | VerificationMethod>
  public keyAgreement?: Array<string | VerificationMethod>
  public capabilityInvocation?: Array<string | VerificationMethod>
  public capabilityDelegation?: Array<string | VerificationMethod>

  public constructor(options: DidDocumentJson) {
    Object.assign(this, options)
  }

  public static fromJSON(raw: unknown): DidDocument {
    const json = raw as DidDocumentJson
    return new DidDocument({ ...json, context: json['@context'] })
  }

  public dereferenceVerificationMethod(keyId: string): VerificationMethod {
    const method = this.verificationMethod?.find((candidate) => sameKeyId(this.id, keyId, candidate.id))
    if (!method) throw new Error(`Unable to locate verification method with id '${keyId}'`)
    return method
  }

  public toJSON(): DidDocumentJson {
    const json: DidDocumentJson = {}
    if (this.context !== undefined) json['@context'] = this.context
    json.id = this.id
    if (this.alsoKnownAs !== undefined) json.alsoKnownAs = this.alsoKnownAs
    if (this.controller !== undefined) json.controller = this.controller
    if (this.verificationMethod !== undefined) json.verificationMethod = this.verificationMethod
    if (this.service !== undefined) json.service = this.service
    for (const purpose of PURPOSES) {
      if (this[purpose] !== undefined) json[purpose] = this[purpose]
    }
    return json
  }
}

class DidDocumentBuilder {
  private readonly document: DidDocumentJson

  public constructor(did: string) {
    this.document = {
      id: did,
      verificationMethod: [] as unknown[],
      authentication: [] as unknown[],
      assertionMethod: [] as unknown[],
      capabilityInvocation: [] as unknown[],
      capabilityDelegation: [] as unknown[],
    }
  }

  public addContext() {
    return this
  }
  public addVerificationMethod(method: unknown) {
    ;(this.document.verificationMethod as unknown[]).push(method)
    return this
  }
  public addAuthentication(keyId: string) {
    ;(this.document.authentication as unknown[]).push(keyId)
    return this
  }
  public addAssertionMethod(keyId: string) {
    ;(this.document.assertionMethod as unknown[]).push(keyId)
    return this
  }
  public addCapabilityInvocation(keyId: string) {
    ;(this.document.capabilityInvocation as unknown[]).push(keyId)
    return this
  }
  public addCapabilityDelegation(keyId: string) {
    ;(this.document.capabilityDelegation as unknown[]).push(keyId)
    return this
  }
  public build() {
    return this.document
  }
}

function deepEquality(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined)
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined)
  if (leftEntries.length !== rightEntries.length) return false

  return leftEntries.every(
    ([key, value]) => key in right && deepEquality(value, (right as Record<string, unknown>)[key]),
  )
}

const Kms = {
  KeyManagementModuleConfig: class {},
  KeyManagementKeyExistsError: class KeyManagementKeyExistsError extends Error {},
  PublicJwk: {
    fromPublicJwk: (jwk: Record<string, unknown>) => ({
      ...jwk,
      getJwkThumbprint: () => thumbprint(jwk),
    }),
  },
}

function verificationMethod(options: Record<string, unknown>, type: string) {
  return {
    id: (options.id ?? options.verificationMethodId) as string,
    type,
    controller: (options.controller ?? options.did) as string,
    publicKeyJwk: options.publicJwk,
  }
}

export function credoCoreMock() {
  return {
    Agent: class Agent {
      public config = { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }
    },
    inject: () => () => undefined,
    injectable: () => (target: unknown) => target,
    DidRepository: class {},
    DidDocument,
    DidDocumentBuilder,
    getPublicJwkFromVerificationMethod: (method: { publicKeyJwk?: Record<string, unknown> }) => {
      if (!method.publicKeyJwk) throw new Error('verification method has no publicKeyJwk')
      return Kms.PublicJwk.fromPublicJwk(method.publicKeyJwk)
    },
    deepEquality,
    TypedArrayEncoder: {
      toBase64Url: (value: Uint8Array) => Buffer.from(value).toString('base64url'),
      fromUtf8String: () => new Uint8Array(),
    },
    Hasher: { hash: () => new Uint8Array() },
    LogLevel: {},
    PeerDidNumAlgo: { ShortFormAndLongForm: 0 },
    DidKey: { fromPublicKey: () => ({}) },
    createPeerDidDocumentFromServices: () => ({}),
    getEd25519VerificationKey2018: (options: Record<string, unknown>) =>
      verificationMethod(options, 'Ed25519VerificationKey2018'),
    getEd25519VerificationKey2020: (options: Record<string, unknown>) =>
      verificationMethod(options, 'Ed25519VerificationKey2020'),
    getJsonWebKey2020: (options: Record<string, unknown>) => verificationMethod(options, 'JsonWebKey2020'),
    SECURITY_ED25519_2018_CONTEXT_URL: 'https://w3id.org/security/suites/ed25519-2018/v1',
    SECURITY_ED25519_2020_CONTEXT_URL: 'https://w3id.org/security/suites/ed25519-2020/v1',
    SECURITY_JWS_CONTEXT_URL: 'https://w3id.org/ns/security/jws/v1',
    VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018: 'Ed25519VerificationKey2018',
    VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020: 'Ed25519VerificationKey2020',
    Kms,
  }
}
