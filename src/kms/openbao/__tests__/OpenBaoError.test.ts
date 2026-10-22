import { AxiosError, AxiosHeaders } from 'axios'

import { OpenBaoHttpError, toSafeOpenBaoError } from '../OpenBaoError'

describe('toSafeOpenBaoError', () => {
  test('does not retain Axios request configuration or authentication headers', () => {
    const error = new AxiosError(
      'Request failed',
      'ERR_BAD_RESPONSE',
      {
        headers: new AxiosHeaders({ 'X-Vault-Token': 'secret-token' }),
      },
      undefined,
      {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { errors: ['permission denied'] },
      },
    )

    const safeError = toSafeOpenBaoError(error)

    expect(safeError).toBeInstanceOf(OpenBaoHttpError)
    expect(safeError.message).toBe('OpenBao request failed (403): permission denied')
    expect(JSON.stringify(safeError)).not.toContain('secret-token')
    expect(safeError).not.toHaveProperty('config')
    expect(safeError).not.toHaveProperty('request')
  })
})
