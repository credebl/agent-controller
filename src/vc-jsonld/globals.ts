/**
 * Ambient type declarations for untyped third-party modules used by the VCDM 2.0
 * JSON-LD utility. This file intentionally has no top-level import/export so it is
 * treated as a global declaration (the build tsconfig excludes `.d.ts` files).
 *
 * The `@digitalcredentials/credentials-v2-context` package ships without types.
 */
declare module '@digitalcredentials/credentials-v2-context' {
  export const constants: {
    CONTEXT_FILENAME: string
    CONTEXT_URL: string
    CBORLD_VALUE: number
  }
  export const contexts: Map<string, Record<string, unknown>>
}
