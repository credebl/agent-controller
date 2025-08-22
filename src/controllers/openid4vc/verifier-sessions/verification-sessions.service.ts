import type { RestAgentModules, RestMultiTenantAgentModules } from '../../../cliAgent'

import {
  Agent,
  ClaimFormat,
  DidKey,
  Jwt,
  W3cJsonLdVerifiablePresentation,
  W3cJwtVerifiablePresentation,
} from '@credo-ts/core'
import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { injectable } from 'tsyringe'

// import { CreateAuthorizationRequest } from '../types/verifier.types'

@injectable()
class VerificationSessionsService {
//   public async createProofRequest(
//     verifierAgent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
//     dto: any, // CreateAuthorizationRequest
//   ) {
//     const didDocument = await verifierAgent.dids.resolveDidDocument(dto.verifierDid)

//     let verifierDidUrl: string | undefined = undefined
//     if (!verifierDidUrl && didDocument.verificationMethod?.[0].id) {
//       verifierDidUrl = didDocument.verificationMethod?.[0].id
//     }

//     if (!verifierDidUrl) throw new Error('No matching verification method found')

//     return await verifierAgent.modules.openId4VcVerifier.createAuthorizationRequest({
//       requestSigner: {
//         method: 'did',
//         didUrl: verifierDidUrl,
//       },
//       verifierId: dto.verifierId,
//       presentationExchange: dto.presentationExchange,
//       responseMode: dto.responseMode,
//     })
//   }

  public async findVerificationSessionsByQuery(
    verifierAgent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    publicVerifierId?: string,
    payloadState?: string,
    state?: OpenId4VcVerificationSessionState,
    authorizationRequestUri?: string,
    nonce?: string,
  ) {
    return await verifierAgent.modules.openId4VcVerifier.findVerificationSessionsByQuery({
      verifierId: publicVerifierId,
      payloadState,
      state,
      authorizationRequestUri,
      nonce,
    })
  }

  public async getVerificationSessionsById(
    verifierAgent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    verificationSessionId: string,
  ) {
    return await verifierAgent.modules.openId4VcVerifier.getVerificationSessionById(verificationSessionId)
  }

  public async getVerifiedAuthorizationResponse(
    verifierAgent: Agent<RestMultiTenantAgentModules> | Agent<RestAgentModules>,
    verificationSessionId: string,
  ) {
    const verifiedAuthorizationResponse =
      await verifierAgent.modules.openId4VcVerifier.getVerifiedAuthorizationResponse(verificationSessionId)

    const presentations = verifiedAuthorizationResponse.presentationExchange?.presentations.map((presentation) => {
      if (presentation instanceof W3cJsonLdVerifiablePresentation) {
        return {
          format: presentation.claimFormat,
          encoded: presentation.toJSON(),
          vcPayload: presentation.toJSON(),
        }
      } else if (presentation instanceof W3cJwtVerifiablePresentation) {
        return {
          format: presentation.claimFormat,
          encoded: presentation.serializedJwt,
          vcPayload: presentation.presentation.toJSON(),
          signedPayload: presentation.jwt.payload.toJson(),
          header: presentation.jwt.header,
        }
      } else {
        const sdJwtPresentation: any = presentation
        return {
          format: ClaimFormat.SdJwtVc,
          encoded: sdJwtPresentation.compact,
          vcPayload: sdJwtPresentation.prettyClaims,
          signedPayload: sdJwtPresentation.payload,
          header: sdJwtPresentation.header as Jwt['header'],
        }
      }
    })

    return {
      ...verifiedAuthorizationResponse,
      presentationExchange: verifiedAuthorizationResponse.presentationExchange
        ? { ...verifiedAuthorizationResponse.presentationExchange, presentations }
        : undefined,
    }
  }
}

export const verificationSessionService = new VerificationSessionsService()
