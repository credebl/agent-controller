import type { RestMultiTenantAgentModules } from '../../cliAgent'
import type { TenantRecord } from '@credo-ts/tenants'

import { Agent, JsonTransformer, injectable, RecordNotFoundError, X509CreateCertificateOptions, X509Service, X509KeyUsage, KeyType, TypedArrayEncoder, CredoError, X509ExtendedKeyUsage, Key } from '@credo-ts/core'
import { Request as Req } from 'express'
import jwt from 'jsonwebtoken'
import { Body, Controller, Delete, Post, Route, Tags, Path, Security, Request, Res, TsoaResponse, Get } from 'tsoa'

import { AgentRole, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { BasicX509CreateCertificateConfig, CreateTenantOptions, X509ImportCertificateOptionsDto } from '../types'
import { generateSecretKey, getCertificateValidityForSystem } from '../../utils/helpers'
import { x509ServiceT } from './x509.service'


@Tags('x509')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@Route('/x509')
@injectable()
export class X509Controller extends Controller {
  @Post('/')
  public async createSelfSignedDCS(@Request() request: Req, @Body() createX509Options: BasicX509CreateCertificateConfig) {

    try {

      return await x509ServiceT.createSelfSignedDCS(createX509Options, request);
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }


  @Post('/import')
  public async ImportX509Certficates(@Request() request: Req, @Body() importX509Options: X509ImportCertificateOptionsDto) {

    try {

      return await x509ServiceT.ImportX509Certficates(request, importX509Options);
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/trusted')
  public async addTrustedCertificate(@Request() request: Req, @Body() options: {
    certificate: string
  }) {
    try {

      return await x509ServiceT.addTrustedCertificate(request, options);
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Get('/trusted')
  public async getTrustedCertificates(@Request() request: Req) {

    try {
      return await x509ServiceT.getTrustedCertificates(request);
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }


  @Post('/decode')
  public async decodeCertificate(@Request() request: Req, @Body() options: {
    certificate: string
  }) {
    try {

      return await x509ServiceT.decodeCertificate(request, options);
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }


}