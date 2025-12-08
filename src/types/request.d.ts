import type { RestAgentModules, RestMultiTenantAgentModules } from '../cliAgent'
import type { Agent } from '@credo-ts/core'
import type { TenantAgent } from '@credo-ts/tenants'

// declare global {
//   namespace Express {
//     interface Request {
//       user: {
//         [x: string]: any
//         agent: Agent<RestAgentModules> | Agent<RestMultiTenantAgentModules> | TenantAgent<RestAgentModules>
//       }
//     }
//   }
// }
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

// declare global {
//   namespace Express {
//     interface Request {
//       user: {
//         [x: string]: any
//         agent: any
//       }
//     }
//   }
// }
