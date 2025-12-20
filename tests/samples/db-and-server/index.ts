import { Hono } from 'hono'
import type { Context } from 'hono'

const app = new Hono()

app.get('/', (c: Context) => {
  return c.text('Hello from Hono! The server is running.')
})

const port = 3000
console.log(`Server is running on http://localhost:${port}`)

export default app
