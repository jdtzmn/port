import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import {
  pinRemoteSessionObservation,
  remoteHandshake,
  restoreRemoteSessionObservation,
} from './session.ts'
import { parseSshConnectionIdentity } from './connectionIdentity.ts'

const identity = parseSshConnectionIdentity('hostname example.test\nuser tester\nport 22\n')!
const metadata = { version: 2, destination: 'example', connectionIdentity: identity }
const snapshot = {
  version: 1,
  kind: 'port-service-snapshot',
  instanceId: 'test',
  revision: 0,
  worktrees: [],
}
const envelope = {
  version: 1,
  kind: 'port-session-snapshot',
  status: 'ready',
  observedAt: 10,
  snapshot,
}
let directory: string
let servers: Server[]
function put(name: string, value: unknown): void {
  writeFileSync(`${directory}/${name}`, JSON.stringify(value), { mode: 0o600 })
}
async function listen(): Promise<void> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(`${directory}/s`, resolve)
  })
}
function pin() {
  const handle = pinRemoteSessionObservation(directory)
  expect(handle).not.toBeNull()
  return handle!
}
beforeEach(async () => {
  servers = []
  directory = mkdtempSync('/tmp/port-ssh-')
  chmodSync(directory, 0o700)
  put('metadata.json', metadata)
  put('handshake.json', remoteHandshake())
  put('snapshot.json', envelope)
  await listen()
})
afterEach(async () => {
  for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
  rmSync(`${directory}-old`, { recursive: true, force: true })
})

describe('pinned remote observations', () => {
  it('roundtrips detached original pins without refreshing stale or repeated cache timestamps', () => {
    const handle = pin()
    const saved = JSON.parse(JSON.stringify(handle.checkpoint()))
    expect(saved.directory).toBe(directory)
    expect(Object.keys(saved.root).sort()).toEqual(['dev', 'ino', 'uid'])
    const restored = restoreRemoteSessionObservation(saved)
    expect(restored.sessionId).toBe(handle.sessionId)
    expect(restored.checkpoint()).toEqual(handle.checkpoint())
    expect(restored.read(999999)).toEqual(handle.read(999999))
    expect(restored.read(999999).observedAt).toBe(10)
    saved.root.ino++
    saved.connectionIdentity.hostname = 'changed'
    const output = restored.checkpoint()
    output.control.ino++
    output.connectionIdentity.user = 'changed'
    expect(restored.checkpoint()).toEqual(handle.checkpoint())
    expect(restored.read(999999).status).toBe('ready')
  })
  it.each(['root', 'control'])(
    'restores original %s loss/replacement and latches it',
    async kind => {
      const saved = pin().checkpoint()
      const path = kind === 'root' ? directory : `${directory}/s`
      const moved = kind === 'root' ? `${directory}-old` : `${directory}/old-s`
      renameSync(path, moved)
      const missing = restoreRemoteSessionObservation(saved)
      expect(missing.read(20).status).toBe('disconnected')
      if (kind === 'root') {
        mkdirSync(directory, { mode: 0o700 })
        put('metadata.json', metadata)
        put('handshake.json', remoteHandshake())
        put('snapshot.json', envelope)
      }
      await listen()
      const replaced = restoreRemoteSessionObservation(saved)
      expect(replaced.checkpoint()).toEqual(saved)
      expect(replaced.read(20).status).toBe('disconnected')
      expect(missing.read(20).status).toBe('disconnected')
      expect(restoreRemoteSessionObservation(missing.checkpoint()).read(20).status).toBe(
        'disconnected'
      )
    }
  )
  it.each(['metadata.json', 'handshake.json'])(
    'retains original %s through unsafe restore',
    name => {
      const saved = pin().checkpoint()
      chmodSync(`${directory}/${name}`, 0o000)
      const unreadable = restoreRemoteSessionObservation(saved)
      expect(unreadable.read(20).status).toBe('unavailable')
      expect(unreadable.checkpoint()).toEqual(saved)
      chmodSync(`${directory}/${name}`, 0o600)
      expect(unreadable.read(20).status).toBe('ready')
      put('next', name === 'metadata.json' ? metadata : remoteHandshake())
      renameSync(`${directory}/next`, `${directory}/${name}`)
      expect(pin().sessionId).not.toBe(saved.sessionId)
      const replaced = restoreRemoteSessionObservation(saved)
      expect(replaced.read(20).status).toBe('unavailable')
      expect(replaced.checkpoint()).toEqual(saved)
      unlinkSync(`${directory}/${name}`)
      expect(restoreRemoteSessionObservation(saved).read(20).status).toBe('unavailable')
    }
  )
  it('restores permission ambiguity and malformed cache without disconnecting', () => {
    const saved = pin().checkpoint()
    chmodSync(directory, 0o755)
    const restored = restoreRemoteSessionObservation(saved)
    expect(restored.read(20).status).toBe('unavailable')
    chmodSync(directory, 0o700)
    put('snapshot.json', {})
    expect(restored.read(20).status).toBe('unavailable')
    put('snapshot.json', envelope)
    expect(restored.read(999999).observedAt).toBe(10)
    expect(restored.checkpoint()).toEqual(saved)
  })
  it('rejects malformed and oversized checkpoints with a sanitized error', () => {
    const saved = pin().checkpoint()
    const invalid = [
      null,
      {},
      { ...saved, extra: true },
      { ...saved, version: 2 },
      { ...saved, directory: `/private${directory}` },
      { ...saved, sessionId: '0'.repeat(64) },
      { ...saved, destination: 'x'.repeat(8193) },
      { ...saved, connectionIdentity: { ...identity, hostname: 'x'.repeat(1025) } },
      { ...saved, root: { ...saved.root, extra: 1 } },
      { ...saved, disconnected: 'false' },
      ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'].flatMap(ino =>
        ['root', 'control', 'metadata', 'handshake'].map(key => ({
          ...saved,
          [key]: { ...saved.root, ino },
        }))
      ),
      { ...saved, root: { ...saved.root, uid: saved.root.uid + 1 } },
      { ...saved, root: { ...saved.root, dev: -1 } },
      {
        ...saved,
        get destination() {
          throw new Error('secret')
        },
      },
    ]
    for (const value of invalid) {
      expect(() => restoreRemoteSessionObservation(value)).toThrow(
        'Invalid remote session observation checkpoint'
      )
    }
    expect(pin().checkpoint()).toEqual(saved)
  })
  it('reads ready, replay and atomic updates without refreshing timestamps', () => {
    const handle = pin()
    expect(pin().sessionId).toBe(handle.sessionId)
    expect(handle.read(20)).toEqual({
      destination: 'example',
      connectionIdentity: identity,
      status: 'ready',
      observedAt: 10,
      snapshot,
    })
    expect(handle.read(999999).observedAt).toBe(10)
    put('next', { ...envelope, observedAt: 11 })
    renameSync(`${directory}/next`, `${directory}/snapshot.json`)
    expect(handle.read(20).observedAt).toBe(11)
    expect(pin().sessionId).toBe(handle.sessionId)
  })
  it.each([snapshot, null])('accepts unavailable with retained or null snapshot %j', value => {
    put('snapshot.json', { ...envelope, status: 'unavailable', snapshot: value })
    expect(pin().read(20)).toMatchObject({ status: 'unavailable', snapshot: value, observedAt: 10 })
  })
  it('isolates caller mutation of identity, snapshots and handle properties', () => {
    const handle = pin()
    const first = handle.read(20)
    first.connectionIdentity.hostname = 'changed'
    first.destination = 'changed'
    first.snapshot!.instanceId = 'changed'
    expect(Reflect.set(handle, 'sessionId', 'changed')).toBe(false)
    expect(handle.read(20)).toMatchObject({
      destination: 'example',
      connectionIdentity: identity,
      snapshot,
    })
  })
  it.each([
    null,
    {},
    { ...envelope, version: 2 },
    { ...envelope, kind: 'wrong' },
    { ...envelope, extra: true },
    { ...envelope, status: 'disconnected' },
    { ...envelope, observedAt: -1 },
    { ...envelope, observedAt: 21 },
    { ...envelope, observedAt: null },
    { ...envelope, snapshot: null },
    { ...envelope, snapshot: {} },
    { ...envelope, snapshot: { ...snapshot, extra: true } },
  ])('rejects malformed envelope %j without disconnecting', value => {
    const handle = pin()
    put('snapshot.json', value)
    expect(handle.read(20).status).toBe('unavailable')
    put('snapshot.json', envelope)
    expect(handle.read(20).status).toBe('ready')
  })
  it.each(['missing', 'json', 'oversized', 'symlink', 'permissions', 'hardlink', 'directory'])(
    'rejects unsafe cache: %s',
    kind => {
      const handle = pin()
      if (kind === 'missing') unlinkSync(`${directory}/snapshot.json`)
      if (kind === 'json') writeFileSync(`${directory}/snapshot.json`, '{')
      if (kind === 'oversized')
        writeFileSync(`${directory}/snapshot.json`, ' '.repeat(4 * 1024 * 1024 + 1025))
      if (kind === 'permissions') chmodSync(`${directory}/snapshot.json`, 0o644)
      if (kind === 'hardlink') linkSync(`${directory}/snapshot.json`, `${directory}/link`)
      if (kind === 'symlink' || kind === 'directory') {
        unlinkSync(`${directory}/snapshot.json`)
        if (kind === 'symlink')
          symlinkSync(`${directory}/metadata.json`, `${directory}/snapshot.json`)
        else mkdirSync(`${directory}/snapshot.json`)
      }
      expect(handle.read(20).status).toBe('unavailable')
    }
  )
  it.each(['legacy', 'kind', 'version', 'permissions', 'symlink', 'missing'])(
    'requires private v2 metadata and handshake: %s',
    kind => {
      if (kind === 'legacy') put('metadata.json', { version: 1, destination: 'example' })
      if (kind === 'kind') put('handshake.json', { version: 1, kind: 'wrong' })
      if (kind === 'version') put('handshake.json', { version: 2, kind: 'port-handshake' })
      if (kind === 'permissions') chmodSync(`${directory}/handshake.json`, 0o644)
      if (kind === 'missing' || kind === 'symlink') {
        unlinkSync(`${directory}/handshake.json`)
        if (kind === 'symlink')
          symlinkSync(`${directory}/metadata.json`, `${directory}/handshake.json`)
      }
      expect(pinRemoteSessionObservation(directory)).toBeNull()
    }
  )
  it('does not adopt metadata replacements even with identical content', () => {
    const handle = pin()
    put('next', metadata)
    renameSync(`${directory}/next`, `${directory}/metadata.json`)
    expect(handle.read(20).status).toBe('unavailable')
    expect(pin().sessionId).not.toBe(handle.sessionId)
  })
  it('rejects metadata identity changes and missing metadata without disconnect', () => {
    const handle = pin()
    put('metadata.json', { ...metadata, destination: 'another' })
    expect(handle.read(20).status).toBe('unavailable')
    unlinkSync(`${directory}/metadata.json`)
    expect(handle.read(20).status).toBe('unavailable')
  })
  it('treats root permission ambiguity as unavailable and allows recovery', () => {
    const handle = pin()
    chmodSync(directory, 0o755)
    expect(handle.read(20).status).toBe('unavailable')
    chmodSync(directory, 0o700)
    expect(handle.read(20).status).toBe('ready')
  })
  it.each([false, true])(
    'latches control loss/replacement (replacement first: %s)',
    async replacementFirst => {
      const handle = pin()
      renameSync(`${directory}/s`, `${directory}/old-s`)
      if (replacementFirst) await listen()
      expect(handle.read(20).status).toBe('disconnected')
      if (!replacementFirst) await listen()
      expect(handle.read(20).status).toBe('disconnected')
      expect(pin().sessionId).not.toBe(handle.sessionId)
    }
  )
  it.each([false, true])(
    'latches root loss/replacement (replacement first: %s)',
    async replacementFirst => {
      const handle = pin()
      renameSync(directory, `${directory}-old`)
      const recreate = async () => {
        mkdirSync(directory, { mode: 0o700 })
        put('metadata.json', metadata)
        put('handshake.json', remoteHandshake())
        put('snapshot.json', envelope)
        await listen()
      }
      if (replacementFirst) await recreate()
      expect(handle.read(20).status).toBe('disconnected')
      if (!replacementFirst) await recreate()
      expect(handle.read(20).status).toBe('disconnected')
      expect(pin().sessionId).not.toBe(handle.sessionId)
    }
  )
})
