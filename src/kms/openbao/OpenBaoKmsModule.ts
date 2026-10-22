import type { OpenBaoKmsConfig } from './OpenBaoKmsConfig'

import { Kms, type DependencyManager, type Module } from '@credo-ts/core'

import { OpenBaoKeyManagementService } from './OpenBaoKeyManagementService'
import { resolveOpenBaoKmsConfig } from './OpenBaoKmsConfig'

export class OpenBaoKmsModule implements Module {
  private readonly service: OpenBaoKeyManagementService

  public constructor(config: OpenBaoKmsConfig) {
    this.service = new OpenBaoKeyManagementService(resolveOpenBaoKmsConfig(config))
  }

  public register(dependencyManager: DependencyManager) {
    dependencyManager.resolve(Kms.KeyManagementModuleConfig).registerBackend(this.service)
  }
}
