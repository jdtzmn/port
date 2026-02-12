import { test, expect } from 'vitest'
import { execAsync } from '../src/lib/exec'
import { renderCLI, prepareSample } from './utils'

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

test('Help includes the status command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('status')
  expect(instance).toBeInTheConsole()
})

test('Help includes the kill command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('kill [port]')
  expect(instance).toBeInTheConsole()
})

test('Help includes the cleanup command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('cleanup')
  expect(instance).toBeInTheConsole()
})

test('Help includes the enter command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('enter [options] <branch>')
  expect(instance).toBeInTheConsole()
})

test('Help includes the onboard command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('onboard')
  expect(instance).toBeInTheConsole()
})

test('Help includes the task command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('task')
  expect(instance).toBeInTheConsole()
})

test('Help includes the remote command', async () => {
  const { findByText } = await renderCLI(['--help'])

  const instance = await findByText('remote')
  expect(instance).toBeInTheConsole()
})

test('Task help includes apply command', async () => {
  const { findByText } = await renderCLI(['task', '--help'])

  const instance = await findByText('apply [options] <id>')
  expect(instance).toBeInTheConsole()
})

test('Task help includes logs/watch/wait/cancel/artifacts commands', async () => {
  const { findByText } = await renderCLI(['task', '--help'])

  expect(await findByText('logs [options] <id>')).toBeInTheConsole()
  expect(await findByText('watch [options]')).toBeInTheConsole()
  expect(await findByText('wait [options] <id>')).toBeInTheConsole()
  expect(await findByText('resume <id>')).toBeInTheConsole()
  expect(await findByText('cancel <id>')).toBeInTheConsole()
  expect(await findByText('artifacts <id>')).toBeInTheConsole()
  expect(await findByText('events [options]')).toBeInTheConsole()
})

test('Shows a hint when command name collides with a branch', async () => {
  const sample = await prepareSample('simple-server', { initWithConfig: true })

  try {
    await execAsync('git branch status', { cwd: sample.dir })

    const { findByText } = await renderCLI(['status'], sample.dir)
    const instance = await findByText(
      'Hint: branch "status" matches a command. Use "port enter status".'
    )
    expect(instance).toBeInTheConsole()
  } finally {
    await sample.cleanup()
  }
})
