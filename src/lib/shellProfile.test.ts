import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  BLOCK_END,
  BLOCK_START,
  buildProfileBlock,
  detectShell,
  getProfilePath,
  hasManagedBlock,
  hasManualHook,
  installShellHook,
  removeShellHook,
  withManagedBlock,
  withoutManagedBlock,
} from './shellProfile.ts'

describe('detectShell', () => {
  test('detects supported shells from a shell path', () => {
    expect(detectShell('/bin/bash')).toBe('bash')
    expect(detectShell('/usr/bin/zsh')).toBe('zsh')
    expect(detectShell('/opt/homebrew/bin/fish')).toBe('fish')
  })

  test('returns null for unset or unsupported shells', () => {
    expect(detectShell('')).toBeNull()
    expect(detectShell('/bin/ksh')).toBeNull()
  })
})

describe('getProfilePath', () => {
  test('maps each shell to its profile file', () => {
    expect(getProfilePath('bash', '/home/dev')).toBe('/home/dev/.bashrc')
    expect(getProfilePath('zsh', '/home/dev')).toBe('/home/dev/.zshrc')
    expect(getProfilePath('fish', '/home/dev')).toBe('/home/dev/.config/fish/config.fish')
  })
})

describe('buildProfileBlock', () => {
  test('guards the posix hook behind a port lookup', () => {
    const block = buildProfileBlock('zsh')

    expect(block.startsWith(BLOCK_START)).toBe(true)
    expect(block.endsWith(BLOCK_END)).toBe(true)
    expect(block).toContain('command -v port >/dev/null 2>&1')
    expect(block).toContain('eval "$(port shell-hook zsh)"')
  })

  test('uses fish syntax for fish', () => {
    const block = buildProfileBlock('fish')

    expect(block).toContain('if command -q port')
    expect(block).toContain('port shell-hook fish | source')
  })
})

describe('block editing', () => {
  test('round-trips a profile back to its original content', () => {
    const original = 'export EDITOR=vim\n'
    const added = withManagedBlock(original, buildProfileBlock('bash'))

    expect(hasManagedBlock(added)).toBe(true)
    expect(withoutManagedBlock(added)).toBe(original)
  })

  test('preserves trailing blank lines in the original profile', () => {
    const original = 'export EDITOR=vim\n\n'
    const added = withManagedBlock(original, buildProfileBlock('zsh'))

    expect(withoutManagedBlock(added)).toBe(original)
  })

  test('appends a newline when the profile does not end with one', () => {
    const added = withManagedBlock('export EDITOR=vim', buildProfileBlock('bash'))

    expect(added).toContain('export EDITOR=vim\n\n' + BLOCK_START)
  })

  test('detects a hand-written hook outside the managed block', () => {
    expect(hasManualHook('eval "$(port shell-hook zsh)"\n')).toBe(true)
    expect(hasManualHook(withManagedBlock('', buildProfileBlock('zsh')))).toBe(false)
  })
})

describe('installShellHook / removeShellHook', () => {
  let home: string
  const originalHome = process.env.HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'port-profile-'))
    process.env.HOME = home
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  test('creates the profile when it does not exist', async () => {
    const result = await installShellHook('bash')

    expect(result.status).toBe('installed')
    expect(await readFile(join(home, '.bashrc'), 'utf8')).toContain('port shell-hook bash')
  })

  test('creates missing parent directories for fish', async () => {
    const result = await installShellHook('fish')

    expect(result.status).toBe('installed')
    expect(await readFile(join(home, '.config/fish/config.fish'), 'utf8')).toContain(
      'port shell-hook fish'
    )
  })

  test('is idempotent', async () => {
    await installShellHook('zsh')
    const second = await installShellHook('zsh')

    expect(second.status).toBe('already-installed')
    const content = await readFile(join(home, '.zshrc'), 'utf8')
    expect(content.split(BLOCK_START)).toHaveLength(2)
  })

  test('leaves a hand-written hook alone', async () => {
    await writeFile(join(home, '.zshrc'), 'eval "$(port shell-hook zsh)"\n')

    const result = await installShellHook('zsh')

    expect(result.status).toBe('manual-hook')
    expect(await readFile(join(home, '.zshrc'), 'utf8')).toBe('eval "$(port shell-hook zsh)"\n')
  })

  test('removes only the managed block', async () => {
    await writeFile(join(home, '.zshrc'), 'export EDITOR=vim\n')
    await installShellHook('zsh')

    const result = await removeShellHook('zsh')

    expect(result.status).toBe('removed')
    expect(await readFile(join(home, '.zshrc'), 'utf8')).toBe('export EDITOR=vim\n')
  })

  test('reports when there is nothing to remove', async () => {
    await mkdir(join(home, '.config/fish'), { recursive: true })
    await writeFile(join(home, '.config/fish/config.fish'), 'set -gx EDITOR vim\n')

    const result = await removeShellHook('fish')

    expect(result.status).toBe('not-installed')
  })
})
