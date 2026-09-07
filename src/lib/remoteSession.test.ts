import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  chmodSync,
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
import { execFile } from 'node:child_process'
import {
  cleanupRemoteSession,
  observeRemoteSession,
  prepareRemoteSession,
  remoteHandshake,
} from './remoteSession.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
const execute = vi.mocked(execFile)
const safeConfig =
  'controlmaster false\ncontrolpersist no\nsessiontype default\nstdinnull no\nforkafterauthentication no\nrequesttty auto\n'
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
  for (const server of servers.splice(0))
    await new Promise<void>(resolve => server.close(() => resolve()))
  // Test-owned fixtures only; production cleanup deliberately never uses rm recursive.
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('remote session preflight', () => {
  test('rejects ineligible argv without executing', async () => {
    expect(await prepareRemoteSession(['-N', 'host'])).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  test.each([
    '',
    'garbage',
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

  test('stores only destination and version in private state, preserving argv', async () => {
    const args = ['-i', '/private/key name', 'user@alias']
    respond(safeConfig)
    const directory = (await prepareRemoteSession(args))!
    directories.push(directory)
    expect(execute.mock.calls[0]![1]).toEqual(['-G', ...args])
    expect(lstatSync(directory).mode & 0o777).toBe(0o700)
    expect(lstatSync(`${directory}/metadata.json`).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(`${directory}/metadata.json`, 'utf8'))).toEqual({
      version: 1,
      destination: 'user@alias',
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
    respond(JSON.stringify(remoteHandshake()) + '\n')
    await observeRemoteSession(directory)
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
