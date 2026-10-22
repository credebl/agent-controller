import { resolveOpenBaoKmsConfig } from '../OpenBaoKmsConfig'

describe('resolveOpenBaoKmsConfig', () => {
  test('requires exactly one authentication method', () => {
    expect(() => resolveOpenBaoKmsConfig({ url: 'https://bao.example' })).toThrow('requires a token or AppRole')
    expect(() =>
      resolveOpenBaoKmsConfig({
        url: 'https://bao.example',
        token: 'token',
        appRole: { roleId: 'role', secretId: 'secret' },
      }),
    ).toThrow('either an OpenBao token or AppRole')
  })

  test('normalizes URL and mount paths', () => {
    expect(
      resolveOpenBaoKmsConfig({
        url: 'https://bao.example/',
        token: 'token',
        transitMount: '/wallet-transit/',
      }),
    ).toMatchObject({ url: 'https://bao.example', transitMount: 'wallet-transit', keyPrefix: 'credebl' })
  })

  test.each([
    'not-a-url',
    'ftp://bao.example',
    'https://bao .example',
    ' https://bao.example',
    'https://token@bao.example',
  ])('rejects invalid URL %s', (url) => {
    expect(() => resolveOpenBaoKmsConfig({ url, token: 'token' })).toThrow('valid http or https URL')
  })
})
