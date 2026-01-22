const port = parseInt(process.env.PORT || '3000', 10)
const instanceId = Math.random().toString(36).substring(7)

Bun.serve({
  port,
  fetch(req) {
    return new Response(
      JSON.stringify({
        actualPort: port,
        instanceId,
        url: req.url,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  },
})

console.log(`Server listening on port ${port}`)
