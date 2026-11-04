import type { DidX509Policy } from './x509.types'
import type { AgentContext } from '@credo-ts/core'
import type { JsonWebKey, KeyObject } from 'node:crypto'

import { DidRepository } from '@credo-ts/core'
import { computeFingerprintAsync, loadPemCertificateChain, loadX509Chain, pctEncode } from '@didx509/core'
import { createPrivateKey, createPublicKey, X509Certificate as NodeX509Certificate } from 'node:crypto'

import { BadRequestError } from '../../errors'

/** Key of the {@link DidRecord} metadata entry that holds the certificate chain a did:x509 is anchored in. */
export const X509_CHAIN_METADATA_KEY = 'x509chain'

type X509Certificate = ReturnType<typeof loadX509Chain>[number]

/**
 * Looks up the certificate chain stored with a did:x509 that was imported into this agent. Used by the resolver for
 * code paths in Credo that resolve a DID without being able to pass the chain along (signing, SD-JWT issuance...).
 *
 * Chains of DIDs this agent does not own are never stored. They have to come in through the credential itself (x5c).
 */
export async function getStoredX509Chain(did: string, agentContext: AgentContext): Promise<string | undefined> {
  const record = await agentContext.resolve(DidRepository).findCreatedDid(agentContext, did)
  return record?.metadata.get<{ chain: string }>(X509_CHAIN_METADATA_KEY)?.chain
}

/**
 * Accepts every shape certificate chains usually come in: a list of PEM certificates, a single PEM bundle, or
 * base64 (DER) strings, and returns the certificates leaf first.
 */
export function parseCertificateChain(input: string[]): X509Certificate[] {
  if (!input?.length) throw new BadRequestError('certificateChain must contain at least one certificate')

  return input.flatMap((entry) => {
    const trimmed = entry.trim()
    try {
      if (trimmed.includes('-----BEGIN')) return loadPemCertificateChain(trimmed)
      return loadX509Chain(Buffer.from(trimmed, 'base64').toString('base64url'))
    } catch (error) {
      throw new BadRequestError(`certificateChain contains an invalid certificate: ${(error as Error).message}`)
    }
  })
}

/** The `x509chain` resolution option: base64url DER certificates, comma separated, leaf first. */
export function toX509ChainOption(chain: X509Certificate[]): string {
  return chain.map((certificate) => Buffer.from(certificate.rawData).toString('base64url')).join(',')
}

/**
 * Builds the policy part of a did:x509, e.g. `subject:CN:example.com`, `san:dns:example.com` or `eku:1.3.6.1.5.5.7.3.3`.
 * Values are percent encoded as the did:x509 specification requires.
 */
export function buildPolicy(policy: DidX509Policy): string {
  switch (policy.type) {
    case 'subject': {
      const entries = Object.entries(policy.fields ?? {})
      if (!entries.length)
        throw new BadRequestError('A subject policy needs at least one field, e.g. { "CN": "example.com" }')
      const fields = entries.map(([key, value]) => pctEncode(key) + ':' + pctEncode(value)).join(':')
      return `subject:${fields}`
    }
    case 'san':
      if (!policy.sanType || !policy.value) throw new BadRequestError('A san policy needs sanType and value')
      return `san:${pctEncode(policy.sanType)}:${pctEncode(policy.value)}`
    case 'eku':
      if (!policy.value) throw new BadRequestError('An eku policy needs the OID as value')
      return `eku:${pctEncode(policy.value)}`
    case 'fulcio-issuer':
      if (!policy.value) throw new BadRequestError('A fulcio-issuer policy needs value')
      return `fulcio-issuer:${pctEncode(policy.value)}`
    default:
      throw new BadRequestError(`Unsupported did:x509 policy type '${(policy as { type: string }).type}'`)
  }
}

/**
 * Builds `did:x509:0:<alg>:<fingerprint of the root CA>::<policy>[::<policy>]`. The fingerprint anchors the DID in
 * the root (last certificate of the chain), the policies narrow down which leaf certificates may use it.
 */
export async function buildDidX509(chain: X509Certificate[], policies: DidX509Policy[]): Promise<string> {
  if (!policies.length) throw new BadRequestError('At least one policy is required to create a did:x509')
  const root = chain[chain.length - 1]
  const fingerprint = await computeFingerprintAsync(root, 'sha256')
  return `did:x509:0:sha256:${fingerprint}::${policies.map(buildPolicy).join('::')}`
}

/**
 * Reads a private key as exported by CA tooling: PEM (PKCS#8, SEC1 or PKCS#1, optionally encrypted) or base64 DER
 * (PKCS#8). The key types the did:x509 resolver can derive a verification method for are supported: EC P-256/384/521, Ed25519 and RSA.
 */
export function parsePrivateKey(privateKey: string, passphrase?: string): KeyObject {
  const trimmed = privateKey.trim()
  try {
    if (trimmed.includes('-----BEGIN')) return createPrivateKey({ key: trimmed, format: 'pem', passphrase })

    const der = Buffer.from(trimmed, 'base64')
    for (const type of ['pkcs8', 'sec1', 'pkcs1'] as const) {
      try {
        return createPrivateKey({ key: der, format: 'der', type, passphrase })
      } catch {
        // try next encoding
      }
    }
  } catch (error) {
    throw new BadRequestError(`Unable to read privateKey: ${(error as Error).message}`)
  }
  throw new BadRequestError(
    'Unable to read privateKey: expected a PEM or base64 DER (PKCS#8, SEC1, PKCS#1) private key',
  )
}

/** Throws unless the private key belongs to the leaf certificate's public key. */
export function assertKeyMatchesCertificate(privateKey: KeyObject, leaf: X509Certificate) {
  const leafPublicKey = new NodeX509Certificate(Buffer.from(leaf.rawData)).publicKey
  if (!createPublicKey(privateKey).equals(leafPublicKey)) {
    throw new BadRequestError(
      'privateKey does not match the public key of the first (leaf) certificate in certificateChain',
    )
  }
}

export function privateKeyToJwk(privateKey: KeyObject): JsonWebKey & { kty: string } {
  const jwk = privateKey.export({ format: 'jwk' }) as JsonWebKey & { kty: string }
  if (!jwk.d && !jwk.kty) throw new BadRequestError('Unable to export the private key as JWK')
  return jwk
}
