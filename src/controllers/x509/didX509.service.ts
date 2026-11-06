import type { DidX509ChainResponse, DidX509ImportOptionsDto, DidX509ImportResponse } from './x509.types'
import type { AgentType } from '../../types'

import { openBaoKeyId } from '@credebl/credo-ts-openbao'
import { DidRepository, Kms, TypedArrayEncoder } from '@credo-ts/core'
import { createPublicKey } from 'node:crypto'

import { BadRequestError } from '../../errors'
import { NODE_KMS_BACKEND } from '../../utils/kms/nodeKms'
import { OPENBAO_KMS_BACKEND, openBaoBackendForJwk } from '../../utils/kms/openBao'

import {
  assertKeyMatchesCertificate,
  buildDidX509,
  getStoredX509Chain,
  parseCertificateChain,
  parsePrivateKey,
  privateKeyToJwk,
  toX509ChainOption,
  X509_CHAIN_METADATA_KEY,
} from './didX509.utils'

class DidX509Service {
  /**
   * Turns an existing, CA issued certificate chain and its private key into a did:x509 the agent can sign with:
   * the leaf key goes into the KMS, the DID document is derived from the chain and imported with a key binding, and
   * the chain is kept with the DID so it can be resolved again later without being passed along.
   */
  public async importDidX509(agent: AgentType, options: DidX509ImportOptionsDto): Promise<DidX509ImportResponse> {
    const chain = parseCertificateChain(options.certificateChain)
    const leaf = chain[0]

    const privateKey = parsePrivateKey(options.privateKey, options.passphrase)
    assertKeyMatchesCertificate(privateKey, leaf)

    // The default policy needs a common name, which an explicitly provided did does not
    const did =
      options.did ??
      (await buildDidX509(
        chain,
        options.policies?.length ? options.policies : [{ type: 'subject' as const, fields: this.commonNameOf(leaf) }],
      ))
    const x509chain = toX509ChainOption(chain)

    // Resolving validates the DID against the chain (fingerprint of the root, policies, chain order, validity period)
    const resolved = await agent.dids.resolve(did, { x509chain })
    if (!resolved.didDocument) {
      throw new BadRequestError(
        `did:x509 does not validate against certificateChain: ${resolved.didResolutionMetadata.message ?? resolved.didResolutionMetadata.error}`,
      )
    }
    const didDocument = resolved.didDocument

    const verificationMethodId = didDocument.verificationMethod?.[0]?.id
    if (!verificationMethodId) throw new BadRequestError('The resolved did:x509 document has no verification method')

    const didRepository = agent.context.resolve(DidRepository)
    const didRecord = (await didRepository.getCreatedDids(agent.context, { did }))[0]

    // Re-importing must not rebind an existing DID to a new key. That would break an already issued credential if the
    // key lives in a different backend (for example an Askar-backed DID after OpenBao is enabled).
    if (didRecord?.keys?.length) {
      const key = didRecord.keys[0]
      didRecord.metadata.set(X509_CHAIN_METADATA_KEY, { chain: x509chain })
      await didRepository.update(agent.context, didRecord)

      return {
        did,
        didDocument: (didRecord.didDocument ?? didDocument).toJSON() as Record<string, unknown>,
        keyId: key.kmsKeyId,
        verificationMethodId: key.didDocumentRelativeKeyId.startsWith('#')
          ? `${did}${key.didDocumentRelativeKeyId}`
          : key.didDocumentRelativeKeyId,
      }
    }

    const kmsKeyId = await this.importKey(agent, privateKey)

    await agent.dids.import({
      did,
      didDocument,
      overwrite: true,
      keys: [
        {
          didDocumentRelativeKeyId: verificationMethodId.startsWith('#')
            ? verificationMethodId
            : verificationMethodId.substring(verificationMethodId.indexOf('#')),
          kmsKeyId,
        },
      ],
    })

    const record = (await didRepository.getCreatedDids(agent.context, { did }))[0]
    if (record) {
      record.metadata.set(X509_CHAIN_METADATA_KEY, { chain: x509chain })
      await didRepository.update(agent.context, record)
    }

    return { did, didDocument: didDocument.toJSON() as Record<string, unknown>, keyId: kmsKeyId, verificationMethodId }
  }

  public async getChain(agent: AgentType, did: string): Promise<DidX509ChainResponse> {
    const x509chain = await getStoredX509Chain(did, agent.context)
    if (!x509chain) throw new BadRequestError(`No certificate chain stored for ${did}`)
    return { did, x509chain: x509chain.split(',') }
  }

  /**
   * Imports the key into the KMS. The key id is the JWK thumbprint so importing the same key twice is idempotent.
   * OpenBao handles Ed25519, P-256/P-384/P-521 and RSA when it is enabled. Otherwise Askar handles Ed25519 and the
   * P-256 / P-384 EC keys, and RSA and P-521 (Askar has no ES512 signing) go to the Node KMS.
   */
  private async importKey(agent: AgentType, privateKey: ReturnType<typeof parsePrivateKey>): Promise<string> {
    const jwk = privateKeyToJwk(privateKey)
    const publicJwk = Kms.PublicJwk.fromPublicJwk(
      createPublicKey(privateKey).export({ format: 'jwk' }) as Kms.KmsJwkPublicAsymmetric,
    )
    const keyId = TypedArrayEncoder.toBase64Url(publicJwk.getJwkThumbprint())
    const backend = openBaoBackendForJwk(jwk) ?? (this.needsNodeKms(jwk) ? NODE_KMS_BACKEND : undefined)

    try {
      const imported = await agent.kms.importKey({
        privateJwk: { ...jwk, kid: keyId } as Kms.KmsJwkPrivate,
        ...(backend ? { backend } : {}),
      })
      // OpenBao namespaces key ids, so the caller must bind the id that was actually stored, not the thumbprint.
      return imported.keyId
    } catch (error) {
      if (!(error instanceof Kms.KeyManagementKeyExistsError)) throw error
      // The key was imported before. Its id is the thumbprint, prefixed when it lives in OpenBao.
      const existingKeyId = backend === OPENBAO_KMS_BACKEND ? openBaoKeyId(keyId) : keyId
      agent.config.logger.debug('[importDidX509] key already exists in the KMS, reusing it', { keyId: existingKeyId })
      return existingKeyId
    }
  }

  private needsNodeKms(jwk: { kty: string; crv?: string }): boolean {
    return jwk.kty === 'RSA' || (jwk.kty === 'EC' && jwk.crv === 'P-521')
  }

  private commonNameOf(leaf: ReturnType<typeof parseCertificateChain>[number]): Record<string, string> {
    const commonName = leaf.subjectName.getField('CN')?.[0]
    if (!commonName) {
      throw new BadRequestError(
        'The leaf certificate has no common name (CN), provide policies to create the did:x509 from',
      )
    }
    return { CN: commonName }
  }
}

export const didX509Service = new DidX509Service()
