import type { RemoteSnapshot } from '../session/snapshot.ts'

export const REMOTE_ROUTE_DOMAIN = 'port'

const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const supportedNamespace = new RegExp(`^${label}\\.${REMOTE_ROUTE_DOMAIN}$`)

/**
 * Remote integration currently owns only the default .port namespace.
 * Preserve the validated snapshot envelope while detaching supported worktrees.
 */
export function selectSupportedRemoteWorktrees(snapshot: RemoteSnapshot): RemoteSnapshot {
  return {
    version: snapshot.version,
    kind: snapshot.kind,
    instanceId: snapshot.instanceId,
    revision: snapshot.revision,
    worktrees: snapshot.worktrees
      .filter(worktree => supportedNamespace.test(worktree.namespace))
      .map(worktree => ({
        worktreeId: worktree.worktreeId,
        namespace: worktree.namespace,
        endpoints: worktree.endpoints.map(endpoint => ({
          ...endpoint,
          ...(endpoint.aliasTransports
            ? { aliasTransports: [...endpoint.aliasTransports] as ['http'] }
            : {}),
          transports: [...endpoint.transports],
          target: { ...endpoint.target },
        })),
      })),
  }
}
