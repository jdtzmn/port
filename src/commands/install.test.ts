import { test, expect, vi } from 'vitest'
import { renderCLI } from '../../tests/utils'
import * as dns from '../lib/dns'

test('Running install command confirms DNS is installed', async () => {
  // Mock checkDns to return true (DNS already configured)
  vi.spyOn(dns, 'checkDns').mockResolvedValue(true)

  const { findByText } = await renderCLI(['install'])

  const instance = await findByText('DNS is already configured for *.port domains')
  expect(instance).toBeInTheConsole()
})
