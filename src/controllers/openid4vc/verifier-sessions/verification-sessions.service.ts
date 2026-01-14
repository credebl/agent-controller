import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../cliAgent'

import {
  Agent,
  ClaimFormat,
  DidKey,
  JsonEncoder,
  JsonTransformer,
  Jwt,
  Mdoc,
  MdocDeviceResponse,
  RecordNotFoundError,
  TypedArrayEncoder,
  W3cJsonLdVerifiablePresentation,
  W3cJwtVerifiablePresentation,
  W3cPresentation,
  X509Service,
} from '@credo-ts/core'
import { OpenId4VcJwtIssuerDid, OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { Request as Req } from 'express'
import { injectable } from 'tsyringe'

import { SignerMethod } from '../../../enums'
import { CreateAuthorizationRequest, OpenId4VcIssuerX5c, ResponseModeEnum } from '../types/verifier.types'

@injectable()
class VerificationSessionsService {
  public async createProofRequest(agentReq: Req, dto: CreateAuthorizationRequest) {
    const verifier = agentReq.agent.modules.openid4vc.verifier
    if (!verifier) throw new Error('OID4VC verifier module not initialized')

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
    const options: any = {
      requestSigner,
      verifierId: dto.verifierId,
    }

    if (dto.responseMode === ResponseModeEnum.DC_API || dto.responseMode === ResponseModeEnum.DC_API_JWT) {
      options.expectedOrigins = dto.expectedOrigins
    }

    if (dto.responseMode) options.responseMode = dto.responseMode
    if (dto.presentationExchange) {
      // options.presentationExchange = dto.presentationExchange
      throw new Error('Presentation Exchange is not supported for now')
    } else if (dto.dcql) {
      if (
        dto.requestSigner.method !== SignerMethod.X5c ||
        !Array.isArray((requestSigner as OpenId4VcIssuerX5c).x5c) ||
        !(requestSigner as OpenId4VcIssuerX5c).x5c[0]
      ) {
        throw new Error('dcql currently requires x5c requestSigner with a valid certificate chain')
      }
      const parsedCertificate = X509Service.parseCertificate(agentReq.agent.context, {
        encodedCertificate: requestSigner.x5c[0],
      })
      parsedCertificate.publicJwk.keyId = requestSigner.keyId
      options.requestSigner.x5c = [parsedCertificate]
      options.dcql = dto.dcql
    }
    return (await verifier.createAuthorizationRequest(options)) as any
  }

  public async findVerificationSessionsByQuery(
    agentReq: Req,
    publicVerifierId?: string,
    payloadState?: string,
    state?: OpenId4VcVerificationSessionState,
    authorizationRequestUri?: string,
    nonce?: string,
  ) {
    return await agentReq.agent.modules.openid4vc.verifier?.findVerificationSessionsByQuery({
      verifierId: publicVerifierId,
      payloadState,
      state,
      authorizationRequestUri,
      nonce,
    })
  }

  public async getVerificationSessionsById(agentReq: Req, verificationSessionId: string) {
    const verifier = agentReq.agent.modules.openid4vc.verifier
    if (!verifier) {
      throw new Error('OID4VC verifier module not initialized')
    }
    return await verifier.getVerificationSessionById(verificationSessionId)
  }

  public async getVerifiedAuthorizationResponse(request: Req, verificationSessionId: string) {
    const verifier = request.agent.modules.openid4vc.verifier
    if (!verifier) {
      throw new Error('OID4VC verifier module not initialized')
    }
    const verificationSession = await verifier.getVerificationSessionById(verificationSessionId)
    if (!verificationSession) {
      throw new Error(`Verification session with id ${verificationSessionId} not found`)
    }
    const verified = await verifier.getVerifiedAuthorizationResponse(verificationSession.id)
    if (!verified) {
      throw new Error(`No verified response found for verification session with id ${verificationSessionId}`)
    }
    const presentations = await Promise.all(
      (verified.presentationExchange?.presentations ?? Object.values(verified.dcql?.presentations ?? {}))
        .flat()
        .map(async (presentation: any) => {
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
                      // TODO: Address it later to check whether the received Uint8Array is an image or not.
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

          return {
            pretty: {
              ...presentation,
              compact: undefined,
            },
            encoded: presentation.compact,
          }
        }) ?? [],
    )
    const dcqlSubmission = verified?.dcql
      ? Object.entries(verified.dcql.presentations).flatMap(([queryCredentialId, presentations]) =>
          presentations.map((_, presentationIndex) => ({
            queryCredentialId,
            presentationIndex,
          })),
        )
      : undefined

    return {
      verificationSessionId: verificationSession?.id,
      responseStatus: verificationSession?.state,
      error: verificationSession?.errorMessage,
      //authorizationRequest,

      presentations: presentations,

      submission: verified!.presentationExchange?.submission,
      definition: verified!.presentationExchange?.definition,
      transactionDataSubmission: verified!.transactionData,

      // dcqlQuery,
      dcqlSubmission: verified!.dcql
        ? { ...verified!.dcql.presentationResult, vpTokenMapping: dcqlSubmission }
        : undefined,
    } as any
  }
}

export const verificationSessionService = new VerificationSessionsService()
