import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
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

const packageDirectory = mkdtempSync(join(tmpdir(), 'port-node-runtime-'))
try {
  const packed = JSON.parse(run('npm', ['pack', '--pack-destination', packageDirectory, '--json']))
  const tarball = join(packageDirectory, packed[0].filename)
  const consumer = join(packageDirectory, 'consumer')
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, tarball],
    { cwd: root, stdio: 'pipe' }
  )
  assert.match(run(join(consumer, 'node_modules/.bin/port'), ['--help']), /Usage: port/)
} finally {
  rmSync(packageDirectory, { recursive: true, force: true })
}
