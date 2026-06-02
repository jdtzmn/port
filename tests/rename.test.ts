import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, chmodSync, realpathSync, existsSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
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

describe('port rename', () => {
  test(
    'renames the current worktree directory and branch in place',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      try {
        // 1. Create a worktree to rename
        await execPortAsync(['enter', 'rename-old'], sample.dir)
        const oldPath = join(sample.dir, '.port/trees/rename-old')
        const newPath = join(sample.dir, '.port/trees/rename-new')
        expect(existsSync(oldPath)).toBe(true)

        // 2. Rename it from inside the worktree
        await execPortAsync(['rename', 'rename-new'], oldPath)

        // 3. The on-disk worktree moved to the new name
        expect(existsSync(newPath)).toBe(true)
        expect(existsSync(oldPath)).toBe(false)

        // 4. The branch ref was renamed (old gone, new present)
        const { stdout } = await execAsync('git branch --list', { cwd: sample.dir })
        const branches = stdout
          .split('\n')
          .map(line => line.replace(/^[*+]?\s+/, '').trim())
          .filter(Boolean)
        expect(branches).toContain('rename-new')
        expect(branches).not.toContain('rename-old')

        // 5. The moved worktree still points at the renamed branch
        const { stdout: headBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: newPath,
        })
        expect(headBranch.trim()).toBe('rename-new')
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'supports the mv alias',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      try {
        await execPortAsync(['enter', 'mv-old'], sample.dir)
        const oldPath = join(sample.dir, '.port/trees/mv-old')
        const newPath = join(sample.dir, '.port/trees/mv-new')
        expect(existsSync(oldPath)).toBe(true)

        await execPortAsync(['mv', 'mv-new'], oldPath)

        expect(existsSync(newPath)).toBe(true)
        expect(existsSync(oldPath)).toBe(false)
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  describe('shell integration', () => {
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
      'shell hook updates cwd and PORT_WORKTREE after rename',
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
              port enter rename-shell-old
              echo "ENTER_PWD=$PWD"
              echo "ENTER_WORKTREE=$PORT_WORKTREE"
              port rename rename-shell-new
              echo "RENAME_PWD=$PWD"
              echo "RENAME_WORKTREE=\${PORT_WORKTREE:-}"
            '`,
            { encoding: 'utf-8', env, timeout: TIMEOUT }
          )

          const vars = parseOutput(result)

          // After enter, should be inside the original worktree
          expect(vars.ENTER_PWD).toContain('.port/trees/rename-shell-old')
          expect(vars.ENTER_WORKTREE).toBe('rename-shell-old')

          // After rename, cwd follows the moved worktree and env reflects the new name
          expect(vars.RENAME_PWD).toContain('.port/trees/rename-shell-new')
          expect(vars.RENAME_PWD).not.toContain('rename-shell-old')
          expect(vars.RENAME_WORKTREE).toBe('rename-shell-new')

          // On-disk state matches: new dir exists, old is gone
          expect(existsSync(join(sampleDir, '.port/trees/rename-shell-new'))).toBe(true)
          expect(existsSync(join(sampleDir, '.port/trees/rename-shell-old'))).toBe(false)
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })
})
