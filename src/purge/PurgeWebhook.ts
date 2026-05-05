import type { PurgeRecordType } from './PurgeTypes'
import type { Logger } from '@credo-ts/core'

import { sleep } from '../utils/webhook'

import { PURGE_WEBHOOK_PATHS, PURGE_WEBHOOK_RETRY_DELAYS_MS } from './PurgeConstants'

export enum PurgeDeletionStatus {
  DELETED = 'deleted',
  ALREADY_ABSENT = 'already-absent',
}

export async function sendPurgeWebhook(
  webhookUrl: string,
  recordId: string,
  recordType: PurgeRecordType,
  tenantId: string,
  status: PurgeDeletionStatus,
  logger: Logger,
): Promise<void> {
  const url = `${webhookUrl}${PURGE_WEBHOOK_PATHS[recordType]}`
  const body = {
    eventType: 'purge.deletion.complete',
    occurredAt: new Date().toISOString(),
    tenantId,
    deletion: {
      recordId,
      recordType,
      status,
      deletedAt: new Date().toISOString(),
    },
  }

  const delays = PURGE_WEBHOOK_RETRY_DELAYS_MS
  const maxAttempts = delays.length + 1

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      logger.debug('[Purge] Webhook delivered', { url, recordId })
      return
    } catch (err: any) {
      if (attempt === maxAttempts - 1) {
        logger.warn('[Purge] Webhook failed after all retries', { url, recordId, error: err?.message })
      } else {
        logger.debug(`[Purge] Webhook attempt ${attempt + 1} failed — retrying in ${delays[attempt]}ms`)
        await sleep(delays[attempt])
      }
    }
  }
}
