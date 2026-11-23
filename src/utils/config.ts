/* eslint-disable no-console */
export const isCustomDocumentLoaderEnabled = (): boolean => {
  const flag = process.env.ENABLE_CUSTOM_DOCUMENT_LOADER ?? 'false'
  const isCustomDocumentLoaderEnabled = flag.toLowerCase() === 'true'

  if (isCustomDocumentLoaderEnabled) {
    if (!process.env.DEPRECATED_DOMAIN || !process.env.CURRENT_DOMAIN) {
      console.debug('Invalid configuration set for enabling custom document loader')
      console.info(
        "If you are unsure about what the error is about. Try setting the 'ENABLE_CUSTOM_DOCUMENT_LOADER' flag in the env variable to false",
      )
      throw new Error(
        `Custom document loader for the agent is enabled but the deprecated domain and updated domain is not set`,
      )
    }
    console.warn(
      `Custom document loader for the agent is enabled. Resolution of all URLs from the deprecated domain(${process.env.DEPRECATED_DOMAIN}) will actually be resolved from the current, updated domain(${process.env.CURRENT_DOMAIN})`,
    )
  }

  return isCustomDocumentLoaderEnabled
}

/**
 * Removes the given environment variables when they are blank. yargs reads a blank boolean such as
 * `AFJ_REST_INDY_ENABLED=` (common in deployment templates) as `false`, which would silently switch a feature off.
 * A blank value is treated as unset instead, so the config file or the automatic default applies.
 */
export function unsetBlankEnv(names: string[], env: NodeJS.ProcessEnv = process.env): void {
  for (const name of names) {
    if (env[name] !== undefined && env[name]?.trim() === '') {
      delete env[name]
    }
  }
}
