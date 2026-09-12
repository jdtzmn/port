import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  requestRemoteCoordinator,
  startRemoteCoordinatorControl,
  type RemoteCoordinatorControl,
  type RemoteCoordinatorRequest,
} from './control.ts'

let root: string
let handles: RemoteCoordinatorControl[]
let servers: Server[]
let sockets: Socket[]
const handlers = () => ({ register: vi.fn(), wake: vi.fn(), shutdown: vi.fn() })
const ping = { version: 1, action: 'ping' } as const
async function start(callbacks = handlers()) {
  const handle = await startRemoteCoordinatorControl(root, callbacks)
  expect(handle).not.toBeNull()
  handles.push(handle!)
  return handle!
}
async function descriptor() {
  return JSON.parse(await readFile(join(root, 'endpoint.json'), 'utf8'))
}
async function raw(text: string, end = false) {
  const desc = await descriptor()
  return new Promise<string>(resolve => {
    const socket = createConnection(join(root, desc.socket))
    sockets.push(socket)
    let result = ''
    socket.once('connect', () => {
      if (end) socket.end(text)
      else socket.write(text)
    })
    socket.on('data', chunk => {
      result += chunk.toString()
    })
    socket.on('error', () => {})
    socket.once('close', () => resolve(result))
  })
}
async function foreign(reply?: string) {
  const incarnation = 'a'.repeat(32)
  const path = join(root, `c-${incarnation}`)
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.push(socket)
    socket.on('error', () => {})
    // A transport-only probe sends no data; do not retain its half-open socket.
    socket.once('end', () => socket.end())
    socket.resume()
    socket.once('data', () => {
      if (reply !== undefined) socket.end(reply)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(path, resolve))
  await chmod(path, 0o600)
  const pin = await lstat(path)
  await writeFile(
    join(root, 'endpoint.json'),
    JSON.stringify({
      version: 1,
      incarnation,
      socket: `c-${incarnation}`,
      dev: pin.dev,
      ino: pin.ino,
    }),
    { mode: 0o600 }
  )
  return server
}

// Kept standalone: its transpiled function body is executed by Bun, not Vitest.
async function bunSmoke(
  start: typeof startRemoteCoordinatorControl,
  request: typeof requestRemoteCoordinator,
  directory: string
) {
  let owner: RemoteCoordinatorControl | null = null
  let registrations = 0
  let validDirectory = false
  let passed = false
  try {
    owner = await start(directory, {
      register(value) {
        registrations++
        validDirectory = value === '/tmp/port-ssh-Smoke1'
      },
      wake() {},
      shutdown() {},
    })
    if (!owner) throw new Error('smoke')
    const pingResult = await request(directory, { version: 1, action: 'ping' })
    const registerResult = await request(directory, {
      version: 1,
      action: 'register',
      incarnation: owner.incarnation,
      directory: '/tmp/port-ssh-Smoke1',
    })
    passed =
      pingResult?.status === 'ok' &&
      pingResult.incarnation === owner.incarnation &&
      registerResult?.status === 'ok' &&
      registerResult.incarnation === owner.incarnation &&
      registrations === 1 &&
      validDirectory
  } catch {
    passed = false
  } finally {
    try {
      await owner?.close()
    } catch {
      passed = false
    }
  }
  process.stdout.write(passed ? 'bun-smoke-ok\n' : 'bun-smoke-failed\n')
  process.exitCode = passed ? 0 : 1
}

beforeEach(async () => {
  root = await realpath(await mkdtemp('/tmp/rcc-'))
  await chmod(root, 0o700)
  handles = []
  servers = []
  sockets = []
})
afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(handles.map(handle => handle.close()))
  await Promise.all(
    servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))
  )
  await rm(root, { recursive: true, force: true })
})

describe('private coordinator control', () => {
  it('runs real ping/register RPC in Bun with fixed smoke output', async () => {
    const moduleUrl = new URL('./control.ts', import.meta.url).href
    const script = [
      `import { startRemoteCoordinatorControl as start, requestRemoteCoordinator as request } from ${JSON.stringify(moduleUrl)};`,
      `const run = ${bunSmoke.toString()};`,
      `await run(start, request, ${JSON.stringify(join(root, 'bun'))});`,
    ].join('\n')
    // execFile bounds runtime/output; afterEach removes only our mkdtemp root,
    // including any socket/descriptor left behind if the child times out.
    let stdout = ''
    let stderr = ''
    let succeeded = false
    try {
      const result = await promisify(execFile)('bun', ['--eval', script], {
        timeout: 8000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024,
        encoding: 'utf8',
      })
      stdout = result.stdout
      stderr = result.stderr
      succeeded = true
    } catch {
      /* Do not print script, environment, or raw child errors. */
    }
    expect(succeeded, 'Bun smoke child must finish successfully').toBe(true)
    expect(stdout === 'bun-smoke-ok\n', 'Bun smoke must report the fixed success marker').toBe(true)
    expect(stderr.length, 'Bun smoke must not emit diagnostics').toBe(0)
  }, 10000)

  it('keeps the mutex inode through live probes, close and subsequent startup', async () => {
    const handle = await start()
    const database = join(root, 'control.sqlite')
    const pin = await lstat(database)
    expect(pin.isFile()).toBe(true)
    expect(pin.mode & 0o7777).toBe(0o600)
    expect(await startRemoteCoordinatorControl(root, handlers())).toBeNull()
    expect((await lstat(database)).ino).toBe(pin.ino)
    await handle.close()
    expect((await lstat(database)).ino).toBe(pin.ino)
    await start()
    const current = await lstat(database)
    expect(current.ino).toBe(pin.ino)
    expect(current.dev).toBe(pin.dev)
    expect(current.nlink).toBe(1)
  })

  it.each(['symlink', 'hardlink', 'corrupt', 'writable'])(
    'sanitizes unsafe %s mutex database failures',
    async kind => {
      const database = join(root, 'control.sqlite')
      const target = join(root, 'sentinel')
      await writeFile(target, 'private sentinel', { mode: 0o600 })
      if (kind === 'symlink') await symlink(target, database)
      if (kind === 'hardlink') await link(target, database)
      if (kind === 'corrupt') await writeFile(database, 'not SQLite', { mode: 0o600 })
      if (kind === 'writable') {
        await writeFile(database, '')
        await chmod(database, 0o666)
      }
      await expect(startRemoteCoordinatorControl(root, handlers())).rejects.toThrow(
        'Remote coordinator control unavailable'
      )
      expect(await readFile(target, 'utf8')).toBe('private sentinel')
    }
  )

  it('serializes concurrent startup, serves real RPC and checks incarnations', async () => {
    const callbacks = handlers()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => startRemoteCoordinatorControl(root, callbacks))
    )
    handles.push(...results.filter((value): value is RemoteCoordinatorControl => value !== null))
    expect(handles).toHaveLength(1)
    const incarnation = handles[0]!.incarnation
    expect(await requestRemoteCoordinator(root, ping)).toEqual({
      version: 1,
      incarnation,
      status: 'ok',
    })
    for (const action of ['wake', 'shutdown'] as const) {
      expect(
        (await requestRemoteCoordinator(root, { version: 1, incarnation, action }))?.status
      ).toBe('ok')
      expect(callbacks[action]).toHaveBeenCalledTimes(1)
    }
    expect(
      (
        await requestRemoteCoordinator(root, {
          version: 1,
          incarnation,
          action: 'register',
          directory: '/tmp/port-ssh-Ab12',
        })
      )?.status
    ).toBe('ok')
    expect(callbacks.register).toHaveBeenCalledWith('/tmp/port-ssh-Ab12', expect.any(AbortSignal))
    expect(
      (
        await requestRemoteCoordinator(root, {
          version: 1,
          incarnation: '0'.repeat(32),
          action: 'wake',
        })
      )?.status
    ).toBe('rejected')
    expect(callbacks.wake).toHaveBeenCalledTimes(1)
    const desc = await descriptor()
    expect((await lstat(join(root, desc.socket))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(root, 'endpoint.json'))).nlink).toBe(1)
  })

  it('rejects malformed, oversized, multiple and incomplete frames without callbacks', async () => {
    const callbacks = handlers()
    const { incarnation } = await start(callbacks)
    const valid = JSON.stringify({ version: 1, incarnation, action: 'wake' }) + '\n'
    const frames = [
      valid + valid,
      valid + ' ',
      valid.trimEnd(),
      '{\n',
      'x'.repeat(8193),
      JSON.stringify({ version: 2, incarnation, action: 'wake' }) + '\n',
      JSON.stringify({ version: 1, incarnation, action: 'exec' }) + '\n',
    ]
    for (const directory of [
      '/tmp/port-ssh-a/../b',
      '/tmp/port-ssh-a/',
      '/tmp/port-ssh-a-b',
      '/tmp/port-ssh-',
      '/private/tmp/port-ssh-a',
      '/tmp/port-ssh-a\n',
    ]) {
      frames.push(JSON.stringify({ version: 1, incarnation, action: 'register', directory }) + '\n')
    }
    for (const frame of frames)
      expect(await raw(frame, !frame.includes('\n') && frame.length < 8192)).toBe('')
    expect(callbacks.wake).not.toHaveBeenCalled()
    expect(callbacks.register).not.toHaveBeenCalled()
    const desc = await descriptor()
    const socket = createConnection(join(root, desc.socket))
    sockets.push(socket)
    await new Promise<void>(resolve => socket.once('connect', resolve))
    socket.destroy() // No complete request.
    await new Promise(resolve => setImmediate(resolve))
    expect(callbacks.wake).not.toHaveBeenCalled()
  })

  it('accepts a split line without EOF and never dispatches a later split frame', async () => {
    const callbacks = handlers()
    // Keep the first action pending, allowing a deterministic second frame.
    callbacks.wake.mockImplementation(() => new Promise(() => {}))
    const { incarnation } = await start(callbacks)
    const desc = await descriptor()
    const socket = createConnection(join(root, desc.socket))
    sockets.push(socket)
    socket.on('error', () => {})
    await new Promise<void>(resolve => socket.once('connect', resolve))
    const line = JSON.stringify({ version: 1, incarnation, action: 'wake' }) + '\n'
    socket.write(line.slice(0, -1))
    await new Promise(resolve => setImmediate(resolve))
    expect(callbacks.wake).not.toHaveBeenCalled()
    socket.write('\n')
    await vi.waitFor(() => expect(callbacks.wake).toHaveBeenCalledTimes(1))
    const closed = new Promise(resolve => socket.once('close', resolve))
    socket.write(line.slice(0, 5))
    socket.write(line.slice(5))
    await closed
    expect(callbacks.wake).toHaveBeenCalledTimes(1)
  })

  it('responds to a split ping line before the client half-closes', async () => {
    const { incarnation } = await start()
    const desc = await descriptor()
    const socket = createConnection(join(root, desc.socket))
    sockets.push(socket)
    socket.on('error', () => {})
    let response = ''
    socket.on('data', chunk => {
      response += chunk.toString()
    })
    const closed = new Promise(resolve => socket.once('close', resolve))
    await new Promise<void>(resolve => socket.once('connect', resolve))
    socket.write('{"version":1,')
    await new Promise(resolve => setImmediate(resolve))
    expect(response).toBe('')
    socket.write('"action":"ping"}\n')
    await closed
    expect(JSON.parse(response)).toEqual({ version: 1, incarnation, status: 'ok' })
  })

  it('times out idle clients', async () => {
    await start()
    const began = Date.now()
    expect(await raw('')).toBe('')
    expect(Date.now() - began).toBeLessThan(2800)
  })

  it.each(['mode', 'symlink', 'oversize', 'hardlink', 'corrupt', 'socket-pin'])(
    'fails closed for %s descriptor state',
    async kind => {
      await start()
      const path = join(root, 'endpoint.json')
      if (kind === 'mode') await chmod(path, 0o644)
      if (kind === 'oversize') await writeFile(path, 'x'.repeat(8193))
      if (kind === 'corrupt') await writeFile(path, '{}')
      if (kind === 'hardlink') await link(path, join(root, 'alias'))
      if (kind === 'symlink') {
        await rename(path, join(root, 'original'))
        await symlink('original', path)
      }
      if (kind === 'socket-pin') {
        const desc = await descriptor()
        desc.ino++
        await writeFile(path, JSON.stringify(desc))
      }
      expect(await requestRemoteCoordinator(root, ping)).toBeNull()
      await expect(startRemoteCoordinatorControl(root, handlers())).rejects.toThrow(
        'Remote coordinator control unavailable'
      )
      expect(await lstat(path)).toBeDefined()
    }
  )

  it('refuses unsafe roots and creates an absent private root', async () => {
    await chmod(root, 0o755)
    await expect(startRemoteCoordinatorControl(root, handlers())).rejects.toThrow('unavailable')
    await chmod(root, 0o700)
    const alias = join(root, 'alias')
    await symlink(root, alias)
    await expect(startRemoteCoordinatorControl(alias, handlers())).rejects.toThrow('unavailable')
    await unlink(alias)
    await rm(root, { recursive: true })
    await start()
    expect((await lstat(root)).mode & 0o777).toBe(0o700)
  })

  it('takes over a stale owned descriptor only after definitive missing socket', async () => {
    const server = await foreign()
    const old = await descriptor()
    expect(await startRemoteCoordinatorControl(root, handlers())).toBeNull()
    const pin = await lstat(join(root, 'control.sqlite'))
    await new Promise<void>(resolve => server.close(() => resolve()))
    const handle = await start()
    expect((await lstat(join(root, 'control.sqlite'))).ino).toBe(pin.ino)
    expect(handle.incarnation).not.toBe(old.incarnation)
    expect((await requestRemoteCoordinator(root, ping))?.incarnation).toBe(handle.incarnation)
  })

  it('does not replace a live incompatible server', async () => {
    await foreign('not our protocol\n')
    const pin = await lstat(join(root, 'endpoint.json'))
    expect(await startRemoteCoordinatorControl(root, handlers())).toBeNull()
    expect(await requestRemoteCoordinator(root, ping)).toBeNull()
    expect((await lstat(join(root, 'endpoint.json'))).ino).toBe(pin.ino)
  })

  it('preserves a replaced endpoint on idempotent close', async () => {
    const handle = await start()
    await rename(join(root, 'endpoint.json'), join(root, 'old'))
    await foreign('bad\n')
    const replacement = await descriptor()
    await Promise.all([handle.close(), handle.close()])
    expect(await descriptor()).toEqual(replacement)
    expect(await startRemoteCoordinatorControl(root, handlers())).toBeNull()
  })

  it('sanitizes callback failures and cancels pending callbacks on close', async () => {
    const callbacks = handlers()
    callbacks.wake.mockImplementation(() => {
      throw new Error('secret exception')
    })
    const handle = await start(callbacks)
    expect(
      await requestRemoteCoordinator(root, {
        version: 1,
        action: 'wake',
        incarnation: handle.incarnation,
      })
    ).toEqual({ version: 1, incarnation: handle.incarnation, status: 'error' })
    let signal: AbortSignal | undefined
    let entered!: () => void
    const entry = new Promise<void>(resolve => {
      entered = resolve
    })
    callbacks.register.mockImplementation((_directory: string, value: AbortSignal) => {
      signal = value
      entered()
      return new Promise(() => {})
    })
    const pending = requestRemoteCoordinator(root, {
      version: 1,
      incarnation: handle.incarnation,
      action: 'register',
      directory: '/tmp/port-ssh-A',
    })
    await entry
    await handle.close()
    expect(await pending).toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(await requestRemoteCoordinator(root, ping)).toBeNull()
  })

  it('bounds incompatible silent responses and rejects bad outgoing requests', async () => {
    await foreign()
    const began = Date.now()
    expect(await requestRemoteCoordinator(root, ping)).toBeNull()
    expect(Date.now() - began).toBeLessThan(2800)
    expect(
      await requestRemoteCoordinator(root, {
        version: 99,
        action: 'ping',
      } as unknown as RemoteCoordinatorRequest)
    ).toBeNull()
  })

  it('takes over an owned refused socket without reusing its name', async () => {
    const server = await foreign()
    const old = await descriptor()
    const incarnation = 'b'.repeat(32)
    await rename(join(root, old.socket), join(root, `c-${incarnation}`))
    await writeFile(
      join(root, 'endpoint.json'),
      JSON.stringify({ ...old, incarnation, socket: `c-${incarnation}` })
    )
    await new Promise<void>(resolve => server.close(() => resolve()))
    const handle = await start()
    expect(handle.incarnation).not.toBe(incarnation)
    await expect(lstat(join(root, `c-${incarnation}`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a replacement at the old public socket name', async () => {
    const handle = await start()
    const old = await descriptor()
    const path = join(root, old.socket)
    await unlink(path)
    await writeFile(path, 'replacement', { mode: 0o600 })
    expect(await requestRemoteCoordinator(root, ping)).toBeNull()
    await handle.close()
    expect(await readFile(path, 'utf8')).toBe('replacement')
  })

  it('bounds accepted clients to 128 and closes them on owner close', async () => {
    const handle = await start()
    const desc = await descriptor()
    const clients: Socket[] = []
    for (let i = 0; i < 128; i++) {
      const socket = createConnection(join(root, desc.socket))
      sockets.push(socket)
      clients.push(socket)
      socket.on('error', () => {})
      await new Promise<void>(resolve => socket.once('connect', resolve))
    }
    expect(await requestRemoteCoordinator(root, ping)).toBeNull()
    const closed = clients.map(socket => new Promise(resolve => socket.once('close', resolve)))
    await handle.close()
    await Promise.all(closed)
  })

  it('aborts callbacks at their deadline', async () => {
    const callbacks = handlers()
    let signal: AbortSignal | undefined
    callbacks.wake.mockImplementation((value: AbortSignal) => {
      signal = value
      return new Promise(() => {})
    })
    const handle = await start(callbacks)
    expect(
      await requestRemoteCoordinator(root, {
        version: 1,
        action: 'wake',
        incarnation: handle.incarnation,
      })
    ).toBeNull()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  })
})
