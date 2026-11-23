import { unsetBlankEnv } from '../config'

describe('unsetBlankEnv', () => {
  it('removes blank values and keeps everything else', () => {
    const env: NodeJS.ProcessEnv = {
      AFJ_REST_INDY_ENABLED: '  ',
      EMPTY: '',
      FALSE: 'false',
      TRUE: 'true',
    }

    unsetBlankEnv(['AFJ_REST_INDY_ENABLED', 'EMPTY', 'FALSE', 'TRUE', 'MISSING'], env)

    expect(env).toEqual({ FALSE: 'false', TRUE: 'true' })
    expect('AFJ_REST_INDY_ENABLED' in env).toBe(false)
  })
})
