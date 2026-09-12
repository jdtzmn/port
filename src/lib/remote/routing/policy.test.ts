import { describe, expect, it } from 'vitest'
import type { RemoteSnapshot } from '../session/snapshot.ts'
import { selectSupportedRemoteWorktrees } from './policy.ts'

const endpoint = {
  id: 'b'.repeat(64),
  name: 'ui',
  aliasTransports: ['http'] as ['http'],
  logicalPort: 3000,
  transports: ['http', 'tls-sni'] as const,
  target: { address: '172.20.0.2', port: 8080 },
}

function snapshot(namespaces: string[]): RemoteSnapshot {
  return {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId: 'a'.repeat(64),
    revision: 7,
    worktrees: namespaces.map((namespace, index) => ({
      worktreeId: String(index).padStart(64, '0'),
      namespace,
      endpoints: [{ ...endpoint, transports: [...endpoint.transports] }],
    })),
  }
}

describe('selectSupportedRemoteWorktrees', () => {
  it('selects only exact single-label .port namespaces', () => {
    const result = selectSupportedRemoteWorktrees(
      snapshot(['feature.port', 'feature.custom', 'feature.extra.port', 'Feature.port'])
    )

    expect(result.worktrees.map(worktree => worktree.namespace)).toEqual(['feature.port'])
  })

  it('returns a detached snapshot without mutating its input', () => {
    const input = snapshot(['feature.port', 'feature.custom'])
    const before = structuredClone(input)
    const result = selectSupportedRemoteWorktrees(input)

    result.worktrees[0]!.namespace = 'changed.port'
    result.worktrees[0]!.endpoints[0]!.target.port = 9999
    result.worktrees[0]!.endpoints[0]!.transports.length = 0

    expect(input).toEqual(before)
  })
})
