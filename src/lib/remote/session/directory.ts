const REMOTE_SESSION_DIRECTORY = /^\/tmp\/port-ssh-[A-Za-z0-9]{6}$(?![\s\S])/

/** Lexical boundary shared by private SSH commands, control RPC, and filesystem validation. */
export function isRemoteSessionDirectory(value: unknown): value is string {
  return typeof value === 'string' && REMOTE_SESSION_DIRECTORY.test(value)
}
