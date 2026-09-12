import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { once } from 'node:events'
import { cleanupRemoteSession, openRemoteStream } from './session.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomBytes: vi.fn(),
}))
const execute = vi.mocked(execFile)
const directories: string[] = []
const servers: Server[] = []
const clients: Socket[] = []
const target = { address: '172.20.0.5', port: 5432 }
let sequence = 0

async function listen(path: string): Promise<void> {
  const server = createServer(client => {
    clients.push(client)
    client.end('unix-only')
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  chmodSync(path, 0o600)
}

async function fixture(): Promise<string> {
  const directory = mkdtempSync('/tmp/port-ssh-')
  directories.push(directory)
  chmodSync(directory, 0o700)
  writeFileSync(`${directory}/metadata.json`, JSON.stringify({ version: 1, destination: 'host' }), {
    mode: 0o600,
  })
  await listen(`${directory}/s`)
  return directory
}

function mockSsh(action?: (path: string, args: string[]) => Promise<Error | null>): void {
  execute.mockImplementation(((
    _file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    const operation = args[args.indexOf('-O') + 1]
    const path = args[args.indexOf('-L') + 1]?.split(':')[0] ?? ''
    void (async () => {
      if (operation === 'forward') {
        if (action) return action(path, args)
        await listen(path)
      }
      return null
    })().then(
      error => callback(error, '', ''),
      error => callback(error, '', '')
    )
  }) as typeof execFile)
}

beforeEach(() => {
  execute.mockReset()
  vi.mocked(randomBytes).mockReset()
  vi.mocked(randomBytes).mockImplementation((() =>
    Buffer.from((++sequence).toString(16).padStart(32, '0'), 'hex')) as typeof randomBytes)
  mockSsh()
})
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy()
  for (const server of servers.splice(0))
    await new Promise<void>(resolve => server.close(() => resolve()))
  // Only test-owned fixtures; production must not use recursive deletion.
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('creates exact private stream spec with clean bounded companion and connects only to Unix', async () => {
  const directory = await fixture()
  const stream = await openRemoteStream(directory, target)
  expect(stream).not.toBeNull()
  expect(stream!.path).toMatch(new RegExp(`^${directory}/f-[a-f0-9]{32}$`))
  expect(Buffer.byteLength(stream!.path)).toBeLessThan(100)
  expect(lstatSync(stream!.path).mode & 0o7777).toBe(0o600)
  expect(lstatSync(stream!.path).isSocket()).toBe(true)
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
    'StreamLocalBindUnlink=no',
    '-o',
    'StreamLocalBindMask=0177',
    '-o',
    'ExitOnForwardFailure=yes',
    '-O',
    'forward',
    '-L',
    `${stream!.path}:172.20.0.5:5432`,
    'dummy',
  ]
  expect(execute).toHaveBeenCalledWith(
    'ssh',
    args,
    { timeout: 3000, maxBuffer: 8192, encoding: 'utf8' },
    expect.any(Function)
  )
  const client = stream!.connect()!
  clients.push(client)
  expect((await once(client, 'data'))[0].toString()).toBe('unix-only')
  await Promise.all([stream!.close(), stream!.close()])
  expect(stream!.connect()).toBeNull()
  expect(existsSync(stream!.path)).toBe(false)
  expect(execute).toHaveBeenCalledTimes(2)
  expect(execute.mock.calls[1]![1]).toEqual(args.map(arg => (arg === 'forward' ? 'cancel' : arg)))
})

test.each([
  '8.8.8.8',
  '172.32.0.1',
  '192.169.1.1',
  'localhost',
  '::1',
  '10.1.1.1:22',
  '127.01.0.1',
])('rejects invalid target %s before allocation or SSH', async address => {
  expect(await openRemoteStream('/not-a-session', { address, port: 80 })).toBeNull()
  expect(execute).not.toHaveBeenCalled()
  expect(randomBytes).not.toHaveBeenCalled()
})
test.each([0, -1, 65536, 1.5, NaN])('rejects invalid port %s', async port => {
  expect(await openRemoteStream('/not-a-session', { address: '127.0.0.1', port })).toBeNull()
  expect(execute).not.toHaveBeenCalled()
})

test.each(['stream', 'control', 'directory', 'permissions', 'metadata'])(
  'refuses connect and cancel after %s replacement/invalidation',
  async kind => {
    const directory = await fixture()
    const stream = (await openRemoteStream(directory, target))!
    if (kind === 'stream' || kind === 'control') {
      const path = kind === 'stream' ? stream.path : `${directory}/s`
      renameSync(path, `${path}.old`)
      await listen(path)
    } else if (kind === 'directory') {
      renameSync(directory, `${directory}-old`)
      directories.push(`${directory}-old`)
      mkdirSync(directory, { mode: 0o700 })
    } else if (kind === 'permissions') chmodSync(directory, 0o755)
    else unlinkSync(`${directory}/metadata.json`)
    expect(stream.connect()).toBeNull()
    await stream.close()
    expect(execute).toHaveBeenCalledTimes(1)
    if (kind === 'stream') expect(existsSync(stream.path)).toBe(true)
    if (kind === 'permissions') expect(existsSync(stream.path)).toBe(true)
  }
)

test.each([false, true])(
  'failed forward with late installed socket=%s cancels original master',
  async installed => {
    const directory = await fixture()
    let path = ''
    mockSsh(async value => {
      path = value
      if (installed) await listen(path)
      return new Error('timeout')
    })
    expect(await openRemoteStream(directory, target)).toBeNull()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]![1]).toContain('cancel')
    expect(existsSync(path)).toBe(false)
  }
)

test('late failure never cancels a replacement master', async () => {
  const directory = await fixture()
  mockSsh(async path => {
    await listen(path)
    renameSync(`${directory}/s`, `${directory}/old`)
    await listen(`${directory}/s`)
    return new Error('timeout')
  })
  expect(await openRemoteStream(directory, target)).toBeNull()
  expect(execute).toHaveBeenCalledTimes(1)
})

test.each(['file', 'symlink', 'socket'])(
  'does not reuse preexisting random path (%s)',
  async kind => {
    const directory = await fixture()
    const hex = 'a'.repeat(32)
    vi.mocked(randomBytes).mockReturnValue(Buffer.from(hex, 'hex') as never)
    const path = `${directory}/f-${hex}`
    if (kind === 'socket') await listen(path)
    else if (kind === 'symlink') symlinkSync(`${directory}/metadata.json`, path)
    else writeFileSync(path, 'preserve', { mode: 0o600 })
    const before = lstatSync(path)
    expect(await openRemoteStream(directory, target)).toBeNull()
    expect(lstatSync(path).ino).toBe(before.ino)
    expect(execute).not.toHaveBeenCalled()
  }
)

test('fresh allocations differ; missing Unix listener cannot fall back to a new TCP port', async () => {
  const directory = await fixture()
  const first = (await openRemoteStream(directory, target))!
  const second = (await openRemoteStream(directory, target))!
  expect(first.path).not.toBe(second.path)
  const tcp = createServer()
  servers.push(tcp)
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve))
  unlinkSync(first.path)
  expect(first.connect()).toBeNull()
  await first.close()
  expect(execute).toHaveBeenCalledTimes(2)
  await second.close()
})

test.each(['file', 'symlink', 'mode'])(
  'rejects unsafe created stream (%s) without deleting it',
  async kind => {
    const directory = await fixture()
    let path = ''
    mockSsh(async value => {
      path = value
      if (kind === 'file') writeFileSync(path, 'unknown', { mode: 0o600 })
      else if (kind === 'symlink') symlinkSync(`${directory}/s`, path)
      else {
        await listen(path)
        chmodSync(path, 0o666)
      }
      return null
    })
    expect(await openRemoteStream(directory, target)).toBeNull()
    expect(existsSync(path)).toBe(true)
  }
)

test('master-exit cleanup removes only known private f-hex sockets', async () => {
  const directory = await fixture()
  const good = `${directory}/f-${'b'.repeat(24)}`
  const file = `${directory}/f-${'c'.repeat(24)}`
  const link = `${directory}/f-${'d'.repeat(24)}`
  const wrongMode = `${directory}/f-${'e'.repeat(24)}`
  await listen(good)
  await listen(wrongMode)
  chmodSync(wrongMode, 0o666)
  writeFileSync(file, 'keep', { mode: 0o600 })
  symlinkSync(file, link)
  await cleanupRemoteSession(directory)
  expect(existsSync(good)).toBe(false)
  expect(existsSync(file)).toBe(true)
  expect(lstatSync(link).isSymbolicLink()).toBe(true)
  expect(existsSync(wrongMode)).toBe(true)
})
