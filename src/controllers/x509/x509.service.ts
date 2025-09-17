
import { CredoError, KeyType, TypedArrayEncoder, WalletKeyExistsError, X509Certificate, X509ExtendedKeyUsage, X509KeyUsage, X509ModuleConfig, X509Service, type Agent } from '@credo-ts/core'
import type { OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'

import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc/build/openid4vc-issuer/repository'


import { Request as Req } from 'express'

import { BasicX509CreateCertificateConfig, X509ImportCertificateOptionsDto } from '../types'
import { generateSecretKey, getCertificateValidityForSystem } from '../../utils/helpers'
import { pemToRawEd25519PrivateKey } from './crypto-util'


class x509Service {

  public async createSelfSignedDCS(
    createX509Options: BasicX509CreateCertificateConfig,
    agentReq: Req
  ) {
    const agent = agentReq.agent

    const authorityKey = await createKey(agent as Agent, createX509Options.keyType);
    const AGENT_HOST = createX509Options.issuerAlternativeNameURL
    const AGENT_DNS = AGENT_HOST.replace('https://', '')
    const selfSignedx509certificate = await X509Service.createCertificate(agent.context, {
      authorityKey: authorityKey, //createX509Options.subjectKey,
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
          name: [{ type: 'dns', value: AGENT_DNS }, { type: 'url', value: AGENT_HOST }],
        },
        issuerAlternativeName: {
          // biome-ignore lint/style/noNonNullAssertion:
          //name: rootCertificate.issuerAlternativeNames!,
          name: [{ type: 'dns', value: AGENT_DNS }, { type: 'url', value: AGENT_HOST }],
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

    console.log('======= X.509 IACA Self Signed Certificate ===========')
    const selfSignedx509certificateBase64 = selfSignedx509certificate.toString('base64')
    console.log('selfSignedx509certificateBase64', selfSignedx509certificateBase64);
    return { selfSignedx509certificateBase64 };

  }


  public async ImportX509Certficates(agentReq: Req
    , options: X509ImportCertificateOptionsDto
  ) {
    const agent = agentReq.agent
    const secretHexKey = await pemToRawEd25519PrivateKey(options.privateKey ?? '')
    const privateKey = TypedArrayEncoder.fromHex(secretHexKey)

    const parsedCertificate = X509Service.parseCertificate(agent.context, {
      encodedCertificate: options.certificate,
    })
    const issuerCertficicate = parsedCertificate.toString('base64')

    try {
      const documentSignerKey = await agent.wallet.createKey({
        privateKey: privateKey,
        keyType: options.keyType
      })

      if (
        parsedCertificate.publicKey.keyType !== options.keyType ||
        !Buffer.from(parsedCertificate.publicKey.publicKey).equals(Buffer.from(documentSignerKey.publicKey))
      ) {
        throw new Error(
          `Key mismatched in provided X509_CERTIFICATE to import`
        )
      }
      console.log(`Keys matched with certificate`)
    }
    catch (error) {

      // If the key already exists, we assume the self-signed certificate is already created
      if (error instanceof WalletKeyExistsError) {
        console.error(`key already exists while importing certificate ${JSON.stringify(parsedCertificate.privateKey)}`, parsedCertificate.privateKey)

      } else {
        throw error
      }
    }

    return { issuerCertficicate };
  }

  public addTrustedCertificate(agentReq: Req, options: {
    certificate: string
  }) {
    const agent = agentReq.agent
    return agent.x509.addTrustedCertificate(options.certificate);
  }

  public getTrustedCertificates(agentReq: Req) {

    const trustedCertificates = agentReq.agent.context.dependencyManager.resolve(X509ModuleConfig)
      .trustedCertificates?.map((cert) =>
        X509Certificate.fromEncodedCertificate(cert).toString('base64')
      )// as [string, ...string[]]

    return trustedCertificates;
  }

  /**
  * Parses a base64-encoded X.509 certificate into a X509Certificate
  * 
  * @param issuerAgent {Agent}
  * @param options {x509Input}
  * @returns 
  */
  public decodeCertificate(agentReq: Req, options: {
    certificate: string
  }) {
    const parsedCertificate = X509Service.parseCertificate(agentReq.agent.context, {
      encodedCertificate: options.certificate,
    })

    return parsedCertificate;
  }


}


export const x509ServiceT = new x509Service()


export async function createKey(agent: Agent, keyType: KeyType) {
  try {
    const seed = await generateSecretKey(keyType === KeyType.P256 ? 64 : 32)

    agent.config.logger.debug(`createKey: got seed ${seed}`)

    const authorityKey = await agent.wallet.createKey({
      keyType: keyType,
      seed: TypedArrayEncoder.fromString(seed),
    })

    return authorityKey
  } catch (error) {
    agent.config.logger.debug(`Error while creating authorityKey`, { message: (error as CredoError).message })
    throw error;
  }
}