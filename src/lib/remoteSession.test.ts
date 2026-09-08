import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import * as fs from 'node:fs'
import { execFile } from 'node:child_process'
import {
  cleanupRemoteSession,
  observeRemoteSession,
  openRemoteForward,
  prepareRemoteSession,
  remoteHandshake,
  readRemoteSessionIdentity,
} from './remoteSession.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
}))
const execute = vi.mocked(execFile)
const safeConfig =
  'hostname example.com\nport 22\nuser Alice\ncontrolmaster false\ncontrolpersist no\nsessiontype default\nstdinnull no\nforkafterauthentication no\nrequesttty auto\n'
const directories: string[] = []
const servers: Server[] = []

function respond(output: string, error: Error | null = null): void {
  execute.mockImplementationOnce(((
    _file: unknown,
    _args: unknown,
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    callback(error, output, '')
  }) as typeof execFile)
}

async function prepare(): Promise<string> {
  respond(safeConfig)
  const directory = await prepareRemoteSession(['-i', '/private/key name', 'user@alias'])
  expect(directory).not.toBeNull()
  directories.push(directory!)
  execute.mockClear()
  return directory!
}

async function withSocket(): Promise<string> {
  const directory = await prepare()
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(`${directory}/s`, resolve)
  })
  return directory
}

beforeEach(() => {
  execute.mockReset()
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const server of servers.splice(0))
    await new Promise<void>(resolve => server.close(() => resolve()))
  // Test-owned fixtures only; production cleanup deliberately never uses rm recursive.
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('private remote forwards', () => {
  test.each([
    '127.0.0.1',
    '127.255.0.2',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.2',
  ])('creates only loopback transport to %s and cancels the exact spec once', async address => {
    const directory = await withSocket()
    respond('')
    const forward = await openRemoteForward(directory, { address, port: 5432 })
    expect(forward).not.toBeNull()
    expect(forward!.address).toBe('127.0.0.1')
    expect(forward!.port).toBeGreaterThan(0)
    expect(forward!.port).toBeLessThanOrEqual(65535)
    const spec = `127.0.0.1:${forward!.port}:${address}:5432`
    const args = [
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
      '-o',
      'ExitOnForwardFailure=yes',
      '-O',
      'forward',
      '-L',
      spec,
      'dummy',
    ]
    expect(execute.mock.calls[0]!.slice(0, 3)).toEqual([
      'ssh',
      args,
      { timeout: 3000, maxBuffer: 8192, encoding: 'utf8' },
    ])
    respond('')
    await Promise.all([forward!.close(), forward!.close()])
    await forward!.close()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]![1]).toEqual(
      args.map(value => (value === 'forward' ? 'cancel' : value))
    )
  })

  test.each([
    'localhost',
    '8.8.8.8',
    '0.0.0.0',
    '169.254.1.2',
    '100.64.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '::1',
    '127.1',
    '127.00.0.1',
    '127.0.0.1:80',
    '127.0.0.1\n',
    '-L',
    '',
  ])('rejects malformed/public target %j before exec', async address => {
    expect(await openRemoteForward('/invalid', { address, port: 80 })).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  test.each([0, -1, 65536, 1.5, NaN, Infinity, '80'])(
    'rejects invalid port %j before exec',
    async port => {
      expect(
        await openRemoteForward('/invalid', { address: '127.0.0.1', port: port as number })
      ).toBeNull()
      expect(execute).not.toHaveBeenCalled()
    }
  )

  test('bounds failed creation to three attempts and cleans up each exact spec', async () => {
    const directory = await withSocket()
    for (let i = 0; i < 3; i++) {
      respond('', new Error('bind failed or timed out'))
      respond('')
    }
    expect(await openRemoteForward(directory, { address: '10.0.0.1', port: 80 })).toBeNull()
    expect(execute).toHaveBeenCalledTimes(6)
    for (let i = 0; i < 6; i += 2) {
      const forward = execute.mock.calls[i]![1] as string[]
      expect(execute.mock.calls[i + 1]![1]).toEqual(
        forward.map(value => (value === 'forward' ? 'cancel' : value))
      )
    }
  })

  test('retries a failed candidate and treats close failure as terminal', async () => {
    const directory = await withSocket()
    respond('', new Error('bind race'))
    respond('')
    respond('')
    const forward = await openRemoteForward(directory, { address: '10.0.0.1', port: 80 })
    expect(forward).not.toBeNull()
    respond('', new Error('timeout'))
    await forward!.close()
    await forward!.close()
    expect(execute).toHaveBeenCalledTimes(4)
  })

  test.each(['removed', 'socket', 'symlink', 'directory'])(
    'refuses %s ownership loss during creation and close',
    async replacement => {
      const directory = await withSocket()
      const replace = (): void => {
        if (replacement === 'directory') {
          const moved = `${directory}-moved`
          renameSync(directory, moved)
          directories.push(moved)
          mkdirSync(directory, { mode: 0o700 })
          writeFileSync(
            `${directory}/metadata.json`,
            JSON.stringify({ version: 1, destination: 'host' }),
            { mode: 0o600 }
          )
        } else {
          renameSync(`${directory}/s`, `${directory}/original-s`)
          if (replacement === 'socket') writeFileSync(`${directory}/s`, '')
          if (replacement === 'symlink') symlinkSync(`${directory}/original-s`, `${directory}/s`)
        }
      }
      respond('')
      const forward = await openRemoteForward(directory, { address: '127.0.0.1', port: 80 })
      expect(forward).not.toBeNull()
      replace()
      await forward!.close()
      await forward!.close()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(await openRemoteForward(directory, { address: '127.0.0.1', port: 80 })).toBeNull()
      expect(execute).toHaveBeenCalledTimes(1)
    }
  )

  test('never publishes or cancels a replaced real mux socket after late success', async () => {
    const directory = await withSocket()
    const replacement = createServer()
    servers.push(replacement)
    await new Promise<void>(resolve => replacement.listen(`${directory}/replacement`, resolve))
    execute.mockImplementationOnce(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      renameSync(`${directory}/s`, `${directory}/original-s`)
      renameSync(`${directory}/replacement`, `${directory}/s`)
      callback(null, '')
    }) as typeof execFile)
    expect(await openRemoteForward(directory, { address: '127.0.0.1', port: 80 })).toBeNull()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(lstatSync(`${directory}/s`).isSocket()).toBe(true)
  })
})

describe('session addressing metadata', () => {
  test('refuses metadata replaced during a bounded read', async () => {
    const directory = await prepare()
    const path = `${directory}/metadata.json`
    const contents = readFileSync(path, 'utf8')
    const originalRead = fs.readSync
    vi.spyOn(fs, 'readSync').mockImplementationOnce(((...args: Parameters<typeof fs.readSync>) => {
      renameSync(path, `${directory}/old`)
      writeFileSync(path, contents, { mode: 0o600 })
      return originalRead(...args)
    }) as typeof fs.readSync)
    expect(readRemoteSessionIdentity(directory)).toBeNull()
  })
  test('alternate aliases agree and proxy secrets never reach metadata', async () => {
    const first = await prepare()
    respond(safeConfig)
    const second = (await prepareRemoteSession(['alternate']))!
    directories.push(second)
    expect(readRemoteSessionIdentity(first)?.connectionIdentity).toEqual(
      readRemoteSessionIdentity(second)?.connectionIdentity
    )
    respond(safeConfig + 'proxycommand proxy --password=hidden-secret\n')
    const proxied = (await prepareRemoteSession(['alternate']))!
    directories.push(proxied)
    expect(readRemoteSessionIdentity(proxied)?.connectionIdentity).not.toEqual(
      readRemoteSessionIdentity(first)?.connectionIdentity
    )
    expect(readFileSync(`${proxied}/metadata.json`, 'utf8')).not.toContain('hidden-secret')
  })

  test('legacy metadata has no inferred identity and still supports forwarding', async () => {
    const directory = await withSocket()
    writeFileSync(
      `${directory}/metadata.json`,
      JSON.stringify({ version: 1, destination: 'legacy' })
    )
    expect(readRemoteSessionIdentity(directory)).toBeNull()
    respond('')
    const forward = await openRemoteForward(directory, { address: '127.0.0.1', port: 80 })
    expect(forward).not.toBeNull()
    respond('')
    await forward!.close()
  })

  test.each(['symlink', 'mode', 'hardlink', 'oversize', 'identity', 'version', 'directory'])(
    'refuses unsafe %s metadata',
    async kind => {
      const directory = await prepare()
      const path = `${directory}/metadata.json`
      if (kind === 'symlink') {
        renameSync(path, `${directory}/old`)
        symlinkSync(`${directory}/old`, path)
      }
      if (kind === 'mode') chmodSync(path, 0o644)
      if (kind === 'hardlink') linkSync(path, `${directory}/old`)
      if (kind === 'oversize') writeFileSync(path, ' '.repeat(8193))
      if (kind === 'identity')
        writeFileSync(
          path,
          JSON.stringify({ version: 2, destination: 'host', connectionIdentity: {} })
        )
      if (kind === 'version')
        writeFileSync(path, JSON.stringify({ version: 3, destination: 'host' }))
      if (kind === 'directory') chmodSync(directory, 0o755)
      expect(readRemoteSessionIdentity(directory)).toBeNull()
      await observeRemoteSession(directory)
      expect(execute).not.toHaveBeenCalled()
    }
  )
})

describe('remote session preflight', () => {
  test('rejects ineligible argv without executing', async () => {
    expect(await prepareRemoteSession(['-N', 'host'])).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  test.each([
    '',
    'garbage',
    safeConfig.replace('hostname example.com\n', ''),
    safeConfig + 'user duplicate\n',
    safeConfig + 'controlpath /tmp/existing\n',
    safeConfig.replace('controlmaster false', 'controlmaster auto'),
  ])('rejects invalid effective config %j', async config => {
    respond(config)
    expect(await prepareRemoteSession(['host'])).toBeNull()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]!.slice(0, 3)).toEqual([
      'ssh',
      ['-G', 'host'],
      { timeout: 3000, maxBuffer: 65536, encoding: 'utf8' },
    ])
  })

  test('fails silently on preflight exec failure or synchronous throw', async () => {
    respond(safeConfig, new Error('timeout'))
    expect(await prepareRemoteSession(['host'])).toBeNull()
    execute.mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })
    expect(await prepareRemoteSession(['host'])).toBeNull()
  })

  test('stores addressing identity in private state, preserving argv', async () => {
    const args = ['-i', '/private/key name', 'user@alias']
    respond(safeConfig)
    const directory = (await prepareRemoteSession(args))!
    directories.push(directory)
    expect(execute.mock.calls[0]![1]).toEqual(['-G', ...args])
    expect(lstatSync(directory).mode & 0o777).toBe(0o700)
    expect(lstatSync(`${directory}/metadata.json`).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(`${directory}/metadata.json`, 'utf8'))).toEqual({
      version: 2,
      destination: 'user@alias',
      connectionIdentity: expect.objectContaining({
        hostname: 'example.com',
        port: 22,
        user: 'Alice',
      }),
    })
  })
})

describe('private mux observation', () => {
  test.each([
    '',
    '{}',
    'null',
    '[]',
    '{"kind":"port-handshake","version":"1"}',
    '{"kind":"port-handshake","version":2}',
    '{"kind":"wrong","version":1}',
    '{"kind":"port-handshake","version":1,"services":[]}',
    'banner\n{"kind":"port-handshake","version":1}',
  ])('rejects handshake %j without publishing', async output => {
    const directory = await withSocket()
    respond('')
    respond(output)
    await observeRemoteSession(directory)
    expect(existsSync(`${directory}/handshake.json`)).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  test('publishes exact handshake privately using clean companion argv', async () => {
    const directory = await withSocket()
    respond('')
    const controller = new AbortController()
    execute.mockImplementationOnce(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: null, stdout: string) => void
    ) => {
      controller.abort()
      callback(null, JSON.stringify(remoteHandshake()) + '\n')
    }) as typeof execFile)
    await observeRemoteSession(directory, controller.signal)
    const base = [
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
    expect(execute.mock.calls[0]![1]).toEqual([...base, '-O', 'check', 'dummy'])
    expect(execute.mock.calls[1]!.slice(0, 3)).toEqual([
      'ssh',
      [...base, 'dummy', 'port __remote-handshake'],
      { timeout: 5000, maxBuffer: 8192, encoding: 'utf8' },
    ])
    expect(JSON.parse(readFileSync(`${directory}/handshake.json`, 'utf8'))).toEqual(
      remoteHandshake()
    )
    expect(lstatSync(`${directory}/handshake.json`).mode & 0o777).toBe(0o600)
    expect(existsSync(`${directory}/handshake.json.tmp`)).toBe(false)
  })

  test('bounds failed mux polling and never enables transport fallback', async () => {
    const directory = await withSocket()
    vi.useFakeTimers()
    execute.mockImplementation(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: Error) => void
    ) => callback(new Error('mux absent'))) as typeof execFile)
    try {
      const pending = observeRemoteSession(directory)
      await vi.advanceTimersByTimeAsync(90_000)
      await pending
      expect(execute).toHaveBeenCalledTimes(360)
      for (const call of execute.mock.calls) {
        expect(call[1]).toContain('ProxyCommand=false')
        expect(call[1]).toContain('ControlMaster=no')
        expect(call[1]).toContain('/dev/null')
        expect(call[1]!.slice(-3)).toEqual(['-O', 'check', 'dummy'])
      }
      expect(existsSync(`${directory}/handshake.json`)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('missing helper returns silently without snapshot', async () => {
    const directory = await withSocket()
    respond('')
    respond('', new Error('missing helper'))
    await expect(observeRemoteSession(directory)).resolves.toBeUndefined()
    expect(existsSync(`${directory}/handshake.json`)).toBe(false)
  })

  test('does not write through a directory replaced during companion execution', async () => {
    const directory = await withSocket()
    const moved = `${directory}-moved`
    directories.push(moved)
    respond('')
    execute.mockImplementationOnce(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: null, stdout: string) => void
    ) => {
      renameSync(directory, moved)
      symlinkSync(moved, directory)
      callback(null, JSON.stringify(remoteHandshake()))
    }) as typeof execFile)
    await observeRemoteSession(directory)
    expect(existsSync(`${moved}/handshake.json`)).toBe(false)
  })
})

function snapshot(revision: number, empty = false, instanceId = 'remote-one') {
  return {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId,
    revision,
    worktrees: empty
      ? []
      : [
          {
            worktreeId: 'a'.repeat(64),
            namespace: 'feature.example.test',
            endpoints: [
              {
                id: 'b'.repeat(64),
                logicalPort: 3000,
                transports: ['http'],
                target: { address: '127.0.0.1', port: 4000 },
              },
            ],
          },
        ],
  }
}

function cache(directory: string) {
  return JSON.parse(readFileSync(`${directory}/snapshot.json`, 'utf8'))
}

async function startObserver(directory: string) {
  vi.useFakeTimers()
  respond('')
  respond(JSON.stringify(remoteHandshake()))
  const controller = new AbortController()
  // Callers queue the first snapshot after this helper, before the handshake resolves.
  const pending = observeRemoteSession(directory, controller.signal)
  return { controller, pending }
}

describe('live private snapshot cache', () => {
  test('refreshes live revisions, unchanged data and valid empty ownership privately', async () => {
    const directory = await withSocket()
    const { controller, pending } = await startObserver(directory)
    respond(JSON.stringify(snapshot(0)) + '\n')
    await vi.advanceTimersByTimeAsync(0)
    const first = cache(directory)
    expect(first).toEqual({
      version: 1,
      kind: 'port-session-snapshot',
      status: 'ready',
      observedAt: Date.now(),
      snapshot: snapshot(0),
    })
    expect(execute.mock.calls[2]!.slice(0, 3)).toEqual([
      'ssh',
      [...execute.mock.calls[1]![1]!.slice(0, -1), 'port __remote-snapshot 0'],
      {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024 + 1,
        encoding: 'utf8',
        signal: controller.signal,
      },
    ])
    respond(JSON.stringify(snapshot(1)))
    await vi.advanceTimersByTimeAsync(2000)
    expect(cache(directory).observedAt).toBeGreaterThan(first.observedAt)
    respond(JSON.stringify(snapshot(2, true)))
    await vi.advanceTimersByTimeAsync(2000)
    expect(cache(directory).snapshot.worktrees).toEqual([])
    expect(cache(directory).status).toBe('ready')
    expect(lstatSync(`${directory}/snapshot.json`).mode & 0o777).toBe(0o600)
    expect(existsSync(`${directory}/snapshot.json.tmp`)).toBe(false)
    controller.abort()
    await pending
  })

  test.each(['malformed', 'exec', 'throw', 'revision', 'oversize'])(
    'retains stale ownership on %s and recovers',
    async failure => {
      const directory = await withSocket()
      const { controller, pending } = await startObserver(directory)
      respond(JSON.stringify(snapshot(0)))
      await vi.advanceTimersByTimeAsync(0)
      if (failure === 'throw')
        execute.mockImplementationOnce(() => {
          throw new Error('spawn')
        })
      else
        respond(
          failure === 'revision'
            ? JSON.stringify(snapshot(99))
            : failure === 'oversize'
              ? ' '.repeat(4 * 1024 * 1024 + 2)
              : 'bad',
          failure === 'exec' ? new Error('timeout') : null
        )
      await vi.advanceTimersByTimeAsync(2000)
      expect(cache(directory).status).toBe('unavailable')
      expect(cache(directory).snapshot).toEqual(snapshot(0))
      respond(JSON.stringify(snapshot(2)))
      await vi.advanceTimersByTimeAsync(2000)
      expect(cache(directory).status).toBe('ready')
      controller.abort()
      await pending
    }
  )

  test('publishes null on initial failure and pins first validated identity', async () => {
    const directory = await withSocket()
    const { pending } = await startObserver(directory)
    respond('bad')
    await vi.advanceTimersByTimeAsync(0)
    expect(cache(directory).snapshot).toBeNull()
    respond(JSON.stringify(snapshot(1)))
    await vi.advanceTimersByTimeAsync(2000)
    respond(JSON.stringify(snapshot(2, true, 'replacement')))
    await vi.advanceTimersByTimeAsync(2000)
    await pending
    expect(cache(directory).status).toBe('unavailable')
    expect(cache(directory).snapshot).toEqual(snapshot(1))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(execute).toHaveBeenCalledTimes(5)
  })

  test('does not overlap slow fetches and honors exec deadline settings', async () => {
    const directory = await withSocket()
    const { controller, pending } = await startObserver(directory)
    execute.mockImplementationOnce(((
      _file: unknown,
      _args: unknown,
      options: { timeout: number },
      callback: (error: Error) => void
    ) => {
      setTimeout(() => callback(new Error('deadline')), options.timeout)
    }) as typeof execFile)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(existsSync(`${directory}/snapshot.json`)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(cache(directory).status).toBe('unavailable')
    controller.abort()
    await pending
  })

  test.each(['missing', 'symlink', 'replaced'])(
    'stops on %s socket without retargeting',
    async kind => {
      const directory = await withSocket()
      const { pending } = await startObserver(directory)
      respond(JSON.stringify(snapshot(0)))
      await vi.advanceTimersByTimeAsync(0)
      renameSync(`${directory}/s`, `${directory}/old-s`)
      if (kind === 'symlink') symlinkSync(`${directory}/old-s`, `${directory}/s`)
      if (kind === 'replaced') {
        const server = createServer()
        servers.push(server)
        await new Promise<void>(resolve => server.listen(`${directory}/s`, resolve))
      }
      await vi.advanceTimersByTimeAsync(2000)
      await pending
      expect(execute).toHaveBeenCalledTimes(3)
      expect(cache(directory).status).toBe('unavailable')
      expect(cache(directory).snapshot).toEqual(snapshot(0))
    }
  )

  test.each(['missing', 'symlink', 'replacement'])(
    'never recreates or writes a %s directory',
    async kind => {
      const directory = await withSocket()
      const { pending } = await startObserver(directory)
      respond(JSON.stringify(snapshot(0)))
      await vi.advanceTimersByTimeAsync(0)
      const moved = `${directory}-moved`
      directories.push(moved)
      renameSync(directory, moved)
      if (kind === 'symlink') symlinkSync(moved, directory)
      if (kind === 'replacement') mkdirSync(directory, { mode: 0o700 })
      await vi.advanceTimersByTimeAsync(2000)
      await pending
      expect(cache(moved).status).toBe('ready')
      if (kind !== 'symlink') expect(existsSync(`${directory}/snapshot.json`)).toBe(false)
      expect(execute).toHaveBeenCalledTimes(3)
    }
  )

  test.each(['symlink', 'mode', 'hardlink', 'temp'])(
    'refuses unsafe %s cache output',
    async kind => {
      const directory = await withSocket()
      const { pending } = await startObserver(directory)
      respond(JSON.stringify(snapshot(0)))
      await vi.advanceTimersByTimeAsync(0)
      const output = `${directory}/snapshot.json`
      if (kind === 'symlink') {
        unlinkSync(output)
        symlinkSync('/dev/null', output)
      }
      if (kind === 'mode') chmodSync(output, 0o644)
      if (kind === 'hardlink') linkSync(output, `${directory}/keep`)
      if (kind === 'temp') symlinkSync('/dev/null', `${output}.tmp`)
      respond(JSON.stringify(snapshot(1, true)))
      await vi.advanceTimersByTimeAsync(2000)
      await pending
      if (kind === 'symlink') expect(lstatSync(output).isSymbolicLink()).toBe(true)
      else expect(cache(directory).snapshot).toEqual(snapshot(0))
      if (kind === 'temp') expect(lstatSync(`${output}.tmp`).isSymbolicLink()).toBe(true)
    }
  )

  test('removes only private known snapshot files during cleanup', async () => {
    const directory = await prepare()
    for (const name of ['snapshot.json', 'snapshot.json.tmp'])
      writeFileSync(`${directory}/${name}`, '{}', { mode: 0o600 })
    await cleanupRemoteSession(directory)
    expect(existsSync(directory)).toBe(false)
  })
})

describe('local state and cleanup safety', () => {
  test.each([
    '/tmp',
    '/tmp/port-ssh-abcdef/..',
    '/tmp/port-ssh-abcdef/',
    '/tmp/port-ssh-abcdef/child',
    '/private/tmp/port-ssh-abcdef',
  ])('rejects hostile path %s before executing', async path => {
    await observeRemoteSession(path)
    await cleanupRemoteSession(path)
    expect(execute).not.toHaveBeenCalled()
  })

  test('rejects unowned and non-private directories', async () => {
    const directory = await prepare()
    const uid = process.getuid!()
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1)
    await observeRemoteSession(directory)
    await cleanupRemoteSession(directory)
    expect(existsSync(`${directory}/metadata.json`)).toBe(true)
    vi.restoreAllMocks()
    chmodSync(directory, 0o755)
    await cleanupRemoteSession(directory)
    expect(existsSync(directory)).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  test('rejects symlink metadata and socket without following targets', async () => {
    const directory = await prepare()
    unlinkSync(`${directory}/metadata.json`)
    symlinkSync('/dev/null', `${directory}/metadata.json`)
    await observeRemoteSession(directory)
    await cleanupRemoteSession(directory)
    expect(lstatSync(`${directory}/metadata.json`).isSymbolicLink()).toBe(true)
    const second = await prepare()
    symlinkSync('/dev/null', `${second}/s`)
    await cleanupRemoteSession(second)
    expect(existsSync(`${second}/metadata.json`)).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  test('does not overwrite output symlinks', async () => {
    const directory = await withSocket()
    symlinkSync('/dev/null', `${directory}/handshake.json`)
    respond('')
    respond(JSON.stringify(remoteHandshake()))
    await observeRemoteSession(directory)
    expect(lstatSync(`${directory}/handshake.json`).isSymbolicLink()).toBe(true)
  })

  test('only exits owned socket and removes known files', async () => {
    const directory = await withSocket()
    respond('')
    await cleanupRemoteSession(directory)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![1]!.slice(-3)).toEqual(['-O', 'exit', 'dummy'])
    expect(execute.mock.calls[0]![1]).toContain('ProxyCommand=false')
    expect(existsSync(directory)).toBe(false)
  })

  test('preserves unknown files and arbitrary same-shaped directories', async () => {
    const directory = await prepare()
    writeFileSync(`${directory}/keep`, 'untouched')
    await cleanupRemoteSession(directory)
    expect(readFileSync(`${directory}/keep`, 'utf8')).toBe('untouched')
    expect(existsSync(`${directory}/metadata.json`)).toBe(false)
    const arbitrary = mkdtempSync('/tmp/port-ssh-')
    directories.push(arbitrary)
    await cleanupRemoteSession(arbitrary)
    expect(existsSync(arbitrary)).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })
})
