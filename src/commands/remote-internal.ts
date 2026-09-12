import { getRemoteInstanceId } from '../lib/remote/session/identity.ts'
import { parseRemoteSnapshot } from '../lib/remote/session/snapshot.ts'
import { collectRemoteSnapshot } from '../lib/remote/session/snapshotCollector.ts'
import {
  cleanupRemoteSession,
  observeRemoteSession,
  prepareRemoteSession,
  remoteHandshake,
} from '../lib/remote/session/session.ts'

const tokens = new Set([
  '__remote-prepare',
  '__remote-observe',
  '__remote-cleanup',
  '__remote-handshake',
  '__remote-snapshot',
  '__remote-runtime',
  '__remote-supervise',
])

export function isRemoteInternalCommand(token: string | undefined): boolean {
  return token !== undefined && tokens.has(token)
}

/** Private protocol: no Commander, hooks, or diagnostics; only allowlisted metadata. */
export async function dispatchRemoteInternalCommand(token: string, args: string[]): Promise<void> {
  try {
    if (!isRemoteInternalCommand(token)) throw new Error('Invalid command')
    if (token === '__remote-runtime' || token === '__remote-supervise') {
      if (args.length !== 0) throw new Error('Invalid arguments')
      if (token === '__remote-runtime')
        await (await import('../lib/remote/coordinator/runtime.ts')).runRemoteRuntime()
      else await (await import('../lib/remote/coordinator/supervisor.ts')).runRemoteSupervisor()
    } else if (token === '__remote-handshake') {
      if (args.length !== 0) throw new Error('Invalid arguments')
      process.stdout.write(JSON.stringify(remoteHandshake()) + '\n')
    } else if (token === '__remote-snapshot') {
      if (
        args.length !== 1 ||
        !/^(0|[1-9][0-9]{0,15})(?![\s\S])/.test(args[0]!) ||
        !Number.isSafeInteger(Number(args[0]))
      )
        throw new Error('Invalid arguments')
      const snapshot = await collectRemoteSnapshot(await getRemoteInstanceId(), Number(args[0]))
      const validated = parseRemoteSnapshot(JSON.stringify(snapshot))
      process.stdout.write(JSON.stringify(validated) + '\n')
    } else if (token === '__remote-prepare') {
      if (args[0] !== '--' || args.length < 2) throw new Error('Invalid arguments')
      const directory = await prepareRemoteSession(args.slice(1))
      if (!directory || !/^\/tmp\/port-ssh-[A-Za-z0-9]{6}(?![\s\S])/.test(directory)) {
        throw new Error('Unavailable session')
      }
      process.stdout.write(directory + '\n')
    } else {
      if (args.length !== 1 || !/^\/tmp\/port-ssh-[A-Za-z0-9]{6}(?![\s\S])/.test(args[0]!)) {
        throw new Error('Invalid arguments')
      }
      if (token === '__remote-observe') {
        await observeRemoteSession(args[0]!, undefined, async () => {
          await (
            await import('../lib/remote/coordinator/supervisor.ts')
          ).registerRemoteRuntimeSession(args[0]!)
        })
      } else await cleanupRemoteSession(args[0]!)
    }
  } catch {
    process.exitCode = 1
  }
}
