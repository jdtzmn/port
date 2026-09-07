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
import { classifySshInvocation, isEligibleSshConfig } from './sshInvocation.ts'

export interface RemoteHandshake {
  kind: 'port-handshake'
  version: 1
}

export function remoteHandshake(): RemoteHandshake {
  return { kind: 'port-handshake', version: 1 }
}

function ssh(args: string[], timeout: number, maxBuffer: number): Promise<string | null> {
  return new Promise(resolve => {
    execFile('ssh', args, { timeout, maxBuffer, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
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

export async function observeRemoteSession(directory: string): Promise<void> {
  try {
    const original = session(directory)
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (socket(directory, original)) {
        const ready = await ssh(
          [...companion(directory), '-O', 'check', 'dummy'],
          Math.max(1, Math.min(1000, deadline - Date.now())),
          8192
        )
        if (ready !== null) {
          if (!socket(directory, original)) return
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
          publish(directory, original, 'handshake.json', remoteHandshake())
          return
        }
      }
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now())))
      )
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
