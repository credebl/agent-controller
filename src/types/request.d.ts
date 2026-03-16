import type { RestAgentModules, RestMultiTenantAgentModules } from '../cliAgent'
import type { Agent } from '@credo-ts/core'
import type { TenantAgent } from '@credo-ts/tenants'

type AgentType = Agent<RestAgentModules> | Agent<RestMultiTenantAgentModules> | TenantAgent<RestAgentModules>

interface IAgent {
  agent: AgentType
}

declare global {
  namespace Express {
    interface Request {
      agent: AgentType
    }
  }
}
