#!/usr/bin/env bun

import { Command } from 'commander'
import { init } from './commands/init.ts'
import { list } from './commands/list.ts'
import { install } from './commands/install.ts'
import { enter } from './commands/enter.ts'
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
import { detectWorktree } from './lib/worktree.ts'
import { branchExists } from './lib/git.ts'
import * as output from './lib/output.ts'

export const program = new Command()

function getReservedCommands(): Set<string> {
  const reserved = new Set<string>(['help'])

  for (const command of program.commands) {
    reserved.add(command.name())

    for (const alias of command.aliases()) {
      reserved.add(alias)
    }
  }

  return reserved
}

async function maybeWarnCommandBranchCollision(): Promise<void> {
  const token = process.argv[2]

  if (!token || token.startsWith('-') || token === 'enter') {
    return
  }

  if (!getReservedCommands().has(token)) {
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
  .description('Manage git worktrees with automatic Traefik configuration')
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
  .action(list)

// port status
program.command('status').description('Show per-service status for all worktrees').action(status)

// port enter <branch>
program
  .command('enter <branch>')
  .description('Enter a worktree by branch name (works even for command-name branches)')
  .option('--no-shell', 'Skip spawning a subshell (useful for CI/scripting)')
  .action(async (branch: string, options: { shell?: boolean }, command: Command) => {
    const commandShell = options.shell
    const parentShell = command.parent?.opts<{ shell?: boolean }>().shell
    const shellEnabled = commandShell ?? parentShell ?? true
    await enter(branch, { noShell: !shellEnabled })
  })

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

// port <branch> - default command to enter a worktree
// This must be last to act as a catch-all for branch names
program.hook('preAction', async () => {
  await maybeWarnCommandBranchCollision()
})

program
  .argument('[branch]', 'Branch name to enter (creates worktree if needed)')
  .option('--no-shell', 'Skip spawning a subshell (useful for CI/scripting)')
  .action(async (branch: string | undefined, options: { shell: boolean }) => {
    if (branch) {
      // Check if it looks like a command that wasn't matched
      if (getReservedCommands().has(branch)) {
        program.help()
        return
      }
      await enter(branch, { noShell: !options.shell })
    } else {
      // No argument provided, show help
      program.help()
    }
  })

if (import.meta.main) {
  program.parseAsync().catch(handleCliError)
}
