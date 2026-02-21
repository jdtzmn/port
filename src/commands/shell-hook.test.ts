import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../lib/output.ts', () => ({
  error: mocks.error,
  info: mocks.info,
}))

import { shellHook } from './shell-hook.ts'

describe('shell-hook command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('generates bash hook with port function', () => {
    shellHook('bash')

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    // Should define a port() function
    expect(output).toContain('port()')

    // Should use `command port` to avoid recursion
    expect(output).toContain('command port')

    // Should use temp file sideband with __PORT_EVAL and __PORT_SHELL
    expect(output).toContain('mktemp')
    expect(output).toContain('__PORT_EVAL')
    expect(output).toContain('__PORT_SHELL=bash')

    // Should eval the contents of the eval file
    expect(output).toContain('eval')
    expect(output).toContain('cat')

    // Should clean up the temp file
    expect(output).toContain('rm -f')

    // Should NOT use --shell-helper flag or 2>/dev/tty
    expect(output).not.toContain('--shell-helper')
    expect(output).not.toContain('2>/dev/tty')
  })

  test('generates zsh hook with port function', () => {
    shellHook('zsh')

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    expect(output).toContain('port()')
    expect(output).toContain('command port')
    expect(output).toContain('__PORT_SHELL=zsh')
  })

  test('generates fish hook with port function', () => {
    shellHook('fish')

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    // Should define a fish function
    expect(output).toContain('function port')
    expect(output).toContain('end')

    // Should use `command port` to avoid recursion
    expect(output).toContain('command port')

    // Should use temp file sideband
    expect(output).toContain('mktemp')
    expect(output).toContain('__PORT_EVAL')
    expect(output).toContain('__PORT_SHELL fish')

    // Should NOT use --shell-helper flag or 2>/dev/tty
    expect(output).not.toContain('--shell-helper')
    expect(output).not.toContain('2>/dev/tty')
  })

  test('exits with error for unsupported shell', () => {
    expect(() => shellHook('powershell')).toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('Unsupported shell: powershell')
    expect(mocks.info).toHaveBeenCalledWith('Supported shells: bash, zsh, fish')
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  test('exits with error for empty shell name', () => {
    expect(() => shellHook('')).toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('Unsupported shell: ')
  })

  test('bash hook handles exit codes correctly', () => {
    shellHook('bash')

    const output = stdoutSpy.mock.calls[0][0] as string

    // Should capture and return the exit status
    expect(output).toContain('__port_status=$?')
    expect(output).toContain('return $__port_status')
  })

  test('fish hook handles exit codes correctly', () => {
    shellHook('fish')

    const output = stdoutSpy.mock.calls[0][0] as string

    // Should capture and return the exit status
    expect(output).toContain('set -l __port_status $status')
    expect(output).toContain('return $__port_status')
  })

  test('bash hook only evals on success with output', () => {
    shellHook('bash')

    const output = stdoutSpy.mock.calls[0][0] as string

    // Should check both exit code and non-empty output before eval
    expect(output).toContain('$__port_status -eq 0')
    expect(output).toContain('-n "$__port_cmds"')
  })

  test('fish hook only evals on success with output', () => {
    shellHook('fish')

    const output = stdoutSpy.mock.calls[0][0] as string

    // Should check both exit code and non-empty output before eval
    expect(output).toContain('test $__port_status -eq 0')
    expect(output).toContain('test -n "$__port_cmds"')
  })

  test('hook intercepts all commands (no passthrough list)', () => {
    shellHook('bash')
    const bashOutput = stdoutSpy.mock.calls[0][0] as string

    // Should NOT contain a case/esac or passthrough list —
    // the sideband mechanism means all commands go through the hook
    expect(bashOutput).not.toContain('case')
    expect(bashOutput).not.toContain('esac')

    stdoutSpy.mockClear()
    shellHook('fish')
    const fishOutput = stdoutSpy.mock.calls[0][0] as string

    // Fish hook should not contain a passthrough list
    expect(fishOutput).not.toContain('__port_passthrough')
    expect(fishOutput).not.toContain('contains')
  })
})
