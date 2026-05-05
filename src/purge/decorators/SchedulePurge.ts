import type { AgentMode, PurgeRecordType } from '../PurgeTypes'

import { getNatsPurgeScheduler } from '../PurgeSchedulerFactory'

export function SchedulePurge(recordType: PurgeRecordType, idExtractor: (result: unknown) => string | undefined) {
  return function (_target: object, _key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>

    descriptor.value = async function (...args: unknown[]) {
      const result = await original.apply(this, args)

      const scheduler = getNatsPurgeScheduler()

      if (!scheduler) {
        return result
      }

      const recordId = idExtractor(result)

      if (!recordId) {
        return result
      }

      const request = args[0] as any
      // TenantAgent.context.contextCorrelationId = `tenant-${tenantId}` (Credo internals)
      const contextCorrelationId: string = (request?.agent as any)?.context?.contextCorrelationId ?? ''
      const tenantId: string = contextCorrelationId.startsWith('tenant-')
        ? contextCorrelationId.slice('tenant-'.length)
        : ''
      const agentMode: AgentMode = tenantId ? 'shared' : 'dedicated'

      // Fire-and-forget: purge scheduling must not block record creation.
      // If NATS publish fails and cron is disabled, this record will not be purged.
      scheduler.schedulePurge(recordType, recordId, tenantId, agentMode).catch(() => {
        // intentionally silent — cron fallback or record TTL handles cleanup
      })

      return result
    }

    return descriptor
  }
}
