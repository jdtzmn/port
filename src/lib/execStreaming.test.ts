import { describe, expect, test } from 'vitest'
import { execStreaming } from './exec.ts'

describe('execStreaming', () => {
  test('streams stdout and stderr lines', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    const result = await execStreaming(
      `bun -e "console.log('out-1'); console.log('out-2'); console.error('err-1')"`,
      {
        onStdoutLine: line => stdout.push(line),
        onStderrLine: line => stderr.push(line),
      }
    )

    expect(result.exitCode).toBe(0)
    expect(stdout).toEqual(['out-1', 'out-2'])
    expect(stderr).toEqual(['err-1'])
  })

  test('supports cancellation through AbortSignal', { timeout: 15000 }, async () => {
    const stdout: string[] = []
    const controller = new AbortController()

    const run = execStreaming(`while true; do echo tick; sleep 0.05; done`, {
      signal: controller.signal,
      onStdoutLine: line => stdout.push(line),
    })

    setTimeout(() => controller.abort(), 140)

    const result = await run
    expect(result.exitCode).toBe(130)
    expect(stdout.length).toBeGreaterThan(0)
  })
})
