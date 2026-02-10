import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const TEST_GLOBAL_PORT_DIR_ENV = 'PORT_GLOBAL_DIR'

export default async function globalSetup() {
  const sharedGlobalPortDir = await mkdtemp(join(tmpdir(), 'port-global-state-'))
  process.env[TEST_GLOBAL_PORT_DIR_ENV] = sharedGlobalPortDir

  return async () => {
    await rm(sharedGlobalPortDir, { recursive: true, force: true })
    delete process.env[TEST_GLOBAL_PORT_DIR_ENV]
  }
}
