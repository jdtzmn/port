#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isListInvocation } from './lib/cliEntry.ts'

export function isMainModule(moduleUrl = import.meta.url, entryPath = process.argv[1]): boolean {
  if (!entryPath) return false
  try {
    return fileURLToPath(moduleUrl) === realpathSync(entryPath)
  } catch {
    return false
  }
}

if (isMainModule()) {
  const args = process.argv.slice(2)

  if (isListInvocation(args)) {
    await (await import('./commands/list.ts')).list()
  } else {
    await (await import('./program.ts')).runCli()
  }
}
