import * as output from '../lib/output.ts'
import { SUPPORTED_SHELLS, type Shell } from '../lib/shell.ts'

/**
 * Generate shell hook code that the user adds to their shell profile.
 *
 * Usage:
 *   eval "$(port shell-hook bash)"   # in ~/.bashrc
 *   eval "$(port shell-hook zsh)"    # in ~/.zshrc
 *   port shell-hook fish | source    # in ~/.config/fish/config.fish
 *
 * The generated function wraps the `port` binary so that commands which
 * change the shell's working directory or environment (enter, exit, and
 * the `port <branch>` shorthand) work transparently.
 *
 * Signaling uses a temp-file sideband: the hook sets __PORT_EVAL (path)
 * and __PORT_SHELL (shell type) in the environment.  The binary writes
 * shell commands to that file when appropriate; other commands ignore it.
 * This avoids maintaining a subcommand list in the hook.
 */
export function shellHook(shell: string): void {
  if (!SUPPORTED_SHELLS.includes(shell as Shell)) {
    output.error(`Unsupported shell: ${shell}`)
    output.info(`Supported shells: ${SUPPORTED_SHELLS.join(', ')}`)
    process.exit(1)
  }

  const hookCode = shell === 'fish' ? generateFishHook() : generatePosixHook(shell)

  // Write to stdout so it can be eval'd
  process.stdout.write(hookCode + '\n')
}

function generatePosixHook(shell: string): string {
  return `port() {
  local __port_eval __port_status __port_cmds
  __port_eval="$(mktemp)"
  __PORT_EVAL="$__port_eval" __PORT_SHELL=${shell} command port "$@"
  __port_status=$?
  __port_cmds="$(cat "$__port_eval" 2>/dev/null)"
  rm -f "$__port_eval"
  if [ $__port_status -eq 0 ] && [ -n "$__port_cmds" ]; then
    eval "$__port_cmds"
  fi
  return $__port_status
}`
}

function generateFishHook(): string {
  return `function port
  set -l __port_eval (mktemp)
  set -lx __PORT_EVAL $__port_eval
  set -lx __PORT_SHELL fish
  command port $argv
  set -l __port_status $status
  set -l __port_cmds (cat $__port_eval 2>/dev/null | string collect)
  rm -f $__port_eval
  if test $__port_status -eq 0; and test -n "$__port_cmds"
    eval $__port_cmds
  end
  return $__port_status
end`
}
