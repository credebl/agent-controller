import type { RestMultiTenantAgentModules } from '../../cliAgent'
import type { TenantRecord } from '@credo-ts/tenants'

import { Agent, JsonTransformer, injectable, RecordNotFoundError } from '@credo-ts/core'
import {
  Body,
  Controller,
  Delete,
  Post,
  Route,
  Tags,
  Path,
  Security,
  Request,
  Res,
  TsoaResponse,
  Get,
} from '@tsoa/runtime'
import { Request as Req } from 'express'
import jwt from 'jsonwebtoken'

import { AgentRole, SCOPES } from '../../enums'
import ErrorHandlingService from '../../errorHandlingService'
import { CreateTenantOptions } from '../types'

@Tags('MultiTenancy')
@Security('jwt', [SCOPES.MULTITENANT_BASE_AGENT])
@Route('/multi-tenancy')
@injectable()
export class MultiTenancyController extends Controller {
  @Post('/create-tenant')
  public async createTenant(@Request() request: Req, @Body() createTenantOptions: CreateTenantOptions) {
    const { config } = createTenantOptions
    try {
      const agent = request.agent as Agent<RestMultiTenantAgentModules>
      const tenantRecord: TenantRecord = await agent.modules.tenants.createTenant({ config })
      // Note: logic to store generate token for tenant using BW's secertKey
      // Here no need to change the logic, here only change the logic in 'createToken'
      const token = await this.createToken(agent, tenantRecord.id)
      const withToken = { token, ...tenantRecord }
      return withToken
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/get-token/:tenantId')
  public async getTenantToken(
    @Request() request: Req,
    @Path('tenantId') tenantId: string,
    @Res() notFoundError: TsoaResponse<404, { reason: string }>,
    @Res() internalServerError: TsoaResponse<500, { message: string }>,
  ) {
    try {
      const agent = request.agent as unknown as Agent<RestMultiTenantAgentModules>
      // Option1: logic to use tenant's secret key to generate token for tenant
      // let secretKey
      // await agent.modules.tenants.withTenantAgent({ tenantId }, async (tenantAgent) => {
      //   const genericRecord = await tenantAgent.genericRecords.getAll()
      //   const records = genericRecord.find((record) => record?.content?.secretKey !== undefined)
      //   secretKey = records?.content.secretKey as string
      // })

      // Note: logic to store generate token for tenant using BW's secertKey

      const genericRecord = await agent.genericRecords.findAllByQuery({ hasSecretKey: 'true' })
      const secretKey = genericRecord[0]?.content.secretKey as string

      if (!secretKey) {
        throw new Error('secretKey does not exist in wallet')
      }

      const token = await this.createToken(agent, tenantId, secretKey)

      return { token: token }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        return notFoundError(404, {
          reason: `SecretKey not found`,
        })
      }

      return internalServerError(500, { message: `Something went wrong: ${error}` })
    }
  }

  @Get(':tenantId')
  public async getTenantById(
    @Request() request: Req,
    @Path('tenantId') tenantId: string,
    @Res() notFoundError: TsoaResponse<404, { reason: string }>,
    @Res() internalServerError: TsoaResponse<500, { message: string }>,
  ) {
    try {
      const agent = request.agent as Agent<RestMultiTenantAgentModules>
      const getTenant = await agent.modules.tenants.getTenantById(tenantId)
      return JsonTransformer.toJSON(getTenant)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        return notFoundError(404, {
          reason: `Tenant with id: ${tenantId} not found.`,
        })
      }
      return internalServerError(500, { message: `Something went wrong: ${error}` })
    }
  }

  @Delete(':tenantId')
  public async deleteTenantById(
    @Request() request: Req,
    @Path('tenantId') tenantId: string,
    @Res() notFoundError: TsoaResponse<404, { reason: string }>,
    @Res() internalServerError: TsoaResponse<500, { message: string }>,
  ) {
    try {
      const agent = request.agent as Agent<RestMultiTenantAgentModules>
      const deleteTenant = await agent.modules.tenants.deleteTenantById(tenantId)
      return JsonTransformer.toJSON(deleteTenant)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        return notFoundError(404, {
          reason: `Tenant with id: ${tenantId} not found.`,
        })
      }
      return internalServerError(500, { message: `Something went wrong: ${error}` })
    }
  }

  private async createToken(agent: Agent<RestMultiTenantAgentModules>, tenantId: string, secretKey?: string) {
    let key: string
    if (!secretKey) {
      // Option1: logic to use tenant's secret key to generate token for tenant
      // key = await generateSecretKey()
      // await agent.modules.tenants.withTenantAgent({ tenantId }, async (tenantAgent) => {
      //   tenantAgent.genericRecords.save({
      //     content: {
      //       secretKey: key,
      //     },
      //   })
      // })

      // Option2: logic to store generate token for tenant using BW's secertKey
      const genericRecord = await agent.genericRecords.findAllByQuery({ hasSecretKey: 'true' })
      key = genericRecord[0].content.secretKey as string

      if (!key) {
        throw new Error('SecretKey does not exist for basewallet')
      }
    } else {
      key = secretKey
    }
    const token = jwt.sign({ role: AgentRole.RestTenantAgent, tenantId }, key)
    return token
  }
}
