import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const entry = resolve(root, 'dist/index.js')

assert.ok(existsSync(entry), 'Build Port before running the Node runtime smoke test')

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' })
}

assert.match(run(process.execPath, [entry, '--help']), /Usage: port/)
assert.match(run(entry, ['--help']), /Usage: port/)
assert.deepEqual(JSON.parse(run(process.execPath, [entry, '__remote-handshake'])), {
  kind: 'port-handshake',
  version: 1,
})
