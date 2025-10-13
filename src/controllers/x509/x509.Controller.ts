import { injectable } from '@credo-ts/core'
import { Request as Req } from 'express'
import { Body, Controller, Post, Route, Tags, Security, Request, Get } from 'tsoa'

import { SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { X509ImportCertificateOptionsDto } from '../types'
import { x509ServiceT } from './x509.service'
import { X509CreateCertificateOptionsDto } from './x509.types'

@Tags('x509')
@Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
@Route('/x509')
@injectable()
export class X509Controller extends Controller {
  @Post('/')
  public async createX509Certificate(
    @Request() request: Req,
    @Body() createX509Options: X509CreateCertificateOptionsDto,
  ) {
    try {
      return await x509ServiceT.createCertificate(request, createX509Options)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/import')
  public async ImportX509Certificates(
    @Request() request: Req,
    @Body() importX509Options: X509ImportCertificateOptionsDto,
  ) {
    try {
      return await x509ServiceT.ImportX509Certificates(request, importX509Options)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/trusted')
  public async addTrustedCertificate(
    @Request() request: Req,
    @Body()
    options: {
      certificate: string
    },
  ) {
    try {
      return await x509ServiceT.addTrustedCertificate(request, options)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Get('/trusted')
  public async getTrustedCertificates(@Request() request: Req) {
    try {
      return await x509ServiceT.getTrustedCertificates(request)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/decode')
  public async decodeCertificate(
    @Request() request: Req,
    @Body()
    options: {
      certificate: string
    },
  ) {
    try {
      return await x509ServiceT.decodeCertificate(request, options)
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
