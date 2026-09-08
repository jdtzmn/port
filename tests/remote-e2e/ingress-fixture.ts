import { IngressAddresses } from '../../src/lib/ingressAddresses'
import { createRouteResolver, type WorktreeRoutes } from '../../src/lib/routeOwnership'
import { startRouteIngress } from '../../src/lib/routeIngress'

const owners = ['remote-a', 'remote-b', 'local'] as const
const records: WorktreeRoutes[] = owners.map(id => ({
  owner: { id, label: id, kind: id === 'local' ? 'local' : 'ssh' },
  worktreeId: 'feature',
  namespace: 'feature.port',
  services: [
    ...(id === 'local'
      ? []
      : [{ id: 'db', name: 'db', logicalPort: 5432, protocol: 'tcp' as const }]),
    { id: 'ui', name: 'ui', logicalPort: 3000, protocol: 'http' },
  ],
}))
let resolve = createRouteResolver(records.filter(record => record.owner.id === 'remote-a'))
const addresses = new IngressAddresses()
const mappings: Record<string, string> = {}
const listeners: Awaited<ReturnType<typeof startRouteIngress>>[] = []
const upstream: Record<string, string> = {
  'remote-a': '127.78.2.2',
  'remote-b': '127.78.2.3',
  local: '127.78.2.1',
}
async function close() {
  await Promise.all(listeners.map(listener => listener.close()))
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void close().finally(() => process.exit(0)))
}
try {
  for (const ownerId of [undefined, ...owners]) {
    const base =
      ownerId === undefined
        ? 'feature.port'
        : ownerId === 'local'
          ? 'feature.local.port'
          : `feature.${ownerId}.ssh`
    for (const named of [false, true]) {
      const hostname = named ? `ui.${base}` : base
      const address = addresses.allocate(hostname)
      mappings[hostname] = address
      // This disposable book is process-local; no restart/persistence claim.
      for (const port of named ? [80] : ownerId === 'local' ? [3000] : [5432, 3000]) {
        listeners.push(
          await startRouteIngress({
            hostname,
            address,
            port,
            protocol: port === 5432 ? 'tcp' : 'http',
            resolve: () =>
              resolve({
                namespace: 'feature.port',
                ownerId,
                service: named ? { name: 'ui' } : { port },
              }),
            // Explicit TEST transport wiring, not product discovery/tunnel management.
            backend: route => ({
              address: upstream[route.owner.id]!,
              port: route.service.logicalPort,
            }),
          })
        )
      }
    }
  }
  console.log(JSON.stringify({ status: 'ready', mappings }))
  let pending = Buffer.alloc(0)
  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, Buffer.from(chunk)])
    let newline: number
    while ((newline = pending.indexOf(10)) !== -1) {
      if (newline > 1024) throw new Error('Command too large')
      const command = JSON.parse(pending.subarray(0, newline).toString())
      pending = pending.subarray(newline + 1)
      if (
        !Array.isArray(command.owners) ||
        command.owners.length > 3 ||
        command.owners.some((id: unknown) => !owners.includes(id as (typeof owners)[number])) ||
        new Set(command.owners).size !== command.owners.length
      )
        throw new Error('Invalid owners')
      resolve = createRouteResolver(
        records.filter(record => command.owners.includes(record.owner.id))
      )
      console.log(JSON.stringify({ status: 'updated', owners: command.owners }))
    }
    if (pending.length > 1024) throw new Error('Command too large')
  }
  if (pending.length) throw new Error('Incomplete command')
} finally {
  await close()
}
