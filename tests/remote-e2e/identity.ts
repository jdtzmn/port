// Disposable identity backend; only POST increments the side-effect counter.
const owner = process.env.FIXTURE_NAME
if (!['remote-a', 'remote-b', 'local'].includes(owner ?? '')) throw new Error('Invalid owner')
let posts = 0
const server = Bun.serve({
  hostname: owner === 'local' ? '127.78.2.1' : '127.0.0.1',
  port: 3000,
  fetch(request) {
    if (request.method === 'POST') posts++
    return Response.json({ owner, service: 'ui', posts })
  },
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.stop(true)
    process.exit(0)
  })
}
