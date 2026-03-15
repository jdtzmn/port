import { hook } from './hook.ts'

/**
 * Re-run the post-up hook in the current worktree.
 */
export async function open(): Promise<void> {
  await hook('post-up', {})
}
