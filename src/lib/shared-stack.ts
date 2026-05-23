import {
  ensure404HandlerImage,
  ensureTraefikPorts,
  initTraefikFiles,
  traefikFilesExist,
} from './traefik.ts'
import {
  isTraefikRunning,
  restartTraefik,
  startTraefik,
  stopTraefik,
  traefikHasRequiredPorts,
} from './compose.ts'

export interface SharedStackResult {
  started: boolean
  restarted: boolean
  updated: boolean
}

export async function prepareSharedStack(requiredPorts: number[]): Promise<SharedStackResult> {
  let updated = false

  if (!traefikFilesExist()) {
    await initTraefikFiles(requiredPorts)
    updated = true
  }

  await ensure404HandlerImage()
  const configUpdated = await ensureTraefikPorts(requiredPorts)
  const running = await isTraefikRunning()

  if (!running) {
    await startTraefik()
    return { started: true, restarted: false, updated: updated || configUpdated }
  }

  if (configUpdated || !(await traefikHasRequiredPorts(requiredPorts))) {
    await restartTraefik()
    return { started: false, restarted: true, updated: true }
  }

  return { started: false, restarted: false, updated: updated || configUpdated }
}

export async function stopSharedStack(): Promise<void> {
  if (!traefikFilesExist()) {
    return
  }

  await stopTraefik()
}

export async function isSharedStackRunning(): Promise<boolean> {
  return isTraefikRunning()
}

export async function sharedStackHasRequiredPorts(requiredPorts: number[]): Promise<boolean> {
  return traefikHasRequiredPorts(requiredPorts)
}
