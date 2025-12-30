import { Hono } from 'hono'
import type { Context } from 'hono'

const app = new Hono()

const randomNumber = (() => Math.floor(Math.random() * 100))()

app.get('/', (c: Context) => {
  return c.text(
    'Hello from Hono! The server is running. Random number between 0 and 99: ' + randomNumber
  )
})

const port = 3000
console.log(`Server is running on http://localhost:${port}`)

export default app
