import { CronPurgeScheduler } from './schedulers/CronPurgeScheduler'
import { NatsPurgeScheduler } from './schedulers/NatsPurgeScheduler'

let _natsScheduler: NatsPurgeScheduler | null = null
let _cronScheduler: CronPurgeScheduler | null = null

export function getNatsPurgeScheduler(): NatsPurgeScheduler | null {
  return _natsScheduler
}

export function getCronPurgeScheduler(): CronPurgeScheduler | null {
  return _cronScheduler
}

export function initPurgeSchedulers(natsEnabled: boolean, cronEnabled: boolean): void {
  if (natsEnabled) _natsScheduler = new NatsPurgeScheduler()
  if (cronEnabled) _cronScheduler = new CronPurgeScheduler()
}

export async function stopPurgeSchedulers(): Promise<void> {
  await _natsScheduler?.stop()
  await _cronScheduler?.stop()
}
