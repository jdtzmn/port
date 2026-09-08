import { openRemoteForward } from '../../src/lib/remoteSession.ts'

// Private transport component probe, not public plaintext routing acceptance.
async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('invalid arguments')
  const forward = await openRemoteForward(process.argv[2]!, { address: '127.0.0.1', port: 5432 })
  if (!forward) throw new Error('forward unavailable')
  try {
    console.log(JSON.stringify({ status: 'ready', address: forward.address, port: forward.port }))
    await new Promise<void>((resolve, reject) => {
      let command = ''
      const timer = setTimeout(() => finish(false), 20000)
      function finish(valid: boolean): void {
        clearTimeout(timer)
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
      process.stdin.on('data', data)
      process.stdin.once('end', end)
      process.stdin.once('error', end)
    })
  } finally {
    await forward.close()
    await forward.close()
  }
  console.log(JSON.stringify({ status: 'closed' }))
}

main().catch(() => {
  // Never emit subprocess errors, session paths, argv, or authentication details.
  console.error('private forward probe failed')
  process.exitCode = 1
})
