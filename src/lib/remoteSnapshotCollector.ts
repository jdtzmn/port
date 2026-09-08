import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { Registry } from '../types.ts'
import { REGISTRY_FILE } from './registry.ts'
import { loadConfigOrDefault } from './config.ts'
import { isProcessRunning } from './hostService.ts'
import { buildProjectName } from './projectName.ts'
import {
  buildRemoteSnapshot,
  type SafeContainer,
  type SafeHost,
  type WorktreeContext,
} from './remoteSnapshot.ts'

const LIMIT = 1024
const BATCH = 32
const MAX_BYTES = 4 * 1024 * 1024
const DEADLINE_MS = 10_000
const PROJECT_LABEL = 'com.docker.compose.project'
// Deliberately project at the daemon, never retrieve a full inspect document.
const TEMPLATE =
  '{"id":{{json .Id}},"stateRunning":{{json .State.Running}},"labels":{{json .Config.Labels}},"networks":{' +
  '{{range $i, $n := .NetworkSettings.Networks}}{{json $i}}:{"IPAddress":{{json $n.IPAddress}}},{{end}}' +
  '"": {"IPAddress":""}}}'
const fail = (): never => {
  throw new Error('Unable to collect remote snapshot')
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 4096 &&
  !/\p{Cc}/u.test(value)
const validPort = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535

function validateRegistry(value: unknown): Registry {
  if (
    !record(value) ||
    !Array.isArray(value.projects) ||
    (value.hostServices !== undefined && !Array.isArray(value.hostServices))
  )
    return fail()
  const hosts = value.hostServices ?? []
  if (value.projects.length > LIMIT || hosts.length > LIMIT) return fail()
  for (const item of [...value.projects, ...hosts]) {
    if (!record(item) || !validText(item.repo) || !validText(item.branch)) return fail()
  }
  for (const project of value.projects) {
    if (
      !Array.isArray(project.ports) ||
      project.ports.length > 65535 ||
      !project.ports.every(validPort)
    )
      return fail()
  }
  for (const host of hosts) {
    if (
      !Number.isSafeInteger(host.pid) ||
      host.pid < 1 ||
      !validPort(host.logicalPort) ||
      !validPort(host.actualPort)
    )
      return fail()
  }
  return value as unknown as Registry
}

async function readRegistryStrict(): Promise<Registry> {
  let file
  try {
    file = await open(
      REGISTRY_FILE,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return { projects: [], hostServices: [] }
    return fail()
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES) return fail()
    // Fixed allocation and explicit reads also bound files that grow after stat.
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (bytesRead === 0) break
      size += bytesRead
    }
    if (size > MAX_BYTES) return fail()
    return validateRegistry(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)))
    )
  } finally {
    await file.close()
  }
}

function lines(output: string): string[] {
  if (output === '') return []
  if (!output.endsWith('\n')) return fail()
  return output.slice(0, -1).split('\n')
}

function parseContainer(line: string, ids: Set<string>, contexts: Map<string, WorktreeContext>) {
  const value: unknown = JSON.parse(line)
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !ids.delete(value.id) ||
    typeof value.stateRunning !== 'boolean' ||
    !record(value.labels) ||
    !record(value.networks)
  )
    return fail()
  const labels = value.labels
  if (Object.keys(labels).length > 512 || Object.values(labels).some(v => typeof v !== 'string'))
    return fail()
  const project = labels[PROJECT_LABEL]
  const context = contexts.get(value.id)
  if (
    !context ||
    project !== buildProjectName(context.repo, context.branch) ||
    labels['traefik.enable'] !== 'true'
  )
    return fail()
  // The template uses an empty sentinel to avoid trailing-comma JSON.
  delete value.networks['']
  if (Object.keys(value.networks).length > 64) return fail()
  for (const network of Object.values(value.networks)) {
    if (
      !record(network) ||
      typeof network.IPAddress !== 'string' ||
      Object.keys(network).length !== 1
    )
      return fail()
  }
  return {
    id: value.id,
    stateRunning: value.stateRunning,
    labels: labels as Record<string, string>,
    networks: value.networks as SafeContainer['networks'],
    context,
  }
}

/** Read-only collection; any failed Docker observation invalidates the entire result. */
export async function collectRemoteSnapshot(instanceId: string, revision: number) {
  try {
    const registry = await readRegistryStrict()
    const hosts = registry.hostServices ?? []
    if (
      !Array.isArray(registry.projects) ||
      !Array.isArray(hosts) ||
      registry.projects.length > LIMIT ||
      hosts.length > LIMIT
    )
      return fail()
    const contexts = new Map<string, WorktreeContext>()
    for (const { repo, branch } of registry.projects) {
      const key = buildProjectName(repo, branch)
      const previous = contexts.get(key)
      if (previous && (previous.repo !== repo || previous.branch !== branch)) return fail()
      contexts.set(key, { repo, branch, domain: '' })
    }
    const repos = [...new Set([...registry.projects, ...hosts].map(item => item.repo))]
    const domains = new Map<string, string>()
    // Four reads at a time; never fan out over the entire registry.
    for (let i = 0; i < repos.length; i += 4) {
      await Promise.all(
        repos.slice(i, i + 4).map(async repo => {
          domains.set(repo, (await loadConfigOrDefault(repo)).domain)
        })
      )
    }
    for (const context of contexts.values()) context.domain = domains.get(context.repo)!
    const safeHosts: SafeHost[] = hosts.map(host => {
      if (!Number.isSafeInteger(host.pid) || host.pid < 1) return fail()
      return {
        repo: host.repo,
        branch: host.branch,
        pid: host.pid,
        logicalPort: host.logicalPort,
        actualPort: host.actualPort,
        domain: domains.get(host.repo)!,
        // Current HostService stores no identity/start time; this is the existing
        // PID-liveness helper, NOT a guarantee against PID reuse.
        running: isProcessRunning(host.pid),
      }
    })
    const docker: SafeContainer[] = []
    const deadline = Date.now() + DEADLINE_MS
    let bytes = 0
    const query = async (args: string[]): Promise<string> => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return fail()
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          'docker',
          args,
          {
            encoding: 'utf8',
            shell: false,
            timeout: remaining,
            killSignal: 'SIGKILL',
            maxBuffer: MAX_BYTES,
          },
          (error, stdout) => {
            if (error) reject(new Error('Unable to collect remote snapshot'))
            else resolve(stdout)
          }
        )
      })
      bytes += Buffer.byteLength(output)
      if (bytes > MAX_BYTES || Date.now() > deadline) return fail()
      return output
    }
    // Registry projects have no Docker/host discriminator (even ports=[] is
    // registered on enter). Only an actually empty project list can skip Docker.
    if (contexts.size) {
      const seen = new Set<string>()
      const selected = new Map<string, WorktreeContext>()
      const rows = lines(
        await query([
          'ps',
          '--no-trunc',
          '--filter',
          'label=traefik.enable=true',
          '--format',
          '{"id":{{json .ID}},"project":{{json (.Label "com.docker.compose.project")}}}',
        ])
      )
      for (const row of rows) {
        const value: unknown = JSON.parse(row)
        if (
          !record(value) ||
          typeof value.id !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.id) ||
          typeof value.project !== 'string' ||
          value.project.length > 4096 ||
          seen.has(value.id) ||
          seen.size >= LIMIT
        )
          return fail()
        seen.add(value.id)
        const context = contexts.get(value.project)
        // Unknown projects never reach inspect, even though Traefik is enabled.
        if (context) selected.set(value.id, context)
      }
      const ids = [...selected.keys()]
      for (let j = 0; j < ids.length; j += BATCH) {
        const batch = ids.slice(j, j + BATCH)
        const pending = new Set(batch)
        const output = lines(
          await query(['inspect', '--type', 'container', '--format', TEMPLATE, ...batch])
        )
        for (const line of output) docker.push(parseContainer(line, pending, selected))
        if (pending.size) return fail()
      }
    }
    return buildRemoteSnapshot({ instanceId, revision, docker, hosts: safeHosts })
  } catch {
    return fail()
  }
}
