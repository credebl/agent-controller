import type { PurgeRecordType } from '../PurgeTypes'

import { getNatsPurgeScheduler } from '../PurgeSchedulerFactory'

export function SchedulePurge(
  recordType: PurgeRecordType,
  idExtractor: (result: unknown) => string | undefined,
) {
  return function (_target: object, _key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>

    descriptor.value = async function (...args: unknown[]) {
      const result = await original.apply(this, args)

      const scheduler = getNatsPurgeScheduler()

      if (!scheduler) {
        console.warn(`[Purge] @SchedulePurge(${recordType}): NATS scheduler not initialized — skipping`)
        return result
      }

      const recordId = idExtractor(result)

      if (!recordId) {
        console.warn(`[Purge] @SchedulePurge(${recordType}): could not extract recordId from result`, result)
        return result
      }

      const request = args[0] as any
      // TenantAgent sets context.contextCorrelationId = `tenant-${tenantId}` (Credo internals).
      // Auth middleware sets request.agent to TenantAgent directly — query param is not reliable.
      const contextCorrelationId: string = (request?.agent as any)?.context?.contextCorrelationId ?? ''
      const tenantId: string = contextCorrelationId.startsWith('tenant-')
        ? contextCorrelationId.slice('tenant-'.length)
        : ''
      const agentMode: 'shared' | 'dedicated' = tenantId ? 'shared' : 'dedicated'

      console.info(`[Purge] Scheduling purge: ${recordType} recordId=${recordId} tenantId="${tenantId}" agentMode=${agentMode}`)

      scheduler.schedulePurge(recordType, recordId, tenantId, agentMode).catch((err: Error) => {
        console.error(`[Purge] Failed to schedule purge for ${recordType}:${recordId}`, err?.message)
      })

      return result
    }

    return descriptor
  }
}
