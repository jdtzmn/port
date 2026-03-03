import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { afterAll, beforeAll, describe, test, expect } from 'vitest'
import { execPortAsync, prepareSample } from './utils'
import { execAsync } from '../src/lib/exec'

const TIMEOUT = 60_000
const CLI_ENTRY = resolve(__dirname, '../src/index.ts')

/**
 * Parse structured KEY=VALUE lines from shell output.
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

describe('port rm from inside a worktree', () => {
  let portBinDir: string
  let env: NodeJS.ProcessEnv

  beforeAll(() => {
    portBinDir = mkdtempSync(join(tmpdir(), 'port-bin-'))
    const portScript = join(portBinDir, 'port')
    writeFileSync(portScript, `#!/usr/bin/env bash\nexec bun "${CLI_ENTRY}" "$@"\n`)
    chmodSync(portScript, 0o755)
    env = { ...process.env, PATH: `${portBinDir}:${process.env.PATH}` }
  })

  afterAll(async () => {
    await rm(portBinDir, { recursive: true, force: true })
  })

  test(
    'removes the current worktree and archives the branch',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      try {
        // Create a worktree
        await execPortAsync(['enter', 'test-rm'], sample.dir)
        const worktreePath = join(sample.dir, '.port/trees/test-rm')
        expect(existsSync(worktreePath)).toBe(true)

        // Remove it from inside the worktree (--force skips confirmation)
        await execPortAsync(['rm', '-f'], worktreePath)

        // Verify worktree directory is gone
        expect(existsSync(worktreePath)).toBe(false)

        // Verify the branch was archived
        const { stdout } = await execAsync("git branch --list 'archive/test-rm-*'", {
          cwd: sample.dir,
        })
        expect(stdout.trim()).toMatch(/^archive\/test-rm-/)
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'shell hook updates cwd and unsets env vars after removal',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })
      const sampleDir = realpathSync(sample.dir)

      try {
        const result = execSync(
          `bash -c '
            eval "$(port shell-hook bash)"
            cd "${sampleDir}"
            port enter test-rm-shell
            echo "ENTER_PWD=$PWD"
            echo "ENTER_WORKTREE=$PORT_WORKTREE"
            port rm -f
            echo "RM_PWD=$PWD"
            echo "RM_WORKTREE=\${PORT_WORKTREE:-}"
          '`,
          { encoding: 'utf-8', env, timeout: TIMEOUT }
        )

        const vars = parseOutput(result)

        // After enter, should be inside the worktree
        expect(vars.ENTER_PWD).toContain('.port/trees/test-rm-shell')
        expect(vars.ENTER_WORKTREE).toBe('test-rm-shell')

        // After rm, should be back at repo root with env vars cleared
        expect(vars.RM_PWD).toBe(sampleDir)
        expect(vars.RM_WORKTREE).toBe('')

        // Worktree directory should be gone
        expect(existsSync(join(sampleDir, '.port/trees/test-rm-shell'))).toBe(false)
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})
