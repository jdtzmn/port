#!/usr/bin/env bun

import { runCli } from './program.ts'

export { joinBranchArgs, program } from './program.ts'

if (import.meta.main) {
  await runCli()
}
