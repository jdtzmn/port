const VALUE_OPTIONS = new Set('bcEeFiJlmp')
const CONFIG_OPTIONS = new Set([
  'identityfile',
  'identitiesonly',
  'identityagent',
  'user',
  'hostname',
  'port',
  'proxyjump',
  'proxycommand',
  'stricthostkeychecking',
  'userknownhostsfile',
  'globalknownhostsfile',
  'batchmode',
  'preferredauthentications',
  'passwordauthentication',
  'pubkeyauthentication',
  'kbdinteractiveauthentication',
  'connecttimeout',
  'connectionattempts',
])

function isReviewedConfigOption(value: string): boolean {
  const match = /^([a-z]+)(?:[ \t]*=[ \t]*|[ \t]+)(\S[\s\S]*)$/i.exec(value)
  return match !== null && CONFIG_OPTIONS.has(match[1]!.toLowerCase())
}

/**
 * Classify argv only; null means ordinary, unchanged SSH fallback, not an error.
 * Never rebuild foreground argv from this result or interpret values as shell text.
 * Eligibility also requires effective-config validation and a real TTY at the caller.
 */
export function classifySshInvocation(args: readonly string[]): { destination: string } | null {
  // eslint-disable-next-line no-control-regex -- Intentionally reject control bytes in SSH argv.
  if (args.some(arg => /[\x00-\x08\x0a-\x1f\x7f]/.test(arg))) return null

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--') {
      const destination = args[index + 1]
      return index + 2 === args.length && isDestination(destination) ? { destination } : null
    }
    if (!arg.startsWith('-')) {
      return index === args.length - 1 && isDestination(arg) ? { destination: arg } : null
    }
    // Only repeated verbosity/TTY flags may be clustered; mixed clusters fall back.
    if (/^-(?:[46AaCqxXY]|v+|t+)$/.test(arg)) continue

    const option = arg[1]
    if (!option || (!VALUE_OPTIONS.has(option) && option !== 'o')) return null
    const value = arg.length > 2 ? arg.slice(2) : args[++index]
    // An option-looking separate value is ambiguous: leave it to ordinary SSH.
    if (!value || value.startsWith('-') || !value.trim()) return null
    if (option === 'o' && !isReviewedConfigOption(value)) return null
  }
  return null
}

function isDestination(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !/^[-]/.test(value) && !/\s/.test(value)
}

const CONFIG_POLICY: Readonly<Record<string, readonly string[]>> = {
  controlmaster: ['false', 'no'],
  controlpersist: ['no', '0'],
  controlpath: ['none'],
  remotecommand: ['none'],
  sessiontype: ['default'],
  stdinnull: ['no'],
  forkafterauthentication: ['no'],
  requesttty: ['auto', 'yes', 'force'],
}

/**
 * Validate effective `ssh -G` stdout, not a config file. Unknown well-formed
 * fields are expected; policy fields must be unique and present (except controlpath).
 * The caller must enforce a real TTY, successful subprocess exit, timeout and
 * output cap. `ssh -G` can rerun Match exec: evaluating config is NOT side-effect-free.
 * This pure predicate neither executes SSH nor makes config evaluation safe.
 */
export function isEligibleSshConfig(output: string): boolean {
  // eslint-disable-next-line no-control-regex -- Reject control bytes while allowing line delimiters.
  if (!output || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(output)) return false
  const seen = new Set<string>()
  const lines = output.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  for (const line of lines) {
    const match = /^([a-z][a-z0-9]*)[ \t]+(\S[^\r\n]*)$/i.exec(line)
    if (!match) return false
    const key = match[1]!.toLowerCase()
    if (!Object.hasOwn(CONFIG_POLICY, key)) continue
    if (seen.has(key)) return false
    seen.add(key)
    if (!CONFIG_POLICY[key]!.includes(match[2]!.toLowerCase())) return false
  }
  return Object.keys(CONFIG_POLICY).every(key => key === 'controlpath' || seen.has(key))
}
