import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { deleteLocalBranch, listArchivedBranches } from '../lib/git.ts'
import { failWithError } from '../lib/cli.ts'
import * as output from '../lib/output.ts'

/**
 * Delete archived local branches created by port remove
 */
export async function cleanup(): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  const archivedBranches = await listArchivedBranches(repoRoot)

  if (archivedBranches.length === 0) {
    output.info('No archived branches to clean up.')
    return
  }

  output.header('Archived branches:')
  output.newline()

  for (const branch of archivedBranches) {
    console.log(output.branch(branch))
  }

  output.newline()

  const { confirmCleanup } = await inquirer.prompt<{ confirmCleanup: boolean }>([
    {
      type: 'confirm',
      name: 'confirmCleanup',
      message: `Delete all ${archivedBranches.length} archived branch(es)?`,
      default: false,
    },
  ])

  if (!confirmCleanup) {
    output.info('Cleanup cancelled')
    return
  }

  let deletedCount = 0
  let failedCount = 0

  for (const branch of archivedBranches) {
    try {
      await deleteLocalBranch(repoRoot, branch, true)
      deletedCount += 1
      output.success(`Deleted ${output.branch(branch)}`)
    } catch (error) {
      failedCount += 1
      output.warn(`Failed to delete ${output.branch(branch)}: ${error}`)
    }
  }

  output.newline()

  if (failedCount > 0) {
    failWithError(`Deleted ${deletedCount} archived branch(es); ${failedCount} failed.`)
  }

  output.success(`Deleted ${deletedCount} archived branch(es).`)
}
