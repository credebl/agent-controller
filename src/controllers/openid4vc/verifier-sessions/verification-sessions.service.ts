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
import { Request as Req } from 'express'
import { CreateAuthorizationRequest } from '../types/verifier.types'

// import { CreateAuthorizationRequest } from '../types/verifier.types'

@injectable()
class VerificationSessionsService {
  public async createProofRequest(agentReq: Req, dto: CreateAuthorizationRequest) {
    try {
      const didToResolve = dto.requestSigner?.didUrl
      if (!didToResolve) {
        throw new Error('No DID provided to resolve (neither requestSigner.didUrl nor verifierDid present)');
      }

      const didDocument = await agentReq.agent.dids.resolveDidDocument(didToResolve);

      let verifierDidUrl: string | undefined = undefined;
      if (didDocument.verificationMethod?.[0]?.id) {
        verifierDidUrl = didDocument.verificationMethod[0].id;
      }

      if (!verifierDidUrl) {
        throw new Error('No matching verification method found on verifier DID document');
      }
      let requestSigner = dto.requestSigner;
      if (!requestSigner) {
        requestSigner = { method: 'did', didUrl: verifierDidUrl } as any;
      } else if (requestSigner.method === 'did') {
        if (!requestSigner.didUrl || !String(requestSigner.didUrl).includes('#')) {
          requestSigner.didUrl = verifierDidUrl;
        }
      }
      const options: any = {
        requestSigner,
        verifierId: dto.verifierId,
      };

      if (dto.responseMode) options.responseMode = dto.responseMode;
      if (dto.presentationExchange) {
        options.presentationExchange = dto.presentationExchange;
      } else if (dto.dcql) {
        options.dcql = dto.dcql;
      }

      return await agentReq.agent.modules.openId4VcVerifier.createAuthorizationRequest(options);
    } catch (error) {
      throw error;
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

  public async getVerificationSessionsById(
    agentReq: Req,
    verificationSessionId: string,
  ) {
    return await agentReq.agent.modules.openId4VcVerifier.getVerificationSessionById(verificationSessionId)
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
