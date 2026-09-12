import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withRemoteMutex } from './mutex.ts'

const moduleURL = new URL('./mutex.ts', import.meta.url).href
const children: ChildProcess[] = []
let root: string
let database: string

function child(runtime: string, path = database, timeoutMs = 3000) {
  const source = `
    import { withRemoteMutex } from ${JSON.stringify(moduleURL)};
    if (${JSON.stringify(runtime)} === 'node') {
      const { DatabaseSync } = await import('node:sqlite');
      const exec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function(sql) {
        try { return exec.call(this, sql); }
        catch (error) {
          if (sql === 'BEGIN IMMEDIATE' && [5, 6].includes(error.errcode & 255)) {
            console.error('WAITING');
          }
          throw error;
        }
      };
    }
    try {
      await withRemoteMutex(${JSON.stringify(path)}, async () => {
        console.log('OWNED');
        await new Promise(resolve => process.stdin.once('data', resolve));
      }, { timeoutMs: ${timeoutMs} });
      process.exit(0);
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
  `
  const proc = spawn(runtime, ['--input-type=module', '--eval', source], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(proc)
  let output = ''
  let errors = ''
  proc.stdout!.on('data', data => {
    output += String(data)
  })
  proc.stderr!.on('data', data => {
    errors += String(data)
  })
  const exited = once(proc, 'exit')
  return {
    proc,
    exited,
    output: () => output,
    errors: () => errors,
    async owned() {
      const end = performance.now() + 5000
      while (!output.includes('OWNED')) {
        if (proc.exitCode !== null || performance.now() > end) {
          throw new Error(`Child did not acquire: ${errors}`)
        }
        await delay(10)
      }
    },
    async release() {
      proc.stdin!.write('release\n')
      expect((await exited)[0], errors).toBe(0)
    },
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'port-mutex-'))
  await chmod(root, 0o700)
  database = join(root, 'mutex.sqlite')
})

afterEach(async () => {
  for (const proc of children.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, 'exit')
      proc.kill('SIGKILL')
      await exited
    }
  }
  // Test fixture teardown only, after every process/connection has exited.
  await rm(root, { recursive: true, force: true })
})

describe.each(['node', 'bun'])('%s native SQLite mutex', runtime => {
  it('serializes independent processes; live locks cannot be age-stolen', async () => {
    const holder = child(runtime)
    await holder.owned()
    const inode = (await lstat(database)).ino
    await utimes(database, new Date(0), new Date(0))
    const waiter = child(runtime)
    const expired = child(runtime, database, 80)
    expect((await expired.exited)[0]).toBe(2)
    expect(expired.errors()).toContain('timed out')
    expect(waiter.output()).toBe('')
    await holder.release()
    await waiter.owned()
    await waiter.release()
    expect((await lstat(database)).ino).toBe(inode)
    expect((await lstat(database)).mode & 0o777).toBe(0o600)
  })

  it('releases kernel locks after SIGKILL of an OWNED child', async () => {
    const holder = child(runtime)
    await holder.owned()
    const inode = (await lstat(database)).ino
    holder.proc.kill('SIGKILL')
    await holder.exited
    const next = child(runtime === 'bun' ? 'node' : 'bun')
    await next.owned()
    await next.release()
    expect((await lstat(database)).ino).toBe(inode)
  })
})

it('releases on callback failure and acquisition abort', async () => {
  await expect(
    withRemoteMutex(database, async () => {
      throw new Error('callback')
    })
  ).rejects.toThrow('callback')
  const holder = child('bun')
  await holder.owned()
  const controller = new AbortController()
  const waiting = withRemoteMutex(
    database,
    async () => {
      throw new Error('must not run')
    },
    { signal: controller.signal }
  )
  const rejected = expect(waiting).rejects.toThrow()
  await delay(40)
  controller.abort()
  await rejected
  await holder.release()
  expect(await withRemoteMutex(database, async () => 42)).toBe(42)
})

it('abort during callback does not release; local timeout cannot drop OS locks', async () => {
  const controller = new AbortController()
  await withRemoteMutex(
    database,
    async () => {
      controller.abort()
      await expect(withRemoteMutex(database, async () => {}, { timeoutMs: 30 })).rejects.toThrow(
        'timed out'
      )
      const blocked = child('bun', database, 60)
      expect((await blocked.exited)[0]).toBe(2)
      expect(blocked.errors()).toContain('timed out')
    },
    { signal: controller.signal }
  )
  const next = child('node')
  await next.owned()
  await next.release()
})

it('rejects pre-abort and invalid timeouts without invoking callback', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    withRemoteMutex(database, async () => {}, { signal: controller.signal })
  ).rejects.toThrow()
  for (const timeoutMs of [-1, Infinity, NaN]) {
    await expect(withRemoteMutex(database, async () => {}, { timeoutMs })).rejects.toThrow('finite')
  }
})

it.each(['mode', 'symlink', 'hardlink', 'directory', 'corrupt'])(
  'rejects unsafe file: %s',
  async kind => {
    if (kind === 'directory') await mkdir(database, { mode: 0o700 })
    else if (kind === 'symlink') {
      const target = join(root, 'target')
      await writeFile(target, '', { mode: 0o600 })
      await symlink(target, database)
    } else {
      await writeFile(database, kind === 'corrupt' ? 'not a SQLite database'.repeat(100) : '', {
        mode: 0o600,
      })
      if (kind === 'mode') await chmod(database, 0o644)
      if (kind === 'hardlink') await link(database, join(root, 'alias'))
    }
    const before = await lstat(database)
    const content = kind === 'corrupt' ? await readFile(database) : undefined
    await expect(
      withRemoteMutex(database, async () => {
        throw new Error('unsafe callback ran')
      })
    ).rejects.not.toThrow('unsafe callback ran')
    expect((await lstat(database)).ino).toBe(before.ino)
    if (content) expect(await readFile(database)).toEqual(content)
  }
)

it('rejects permissive and symlink roots', async () => {
  await chmod(root, 0o755)
  await expect(withRemoteMutex(database, async () => {})).rejects.toThrow('directory')
  await chmod(root, 0o700)
  const alias = join(root, 'alias')
  await symlink(root, alias)
  await expect(withRemoteMutex(join(alias, 'mutex.sqlite'), async () => {})).rejects.toThrow()
})

it.each(['file', 'root'])('fails closed when pinned %s changes while acquiring', async kind => {
  const holder = child('bun')
  await holder.owned()
  const waiter = child('node')
  const deadline = performance.now() + 3000
  while (!waiter.errors().includes('WAITING')) {
    if (waiter.proc.exitCode !== null || performance.now() > deadline) {
      throw new Error(`Waiter did not contend: ${waiter.errors()}`)
    }
    await delay(10)
  }
  if (kind === 'file') {
    await rename(database, join(root, 'old.sqlite'))
    await writeFile(database, '', { mode: 0o600 })
  } else {
    // Preserve the old inode inside fixture root while replacing the parent path.
    const moved = `${root}-moved`
    await rename(root, moved)
    await mkdir(root, { mode: 0o700 })
    await rename(moved, join(root, 'old-root'))
  }
  expect((await waiter.exited)[0]).toBe(2)
  expect(waiter.errors()).toMatch(/Unsafe or replaced/)
  expect(waiter.output()).toBe('')
  await holder.release()
})
