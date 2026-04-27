import type { Logger } from '@credo-ts/core'

import fetch from 'node-fetch'

const DEFAULT_TIMEOUT = 5000;

export const sendWebhookEvent = async (
  webhookUrl: string,
  body: Record<string, unknown>,
  logger: Logger,
  timeoutMs: number = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT,
): Promise<void> => {

  console.log(`Sending webhook event to ${webhookUrl} with timeout of ${timeoutMs}ms`)
  // Abort the webhook send events if the request hangs-in for >5 secs
  // This can avoid failure of services due to bad webhook listners
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

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
