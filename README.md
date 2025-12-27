# Port CLI Tool

A Node.js CLI tool that manages git worktrees and automatically configures Traefik reverse proxy to expose services via local domains (e.g., `feature-1.local:3000`).

## Use Case

Developers working with git worktrees can use `port up feature-1` to instantly start a worktree with all services accessible at `feature-1.local:PORT`.

## Features

- **Git Worktree Management**: Create and manage git worktrees with a single command
- **Automatic Traefik Configuration**: Dynamically configure Traefik reverse proxy for local domain access
- **Port Conflict Resolution**: Run multiple worktrees simultaneously without port conflicts
- **DNS Setup**: Automated DNS configuration for `*.local` domains
- **Service Discovery**: Easy access to services via hostnames instead of port numbers

## Installation

```bash
npm install -g @jdtzmn/port
# or with bun
bun install -g @jdtzmn/port
```

## Quick Start

### 1. Initialize Project

```bash
port init
```

This sets up the `.code/` directory structure and checks DNS configuration.

### 2. Configure Services

Create `.code/config.jsonc` in your project with service definitions:

```jsonc
{
  "domain": "local",
  "compose": "docker-compose.yml",
  "services": [
    {
      "name": "web",
      "ports": [3000, 3001],
    },
    {
      "name": "api",
      "ports": [4000],
    },
  ],
}
```

### 3. Set Up DNS (One-time)

```bash
port install
```

Configures your system to resolve `*.port` domains to `127.0.0.1`.

You can optionally specify a custom IP address:

```bash
# Resolve to a specific IP (useful for Docker networks, etc.)
port install --dns-ip 172.25.0.2

# Skip confirmation prompt
port install --yes

# Combine options
port install --yes --dns-ip 192.168.1.100
```

#### Linux DNS Setup

On Linux systems with `systemd-resolved` running (most modern Ubuntu/Debian systems), the install command automatically:

1. Detects that `systemd-resolved` is using port 53
2. Runs `dnsmasq` on port 5354 to avoid conflicts
3. Configures `systemd-resolved` to forward `*.port` queries to dnsmasq

This "dual-mode" setup allows both services to coexist without conflicts.

### 4. Enter a Worktree

```bash
port feature-1
```

This creates a new worktree and spawns a subshell inside it.

### 5. Start Services

```bash
port up
```

Starts docker-compose services and makes them available at `feature-1.local:PORT`.

### 6. Stop Services

```bash
port down
```

Stops services and optionally shuts down Traefik if no other projects are running.

### 7. List Active Worktrees

```bash
port list
```

Shows all worktrees and their service status.

### 8. Remove a Worktree

```bash
port remove feature-1
```

Stops services and removes the worktree entirely.

## Commands

| Command                      | Description                                       |
| ---------------------------- | ------------------------------------------------- |
| `port init`                  | Initialize `.code/` directory structure           |
| `port install [--dns-ip IP]` | Set up DNS for `*.local` domains                  |
| `port <branch>`              | Enter a worktree (creates if doesn't exist)       |
| `port up`                    | Start docker-compose services in current worktree |
| `port down`                  | Stop docker-compose services                      |
| `port remove <branch>`       | Remove a worktree entirely                        |
| `port list`                  | List all worktrees and their status               |

## How It Works

### Architecture

```
┌─────────────────────────────────┐
│ CLI Tool: port                  │
│ (installed globally)            │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Your Project: ~/projects/my-app │
│ ├── .code/                      │
│ │   ├── config.jsonc            │
│ │   └── trees/                  │
│ │       ├── feature-1/          │
│ │       └── feature-2/          │
│ └── docker-compose.yml          │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Traefik (global)                │
│ ~/.code/traefik/                │
│ - Routes by hostname            │
│ - Manages all services          │
└─────────────────────────────────┘
```

### Port Conflict Resolution

Multiple worktrees can run simultaneously because:

1. Host port bindings are disabled in worktree overrides
2. Services only listen on internal container ports
3. Traefik routes by Host header, not port number

**Example:**

```bash
# feature-1 worktree
port feature-1
port up
# Available at: feature-1.local:3000

# In another terminal, feature-2 worktree (same ports!)
port feature-2
port up
# Available at: feature-2.local:3000

# No conflicts! Traefik routes both to the same internal port on different containers
```

## Project Structure

```
port/
├── package.json
├── tsconfig.json
├── eslint.config.ts
├── prettier.config.ts
├── src/
│   ├── index.ts                 # Entry point
│   ├── commands/
│   │   ├── init.ts
│   │   ├── install.ts
│   │   ├── enter.ts
│   │   ├── up.ts
│   │   ├── down.ts
│   │   ├── remove.ts
│   │   └── list.ts
│   ├── lib/
│   │   ├── config.ts
│   │   ├── git.ts
│   │   ├── compose.ts
│   │   ├── traefik.ts
│   │   ├── registry.ts
│   │   ├── dns.ts
│   │   ├── sanitize.ts
│   │   └── worktree.ts
│   └── types.ts
├── traefik/
│   └── docker-compose.yml
└── README.md
```

## Requirements

- Node.js 18+
- Git 2.7+
- Docker & Docker Compose v2.24.0+
- macOS or Linux

## Configuration

See [PLAN.md](./PLAN.md) for detailed configuration options and examples.

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run dev init

# Build
bun run build

# Format code
bun run format

# Lint
bun run lint
```

## License

MIT
