import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, lstatSync } from 'fs'
import { mkdir, writeFile, chmod, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getHooksDir,
  getHookPath,
  getLogsDir,
  getLogPath,
  hookExists,
  appendLog,
  runHook,
  runPostCreateHook,
  type HookEnv,
} from './hooks.ts'
import { PORT_DIR, HOOKS_DIR, LOGS_DIR, LATEST_LOG } from './config.ts'

/**
 * Helper to create a temp directory for testing
 */
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'port-hooks-test-'))
}

/**
 * Helper to create an executable bash script
 */
async function createExecutableScript(dir: string, name: string, content: string): Promise<string> {
  const scriptPath = join(dir, name)
  await writeFile(scriptPath, content)
  await chmod(scriptPath, 0o755)
  return scriptPath
}

/**
 * Helper to set up a mock repo with .port directory structure
 */
async function setupMockRepo(): Promise<string> {
  const repoRoot = createTempDir()
  const portDir = join(repoRoot, PORT_DIR)
  const hooksDir = join(portDir, HOOKS_DIR)

  await mkdir(hooksDir, { recursive: true })

  return repoRoot
}

// ============================================================================
// Path Helper Functions (Unit Tests)
// ============================================================================

describe('Path helper functions', () => {
  const repoRoot = '/fake/repo/root'

  test('getHooksDir returns correct path', () => {
    expect(getHooksDir(repoRoot)).toBe(`${repoRoot}/${PORT_DIR}/${HOOKS_DIR}`)
  })

  test('getHookPath returns correct path for hook name', () => {
    expect(getHookPath(repoRoot, 'post-create')).toBe(
      `${repoRoot}/${PORT_DIR}/${HOOKS_DIR}/post-create.sh`
    )
  })

  test('getLogsDir returns correct path', () => {
    expect(getLogsDir(repoRoot)).toBe(`${repoRoot}/${PORT_DIR}/${LOGS_DIR}`)
  })

  test('getLogPath returns correct path', () => {
    expect(getLogPath(repoRoot)).toBe(`${repoRoot}/${PORT_DIR}/${LOGS_DIR}/${LATEST_LOG}`)
  })
})

// ============================================================================
// hookExists (Integration Tests)
// ============================================================================

describe('hookExists', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await setupMockRepo()
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('returns false when hook file does not exist', async () => {
    const result = await hookExists(repoRoot, 'post-create')
    expect(result).toBe(false)
  })

  test('returns false when hook file exists but is not executable', async () => {
    const hookPath = getHookPath(repoRoot, 'post-create')
    await writeFile(hookPath, '#!/bin/bash\necho "hello"')
    await chmod(hookPath, 0o644) // Not executable

    const result = await hookExists(repoRoot, 'post-create')
    expect(result).toBe(false)
  })

  test('returns true when hook file exists and is executable', async () => {
    const hookPath = getHookPath(repoRoot, 'post-create')
    await writeFile(hookPath, '#!/bin/bash\necho "hello"')
    await chmod(hookPath, 0o755) // Executable

    const result = await hookExists(repoRoot, 'post-create')
    expect(result).toBe(true)
  })
})

// ============================================================================
// appendLog (Integration Tests)
// ============================================================================

describe('appendLog', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await setupMockRepo()
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('creates logs directory if it does not exist', async () => {
    const logsDir = getLogsDir(repoRoot)
    expect(existsSync(logsDir)).toBe(false)

    await appendLog(repoRoot, 'test-branch', 'post-create', 'Test message')

    expect(existsSync(logsDir)).toBe(true)
  })

  test('appends formatted log line with timestamp and prefix', async () => {
    await appendLog(repoRoot, 'my-feature', 'post-create', 'Hook started')

    const logPath = getLogPath(repoRoot)
    const content = readFileSync(logPath, 'utf-8')

    // Check format: [YYYY-MM-DD HH:MM:SS] [branch hookName] message
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/)
    expect(content).toContain('[my-feature post-create]')
    expect(content).toContain('Hook started')
    expect(content.endsWith('\n')).toBe(true)
  })

  test('appends multiple messages to the same file', async () => {
    await appendLog(repoRoot, 'branch1', 'post-create', 'Message 1')
    await appendLog(repoRoot, 'branch2', 'post-create', 'Message 2')
    await appendLog(repoRoot, 'branch1', 'post-create', 'Message 3')

    const logPath = getLogPath(repoRoot)
    const content = readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Message 1')
    expect(lines[1]).toContain('Message 2')
    expect(lines[2]).toContain('Message 3')
  })
})

// ============================================================================
// runHook (Integration Tests)
// ============================================================================

describe('runHook', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await setupMockRepo()
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('executes hook and returns success for exit code 0', async () => {
    await createExecutableScript(getHooksDir(repoRoot), 'post-create.sh', '#!/bin/bash\nexit 0')

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    const result = await runHook(repoRoot, 'post-create', env, 'test-branch')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  test('returns failure for non-zero exit codes', async () => {
    await createExecutableScript(getHooksDir(repoRoot), 'post-create.sh', '#!/bin/bash\nexit 42')

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    const result = await runHook(repoRoot, 'post-create', env, 'test-branch')

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(42)
  })

  test('passes PORT_ROOT_PATH environment variable to hook', async () => {
    // Script writes env var to a file so we can verify
    // Use repoRoot as cwd (via PORT_ROOT_PATH) so file is created there
    const outputFile = join(repoRoot, 'env-output.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\necho "$PORT_ROOT_PATH" > "env-output.txt"`
    )

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const content = readFileSync(outputFile, 'utf-8').trim()
    expect(content).toBe(repoRoot)
  })

  test('passes PORT_WORKTREE_PATH environment variable to hook', async () => {
    // Create a worktree directory so the cwd is valid
    const worktreePath = join(repoRoot, 'test-worktree')
    await mkdir(worktreePath, { recursive: true })

    const outputFile = join(worktreePath, 'env-output.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\necho "$PORT_WORKTREE_PATH" > "env-output.txt"`
    )

    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
    }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const content = readFileSync(outputFile, 'utf-8').trim()
    // Handle macOS /private/var vs /var symlink
    expect(content.endsWith(worktreePath.replace(/^\/private/, ''))).toBe(true)
  })

  test('passes PORT_BRANCH environment variable to hook', async () => {
    const outputFile = join(repoRoot, 'env-output.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\necho "$PORT_BRANCH" > "${outputFile}"`
    )

    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_BRANCH: 'feature/my-awesome-branch',
    }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const content = readFileSync(outputFile, 'utf-8').trim()
    expect(content).toBe('feature/my-awesome-branch')
  })

  test('sets working directory to PORT_WORKTREE_PATH', async () => {
    // Create a worktree directory
    const worktreePath = join(repoRoot, 'worktree')
    await mkdir(worktreePath, { recursive: true })

    const outputFile = join(worktreePath, 'cwd-output.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\npwd > "cwd-output.txt"`
    )

    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
    }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const content = readFileSync(outputFile, 'utf-8').trim()
    // Handle macOS /private/var vs /var symlink - check the path ends correctly
    expect(content.endsWith('/worktree')).toBe(true)
  })

  test('falls back to PORT_ROOT_PATH when no worktree path', async () => {
    const outputFile = join(repoRoot, 'cwd-output.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\npwd > "cwd-output.txt"`
    )

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const content = readFileSync(outputFile, 'utf-8').trim()
    // Handle macOS /private/var vs /var symlink - check the path contains our temp dir name
    expect(content).toContain('port-hooks-test-')
  })

  test('captures stdout in log file', async () => {
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      '#!/bin/bash\necho "Hello from stdout"'
    )

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('Hello from stdout')
  })

  test('captures stderr in log file', async () => {
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      '#!/bin/bash\necho "Error message" >&2'
    )

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('Error message')
  })

  test('logs hook completion status on success', async () => {
    await createExecutableScript(getHooksDir(repoRoot), 'post-create.sh', '#!/bin/bash\nexit 0')

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('Hook completed (exit code 0)')
  })

  test('logs hook failure status on non-zero exit', async () => {
    await createExecutableScript(getHooksDir(repoRoot), 'post-create.sh', '#!/bin/bash\nexit 1')

    const env: HookEnv = { PORT_ROOT_PATH: repoRoot }
    await runHook(repoRoot, 'post-create', env, 'test-branch')

    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('Hook failed (exit code 1)')
  })
})

// ============================================================================
// Real-world Use Case: .env Symlink
// ============================================================================

describe('Real-world use case: .env symlink', () => {
  let repoRoot: string
  let worktreePath: string

  beforeEach(async () => {
    repoRoot = await setupMockRepo()
    worktreePath = join(repoRoot, '.port', 'trees', 'my-feature')
    await mkdir(worktreePath, { recursive: true })
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('hook can symlink .env from root to worktree', async () => {
    // Create .env file in repo root
    const envContent = 'DATABASE_URL=postgres://localhost:5432/mydb\nAPI_KEY=secret123'
    await writeFile(join(repoRoot, '.env'), envContent)

    // Create hook that symlinks .env
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash
ln -s "$PORT_ROOT_PATH/.env" "$PORT_WORKTREE_PATH/.env"
`
    )

    // Run the hook
    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: 'my-feature',
    }
    const result = await runHook(repoRoot, 'post-create', env, 'my-feature')

    // Verify hook succeeded
    expect(result.success).toBe(true)

    // Verify symlink was created
    const worktreeEnvPath = join(worktreePath, '.env')
    expect(existsSync(worktreeEnvPath)).toBe(true)

    // Verify it's actually a symlink
    const stats = lstatSync(worktreeEnvPath)
    expect(stats.isSymbolicLink()).toBe(true)

    // Verify symlink content matches original
    const linkedContent = readFileSync(worktreeEnvPath, 'utf-8')
    expect(linkedContent).toBe(envContent)
  })

  test('hook can run install script in worktree', async () => {
    // Create a minimal package.json in worktree
    await writeFile(
      join(worktreePath, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    )

    // Create hook that runs npm install
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash
cd "$PORT_WORKTREE_PATH"
echo "Installing dependencies..."
`
    )

    // Run the hook
    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: 'my-feature',
    }
    const result = await runHook(repoRoot, 'post-create', env, 'my-feature')

    expect(result.success).toBe(true)

    // Verify log captured the output
    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('Installing dependencies...')
  })

  test('hook failure prevents worktree setup (simulated)', async () => {
    // Create hook that fails validation
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash
echo "Checking prerequisites..."
echo "ERROR: Required tool not found" >&2
exit 1
`
    )

    const env: HookEnv = {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: 'my-feature',
    }
    const result = await runHook(repoRoot, 'post-create', env, 'my-feature')

    // Hook should fail
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)

    // Error should be logged
    const logContent = readFileSync(getLogPath(repoRoot), 'utf-8')
    expect(logContent).toContain('ERROR: Required tool not found')
    expect(logContent).toContain('Hook failed')
  })
})

// ============================================================================
// runPostCreateHook (Integration Tests)
// ============================================================================

describe('runPostCreateHook', () => {
  let repoRoot: string
  let worktreePath: string

  beforeEach(async () => {
    repoRoot = await setupMockRepo()
    worktreePath = join(repoRoot, '.port', 'trees', 'test-branch')
    await mkdir(worktreePath, { recursive: true })
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('calls runHook with post-create hook name', async () => {
    // Create hook that writes the hook name check
    const outputFile = join(repoRoot, 'hook-check.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash\necho "post-create hook ran" > "${outputFile}"`
    )

    await runPostCreateHook({
      repoRoot,
      worktreePath,
      branch: 'test-branch',
    })

    const content = readFileSync(outputFile, 'utf-8').trim()
    expect(content).toBe('post-create hook ran')
  })

  test('passes environment correctly from options', async () => {
    const outputFile = join(repoRoot, 'env-check.txt')
    await createExecutableScript(
      getHooksDir(repoRoot),
      'post-create.sh',
      `#!/bin/bash
echo "ROOT=$PORT_ROOT_PATH" >> "${outputFile}"
echo "WORKTREE=$PORT_WORKTREE_PATH" >> "${outputFile}"
echo "BRANCH=$PORT_BRANCH" >> "${outputFile}"
`
    )

    await runPostCreateHook({
      repoRoot,
      worktreePath,
      branch: 'feature/test',
    })

    const content = readFileSync(outputFile, 'utf-8')
    expect(content).toContain(`ROOT=${repoRoot}`)
    expect(content).toContain(`WORKTREE=${worktreePath}`)
    expect(content).toContain('BRANCH=feature/test')
  })

  test('returns correct result from hook execution', async () => {
    await createExecutableScript(getHooksDir(repoRoot), 'post-create.sh', '#!/bin/bash\nexit 0')

    const result = await runPostCreateHook({
      repoRoot,
      worktreePath,
      branch: 'test-branch',
    })

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
  })
})
