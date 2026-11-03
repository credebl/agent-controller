import { Agent, DidRecord } from '@credo-ts/core'
import { Controller, Get, Route, Tags } from 'tsoa'
import { container, injectable } from 'tsyringe'

import { RestMultiTenantAgentModules } from '../../cliAgent'
import ErrorHandlingService from '../../errorHandlingService'
import { NotFoundError } from '../../errors'
import { getPrimaryDidWeb } from '../../utils/primaryDidWeb'

// Deliberately public: did:web resolution (per spec) is a bare, unauthenticated
// GET against the subject's own domain, so this controller carries no
// `@Security()` decorator (mirrors AuthController's unauthenticated /token route).
// Reads the DID document straight off this agent's own stored DidRecord
// (populated by DidController.handleWeb()'s `dids.import()` call) rather than
// calling `dids.resolve()`, since this agent's own domain *is* the did:web
// identifier being resolved - resolving here would just be this endpoint
// calling itself over the network.
@Tags('WellKnown')
@Route('/.well-known')
@injectable()
export class WellKnownController extends Controller {
  private agent = container.resolve(Agent<RestMultiTenantAgentModules>)

  @Get('/did.json')
  public async getDidWebDocument(): Promise<Record<string, unknown>> {
    try {
      const createdDids = await this.agent.dids.getCreatedDids({ method: 'web' })

      if (createdDids.length === 0) {
        throw new NotFoundError('No did:web DID has been created for this agent yet')
      }

      const didRecord = await this.resolvePrimaryDidWebRecord(createdDids)

      if (!didRecord || !didRecord.didDocument) {
        throw new NotFoundError('No did:web DID has been created for this agent yet')
      }

      this.setHeader('Content-Type', 'application/did+ld+json')
      return didRecord.didDocument.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Picks which did:web record to serve. DidController.handleWeb() tags a
   * genericRecord via setPrimaryDidWeb() whenever a did:web is created with
   * isPrimaryDid=true - that's this agent's own local copy of what the
   * platform's `org_dids.isPrimaryDid` says, since this process has no
   * access to the platform's database to ask directly.
   *
   * Falls back to picking among the created dids themselves (never a fixed
   * array index) for agents that predate this tagging, or where the tag is
   * missing for any other reason: the single did:web if there's only one,
   * otherwise the most recently created one.
   */
  private async resolvePrimaryDidWebRecord(createdDids: DidRecord[]): Promise<DidRecord | undefined> {
    const primaryDid = await getPrimaryDidWeb(this.agent)

    if (primaryDid) {
      const tagged = createdDids.find((record) => record.did === primaryDid)
      if (tagged) {
        return tagged
      }
      // Pointer refers to a did:web that no longer exists in this wallet -
      // fall through to the no-tag fallback below instead of 404ing outright.
    }

    if (createdDids.length === 1) {
      return createdDids[0]
    }

    return [...createdDids].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  }
}
