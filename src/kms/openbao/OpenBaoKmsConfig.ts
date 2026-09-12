export interface OpenBaoKmsConfig {
  url: string
  transitMount?: string
  keyPrefix?: string
  namespace?: string
  token?: string
  appRole?: {
    roleId: string
    secretId: string
    mountPath?: string
  }
}

export interface ResolvedOpenBaoKmsConfig {
  url: string
  transitMount: string
  keyPrefix: string
  namespace?: string
  token?: string
  appRole?: {
    roleId: string
    secretId: string
    mountPath: string
  }
}

const pathPart = (value: string, name: string) => {
  const normalized = value.replace(/^\/+|\/+$/g, '')
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens`)
  }
  return normalized
}

export const resolveOpenBaoKmsConfig = (config: OpenBaoKmsConfig): ResolvedOpenBaoKmsConfig => {
  const url = config.url.replace(/\/+$/, '')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('OpenBao KMS url must be a valid http or https URL with a hostname')
  }
  if (
    config.url !== config.url.trim() ||
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('OpenBao KMS url must be a valid http or https URL with a hostname and no credentials')
  }
  if (config.token && config.appRole) throw new Error('Configure either an OpenBao token or AppRole, not both')
  if (!config.token && !config.appRole) throw new Error('OpenBao KMS requires a token or AppRole credentials')

  return {
    url,
    transitMount: pathPart(config.transitMount ?? 'transit', 'OpenBao Transit mount'),
    keyPrefix: pathPart(config.keyPrefix ?? 'credebl', 'OpenBao key prefix'),
    namespace: config.namespace,
    token: config.token,
    appRole: config.appRole
      ? {
          roleId: config.appRole.roleId,
          secretId: config.appRole.secretId,
          mountPath: pathPart(config.appRole.mountPath ?? 'approle', 'OpenBao AppRole mount'),
        }
      : undefined,
  }
}
