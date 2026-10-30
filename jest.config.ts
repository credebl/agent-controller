import type { Config } from '@jest/types'

import base from './jest.config.base'

const config: Config.InitialOptions = {
  ...base,
  displayName: 'agent-controller',
  testTimeout: 120000,
}

export default config
