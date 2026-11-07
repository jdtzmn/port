import { randomUUID } from 'crypto'
import { execFileSync, execSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execPortAsync, prepareSample } from './utils'

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

  describe('preserving the relative directory on enter', () => {
    const PRESERVED_DIR = "my dir/it's here"

    /**
     * Create a sample repo with worktree "x", plus the source directory inside the
     * main repo. Directories are created directly (untracked) so the test needs no commits.
     */
    async function setup(options: { sourceDir: string; targetDir?: string; targetFile?: string }) {
      const sample = await prepareSample('simple-server', { initWithConfig: true })
      const sampleDir = realpathSync(sample.dir)
      await execPortAsync(['enter', 'x'], sampleDir)
      const worktree = join(sampleDir, '.port/trees/x')
      const source = join(sampleDir, options.sourceDir)
      mkdirSync(source, { recursive: true })
      if (options.targetDir) mkdirSync(join(worktree, options.targetDir), { recursive: true })
      if (options.targetFile) writeFileSync(join(worktree, options.targetFile), 'a file')
      const errFile = join(portBinDir, `stderr-${randomUUID()}.txt`)
      return { sample, source, worktree, errFile }
    }

    const SCRIPTS: Record<'bash' | 'zsh' | 'fish', string> = {
      bash: `
        eval "$(port shell-hook bash)"
        cd "$SRC"
        port enter x 2> "$ERR_FILE"
        echo "AFTER_PWD=$PWD"
        echo "NOTICE=$(tr '\\n' ' ' < "$ERR_FILE")"
      `,
      zsh: `
        eval "$(port shell-hook zsh)"
        cd "$SRC"
        port enter x 2> "$ERR_FILE"
        echo "AFTER_PWD=$PWD"
        echo "NOTICE=$(tr '\\n' ' ' < "$ERR_FILE")"
      `,
      fish: `
        port shell-hook fish | source
        cd $SRC
        port enter x 2> $ERR_FILE
        echo "AFTER_PWD="(pwd)
        echo "NOTICE="(string join ' ' (cat $ERR_FILE))
      `,
    }

    function runHook(shell: 'bash' | 'zsh' | 'fish', source: string, errFile: string) {
      // --no-config keeps a user's fish config from putting another `port` ahead of the test wrapper
      const args = shell === 'fish' ? ['--no-config', '-c', SCRIPTS[shell]] : ['-c', SCRIPTS[shell]]
      const output = execFileSync(shell, args, {
        encoding: 'utf-8',
        env: { ...env, SRC: source, ERR_FILE: errFile },
        timeout: TIMEOUT,
      })
      return parseOutput(output)
    }

    for (const shell of ['bash', 'zsh', 'fish'] as const) {
      test(
        `${shell}: lands in the same relative directory, including spaces and apostrophes`,
        async () => {
          const { sample, source, worktree, errFile } = await setup({
            sourceDir: PRESERVED_DIR,
            targetDir: PRESERVED_DIR,
          })
          try {
            const vars = runHook(shell, source, errFile)
            expect(vars.NOTICE).toContain('the same directory you were in before')
            expect(vars.AFTER_PWD).toBe(join(worktree, PRESERVED_DIR))
          } finally {
            await sample.cleanup()
          }
        },
        TIMEOUT
      )
    }

    test(
      'falls back to the worktree root with a notice when the directory is missing',
      async () => {
        const { sample, source, worktree, errFile } = await setup({ sourceDir: 'apps/web' })
        try {
          const vars = runHook('bash', source, errFile)
          expect(vars.AFTER_PWD).toBe(worktree)
          expect(vars.NOTICE).toContain('apps/web does not exist in the target worktree')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'falls back to the worktree root when the target path is a file',
      async () => {
        const { sample, source, worktree, errFile } = await setup({
          sourceDir: 'apps',
          targetFile: 'apps',
        })
        try {
          const vars = runHook('bash', source, errFile)
          expect(vars.AFTER_PWD).toBe(worktree)
          expect(vars.NOTICE).toContain('apps is not a directory in the target worktree')
          expect(vars.NOTICE).not.toContain('does not exist')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'enters the worktree root quietly when run from the repo root',
      async () => {
        const { sample, worktree, errFile } = await setup({ sourceDir: 'apps' })
        try {
          const vars = runHook('bash', realpathSync(sample.dir), errFile)
          expect(vars.AFTER_PWD).toBe(worktree)
          expect(vars.NOTICE).not.toMatch(/same directory|worktree root instead/)
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'without the shell hook, prints a usable quoted cd command for the preserved directory',
      async () => {
        const { sample, source, worktree } = await setup({
          sourceDir: PRESERVED_DIR,
          targetDir: PRESERVED_DIR,
        })
        try {
          const result = spawnSync('port', ['enter', 'x'], { cwd: source, encoding: 'utf-8', env })
          expect(result.status).toBe(0)
          const hint = result.stderr.split('\n').find(line => line.includes('Run: cd '))
          expect(hint).toBeDefined()
          const command = hint!.slice(hint!.indexOf('Run: cd ') + 'Run: cd '.length)
          const pwd = execFileSync('bash', ['-c', `cd ${command} && pwd -P`], {
            encoding: 'utf-8',
          }).trim()
          expect(pwd).toBe(join(worktree, PRESERVED_DIR))
          expect(result.stdout.trim()).toBe('')
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
