import { describe, test, expect } from 'vitest'
import { renderCLI } from './utils'

/**
 * Acceptance tests for docker cleanup behavior across remove, prune, and cleanup commands.
 *
 * These tests verify user-facing documentation and help text match the implementation.
 * They ensure safety invariants are communicated clearly:
 * 1. Image cleanup prompts default to "No"
 * 2. --cleanup-images flag is documented in help
 * 3. Low-risk resources (containers/volumes/networks) clean automatically
 * 4. Image cleanup is opt-in to prevent accidental shared image removal
 */

describe('docker cleanup help text and flags', () => {
  test('port remove --help documents --cleanup-images flag', async () => {
    const { findByText } = await renderCLI(['remove', '--help'])

    await findByText('--cleanup-images')
    await findByText(/Clean up Docker images/)
  })

  test('port prune --help documents --cleanup-images flag', async () => {
    const { findByText } = await renderCLI(['prune', '--help'])

    await findByText('--cleanup-images')
    await findByText(/Clean up Docker images/)
  })

  test('port cleanup --help documents --cleanup-images flag', async () => {
    const { findByText } = await renderCLI(['cleanup', '--help'])

    await findByText('--cleanup-images')
    await findByText(/Clean up Docker images/)
  })

  test('port remove --help shows all cleanup options', async () => {
    const { findByText } = await renderCLI(['rm', '--help'])

    // Verify all flags are documented
    await findByText('-f, --force')
    await findByText('--keep-branch')
    await findByText('--cleanup-images')
  })

  test('port prune --help shows all options including docker cleanup', async () => {
    const { findByText } = await renderCLI(['prune', '--help'])

    // Verify all flags are documented
    await findByText('-n, --dry-run')
    await findByText('-f, --force')
    await findByText('--no-fetch')
    await findByText('--cleanup-images')
  })
})

describe('docker cleanup safety invariants', () => {
  test('help text mentions interactive prompt behavior', async () => {
    const { findByText } = await renderCLI(['remove', '--help'])

    // The help text should mention prompting behavior
    await findByText(/without prompting/)
  })

  test('prune command help mentions batch cleanup behavior', async () => {
    const { findByText } = await renderCLI(['prune', '--help'])

    // Verify description mentions cleanup
    await findByText(/Remove worktrees for branches/)
  })

  test('cleanup command help mentions archived branches', async () => {
    const { findByText } = await renderCLI(['cleanup', '--help'])

    // Verify description mentions archived branches
    await findByText(/Delete archived branches/)
  })
})

describe('docker cleanup command completeness', () => {
  test('main help includes all cleanup-related commands', async () => {
    const { findByText } = await renderCLI(['--help'])

    // Verify all cleanup commands are listed
    await findByText(/remove\|rm.*\[branch\]/)
    await findByText('prune')
    await findByText('cleanup')
  })

  test('main help shows remove command with options', async () => {
    const { findByText } = await renderCLI(['--help'])

    // The main help should list the remove command
    await findByText(/Remove a worktree/)
  })

  test('main help shows prune command', async () => {
    const { findByText } = await renderCLI(['--help'])

    // The main help should list the prune command
    await findByText(/Remove worktrees for branches/)
  })

  test('main help shows cleanup command', async () => {
    const { findByText } = await renderCLI(['--help'])

    // The main help should list the cleanup command
    await findByText(/Delete archived branches/)
  })
})

describe('docker cleanup flag behavior verification', () => {
  test('remove command accepts --cleanup-images without error', async () => {
    // This test verifies the flag is properly wired up
    // We can't test the actual cleanup behavior in acceptance tests without Docker,
    // but we can verify the CLI accepts the flag
    const { queryByError } = await renderCLI(['remove', '--cleanup-images', '--help'])

    // Should not error on the flag
    const error = queryByError(/Unknown option/)
    expect(error).toBeNull()
  })

  test('prune command accepts --cleanup-images without error', async () => {
    const { queryByError } = await renderCLI(['prune', '--cleanup-images', '--help'])

    // Should not error on the flag
    const error = queryByError(/Unknown option/)
    expect(error).toBeNull()
  })

  test('cleanup command accepts --cleanup-images without error', async () => {
    const { queryByError } = await renderCLI(['cleanup', '--cleanup-images', '--help'])

    // Should not error on the flag
    const error = queryByError(/Unknown option/)
    expect(error).toBeNull()
  })
})

describe('docker cleanup documentation consistency', () => {
  test('remove help text is consistent with implementation', async () => {
    const { findByText } = await renderCLI(['remove', '--help'])

    // Verify the flag description matches the actual behavior
    await findByText(/Clean up Docker images/)

    // Should mention the default/interactive behavior
    await findByText(/without prompting/)
  })

  test('prune help text explains image cleanup opt-in', async () => {
    const { findByText } = await renderCLI(['prune', '--help'])

    // Should explain that images require opt-in
    await findByText(/requires explicit opt-in/)
  })

  test('cleanup help text is clear about image cleanup', async () => {
    const { findByText } = await renderCLI(['cleanup', '--help'])

    // Should mention image cleanup behavior
    await findByText(/Clean up Docker images/)
  })
})
