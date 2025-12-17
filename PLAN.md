# Port CLI Tool - Implementation Plan

## Overview

A Node.js CLI tool that manages git worktrees and automatically configures Traefik reverse proxy to expose services via local domains (e.g., `feature-1.port:3000`).

**Use Case:** Developers working with git worktrees can use `port up feature-1` to instantly start a worktree with all services accessible at `feature-1.port:PORT`.

---

## Architecture

### Components

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI Tool: `port` (installed globally)                           │
│  npm install -g @yourname/port-cli                               │
│  Lives in its own repo                                           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │  User: cd ~/projects/my-app && port up feature-1
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Target Project Repo: ~/projects/my-app                          │
│  ├── .git/                                                       │
│  ├── .port/                      # Created by CLI                │
│  │   ├── config.jsonc            # Project-specific config       │
│  │   ├── trees/                  # Worktrees live here           │
│  │   │   ├── feature-1/          # Worktree                      │
│  │   │   ├── feature-2/                                          │
│  │   │   └── main/                                               │
│  │   └── .gitignore              # Ignores trees/                │
│  ├── docker-compose.yml          # Project's existing file       │
│  └── src/                                                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Traefik (runs on demand, managed by CLI)                        │
│  ~/.port/traefik/                                                │
│  ├── docker-compose.yml          # Traefik container             │
│  └── traefik.yml                 # Dynamic config                │
│                                                                  │
│  - Started on first `port up`                                    │
│  - Shut down when last `port down` is run (with prompt)          │
│  - Dynamic entrypoints per project ports                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Structure

### CLI Tool Repository

```
port-cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Entry point, commander setup
│   ├── commands/
│   │   ├── init.ts              # port init (setup .code directory)
│   │   ├── install.ts           # port install (DNS setup)
│   │   ├── enter.ts             # port <branch> (spawn subshell)
│   │   ├── up.ts                # port up (start services)
│   │   ├── down.ts              # port down (stop services)
│   │   ├── remove.ts            # port remove <branch>
│   │   └── list.ts              # port list (show worktrees)
│   ├── lib/
│   │   ├── config.ts            # Load/validate .code/config.jsonc
│   │   ├── git.ts               # simple-git: worktree ops
│   │   ├── compose.ts           # docker-compose wrapper
│   │   ├── traefik.ts           # Traefik config + management
│   │   ├── registry.ts          # Track active projects
│   │   ├── dns.ts               # DNS setup (dnsmasq) + check
│   │   ├── sanitize.ts          # Branch name sanitization
│   │   └── worktree.ts          # Worktree detection/validation
│   └── types.ts
├── traefik/
│   └── docker-compose.yml       # Bundled Traefik config
└── README.md
```

### Target Project Structure

After running `port up feature-1`:

```
my-app/
├── .git/
├── .port/
│   ├── config.jsonc              # User creates, checked into git
│   ├── .gitignore                # Contains: trees/
│   └── trees/                    # NOT in git (ignored)
│       ├── feature-1/            # Worktree (auto-created)
│       │   ├── (all project files)
│       │   ├── docker-compose.yml
│       │   └── docker-compose.override.yml (generated)
│       └── feature-2/
├── docker-compose.yml
└── src/
```

### Global CLI Configuration

```
~/.port/
├── traefik/
│   ├── docker-compose.yml        # Traefik container config
│   └── traefik.yml               # Dynamic entrypoints config
├── registry.json                 # Track active projects
└── config.json                   # Optional global defaults
```

---

## Configuration

### Project Config (`.port/config.jsonc`)

Each project defines its own services and ports. This file is **checked into git**.

```jsonc
{
  // Domain suffix - services available at <branch-name>.port
  "domain": "port",

  // Optional: path to docker-compose file (default: docker-compose.yml)
  "compose": "docker-compose.yml",

  // List of services to expose via Traefik
  // Each service name must exist in docker-compose.yml
  "services": [
    {
      "name": "web", // Service name in docker-compose.yml
      "ports": [3000, 3001], // Ports to expose via Traefik
    },
    {
      "name": "api",
      "ports": [4000, 4001],
    },
    {
      "name": "admin",
      "ports": [5000],
    },
  ],
}
```

### Project Registry (`~/.port/registry.json`)

Tracks all active port projects across different repos. Used to determine when Traefik should be shut down.

```json
{
  "projects": [
    {
      "repo": "/Users/jacob/projects/my-app",
      "branch": "feature-1",
      "ports": [3000, 3001, 4000, 4001, 5000]
    },
    {
      "repo": "/Users/jacob/projects/other-app",
      "branch": "fix-bug",
      "ports": [8000, 8001]
    }
  ]
}
```

---

## Commands

### `port init`

**Purpose:** Set up `.port/` directory structure in the current project repo. Check and warn if DNS is not configured.

**Flow:**

1. Verify we're in a git repository
2. Create `.port/` directory structure:
   - `.port/config.jsonc` (template if doesn't exist)
   - `.port/trees/` directory
   - `.port/.gitignore` (contains: `trees/`)
3. **Check DNS configuration:**
   - Detect OS (macOS/Linux)
   - Check if `*.port` is resolving to `127.0.0.1`
   - If not configured:
     - Warn: "DNS not configured for \*.port domains"
     - Advise: "Run `port install` to set up DNS"
4. Output success message

---

### `port install`

**Purpose:** One-time global DNS setup across the entire system.

**Flow:**

1. Detect OS (macOS/Linux)
2. Prompt: "Configure DNS to resolve \*.port to 127.0.0.1? (y/n)"
3. If yes:
   - **macOS:** Install dnsmasq via Homebrew, configure `/etc/resolver/port`
   - **Linux:** Configure dnsmasq or systemd-resolved for `*.port` → `127.0.0.1`
4. Test DNS resolution
5. Output success message with confirmation

---

### `port <branch>`

**Purpose:** Enter a worktree in a new shell. Creates worktree if it doesn't exist. Does NOT start services automatically.

**Note:** If run from the main repo directory (not a worktree), the repo folder name is used as the worktree name for routing purposes.

**Flow:**

1. Get git repo root (ensure we're in a git repo)
2. Load `.port/config.jsonc`
   - Error if missing (user must run `port init` first)
   - Validate: `domain`, `compose` file exists, `services` array not empty
3. **Sanitize branch name:**
   - `feature/auth-api` → `feature-auth-api`
   - Replace non-alphanumeric with dashes, lowercase
4. **Create git worktree if it doesn't exist:**
   - Check if branch exists in git
   - If not → create from current HEAD
   - Create worktree at `.port/trees/<sanitized-branch>/`
5. **Generate override file:**
   - For each service in config:
     - For each port: create Traefik router + service labels
     - Attach service to `traefik-network`
     - Remove host port bindings with `ports: !override []`
   - Write `docker-compose.override.yml` to worktree
6. **Spawn new shell in worktree directory:**
   - `spawn($SHELL, [], { cwd: worktreePath, stdio: 'inherit' })`
7. **Output message before exiting:**

   ```
   ✓ Entered worktree: feature-1
   ✓ Services available at:

     web:
      • http://feature-1.port:3000
        • http://feature-1.port:3001

      api:
        • http://feature-1.port:4000
        • http://feature-1.port:4001

      admin:
        • http://feature-1.port:5000

   Run 'port up' to start services
   Type 'exit' to return to parent shell
   ```

---

### `port up`

**Purpose:** Start docker-compose services in the current worktree.

**Note:** Can also be run from the main repo directory. In this case, the repo folder name is used as the worktree name for routing purposes.

**Flow:**

1. Verify we're inside a worktree (check if `.port/trees/<branch>` is in current path), OR we're in the main repo directory
2. Load `.port/config.jsonc` from repo root
3. **Check if Traefik is running:**
   - If not → start Traefik container (silent)
4. **Determine required ports:**
   - Collect all ports from `config.jsonc`
   - Check what entrypoints exist in `~/.port/traefik/traefik.yml`
   - If missing ports → update config, restart Traefik
5. **Start docker-compose:**
   - Run from current worktree directory
   - Command: `docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d`
   - Set `TRAEFIK_NETWORK_NAME` env var
6. **Register project:**
   - Add to `~/.port/registry.json` if not already there
7. **Output:**
   ```
   ✓ Services started in feature-1
   ✓ Traefik dashboard: http://localhost:8080
   ```

---

### `port down`

**Purpose:** Stop docker-compose services in the current worktree.

**Flow:**

1. Verify we're inside a worktree or main repo directory
2. Load `.port/config.jsonc` from repo root
3. **Stop docker-compose:**
   - Run `docker-compose down` in current worktree
4. **Check if Traefik should shutdown:**
   - Scan `~/.port/registry.json` for other active projects
   - If this is the last project:
     - Prompt: "No other port projects running. Stop Traefik? (y/n)"
     - If yes: `docker-compose down` in `~/.port/traefik/`
5. **Update registry:**
   - Remove current project entry from `~/.port/registry.json`
6. Output success message

---

### `port remove <branch>`

**Purpose:** Stop services and remove a worktree entirely.

**Flow:**

1. Get git repo root
2. Sanitize branch name
3. Find worktree at `.port/trees/<branch>/`
   - Error if not found
4. **Stop docker-compose:**
   - Run `docker-compose down` in worktree
5. **Remove worktree:**
   - `git worktree remove .port/trees/<branch>/`
6. **Update registry:**
   - Remove project entry from `~/.port/registry.json`
7. **Check if Traefik should shutdown:**
   - If registry is empty (no active projects):
     - Prompt: "No other port projects running. Stop Traefik? (y/n)"
     - If yes: `docker-compose down` in `~/.port/traefik/`
8. Output success message

---

### `port list`

**Purpose:** Show all worktrees in the current project and their status.

**Flow:**

1. Get git repo root
2. Scan `.port/trees/` for subdirectories
3. For each worktree:
   - Get branch name
   - Run `docker-compose ps` to check service status
   - Read config and show ports for each service
4. Check Traefik status globally
5. **Output:**

   ```
   Active worktrees in my-app:

   feature-1 (running)
     web:
       • 3000 (running)
       • 3001 (running)
     api:
       • 4000 (running)
       • 4001 (running)

   fix-bug (stopped)
     admin:
       • 5000 (not running)

   Global Traefik: running (dashboard: http://localhost:8080)
   ```

---

## Generated Override File

The CLI generates a `docker-compose.override.yml` file in each worktree. This file:

- **Removes host port bindings** from services using `!override` to prevent port conflicts between worktrees
- Adds Traefik labels to each service
- Attaches services to the shared `traefik-network`
- Does **not** modify the original `docker-compose.yml`

### Port Conflict Resolution

When multiple worktrees run simultaneously (e.g., `feature-1` and `feature-2` both expose port 3000), the override file prevents Docker port conflicts by:

1. Removing the `ports` array from services using the `!override` YAML tag (docker-compose v2.24+)
2. Services listen only on internal container ports (not host ports)
3. Traefik routes traffic based on Host header: `feature-1.local:3000` vs `feature-2.local:3000` to different containers

**Example conflict resolution:**

```
Original docker-compose.yml:
  web:
    ports: ["3000:3000"]  # Binds to host port 3000

feature-1 override:
  web:
    ports: !override []   # Removes host binding
    # Traefik routes feature-1.local:3000 → container internal port 3000

feature-2 override:
  web:
    ports: !override []   # Removes host binding
    # Traefik routes feature-2.local:3000 → container internal port 3000

Result: No port conflicts! Both services run simultaneously.
```

### Example: Multiple Services with Multiple Ports

**Config:**

```jsonc
{
  "services": [
    { "name": "web", "ports": [3000, 3001] },
    { "name": "api", "ports": [4000] },
    { "name": "admin", "ports": [5000] },
  ],
}
```

**Generated Override File (`.port/trees/feature-1/docker-compose.override.yml`):**

```yaml
version: '3.8'

services:
  web:
    # Remove host port bindings to prevent conflicts with other worktrees
    ports: !override []
    networks:
      - traefik-network
    labels:
      - 'traefik.enable=true'
      # Port 3000
      - 'traefik.http.routers.feature-1-web-3000.rule=Host(`feature-1.port`)'
      - 'traefik.http.routers.feature-1-web-3000.entrypoints=port3000'
      - 'traefik.http.services.feature-1-web-3000.loadbalancer.server.port=3000'
      # Port 3001
      - 'traefik.http.routers.feature-1-web-3001.rule=Host(`feature-1.port`)'
      - 'traefik.http.routers.feature-1-web-3001.entrypoints=port3001'
      - 'traefik.http.services.feature-1-web-3001.loadbalancer.server.port=3001'

  api:
    ports: !override []
    networks:
      - traefik-network
    labels:
      - 'traefik.enable=true'
      # Port 4000
      - 'traefik.http.routers.feature-1-api-4000.rule=Host(`feature-1.port`)'
      - 'traefik.http.routers.feature-1-api-4000.entrypoints=port4000'
      - 'traefik.http.services.feature-1-api-4000.loadbalancer.server.port=4000'

  admin:
    ports: !override []
    networks:
      - traefik-network
    labels:
      - 'traefik.enable=true'
      # Port 5000
      - 'traefik.http.routers.feature-1-admin-5000.rule=Host(`feature-1.port`)'
      - 'traefik.http.routers.feature-1-admin-5000.entrypoints=port5000'
      - 'traefik.http.services.feature-1-admin-5000.loadbalancer.server.port=5000'

networks:
  traefik-network:
    external: true
    name: traefik-network
```

**Access:**

```
http://feature-1.port:3000  → web service port 3000 (internal container port)
http://feature-1.port:3001  → web service port 3001 (internal container port)
http://feature-1.port:4000  → api service port 4000 (internal container port)
http://feature-1.port:5000  → admin service port 5000 (internal container port)
```

### Important: Docker Compose Version Requirement

The `!override` YAML tag requires **docker-compose v2.24.0 or later**.

To check your version:

```bash
docker-compose --version
```

If using an older version, upgrade:

```bash
# Via Docker Desktop (recommended)
# Update to latest version

# Or via pip
pip install --upgrade docker-compose
```

---

## Traefik Management

### Traefik Container

Runs in `~/.port/traefik/` using docker-compose. Automatically started on first `port up`, shutdown when last `port down` is run.

### Dynamic Entrypoints

Traefik's entrypoints are dynamically generated based on ports used across all projects. Each port gets its own entrypoint so Traefik can listen on all required ports simultaneously.

**Traefik Config Example:**

```yaml
# ~/.port/traefik/traefik.yml (managed by CLI)
api:
  dashboard: true
  insecure: true

providers:
  docker:
    exposedByDefault: false
    network: traefik-network

entryPoints:
  web:
    address: ':80'
  port3000:
    address: ':3000'
  port3001:
    address: ':3001'
  port4000:
    address: ':4000'
  port5000:
    address: ':5000'
  port8000:
    address: ':8000'
  port8001:
    address: ':8001'
```

**Flow:**

1. `port up` reads all ports from `.code/config.jsonc`
2. Checks `~/.port/traefik/traefik.yml` for existing entrypoints
3. If missing ports → regenerates config, restarts Traefik
4. If ports already exist → no action needed

### Concurrent Worktrees with Shared Ports

Multiple worktrees can safely run simultaneously even if they expose the same ports because:

1. **Host port binding is disabled** in each worktree's override file using `!override []`
2. **Services only listen internally** on container ports, not host ports
3. **Traefik routes by Host header**, not host port:
   - Request to `feature-1.port:3000` with Host header `feature-1.port`
   - Request to `feature-2.port:3000` with Host header `feature-2.port`
   - Both route through Traefik's `:3000` entrypoint to different containers

**Example: Two worktrees with same ports**

```bash
$ port up feature-1
✓ Services: feature-1.port:3000, feature-1.port:4000

$ port up feature-2  # Same ports!
✓ Services: feature-2.port:3000, feature-2.port:4000

$ curl http://feature-1.port:3000  # Routes to feature-1 container
$ curl http://feature-2.port:3000  # Routes to feature-2 container (different container, same port!)
```

No port conflicts because Docker container ports are isolated and Traefik routes by hostname.

---

## Branch Name Sanitization

Branch names are sanitized to be valid hostnames:

```typescript
function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[^a-zA-Z0-9-]/g, '-') // Replace non-alphanumeric with dash
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-|-$/g, '') // Remove leading/trailing dashes
    .toLowerCase()
}
```

**Examples:**

- `feature/auth-api` → `feature-auth-api`
- `fix/bug#123` → `fix-bug-123`
- `release_v1.0.0` → `release-v1-0-0`
- `HOTFIX-urgent` → `hotfix-urgent`

---

## DNS Setup

### macOS (Automated by `port install`)

```bash
# 1. Install dnsmasq
brew install dnsmasq

# 2. Configure dnsmasq
echo "address=/port/127.0.0.1" >> /opt/homebrew/etc/dnsmasq.conf

# 3. Start dnsmasq service
sudo brew services start dnsmasq

# 4. Create resolver
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/port
```

### Linux (Automated by `port install`)

**Option A: dnsmasq**

```bash
sudo apt install dnsmasq
echo "address=/port/127.0.0.1" | sudo tee /etc/dnsmasq.d/port.conf
sudo systemctl restart dnsmasq
```

**Option B: systemd-resolved**

```bash
# Add to /etc/systemd/resolved.conf.d/port.conf
[Resolve]
DNS=127.0.0.1
Domains=port
```

---

## Dependencies

```json
{
  "name": "@yourname/port-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "code": "./dist/index.js"
  },
  "dependencies": {
    "simple-git": "^3.20.0",
    "docker-compose": "^1.2.0",
    "dockerode": "^4.0.0",
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "yaml": "^2.3.0",
    "jsonc-parser": "^3.2.0",
    "inquirer": "^9.2.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0"
  }
}
```

---

## TypeScript Types

```typescript
// types.ts

interface ServiceConfig {
  name: string // Service name in docker-compose.yml
  ports: number[] // Ports to expose via Traefik
}

interface PortConfig {
  domain: string // default: "port"
  compose?: string // default: "docker-compose.yml"
  services: ServiceConfig[]
}

interface Project {
  repo: string // Absolute path to repo root
  branch: string // Git branch name
  ports: number[] // All ports used by this project
}

interface Registry {
  projects: Project[]
}
```

---

## Error Handling

### Required Checks

1. **`.port/config.jsonc` missing:**
   - Error with: "No .port/config.jsonc found. Create it first with required fields: domain, services"

2. **Git repo check:**
   - Error with: "Not in a git repository"

3. **Worktree already exists:**
   - During `port up`: Confirm before creating
   - During `port down`: Error if not found

4. **Docker/docker-compose not installed:**
   - Error with clear message

5. **docker-compose version check:**
   - Warn if version < 2.24.0 (required for `!override` YAML tag)
   - Warn with: "docker-compose v2.24.0+ recommended for `!override` support. Please upgrade."
   - Provide upgrade instructions
   - Do NOT block execution (warning only)

6. **Service not in docker-compose.yml:**
   - During `port up`: Error with list of available services

7. **Invalid branch name:**
   - During `port up`: Sanitize automatically, warn user

---

## Examples

### Example Project 1: Simple Web App

```jsonc
// .port/config.jsonc
{
  "domain": "port",
  "compose": "docker-compose.yml",
  "services": [
    {
      "name": "app",
      "ports": [3000],
    },
  ],
}
```

Usage:

```bash
$ port init
✓ .port directory created
⚠ DNS not configured. Run 'port install' to set up *.port resolution

$ port install
✓ DNS configured for *.port → 127.0.0.1

$ port feature-1
✓ Entered worktree: feature-1
✓ Services available at: http://feature-1.port:3000
Run 'port up' to start services
Type 'exit' to return to parent shell

(now inside feature-1 subshell)
$ port up
✓ Services started

$ port list
feature-1 (running)
  app: 3000 (running)

$ port down
✓ Services stopped

$ exit
(back to parent shell)

$ port remove feature-1
No other port projects running. Stop Traefik? (y/n) y
✓ Traefik stopped
```

### Example Project 2: Microservices Architecture

```jsonc
// .port/config.jsonc
{
  "domain": "port",
  "compose": "docker-compose.yml",
  "services": [
    {
      "name": "frontend",
      "ports": [3000],
    },
    {
      "name": "backend",
      "ports": [4000, 4001],
    },
    {
      "name": "admin",
      "ports": [5000],
    },
  ],
}
```

Usage:

```bash
$ port auth-feature
✓ Entered worktree: auth-feature
✓ Services available at:
  frontend: http://auth-feature.port:3000
  backend: http://auth-feature.port:4000, http://auth-feature.port:4001
  admin: http://auth-feature.port:5000
Run 'port up' to start services

(now inside auth-feature subshell)
$ port up
✓ Services started

$ port list
auth-feature (running)
  frontend: 3000 (running)
  backend: 4000, 4001 (running)
  admin: 5000 (running)

main (running)
  frontend: 3000 (running)
  backend: 4000, 4001 (running)
  admin: 5000 (running)

$ exit
(back to parent shell)

$ port remove auth-feature
✓ Worktree removed
Traefik still needed by other projects
```

---

## Implementation Checklist

- [ ] CLI tool repository setup (package.json, tsconfig.json)
- [ ] Commander.js CLI framework
- [ ] Load `.port/config.jsonc` with validation
- [ ] simple-git integration for worktree operations
- [ ] Branch name sanitization
- [ ] Override file generation with Traefik labels
- [ ] docker-compose wrapper
- [ ] Traefik container management (start/stop)
- [ ] Dynamic traefik.yml generation
- [ ] Registry management
- [ ] DNS setup (macOS + Linux) + DNS check
- [ ] Worktree detection utility (for `port up`/`port down`)
- [ ] `port init` command
- [ ] `port install` command
- [ ] `port <branch>` command (spawn subshell)
- [ ] `port up` command
- [ ] `port down` command
- [ ] `port remove <branch>` command
- [ ] `port list` command
- [ ] Error handling and validation
- [ ] Tests
- [ ] README with installation & usage
- [ ] GitHub Actions for builds/releases

---

## Next Steps

1. Create CLI tool repository structure
2. Implement core utilities (config, git, compose, traefik, dns, worktree)
3. Implement `port init` command
4. Implement `port install` command
5. Implement `port <branch>` command (most complex - subshell spawning)
6. Implement `port up` command
7. Implement `port down` command
8. Implement `port remove <branch>` command
9. Implement `port list` command
10. Add comprehensive error handling
11. Test across macOS and Linux
12. Package and publish to npm
