import ora from 'ora'

export interface ProgressOptions {
  text: string
  successText?: string
}

/**
 * Show progress for a bounded operation without taking ownership of stdout.
 *
 * Callers must not use this around interactive prompts or work that streams
 * child-process output, because those operations own the terminal while active.
 */
export async function withProgress<T>(
  { text, successText = text }: ProgressOptions,
  work: () => Promise<T>
): Promise<T> {
  const spinner = ora({
    text,
    stream: process.stderr,
    isEnabled: Boolean(process.stderr.isTTY) && !process.env.CI,
  })

  spinner.start()

  try {
    const result = await work()
    spinner.succeed(successText)
    return result
  } catch (error) {
    spinner.stop()
    throw error
  }
}
