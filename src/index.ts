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

const program = new Command()

program
  .name('port')
  .description('Manage git worktrees with automatic Traefik configuration')
  .version('0.1.0')

// port init
program
  .command('init')
  .description('Initialize .port/ directory in the current project')
  .action(init)

// port install
program
  .command('install')
  .description('Set up DNS to resolve *.port domains')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--dns-ip <address>', 'IP address to resolve *.port domains to (default: 127.0.0.1)')
  .action(install)

// port list
program
  .command('list')
  .alias('ls')
  .description('List worktrees and host service summary')
  .action(list)

// port status
program.command('status').description('Show per-service status for all worktrees').action(status)

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
  .action((branch: string, options: { force?: boolean }) => remove(branch, options))

// port uninstall
program
  .command('uninstall')
  .description('Remove DNS configuration for *.port domains')
  .option('-y, --yes', 'Skip confirmation prompt')
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

// port <branch> - default command to enter a worktree
// This must be last to act as a catch-all for branch names
program
  .argument('[branch]', 'Branch name to enter (creates worktree if needed)')
  .option('--no-shell', 'Skip spawning a subshell (useful for CI/scripting)')
  .action(async (branch: string | undefined, options: { shell: boolean }) => {
    if (branch) {
      // Check if it looks like a command that wasn't matched
      const commands = [
        'init',
        'install',
        'uninstall',
        'list',
        'ls',
        'up',
        'down',
        'remove',
        'rm',
        'compose',
        'dc',
        'run',
        'kill',
        'status',
        'help',
      ]
      if (commands.includes(branch)) {
        program.help()
        return
      }
      await enter(branch, { noShell: !options.shell })
    } else {
      // No argument provided, show help
      program.help()
    }
  })

program.parseAsync().catch(handleCliError)
