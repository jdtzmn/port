import {
  cleanupRemoteSession,
  observeRemoteSession,
  prepareRemoteSession,
  remoteHandshake,
} from '../lib/remoteSession.ts'

const tokens = new Set([
  '__remote-prepare',
  '__remote-observe',
  '__remote-cleanup',
  '__remote-handshake',
])

export function isRemoteInternalCommand(token: string | undefined): boolean {
  return token !== undefined && tokens.has(token)
}

/** Private protocol: no Commander, hooks, diagnostics, or service snapshots. */
export async function dispatchRemoteInternalCommand(token: string, args: string[]): Promise<void> {
  try {
    if (!isRemoteInternalCommand(token)) throw new Error('Invalid command')
    if (token === '__remote-handshake') {
      if (args.length !== 0) throw new Error('Invalid arguments')
      process.stdout.write(JSON.stringify(remoteHandshake()) + '\n')
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
      if (token === '__remote-observe') await observeRemoteSession(args[0]!)
      else await cleanupRemoteSession(args[0]!)
    }
  } catch {
    process.exitCode = 1
  }
}
