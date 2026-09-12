import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { createConnection, createServer, isIPv4, type Socket } from 'node:net'
import {
  isSshConnectionIdentity,
  parseSshConnectionIdentity,
  type SshConnectionIdentity,
} from './connectionIdentity.ts'
import { classifySshInvocation, isEligibleSshConfig } from './invocation.ts'
import { parseRemoteSnapshot, type RemoteSnapshot } from './snapshot.ts'

export interface RemoteHandshake {
  kind: 'port-handshake'
  version: 1
}

export function remoteHandshake(): RemoteHandshake {
  return { kind: 'port-handshake', version: 1 }
}

function ssh(
  args: string[],
  timeout: number,
  maxBuffer: number,
  signal?: AbortSignal
): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'ssh',
      args,
      { timeout, maxBuffer, encoding: 'utf8', ...(signal ? { signal } : {}) },
      (error, stdout) => {
        resolve(error ? null : stdout)
      }
    )
  })
}

function validSessionDirectory(directory: unknown): directory is string {
  return typeof directory === 'string' && /^\/tmp\/port-ssh-[A-Za-z0-9]{6}$/.test(directory)
}

function ownedDirectory(directory: string): Stats {
  if (!validSessionDirectory(directory) || !process.getuid) {
    throw new Error('Invalid session path')
  }
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) {
    throw new Error('Invalid session directory')
  }
  return stat
}

function unchanged(directory: string, original: RemoteSessionFileIdentity): void {
  const current = ownedDirectory(directory)
  if (current.dev !== original.dev || current.ino !== original.ino) {
    throw new Error('Session directory replaced')
  }
}

function privateFile(stat: Stats): boolean {
  return (
    stat.isFile() &&
    stat.uid === process.getuid?.() &&
    stat.nlink === 1 &&
    (stat.mode & 0o7777) === 0o600
  )
}

/**
 * No asynchronous gap between validation and local file operations. O_NOFOLLOW,
 * exclusive creation and inode checks reject stale/replaced state. /tmp's sticky
 * bit and the private directory isolate other users; this is not a sandbox against
 * a hostile process running as the same uid racing individual filesystem syscalls.
 * Node has no portable openat/renameat API. Never recursively remove state.
 */
function publish(directory: string, original: Stats, name: string, value: unknown): void {
  unchanged(directory, original)
  const temporary = `${directory}/${name}.tmp`
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    unchanged(directory, original)
    fchmodSync(fd, 0o600)
    writeFileSync(fd, JSON.stringify(value) + '\n')
  } finally {
    closeSync(fd)
  }
  unchanged(directory, original)
  // Existing output is never overwritten (including symlinks).
  try {
    lstatSync(`${directory}/${name}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    renameSync(temporary, `${directory}/${name}`)
    return
  }
  throw new Error('Session output already exists')
}

function sameInode(a: RemoteSessionFileIdentity, b: RemoteSessionFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/** Only the live cache may replace an existing, private output. */
function updateSnapshot(directory: string, original: Stats, value: unknown): void {
  const temporary = `${directory}/snapshot.json.tmp`
  const output = `${directory}/snapshot.json`
  let fd: number | undefined
  let owned: Stats | undefined
  const checkOutput = (): void => {
    unchanged(directory, original)
    try {
      if (!privateFile(lstatSync(output))) throw new Error('Invalid snapshot output')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    checkOutput()
    unchanged(directory, original)
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    unchanged(directory, original)
    owned = fstatSync(fd)
    unchanged(directory, original)
    fchmodSync(fd, 0o600)
    unchanged(directory, original)
    writeFileSync(fd, JSON.stringify(value) + '\n')
    checkOutput()
    unchanged(directory, original)
    const temp = lstatSync(temporary)
    if (!privateFile(temp) || !sameInode(temp, owned))
      throw new Error('Snapshot temporary replaced')
    unchanged(directory, original)
    renameSync(temporary, output)
  } finally {
    // Closing our descriptor is safe even when the pathname has disappeared.
    if (fd !== undefined) closeSync(fd)
    if (owned) {
      try {
        unchanged(directory, original)
        const temp = lstatSync(temporary)
        if (privateFile(temp) && sameInode(temp, owned)) {
          unchanged(directory, original)
          unlinkSync(temporary)
        }
      } catch {
        /* Never clean up an unowned or moved pathname. */
      }
    }
  }
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function sameSocket(
  directory: string,
  original: RemoteSessionFileIdentity,
  pinned: RemoteSessionFileIdentity
): boolean {
  const current = socket(directory, original)
  return current !== null && sameInode(current, pinned)
}

async function observeSnapshots(
  directory: string,
  original: Stats,
  pinned: Stats,
  signal?: AbortSignal,
  onSnapshot?: () => Promise<void>
): Promise<void> {
  let last: RemoteSnapshot | null = null
  let revision = 0
  const publishStatus = (status: 'ready' | 'unavailable'): void => {
    updateSnapshot(directory, original, {
      version: 1,
      kind: 'port-session-snapshot',
      status,
      observedAt: Date.now(),
      snapshot: last,
    })
  }
  try {
    while (!signal?.aborted) {
      if (!sameSocket(directory, original, pinned)) break
      let candidate: RemoteSnapshot | null = null
      try {
        const output = await ssh(
          [...companion(directory), 'dummy', `port __remote-snapshot ${revision}`],
          20_000,
          4 * 1024 * 1024 + 1,
          signal
        )
        if (output !== null) {
          candidate = parseRemoteSnapshot(output.endsWith('\n') ? output.slice(0, -1) : output)
          if (candidate.revision !== revision) candidate = null
        }
      } catch {
        /* Transport and validation failures retain the last known ownership. */
      }
      if (!sameSocket(directory, original, pinned)) break
      if (candidate && last && candidate.instanceId !== last.instanceId) break
      if (candidate) last = candidate
      publishStatus(candidate ? 'ready' : 'unavailable')
      try {
        await onSnapshot?.()
      } catch {
        /* Optional local routing cannot stop observation. */
      }
      if (revision === Number.MAX_SAFE_INTEGER) break
      revision++
      await pause(2000, signal)
    }
  } catch {
    /* Local ownership loss is terminal, never retarget or recreate. */
  }
  try {
    publishStatus('unavailable')
  } catch {
    /* Only the original private directory may be updated. */
  }
}

function readSession(directory: string): {
  metadata: Stats
  original: Stats
  destination: string
  connectionIdentity?: SshConnectionIdentity
} {
  const original = ownedDirectory(directory)
  const before = lstatSync(`${directory}/metadata.json`)
  if (!privateFile(before)) throw new Error('Invalid metadata')
  const fd = openSync(
    `${directory}/metadata.json`,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    unchanged(directory, original)
    const stat = fstatSync(fd)
    if (!privateFile(stat) || !sameInode(before, stat) || stat.size > 8192)
      throw new Error('Invalid metadata')
    const buffer = Buffer.alloc(8193)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    unchanged(directory, original)
    const after = lstatSync(`${directory}/metadata.json`)
    if (size > 8192 || !privateFile(after) || !sameInode(stat, after) || after.size !== size)
      throw new Error('Invalid metadata')
    const value = JSON.parse(buffer.subarray(0, size).toString('utf8'))
    if (
      !value ||
      (value.version !== 1 && value.version !== 2) ||
      (value.version === 2 && !isSshConnectionIdentity(value.connectionIdentity)) ||
      (value.version === 1 && Object.hasOwn(value, 'connectionIdentity')) ||
      typeof value.destination !== 'string' ||
      !classifySshInvocation([value.destination])
    )
      throw new Error('Invalid metadata')
    return {
      metadata: after,
      original,
      destination: value.destination,
      ...(value.version === 2 ? { connectionIdentity: value.connectionIdentity } : {}),
    }
  } finally {
    closeSync(fd)
  }
}

function session(directory: string): Stats {
  return readSession(directory).original
}

/** Legacy sessions cannot establish an addressing identity from a typed alias. */
export function readRemoteSessionIdentity(
  directory: string
): { destination: string; connectionIdentity: SshConnectionIdentity } | null {
  try {
    const { destination, connectionIdentity } = readSession(directory)
    return connectionIdentity ? { destination, connectionIdentity } : null
  } catch {
    return null
  }
}

export interface RemoteSessionObservation {
  destination: string
  connectionIdentity: SshConnectionIdentity
  status: 'ready' | 'unavailable' | 'disconnected'
  snapshot?: RemoteSnapshot | null
  observedAt?: number
}

export interface RemoteSessionFileIdentity {
  dev: number
  ino: number
  uid: number
}

/** Detached JSON data only; directory retains the original lexical spelling. */
export interface RemoteSessionObservationPin {
  version: 1
  directory: string
  sessionId: string
  root: RemoteSessionFileIdentity
  control: RemoteSessionFileIdentity
  metadata: RemoteSessionFileIdentity
  handshake: RemoteSessionFileIdentity
  destination: string
  connectionIdentity: SshConnectionIdentity
  disconnected: boolean
}

export interface RemoteSessionObservationHandle {
  readonly sessionId: string
  readonly read: (now: number) => RemoteSessionObservation
  readonly checkpoint: () => RemoteSessionObservationPin
}

/** Bounded private regular-file reads; never follow links or block on special files. */
function readObservationFile(path: string, limit: number): { stat: Stats; value: unknown } {
  const before = lstatSync(path)
  if (!privateFile(before) || before.size > limit) throw new Error('Invalid observation')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!privateFile(stat) || !sameInode(before, stat) || stat.size > limit)
      throw new Error('Invalid observation')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    const after = lstatSync(path)
    const final = fstatSync(fd)
    if (
      size > limit ||
      !privateFile(after) ||
      !privateFile(final) ||
      !sameInode(stat, after) ||
      after.size !== size ||
      final.size !== size ||
      stat.mtimeMs !== final.mtimeMs ||
      stat.ctimeMs !== final.ctimeMs
    )
      throw new Error('Invalid observation')
    return { stat: after, value: JSON.parse(buffer.subarray(0, size).toString('utf8')) }
  } finally {
    closeSync(fd)
  }
}

function validHandshake(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return item.kind === 'port-handshake' && item.version === 1 && Object.keys(item).length === 2
}

function observationEnvelope(
  value: unknown,
  now: number
): Pick<RemoteSessionObservation, 'status' | 'snapshot' | 'observedAt'> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid observation')
  const item = value as Record<string, unknown>
  if (
    Object.keys(item).sort().join(',') !== 'kind,observedAt,snapshot,status,version' ||
    item.kind !== 'port-session-snapshot' ||
    item.version !== 1 ||
    (item.status !== 'ready' && item.status !== 'unavailable') ||
    typeof item.observedAt !== 'number' ||
    !Number.isFinite(item.observedAt) ||
    item.observedAt < 0 ||
    !Number.isFinite(now) ||
    item.observedAt > now ||
    (item.status === 'ready' && item.snapshot === null)
  )
    throw new Error('Invalid observation')
  const snapshot =
    item.snapshot === null ? null : parseRemoteSnapshot(JSON.stringify(item.snapshot))
  return { status: item.status, snapshot, observedAt: item.observedAt }
}

function fileIdentity({ dev, ino, uid }: RemoteSessionFileIdentity): RemoteSessionFileIdentity {
  return { dev, ino, uid }
}

function observationSessionId(pin: Omit<RemoteSessionObservationPin, 'sessionId'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        pin.directory,
        ...[pin.root, pin.metadata, pin.control, pin.handshake].map(stat => [stat.dev, stat.ino]),
      ])
    )
    .digest('hex')
}

function exactData(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const own = Reflect.ownKeys(value)
  return (
    own.length === keys.length &&
    keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    })
  )
}

/** Reject malformed input before touching the filesystem; never adopt current files. */
export function restoreRemoteSessionObservation(value: unknown): RemoteSessionObservationHandle {
  try {
    if (
      !exactData(value, [
        'version',
        'directory',
        'sessionId',
        'root',
        'control',
        'metadata',
        'handshake',
        'destination',
        'connectionIdentity',
        'disconnected',
      ])
    )
      throw new Error()
    if (
      value.version !== 1 ||
      !validSessionDirectory(value.directory) ||
      typeof value.sessionId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sessionId) ||
      typeof value.disconnected !== 'boolean' ||
      typeof value.destination !== 'string' ||
      Buffer.byteLength(value.destination) > 8192 ||
      !classifySshInvocation([value.destination]) ||
      !exactData(value.connectionIdentity, ['hostname', 'port', 'user', 'contextHash']) ||
      !isSshConnectionIdentity(value.connectionIdentity)
    )
      throw new Error()
    for (const stat of [value.root, value.control, value.metadata, value.handshake]) {
      if (
        !exactData(stat, ['dev', 'ino', 'uid']) ||
        ![stat.dev, stat.ino, stat.uid].every(
          n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
        ) ||
        stat.uid !== process.getuid?.()
      )
        throw new Error()
    }
    const pin = value as unknown as RemoteSessionObservationPin
    if (observationSessionId(pin) !== pin.sessionId) throw new Error()
    return observationHandle(structuredClone(pin))
  } catch {
    throw new Error('Invalid remote session observation checkpoint')
  }
}

/** Pin once, without SSH or liveness probes. Only proven root/control loss is terminal. */
export function pinRemoteSessionObservation(
  directory: string
): RemoteSessionObservationHandle | null {
  try {
    const pinned = readSession(directory)
    if (!pinned.connectionIdentity) return null
    const identity = { ...pinned.connectionIdentity }
    const control = socket(directory, pinned.original)
    if (!control) return null
    const handshake = readObservationFile(`${directory}/handshake.json`, 8192)
    if (!validHandshake(handshake.value)) return null
    const data = {
      version: 1 as const,
      directory,
      root: fileIdentity(pinned.original),
      metadata: fileIdentity(pinned.metadata),
      control: fileIdentity(control),
      handshake: fileIdentity(handshake.stat),
      destination: pinned.destination,
      connectionIdentity: identity,
      disconnected: false,
    }
    const handle = restoreRemoteSessionObservation({
      ...data,
      sessionId: observationSessionId(data),
    })
    return observationHandle(handle.checkpoint(), true)
  } catch {
    return null
  }
}

function observationHandle(
  pin: RemoteSessionObservationPin,
  validateInitial = false
): RemoteSessionObservationHandle {
  const { directory, control } = pin
  const pinned = { original: pin.root, metadata: pin.metadata, destination: pin.destination }
  const handshake = { stat: pin.handshake }
  const identity = pin.connectionIdentity
  let disconnected = pin.disconnected
  const checkPresence = (): void => {
    for (const [path, original] of [
      [directory, pinned.original],
      [`${directory}/s`, control],
    ] as const) {
      try {
        if (!sameInode(lstatSync(path), original)) disconnected = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') disconnected = true
        throw error
      }
      if (disconnected) throw new Error('Session disconnected')
      // Check privacy before looking through the directory.
      if (path === directory) unchanged(directory, pinned.original)
    }
  }
  const validate = (): void => {
    checkPresence()
    const current = readSession(directory)
    const currentIdentity = current.connectionIdentity
    if (
      !sameInode(current.original, pinned.original) ||
      !sameInode(current.metadata, pinned.metadata) ||
      current.destination !== pinned.destination ||
      !currentIdentity ||
      currentIdentity.hostname !== identity.hostname ||
      currentIdentity.port !== identity.port ||
      currentIdentity.user !== identity.user ||
      currentIdentity.contextHash !== identity.contextHash ||
      !sameSocket(directory, pinned.original, control)
    )
      throw new Error('Invalid session observation')
    const currentHandshake = readObservationFile(`${directory}/handshake.json`, 8192)
    if (
      !sameInode(currentHandshake.stat, handshake.stat) ||
      !validHandshake(currentHandshake.value)
    )
      throw new Error('Invalid session handshake')
    checkPresence()
  }
  if (validateInitial) validate()
  return Object.freeze({
    sessionId: pin.sessionId,
    checkpoint(): RemoteSessionObservationPin {
      return structuredClone({ ...pin, disconnected })
    },
    read(now: number): RemoteSessionObservation {
      const captured = { destination: pinned.destination, connectionIdentity: { ...identity } }
      if (disconnected) return { ...captured, status: 'disconnected' }
      try {
        validate()
        const { value } = readObservationFile(`${directory}/snapshot.json`, 4 * 1024 * 1024 + 1024)
        const observation = observationEnvelope(value, now)
        validate()
        return { ...captured, ...observation }
      } catch {
        // A snapshot/metadata failure must not hide concurrent definitive control loss.
        try {
          checkPresence()
        } catch {
          /* Permission and I/O ambiguity remain unavailable. */
        }
        return { ...captured, status: disconnected ? 'disconnected' : 'unavailable' }
      }
    },
  })
}

function socket(directory: string, original: RemoteSessionFileIdentity): Stats | null {
  unchanged(directory, original)
  try {
    const stat = lstatSync(`${directory}/s`)
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('Invalid socket')
    return stat
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function companion(directory: string): string[] {
  return [
    '-F',
    '/dev/null',
    '-S',
    `${directory}/s`,
    '-o',
    'ControlMaster=no',
    '-o',
    'BatchMode=yes',
    '-o',
    'ProxyCommand=false',
    '-T',
    '-n',
  ]
}

/** The allocation is only a candidate: SSH must win the unavoidable bind race. */
function forwardPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(error => {
        if (error) reject(error)
        else if (!address || typeof address === 'string') reject(new Error('Invalid listener'))
        else resolve(address.port)
      })
    })
  })
}

/**
 * Legacy: unsafe for persistent route publication (the TCP port can be reused).
 * Private internal transport through the existing owned master, not public ingress.
 * Success proves only that SSH created a loopback listener, NOT backend readiness.
 */
export async function openRemoteForward(
  directory: string,
  target: { address: string; port: number }
): Promise<{ address: '127.0.0.1'; port: number; close(): Promise<void> } | null> {
  try {
    // Match snapshot restrictions before any filesystem, socket, or SSH I/O.
    const { address, port } = target
    if (typeof address !== 'string' || !isIPv4(address)) return null
    const [a, b] = address.split('.').map(Number)
    if (!(a === 127 || a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)))
      return null
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const original = session(directory)
    const pinned = socket(directory, original)
    if (!pinned) return null
    const valid = (): boolean => {
      try {
        return sameInode(session(directory), original) && sameSocket(directory, original, pinned)
      } catch {
        return false
      }
    }
    const command = async (operation: 'forward' | 'cancel', spec: string): Promise<boolean> => {
      if (!valid()) return false
      try {
        const output = await ssh(
          [
            ...companion(directory),
            '-o',
            'ExitOnForwardFailure=yes',
            '-O',
            operation,
            '-L',
            spec,
            'dummy',
          ],
          3000,
          8192
        )
        return valid() && output !== null
      } catch {
        return false
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!valid()) return null
      const localPort = await forwardPort()
      const spec = `127.0.0.1:${localPort}:${address}:${port}`
      if ((await command('forward', spec)) && valid()) {
        let closed = false
        return {
          address: '127.0.0.1',
          port: localPort,
          async close() {
            if (closed) return
            closed = true
            await command('cancel', spec)
          },
        }
      }
      // A timeout/late failure may still have installed a listener. Only the
      // original master can be asked to cancel it; never touch a replacement.
      await command('cancel', spec)
      if (!valid()) return null
    }
  } catch {
    /* Optional transport: allocation or ownership failure stays unavailable. */
  }
  return null
}

function privateStream(stat: Stats): boolean {
  return stat.isSocket() && stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o600
}

/** A pinned Unix listener owned by the existing master; never a TCP fallback. */
export async function openRemoteStream(
  directory: string,
  target: { address: string; port: number }
): Promise<{ path: string; connect(): Socket | null; close(): Promise<void> } | null> {
  try {
    const { address, port } = target
    if (typeof address !== 'string' || !isIPv4(address)) return null
    const [a, b] = address.split('.').map(Number)
    if (!(a === 127 || a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)))
      return null
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const original = session(directory)
    const control = socket(directory, original)
    if (!control) return null
    const path = `${directory}/f-${randomBytes(16).toString('hex')}`
    if (Buffer.byteLength(path) >= 100) return null
    // A collision is unavailable, not permission to unlink or reuse a pathname.
    try {
      lstatSync(path)
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
    }
    let pinned: Stats | undefined
    const valid = (): boolean => {
      try {
        if (!sameInode(session(directory), original) || !sameSocket(directory, original, control))
          return false
        if (!pinned) return true
        const current = lstatSync(path)
        return privateStream(current) && sameInode(current, pinned)
      } catch {
        return false
      }
    }
    const spec = `${path}:${address}:${port}`
    const command = async (operation: 'forward' | 'cancel'): Promise<boolean> => {
      if (!valid()) return false
      try {
        return (
          (await ssh(
            [
              ...companion(directory),
              '-o',
              'StreamLocalBindUnlink=no',
              '-o',
              'StreamLocalBindMask=0177',
              '-o',
              'ExitOnForwardFailure=yes',
              '-O',
              operation,
              '-L',
              spec,
              'dummy',
            ],
            3000,
            8192
          )) !== null
        )
      } catch {
        return false
      }
    }
    const remove = (): void => {
      if (!pinned) return
      try {
        unchanged(directory, original)
        const current = lstatSync(path)
        if (privateStream(current) && sameInode(current, pinned)) unlinkSync(path)
      } catch {
        /* Preserve unknown replacements and moved directories. */
      }
    }
    const forwarded = await command('forward')
    try {
      unchanged(directory, original)
      const current = lstatSync(path)
      if (privateStream(current)) pinned = current
    } catch {
      /* Failure may still have installed a listener; cancel only our master. */
    }
    if (!forwarded || !pinned || !valid()) {
      await command('cancel')
      remove()
      return null
    }
    let closed = false
    return {
      path,
      connect() {
        if (closed || !valid()) return null
        return createConnection({ path })
      },
      async close() {
        if (closed) return
        closed = true
        await command('cancel')
        remove()
      },
    }
  } catch {
    /* Optional capability; ownership and allocation failures stay unavailable. */
    return null
  }
}

export async function prepareRemoteSession(argv: string[]): Promise<string | null> {
  let directory: string | undefined
  try {
    const invocation = classifySshInvocation(argv)
    if (!invocation) return null
    const config = await ssh(['-G', ...argv], 3000, 65536)
    if (config === null || !isEligibleSshConfig(config)) return null
    const connectionIdentity = parseSshConnectionIdentity(config)
    if (!connectionIdentity) return null
    directory = mkdtempSync('/tmp/port-ssh-')
    const original = ownedDirectory(directory)
    publish(directory, original, 'metadata.json', {
      version: 2,
      destination: invocation.destination,
      connectionIdentity,
    })
    return directory
  } catch {
    // An incomplete prepare may leave only our exclusive temporary metadata file.
    if (directory) {
      try {
        const original = ownedDirectory(directory)
        removeKnownFiles(directory, original)
        rmdirSync(directory)
      } catch {
        /* Best effort; never broaden deletion. */
      }
    }
    return null
  }
}

export async function observeRemoteSession(
  directory: string,
  signal?: AbortSignal,
  onSnapshot?: () => Promise<void>
): Promise<void> {
  try {
    const original = session(directory)
    const deadline = Date.now() + 90_000
    let pinned: Stats | undefined
    while (!signal?.aborted && Date.now() < deadline) {
      const current = socket(directory, original)
      if (pinned && (!current || !sameInode(current, pinned))) return
      if (current) {
        pinned ??= current
        const ready = await ssh(
          [...companion(directory), '-O', 'check', 'dummy'],
          Math.max(1, Math.min(1000, deadline - Date.now())),
          8192
        )
        if (ready !== null) {
          if (!sameSocket(directory, original, pinned)) return
          const output = await ssh(
            [...companion(directory), 'dummy', 'port __remote-handshake'],
            5000,
            8192
          )
          if (output === null) return
          const value = JSON.parse(output)
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            value.kind !== 'port-handshake' ||
            value.version !== 1 ||
            Object.keys(value).length !== 2
          )
            return
          if (!sameSocket(directory, original, pinned)) return
          publish(directory, original, 'handshake.json', remoteHandshake())
          await observeSnapshots(directory, original, pinned, signal, onSnapshot)
          return
        }
      }
      await pause(Math.min(250, Math.max(0, deadline - Date.now())), signal)
    }
  } catch {
    /* Optional capability: malformed, missing or incompatible helpers stay silent. */
  }
}

function removeKnownFiles(directory: string, original: Stats): void {
  unchanged(directory, original)
  for (const name of readdirSync(directory)) {
    if (!/^f-[a-f0-9]{24,}$/.test(name)) continue
    unchanged(directory, original)
    try {
      if (privateStream(lstatSync(`${directory}/${name}`))) unlinkSync(`${directory}/${name}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const name of [
    'metadata.json',
    'metadata.json.tmp',
    'handshake.json',
    'handshake.json.tmp',
    'snapshot.json',
    'snapshot.json.tmp',
  ]) {
    unchanged(directory, original)
    try {
      if (privateFile(lstatSync(`${directory}/${name}`))) unlinkSync(`${directory}/${name}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export async function cleanupRemoteSession(directory: string): Promise<void> {
  try {
    const original = session(directory)
    const before = socket(directory, original)
    if (before) {
      const stopped = await ssh([...companion(directory), '-O', 'exit', 'dummy'], 1000, 8192)
      if (stopped === null) return // Retain the socket so a failed shutdown remains recoverable.
      const after = socket(directory, original)
      if (after && (after.dev !== before.dev || after.ino !== before.ino)) return
      if (after) unlinkSync(`${directory}/s`)
    }
    removeKnownFiles(directory, original)
    unchanged(directory, original)
    rmdirSync(directory)
  } catch {
    /* Refuse unowned or unexpected state; cleanup must never disrupt SSH. */
  }
}
