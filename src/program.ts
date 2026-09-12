#!/usr/bin/env bun

import { Command } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { shouldAutoRegisterWorktree, shouldSkipEarlyWork } from './lib/earlyWork.ts'

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

  if (!(await import('./lib/commands.ts')).isReservedCommand(token)) {
    return
  }

  let repoRoot: string
  try {
    repoRoot = (await import('./lib/worktree.ts')).detectWorktree().repoRoot
  } catch {
    return
  }

  if (await (await import('./lib/git.ts')).branchExists(repoRoot, token)) {
    ;(await import('./lib/output.ts')).dim(
      `Hint: branch "${token}" matches a command. Use "port enter ${token}".`
    )
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
  .action(async () => {
    await (await import('./commands/init.ts')).init()
  })

// port onboard
program
  .command('onboard')
  .description('Show recommended Port workflow and command guide')
  .option('--md', 'Write an ONBOARD.md file to the repo root')
  .action(async (...args) => {
    await (await import('./commands/onboard.ts')).onboard(...args)
  })

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
  .option('--remote-services', 'Enable local routing for ordinary Bash SSH sessions')
  .action(async (...args) => {
    await (await import('./commands/install.ts')).install(...args)
  })

// port list
program
  .command('list')
  .alias('ls')
  .description('Print worktree names, one per line')
  .action(async () => {
    await (await import('./commands/list.ts')).list()
  })

// port status
program
  .command('status')
  .description('Show service status across all worktrees')
  .action(async () => {
    await (await import('./commands/status.ts')).status()
  })

// port doctor
program
  .command('doctor')
  .description('Diagnose Port prerequisites, routing, and project configuration')
  .option('-v, --verbose', 'Show all diagnostic checks')
  .action(async (...args) => {
    await (await import('./commands/doctor.ts')).doctor(...args)
  })

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
    await (await import('./commands/enter.ts')).enter(branch)
  })

// port exit
program
  .command('exit')
  .description('Exit the current worktree and return to the repository root')
  .action(async () => {
    await (await import('./commands/exit.ts')).exit()
  })

// port shell-hook <shell>
program
  .command('shell-hook <shell>')
  .description('Print shell integration code for automatic cd (bash, zsh, or fish)')
  .option('--remote-services', 'Opt into the experimental SSH bootstrap bridge (bash only)')
  .action(async (shell: string, options: { remoteServices?: boolean }) => {
    await (await import('./commands/shell-hook.ts')).shellHook(shell, options)
  })

// port urls [service]
program
  .command('urls [service]')
  .description('Show service URLs for the current worktree')
  .option('--remote', 'Show all discovered remote routes, including other worktrees')
  .action(async (...args) => {
    await (await import('./commands/urls.ts')).urls(...args)
  })

// port up
program
  .command('up [services...]')
  .description('Start docker-compose services in the current worktree')
  .action(async (...args) => {
    await (await import('./commands/up.ts')).up(...args)
  })

// port down
program
  .command('down [services...]')
  .description('Stop docker-compose services in the current worktree')
  .option('-y, --yes', 'Skip confirmation prompt for stopping Traefik')
  .action(async (services: string[] | undefined, options: { yes?: boolean }) => {
    await (await import('./commands/down.ts')).down(services ?? [], options)
  })

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
    async (
      branch: string | undefined,
      options: { force?: boolean; keepBranch?: boolean; cleanupImages?: boolean }
    ) => {
      await (await import('./commands/remove.ts')).remove(branch, options)
    }
  )

// port uninstall
program
  .command('uninstall')
  .description('Remove DNS configuration and shell hook for wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--domain <domain>', 'Domain suffix to remove (default: config domain or port)')
  .option('--no-shell-hook', 'Leave the shell hook in your shell profile')
  .action(async (...args) => {
    await (await import('./commands/uninstall.ts')).uninstall(...args)
  })

// port compose <args>
program
  .command('compose')
  .alias('dc')
  .description('Run docker compose with automatic -f flags for this worktree')
  .allowUnknownOption()
  .allowExcessArguments()
  .argument('[args...]', 'Arguments to pass to docker compose')
  .action(async (args: string[]) => {
    await (await import('./commands/compose.ts')).compose(args)
  })

// port run <port> -- <command...>
program
  .command('run <port>')
  .description('Run a host process with Traefik routing')
  .allowUnknownOption()
  .allowExcessArguments()
  .argument('[command...]', 'Command to run (receives PORT env var)')
  .option('-d, --detached', 'Run the process in detached mode (similar to docker run -d)')
  .action(async (port: string, command: string[], options: { detached?: boolean }) => {
    const portNum = parseInt(port, 10)
    await (await import('./commands/run.ts')).run(portNum, command, options)
  })

// port kill [port]
program
  .command('kill [port]')
  .description('Stop host services listed in port ls (optionally by logical port)')
  .action(async (...args) => {
    await (await import('./commands/kill.ts')).kill(...args)
  })

// port cleanup
program
  .command('cleanup')
  .description('Delete archived branches created by port remove (with confirmation)')
  .option(
    '--cleanup-images',
    'Clean up Docker images (requires explicit opt-in in non-interactive mode)'
  )
  .action(async (...args) => {
    await (await import('./commands/cleanup.ts')).cleanup(...args)
  })

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
  .action(async (...args) => {
    await (await import('./commands/prune.ts')).prune(args[0])
  })

// port hook [hook-name]
program
  .command('hook [hook-name]')
  .description('Re-run a hook script in the current worktree')
  .option('-l, --list', 'List available hooks and their status')
  .action(async (hookName: string | undefined, options: { list?: boolean }) => {
    await (await import('./commands/hook.ts')).hook(hookName, options)
  })

// port open
program
  .command('open')
  .description('Run the post-up hook in the current repo/worktree context')
  .action(async () => {
    await (await import('./commands/open.ts')).open()
  })

// port rename <branch>
program
  .command('rename <branch>')
  .alias('mv')
  .description('Rename the current worktree and branch')
  .action(async (branch: string) => {
    await (await import('./commands/rename.ts')).rename(branch)
  })

// port completion <shell>
program
  .command('completion <shell>')
  .description('Generate shell completion script (bash, zsh, or fish)')
  .action(async (shell: string) => {
    await (await import('./commands/completion.ts')).completion(shell)
  })

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
      if ((await import('./lib/commands.ts')).isReservedCommand(branch)) {
        program.help()
        return
      }
      await (await import('./commands/enter.ts')).enter(branch)
    } else {
      if (!process.stdout.isTTY) {
        program.help()
        return
      }

      // No argument provided — launch TUI
      try {
        const info = (await import('./lib/worktree.ts')).detectWorktree()
        const { configExists, loadConfig } = await import('./lib/config.ts')

        if (!configExists(info.repoRoot)) {
          ;(await import('./lib/output.ts')).error('Not in a port project. Run `port init` first.')
          process.exit(1)
        }

        const config = await loadConfig(info.repoRoot)
        const startView = 'dashboard'

        // Dynamic import to avoid bundling OpenTUI assets into the main CLI
        const { launchTui } = await import('./tui/index.tsx')
        await launchTui(startView as 'dashboard' | 'worktree', info, config)
      } catch {
        // Not in a git repo — eventually this will show the project list
        ;(await import('./lib/output.ts')).error(
          'Not in a git repository. Run `port` inside a port project.'
        )
        process.exit(1)
      }
    }
  })

export async function runCli(): Promise<void> {
  const entryToken = process.argv[2]

  try {
    let handledRemoteCommand = false
    if (entryToken?.startsWith('__remote-')) {
      const remote = await import('./commands/remote-internal.ts')
      if (remote.isRemoteInternalCommand(entryToken)) {
        await remote.dispatchRemoteInternalCommand(entryToken, process.argv.slice(3))
        handledRemoteCommand = true
      }
    }

    if (!handledRemoteCommand) {
      if (shouldAutoRegisterWorktree(entryToken)) {
        await (await import('./lib/worktreeRegistration.ts')).ensureCurrentWorktreeRegistered()
      }

      await program.parseAsync()
    }
  } catch (error) {
    ;(await import('./lib/cli.ts')).handleCliError(error)
  }
}
