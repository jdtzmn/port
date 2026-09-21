import ora from 'ora'

type ProgressText<T> = string | ((result: T) => string)

export interface ProgressOptions<T> {
  text: string
  successText?: ProgressText<T>
  failureText?: ProgressText<T>
  isSuccess?: (result: T) => boolean
}

function resolveText<T>(text: ProgressText<T>, result: T): string {
  return typeof text === 'function' ? text(result) : text
}

/**
 * Show progress for a bounded operation without taking ownership of stdout.
 *
 * Callers must not use this around interactive prompts or work that streams
 * child-process output, because those operations own the terminal while active.
 */
export async function withProgress<T>(
  { text, successText = text, failureText = text, isSuccess }: ProgressOptions<T>,
  work: () => Promise<T>
): Promise<T> {
  const spinner = ora({
    text,
    stream: process.stderr,
    isEnabled:
      Boolean(process.stderr.isTTY) && (process.stderr.columns ?? 0) > 0 && !process.env.CI,
  })

  spinner.start()

  try {
    const result = await work()
    if (isSuccess?.(result) === false) spinner.warn(resolveText(failureText, result))
    else spinner.succeed(resolveText(successText, result))
    return result
  } catch (error) {
    spinner.stop()
    throw error
  }
}
