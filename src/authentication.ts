import type { RestAgentModules, RestMultiTenantAgentModules } from './cliAgent'
import type { TenantAgent } from '@credo-ts/tenants'
import type { Request } from 'express'

import { Agent, LogLevel } from '@credo-ts/core'
import jwt, { decode } from 'jsonwebtoken'
import { randomUUID as uuid } from 'node:crypto'
import { container } from 'tsyringe'

import { AgentRole, ErrorMessages, SCOPES } from './enums'
import { StatusException } from './errors'
import { TsLogger } from './utils/logger'

// export type AgentType = Agent<RestAgentModules> | Agent<RestMultiTenantAgentModules> | TenantAgent<RestAgentModules>

let dynamicApiKey: string = uuid() // Initialize with a default value

// Cache for jwt token key
const cache = new Map<string, string>()

export const getFromCache = (key: string) => cache.get(key)
export const setInCache = (key: string, value: string) => cache.set(key, value)

export async function expressAuthentication(request: Request, securityName: string, scopes?: string[]) {
  const logger = new TsLogger(LogLevel.info)
  const agent = container.resolve(Agent<RestMultiTenantAgentModules>)

  if (scopes && scopes?.includes(SCOPES.UNPROTECTED)) {
    // Skip authentication for this route or controller
    request.agent = agent
    return true
  }

  const apiKeyHeader = request.headers['authorization']

  if (!apiKeyHeader) {
    return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
  }

  if (securityName === 'apiKey') {
    // Auth: For BW/Dedicated agent to GET their token
    if (apiKeyHeader) {
      const providedApiKey = apiKeyHeader as string
      if (providedApiKey === dynamicApiKey) {
        request.agent = agent
        return true
      }
    }
  }

  if (securityName === 'jwt') {
    const tenancy = agent!.modules.tenants ? true : false
    const tokenWithHeader = apiKeyHeader
    const token = tokenWithHeader!.replace('Bearer ', '')
    const reqPath = request.path
    let decodedToken: jwt.JwtPayload
    if (!token) {
      return Promise.reject(new StatusException(`${ErrorMessages.Unauthorized}: Invalid token`, 401))
    }

    let cachedKey = getFromCache('secret')

    if (!cachedKey) {
      // Cache key from
      cachedKey = await getSecretKey(agent as Agent)
    }

    // Verify token
    const verified = await verifyToken(logger, token, cachedKey)

    // Failed to verify token
    if (!verified) {
      return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
    }

    try {
      decodedToken = decode(token) as jwt.JwtPayload
      if (!decodedToken || !decodedToken.role) {
        throw new Error('Token not decoded')
      }
    } catch (err) {
      agent.config.logger.error('Error decoding token', err as Record<string, any>)
      return Promise.reject(new StatusException(`${ErrorMessages.Unauthorized}: Invalid token`, 401))
    }

    // Before getting ahead, we can ideally, verify the token, since, in the current approach we have stored the jwt secret in BW
    const role: AgentRole = decodedToken.role

    if (tenancy) {
      // it should be a shared agent
      if (role !== AgentRole.RestRootAgentWithTenants && role !== AgentRole.RestTenantAgent) {
        logger.debug('Unknown role. The agent is a multi-tenant agent')
        return Promise.reject(new StatusException('Unknown role', 401))
      }
      if (role === AgentRole.RestTenantAgent) {
        // Logic if the token is of tenant agent
        if (scopes && !scopes?.includes(SCOPES.TENANT_AGENT)) {
          logger.debug('Tenants cannot access this route')
          return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
        } else {
          // Auth: tenant agent
          const tenantId: string = decodedToken.tenantId
          if (!tenantId) {
            return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
          }
          const tenantAgent = await agent.modules.tenants.getTenantAgent({ tenantId })
          if (!tenantAgent) {
            return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
          }

          // Only need to registerInstance for TenantAgent.
          request.agent = tenantAgent
          return true
        }
      } else if (role === AgentRole.RestRootAgentWithTenants) {
        // Auth: base wallet
        if (!scopes?.includes(SCOPES.MULTITENANT_BASE_AGENT)) {
          logger.error('Basewallet can only manage tenants')
          return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
        }

        request.agent = agent
        return true
      } else {
        logger.debug('Invalid Token')
        return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
      }
    } else {
      if (role !== AgentRole.RestRootAgent) {
        logger.debug('This is a dedicated agent')
        return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
      } else {
        // Auth: dedicated agent

        // TODO: replace with scopes, instead of routes
        if (reqPath.includes('/multi-tenancy/'))
          return Promise.reject(
            new StatusException(
              `${ErrorMessages.Unauthorized}: Multitenant routes are diabled for dedicated agent`,
              401,
            ),
          )

        request.agent = agent
        return true
      }
    }
  }
  return Promise.reject(new StatusException(ErrorMessages.Unauthorized, 401))
}

async function verifyToken(logger: TsLogger, token: string, secretKey: string): Promise<boolean> {
  try {
    jwt.verify(token, secretKey)
    return true
  } catch (error) {
    logger.error('Error verifying jwt token', error as Record<string, any>)
    return false
  }
}

// Common function to pass agent object and get secretKey
async function getSecretKey(
  agent: Agent<RestMultiTenantAgentModules | RestAgentModules> | TenantAgent<RestAgentModules>,
): Promise<string> {
  let cachedKey: string | undefined

  cachedKey = getFromCache('secret')

  if (!cachedKey) {
    const genericRecords = await agent.genericRecords.findAllByQuery({ hasSecretKey: 'true' })
    cachedKey = genericRecords[0]?.content.secretKey as string
    if (!cachedKey) {
      throw new Error('secretKey not found')
    }
    setInCache('secret', cachedKey)
  }

  return cachedKey
}

export function setDynamicApiKey(newApiKey: string) {
  dynamicApiKey = newApiKey
}

export function getDynamicApiKey() {
  return dynamicApiKey
}
