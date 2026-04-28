import type { AgentMode, PurgeRecordType } from '../PurgeTypes'

import { getCronPurgeScheduler, getNatsPurgeScheduler } from '../PurgeSchedulerFactory'

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
        const resultKeys = result && typeof result === 'object' ? Object.keys(result) : typeof result
        console.warn(`[Purge] @SchedulePurge(${recordType}): could not extract recordId — result shape: ${JSON.stringify(resultKeys)}`)
        return result
      }

      const request = args[0] as any
      // TenantAgent.context.contextCorrelationId = `tenant-${tenantId}` (Credo internals)
      const contextCorrelationId: string = (request?.agent as any)?.context?.contextCorrelationId ?? ''
      const tenantId: string = contextCorrelationId.startsWith('tenant-')
        ? contextCorrelationId.slice('tenant-'.length)
        : ''
      const agentMode: AgentMode = tenantId ? 'shared' : 'dedicated'

      console.info(`[Purge] Scheduling purge: ${recordType} recordId=${recordId} tenantId="${tenantId}" agentMode=${agentMode}`)

      // Fire-and-forget: purge scheduling must not block record creation.
      // If NATS publish fails and cron is disabled, this record will not be purged.
      scheduler.schedulePurge(recordType, recordId, tenantId, agentMode).catch((err: Error) => {
        const hasCronFallback = getCronPurgeScheduler() !== null
        const level = hasCronFallback ? 'warn' : 'error'
        console[level](
          `[Purge] Failed to schedule NATS purge for ${recordType}:${recordId} — ${hasCronFallback ? 'cron fallback active' : 'NO cron fallback, record may leak'}: ${err?.message}`,
        )
      })

      return result
    }

    return descriptor
  }
}
