import type { NatsConfig } from '../purge/PurgeTypes'
import type { Authenticator } from 'nats'

import { credsAuthenticator, nkeyAuthenticator, usernamePasswordAuthenticator } from 'nats'
import { readFileSync } from 'node:fs'

export type NatsAuthType = 'nkey' | 'creds' | 'usernamePassword' | 'none'

export function buildNatsAuthenticator(nats: NatsConfig): { authenticator?: Authenticator } {
  const authType = (process.env.NATS_AUTH_TYPE as NatsAuthType) || 'none'

  switch (authType) {
    case 'nkey':
      if (!nats.nkeySeed) throw new Error('[NATS] NATS_AUTH_TYPE=nkey but NATS_NKEY_SEED is not set')
      return { authenticator: nkeyAuthenticator(new TextEncoder().encode(nats.nkeySeed)) }

    case 'creds':
      if (!nats.credentialsFile) throw new Error('[NATS] NATS_AUTH_TYPE=creds but NATS_CREDENTIALS_FILE is not set')
      return { authenticator: credsAuthenticator(readFileSync(nats.credentialsFile)) }

    case 'usernamePassword':
      if (!nats.username || !nats.password)
        throw new Error('[NATS] NATS_AUTH_TYPE=usernamePassword but NATS_USER or NATS_PASSWORD is not set')
      return { authenticator: usernamePasswordAuthenticator(nats.username, nats.password) }

    case 'none':
    default:
      return {}
  }
}
