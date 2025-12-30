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
program.command('list').alias('ls').description('List all worktrees and their status').action(list)

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
  .action(remove)

// port uninstall
program
  .command('uninstall')
  .description('Remove DNS configuration for *.port domains')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(uninstall)

// port <branch> - default command to enter a worktree
// This must be last to act as a catch-all for branch names
program
  .argument('[branch]', 'Branch name to enter (creates worktree if needed)')
  .action(async (branch: string | undefined) => {
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
        'help',
      ]
      if (commands.includes(branch)) {
        program.help()
        return
      }
      await enter(branch)
    } else {
      // No argument provided, show help
      program.help()
    }
  })

program.parse()
