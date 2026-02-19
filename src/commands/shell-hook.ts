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
 * The generated function wraps the `port` binary so that `port enter` and
 * `port exit` can change the current shell's working directory and environment.
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
  if [ "$1" = "enter" ] || [ "$1" = "exit" ]; then
    local __port_output __port_status
    __port_output="$(command port "$@" --shell-helper ${shell})"
    __port_status=$?
    if [ $__port_status -eq 0 ] && [ -n "$__port_output" ]; then
      eval "$__port_output"
    fi
    return $__port_status
  else
    command port "$@"
  fi
}`
}

function generateFishHook(): string {
  return `function port
  if test (count $argv) -gt 0; and begin; test "$argv[1]" = "enter"; or test "$argv[1]" = "exit"; end
    set -l __port_output (command port $argv --shell-helper fish | string collect)
    set -l __port_status $status
    if test $__port_status -eq 0; and test -n "$__port_output"
      eval $__port_output
    end
    return $__port_status
  else
    command port $argv
  end
end`
}
