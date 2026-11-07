import type { BasicX509CreateCertificateConfig, X509ImportCertificateOptionsDto } from '../types'
import type { CredoError } from '@credo-ts/core'
import type { Request as Req } from 'express'

import { transformPrivateKeyToPrivateJwk, transformSeedToPrivateJwk } from '@credo-ts/askar'
import {
  Kms,
  TypedArrayEncoder,
  X509Certificate,
  X509ExtendedKeyUsage,
  X509KeyUsage,
  X509ModuleConfig,
  X509Service,
  type Agent,
} from '@credo-ts/core'
import { KeyAlgorithm } from '@openwallet-foundation/askar-nodejs'

import { keyAlgorithmToCurve } from '../../utils/constant'
import { generateSecretKey, getCertificateValidityForSystem, getTypeFromCurve } from '../../utils/helpers'
import { openBaoBackendForCreate, openBaoBackendForJwk } from '../../utils/kms/openBao'

import { pemToRawPrivateKey } from './crypto-util'
import { type X509CreateCertificateOptionsDto } from './x509.types'

class x509Service {
  public async createSelfSignedDCS(createX509Options: BasicX509CreateCertificateConfig, agentReq: Req) {
    const agent = agentReq.agent

    const authorityKey = await createKey(agent as Agent, createX509Options.keyType)
    const AGENT_HOST = createX509Options.issuerAlternativeNameURL
    const AGENT_DNS = new URL(AGENT_HOST).hostname
    const selfSignedx509certificate = await X509Service.createCertificate(agent.context, {
      authorityKey: Kms.PublicJwk.fromPublicJwk(authorityKey.publicJwk), //createX509Options.subjectKey,
      issuer: { countryName: createX509Options.countryName, commonName: createX509Options.commonName },
      validity: getCertificateValidityForSystem(false),
      extensions: {
        subjectKeyIdentifier: {
          include: true,
        },
        keyUsage: {
          usages: [X509KeyUsage.KeyCertSign, X509KeyUsage.CrlSign, X509KeyUsage.DigitalSignature],
          markAsCritical: true,
        },
        subjectAlternativeName: {
          name: [
            { type: 'dns', value: AGENT_DNS },
            { type: 'url', value: AGENT_HOST },
          ],
        },
        issuerAlternativeName: {
          name: [
            { type: 'dns', value: AGENT_DNS },
            { type: 'url', value: AGENT_HOST },
          ],
        },
        extendedKeyUsage: {
          usages: [X509ExtendedKeyUsage.MdlDs],
          markAsCritical: true,
        },
        basicConstraints: {
          ca: true,
          pathLenConstraint: 0,
          markAsCritical: true,
        },
        // TODO: Create revocation list and add URL here - store this in platform
        // crlDistributionPoints: {
        //   urls: [`${"AGENT_HOST"}/crl`],
        // },
      },
    })

    agent.config.logger.info('======= X.509 IACA Self Signed Certificate ===========')
    const selfSignedx509certificateBase64 = selfSignedx509certificate.toString('base64')
    agent.config.logger.debug('selfSignedx509certificateBase64', { selfSignedx509certificateBase64 })
    return { publicCertificateBase64: selfSignedx509certificateBase64 }
  }

  private async importOrCreateAuthorityKey(agent: Agent, options: X509CreateCertificateOptionsDto) {
    if (options.authorityKey?.seed) {
      const { privateJwk } = transformSeedToPrivateJwk({
        type: getTypeFromCurve(options.authorityKey.keyType ?? 'P-256'),
        seed: TypedArrayEncoder.fromUtf8String(options.authorityKey.seed),
      })

      const backend = openBaoBackendForJwk(privateJwk)
      const { publicJwk } = await agent.kms.importKey({
        privateJwk,
        ...(backend ? { backend } : {}),
      })
      return { authorityKeyID: publicJwk }
    }

    const type = getTypeFromCurve(options.authorityKey?.keyType ?? 'P-256')
    const backend = openBaoBackendForCreate(type)
    const { publicJwk, keyId } = await agent.kms.createKey({
      type,
      ...(backend ? { backend } : {}),
    })
    return { authorityKeyID: publicJwk, authorityKeyKmsId: keyId }
  }

  private async resolveSubjectPublicKey(
    agent: Agent,
    subjectPublicKey: X509CreateCertificateOptionsDto['subjectPublicKey'],
  ) {
    if (!subjectPublicKey) return undefined

    if (subjectPublicKey.seed) {
      const privateJwk = transformSeedToPrivateJwk({
        seed: TypedArrayEncoder.fromUtf8String(subjectPublicKey.seed),
        type: getTypeFromCurve(subjectPublicKey.keyType ?? 'P-256'),
      }).privateJwk

      const backend = openBaoBackendForJwk(privateJwk)
      const importedKey = await agent.kms.importKey({
        privateJwk,
        ...(backend ? { backend } : {}),
      })
      return importedKey.publicJwk
    }

    const type = getTypeFromCurve(subjectPublicKey.keyType ?? 'P-256')
    const backend = openBaoBackendForCreate(type)
    const { publicJwk } = await agent.kms.createKey({
      type,
      ...(backend ? { backend } : {}),
    })
    return publicJwk
  }

  public async createCertificate(agentReq: Req, options: X509CreateCertificateOptionsDto) {
    const agent = agentReq.agent as Agent

    const { authorityKeyID, authorityKeyKmsId } = await this.importOrCreateAuthorityKey(agent, options)
    const subjectPublicKeyID = await this.resolveSubjectPublicKey(agent, options.subjectPublicKey)

    const certificate = await agent.x509.createCertificate({
      authorityKey: Kms.PublicJwk.fromPublicJwk(authorityKeyID),
      subjectPublicKey: subjectPublicKeyID ? Kms.PublicJwk.fromPublicJwk(subjectPublicKeyID) : undefined,
      serialNumber: options.serialNumber,
      issuer: options.issuer,
      extensions: options.extensions,
      subject: options.subject,
      validity: options.validity,
    })

    const issuerCertificate = certificate.toString('base64')

    return { publicCertificateBase64: issuerCertificate, keyId: authorityKeyKmsId }
  }

  public async ImportX509Certificates(agentReq: Req, options: X509ImportCertificateOptionsDto) {
    const agent = agentReq.agent
    if (!options.privateKey) throw new Error('[ImportX509Certificates] privateKey is required')
    agent.config.logger.debug(`Start validating keys`)
    const secretHexKey = await pemToRawPrivateKey(options.privateKey)
    const privateKey = TypedArrayEncoder.fromHex(secretHexKey)

    agent.config.logger.debug(`Decode certificate`)
    const parsedCertificate = X509Service.parseCertificate(agent.context, {
      encodedCertificate: options.certificate,
    })
    const issuerCertificate = parsedCertificate.toString('base64')
    let key
    try {
      const keyTypeInfo = getTypeFromCurve(options.keyType)
      const { privateJwk } = transformPrivateKeyToPrivateJwk({
        type: keyTypeInfo,
        privateKey,
      })

      const backend = openBaoBackendForJwk(privateJwk)
      key = await agent.kms.importKey({
        privateJwk,
        ...(backend ? { backend } : {}),
      })
      if (
        parsedCertificate.publicJwk.publicKey.kty !== keyTypeInfo.kty ||
        !parsedCertificate.publicJwk.equals(Kms.PublicJwk.fromPublicJwk(key.publicJwk))
      ) {
        throw new Error(`Key mismatched in provided X509_CERTIFICATE to import`)
      }
      agent.config.logger.info(`Keys matched with certificate`)
    } catch (error) {
      // If the key already exists, we assume the self-signed certificate is already created
      if (error instanceof Kms.KeyManagementKeyExistsError) {
        agent.config.logger.warn(
          '[ImportX509Certificates] Key already exists — assuming certificate was already imported',
        )
      } else {
        agent.config.logger.error('[ImportX509Certificates] Failed to import key', {
          message: (error as Error)?.message,
        })
        throw error
      }
    }

    return { issuerCertificate, keyId: key?.keyId }
  }

  public addTrustedCertificate(
    agentReq: Req,
    options: {
      certificate: string
    },
  ) {
    const agent = agentReq.agent
    return agent.x509.config.addTrustedCertificate(options.certificate)
  }

  public getTrustedCertificates(agentReq: Req) {
    const trustedCertificates = agentReq.agent.context.dependencyManager
      .resolve(X509ModuleConfig)
      .trustedCertificates?.map((cert) => X509Certificate.fromEncodedCertificate(cert).toString('base64')) // as [string, ...string[]]

    return trustedCertificates
  }

  /**
   * Parses a base64-encoded X.509 certificate into a X509Certificate
   *
   * @param issuerAgent {Agent}
   * @param options {x509Input}
   * @returns
   */
  public decodeCertificate(
    agentReq: Req,
    options: {
      certificate: string
    },
  ) {
    const parsedCertificate = X509Service.parseCertificate(agentReq.agent.context, {
      encodedCertificate: options.certificate,
    })

    return parsedCertificate
  }
}

export const x509ServiceT = new x509Service()

export async function createKey(agent: Agent, keyType: KeyAlgorithm) {
  try {
    const seed = await generateSecretKey(keyType === KeyAlgorithm.EcSecp256r1 ? 64 : 32)

    const normalizedCurve = keyAlgorithmToCurve[keyType]
    if (!normalizedCurve) throw new Error('Unspported key type for method importKey')
    const privateJwk = transformSeedToPrivateJwk({
      seed: TypedArrayEncoder.fromUtf8String(seed),
      type: getTypeFromCurve(normalizedCurve),
    }).privateJwk

    const backend = openBaoBackendForJwk(privateJwk)
    const importedKey = await agent.kms.importKey({
      privateJwk,
      ...(backend ? { backend } : {}),
    })

    return importedKey
  } catch (error) {
    agent.config.logger.debug(`Error while creating authorityKey`, { message: (error as CredoError).message })
    throw error
  }
}
