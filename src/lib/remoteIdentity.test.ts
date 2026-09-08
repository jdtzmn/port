import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async importOriginal => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => {
    if (!home.path) throw new Error('Test home not initialized')
    return home.path
  },
}))
import { getRemoteInstanceId } from './remoteIdentity.ts'

let root: string
let file: string
beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), 'port-identity-test-'))
  root = join(home.path, '.port', 'remote-identity')
  file = join(root, 'identity.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(home.path, { recursive: true, force: true })
  home.path = ''
})

async function prepare() {
  await mkdir(root, { recursive: true, mode: 0o700 })
}

test('concurrent readers share one UUIDv4, stable across module reload, with private modes', async () => {
  const ids = await Promise.all(Array.from({ length: 16 }, () => getRemoteInstanceId()))
  expect(new Set(ids).size).toBe(1)
  expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, instanceId: ids[0] })
  expect((await lstat(root)).mode & 0o777).toBe(0o700)
  expect((await lstat(file)).mode & 0o777).toBe(0o600)
  vi.resetModules()
  expect(await (await import('./remoteIdentity.ts')).getRemoteInstanceId()).toBe(ids[0])
})

test.each([
  '',
  '{bad',
  'null',
  '{}',
  JSON.stringify({ version: 2, instanceId: 'bad' }),
  'x'.repeat(257),
])('rejects corrupt or oversized identity unchanged (%#)', async content => {
  await prepare()
  await writeFile(file, content, { mode: 0o600 })
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect(await readFile(file, 'utf8')).toBe(content)
})

test('rejects identity symlink without touching target', async () => {
  await prepare()
  const target = join(home.path, 'target')
  await writeFile(target, 'untouched', { mode: 0o600 })
  await symlink(target, file)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect(await readlink(file)).toBe(target)
  expect(await readFile(target, 'utf8')).toBe('untouched')
})

test.each([0o644, 0o660, 0o400])('rejects file mode %i unchanged', async mode => {
  await getRemoteInstanceId()
  const original = await readFile(file, 'utf8')
  await chmod(file, mode)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect(await readFile(file, 'utf8')).toBe(original)
  expect((await lstat(file)).mode & 0o777).toBe(mode)
})

test('rejects nonregular identity', async () => {
  await prepare()
  await mkdir(file)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect((await lstat(file)).isDirectory()).toBe(true)
})

test('rejects directory permissions without repair', async () => {
  await prepare()
  await chmod(root, 0o755)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect((await lstat(root)).mode & 0o777).toBe(0o755)
  await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects symlink directory', async () => {
  await mkdir(join(home.path, '.port'))
  const target = join(home.path, 'target')
  await mkdir(target, { mode: 0o700 })
  await symlink(target, root)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
  expect(await readlink(root)).toBe(target)
  await expect(lstat(join(target, 'identity.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects incorrect ownership', async () => {
  await prepare()
  vi.spyOn(process, 'getuid').mockReturnValue((process.getuid!() + 1) >>> 0)
  await expect(getRemoteInstanceId()).rejects.toThrow('Remote identity unavailable')
})
