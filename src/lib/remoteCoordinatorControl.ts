import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { chmod, link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import { isAbsolute, join, normalize } from 'node:path'
import { withRemoteMutex } from './remoteMutex.ts'

const LIMIT = 8192
const DEADLINE = 2000
const HEX = /^[0-9a-f]{32}$(?![\s\S])/
const DIRECTORY = /^\/tmp\/port-ssh-[A-Za-z0-9]+$(?![\s\S])/
const unavailable = (): never => {
  throw new Error('Remote coordinator control unavailable')
}
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid
const owned = (s: Stats, mode: number) => s.uid === process.getuid?.() && (s.mode & 0o7777) === mode

export type RemoteCoordinatorRequest =
  | { version: 1; action: 'ping' }
  | { version: 1; action: 'register'; incarnation: string; directory: string }
  | { version: 1; action: 'wake' | 'shutdown'; incarnation: string }
export interface RemoteCoordinatorResponse {
  version: 1
  incarnation: string
  status: 'ok' | 'rejected' | 'error'
}
/**
 * Callbacks must be short, nonblocking and cancellation-cooperative. The signal is
 * aborted on disconnect, deadline or close. Queue long route work elsewhere;
 * a promise timeout cannot undo side effects or interrupt synchronous JavaScript.
 * Registration pin/cache validation belongs in register, not this transport.
 */
export interface RemoteCoordinatorHandlers {
  register(directory: string, signal: AbortSignal): void | Promise<void>
  wake(signal: AbortSignal): void | Promise<void>
  shutdown(signal: AbortSignal): void | Promise<void>
}
export interface RemoteCoordinatorControl {
  incarnation: string
  close(): Promise<void>
}
interface Descriptor {
  version: 1
  incarnation: string
  socket: string
  dev: number
  ino: number
}
interface Snapshot {
  descriptor: Descriptor
  file: Stats
  socket: Stats | null
}

async function rootInfo(root: string): Promise<Stats> {
  // Require a canonical absolute path. No symlinked ancestors, including /var on macOS.
  if (!isAbsolute(root) || normalize(root) !== root || (await realpath(root)) !== root)
    unavailable()
  const info = await lstat(root)
  if (!info.isDirectory() || !owned(info, 0o700)) unavailable()
  return info
}
async function checkRoot(root: string, expected: Stats) {
  if (!same(await rootInfo(root), expected)) unavailable()
}

async function snapshot(root: string, allowMissingSocket = false): Promise<Snapshot> {
  const path = join(root, 'endpoint.json')
  const before = await lstat(path)
  if (!before.isFile() || !owned(before, 0o600) || before.nlink !== 1 || before.size > LIMIT)
    unavailable()
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let descriptor: Descriptor
  try {
    const info = await file.stat()
    if (
      !same(info, before) ||
      !info.isFile() ||
      !owned(info, 0o600) ||
      info.nlink !== 1 ||
      info.size > LIMIT
    )
      unavailable()
    const buffer = Buffer.alloc(LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > LIMIT) unavailable()
    descriptor = JSON.parse(buffer.subarray(0, length).toString('utf8')) as Descriptor
    if (
      !descriptor ||
      Object.keys(descriptor).sort().join(',') !== 'dev,incarnation,ino,socket,version' ||
      descriptor.version !== 1 ||
      typeof descriptor.incarnation !== 'string' ||
      !HEX.test(descriptor.incarnation) ||
      descriptor.socket !== `c-${descriptor.incarnation}` ||
      !Number.isSafeInteger(descriptor.dev) ||
      descriptor.dev < 0 ||
      !Number.isSafeInteger(descriptor.ino) ||
      descriptor.ino <= 0
    )
      unavailable()
    const after = await file.stat()
    if (
      !same(after, before) ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.nlink !== 1
    )
      unavailable()
  } finally {
    await file.close()
  }
  if (!same(await lstat(path), before)) unavailable()
  const socketPath = join(root, descriptor.socket)
  if (Buffer.byteLength(socketPath) >= 100) unavailable()
  let socket: Stats | null = null
  try {
    socket = await lstat(socketPath)
  } catch (error) {
    if (!allowMissingSocket || code(error) !== 'ENOENT') throw error
  }
  if (
    socket &&
    (!socket.isSocket() ||
      !owned(socket, 0o600) ||
      socket.nlink !== 1 ||
      socket.dev !== descriptor.dev ||
      socket.ino !== descriptor.ino)
  )
    unavailable()
  return { descriptor, file: before, socket }
}

async function unchanged(root: string, expectedRoot: Stats, previous: Snapshot, missing = false) {
  await checkRoot(root, expectedRoot)
  const next = await snapshot(root, missing)
  if (
    !same(next.file, previous.file) ||
    next.file.mtimeMs !== previous.file.mtimeMs ||
    next.file.ctimeMs !== previous.file.ctimeMs ||
    JSON.stringify(next.descriptor) !== JSON.stringify(previous.descriptor) ||
    Boolean(next.socket) !== Boolean(previous.socket) ||
    (next.socket && previous.socket && !same(next.socket, previous.socket))
  )
    unavailable()
}

function probe(path: string): Promise<'live' | 'stale'> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Unavailable'))
    }, DEADLINE)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve('live')
    })
    socket.once('error', error => {
      clearTimeout(timer)
      socket.destroy()
      if (code(error) === 'ENOENT' || code(error) === 'ECONNREFUSED') resolve('stale')
      else reject(new Error('Unavailable'))
    })
  })
}

function parseRequest(bytes: Buffer): RemoteCoordinatorRequest | null {
  try {
    const text = bytes.toString('utf8')
    if (
      !bytes.equals(Buffer.from(text)) ||
      !text.endsWith('\n') ||
      text.indexOf('\n') !== text.length - 1
    )
      return null
    const value = JSON.parse(text) as RemoteCoordinatorRequest
    if (!value || value.version !== 1) return null
    const keys = Object.keys(value).sort().join(',')
    if (value.action === 'ping') return keys === 'action,version' ? value : null
    if (typeof value.incarnation !== 'string' || !HEX.test(value.incarnation)) return null
    if (value.action === 'register')
      return keys === 'action,directory,incarnation,version' &&
        typeof value.directory === 'string' &&
        DIRECTORY.test(value.directory)
        ? value
        : null
    if (value.action === 'wake' || value.action === 'shutdown')
      return keys === 'action,incarnation,version' ? value : null
    return null
  } catch {
    return null
  }
}

function serveClient(
  socket: Socket,
  incarnation: string,
  handlers: RemoteCoordinatorHandlers,
  clients: Set<Socket>
) {
  if (clients.size >= 128) {
    socket.destroy()
    return
  }
  clients.add(socket)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    socket.destroy()
  }, DEADLINE)
  let bytes = Buffer.alloc(0)
  let dispatched = false
  socket.once('end', () => {
    if (!dispatched) socket.destroy()
  })
  socket.on('error', () => {
    controller.abort()
    socket.destroy()
  })
  socket.once('close', () => {
    clearTimeout(timer)
    controller.abort()
    clients.delete(socket)
  })
  socket.on('data', chunk => {
    if (dispatched || socket.destroyed || bytes.length + chunk.length > LIMIT) {
      socket.destroy()
      return
    }
    bytes = Buffer.concat([bytes, chunk])
    // Reject trailing bytes already buffered with the first line. Later data
    // closes the connection but cannot roll back an accepted callback.
    const newline = bytes.indexOf(10)
    if (newline === -1) return
    if (newline !== bytes.length - 1) {
      socket.destroy()
      return
    }
    if (controller.signal.aborted) return
    const request = parseRequest(bytes)
    if (!request) {
      socket.destroy()
      return
    }
    dispatched = true
    bytes = Buffer.alloc(0)
    const respond = (status: RemoteCoordinatorResponse['status']) => {
      if (!socket.destroyed && !controller.signal.aborted)
        socket.end(JSON.stringify({ version: 1, incarnation, status }) + '\n')
    }
    if (request.action === 'ping') {
      respond('ok')
      return
    }
    if (request.incarnation !== incarnation) {
      respond('rejected')
      return
    }
    void (async () => {
      try {
        if (request.action === 'register')
          await handlers.register(request.directory, controller.signal)
        else await handlers[request.action](controller.signal)
        respond('ok')
      } catch {
        respond('error')
      }
    })()
  })
}

/** Owns only this incarnation. Unsafe/ambiguous state throws a sanitized error. */
export async function startRemoteCoordinatorControl(
  root: string,
  handlers: RemoteCoordinatorHandlers
): Promise<RemoteCoordinatorControl | null> {
  try {
    try {
      await mkdir(root, { mode: 0o700 })
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
    }
    const initialRoot = await rootInfo(root)
    if (Buffer.byteLength(join(root, `c-${'0'.repeat(32)}`)) >= 100) unavailable()
    // The mutex database is permanent, including across close and stale takeover.
    return await withRemoteMutex(
      join(root, 'control.sqlite'),
      async () => {
        await checkRoot(root, initialRoot)
        let existing: Snapshot | null = null
        // Only absence of the descriptor itself permits fresh creation.
        let present = true
        try {
          await lstat(join(root, 'endpoint.json'))
        } catch (error) {
          if (code(error) !== 'ENOENT') throw error
          present = false
        }
        if (present) existing = await snapshot(root, true)
        if (existing) {
          const state = await probe(join(root, existing.descriptor.socket))
          await unchanged(root, initialRoot, existing, true)
          if (state === 'live') return null // Transport liveness suffices, regardless of protocol.
          await unlink(join(root, 'endpoint.json'))
          if (existing.socket) await unlink(join(root, existing.descriptor.socket))
        }
        const incarnation = randomBytes(16).toString('hex')
        const socketPath = join(root, `c-${incarnation}`)
        const prepared = join(root, `d-${incarnation}`)
        const bindPath = join(root, `b-${incarnation}`)
        const clients = new Set<Socket>()
        const server = createServer({ allowHalfOpen: true }, socket =>
          serveClient(socket, incarnation, handlers, clients)
        )
        let published: Snapshot | null = null
        let socketPin: Stats | null = null
        let preparedPin: Stats | null = null
        let closing: Promise<void> | undefined
        const close = (): Promise<void> =>
          (closing ??= (async () => {
            for (const client of clients) client.destroy()
            // libuv unlinks its original bind name unconditionally. Publish via
            // a separate link so close can never unlink a replaced public socket.
            // The unadvertised b-* bind name is never reused by this protocol.
            await new Promise<void>(resolve => server.close(() => resolve()))
            try {
              await checkRoot(root, initialRoot)
              if (published) {
                const current = await snapshot(root, true)
                if (
                  same(current.file, published.file) &&
                  current.descriptor.incarnation === incarnation
                )
                  await unlink(join(root, 'endpoint.json'))
              }
            } catch {
              /* Replaced or unsafe endpoint belongs to somebody else. */
            }
            try {
              await checkRoot(root, initialRoot)
              if (socketPin && same(await lstat(socketPath), socketPin)) await unlink(socketPath)
            } catch {
              /* Missing or replaced socket. */
            }
          })())
        try {
          // Never bind over an existing name (even an astronomically unlikely collision).
          try {
            await lstat(socketPath)
            unavailable()
          } catch (error) {
            if (code(error) !== 'ENOENT') throw error
          }
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(bindPath, () => {
              server.removeListener('error', reject)
              resolve()
            })
          })
          server.on('error', () => {
            void close()
          })
          await chmod(bindPath, 0o600)
          await link(bindPath, socketPath)
          await unlink(bindPath)
          socketPin = await lstat(socketPath)
          const descriptor: Descriptor = {
            version: 1,
            incarnation,
            socket: `c-${incarnation}`,
            dev: socketPin.dev,
            ino: socketPin.ino,
          }
          const file = await open(
            prepared,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600
          )
          try {
            preparedPin = await file.stat()
            await file.writeFile(JSON.stringify(descriptor) + '\n')
            await file.sync()
          } finally {
            await file.close()
          }
          await checkRoot(root, initialRoot)
          // link is atomic AND exclusive. Readers fail closed during the brief nlink=2 window.
          await link(prepared, join(root, 'endpoint.json'))
          await unlink(prepared)
          published = await snapshot(root)
          return { incarnation, close }
        } catch (error) {
          await close()
          throw error
        } finally {
          try {
            await checkRoot(root, initialRoot)
            if (preparedPin && same(await lstat(prepared), preparedPin)) await unlink(prepared)
          } catch {
            /* Best effort. */
          }
        }
      },
      { timeoutMs: DEADLINE }
    )
  } catch {
    return unavailable()
  }
}

function exchange(path: string, bytes: Buffer, signal: AbortSignal): Promise<Buffer | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise(resolve => {
    const socket = createConnection(path)
    let result = Buffer.alloc(0)
    let done = false
    const finish = (value: Buffer | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      socket.destroy()
      resolve(value)
    }
    const abort = () => finish(null)
    const timer = setTimeout(abort, DEADLINE)
    signal.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => {
      if (!signal.aborted) socket.write(bytes)
    })
    socket.on('data', chunk => {
      if (result.length + chunk.length > LIMIT) {
        finish(null)
        return
      }
      result = Buffer.concat([result, chunk])
    })
    socket.once('end', () => finish(result))
    socket.once('error', () => finish(null))
    socket.once('close', () => finish(null))
  })
}

/** One NDJSON request; no retries, TCP fallback, or untrusted socket paths. */
async function performRequest(
  root: string,
  request: RemoteCoordinatorRequest,
  signal: AbortSignal
): Promise<RemoteCoordinatorResponse | null> {
  try {
    const bytes = Buffer.from(JSON.stringify(request) + '\n')
    if (bytes.length > LIMIT || !parseRequest(bytes)) return null
    const initialRoot = await rootInfo(root)
    const before = await snapshot(root)
    await unchanged(root, initialRoot, before)
    const response = await exchange(join(root, before.descriptor.socket), bytes, signal)
    if (!response) return null
    await unchanged(root, initialRoot, before)
    const text = response.toString('utf8')
    if (
      !response.equals(Buffer.from(text)) ||
      !text.endsWith('\n') ||
      text.indexOf('\n') !== text.length - 1
    )
      return null
    const value = JSON.parse(text) as RemoteCoordinatorResponse
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'incarnation,status,version' ||
      value.version !== 1 ||
      value.incarnation !== before.descriptor.incarnation ||
      !['ok', 'rejected', 'error'].includes(value.status)
    )
      return null
    return value
  } catch {
    return null
  }
}

/** Bounds the whole client operation, including filesystem validation, to 2s. */
export async function requestRemoteCoordinator(
  root: string,
  request: RemoteCoordinatorRequest
): Promise<RemoteCoordinatorResponse | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, DEADLINE)
  })
  try {
    return await Promise.race([performRequest(root, request, controller.signal), deadline])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
