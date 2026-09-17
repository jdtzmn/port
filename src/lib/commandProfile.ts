export interface CommandProfileSpan {
  name: string
  durationMs: number
}

export interface CommandProfile {
  command: string
  durationMs: number
  spans: CommandProfileSpan[]
}

type Clock = () => number

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

export class CommandProfileRecorder {
  private readonly startedAt: number
  private readonly spans: CommandProfileSpan[] = []

  constructor(
    private readonly command: string,
    private readonly now: Clock = () => performance.now()
  ) {
    this.startedAt = now()
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.now()
    try {
      return await operation()
    } finally {
      this.spans.push({ name, durationMs: roundMilliseconds(this.now() - startedAt) })
    }
  }

  finish(): CommandProfile {
    return {
      command: this.command,
      durationMs: roundMilliseconds(this.now() - this.startedAt),
      spans: this.spans,
    }
  }
}

let activeRecorder: CommandProfileRecorder | undefined

export function isCommandProfilingEnabled(): boolean {
  return process.env.PORT_PROFILE === '1'
}

export function startCommandProfile(args: readonly string[]): void {
  if (!isCommandProfilingEnabled() || activeRecorder) {
    return
  }

  activeRecorder = new CommandProfileRecorder(args.join(' ') || '(interactive)')
}

export async function measureCommandPhase<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!activeRecorder) {
    return operation()
  }

  return activeRecorder.measure(name, operation)
}

export function finishCommandProfile(
  write: (line: string) => void = line => process.stderr.write(line)
): void {
  if (!activeRecorder) {
    return
  }

  const profile = activeRecorder.finish()
  activeRecorder = undefined
  write(`[port-profile] ${JSON.stringify(profile)}\n`)
}

export async function profileCommand<T>(
  args: readonly string[],
  operation: () => Promise<T>,
  write?: (line: string) => void
): Promise<T> {
  startCommandProfile(args)
  try {
    return await operation()
  } finally {
    finishCommandProfile(write)
  }
}
