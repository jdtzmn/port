import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  header: vi.fn(),
  newline: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  command: vi.fn(),
  success: vi.fn(),
}))

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
}))

const worktreeMocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  info: mocks.info,
  dim: mocks.dim,
  command: mocks.command,
  success: mocks.success,
}))

vi.mock('fs/promises', () => ({
  writeFile: fsMocks.writeFile,
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: worktreeMocks.detectWorktree,
}))

import { onboard, generateMarkdown, STEPS } from './onboard.ts'

describe('onboard command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.command.mockImplementation((value: string) => value)
  })

  test('prints onboarding flow with command, how, and why guidance', async () => {
    await onboard()

    expect(mocks.header).toHaveBeenCalledWith('Port onboarding')
    expect(mocks.info).toHaveBeenCalledWith('Recommended flow:')
    expect(mocks.header).toHaveBeenCalledWith('1. port init')
    expect(mocks.header).toHaveBeenCalledWith('3. port enter <branch>')
    expect(mocks.header).toHaveBeenCalledWith('8. port remove <branch>')
    expect(mocks.dim).toHaveBeenCalledWith(
      '   How: Use explicit enter, especially when branch names match commands.'
    )
    expect(mocks.dim).toHaveBeenCalledWith(
      '   Why: Stops project services and offers Traefik shutdown when appropriate.'
    )
    expect(mocks.info).toHaveBeenCalledWith('Useful checks:')
  })

  test('does not write file when --md is not passed', async () => {
    await onboard()

    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  describe('--md flag', () => {
    beforeEach(() => {
      worktreeMocks.detectWorktree.mockReturnValue({
        repoRoot: '/fake/repo',
        worktreePath: '/fake/repo',
        name: 'repo',
        isMainRepo: true,
      })
      fsMocks.writeFile.mockResolvedValue(undefined)
    })

    test('writes ONBOARD.md to repo root', async () => {
      await onboard({ md: true })

      expect(fsMocks.writeFile).toHaveBeenCalledWith(
        '/fake/repo/ONBOARD.md',
        expect.any(String)
      )
      expect(mocks.success).toHaveBeenCalledWith('Wrote /fake/repo/ONBOARD.md')
    })

    test('does not print terminal output when --md is passed', async () => {
      await onboard({ md: true })

      expect(mocks.header).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(mocks.dim).not.toHaveBeenCalled()
      expect(mocks.newline).not.toHaveBeenCalled()
    })

    test('generated markdown contains all steps', async () => {
      await onboard({ md: true })

      const call = fsMocks.writeFile.mock.calls[0]
      expect(call).toBeDefined()
      const writtenContent = call![1] as string

      for (const step of STEPS) {
        expect(writtenContent).toContain(`\`${step.command}\``)
        expect(writtenContent).toContain(step.how)
        expect(writtenContent).toContain(step.why)
      }
    })

    test('generated markdown contains useful checks', async () => {
      await onboard({ md: true })

      const call = fsMocks.writeFile.mock.calls[0]
      expect(call).toBeDefined()
      const writtenContent = call![1] as string

      expect(writtenContent).toContain('`port list`')
      expect(writtenContent).toContain('`port kill [port]`')
      expect(writtenContent).toContain('`port cleanup`')
    })
  })

  describe('generateMarkdown', () => {
    test('returns well-formatted markdown', () => {
      const md = generateMarkdown()

      expect(md).toContain('# Port Onboarding')
      expect(md).toContain('## Recommended Flow')
      expect(md).toContain('## Useful Checks')
      expect(md).toContain('### 1. `port init`')
      expect(md).toContain('- **How**:')
      expect(md).toContain('- **Why**:')
    })

    test('includes all steps in order', () => {
      const md = generateMarkdown()

      for (const [index, step] of STEPS.entries()) {
        expect(md).toContain(`### ${index + 1}. \`${step.command}\``)
      }
    })
  })
})
