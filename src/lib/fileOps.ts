/**
 * Cross-platform file operations abstraction.
 *
 * All file mutations performed by install/uninstall flow through this module,
 * which serves two purposes:
 *
 * 1. **Cross-platform compatibility** -- the shell implementation generates the
 *    correct commands for macOS vs Linux (e.g. `sed -i ''` vs `sed -i`).
 *
 * 2. **Testability bottleneck** -- tests can swap in `MapFileOps` (backed by a
 *    plain `Map<string, string>`) to verify that an install+uninstall round-trip
 *    leaves no files behind, without parsing shell commands or touching the real
 *    filesystem.
 */

import { execAsync, execPrivileged } from './exec.ts'

export interface FileOps {
  /** Overwrite (or create) a file with `content`. */
  write(path: string, content: string, opts?: { privileged?: boolean }): Promise<void>

  /** Append `content` to an existing file (creates if missing). */
  append(path: string, content: string, opts?: { privileged?: boolean }): Promise<void>

  /** Read a file's contents. Throws if the file does not exist. */
  read(path: string): Promise<string>

  /** Return `true` if the file exists. */
  exists(path: string): Promise<boolean>

  /** Delete a file. */
  delete(path: string, opts?: { privileged?: boolean }): Promise<void>

  /** Remove every line that contains `substring`. */
  removeLines(path: string, containing: string, opts?: { privileged?: boolean }): Promise<void>

  /** Create a directory (and parents). */
  mkdir(path: string, opts?: { privileged?: boolean }): Promise<void>

  /** Return filenames in a directory (non-recursive). */
  list(directory: string): Promise<string[]>
}

// ---------------------------------------------------------------------------
// Shell implementation (production)
// ---------------------------------------------------------------------------

export const fileOps: FileOps = {
  async write(path, content, opts) {
    const exec = opts?.privileged ? execPrivileged : execAsync
    await exec(`echo "${content}" > ${path}`)
  },

  async append(path, content, opts) {
    const exec = opts?.privileged ? execPrivileged : execAsync
    await exec(`echo "${content}" >> ${path}`)
  },

  async read(path) {
    const { stdout } = await execAsync(`cat ${path}`)
    return stdout
  },

  async exists(path) {
    try {
      await execAsync(`test -f ${path}`)
      return true
    } catch {
      return false
    }
  },

  async delete(path, opts) {
    const exec = opts?.privileged ? execPrivileged : execAsync
    await exec(`rm ${path}`)
  },

  async removeLines(path, containing, opts) {
    const exec = opts?.privileged ? execPrivileged : execAsync
    const escaped = containing.replace(/\//g, '\\/')
    if (process.platform === 'darwin') {
      await exec(`sed -i '' '/${escaped}/d' ${path}`)
    } else {
      await exec(`sed -i '/${escaped}/d' ${path}`)
    }
  },

  async mkdir(path, opts) {
    const exec = opts?.privileged ? execPrivileged : execAsync
    await exec(`mkdir -p ${path}`)
  },

  async list(directory) {
    try {
      const { stdout } = await execAsync(`ls -1 ${directory}`)
      return stdout
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  },
}

// ---------------------------------------------------------------------------
// Map-backed implementation (tests)
// ---------------------------------------------------------------------------

export class MapFileOps implements FileOps {
  constructor(public map: Map<string, string>) {}

  async write(_path: string, content: string): Promise<void> {
    this.map.set(_path, content + '\n')
  }

  async append(_path: string, content: string): Promise<void> {
    this.map.set(_path, (this.map.get(_path) ?? '') + content + '\n')
  }

  async read(path: string): Promise<string> {
    const content = this.map.get(path)
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  }

  async exists(path: string): Promise<boolean> {
    return this.map.has(path)
  }

  async delete(path: string): Promise<void> {
    this.map.delete(path)
  }

  async removeLines(path: string, containing: string): Promise<void> {
    const content = this.map.get(path)
    if (content === undefined) throw new Error(`File not found: ${path}`)
    const filtered = content
      .split('\n')
      .filter(line => !line.includes(containing))
      .join('\n')
    this.map.set(path, filtered)
  }

  async mkdir(): Promise<void> {
    // no-op — directories are implicit in a flat map
  }

  async list(directory: string): Promise<string[]> {
    const prefix = directory.endsWith('/') ? directory : directory + '/'
    return [...this.map.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(key => key.slice(prefix.length))
  }
}
