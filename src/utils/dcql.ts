import { BadRequestError } from '../errors/errors'

// An absolute IRI starts with a scheme, e.g. `https:` or `urn:`
const ABSOLUTE_IRI = /^[a-z][a-z0-9+.-]*:/i

/**
 * Checks that `ldp_vc` credential queries list expanded JSON-LD types in `meta.type_values`.
 *
 * DCQL matches `ldp_vc` credentials on their types after the `@context` is applied, e.g.
 * `https://www.w3.org/2018/credentials#VerifiableCredential`, so a short name like `MyCredential` never
 * matches and the wallet only answers that the query can't be satisfied.
 */
export function assertDcqlLdpVcTypeValuesExpanded(dcql: unknown) {
  const definition = typeof dcql === 'string' ? parseJson(dcql) : dcql
  const credentials = (definition as { query?: { credentials?: unknown } } | undefined)?.query?.credentials
  if (!Array.isArray(credentials)) return

  for (const credential of credentials) {
    if (credential?.format !== 'ldp_vc') continue

    const typeValues: unknown = credential.meta?.type_values
    if (!Array.isArray(typeValues)) continue

    const shortNames = typeValues
      .flat()
      .filter((typeValue: unknown) => typeof typeValue !== 'string' || !ABSOLUTE_IRI.test(typeValue))
    if (shortNames.length > 0) {
      throw new BadRequestError(
        `DCQL credential query '${credential.id}': meta.type_values for ldp_vc must be expanded JSON-LD type IRIs ` +
          `(e.g. 'https://www.w3.org/2018/credentials#VerifiableCredential'), not ${shortNames
            .map((name: unknown) => `'${String(name)}'`)
            .join(', ')}. Use the IRI the credential's @context defines for each type.`,
      )
    }
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    // Credo reports an invalid query itself
    return undefined
  }
}
