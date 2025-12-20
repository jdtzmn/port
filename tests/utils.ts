import { render } from 'cli-testing-library'
import { resolve } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { cp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

export function renderCLI(args: string[] = []) {
  return render('bun', [resolve(__dirname, '../src/index.ts'), ...args])
}

/**
 * Prepare a sample in a temp directory.
 *
 * Returns a dictionary containing `dir` string and `cleanup` method
 */
export async function prepareSample(sampleName: string) {
  // Create temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'port-test-'))

  // Copy sample to temp directory
  const samplePath = resolve(__dirname, 'samples', sampleName)
  await cp(samplePath, tempDir, { recursive: true })

  // Return dir and cleanup function
  return {
    dir: tempDir,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true })
    },
  }
}
