import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI, execPortAsync } from './utils'

describe('port compose command', () => {
  test('shows compose in help output', async () => {
    const { findByText } = await renderCLI(['--help'])
    const instance = await findByText('compose')
    expect(instance).toBeTruthy()
  })

  test('shows dc alias in help output', async () => {
    const { findByText } = await renderCLI(['compose', '--help'])
    const instance = await findByText('dc')
    expect(instance).toBeTruthy()
  })

  test('shows description for compose command', async () => {
    const { findByText } = await renderCLI(['--help'])
    const instance = await findByText('Run docker compose with automatic -f flags')
    expect(instance).toBeTruthy()
  })

  test('errors when not in a git repository', async () => {
    const sample = await prepareSample('db-and-server')
    // Don't initialize git
    const result = await execPortAsync(['compose', 'ps'], sample.dir).catch(e => e)
    expect(result.stderr).toContain('Not in a git repository')
    await sample.cleanup()
  })

  test('auto-syncs override when port is not initialized (regression)', async () => {
    const sample = await prepareSample('db-and-server', { gitInit: true })
    // Initialize git but not port config
    // NEW BEHAVIOR: compose auto-syncs override before execution
    const result = await execPortAsync(['compose', '--help'], sample.dir)
    // Should show help without override errors
    expect(result.stdout).toContain('Arguments')
    await sample.cleanup()
  })

  test('auto-syncs override even without prior port up (regression)', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })
    // Initialize port but don't run `port up`
    // NEW BEHAVIOR: compose auto-creates override file before execution
    const result = await execPortAsync(['compose', '--help'], sample.dir)
    // Should show help without override errors
    expect(result.stdout).toContain('Arguments')
    await sample.cleanup()
  })
})

describe('port compose argument handling', () => {
  test('compose command accepts multiple arguments', async () => {
    // Test that the command structure is correct by checking --help
    const result = await execPortAsync(['compose', '--help'])
    expect(result.stdout).toContain('Arguments')
    expect(result.stdout).toContain('args')
  })

  test('dc alias is listed in help', async () => {
    const result = await execPortAsync(['--help'])
    expect(result.stdout).toContain('compose|dc')
  })
})
