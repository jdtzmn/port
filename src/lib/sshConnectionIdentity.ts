import { createHash } from 'node:crypto'

/** Conservative addressing identity, not cryptographic host equivalence. */
export interface SshConnectionIdentity {
  hostname: string
  port: number
  user: string
  contextHash: string
}

const contextKeys = [
  'proxyjump',
  'proxycommand',
  'proxyusefdpass',
  'hostkeyalias',
  'bindaddress',
  'bindinterface',
] as const
const selected = new Set<string>(['hostname', 'port', 'user', ...contextKeys])

function token(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= 1024 &&
    !/[\s\p{Cc}]/u.test(value)
  )
}

export function isSshConnectionIdentity(value: unknown): value is SshConnectionIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const identity = value as SshConnectionIdentity
  return (
    Object.keys(identity).sort().join(',') === 'contextHash,hostname,port,user' &&
    token(identity.hostname) &&
    identity.hostname === identity.hostname.toLowerCase() &&
    token(identity.user) &&
    Number.isInteger(identity.port) &&
    identity.port >= 1 &&
    identity.port <= 65535 &&
    typeof identity.contextHash === 'string' &&
    /^[a-f0-9]{64}$/.test(identity.contextHash)
  )
}

/** Only the digest leaves this function; ProxyCommand may contain credentials. */
export function parseSshConnectionIdentity(output: string): SshConnectionIdentity | null {
  if (
    typeof output !== 'string' ||
    Buffer.byteLength(output) > 65536 ||
    /[\p{Cc}]/u.test(output.replace(/[\n\t]/g, ''))
  )
    return null
  const fields = new Map<string, string>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const match = /^([a-z][a-z0-9]*)[ \t]+(.*)$/i.exec(line)
    if (!match) return null
    const key = match[1]!.toLowerCase()
    if (!selected.has(key)) continue // ssh -G emits many unrelated and repeated fields.
    const value = match[2]!
    if (fields.has(key) || !value || Buffer.byteLength(value) > 8192) return null
    if (key !== 'proxycommand' && !token(value)) return null
    if (key === 'proxycommand' && (!value.trim() || /[\p{Cc}]/u.test(value))) return null
    if (key === 'proxyusefdpass' && !['yes', 'no'].includes(value)) return null
    fields.set(key, value)
  }
  const hostname = fields.get('hostname')
  const user = fields.get('user')
  const port = fields.get('port')
  if (!token(hostname) || !token(user) || !port || !/^[0-9]{1,5}$/.test(port)) return null
  const context = contextKeys.map(key => {
    const value = fields.get(key)
    return [
      key,
      value === undefined || value === 'none' ? (key === 'proxyusefdpass' ? 'no' : null) : value,
    ]
  })
  const identity = {
    hostname: hostname.toLowerCase(),
    user,
    port: Number(port),
    contextHash: createHash('sha256').update(JSON.stringify(context)).digest('hex'),
  }
  return isSshConnectionIdentity(identity) ? identity : null
}
