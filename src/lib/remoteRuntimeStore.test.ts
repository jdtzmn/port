import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRemoteOwnerRegistry } from './remoteOwnerRegistry.ts'
import { createRemoteCoordinatorState } from './remoteCoordinatorState.ts'
import type { RemoteSessionObservationPin } from './remoteSession.ts'
import {
  createRemotePublisher,
  readRemoteCatalog,
  readRemoteCheckpoint,
  readRemoteRouteView,
  registerRemotePin,
  type RemoteRuntimeCheckpoint,
} from './remoteRuntimeStore.ts'

let root: string
let dynamicDirectory: string
const owners = createRemoteOwnerRegistry().serialize()
const empty = (): RemoteRuntimeCheckpoint => ({
  version: 1,
  pins: [],
  local: null,
  ownership: createRemoteCoordinatorState(createRemoteOwnerRegistry()).checkpoint(),
})
const a = 'a'.repeat(32)
const b = 'b'.repeat(32)
const filename = 'port-remote-routes.yml'
function pin(name: string): RemoteSessionObservationPin {
  const stat = { dev: 1, ino: 2, uid: process.getuid!() }
  const directory = `/tmp/port-ssh-${name.padEnd(6, '0')}`
  return {
    version: 1,
    directory,
    root: stat,
    metadata: stat,
    control: stat,
    handshake: stat,
    sessionId: createHash('sha256')
      .update(JSON.stringify([directory, [1, 2], [1, 2], [1, 2], [1, 2]]))
      .digest('hex'),
    destination: 'fixture',
    connectionIdentity: {
      hostname: 'fixture',
      user: 'fixture',
      port: 22,
      contextHash: 'a'.repeat(64),
    },
    disconnected: false,
  }
}
beforeEach(async () => {
  root = await realpath(await mkdtemp('/tmp/port-publisher-'))
  dynamicDirectory = join(root, 'dynamic')
  await mkdir(dynamicDirectory, { mode: 0o700 })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runtime recovery and publication', () => {
  it('journals concurrent registrations without losing admissions to a frame', async () => {
    await Promise.all([registerRemotePin(root, pin('one')), registerRemotePin(root, pin('two'))])
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => true,
    })
    await publisher.activate(owners)
    await publisher.publish(owners, empty(), 'http: {}\n')
    expect(await readRemoteCatalog(root)).toHaveLength(2)
    expect(await readRemoteCheckpoint(root, owners)).toEqual(empty())
    await registerRemotePin(root, pin('one'))
    expect(await readRemoteCatalog(root)).toHaveLength(2)
  })

  it('reads only the sanitized persisted route view', async () => {
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => true,
    })
    const state: RemoteRuntimeCheckpoint = {
      ...empty(),
      routes: {
        version: 1,
        routes: [
          {
            hostname: 'ui.feature.port',
            port: 80,
            transport: 'http',
            availability: 'ready',
          },
        ],
      },
    }
    await publisher.activate(owners)
    await publisher.publish(owners, state, 'http: {}\n')
    expect(await readRemoteRouteView(root)).toEqual(state.routes)
  })

  it('fences old publishers after replacement and preserves existing YAML', async () => {
    let current = a
    const first = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => current === a,
    })
    await first.activate(owners)
    await first.publish(owners, empty(), 'http: {}\n')
    current = b
    const next = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: b,
      isCurrent: async () => current === b,
    })
    await next.activate(owners)
    await next.publish(owners, empty(), 'tcp: {}\n')
    await expect(first.publish(owners, empty(), 'http: {}\n')).rejects.toThrow()
    expect(await readFile(join(dynamicDirectory, filename), 'utf8')).toBe(
      '# Port remote routes v1\ntcp: {}\n'
    )
  })

  it('blocks recovery if checkpoint is missing while managed routing exists', async () => {
    await writeFile(join(dynamicDirectory, filename), '# Port remote routes v1\nhttp: {}', {
      mode: 0o600,
    })
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => true,
    })
    await expect(publisher.activate(owners)).rejects.toThrow()
    expect(await readFile(join(dynamicDirectory, filename), 'utf8')).toContain('http: {}')
  })

  it('does not publish or reset corrupt checkpoint data', async () => {
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => true,
    })
    await publisher.activate(owners)
    await publisher.publish(owners, empty(), 'http: {}\n')
    await writeFile(join(root, 'checkpoint.json'), '{broken')
    await expect(publisher.publish(owners, empty(), 'tcp: {}\n')).rejects.toThrow()
    expect(await readFile(join(root, 'checkpoint.json'), 'utf8')).toBe('{broken')
    expect(await readFile(join(dynamicDirectory, filename), 'utf8')).toContain('http: {}')
  })

  it('persists recovery data even when YAML publication fails', async () => {
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: a,
      isCurrent: async () => true,
    })
    await publisher.activate(owners)
    await rm(dynamicDirectory, { recursive: true })
    await expect(publisher.publish(owners, empty(), 'http: {}\n')).rejects.toThrow()
    expect(await readRemoteCheckpoint(root, owners)).toEqual(empty())
  })

  it('rejects unsafe and corrupt catalog files rather than resetting them', async () => {
    await writeFile(join(root, 'catalog.json'), '{bad', { mode: 0o600 })
    await expect(registerRemotePin(root, pin('one'))).rejects.toThrow()
    await rm(join(root, 'catalog.json'))
    const outside = join(root, 'outside')
    await writeFile(outside, '{}', { mode: 0o600 })
    await symlink(outside, join(root, 'catalog.json'))
    await expect(readRemoteCatalog(root)).rejects.toThrow()
    await rm(join(root, 'catalog.json'))
    await registerRemotePin(root, pin('one'))
    await chmod(join(root, 'catalog.json'), 0o644)
    await expect(readRemoteCatalog(root)).rejects.toThrow()
  })
})
