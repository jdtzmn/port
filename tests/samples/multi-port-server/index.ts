function startServer(port: number, label: string): void {
  Bun.serve({
    port,
    fetch() {
      return new Response(label, {
        headers: { 'Content-Type': 'text/plain' },
      })
    },
  })
}

startServer(3000, 'primary')
startServer(3001, 'secondary')

console.log('Listening on ports 3000 and 3001')
