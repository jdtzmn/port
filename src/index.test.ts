import { describe, test, expect } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { joinBranchArgs } from './program.ts'
import { isListInvocation } from './lib/cliEntry.ts'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

describe('joinBranchArgs', () => {
  test('joins bare multi-word tokens with a single space', () => {
    expect(joinBranchArgs(['my', 'feature'])).toBe('my feature')
  })

  test('collapses extra tokens into single-spaced words', () => {
    expect(joinBranchArgs(['my', 'cool', 'feature'])).toBe('my cool feature')
  })

  test('preserves an already-quoted single argument containing spaces', () => {
    expect(joinBranchArgs(['my feature'])).toBe('my feature')
  })

  test('returns a single token unchanged', () => {
    expect(joinBranchArgs(['single'])).toBe('single')
  })

  test('returns undefined for an empty array', () => {
    expect(joinBranchArgs([])).toBeUndefined()
  })

  test('returns undefined for undefined input', () => {
    expect(joinBranchArgs(undefined)).toBeUndefined()
  })
})

describe('isListInvocation', () => {
  test('recognizes list and its alias without flags', () => {
    expect(isListInvocation(['list'])).toBe(true)
    expect(isListInvocation(['ls'])).toBe(true)
  })

  test('defers all other invocations to Commander', () => {
    expect(isListInvocation([])).toBe(false)
    expect(isListInvocation(['list', '--help'])).toBe(false)
    expect(isListInvocation(['status'])).toBe(false)
  })
})

describe('command profiling', () => {
  test('emits exactly one profile before Commander exits for --version', async () => {
    const { stderr } = await execFileAsync('bun', ['src/index.ts', '--version'], {
      cwd: repoRoot,
      env: { ...process.env, PORT_PROFILE: '1' },
    })
    const profiles = stderr
      .split('\n')
      .filter(line => line.startsWith('[port-profile] '))
      .map(line => (JSON.parse(line.replace('[port-profile] ', '')) as { command: string }).command)

    expect(profiles).toEqual(['--version'])
  })
})
