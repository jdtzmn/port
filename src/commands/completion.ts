import { SUPPORTED_SHELLS, type Shell } from '../lib/shell.ts'
import {
  getSubcommands,
  getBranchCommands,
  getShellCommands,
  getCommandFlags,
  getGlobalFlags,
  getCommandDescriptions,
} from '../lib/commands.ts'
import * as output from '../lib/output.ts'

/**
 * Shell completion script generator for the `port` CLI.
 *
 * Generates shell-native completion scripts that:
 * - Complete subcommand names and aliases
 * - Complete per-command flags
 * - Dynamically complete branch names via `command port list --names`
 *   (uses `command` to bypass the shell-hook wrapper function)
 *
 * All command metadata is introspected from the Commander.js program
 * object at generation time — nothing is hard-coded here.
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

// -- Bash completion ---------------------------------------------------------

function generateBashCompletion(): string {
  const subcommands = getSubcommands()
  const branchCommands = getBranchCommands()
  const shellCommands = getShellCommands()
  const commandFlags = getCommandFlags()
  const globalFlags = getGlobalFlags()

  const subcommandList = subcommands.join(' ')
  const branchCommandsPattern = branchCommands.join('|')
  const globalFlagList = globalFlags.join(' ')
  const shellList = SUPPORTED_SHELLS.join(' ')

  // Build the per-command flag cases
  const flagCases = Object.entries(commandFlags)
    .map(
      ([cmd, flags]) =>
        '      ' + cmd + ') COMPREPLY=($(compgen -W "' + flags.join(' ') + '" -- "$cur")) ;;'
    )
    .join('\n')

  // Build shell-name completion blocks
  const shellBlocks = shellCommands
    .map(cmd =>
      [
        '',
        '  # ' + cmd + ' takes a shell name',
        '  if [[ "${words[1]}" == "' + cmd + '" && $cword -eq 2 ]]; then',
        '    COMPREPLY=($(compgen -W "' + shellList + '" -- "$cur"))',
        '    return',
        '  fi',
      ].join('\n')
    )
    .join('')

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
    '    ' + branchCommandsPattern + ')',
    '      local branches',
    '      branches="$(command port list --names 2>/dev/null)"',
    '      COMPREPLY=($(compgen -W "$branches" -- "$cur"))',
    '      return',
    '      ;;',
    '  esac',
    shellBlocks,
    '}',
    '',
    'complete -F _port_completions port',
  ]

  return lines.join('\n')
}

// -- Zsh completion ----------------------------------------------------------

function generateZshCompletion(): string {
  const subcommands = getSubcommands()
  const branchCommands = getBranchCommands()
  const shellCommands = getShellCommands()
  const commandFlags = getCommandFlags()
  const globalFlags = getGlobalFlags()

  const quotedSubcommands = subcommands.map(s => "'" + s + "'").join(' ')
  const quotedGlobalFlags = globalFlags.map(f => "'" + f + "'").join(' ')
  const branchCommandsPattern = branchCommands.join('|')
  const shellList = SUPPORTED_SHELLS.join(' ')

  // Build the per-command flag cases
  const flagCases = Object.entries(commandFlags)
    .map(([cmd, flags]) => {
      const flagList = flags.map(f => "'" + f + "'").join(' ')
      return '      ' + cmd + ') compadd -- ' + flagList + ' ;;'
    })
    .join('\n')

  // Build shell-command condition
  const shellCondition = shellCommands.map(c => '"$cmd" == "' + c + '"').join(' || ')

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
    '    ' + branchCommandsPattern + ')',
    '      if (( CURRENT == 3 )); then',
    '        local -a branches',
    '        branches=(${(f)"$(command port list --names 2>/dev/null)"})',
    '        compadd -- "${branches[@]}"',
    '        return',
    '      fi',
    '      ;;',
    '  esac',
    '',
    '  # Shell-accepting commands: complete with shell names',
    '  if [[ ' + shellCondition + ' ]] && (( CURRENT == 3 )); then',
    '    compadd -- ' + shellList,
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
  const subcommands = getSubcommands()
  const branchCommands = getBranchCommands()
  const shellCommands = getShellCommands()
  const commandFlags = getCommandFlags()
  const descriptions = getCommandDescriptions()

  const lines: string[] = [
    '# fish completion for port',
    '# Install: port completion fish | source',
    '',
    '# Disable file completions by default',
    'complete -c port -f',
    '',
    '# Helper: check if no subcommand has been given yet',
    'function __port_no_subcommand',
    '  set -l cmds ' + subcommands.join(' '),
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
    '  set -l cmds ' + subcommands.join(' '),
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

  for (const cmd of subcommands) {
    const desc = descriptions[cmd] ?? cmd
    lines.push("complete -c port -n __port_no_subcommand -a '" + cmd + "' -d '" + desc + "'")
  }

  lines.push('')
  lines.push('# Branch name completions when no subcommand given (port <branch>)')
  lines.push(
    "complete -c port -n __port_no_subcommand -a '(command port list --names 2>/dev/null)' -d 'branch'"
  )

  // Branch completions for branch-accepting commands
  lines.push('')
  lines.push('# Branch name completions for branch-accepting commands')
  for (const cmd of branchCommands) {
    lines.push(
      "complete -c port -n '__port_using_subcommand " +
        cmd +
        "' -a '(command port list --names 2>/dev/null)' -d 'branch'"
    )
  }

  // Per-command flags
  lines.push('')
  lines.push('# Per-command flag completions')
  for (const [cmd, flags] of Object.entries(commandFlags)) {
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

  // Shell-accepting commands
  lines.push('')
  lines.push('# Shell name completions for shell-accepting commands')
  const shellList = SUPPORTED_SHELLS.join(' ')
  for (const cmd of shellCommands) {
    lines.push("complete -c port -n '__port_using_subcommand " + cmd + "' -a '" + shellList + "'")
  }

  return lines.join('\n')
}
