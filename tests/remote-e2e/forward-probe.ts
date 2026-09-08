import { chmodSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { openRemoteStream } from '../../src/lib/remoteSession.ts'

// Private Unix transport component probe, not public plaintext routing acceptance.
async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('invalid arguments')
  let stream: Awaited<ReturnType<typeof openRemoteStream>> = null
  let queryDirectory: string | undefined
  let linked = false
  let interrupted = false
  let acceptedAfterClose = false
  let stopWaiting: (() => void) | undefined
  const interrupt = (): void => {
    interrupted = true
    stopWaiting?.()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    stream = await openRemoteStream(process.argv[2]!, { address: '127.0.0.1', port: 5432 })
    if (!stream || interrupted) throw new Error('stream unavailable')
    queryDirectory = mkdtempSync('/tmp/port-stream-query-')
    chmodSync(queryDirectory, 0o700)
    // Fixture-only libpq naming adapter; no intermediate TCP listener.
    symlinkSync(stream.path, `${queryDirectory}/.s.PGSQL.5432`)
    linked = true
    console.log(JSON.stringify({ status: 'ready', address: queryDirectory, port: 5432 }))
    await new Promise<void>((resolve, reject) => {
      let command = ''
      const timer = setTimeout(() => finish(false), 20000)
      function finish(valid: boolean): void {
        clearTimeout(timer)
        stopWaiting = undefined
        process.stdin.off('data', data)
        process.stdin.off('end', end)
        process.stdin.off('error', end)
        process.stdin.pause()
        if (valid) resolve()
        else reject(new Error('invalid close command'))
      }
      function data(chunk: Buffer): void {
        if (chunk.length > 6 - command.length) return finish(false)
        command += chunk.toString('utf8')
        if (!'close\n'.startsWith(command)) return finish(false)
        if (command === 'close\n') finish(true)
      }
      function end(): void {
        finish(false)
      }
      stopWaiting = end
      process.stdin.on('data', data)
      process.stdin.once('end', end)
      process.stdin.once('error', end)
    })
  } finally {
    try {
      if (stream) {
        await stream.close()
        await stream.close()
        const afterClose = stream.connect()
        if (afterClose !== null) {
          acceptedAfterClose = true
          afterClose.destroy()
        }
      }
    } finally {
      try {
        if (linked) unlinkSync(`${queryDirectory}/.s.PGSQL.5432`)
      } finally {
        try {
          if (queryDirectory) rmdirSync(queryDirectory)
        } finally {
          process.off('SIGINT', interrupt)
          process.off('SIGTERM', interrupt)
        }
      }
    }
  }
  if (acceptedAfterClose) throw new Error('closed stream accepted connection')
  if (interrupted) throw new Error('probe interrupted')
  console.log(JSON.stringify({ status: 'closed' }))
}

main().catch(() => {
  // Never emit subprocess errors, session paths, argv, or authentication details.
  console.error('private stream probe failed')
  process.exitCode = 1
})
