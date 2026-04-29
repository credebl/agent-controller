import type { Logger } from '@credo-ts/core'

import fetch from 'node-fetch'

const DEFAULT_TIMEOUT = 5000;

export const sendWebhookEvent = async (
  webhookUrl: string,
  body: Record<string, unknown>,
  logger: Logger,
  timeoutMs?: number,
): Promise<void> => {

  const envTimeout = parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '', 10)
  const candidateTimeout = timeoutMs ?? envTimeout
  const resolvedTimeout = candidateTimeout > 0 ? candidateTimeout : DEFAULT_TIMEOUT

  logger.info(`Sending webhook event to ${webhookUrl} with timeout of ${resolvedTimeout}ms`)
  // Abort the webhook send events if the request hangs-in for >5 secs
  // This can avoid failure of services due to bad webhook listners
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), resolvedTimeout)

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
  } catch (error: any) {
    const type = body?.type ?? 'unknown'
    logger.error(`Error sending '${type}' webhook event to ${webhookUrl}`, {
      cause: error,
      // Logging improved to understand if the error is actually from delayed response or some other error.
      // Helpful when debugging
      aborted: error.name === 'AbortError',
    })
  } finally {
    clearTimeout(timeout)
  }
}
