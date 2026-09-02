export type CommandGuideCategory = 'recommended' | 'additional' | 'useful'

export interface CommandGuideEntry {
  command: string
  cliName?: string
  aliases?: string[]
  category: CommandGuideCategory
  description: string
  how: string
  why: string
  agentGuidance: string
  privileged?: boolean
  destructive?: boolean
}

export const PORT_SUMMARY =
  'Port is a CLI for managing git worktrees that makes it easy to create, enter, and tear down parallel working copies of your repo. When those worktrees run Docker Compose services, Port can automatically stand up a Traefik reverse proxy so every worktree can bind the same ports without conflicts — each accessed via its own hostname (e.g., `feature-1.port:3000`).'

export const COMMAND_GUIDE: CommandGuideEntry[] = [
  {
    command: 'port init',
    category: 'recommended',
    description: 'Initialize `.port/` directory structure',
    how: 'Run in your repository root if setup has not been done yet (check with port status first).',
    why: 'Creates .port config, hooks, and worktree directories.',
    agentGuidance: 'Use during first-time setup before starting services in a repository.',
  },
  {
    command: 'port onboard',
    category: 'additional',
    description: 'Print recommended workflow and command usage guide',
    how: 'Run when a user wants a guided overview, or use `port onboard --md` to regenerate ONBOARD.md.',
    why: 'Shows the recommended Port workflow from the shared command metadata.',
    agentGuidance:
      'Prefer this when introducing Port to a repository or checking the canonical workflow.',
  },
  {
    command: 'port install',
    category: 'recommended',
    description: 'Set up DNS and the shell hook for the wildcard domain (default from config)',
    how: 'Run once per machine (or when changing domain/IP). Add --no-shell-hook to skip the shell profile change, or --shell-hook-only to skip DNS.',
    why: 'Configures wildcard DNS so branch domains resolve locally, and installs the shell hook so port enter/exit can change directories.',
    agentGuidance:
      'Ask before running because this can require administrator privileges and changes machine DNS.',
    privileged: true,
  },
  {
    command: 'port list',
    cliName: 'list',
    aliases: ['ls'],
    category: 'useful',
    description: 'Print worktree names, one per line',
    how: 'Run when you need a compact list of known worktrees. Alias: port ls.',
    why: 'Shows which worktrees Port knows about without changing state.',
    agentGuidance: 'Safe read-only inspection command; prefer before cleanup or branch selection.',
  },
  {
    command: 'port status',
    category: 'recommended',
    description: 'Show service status across all worktrees',
    how: 'Run anytime when you need service-level visibility.',
    why: 'Shows running/stopped services across all worktrees.',
    agentGuidance: 'Use before changing service state or diagnosing routing problems.',
  },
  {
    command: 'port shell-hook <bash|zsh|fish>',
    cliName: 'shell-hook',
    category: 'recommended',
    description: 'Print shell integration code for automatic cd',
    how: 'Usually installed for you by port install; otherwise add eval "$(port shell-hook bash)" to your shell profile.',
    why: 'Enables port enter/exit to change your shell directory automatically.',
    agentGuidance:
      'Recommend this for interactive users; without it, enter/exit prints cd commands.',
  },
  {
    command: 'port completion <bash|zsh|fish>',
    category: 'additional',
    description: 'Generate shell completion script for tab completion',
    how: 'Run once to generate shell completion script (bash, zsh, or fish).',
    why: 'Enables tab completion for port commands and options.',
    agentGuidance: 'Optional convenience setup; safe because it only prints shell code.',
  },
  {
    command: 'port enter <branch>',
    category: 'recommended',
    description: 'Enter a worktree explicitly (including command names)',
    how: 'Use explicit enter, especially when branch names match commands or are already checked out elsewhere.',
    why: 'Creates or enters the branch worktree and changes into it, reusing an existing checked-out worktree when needed.',
    agentGuidance:
      'Prefer explicit enter when branch names collide with commands such as status, install, or remove.',
  },
  {
    command: 'port <branch>',
    cliName: '<branch>',
    category: 'additional',
    description: 'Enter a worktree (creates if it does not exist)',
    how: 'Use as shorthand when the branch name does not match a Port command.',
    why: 'Creates or enters a branch worktree quickly.',
    agentGuidance:
      'Avoid this shorthand when the branch name might collide with a command; use port enter instead.',
  },
  {
    command: 'port exit',
    category: 'recommended',
    description: 'Exit the current worktree and return to repo root',
    how: 'Run to return to the repository root from a worktree.',
    why: 'Changes back to the repo root and clears PORT_WORKTREE env var.',
    agentGuidance:
      'Safe navigation command. Shell integration may be required to change the caller shell directory.',
  },
  {
    command: 'port up [services...]',
    category: 'recommended',
    description: 'Start docker-compose services in current worktree',
    how: 'Run inside a worktree after entering it. Omit services to start everything, or pass specific service names to start a subset and their dependencies.',
    why: 'Starts services and wires routing through Traefik.',
    agentGuidance:
      'Use inside a Port worktree after setup; then run port urls to inspect service URLs.',
  },
  {
    command: 'port down [services...]',
    category: 'recommended',
    description: 'Stop docker-compose services and host processes selectively',
    how: 'Run in a worktree when you want to stop everything or selectively remove a subset of services while leaving the rest running.',
    why: 'Stops services and removes the selected containers without tearing down the whole worktree.',
    agentGuidance:
      'Ask if stopping services may interrupt the user; safer than removing the whole worktree.',
  },
  {
    command: 'port urls [service]',
    category: 'recommended',
    description: 'Show service URLs for the current worktree',
    how: 'Run in a worktree or repository root.',
    why: 'Shows the exact branch URLs to open and share.',
    agentGuidance: 'Read-only; use after port up or port run to find the right URL.',
  },
  {
    command: 'port open',
    category: 'recommended',
    description: 'Re-run the `post-up` hook in the current repo/worktree context',
    how: 'Run after port up [services...] if you want to trigger your post-up workflow manually.',
    why: 'Re-runs the post-up hook (for example, open the browser to your branch URL).',
    agentGuidance:
      'Use when the user wants the post-up workflow repeated without restarting services.',
  },
  {
    command: 'port compose [args...]',
    cliName: 'compose',
    aliases: ['dc'],
    category: 'additional',
    description: 'Run docker compose with automatic -f flags for this worktree',
    how: 'Alias: port dc. Run inside a worktree to run docker compose commands.',
    why: "Automatically applies -f flags for the worktree's compose files.",
    agentGuidance: 'Use instead of raw docker compose when operating on a Port-managed worktree.',
  },
  {
    command: 'port run <port> -- <command...>',
    cliName: 'run',
    category: 'useful',
    description: 'Run a host process with Traefik routing',
    how: 'Run inside a worktree for non-Docker development servers that honor the PORT environment variable.',
    why: 'Starts a host process on an available port and routes the logical port through Traefik.',
    agentGuidance:
      'Confirm the command respects PORT; use port kill to stop services started this way.',
  },
  {
    command: 'port kill [port]',
    category: 'useful',
    description: 'Stop host services (optionally by logical port)',
    how: 'Run when you need to stop host processes started with port run.',
    why: 'Stops host services listed in Port state, optionally narrowed to one logical port.',
    agentGuidance: 'Ask before stopping a process that may be in active use.',
  },
  {
    command: 'port hook [hook-name]',
    category: 'additional',
    description: 'Re-run a hook script in the current worktree',
    how: 'Use `port hook --list` to inspect hooks, or `port hook <hook-name>` to run one.',
    why: 'Lets users inspect or manually re-run Port lifecycle hooks.',
    agentGuidance: 'List hooks first when unsure; hooks can execute project-defined scripts.',
  },
  {
    command: 'port rename <branch>',
    cliName: 'rename',
    aliases: ['mv'],
    category: 'recommended',
    description: 'Rename the current worktree and branch in place',
    how: 'Run inside a worktree after stopping its services. Alias: port mv <branch>.',
    why: 'Renames the current worktree and branch while keeping Port state aligned.',
    agentGuidance: 'Ask first because this changes Git branch/worktree names.',
  },
  {
    command: 'port remove <branch>',
    cliName: 'remove',
    aliases: ['rm'],
    category: 'recommended',
    description: 'Remove worktree, archive branch, clean up Docker resources',
    how: 'Use after a branch is done.',
    why: 'Stops services, removes worktree, and archives the local branch.',
    agentGuidance: 'Ask before running; use --keep-branch if the local branch should remain.',
    destructive: true,
  },
  {
    command: 'port prune',
    category: 'additional',
    description: 'Remove worktrees for branches that have been merged',
    how: 'Start with `port prune --dry-run`; use `--force` only after confirming candidates.',
    why: 'Cleans up worktrees whose branches have already been merged.',
    agentGuidance: 'Always prefer --dry-run first because this removes worktrees.',
    destructive: true,
  },
  {
    command: 'port cleanup',
    category: 'useful',
    description: 'Delete archived branches created by port remove',
    how: 'Run after reviewing archived branches. Use --cleanup-images only when explicitly requested.',
    why: 'Deletes archived local branches created by port remove and can optionally clean images.',
    agentGuidance:
      'Ask before running; Docker image cleanup is opt-in and can remove shared cache layers.',
    destructive: true,
  },
  {
    command: 'port uninstall',
    category: 'additional',
    description: 'Remove DNS configuration for wildcard domain used by this repo',
    how: 'Run when the user explicitly wants to remove Port DNS setup for a domain.',
    why: 'Removes machine-level DNS configuration and the shell hook created by port install.',
    agentGuidance:
      'Ask before running because this can require administrator privileges and changes machine DNS.',
    privileged: true,
    destructive: true,
  },
]

export function guideEntriesByCategory(category: CommandGuideCategory): CommandGuideEntry[] {
  return COMMAND_GUIDE.filter(entry => entry.category === category)
}

export function cliCommandName(entry: CommandGuideEntry): string | undefined {
  if (entry.cliName === '<branch>') {
    return undefined
  }

  return entry.cliName ?? entry.command.replace(/^port\s+/, '').split(/\s+/)[0]
}
