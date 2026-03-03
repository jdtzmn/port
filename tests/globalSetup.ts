import { mkdtemp, rm } from 'fs/promises'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const TEST_GLOBAL_PORT_DIR_ENV = 'PORT_GLOBAL_DIR'

export default async function globalSetup() {
  const sharedGlobalPortDir = await mkdtemp(join(tmpdir(), 'port-global-state-'))
  process.env[TEST_GLOBAL_PORT_DIR_ENV] = sharedGlobalPortDir

  return async () => {
    // Stop the shared Traefik container that integration tests may have started.
    // This runs once after ALL test workers have finished, so it's safe.
    try {
      execSync('docker rm -f port-traefik 2>/dev/null', { stdio: 'ignore' })
    } catch {
      // Container may not exist – that's fine.
    }

    await rm(sharedGlobalPortDir, { recursive: true, force: true })
    delete process.env[TEST_GLOBAL_PORT_DIR_ENV]
  }
}
