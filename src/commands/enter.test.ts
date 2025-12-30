import { join } from 'path'
import { prepareSample, renderCLI } from '@tests/utils'
import { waitFor } from 'cli-testing-library'
import { describe, test } from 'vitest'

const TIMEOUT = 20000

describe('parallel worktrees', () => {
  test(
    'separate worktrees have separate domains without conflict',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const instanceA = await renderCLI(['A', '--no-shell'], sample.dir)
      const instanceB = await renderCLI(['B', '--no-shell'], sample.dir)

      // Wait for them to enter their worktrees
      await waitFor(() => expect(instanceA.getByText('Entered worktree: a')).toBeTruthy(), {
        timeout: TIMEOUT,
      })
      await waitFor(() => expect(instanceB.getByText('Entered worktree: b')).toBeTruthy(), {
        timeout: TIMEOUT,
      })

      // Since a sub-shell is used from now on, we instead just navigate
      // to the worktree directory and run the command
      const worktreeADir = join(sample.dir, './.port/trees/A')
      const worktreeBDir = join(sample.dir, './.port/trees/B')

      const upInstanceA = await renderCLI(['up'], worktreeADir)
      const upInstanceB = await renderCLI(['up'], worktreeBDir)

      await waitFor(() => expect(upInstanceA.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: TIMEOUT,
      })
      await waitFor(() => expect(upInstanceB.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: TIMEOUT,
      })

      // Wait for both pages to load and have different content
      const aURL = 'http://a.port:3000'
      const bURL = 'http://b.port:3000'

      await new Promise<void>(resolve =>
        setInterval(async () => {
          const resA = await fetch(aURL)
          const resB = await fetch(bURL)

          if (resA.status === 200 && resB.status === 200) {
            clearInterval()

            expect(await resA.text()).not.toEqual(await resB.text())
            resolve()
          }
        }, 1000)
      )

      // End the sample (use -y to skip Traefik confirmation prompt)
      const downInstanceA = await renderCLI(['down', '-y'], worktreeADir)
      const downInstanceB = await renderCLI(['down', '-y'], worktreeBDir)

      await waitFor(() => expect(downInstanceA.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: TIMEOUT,
      })
      await waitFor(() => expect(downInstanceB.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: TIMEOUT,
      })

      await sample.cleanup()
    },
    TIMEOUT + 1000
  )
})
