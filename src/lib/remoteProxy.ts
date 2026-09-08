import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { platform } from 'node:os'
import { promisify } from 'node:util'
import { getTraefikBoundPorts, isTraefikRunning, restartTraefik, startTraefik } from './compose.ts'
import { ensureTraefikPorts, getConfiguredPorts, TRAEFIK_NETWORK } from './traefik.ts'
import type { RemoteRouteProxy } from './remoteRouteReconciler.ts'

const exec = promisify(execFile)
const fail = (): never => {
  throw new Error('Invalid remote proxy state')
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function ports(values: readonly number[]): number[] {
  if (
    !Array.isArray(values) ||
    values.length > 4096 ||
    !Array.from(values).every(v => Number.isInteger(v) && v >= 1 && v <= 65535)
  )
    return fail()
  return [...new Set(values)].sort((a, b) => a - b)
}
function privateIP(v: unknown): v is string {
  if (typeof v !== 'string' || !isIPv4(v)) return false
  const [a, b] = v.split('.').map(Number)
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
}
const ipNumber = (v: string) => v.split('.').reduce((n, octet) => n * 256 + Number(octet), 0)

// Only scalar allowlisted fields are projected; never request whole inspect/Config/Env.
const containerFormat =
  '[{{json .Id}},{{json .State.Running}},{{json .State.StartedAt}},{{json .State.Status}},{{len .NetworkSettings.Networks}},{{with index .NetworkSettings.Networks "' +
  TRAEFIK_NETWORK +
  '"}}{{json .NetworkID}},{{json .IPAddress}},{{json .Gateway}}{{else}}null,null,null{{end}},{{json .HostConfig.ExtraHosts}}]'
async function inspect(args: string[]): Promise<unknown[]> {
  try {
    const { stdout } = await exec('docker', args, {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 16 * 1024,
    })
    const value: unknown = JSON.parse(stdout)
    if (!Array.isArray(value)) return fail()
    return value
  } catch {
    return fail()
  }
}
async function container() {
  const value = await inspect([
    'inspect',
    '--type',
    'container',
    '--format',
    containerFormat,
    'port-traefik',
  ])
  const [containerId, running, startedAt, status, count, networkId, peer, gateway, extraHosts] =
    value
  if (
    value.length !== 9 ||
    !id(containerId) ||
    running !== true ||
    status !== 'running' ||
    count !== 1 ||
    !id(networkId) ||
    !privateIP(peer) ||
    !privateIP(gateway) ||
    peer === gateway ||
    typeof startedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(startedAt) ||
    !Number.isFinite(Date.parse(startedAt)) ||
    Date.parse(startedAt) <= 0
  )
    return fail()
  return { containerId, startedAt, networkId, peer, gateway, extraHosts }
}

/** Prepare only: no listeners, route publication, DNS resolution or privileged helpers. */
export async function prepareRemoteProxy(
  requiredPorts: readonly number[]
): Promise<RemoteRouteProxy> {
  const requested = ports(requiredPorts)
  const os = platform()
  if (os !== 'linux' && os !== 'darwin') return fail()
  const changed = await ensureTraefikPorts(requested)
  const expected = ports([80, ...requested, ...ports(await getConfiguredPorts())])
  const bindingsMatch = async () =>
    JSON.stringify(ports(await getTraefikBoundPorts())) === JSON.stringify(expected)
  if (!(await isTraefikRunning())) await startTraefik()
  else if (changed || !(await bindingsMatch())) await restartTraefik()
  if (!(await bindingsMatch())) return fail()
  const state = await container()
  const format =
    '[{{json .Id}},{{json .Name}},{{json .Driver}},{{json .Scope}},{{json .Internal}},{{json .IPAM.Config}},{{with index .Containers "' +
    state.containerId +
    '"}}{{json .IPv4Address}}{{else}}null{{end}}]'
  const network = await inspect(['network', 'inspect', '--format', format, TRAEFIK_NETWORK])
  const [networkId, name, driver, scope, internal, configs, member] = network
  if (
    network.length !== 7 ||
    networkId !== state.networkId ||
    name !== TRAEFIK_NETWORK ||
    driver !== 'bridge' ||
    scope !== 'local' ||
    internal !== false ||
    !Array.isArray(configs) ||
    configs.length !== 1
  )
    return fail()
  const config = configs[0] as { Subnet?: unknown; Gateway?: unknown } | null
  if (!config || config.Gateway !== state.gateway || typeof config.Subnet !== 'string')
    return fail()
  const [base, prefixText, extra] = config.Subnet.split('/')
  const prefix = Number(prefixText)
  if (
    !base ||
    !privateIP(base) ||
    !prefixText ||
    !/^\d+$/.test(prefixText) ||
    extra !== undefined ||
    prefix < 8 ||
    prefix > 30
  )
    return fail()
  const size = 2 ** (32 - prefix)
  const lower = ipNumber(base)
  if (
    lower % size !== 0 ||
    ![state.gateway, state.peer].every(
      ip => ipNumber(ip) > lower && ipNumber(ip) < lower + size - 1
    ) ||
    member !== `${state.peer}/${prefix}`
  )
    return fail()
  if (
    os === 'darwin' &&
    (!Array.isArray(state.extraHosts) ||
      !state.extraHosts.includes('host.docker.internal:host-gateway') ||
      state.extraHosts.filter(v => typeof v === 'string' && /^host\.docker\.internal[:=]/.test(v))
        .length !== 1)
  )
    return fail()
  // A replacement/restart during inspection must not produce a usable lease descriptor.
  if (JSON.stringify(await container()) !== JSON.stringify(state)) return fail()
  const bind: RemoteRouteProxy['bind'] =
    os === 'darwin'
      ? { kind: 'loopback' }
      : { kind: 'docker-bridge', address: state.gateway, peerAddress: state.peer }
  const targetAddress = os === 'darwin' ? 'host.docker.internal' : state.gateway
  return {
    id: createHash('sha256')
      .update(
        JSON.stringify([
          state.containerId,
          state.startedAt,
          state.networkId,
          state.peer,
          bind,
          targetAddress,
        ])
      )
      .digest('hex'),
    bind,
    targetAddress,
  }
}
