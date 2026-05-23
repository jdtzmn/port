import { prepareSharedStack } from '../lib/shared-stack.ts'
import * as output from '../lib/output.ts'

export async function start(): Promise<void> {
  const result = await prepareSharedStack([])

  if (result.started) {
    output.success('Shared stack started')
  } else if (result.restarted) {
    output.success('Shared stack restarted')
  } else {
    output.success('Shared stack already running')
  }
}
