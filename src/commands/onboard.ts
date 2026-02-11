import * as output from '../lib/output.ts'

interface OnboardStep {
  command: string
  how: string
  why: string
}

const STEPS: OnboardStep[] = [
  {
    command: 'port init',
    how: 'Run in your repository root if setup has not been done yet (check with port status first).',
    why: 'Creates .port config, hooks, and worktree directories.',
  },
  {
    command: 'port install',
    how: 'Run once per machine (or when changing domain/IP).',
    why: 'Configures wildcard DNS so branch domains resolve locally.',
  },
  {
    command: 'port enter <branch>',
    how: 'Use explicit enter, especially when branch names match commands.',
    why: 'Creates or enters the branch worktree safely and predictably.',
  },
  {
    command: 'port up',
    how: 'Run inside a worktree after entering it.',
    why: 'Starts services and wires routing through Traefik.',
  },
  {
    command: 'port urls [service]',
    how: 'Run in a worktree or repository root.',
    why: 'Shows the exact branch URLs to open and share.',
  },
  {
    command: 'port status',
    how: 'Run anytime when you need service-level visibility.',
    why: 'Shows running/stopped services across all worktrees.',
  },
  {
    command: 'port down',
    how: 'Run in a worktree when you are done testing.',
    why: 'Stops project services and offers Traefik shutdown when appropriate.',
  },
  {
    command: 'port remove <branch>',
    how: 'Use after a branch is done.',
    why: 'Stops services, removes worktree, and archives the local branch.',
  },
]

/**
 * Print a focused onboarding guide for common Port workflows.
 */
export async function onboard(): Promise<void> {
  output.header('Port onboarding')
  output.newline()
  output.info('Recommended flow:')
  output.newline()

  for (const [index, step] of STEPS.entries()) {
    output.header(`${index + 1}. ${output.command(step.command)}`)
    output.dim(`   How: ${step.how}`)
    output.dim(`   Why: ${step.why}`)
    output.newline()
  }

  output.info('Useful checks:')
  output.dim(`- ${output.command('port list')}: quick worktree and host-service summary`)
  output.dim(`- ${output.command('port kill [port]')}: stop host processes started with port run`)
  output.dim(`- ${output.command('port cleanup')}: delete archived local branches from port remove`)
}
