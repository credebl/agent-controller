import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../cliAgent'

import {
  Agent,
  ClaimFormat,
  DidKey,
  JsonEncoder,
  JsonTransformer,
  Jwt,
  MdocDeviceResponse,
  RecordNotFoundError,
  TypedArrayEncoder,
  W3cJsonLdVerifiablePresentation,
  W3cJwtVerifiablePresentation,
  X509Service,
} from '@credo-ts/core'
import { OpenId4VcIssuerX5c, OpenId4VcJwtIssuerDid, OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { injectable } from 'tsyringe'
import { Request as Req } from 'express'
import { SignerMethod } from '../../../enums'
import { CreateAuthorizationRequest } from '../types/verifier.types'

// import { CreateAuthorizationRequest } from '../types/verifier.types'

@injectable()
class VerificationSessionsService {
  public async createProofRequest(agentReq: Req, dto: CreateAuthorizationRequest) {
    try {
      let requestSigner
      if (dto.requestSigner.method === SignerMethod.Did) {
        requestSigner = dto.requestSigner as OpenId4VcJwtIssuerDid

        const didToResolve = dto.requestSigner?.didUrl
        if (!didToResolve) {
          throw new Error('No DID provided to resolve (neither requestSigner.didUrl nor verifierDid present)')
        }

        const didDocument = await agentReq.agent.dids.resolveDidDocument(didToResolve)

        let verifierDidUrl: string | undefined = undefined
        if (didDocument.verificationMethod?.[0]?.id) {
          verifierDidUrl = didDocument.verificationMethod[0].id
        }

        if (!verifierDidUrl) {
          throw new Error('No matching verification method found on verifier DID document')
        }

        if (!requestSigner.didUrl || !String(requestSigner.didUrl).includes('#')) {
          requestSigner.didUrl = verifierDidUrl
        }

        requestSigner = { method: 'did', didUrl: verifierDidUrl } as any
      } else {
        requestSigner = dto.requestSigner as OpenId4VcIssuerX5c

        const parsedCertificate = X509Service.parseCertificate(agentReq.agent.context, {
          encodedCertificate: requestSigner.x5c[0],
        })
        requestSigner.issuer = parsedCertificate.sanUriNames[0]
      }

      if (!requestSigner) {
      } else if (requestSigner.method === 'did') {
      }
      const options: any = {
        requestSigner,
        verifierId: dto.verifierId,
      }

      if (dto.responseMode) options.responseMode = dto.responseMode
      if (dto.presentationExchange) {
        options.presentationExchange = dto.presentationExchange
      } else if (dto.dcql) {
        options.dcql = dto.dcql
      }

      return (await agentReq.agent.modules.openId4VcVerifier.createAuthorizationRequest(options)) as any
    } catch (error) {
      throw error
    }
  }

  public async findVerificationSessionsByQuery(
    agentReq: Req,
    publicVerifierId?: string,
    payloadState?: string,
    state?: OpenId4VcVerificationSessionState,
    authorizationRequestUri?: string,
    nonce?: string,
  ) {
    return await agentReq.agent.modules.openId4VcVerifier.findVerificationSessionsByQuery({
      verifierId: publicVerifierId,
      payloadState,
      state,
      authorizationRequestUri,
      nonce,
    })
  }

  public async getVerificationSessionsById(agentReq: Req, verificationSessionId: string) {
    return await agentReq.agent.modules.openId4VcVerifier.getVerificationSessionById(verificationSessionId)
  }

  public async getVerifiedAuthorizationResponse(request: Req, verificationSessionId: string) {
    const verificationSession =
      await request.agent.modules.openId4VcVerifier.getVerificationSessionById(verificationSessionId)
    const verified = await request.agent.modules.openId4VcVerifier.getVerifiedAuthorizationResponse(
      verificationSession.id,
    )
    console.log(verified.presentationExchange?.presentations)
    console.log(verified.dcql?.presentationResult)

    const presentations = await Promise.all(
      (verified.presentationExchange?.presentations ?? Object.values(verified.dcql?.presentations ?? {}))
        .flat()
        .map(async (presentation) => {
          if (presentation instanceof W3cJsonLdVerifiablePresentation) {
            return {
              pretty: presentation.toJson(),
              encoded: presentation.toJson(),
            }
          }

          if (presentation instanceof W3cJwtVerifiablePresentation) {
            return {
              pretty: JsonTransformer.toJSON(presentation.presentation),
              encoded: presentation.serializedJwt,
            }
          }

          if (presentation instanceof MdocDeviceResponse) {
            return {
              pretty: JsonTransformer.toJSON({
                documents: presentation.documents.map((doc) => ({
                  doctype: doc.docType,
                  alg: doc.alg,
                  base64Url: doc.base64Url,
                  validityInfo: doc.validityInfo,
                  deviceSignedNamespaces: doc.deviceSignedNamespaces,
                  issuerSignedNamespaces: Object.entries(doc.issuerSignedNamespaces).map(
                    ([nameSpace, nameSpacEntries]) => [
                      nameSpace,
                      Object.entries(nameSpacEntries).map(([key, value]) =>
                        value instanceof Uint8Array
                          ? [`base64:${key}`, `data:image/jpeg;base64,${TypedArrayEncoder.toBase64(value)}`]
                          : [key, value],
                      ),
                    ],
                  ),
                })),
              }),
              encoded: presentation.base64Url,
            }
          }

          // if (
          //   presentation instanceof W3cV2JwtVerifiablePresentation ||
          //   presentation instanceof W3cV2SdJwtVerifiablePresentation
          // ) {
          //   throw new Error('W3C V2 presentations are not supported yet')
          // }

          return {
            pretty: {
              ...presentation,
              compact: undefined,
            },
            encoded: presentation.compact,
          }
        }) ?? [],
    )

    const dcqlSubmission = verified.dcql
      ? Object.keys(verified.dcql.presentations).map((key, index) => ({
          queryCredentialId: key,
          presentationIndex: index,
        }))
      : undefined

    console.log('presentations', presentations)

    return {
      verificationSessionId: verificationSession.id,
      responseStatus: verificationSession.state,
      error: verificationSession.errorMessage,
      //authorizationRequest,

      presentations: presentations,

      submission: verified.presentationExchange?.submission,
      definition: verified.presentationExchange?.definition,
      transactionDataSubmission: verified.transactionData,

      // dcqlQuery,
      dcqlSubmission: verified.dcql
        ? { ...verified.dcql.presentationResult, vpTokenMapping: dcqlSubmission }
        : undefined,
    } as any
  }
}

export const verificationSessionService = new VerificationSessionsService()
