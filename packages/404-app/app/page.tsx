import { notFound } from 'next/navigation'

/**
 * Root page for the Port 404 handler.
 *
 * This service exists solely to handle requests for hosts that don't match any
 * running worktree. Traefik's catch-all router forwards every unmatched request
 * here, so every request to this app should respond with HTTP 404.
 *
 * Calling `notFound()` from a Next.js server component sets the response status
 * to 404 and renders `app/not-found.tsx` (the actual Port Directory UI).
 */
export default function Page(): never {
  notFound()
}
