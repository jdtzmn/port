# Next.js 404 Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Alpine+socat inline shell-script 404 handler with a proper Next.js app published to ghcr.io, referenced by version-pinned image tag derived from package.json.

**Architecture:** A standalone Next.js 15 app in `packages/404-app/` queries the Docker Unix socket at request time to find running worktrees, then renders a proper HTML 404 page with clickable links. Port's `traefik.ts` reads the version from `package.json` at runtime to construct the image tag `ghcr.io/jdtzmn/port-404-handler:<version>`, replacing the Alpine image and inline command. CI builds and pushes the image to ghcr.io before publishing to npm.

**Tech Stack:** Next.js 15, React 19, Node 20, Docker Unix socket HTTP API, ghcr.io, GitHub Actions `docker/build-push-action`

---

## File Map

**Created:**

- `packages/404-app/package.json` — standalone Next.js package (not in Bun workspace)
- `packages/404-app/next.config.ts` — `output: 'standalone'`
- `packages/404-app/tsconfig.json` — TypeScript config
- `packages/404-app/app/page.tsx` — catch-all server component: queries Docker, renders 404 page
- `packages/404-app/lib/docker.ts` — Docker Unix socket query → `{ name: string, url: string }[]`
- `packages/404-app/Dockerfile` — multi-stage build, node:20-alpine, exposes 3000
- `.github/workflows/publish-docker.yml` — builds and pushes image to ghcr.io on release

**Modified:**

- `src/lib/traefik.ts` — remove `generate404HandlerCommand()`, add `get404HandlerImage()`, update compose service definition
- `src/lib/traefik.test.ts` — update tests to match new image/no-command contract
- `.github/workflows/publish.yml` — add `publish-docker` job that must pass before `publish`
- `.github/workflows/linux-integration-tests.yml` — build 404-app image locally in pre-pull step

---

### Task 1: Scaffold the Next.js 404 app

**Files:**

- Create: `packages/404-app/package.json`
- Create: `packages/404-app/next.config.ts`
- Create: `packages/404-app/tsconfig.json`

- [ ] **Step 1: Create `packages/404-app/package.json`**

```json
{
  "name": "port-404-handler",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create `packages/404-app/next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
}

export default nextConfig
```

- [ ] **Step 3: Create `packages/404-app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd packages/404-app && npm install
```

Expected: `node_modules/` created, `package-lock.json` written.

- [ ] **Step 5: Commit**

```bash
git add packages/404-app/package.json packages/404-app/package-lock.json packages/404-app/next.config.ts packages/404-app/tsconfig.json
git commit -m "chore: scaffold Next.js 404 handler app"
```

---

### Task 2: Docker socket query module

**Files:**

- Create: `packages/404-app/lib/docker.ts`

- [ ] **Step 1: Create `packages/404-app/lib/docker.ts`**

This module queries the Docker Unix socket directly using Node's `http` module (no extra dependencies). It finds all containers with `traefik.enable=true`, then extracts `Host()` rules from their Traefik labels to produce name + URL pairs.

```typescript
import http from 'http'

export interface WorktreeLink {
  name: string
  url: string
}

/**
 * Parse Host(`foo.bar`) rules from a Traefik label value string.
 * Returns the full hostname (e.g. "feature-1.port").
 */
function parseHostsFromLabels(labels: Record<string, string>): string[] {
  const hosts: string[] = []
  for (const value of Object.values(labels)) {
    const matches = value.matchAll(/Host\(`([^`]+)`\)/g)
    for (const match of matches) {
      if (match[1]) hosts.push(match[1])
    }
  }
  return hosts
}

/**
 * Query Docker Unix socket for running containers with traefik.enable=true.
 * Returns worktree links derived from Host() rules in Traefik labels.
 * Returns empty array if Docker socket is unavailable or on any error.
 */
export async function getRunningWorktrees(): Promise<WorktreeLink[]> {
  try {
    const containers = await dockerGet<DockerContainer[]>(
      '/containers/json?filters=' +
        encodeURIComponent(JSON.stringify({ label: ['traefik.enable=true'] }))
    )

    const hosts = containers.flatMap(c => parseHostsFromLabels(c.Labels))
    const unique = [...new Set(hosts)]

    return unique.map(host => ({
      name: host.split('.')[0] ?? host,
      url: `http://${host}`,
    }))
  } catch {
    return []
  }
}

interface DockerContainer {
  Labels: Record<string, string>
}

function dockerGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        socketPath: '/var/run/docker.sock',
        path,
      },
      res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T)
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/404-app && npx tsc --noEmit
```

Expected: no errors (or only "cannot find module 'next'" until next build runs — that's fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add packages/404-app/lib/docker.ts
git commit -m "feat: add Docker socket query module for 404 handler"
```

---

### Task 3: 404 page component

**Files:**

- Create: `packages/404-app/app/layout.tsx`
- Create: `packages/404-app/app/page.tsx`

- [ ] **Step 1: Create `packages/404-app/app/layout.tsx`**

```tsx
export const metadata = {
  title: '404 - Worktree Not Found',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Create `packages/404-app/app/page.tsx`**

This is a Next.js server component — `getRunningWorktrees()` is called on the server on every request, so the list is always fresh.

```tsx
import { getRunningWorktrees } from '@/lib/docker'

export const dynamic = 'force-dynamic'

export default async function NotFoundPage() {
  const worktrees = await getRunningWorktrees()

  return (
    <>
      <style>{`
        body {
          font-family: system-ui, sans-serif;
          max-width: 600px;
          margin: 80px auto;
          padding: 0 24px;
          color: #1a1a1a;
        }
        h1 { font-size: 2rem; margin-bottom: 0.25rem; }
        p { color: #555; margin-top: 0; }
        ul { padding: 0; list-style: none; margin-top: 1.5rem; }
        li { margin-bottom: 0.75rem; }
        a {
          color: #0070f3;
          text-decoration: none;
          font-weight: 500;
        }
        a:hover { text-decoration: underline; }
        .empty { color: #888; font-style: italic; }
      `}</style>

      <h1>404 — Worktree Not Found</h1>
      <p>This host doesn&apos;t match any running worktree.</p>

      {worktrees.length > 0 ? (
        <>
          <p>Running worktrees:</p>
          <ul>
            {worktrees.map(wt => (
              <li key={wt.name}>
                <a href={wt.url}>{wt.name}</a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">No worktrees are currently running.</p>
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify the app builds**

```bash
cd packages/404-app && npm run build
```

Expected: build succeeds, `.next/` directory created including `.next/standalone/`.

- [ ] **Step 4: Commit**

```bash
git add packages/404-app/app/
git commit -m "feat: add 404 page server component"
```

---

### Task 4: Dockerfile for the 404 app

**Files:**

- Create: `packages/404-app/Dockerfile`
- Create: `packages/404-app/.dockerignore`

- [ ] **Step 1: Create `packages/404-app/.dockerignore`**

```
node_modules
.next
npm-debug.log
```

- [ ] **Step 2: Create `packages/404-app/Dockerfile`**

Multi-stage: builder installs deps and builds; runner copies only the standalone output. This keeps the final image small.

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone output is self-contained
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server.js"]
```

- [ ] **Step 3: Verify Docker build locally**

```bash
cd packages/404-app && docker build -t port-404-handler-local .
```

Expected: image builds successfully.

- [ ] **Step 4: Smoke-test the container**

```bash
docker run --rm -p 3001:3000 port-404-handler-local &
sleep 3
curl -s http://localhost:3001 | grep "404"
docker stop $(docker ps -q --filter ancestor=port-404-handler-local)
```

Expected: HTML containing "404" returned (Docker socket won't be mounted, so worktree list will be empty — that's fine).

- [ ] **Step 5: Commit**

```bash
git add packages/404-app/Dockerfile packages/404-app/.dockerignore
git commit -m "feat: add Dockerfile for 404 handler app"
```

---

### Task 5: Update `traefik.ts` to use the versioned image

**Files:**

- Modify: `src/lib/traefik.ts`

The goal: remove `generate404HandlerCommand()`, add `get404HandlerImage()` that reads `package.json` at runtime (same pattern as `getCliVersion()` in `src/index.ts`), and update both compose-generating functions to use the new image with no `command:` field.

- [ ] **Step 1: Add `get404HandlerImage()` and remove `generate404HandlerCommand()`**

In `src/lib/traefik.ts`, add this import at the top (alongside existing imports):

```typescript
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
```

Then replace the entire `generate404HandlerCommand()` function (lines 41–62) with:

```typescript
/**
 * Get the versioned Docker image name for the 404 handler.
 * Reads version from package.json to stay in sync with the published npm package.
 */
function get404HandlerImage(): string {
  try {
    const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    const version = typeof packageJson.version === 'string' ? packageJson.version : 'latest'
    return `ghcr.io/jdtzmn/port-404-handler:${version}`
  } catch {
    return 'ghcr.io/jdtzmn/port-404-handler:latest'
  }
}
```

Note: the path is `../../package.json` because `traefik.ts` is at `src/lib/traefik.ts`, two levels deep from the repo root.

- [ ] **Step 2: Update `updateTraefikComposeUnlocked()` (around line 88–95)**

Replace the `'port-404-handler'` service definition:

```typescript
// Before:
'port-404-handler': {
  image: 'alpine:latest',
  container_name: 'port-404-handler',
  restart: 'unless-stopped',
  command: generate404HandlerCommand(),
  volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
  networks: [TRAEFIK_NETWORK],
},

// After:
'port-404-handler': {
  image: get404HandlerImage(),
  container_name: 'port-404-handler',
  restart: 'unless-stopped',
  volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
  networks: [TRAEFIK_NETWORK],
},
```

- [ ] **Step 3: Update `generateTraefikCompose()` (around line 277–284)**

Same replacement in the second copy:

```typescript
// Before:
'port-404-handler': {
  image: 'alpine:latest',
  container_name: 'port-404-handler',
  restart: 'unless-stopped',
  command: generate404HandlerCommand(),
  volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
  networks: [TRAEFIK_NETWORK],
},

// After:
'port-404-handler': {
  image: get404HandlerImage(),
  container_name: 'port-404-handler',
  restart: 'unless-stopped',
  volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
  networks: [TRAEFIK_NETWORK],
},
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
bun run build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/traefik.ts
git commit -m "feat: use versioned ghcr.io image for 404 handler, read version from package.json"
```

---

### Task 6: Update `traefik.test.ts`

**Files:**

- Modify: `src/lib/traefik.test.ts`

The existing tests assert that the compose file contains `alpine:latest`, `socat`, `docker ps`, `traefik.enable=true`, `Host(`, `Content-Type: text/plain`, etc. All of these need to be updated to match the new contract: versioned ghcr.io image, no inline command.

- [ ] **Step 1: Rewrite the "Traefik 404 handler" describe block**

Replace the entire `describe('Traefik 404 handler', ...)` block (lines 45–199) with:

```typescript
describe('Traefik 404 handler', () => {
  useIsolatedPortGlobalDir('port-traefik-404-test', { resetModules: true })

  beforeAll(async () => {
    traefik = await import('./traefik.ts')
  })

  beforeEach(async () => {
    await rm(traefik.TRAEFIK_DIR, { recursive: true, force: true })
  })

  test('generates 404 error page config with correct structure', () => {
    const config = traefik.generate404ErrorPageConfig()

    expect(config).toContain('error-pages')
    expect(config).toContain('port-404-handler')
    expect(config).toContain('status:')
    expect(config).toContain('404')
    expect(config).toContain('http://port-404-handler:3000')
  })

  test('generates catch-all router with low priority', () => {
    const config = traefik.generate404ErrorPageConfig()

    expect(config).toContain('routers:')
    expect(config).toContain('port-404-fallback')
    expect(config).toContain('rule:')
    expect(config).toContain('PathPrefix(`/`)')
    expect(config).toContain('priority: 1')
    expect(config).toContain('service: port-404-handler')
    expect(config).toContain('entryPoints:')
    expect(config).toContain('- web')
  })

  test('catch-all router routes to correct service', () => {
    const config = traefik.generate404ErrorPageConfig()

    expect(config).toContain('services:')
    expect(config).toContain('port-404-handler:')
    expect(config).toContain('loadBalancer:')
    expect(config).toContain('servers:')
    expect(config).toContain('url: http://port-404-handler:3000')
  })

  test('ensure404Handler creates config file', async () => {
    await traefik.ensureTraefikDynamicDir()

    const created = await traefik.ensure404Handler()

    expect(created).toBe(true)
    expect(existsSync(traefik.ERROR_PAGE_CONFIG_FILE)).toBe(true)

    const content = await readFile(traefik.ERROR_PAGE_CONFIG_FILE, 'utf-8')
    expect(content).toContain('error-pages')
    expect(content).toContain('port-404-handler')
  })

  test('ensure404Handler does not overwrite existing config', async () => {
    await traefik.ensureTraefikDynamicDir()

    const firstCreate = await traefik.ensure404Handler()
    expect(firstCreate).toBe(true)

    const secondCreate = await traefik.ensure404Handler()
    expect(secondCreate).toBe(false)
  })

  test('generated compose includes 404 handler service with ghcr.io image', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    expect(composeContent).toContain('port-404-handler')
    expect(composeContent).toContain('ghcr.io/jdtzmn/port-404-handler:')
    expect(composeContent).not.toContain('alpine:latest')
    expect(composeContent).not.toContain('socat')
  })

  test('404 handler mounts Docker socket for container inspection', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    expect(composeContent).toContain('/var/run/docker.sock:/var/run/docker.sock')
  })

  test('404 handler compose service has no inline command', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // The logic now lives in the Docker image, not in an inline shell command
    expect(composeContent).not.toContain('docker ps')
    expect(composeContent).not.toContain('socat')
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
bun run test -- src/lib/traefik.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/traefik.test.ts
git commit -m "test: update traefik tests for Next.js 404 handler image contract"
```

---

### Task 7: CI — publish-docker workflow

**Files:**

- Create: `.github/workflows/publish-docker.yml`

- [ ] **Step 1: Create `.github/workflows/publish-docker.yml`**

```yaml
name: Publish 404 Handler Docker Image

on:
  workflow_call:

jobs:
  publish-docker:
    name: Build and push 404 handler image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Extract version from package.json
        id: version
        run: echo "version=$(jq -r .version package.json)" >> "$GITHUB_OUTPUT"

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: packages/404-app
          push: true
          tags: |
            ghcr.io/jdtzmn/port-404-handler:${{ steps.version.outputs.version }}
            ghcr.io/jdtzmn/port-404-handler:latest
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish-docker.yml
git commit -m "ci: add workflow to publish 404 handler image to ghcr.io"
```

---

### Task 8: CI — update publish.yml to block on Docker image

**Files:**

- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Update `publish.yml`**

Replace the full file content:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  verify:
    name: Verify release tests
    uses: ./.github/workflows/linux-integration-tests.yml
    with:
      run-traefik-diagnostics: true

  publish-docker:
    name: Publish Docker image
    needs: verify
    uses: ./.github/workflows/publish-docker.yml

  publish:
    needs: [verify, publish-docker]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # required for trusted publishing
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Update npm
        run: npm install -g npm@latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Publish to npm
        run: npm publish --provenance --access public
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: block npm publish on Docker image push"
```

---

### Task 9: CI — build 404-app image locally in integration tests

**Files:**

- Modify: `.github/workflows/linux-integration-tests.yml`

The integration tests run against the current branch, not a published release — so we can't pull the image from ghcr.io (it won't exist yet). Instead, build it locally.

- [ ] **Step 1: Update the pre-pull step in `linux-integration-tests.yml`**

Replace the "Pre-pull and build Docker images used by integration tests" step:

```yaml
- name: Pre-pull and build Docker images used by integration tests
  run: |
    # Pull/build images from test sample compose files
    for dir in tests/samples/*/; do
      if [ -f "$dir/docker-compose.yml" ]; then
        docker compose -f "$dir/docker-compose.yml" pull --ignore-buildable &
        docker compose -f "$dir/docker-compose.yml" build &
      fi
    done

    # Pull the Traefik image referenced in source code
    grep -roh "traefik:v[0-9.]*" src/lib/traefik.ts | head -1 | xargs docker pull &

    # Build the 404 handler image locally (not yet published for this branch)
    VERSION=$(jq -r .version package.json)
    docker build -t "ghcr.io/jdtzmn/port-404-handler:${VERSION}" packages/404-app/ &

    wait
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/linux-integration-tests.yml
git commit -m "ci: build 404-handler image locally in integration tests"
```

---

## Self-Review

**Spec coverage:**

- ✅ Next.js app in `packages/404-app/`
- ✅ Docker socket query for running worktrees (name + URL)
- ✅ Server component renders 404 page with clickable links, graceful empty state
- ✅ Version read from `package.json` at runtime in `traefik.ts`
- ✅ `generate404HandlerCommand()` deleted
- ✅ Dockerfile with standalone output
- ✅ ghcr.io publish workflow
- ✅ npm publish blocked on Docker image push
- ✅ Integration tests build image locally

**Potential gaps:**

- The `public/` directory copy in the Dockerfile uses `|| true` because Next.js standalone doesn't always include it — this is intentional and correct.
- `get404HandlerImage()` path is `../../package.json` from `src/lib/traefik.ts` — this resolves to repo root at runtime when `import.meta.url` points to the compiled `dist/` output (one level from root). **Check:** compiled output is at `dist/index.js` and chunks at `dist/*.js`. Since `traefik.ts` compiles into a chunk at `dist/`, the path `../../package.json` would resolve to the parent of the repo root — that's wrong.

  **Fix for Task 5:** Use `../package.json` not `../../package.json`. The `src/index.ts` uses `../package.json` because it compiles to `dist/index.js` (one level deep). Chunks compiled from `src/lib/*.ts` also land in `dist/` (same level), so they also need `../package.json`.

  Correct path: `new URL('../package.json', import.meta.url)` — same as `src/index.ts`.

- The `packages/404-app` directory is not in the Bun workspace (the root `package.json` doesn't have a `workspaces` field, and we don't want it there since it's a separate npm package). The `npm install` in Task 1 is scoped to `packages/404-app/`. This is correct.

**Placeholder scan:** No TBDs or vague steps found.

**Type consistency:** `WorktreeLink` defined in `docker.ts` Task 2, used in `page.tsx` Task 3 — consistent. `getRunningWorktrees()` defined in Task 2, called in Task 3 — consistent.
