import { prepareSharedStack } from '../lib/shared-stack.ts'
import * as output from '../lib/output.ts'

export async function start(): Promise<void> {
  const result = await prepareSharedStack([])

  if (result.started) {
    output.success('port started')
  } else if (result.restarted) {
    output.success('port restarted')
  } else {
    output.success('port already running')
  }
}
