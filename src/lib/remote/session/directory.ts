const LEGACY_REMOTE_SESSION_DIRECTORY = /^\/tmp\/port-ssh-[A-Za-z0-9]{6}$(?![\s\S])/
const MANAGED_REMOTE_SESSION_DIRECTORY = /^\/tmp\/port-ssh-[a-f0-9]{40,64}$(?![\s\S])/

export function isManagedRemoteSessionDirectory(value: unknown): value is string {
  return typeof value === 'string' && MANAGED_REMOTE_SESSION_DIRECTORY.test(value)
}

/** Lexical boundary shared by private SSH commands, control RPC, and filesystem validation. */
export function isRemoteSessionDirectory(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (LEGACY_REMOTE_SESSION_DIRECTORY.test(value) || isManagedRemoteSessionDirectory(value))
  )
}
