import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { prepareSample } from './utils'

const TIMEOUT = 30_000
const CLI_ENTRY = resolve(__dirname, '../src/index.ts')

/**
 * Parse structured KEY=VALUE lines from shell output.
 * Ignores lines that don't match the pattern.
 */
function parseOutput(output: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && match[1] && match[2] !== undefined) {
      vars[match[1]] = match[2]
    }
  }
  return vars
}

describe('shell integration', () => {
  let portBinDir: string
  let env: NodeJS.ProcessEnv

  beforeAll(() => {
    // Create a temporary `port` wrapper so `command port` works in shell hooks
    portBinDir = mkdtempSync(join(tmpdir(), 'port-bin-'))
    const portScript = join(portBinDir, 'port')
    writeFileSync(portScript, `#!/usr/bin/env bash\nexec bun "${CLI_ENTRY}" "$@"\n`)
    chmodSync(portScript, 0o755)
    env = { ...process.env, PATH: `${portBinDir}:${process.env.PATH}` }
  })

  afterAll(async () => {
    await rm(portBinDir, { recursive: true, force: true })
  })

  describe('syntax validation', () => {
    test('bash hook is valid bash syntax', () => {
      const hook = execSync(`bun "${CLI_ENTRY}" shell-hook bash`, { encoding: 'utf-8', env })
      // bash -n checks syntax without executing
      execSync(`bash -n <<'HOOK'\n${hook}\nHOOK`, { encoding: 'utf-8' })
    })

    test('zsh hook is valid zsh syntax', () => {
      const hook = execSync(`bun "${CLI_ENTRY}" shell-hook zsh`, { encoding: 'utf-8', env })
      execSync(`zsh -n <<'HOOK'\n${hook}\nHOOK`, { encoding: 'utf-8' })
    })

    test('fish hook is valid fish syntax', () => {
      const hook = execSync(`bun "${CLI_ENTRY}" shell-hook fish`, { encoding: 'utf-8', env })
      execSync(`fish --no-execute -c ${shellEscape(hook)}`, { encoding: 'utf-8' })
    })
  })

  describe('bash: enter/exit through hook', () => {
    test(
      'enter sets directory and env, exit restores them',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        const sampleDir = realpathSync(sample.dir)

        try {
          const result = execSync(
            `bash -c '
              eval "$(port shell-hook bash)"
              cd "${sampleDir}"
              port enter test-branch
              echo "ENTER_PWD=$PWD"
              echo "ENTER_WORKTREE=$PORT_WORKTREE"
              echo "ENTER_REPO=$PORT_REPO"
              port exit
              echo "EXIT_PWD=$PWD"
              echo "EXIT_WORKTREE=\${PORT_WORKTREE:-}"
              echo "EXIT_REPO=\${PORT_REPO:-}"
            '`,
            { encoding: 'utf-8', env, timeout: TIMEOUT }
          )

          const vars = parseOutput(result)
          expect(vars.ENTER_PWD).toContain('.port/trees/test-branch')
          expect(vars.ENTER_WORKTREE).toBe('test-branch')
          expect(vars.ENTER_REPO).toBe(sampleDir)
          expect(vars.EXIT_PWD).toBe(sampleDir)
          expect(vars.EXIT_WORKTREE).toBe('')
          expect(vars.EXIT_REPO).toBe('')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })

  describe('zsh: enter/exit through hook', () => {
    test(
      'enter sets directory and env, exit restores them',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        const sampleDir = realpathSync(sample.dir)

        try {
          const result = execSync(
            `zsh -c '
              eval "$(port shell-hook zsh)"
              cd "${sampleDir}"
              port enter test-branch
              echo "ENTER_PWD=$PWD"
              echo "ENTER_WORKTREE=$PORT_WORKTREE"
              echo "ENTER_REPO=$PORT_REPO"
              port exit
              echo "EXIT_PWD=$PWD"
              echo "EXIT_WORKTREE=\${PORT_WORKTREE:-}"
              echo "EXIT_REPO=\${PORT_REPO:-}"
            '`,
            { encoding: 'utf-8', env, timeout: TIMEOUT }
          )

          const vars = parseOutput(result)
          expect(vars.ENTER_PWD).toContain('.port/trees/test-branch')
          expect(vars.ENTER_WORKTREE).toBe('test-branch')
          expect(vars.ENTER_REPO).toBe(sampleDir)
          expect(vars.EXIT_PWD).toBe(sampleDir)
          expect(vars.EXIT_WORKTREE).toBe('')
          expect(vars.EXIT_REPO).toBe('')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })

  describe('fish: enter/exit through hook', () => {
    test(
      'enter sets directory and env, exit restores them',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        const sampleDir = realpathSync(sample.dir)

        try {
          const result = execSync(
            `fish -c '
              port shell-hook fish | source
              cd "${sampleDir}"
              port enter test-branch
              echo "ENTER_PWD="(pwd)
              echo "ENTER_WORKTREE=$PORT_WORKTREE"
              echo "ENTER_REPO=$PORT_REPO"
              port exit
              echo "EXIT_PWD="(pwd)
              echo "EXIT_WORKTREE="(set -q PORT_WORKTREE; and echo $PORT_WORKTREE; or echo "")
              echo "EXIT_REPO="(set -q PORT_REPO; and echo $PORT_REPO; or echo "")
            '`,
            { encoding: 'utf-8', env, timeout: TIMEOUT }
          )

          const vars = parseOutput(result)
          expect(vars.ENTER_PWD).toContain('.port/trees/test-branch')
          expect(vars.ENTER_WORKTREE).toBe('test-branch')
          expect(vars.ENTER_REPO).toBe(sampleDir)
          expect(vars.EXIT_PWD).toBe(sampleDir)
          expect(vars.EXIT_WORKTREE).toBe('')
          expect(vars.EXIT_REPO).toBe('')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })
})

/** Escape a string for use as a single shell argument */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}
