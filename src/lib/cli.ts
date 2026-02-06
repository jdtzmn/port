import * as output from './output.ts'

interface CliErrorOptions {
  exitCode?: number
  alreadyReported?: boolean
}

export class CliError extends Error {
  readonly exitCode: number
  readonly alreadyReported: boolean

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message)
    this.name = 'CliError'
    this.exitCode = options.exitCode ?? 1
    this.alreadyReported = options.alreadyReported ?? false
  }
}

export function failWithError(message: string, exitCode = 1): never {
  output.error(message)
  throw new CliError(message, { exitCode, alreadyReported: true })
}

export function handleCliError(error: unknown): never {
  if (error instanceof CliError) {
    if (!error.alreadyReported && error.message) {
      output.error(error.message)
    }
    process.exit(error.exitCode)
  }

  if (error instanceof Error) {
    output.error(error.message)
    process.exit(1)
  }

  output.error('An unexpected error occurred')
  process.exit(1)
}
