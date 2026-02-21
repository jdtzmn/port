#!/usr/bin/env bun

import { Command } from 'commander'
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
import { urls } from './commands/urls.ts'
import { onboard } from './commands/onboard.ts'
import { shellHook } from './commands/shell-hook.ts'
import { completion } from './commands/completion.ts'
import { isReservedCommand } from './lib/commands.ts'
import { detectWorktree } from './lib/worktree.ts'
import { branchExists } from './lib/git.ts'
import * as output from './lib/output.ts'

export const program = new Command()
program.enablePositionalOptions()

async function maybeWarnCommandBranchCollision(): Promise<void> {
  const token = process.argv[2]

  if (!token || token.startsWith('-') || token === 'enter' || token === 'shell-hook') {
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
  .version('0.1.0')

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
  .description('Set up DNS to resolve wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option(
    '--dns-ip <address>',
    'IP address wildcard domains should resolve to (default: 127.0.0.1)'
  )
  .option('--domain <domain>', 'Domain suffix to configure (default: config domain or port)')
  .action(install)

// port list
program
  .command('list')
  .alias('ls')
  .description('List worktrees and host service summary')
  .option('-n, --names', 'Print only worktree names, one per line')
  .action(list)

// port status
program.command('status').description('Show per-service status for all worktrees').action(status)

// port enter <branch>
program
  .command('enter <branch>')
  .description('Enter a worktree by branch name (works even for command-name branches)')
  .action(async (branch: string) => {
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
  .command('up')
  .description('Start docker-compose services in the current worktree')
  .action(up)

// port down
program
  .command('down')
  .description('Stop docker-compose services in the current worktree')
  .option('-y, --yes', 'Skip confirmation prompt for stopping Traefik')
  .action(down)

// port remove <branch>
program
  .command('remove <branch>')
  .alias('rm')
  .description('Remove a worktree and stop its services')
  .option('-f, --force', 'Skip confirmation for non-standard/stale worktree entries')
  .option('--keep-branch', 'Keep the local branch instead of archiving it')
  .action((branch: string, options: { force?: boolean; keepBranch?: boolean }) =>
    remove(branch, options)
  )

// port uninstall
program
  .command('uninstall')
  .description('Remove DNS configuration for wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--domain <domain>', 'Domain suffix to remove (default: config domain or port)')
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
  .action(async (port: string, command: string[]) => {
    const portNum = parseInt(port, 10)
    await run(portNum, command)
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
  .action(cleanup)

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
  .argument('[branch]', 'Branch name to enter (creates worktree if needed)')
  .action(async (branch: string | undefined) => {
    if (branch) {
      // Check if it looks like a command that wasn't matched
      if (isReservedCommand(branch)) {
        program.help()
        return
      }
      await enter(branch)
    } else {
      // No argument provided, show help
      program.help()
    }
  })

if (import.meta.main) {
  program.parseAsync().catch(handleCliError)
}
