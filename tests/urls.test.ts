import { describe, test, expect } from 'vitest'
import { prepareSample, execPortAsync } from './utils'

describe('port urls command', () => {
  test('shows URLs with stopped status when services are not running', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })

    try {
      const result = await execPortAsync(['urls'], sample.dir)

      // Should show both services with their URLs
      expect(result.stderr).toContain(sample.urlWithPort(3000))
      expect(result.stderr).toContain(sample.urlWithPort(5432))

      // Should show stopped status for both services (not started)
      expect(result.stderr).toContain('(stopped)')
    } finally {
      await sample.cleanup()
    }
  })

  test('filters to a single service when service name is provided', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })

    try {
      const result = await execPortAsync(['urls', 'app'], sample.dir)

      // Should show the app service URL
      expect(result.stderr).toContain(sample.urlWithPort(3000))

      // Should NOT show postgres URL
      expect(result.stderr).not.toContain(sample.urlWithPort(5432))

      // Should show stopped status
      expect(result.stderr).toContain('(stopped)')
    } finally {
      await sample.cleanup()
    }
  })

  test('errors when service name is not found', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })

    try {
      const result = await execPortAsync(['urls', 'nonexistent'], sample.dir).catch(e => e)
      expect(result.stderr).toContain('Service "nonexistent" not found')
    } finally {
      await sample.cleanup()
    }
  })

  test('errors when port is not initialized', async () => {
    const sample = await prepareSample('db-and-server', { gitInit: true })

    try {
      const result = await execPortAsync(['urls'], sample.dir).catch(e => e)
      expect(result.stderr).toContain('Port not initialized')
    } finally {
      await sample.cleanup()
    }
  })

  test('shows header with worktree name', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })

    try {
      const result = await execPortAsync(['urls'], sample.dir)
      expect(result.stderr).toContain('Service URLs for')
    } finally {
      await sample.cleanup()
    }
  })
})
