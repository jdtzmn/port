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
import { pinRemoteSessionObservation, remoteHandshake } from './remoteSession.ts'
import { parseSshConnectionIdentity } from './sshConnectionIdentity.ts'

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
