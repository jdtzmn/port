import type { RemoteRouteAddress, RemoteRouteSnapshot } from './snapshot.ts'

export function remoteRouteUrl(route: RemoteRouteAddress): string {
  const authority = route.port === 80 ? route.hostname : `${route.hostname}:${route.port}`
  return `http://${authority}`
}

export function describeRemoteRoute(route: RemoteRouteAddress): string {
  const address = `${route.hostname}:${route.port}`
  if (route.availability === 'ready') return `${address} (ready)`
  if (route.availability === 'unavailable') return `${address} (unavailable)`
  const alternatives = route.alternatives
    ?.map(alternative => `${alternative.hostname}:${alternative.port}`)
    .join(', ')
  return `${address} (conflict${alternatives ? `; use ${alternatives}` : ''})`
}

/** HTTP routes are browser URLs; TLS-SNI entries remain visible through status only. */
export function remoteHttpRoutes(
  view: RemoteRouteSnapshot,
  serviceName?: string
): RemoteRouteAddress[] {
  return view.routes.filter(
    route =>
      route.transport === 'http' &&
      (serviceName === undefined || route.hostname.startsWith(`${serviceName}.`))
  )
}
