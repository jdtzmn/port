import { stopSharedStack } from '../lib/shared-stack.ts'
import * as output from '../lib/output.ts'

export async function stop(): Promise<void> {
  await stopSharedStack()
  output.success('port stopped')
}
