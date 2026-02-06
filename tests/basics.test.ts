import { test, expect } from 'vitest'
import { renderCLI } from './utils'

test('Running without any arguments shows the help message', async () => {
  const { findByText } = await renderCLI()

  const instance = await findByText('Usage:')
  expect(instance).toBeInTheConsole()
})

test('Running with --help shows the help message', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('Usage:')
  expect(instance).toBeInTheConsole()
})

test('Remove command help includes --force option', async () => {
  const { findByText } = await renderCLI(['rm', '--help'])

  const instance = await findByText('-f, --force')
  expect(instance).toBeInTheConsole()
})
