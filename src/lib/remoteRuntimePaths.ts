import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { GLOBAL_PORT_DIR } from './registry.ts'
import { TRAEFIK_DYNAMIC_DIR } from './traefik.ts'

export async function findRemoteRuntimePaths() {
  let parent: string
  try {
    parent = await realpath(GLOBAL_PORT_DIR)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const root = join(parent, 'remote')
  let stat
  try {
    stat = await lstat(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700)
    throw new Error('Invalid remote runtime directory')
  return { root }
}

export async function getRemoteRuntimePaths() {
  await mkdir(GLOBAL_PORT_DIR, { recursive: true })
  const root = join(await realpath(GLOBAL_PORT_DIR), 'remote')
  await mkdir(root, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700)
    throw new Error('Invalid remote runtime directory')
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  const controlRoot = join(await realpath('/tmp'), `port-remote-${process.getuid?.()}-${hash}`)
  return { root, controlRoot, dynamicDirectory: TRAEFIK_DYNAMIC_DIR }
}
