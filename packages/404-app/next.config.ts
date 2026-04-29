import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pin tracing root to this package so standalone output is self-contained
  // (prevents Next.js from inferring the monorepo root via bun.lock discovery)
  outputFileTracingRoot: path.join(__dirname),
}

export default nextConfig
