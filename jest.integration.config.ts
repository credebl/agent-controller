import type { Config } from '@jest/types'

/**
 * Live integration suite. It talks to a real agent-controller and a real OpenBao, so it is not part of `yarn test`
 * and is not run in CI. Use `yarn test:integration` after starting the stack described in
 * `e2e/openbao-did-web/README.md`.
 */
const config: Config.InitialOptions = {
  displayName: 'integration',
  rootDir: '.',
  testEnvironment: 'node',
  testTimeout: 300000,
  verbose: true,
  testMatch: ['<rootDir>/e2e/**/*.integration.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
}

export default config
