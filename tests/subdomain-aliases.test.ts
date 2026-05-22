import { describe, expect, test } from 'vitest'
import { execPortAsync, fetchWithTimeout, prepareSample, safeDown } from './utils'

const TIMEOUT = 240000

async function fetchTextUntilReady(url: string, expectedText: string): Promise<string> {
  const start = Date.now()

  while (Date.now() - start < TIMEOUT) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.status === 200) {
        const text = await response.text()
        if (text.includes(expectedText)) {
          return text
        }
      }
    } catch {
      // Not ready yet.
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

describe('service-name subdomain aliases', () => {
  test(
    'routes a single-port service name alias to the app',
    async () => {
      const sample = await prepareSample('nextjs-app', { initWithConfig: true })

      try {
        await execPortAsync(['up'], sample.dir)

        const branchHost = new URL(sample.urlWithPort(3000)).hostname
        const canonicalUrl = `${sample.urlWithPort(3000)}/api/id`
        const aliasUrl = `http://app.${branchHost}/api/id`

        const canonical = await fetchTextUntilReady(canonicalUrl, 'id')
        const alias = await fetchTextUntilReady(aliasUrl, 'id')

        expect(alias).toBe(canonical)
      } finally {
        await safeDown(sample.dir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'routes the service alias to the first published port for multi-port services',
    async () => {
      const sample = await prepareSample('multi-port-server', { initWithConfig: true })

      try {
        await execPortAsync(['up'], sample.dir)

        const branchHost = new URL(sample.urlWithPort(3000)).hostname
        const aliasUrl = `http://app.${branchHost}`
        const primaryUrl = sample.urlWithPort(3000)

        const alias = await fetchTextUntilReady(aliasUrl, 'primary')
        const primary = await fetchTextUntilReady(primaryUrl, 'primary')

        expect(alias).toBe('primary')
        expect(primary).toBe('primary')
      } finally {
        await safeDown(sample.dir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})
