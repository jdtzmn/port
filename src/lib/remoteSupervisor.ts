import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GLOBAL_PORT_DIR } from './registry.ts'
import { remoteRuntimePaths } from './remoteRuntime.ts'
import { requestRemoteCoordinator } from './remoteCoordinatorControl.ts'
import { withRemoteMutex } from './remoteMutex.ts'

/** Opt-in installation marker; absent/unsafe configuration never changes ordinary SSH. */
export async function remoteRuntimeEnabled(): Promise<boolean> {
  let file
  try {
    const root = join(GLOBAL_PORT_DIR, 'remote')
    const parent = await lstat(root)
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o7777) !== 0o700
    )
      return false
    file = await open(
      join(root, 'enabled.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o7777) !== 0o600 ||
      stat.size > 128
    )
      return false
    const bytes = Buffer.alloc(129)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== stat.size) return false
    const data = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
    return (
      Object.keys(data).sort().join(',') === 'enabled,version' &&
      data.version === 1 &&
      data.enabled === true
    )
  } catch {
    return false
  } finally {
    await file?.close()
  }
}

export async function enableRemoteRuntime(): Promise<void> {
  const { root } = await remoteRuntimePaths()
  if (await remoteRuntimeEnabled()) return
  const file = await open(
    join(root, 'enabled.json'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile('{"version":1,"enabled":true}\n')
    await file.sync()
  } finally {
    await file.close()
  }
}

let launchedAt = -Infinity
let registeredIncarnation: string | undefined

/** Called by the existing SSH observer, never by the foreground login process. */
export async function registerRemoteRuntimeSession(directory: string): Promise<void> {
  try {
    if (!(await remoteRuntimeEnabled())) return
    const { controlRoot } = await remoteRuntimePaths()
    const ping = await requestRemoteCoordinator(controlRoot, { version: 1, action: 'ping' })
    if (!ping || ping.status !== 'ok') {
      if (performance.now() - launchedAt >= 10_000) {
        launchedAt = performance.now()
        const child = spawn(process.execPath, [process.argv[1]!, '__remote-supervise'], {
          detached: true,
          stdio: 'ignore',
        })
        child.on('error', () => {})
        child.unref()
      }
      return
    }
    if (registeredIncarnation === ping.incarnation) return
    const result = await requestRemoteCoordinator(controlRoot, {
      version: 1,
      action: 'register',
      incarnation: ping.incarnation,
      directory,
    })
    if (result?.status === 'ok') registeredIncarnation = ping.incarnation
  } catch {
    /* Integration failure never changes login, authentication or remote output. */
  }
}

/** Kernel-held singleton supervisor. A worker's parent pipe closes when this process dies. */
export async function runRemoteSupervisor(): Promise<void> {
  if (!(await remoteRuntimeEnabled())) return
  const { controlRoot } = await remoteRuntimePaths()
  await mkdir(controlRoot, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const abort = new AbortController()
  let child: ChildProcess | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    abort.abort()
    child?.stdin?.end()
    if (child) {
      const owned = child
      killTimer = setTimeout(() => {
        if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL')
      }, 5000)
    }
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  try {
    await withRemoteMutex(
      join(controlRoot, 'supervisor.sqlite'),
      async () => {
        let backoff = 250
        while (!abort.signal.aborted && (await remoteRuntimeEnabled())) {
          const code = await new Promise<number>(resolve => {
            child = spawn(process.execPath, [process.argv[1]!, '__remote-runtime'], {
              stdio: ['pipe', 'ignore', 'ignore'],
            })
            child.stdin?.on('error', () => {})
            child.once('error', () => resolve(1))
            child.once('close', code => resolve(code ?? 1))
          })
          child = undefined
          clearTimeout(killTimer)
          if (code === 0 || abort.signal.aborted) break
          await delay(backoff, undefined, { signal: abort.signal })
          backoff = Math.min(backoff * 2, 10_000)
        }
      },
      { timeoutMs: 0, signal: abort.signal }
    )
  } catch (error) {
    if (!abort.signal.aborted) throw error
  } finally {
    clearTimeout(killTimer)
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}
