import { SUPPORTED_SHELLS, type Shell } from '../lib/shell.ts'
import * as output from '../lib/output.ts'

/**
 * Shell completion script generator for the `port` CLI.
 *
 * Generates shell-native completion scripts that:
 * - Complete subcommand names and aliases
 * - Complete per-command flags
 * - Dynamically complete branch names via `command port list --names`
 *   (uses `command` to bypass the shell-hook wrapper function)
 */
export function completion(shell: string): void {
  if (!SUPPORTED_SHELLS.includes(shell as Shell)) {
    output.error(`Unsupported shell: ${shell}`)
    output.info(`Supported shells: ${SUPPORTED_SHELLS.join(', ')}`)
    process.exit(1)
  }

  let script: string
  switch (shell) {
    case 'bash':
      script = generateBashCompletion()
      break
    case 'zsh':
      script = generateZshCompletion()
      break
    case 'fish':
      script = generateFishCompletion()
      break
    default:
      script = ''
  }

  process.stdout.write(script + '\n')
}

// -- Subcommands and their metadata ------------------------------------------

/** All subcommands (name + aliases) */
const SUBCOMMANDS = [
  'init',
  'onboard',
  'install',
  'list',
  'ls',
  'status',
  'enter',
  'exit',
  'shell-hook',
  'urls',
  'up',
  'down',
  'remove',
  'rm',
  'uninstall',
  'compose',
  'dc',
  'run',
  'kill',
  'cleanup',
  'completion',
  'help',
]

/** Commands that take a branch name as their first argument */
const BRANCH_COMMANDS = ['enter', 'remove', 'rm']

/** Per-command flags */
const COMMAND_FLAGS: Record<string, string[]> = {
  onboard: ['--md'],
  install: ['-y', '--yes', '--dns-ip', '--domain'],
  list: ['-n', '--names'],
  down: ['-y', '--yes'],
  remove: ['-f', '--force', '--keep-branch'],
  rm: ['-f', '--force', '--keep-branch'],
  uninstall: ['-y', '--yes', '--domain'],
}

/** Global flags available on all commands */
const GLOBAL_FLAGS = ['-V', '--version', '-h', '--help']

// -- Bash completion ---------------------------------------------------------

function generateBashCompletion(): string {
  const subcommandList = SUBCOMMANDS.join(' ')
  const branchCommands = BRANCH_COMMANDS.join('|')
  const globalFlagList = GLOBAL_FLAGS.join(' ')

  // Build the per-command flag cases
  const flagCases = Object.entries(COMMAND_FLAGS)
    .map(
      ([cmd, flags]) =>
        '      ' + cmd + ') COMPREPLY=($(compgen -W "' + flags.join(' ') + '" -- "$cur")) ;;'
    )
    .join('\n')

  const lines = [
    '# bash completion for port',
    '# Install: source <(port completion bash)',
    '',
    '_port_completions() {',
    '  local cur prev cword words',
    '  # Use _init_completion if available, otherwise fall back to manual parsing',
    '  if declare -f _init_completion >/dev/null 2>&1; then',
    '    _init_completion || return',
    '  else',
    '    COMPREPLY=()',
    '    cur="${COMP_WORDS[COMP_CWORD]}"',
    '    prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '    cword=$COMP_CWORD',
    '    words=("${COMP_WORDS[@]}")',
    '  fi',
    '',
    '  local subcommands="' + subcommandList + '"',
    '  local global_flags="' + globalFlagList + '"',
    '',
    '  # If completing the first argument, offer subcommands + branch names',
    '  if [[ $cword -eq 1 ]]; then',
    '    local branches',
    '    branches="$(command port list --names 2>/dev/null)"',
    '    COMPREPLY=($(compgen -W "$subcommands $global_flags $branches" -- "$cur"))',
    '    return',
    '  fi',
    '',
    '  # Per-command flag completion (check before branch completion)',
    '  if [[ "$cur" == -* ]]; then',
    '    case "${words[1]}" in',
    flagCases,
    '      *) COMPREPLY=($(compgen -W "$global_flags" -- "$cur")) ;;',
    '    esac',
    '    return',
    '  fi',
    '',
    '  # If the previous word is a branch-accepting command, offer branch names',
    '  case "$prev" in',
    '    ' + branchCommands + ')',
    '      local branches',
    '      branches="$(command port list --names 2>/dev/null)"',
    '      COMPREPLY=($(compgen -W "$branches" -- "$cur"))',
    '      return',
    '      ;;',
    '  esac',
    '',
    '  # shell-hook takes a shell name',
    '  if [[ "${words[1]}" == "shell-hook" && $cword -eq 2 ]]; then',
    '    COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))',
    '    return',
    '  fi',
    '',
    '  # completion takes a shell name',
    '  if [[ "${words[1]}" == "completion" && $cword -eq 2 ]]; then',
    '    COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))',
    '    return',
    '  fi',
    '}',
    '',
    'complete -F _port_completions port',
  ]

  return lines.join('\n')
}

// -- Zsh completion ----------------------------------------------------------

function generateZshCompletion(): string {
  const quotedSubcommands = SUBCOMMANDS.map(s => "'" + s + "'").join(' ')
  const quotedGlobalFlags = GLOBAL_FLAGS.map(f => "'" + f + "'").join(' ')
  const branchCommands = BRANCH_COMMANDS.join('|')

  // Build the per-command flag cases
  const flagCases = Object.entries(COMMAND_FLAGS)
    .map(([cmd, flags]) => {
      const flagList = flags.map(f => "'" + f + "'").join(' ')
      return '      ' + cmd + ') compadd -- ' + flagList + ' ;;'
    })
    .join('\n')

  const lines = [
    '#compdef port',
    '# zsh completion for port',
    '# Install: source <(port completion zsh)',
    '',
    '_port() {',
    '  local -a subcommands=(' + quotedSubcommands + ')',
    '  local -a global_flags=(' + quotedGlobalFlags + ')',
    '',
    '  # Completing first argument: subcommands + branch names',
    '  if (( CURRENT == 2 )); then',
    '    local -a branches',
    '    branches=(${(f)"$(command port list --names 2>/dev/null)"})',
    '    compadd -- "${subcommands[@]}" "${global_flags[@]}" "${branches[@]}"',
    '    return',
    '  fi',
    '',
    '  local cmd="${words[2]}"',
    '',
    '  # Per-command flag completion (check before branch completion)',
    '  if [[ "${words[CURRENT]}" == -* ]]; then',
    '    case "$cmd" in',
    flagCases,
    '      *) compadd -- "${global_flags[@]}" ;;',
    '    esac',
    '    return',
    '  fi',
    '',
    '  # Branch-accepting commands: complete with branch names',
    '  case "$cmd" in',
    '    ' + branchCommands + ')',
    '      if (( CURRENT == 3 )); then',
    '        local -a branches',
    '        branches=(${(f)"$(command port list --names 2>/dev/null)"})',
    '        compadd -- "${branches[@]}"',
    '        return',
    '      fi',
    '      ;;',
    '  esac',
    '',
    '  # shell-hook / completion take a shell name',
    '  if [[ "$cmd" == "shell-hook" || "$cmd" == "completion" ]] && (( CURRENT == 3 )); then',
    '    compadd -- bash zsh fish',
    '    return',
    '  fi',
    '}',
    '',
    'compdef _port port',
  ]

  return lines.join('\n')
}

// -- Fish completion ---------------------------------------------------------

function generateFishCompletion(): string {
  const lines: string[] = [
    '# fish completion for port',
    '# Install: port completion fish | source',
    '',
    '# Disable file completions by default',
    'complete -c port -f',
    '',
    '# Helper: check if no subcommand has been given yet',
    'function __port_no_subcommand',
    '  set -l cmds ' + SUBCOMMANDS.join(' '),
    '  set -l tokens (commandline -opc)',
    '  for t in $tokens[2..]',
    '    if contains -- $t $cmds',
    '      return 1',
    '    end',
    '  end',
    '  return 0',
    'end',
    '',
    '# Helper: check if current subcommand matches',
    'function __port_using_subcommand',
    '  set -l cmd $argv[1]',
    '  set -l cmds ' + SUBCOMMANDS.join(' '),
    '  set -l tokens (commandline -opc)',
    '  for t in $tokens[2..]',
    '    if test "$t" = "$cmd"',
    '      return 0',
    '    else if contains -- $t $cmds',
    '      return 1',
    '    end',
    '  end',
    '  return 1',
    'end',
    '',
    '# Subcommand completions (when no subcommand given yet)',
  ]

  // Static subcommand completions
  const descriptions: Record<string, string> = {
    init: 'Initialize .port/ directory',
    onboard: 'Show recommended workflow guide',
    install: 'Set up DNS for wildcard domain',
    list: 'List worktrees and services',
    ls: 'List worktrees and services',
    status: 'Show per-service status',
    enter: 'Enter a worktree by branch name',
    exit: 'Exit the current worktree',
    'shell-hook': 'Print shell integration code',
    urls: 'Show service URLs',
    up: 'Start docker-compose services',
    down: 'Stop docker-compose services',
    remove: 'Remove a worktree',
    rm: 'Remove a worktree',
    uninstall: 'Remove DNS configuration',
    compose: 'Run docker compose',
    dc: 'Run docker compose',
    run: 'Run a host process with Traefik',
    kill: 'Stop host services',
    cleanup: 'Delete archived branches',
    completion: 'Generate shell completion script',
    help: 'Display help',
  }

  for (const cmd of SUBCOMMANDS) {
    const desc = descriptions[cmd] ?? cmd
    lines.push("complete -c port -n __port_no_subcommand -a '" + cmd + "' -d '" + desc + "'")
  }

  lines.push('')
  lines.push('# Branch name completions when no subcommand given (port <branch>)')
  lines.push(
    "complete -c port -n __port_no_subcommand -a '(command port list --names 2>/dev/null)' -d 'branch'"
  )

  // Branch completions for enter, remove, rm
  lines.push('')
  lines.push('# Branch name completions for branch-accepting commands')
  for (const cmd of BRANCH_COMMANDS) {
    lines.push(
      "complete -c port -n '__port_using_subcommand " +
        cmd +
        "' -a '(command port list --names 2>/dev/null)' -d 'branch'"
    )
  }

  // Per-command flags
  lines.push('')
  lines.push('# Per-command flag completions')
  for (const [cmd, flags] of Object.entries(COMMAND_FLAGS)) {
    for (const flag of flags) {
      if (flag.startsWith('--')) {
        lines.push(
          "complete -c port -n '__port_using_subcommand " + cmd + "' -l '" + flag.slice(2) + "'"
        )
      } else if (flag.startsWith('-')) {
        lines.push(
          "complete -c port -n '__port_using_subcommand " + cmd + "' -s '" + flag.slice(1) + "'"
        )
      }
    }
  }

  // shell-hook and completion take shell names
  lines.push('')
  lines.push('# Shell name completions for shell-hook and completion commands')
  for (const cmd of ['shell-hook', 'completion']) {
    lines.push("complete -c port -n '__port_using_subcommand " + cmd + "' -a 'bash zsh fish'")
  }

  return lines.join('\n')
}
