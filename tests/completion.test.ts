import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { prepareSample } from './utils'

const TIMEOUT = 30_000
const CLI_ENTRY = resolve(__dirname, '../src/index.ts')

describe('shell completion', () => {
  let portBinDir: string
  let env: NodeJS.ProcessEnv

  beforeAll(() => {
    // Create a temporary `port` wrapper so `command port` works in completion scripts
    portBinDir = mkdtempSync(join(tmpdir(), 'port-bin-'))
    const portScript = join(portBinDir, 'port')
    writeFileSync(portScript, `#!/usr/bin/env bash\nexec bun "${CLI_ENTRY}" "$@"\n`)
    chmodSync(portScript, 0o755)
    env = { ...process.env, PATH: `${portBinDir}:${process.env.PATH}` }
  })

  afterAll(async () => {
    await rm(portBinDir, { recursive: true, force: true })
  })

  // ── Syntax validation ────────────────────────────────────────────────

  describe('syntax validation', () => {
    test('bash completion script is valid bash syntax', () => {
      const script = execSync(`bun "${CLI_ENTRY}" completion bash`, {
        encoding: 'utf-8',
        env,
      })
      execSync(`bash -n <<'SCRIPT'\n${script}\nSCRIPT`, { encoding: 'utf-8' })
    })

    test('zsh completion script is valid zsh syntax', () => {
      const script = execSync(`bun "${CLI_ENTRY}" completion zsh`, {
        encoding: 'utf-8',
        env,
      })
      execSync(`zsh -n <<'SCRIPT'\n${script}\nSCRIPT`, { encoding: 'utf-8' })
    })

    test('fish completion script is valid fish syntax', () => {
      const script = execSync(`bun "${CLI_ENTRY}" completion fish`, {
        encoding: 'utf-8',
        env,
      })
      execSync(`fish --no-execute -c ${shellEscape(script)}`, {
        encoding: 'utf-8',
      })
    })
  })

  // ── Bash functional tests ────────────────────────────────────────────

  describe('bash: functional completion', () => {
    test(
      'completes subcommands at first position',
      () => {
        const completions = bashComplete(env, '/', 'port', '')
        expect(completions).toContain('enter')
        expect(completions).toContain('remove')
        expect(completions).toContain('list')
        expect(completions).toContain('ls')
        expect(completions).toContain('up')
        expect(completions).toContain('down')
        expect(completions).toContain('status')
        expect(completions).toContain('completion')
      },
      TIMEOUT
    )

    test(
      'completes branch names for enter',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          // Create worktrees by making directories in .port/trees/
          mkdirSync(join(sample.dir, '.port', 'trees', 'feature-alpha'), { recursive: true })
          mkdirSync(join(sample.dir, '.port', 'trees', 'bugfix-beta'), { recursive: true })

          const completions = bashComplete(env, sample.dir, 'port', 'enter', '')
          expect(completions).toContain('feature-alpha')
          expect(completions).toContain('bugfix-beta')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for remove',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'to-remove'), { recursive: true })

          const completions = bashComplete(env, sample.dir, 'port', 'remove', '')
          expect(completions).toContain('to-remove')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for rm alias',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'rm-target'), { recursive: true })

          const completions = bashComplete(env, sample.dir, 'port', 'rm', '')
          expect(completions).toContain('rm-target')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'includes branch names at first position (port <branch>)',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'my-feature'), { recursive: true })

          const completions = bashComplete(env, sample.dir, 'port', '')
          // Should include both subcommands and branch names
          expect(completions).toContain('enter')
          expect(completions).toContain('my-feature')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes flags for commands with options',
      () => {
        const completions = bashComplete(env, '/', 'port', 'remove', '-')
        expect(completions).toContain('-f')
        expect(completions).toContain('--force')
        expect(completions).toContain('--keep-branch')
      },
      TIMEOUT
    )
  })

  // ── Zsh functional tests ─────────────────────────────────────────────

  describe('zsh: functional completion', () => {
    test(
      'completes subcommands at first position',
      () => {
        const completions = zshComplete(env, '/', 'port ')
        expect(completions).toContain('enter')
        expect(completions).toContain('remove')
        expect(completions).toContain('list')
        expect(completions).toContain('up')
        expect(completions).toContain('completion')
      },
      TIMEOUT
    )

    test(
      'completes branch names for enter',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'zsh-feature'), { recursive: true })

          const completions = zshComplete(env, sample.dir, 'port enter ')
          expect(completions).toContain('zsh-feature')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for remove',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'zsh-remove-target'), { recursive: true })

          const completions = zshComplete(env, sample.dir, 'port remove ')
          expect(completions).toContain('zsh-remove-target')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for rm alias',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'zsh-rm-target'), { recursive: true })

          const completions = zshComplete(env, sample.dir, 'port rm ')
          expect(completions).toContain('zsh-rm-target')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'includes branch names at first position',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'zsh-branch'), { recursive: true })

          const completions = zshComplete(env, sample.dir, 'port ')
          expect(completions).toContain('enter')
          expect(completions).toContain('zsh-branch')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })

  // ── Fish functional tests ────────────────────────────────────────────

  describe('fish: functional completion', () => {
    test(
      'completes subcommands at first position',
      () => {
        const completions = fishComplete(env, '/', 'port ')
        expect(completions).toContain('enter')
        expect(completions).toContain('remove')
        expect(completions).toContain('list')
        expect(completions).toContain('up')
        expect(completions).toContain('completion')
      },
      TIMEOUT
    )

    test(
      'completes branch names for enter',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'fish-feature'), { recursive: true })

          const completions = fishComplete(env, sample.dir, 'port enter ')
          expect(completions).toContain('fish-feature')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for remove',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'fish-remove-target'), { recursive: true })

          const completions = fishComplete(env, sample.dir, 'port remove ')
          expect(completions).toContain('fish-remove-target')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'completes branch names for rm alias',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'fish-rm-target'), { recursive: true })

          const completions = fishComplete(env, sample.dir, 'port rm ')
          expect(completions).toContain('fish-rm-target')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'includes branch names at first position',
      async () => {
        const sample = await prepareSample('db-and-server', { initWithConfig: true })
        try {
          mkdirSync(join(sample.dir, '.port', 'trees', 'fish-branch'), { recursive: true })

          const completions = fishComplete(env, sample.dir, 'port ')
          expect(completions).toContain('enter')
          expect(completions).toContain('fish-branch')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })

  // ── Original (unsanitized) branch name completions ────────────────────

  describe('original branch name completions', () => {
    /**
     * Create a sample project with a real git worktree whose branch name
     * contains `/` characters. This ensures `git worktree list --porcelain`
     * returns the original name alongside the sanitized directory name.
     */
    async function prepareSampleWithSlashBranch() {
      const sample = await prepareSample('db-and-server', { initWithConfig: true })
      // Create a real git worktree with a slash-containing branch name
      execSync(
        `git worktree add "${join(sample.dir, '.port', 'trees', 'jacob-test-sanitation')}" -b jacob/test/sanitation`,
        { cwd: sample.dir, encoding: 'utf-8' }
      )
      return sample
    }

    test(
      'bash: completes both sanitized and original branch names',
      async () => {
        const sample = await prepareSampleWithSlashBranch()
        try {
          const completions = bashComplete(env, sample.dir, 'port', 'enter', '')
          expect(completions).toContain('jacob-test-sanitation')
          expect(completions).toContain('jacob/test/sanitation')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'zsh: completes both sanitized and original branch names',
      async () => {
        const sample = await prepareSampleWithSlashBranch()
        try {
          const completions = zshComplete(env, sample.dir, 'port enter ')
          expect(completions).toContain('jacob-test-sanitation')
          expect(completions).toContain('jacob/test/sanitation')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )

    test(
      'fish: completes both sanitized and original branch names',
      async () => {
        const sample = await prepareSampleWithSlashBranch()
        try {
          const completions = fishComplete(env, sample.dir, 'port enter ')
          expect(completions).toContain('jacob-test-sanitation')
          expect(completions).toContain('jacob/test/sanitation')
        } finally {
          await sample.cleanup()
        }
      },
      TIMEOUT
    )
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────

/** Escape a string for use as a single shell argument */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/**
 * Run bash completion and return the list of completions.
 *
 * We source the completion script, set up COMP_WORDS / COMP_CWORD,
 * call the completion function, and print COMPREPLY.
 */
function bashComplete(env: NodeJS.ProcessEnv, cwd: string, ...words: string[]): string[] {
  const cliEntry = resolve(__dirname, '../src/index.ts')
  // The last word is the word being completed
  const cword = words.length - 1

  const wordsArray = words.map(w => `"${w}"`).join(' ')

  const script = `
    # Load bash completion helpers
    source /opt/homebrew/etc/profile.d/bash_completion.sh 2>/dev/null || \
    source /usr/share/bash-completion/bash_completion 2>/dev/null || \
    source /etc/bash_completion 2>/dev/null || true

    # Source port completions
    eval "$(bun "${cliEntry}" completion bash)"

    # Set up completion variables
    COMP_WORDS=(${wordsArray})
    COMP_CWORD=${cword}
    COMP_LINE="${words.join(' ')}"
    COMP_POINT=${words.join(' ').length}

    # Run completion
    _port_completions

    # Print results
    printf '%s\\n' "\${COMPREPLY[@]}"
  `

  try {
    const result = execSync(`bash -c ${shellEscape(script)}`, {
      encoding: 'utf-8',
      env,
      cwd,
      timeout: 15_000,
    })
    return result.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Run zsh completion and return the list of completions.
 *
 * Zsh completion testing is done by overriding compadd to capture
 * the arguments passed to it, which are the completion candidates.
 */
function zshComplete(env: NodeJS.ProcessEnv, cwd: string, commandLine: string): string[] {
  const cliEntry = resolve(__dirname, '../src/index.ts')

  // Split command line into words for zsh (1-indexed, CURRENT is position of cursor word)
  const words = commandLine.trimEnd().split(/\s+/)
  if (commandLine.endsWith(' ')) {
    words.push('')
  }
  const current = words.length

  const wordsArray = words.map(w => `"${w}"`).join(' ')

  const script = `
    # Stub compdef (not available outside zsh completion system)
    compdef() { :; }

    # Override compadd to capture completions
    __captured_completions=()
    compadd() {
      local skip=0
      local -a items=()
      for arg in "$@"; do
        if [[ $skip -eq 1 ]]; then
          skip=0
          continue
        fi
        case "$arg" in
          --) ;;
          -*) skip=1 ;;
          *) items+=("$arg") ;;
        esac
      done
      __captured_completions+=("\${items[@]}")
    }

    # Source the completion script
    eval "$(bun "${cliEntry}" completion zsh)"

    # Set up zsh completion state
    words=(${wordsArray})
    CURRENT=${current}

    # Call the completion function
    _port

    # Print captured completions
    printf '%s\\n' "\${__captured_completions[@]}"
  `

  try {
    const result = execSync(`zsh -c ${shellEscape(script)}`, {
      encoding: 'utf-8',
      env,
      cwd,
      timeout: 15_000,
    })
    return result.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Run fish completion and return the list of completions.
 *
 * Fish has native support for testing completions via `complete --do-complete`.
 * We must explicitly set PATH inside the fish script because fish may not
 * reliably inherit PATH from the env parameter of execSync.
 */
function fishComplete(env: NodeJS.ProcessEnv, cwd: string, commandLine: string): string[] {
  const cliEntry = resolve(__dirname, '../src/index.ts')

  // Extract the port bin dir from PATH (first entry is our temp dir)
  const pathValue = env.PATH ?? ''

  const script = [
    'set -gx PATH ' +
      pathValue
        .split(':')
        .map(p => shellEscape(p))
        .join(' '),
    'bun "' + cliEntry + '" completion fish | source',
    'complete --do-complete ' + shellEscape(commandLine),
  ].join('\n')

  try {
    const result = execSync('fish -c ' + shellEscape(script), {
      encoding: 'utf-8',
      env,
      cwd,
      timeout: 15_000,
    })
    // Fish returns "completion\tdescription" format, extract just the completion part
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('\t')[0] ?? '')
  } catch {
    return []
  }
}
