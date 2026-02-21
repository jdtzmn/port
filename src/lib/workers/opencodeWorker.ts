import { spawn } from 'child_process'
import type { OpenCodeWorkerConfig } from '../../types.ts'
import type { TaskWorker, TaskWorkerContext, TaskWorkerResult } from '../taskWorker.ts'
import { execFileAsync } from '../exec.ts'

/**
 * OpenCode worker implementation.
 *
 * Spawns `opencode run --format json -- <prompt>` in the worktree directory,
 * parses NDJSON events from stdout, extracts the session ID, streams output
 * to artifact logs, and collects commit refs from the worktree.
 */
export class OpenCodeTaskWorker implements TaskWorker {
  readonly id: string
  readonly type = 'opencode' as const
  private config: OpenCodeWorkerConfig

  constructor(id: string, config?: OpenCodeWorkerConfig) {
    this.id = id
    this.config = config ?? {}
  }

  async execute(ctx: TaskWorkerContext): Promise<TaskWorkerResult> {
    const binary = this.config.binary ?? 'opencode'

    // Build command arguments
    const args = ['run', '--format', 'json']
    if (this.config.model) {
      args.push('--model', this.config.model)
    }
    if (this.config.flags) {
      args.push(...this.config.flags)
    }
    args.push('--', ctx.task.title)

    await ctx.appendStdout(
      `opencode:start binary=${binary} model=${this.config.model ?? 'default'}`
    )

    const child = spawn(binary, args, {
      cwd: ctx.worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let sessionId: string | undefined
    let lastError: string | undefined

    // Collect stdout (NDJSON events)
    const stdoutChunks: string[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString())
    })

    // Collect stderr
    const stderrChunks: string[] = []
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString())
    })

    // Wait for exit
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', (err: Error) => reject(err))
      child.on('close', (code: number | null) => resolve(code ?? 1))
    })

    // Parse NDJSON events from stdout
    const rawOutput = stdoutChunks.join('')
    const lines = rawOutput.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(']1337;')) {
        // Skip empty lines and iTerm2 escape sequences
        continue
      }

      try {
        const event = JSON.parse(trimmed)
        if (event.sessionID && !sessionId) {
          sessionId = event.sessionID
        }

        if (event.type === 'text' && event.part?.text) {
          await ctx.appendStdout(event.part.text)
        } else if (event.type === 'error') {
          lastError = event.part?.error ?? event.message ?? 'unknown error'
          await ctx.appendStderr(`opencode:error ${lastError}`)
        } else if (event.type === 'tool_use') {
          const toolName = event.part?.name ?? 'unknown'
          await ctx.appendStdout(`opencode:tool ${toolName}`)
        }
      } catch {
        // Not JSON — might be mixed output; log it as-is
        if (trimmed.length > 0) {
          await ctx.appendStdout(trimmed)
        }
      }
    }

    // Stream stderr
    const stderrOutput = stderrChunks.join('')
    if (stderrOutput.trim()) {
      await ctx.appendStderr(stderrOutput.trim())
    }

    // Check exit code
    if (exitCode !== 0) {
      throw new Error(`opencode exited with code ${exitCode}${lastError ? `: ${lastError}` : ''}`)
    }

    // Collect commit refs from worktree
    const commitRefs = await collectCommitRefs(ctx.worktreePath)

    await ctx.appendStdout(
      `opencode:done session=${sessionId ?? 'none'} commits=${commitRefs.length}`
    )

    return {
      commitRefs,
      opencode: sessionId
        ? {
            sessionId,
            workspaceRef: ctx.worktreePath,
          }
        : undefined,
    }
  }
}

/**
 * Collect commit SHAs from the worktree that are ahead of the base branch.
 * Uses `git log --format=%H` against the first parent branch.
 */
async function collectCommitRefs(worktreePath: string): Promise<string[]> {
  try {
    // Get commits that are in HEAD but not in the first parent branch
    const { stdout } = await execFileAsync('git', ['log', '--format=%H', '--not', '--remotes'], {
      cwd: worktreePath,
    })
    return stdout
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0)
  } catch {
    return []
  }
}
