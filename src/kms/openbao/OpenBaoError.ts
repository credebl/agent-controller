import { AxiosError } from 'axios'

export class OpenBaoHttpError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
  }
}

export const toSafeOpenBaoError = (error: unknown): Error => {
  if (error instanceof OpenBaoHttpError) return error
  if (!(error instanceof AxiosError)) return error instanceof Error ? error : new Error(String(error))

  const responseData = error.response?.data
  const responseErrors =
    typeof responseData === 'object' && responseData !== null && 'errors' in responseData
      ? (responseData as { errors?: unknown }).errors
      : undefined
  const detail = Array.isArray(responseErrors)
    ? responseErrors.filter((value): value is string => typeof value === 'string').join('; ')
    : undefined
  const status = error.response?.status
  const statusSuffix = status ? ` (${status})` : ''
  const detailSuffix = detail ? `: ${detail}` : ''

  return new OpenBaoHttpError(`OpenBao request failed${statusSuffix}${detailSuffix}`, status)
}
