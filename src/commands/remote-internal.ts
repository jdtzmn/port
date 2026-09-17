import {
  isManagedRemoteSessionDirectory,
  isRemoteSessionDirectory,
} from '../lib/remote/session/directory.ts'
import { getRemoteInstanceId } from '../lib/remote/session/identity.ts'
import { parseRemoteSnapshot } from '../lib/remote/session/snapshot.ts'
import { collectRemoteSnapshot } from '../lib/remote/session/snapshotCollector.ts'
import {
  cleanupRemoteSession,
  prepareRemoteSession,
  remoteHandshake,
} from '../lib/remote/session/session.ts'

const commands = [
  '__remote-prepare',
  '__remote-observe',
  '__remote-cleanup',
  '__remote-handshake',
  '__remote-snapshot',
  '__remote-runtime',
  '__remote-supervise',
] as const

type RemoteInternalCommand = (typeof commands)[number]

const commandSet = new Set<string>(commands)
const revision = /^(0|[1-9][0-9]{0,15})$/

const fail = (): never => {
  throw new Error('Invalid remote internal command')
}

function isCommand(token: string): token is RemoteInternalCommand {
  return commandSet.has(token)
}

function requireNoArguments(args: string[]): void {
  if (args.length !== 0) fail()
}

function requireSessionDirectory(args: string[]): string {
  if (args.length !== 1 || !isRemoteSessionDirectory(args[0])) fail()
  return args[0]!
}

function writeLine(value: string): void {
  process.stdout.write(value + '\n')
}

async function runRuntime(
  kind: '__remote-runtime' | '__remote-supervise',
  observeOnly = false
): Promise<void> {
  if (kind === '__remote-runtime') {
    const runtime = await import('../lib/remote/coordinator/runtime.ts')
    if (observeOnly) await runtime.runRemoteObservationRuntime()
    else await runtime.runRemoteRuntime()
  } else await (await import('../lib/remote/coordinator/supervisor.ts')).runRemoteSupervisor()
}

async function snapshot(args: string[]): Promise<void> {
  if (args.length !== 1 || !revision.test(args[0]!) || !Number.isSafeInteger(Number(args[0])))
    fail()
  const value = await collectRemoteSnapshot(await getRemoteInstanceId(), Number(args[0]))
  writeLine(JSON.stringify(parseRemoteSnapshot(JSON.stringify(value))))
}

async function prepare(args: string[]): Promise<void> {
  if (args[0] !== '--' || args.length < 2) fail()
  const directory = await prepareRemoteSession(args.slice(1))
  if (!isRemoteSessionDirectory(directory)) throw new Error('Unavailable remote session')
  writeLine(`${isManagedRemoteSessionDirectory(directory) ? 'managed' : 'legacy'} ${directory}`)
}

async function observe(directory: string): Promise<void> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  try {
    await (
      await import('../lib/remote/coordinator/supervisor.ts')
    ).maintainRemoteRuntimeObservation(directory, controller.signal)
  } finally {
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

async function cleanup(directory: string): Promise<void> {
  const stopped = await (
    await import('../lib/remote/coordinator/supervisor.ts')
  ).stopRemoteRuntimeObservation(directory)
  if (!stopped) throw new Error('Remote observation is still active')
  await cleanupRemoteSession(directory)
}

/** Identifies commands that bypass Commander and speak the private SSH protocol. */
export function isRemoteInternalCommand(token: string | undefined): boolean {
  return token !== undefined && isCommand(token)
}

/**
 * Private protocol dispatcher. Its interface deliberately admits only fixed argv grammars and
 * bounded one-line output. Failures are silent so ordinary SSH never receives private details.
 */
export async function dispatchRemoteInternalCommand(token: string, args: string[]): Promise<void> {
  try {
    if (!isCommand(token)) fail()

    switch (token) {
      case '__remote-runtime':
        if (args.length === 0) await runRuntime(token)
        else if (args.length === 1 && args[0] === '--observe-only') await runRuntime(token, true)
        else fail()
        return
      case '__remote-supervise':
        requireNoArguments(args)
        await runRuntime(token)
        return
      case '__remote-handshake':
        requireNoArguments(args)
        writeLine(JSON.stringify(remoteHandshake()))
        return
      case '__remote-snapshot':
        await snapshot(args)
        return
      case '__remote-prepare':
        await prepare(args)
        return
      case '__remote-observe':
        await observe(requireSessionDirectory(args))
        return
      case '__remote-cleanup':
        await cleanup(requireSessionDirectory(args))
        return
    }
  } catch {
    process.exitCode = 1
  }
}
