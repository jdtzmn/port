#!/usr/bin/env bun

import { Command } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { init } from './commands/init.ts'
import { list } from './commands/list.ts'
import { install } from './commands/install.ts'
import { enter } from './commands/enter.ts'
import { exit } from './commands/exit.ts'
import { up } from './commands/up.ts'
import { down } from './commands/down.ts'
import { remove } from './commands/remove.ts'
import { uninstall } from './commands/uninstall.ts'
import { compose } from './commands/compose.ts'
import { run } from './commands/run.ts'
import { handleCliError } from './lib/cli.ts'
import { kill } from './commands/kill.ts'
import { status } from './commands/status.ts'
import { cleanup } from './commands/cleanup.ts'
import { prune } from './commands/prune.ts'
import { urls } from './commands/urls.ts'
import { onboard } from './commands/onboard.ts'
import { shellHook } from './commands/shell-hook.ts'
import { completion } from './commands/completion.ts'
import { hook } from './commands/hook.ts'
import { open } from './commands/open.ts'
import { rename } from './commands/rename.ts'
import {
  isReservedCommand,
  shouldAutoRegisterWorktree,
  shouldSkipEarlyWork,
} from './lib/commands.ts'
import { ensureCurrentWorktreeRegistered } from './lib/worktreeRegistration.ts'
import { detectWorktree } from './lib/worktree.ts'
import { branchExists } from './lib/git.ts'
import { loadConfig, configExists } from './lib/config.ts'
import * as output from './lib/output.ts'

export const program = new Command()
program.enablePositionalOptions()

/**
 * Join variadic branch argument tokens into a single branch name.
 *
 * Commander collects bare words after `port` / `port enter` as separate argv
 * entries (e.g. `port my feature` -> ['my', 'feature']). A quoted argument
 * (`port "my feature"`) arrives as a single entry that already contains the
 * space. In both cases we join with a single space so the branch name is
 * reconstructed identically, then defer hostname-safe sanitization to the
 * worktree layer.
 *
 * @param parts - Variadic positional tokens from Commander (may be undefined)
 * @returns The joined branch name, or undefined when no tokens were provided
 */
export function joinBranchArgs(parts: string[] | undefined): string | undefined {
  if (!parts || parts.length === 0) {
    return undefined
  }
  return parts.join(' ')
}

function getCliVersion(): string {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const packageJsonRaw = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
async function maybeWarnCommandBranchCollision(): Promise<void> {
  const token = process.argv[2]

  if (!token || token.startsWith('-') || shouldSkipEarlyWork(token)) {
    return
  }

  if (!isReservedCommand(token)) {
    return
  }

  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    return
  }

  if (await branchExists(repoRoot, token)) {
    output.dim(`Hint: branch "${token}" matches a command. Use "port enter ${token}".`)
  }
}

program
  .name('port')
  .description('Manage git worktrees — run parallel Docker Compose stacks without port conflicts')
  .version(getCliVersion())

// port init
program
  .command('init')
  .description('Initialize .port/ directory in the current project')
  .action(init)

// port onboard
program
  .command('onboard')
  .description('Show recommended Port workflow and command guide')
  .option('--md', 'Write an ONBOARD.md file to the repo root')
  .action(onboard)

// port install
program
  .command('install')
  .description('Set up DNS and the shell hook for the wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option(
    '--dns-ip <address>',
    'IP address wildcard domains should resolve to (default: 127.0.0.1)'
  )
  .option('--domain <domain>', 'Domain suffix to configure (default: config domain or port)')
  .option('--no-shell-hook', 'Skip adding the shell hook to your shell profile')
  .option('--shell-hook-only', 'Only add the shell hook, skipping DNS setup')
  .action(install)

// port list
program.command('list').alias('ls').description('Print worktree names, one per line').action(list)

// port status
program.command('status').description('Show service status across all worktrees').action(status)

// port enter <branch...>
// Variadic so bare multi-word names (`port enter my feature`) are joined into a
// single branch name rather than being truncated to the first word.
program
  .command('enter <branch...>')
  .description('Enter a worktree by branch name (works even for command-name branches)')
  .action(async (branchParts: string[]) => {
    const branch = joinBranchArgs(branchParts)
    if (!branch) {
      program.help()
      return
    }
    await enter(branch)
  })

// port exit
program
  .command('exit')
  .description('Exit the current worktree and return to the repository root')
  .action(async () => {
    await exit()
  })

// port shell-hook <shell>
program
  .command('shell-hook <shell>')
  .description('Print shell integration code for automatic cd (bash, zsh, or fish)')
  .action(shellHook)

// port urls [service]
program
  .command('urls [service]')
  .description('Show service URLs for the current worktree')
  .action(urls)

// port up
program
  .command('up [services...]')
  .description('Start docker-compose services in the current worktree')
  .action(up)

// port down
program
  .command('down [services...]')
  .description('Stop docker-compose services in the current worktree')
  .option('-y, --yes', 'Skip confirmation prompt for stopping Traefik')
  .action((services: string[] | undefined, options: { yes?: boolean }) =>
    down(services ?? [], options)
  )

// port remove [branch]
program
  .command('remove [branch]')
  .alias('rm')
  .description('Remove a worktree and stop its services')
  .option('-f, --force', 'Skip confirmation prompts')
  .option('--keep-branch', 'Keep the local branch instead of archiving it')
  .option(
    '--cleanup-images',
    'Clean up Docker images without prompting (defaults to interactive prompt with No)'
  )
  .action(
    (
      branch: string | undefined,
      options: { force?: boolean; keepBranch?: boolean; cleanupImages?: boolean }
    ) => remove(branch, options)
  )

// port uninstall
program
  .command('uninstall')
  .description('Remove DNS configuration and shell hook for wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--domain <domain>', 'Domain suffix to remove (default: config domain or port)')
  .option('--no-shell-hook', 'Leave the shell hook in your shell profile')
  .action(uninstall)

// port compose <args>
program
  .command('compose')
  .alias('dc')
  .description('Run docker compose with automatic -f flags for this worktree')
  .allowUnknownOption()
  .allowExcessArguments()
  .argument('[args...]', 'Arguments to pass to docker compose')
  .action(compose)

// port run <port> -- <command...>
program
  .command('run <port>')
  .description('Run a host process with Traefik routing')
  .allowUnknownOption()
  .allowExcessArguments()
  .argument('[command...]', 'Command to run (receives PORT env var)')
  .option('-b, --background', 'Run the process in the background (similar to nohup)')
  .action(async (port: string, command: string[], options: { background?: boolean }) => {
    const portNum = parseInt(port, 10)
    await run(portNum, command, options)
  })

// port kill [port]
program
  .command('kill [port]')
  .description('Stop host services listed in port ls (optionally by logical port)')
  .action(kill)

// port cleanup
program
  .command('cleanup')
  .description('Delete archived branches created by port remove (with confirmation)')
  .option(
    '--cleanup-images',
    'Clean up Docker images (requires explicit opt-in in non-interactive mode)'
  )
  .action(cleanup)

// port prune
program
  .command('prune')
  .description('Remove worktrees for branches that have been merged')
  .option('-n, --dry-run', 'List candidates without removing anything')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--no-fetch', 'Skip git fetch --prune (for offline use)')
  .option('--base <branch>', 'Override default branch detection (e.g., --base develop)')
  .option(
    '--cleanup-images',
    'Clean up Docker images (requires explicit opt-in in non-interactive mode)'
  )
  .action(prune)

// port hook [hook-name]
program
  .command('hook [hook-name]')
  .description('Re-run a hook script in the current worktree')
  .option('-l, --list', 'List available hooks and their status')
  .action(hook)

// port open
program
  .command('open')
  .description('Run the post-up hook in the current repo/worktree context')
  .action(open)

// port rename <branch>
program
  .command('rename <branch>')
  .alias('mv')
  .description('Rename the current worktree and branch')
  .action(async (branch: string) => {
    await rename(branch)
  })

// port completion <shell>
program
  .command('completion <shell>')
  .description('Generate shell completion script (bash, zsh, or fish)')
  .action(completion)

// port <branch> - default command to enter a worktree
// This must be last to act as a catch-all for branch names
program.hook('preAction', async () => {
  await maybeWarnCommandBranchCollision()
})

program
  .argument('[branch...]', 'Branch name to enter (creates worktree if needed)')
  .action(async (branchParts: string[] | undefined) => {
    const branch = joinBranchArgs(branchParts)
    if (branch) {
      // Check if it looks like a command that wasn't matched
      if (isReservedCommand(branch)) {
        program.help()
        return
      }
      await enter(branch)
    } else {
      if (!process.stdout.isTTY) {
        program.help()
        return
      }

      // No argument provided — launch TUI
      try {
        const info = detectWorktree()

        if (!configExists(info.repoRoot)) {
          output.error('Not in a port project. Run `port init` first.')
          process.exit(1)
        }

        const config = await loadConfig(info.repoRoot)
        const startView = 'dashboard'

        // Dynamic import to avoid bundling OpenTUI assets into the main CLI
        const { launchTui } = await import('./tui/index.tsx')
        await launchTui(startView as 'dashboard' | 'worktree', info, config)
      } catch {
        // Not in a git repo — eventually this will show the project list
        output.error('Not in a git repository. Run `port` inside a port project.')
        process.exit(1)
      }
    }
  })

if (import.meta.main) {
  const entryToken = process.argv[2]

  try {
    if (shouldAutoRegisterWorktree(entryToken)) {
      await ensureCurrentWorktreeRegistered()
    }

    await program.parseAsync()
  } catch (error) {
    handleCliError(error)
  }
}
