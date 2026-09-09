import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRemoteRuntimeEnabled } from './remoteEnabled.ts'

let root: string
const enabled = '{"version":1,"enabled":true}\n'
beforeEach(() => {
  root = mkdtempSync('/tmp/port-enabled-')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})
function write(content = enabled) {
  writeFileSync(join(root, 'enabled.json'), content, { mode: 0o600 })
}

describe('remote integration opt-in', () => {
  it('requires an explicit private valid marker', () => {
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
    write()
    expect(isRemoteRuntimeEnabled(root)).toBe(true)
  })
  it.each([
    '',
    'null',
    '{}',
    '{"version":2,"enabled":true}',
    '{"version":1,"enabled":false}',
    '{"version":1,"enabled":true,"extra":0}',
    ' '.repeat(129),
  ])('rejects invalid or oversized marker %s', content => {
    write(content)
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
  })
  it('rejects non-private files and directories', () => {
    write()
    chmodSync(join(root, 'enabled.json'), 0o644)
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
    chmodSync(join(root, 'enabled.json'), 0o600)
    chmodSync(root, 0o755)
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
  })
  it('rejects symlinks and multiply-linked files', () => {
    const target = join(root, 'target')
    writeFileSync(target, enabled, { mode: 0o600 })
    symlinkSync(target, join(root, 'enabled.json'))
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
    rmSync(join(root, 'enabled.json'))
    linkSync(target, join(root, 'enabled.json'))
    expect(isRemoteRuntimeEnabled(root)).toBe(false)
  })
})
