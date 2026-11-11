import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  testTimeout: 120000,
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/build/', '/node_modules/', '/__tests__/', 'tests'],
  coverageDirectory: '<rootDir>/coverage/',
  verbose: true,
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],
  // Live integration tests need a running agent and OpenBao. They are opt-in via `yarn test:integration` and must
  // never run in CI or in the default unit test run.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
}

export default config
