#!/usr/bin/env bun

import { isListInvocation } from './lib/cliEntry.ts'

if (import.meta.main) {
  const args = process.argv.slice(2)

  if (isListInvocation(args)) {
    await (await import('./commands/list.ts')).list()
  } else {
    await (await import('./program.ts')).runCli()
  }
}
