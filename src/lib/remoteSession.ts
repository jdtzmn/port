import { execFile } from 'node:child_process'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { createServer, isIPv4 } from 'node:net'
import { classifySshInvocation, isEligibleSshConfig } from './sshInvocation.ts'
import { parseRemoteSnapshot, type RemoteSnapshot } from './remoteSnapshot.ts'

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

function ownedDirectory(directory: string): Stats {
  if (!/^\/tmp\/port-ssh-[A-Za-z0-9]{6}$/.test(directory) || !process.getuid) {
    throw new Error('Invalid session path')
  }
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) {
    throw new Error('Invalid session directory')
  }
  return stat
}

function unchanged(directory: string, original: Stats): void {
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

function sameInode(a: Stats, b: Stats): boolean {
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

function sameSocket(directory: string, original: Stats, pinned: Stats): boolean {
  const current = socket(directory, original)
  return current !== null && sameInode(current, pinned)
}

async function observeSnapshots(
  directory: string,
  original: Stats,
  pinned: Stats,
  signal?: AbortSignal
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

function session(directory: string): Stats {
  const original = ownedDirectory(directory)
  const fd = openSync(
    `${directory}/metadata.json`,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    unchanged(directory, original)
    const stat = fstatSync(fd)
    if (!privateFile(stat) || stat.size > 8192) throw new Error('Invalid metadata')
    const value = JSON.parse(readFileSync(fd, 'utf8'))
    if (
      value?.version !== 1 ||
      typeof value.destination !== 'string' ||
      !classifySshInvocation([value.destination])
    )
      throw new Error('Invalid metadata')
  } finally {
    closeSync(fd)
  }
  return original
}

function socket(directory: string, original: Stats): Stats | null {
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

export async function prepareRemoteSession(argv: string[]): Promise<string | null> {
  let directory: string | undefined
  try {
    const invocation = classifySshInvocation(argv)
    if (!invocation) return null
    const config = await ssh(['-G', ...argv], 3000, 65536)
    if (config === null || !isEligibleSshConfig(config)) return null
    directory = mkdtempSync('/tmp/port-ssh-')
    const original = ownedDirectory(directory)
    publish(directory, original, 'metadata.json', {
      version: 1,
      destination: invocation.destination,
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

export async function observeRemoteSession(directory: string, signal?: AbortSignal): Promise<void> {
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
          await observeSnapshots(directory, original, pinned, signal)
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
