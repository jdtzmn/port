# Port

A CLI tool that manages git worktrees and automatically configures Traefik reverse proxy to expose services via local domains (e.g., `feature-1.port:3000`).

| Terminal A (`feature-1`)                                           | Terminal B (`feature-2`)                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `port feature-1`<br>`port up`<br>`curl http://feature-1.port:3000` | `port feature-2`<br>`port up`<br>`curl http://feature-2.port:3000` |

**Both worktrees can run the same service ports at the same time without conflicts.**

## Use Case

Developers working with git worktrees can run `port feature-1` to create/enter a worktree, then `port up` to start services accessible at `feature-1.port:PORT`.

## Features

- **Git Worktree Management**: Create and manage git worktrees with a single command
- **Automatic Traefik Configuration**: Dynamically configure Traefik reverse proxy for local domain access
- **Port Conflict Resolution**: Run multiple worktrees simultaneously without port conflicts
- **Host Process Support**: Run non-Docker processes (like `npm serve`) with Traefik routing
- **DNS Setup**: Automated DNS configuration for `*.port` domains
- **Service Discovery**: Easy access to services via hostnames instead of port numbers

## Installation

```bash
# Bun is required at runtime (the CLI uses a Bun shebang)
npm install -g @jdtzmn/port
# or with bun
bun install -g @jdtzmn/port
```

## Quick Start

### 1. Initialize Project

```bash
port init
```

This sets up the `.port/` directory structure and checks DNS configuration.

### 2. Configure Project

Create `.port/config.jsonc` in your project:

```jsonc
{
  // Optional, defaults to "port"
  "domain": "port",

  // Optional, defaults to "docker-compose.yml"
  "compose": "docker-compose.yml",
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

Starts docker-compose services and makes them available at `feature-1.port:PORT`.

### 6. Stop Services

```bash
port down
```

Stops services and optionally shuts down Traefik if no other projects are running.

### 7. Run Host Processes (Non-Docker)

```bash
port run 3000 -- npm run dev
```

Runs a host process (not in Docker) and routes traffic through Traefik. The command receives the `PORT` environment variable set to an ephemeral port, while users access it via `<branch>.port:3000`.

This is useful for:

- Development servers that don't run in Docker
- Quick testing without containerization
- Running multiple instances of the same service on different worktrees

### 8. List Active Worktrees

```bash
port list
```

Shows all worktrees, their service status, and any running host services.

### 9. Remove a Worktree

```bash
port remove feature-1
```

Stops services and removes the worktree entirely.

## Commands

| Command                           | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `port init`                       | Initialize `.port/` directory structure           |
| `port install [--dns-ip IP]`      | Set up DNS for `*.port` domains                   |
| `port <branch>`                   | Enter a worktree (creates if doesn't exist)       |
| `port up`                         | Start docker-compose services in current worktree |
| `port down`                       | Stop docker-compose services and host processes   |
| `port run <port> -- <command...>` | Run a host process with Traefik routing           |
| `port remove <branch>`            | Remove a worktree entirely                        |
| `port compose <args...>`          | Run docker compose with auto `-f` flags           |
| `port list`                       | List all worktrees and their status               |
| `port uninstall [--yes]`          | Remove DNS configuration for `*.port`             |

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
│ ├── .port/                      │
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
│ ~/.port/traefik/                │
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
# Available at: feature-1.port:3000

# In another terminal, feature-2 worktree (same ports!)
port feature-2
port up
# Available at: feature-2.port:3000

# No conflicts! Traefik routes both to the same internal port on different containers
```

### Host Process Routing

The `port run` command enables running non-Docker processes with Traefik routing:

```bash
# In .port/trees/feature-1 directory
port run 3000 -- npm run dev
# Service available at http://feature-1.port:3000

# In another terminal, .port/trees/feature-2 directory
port run 3000 -- npm run dev
# Service available at http://feature-2.port:3000

# No port conflicts! Both run simultaneously.
```

**How it works:**

1. Allocates a unique ephemeral port (e.g., 49152)
2. Sets `PORT=49152` environment variable for the command
3. Registers with Traefik: `feature-1.port:3000` → `localhost:49152`
4. Cleans up when the process exits (Ctrl+C, crash, etc.)

Most frameworks (Express, Next.js, Vite, etc.) respect the `PORT` environment variable automatically.

## Project Structure

```
port/
├── package.json
├── tsconfig.json
├── eslint.config.ts
├── prettier.config.js
├── src/
│   ├── index.ts                 # Entry point
│   ├── commands/
│   │   ├── init.ts
│   │   ├── install.ts
│   │   ├── enter.ts
│   │   ├── up.ts
│   │   ├── down.ts
│   │   ├── run.ts               # Host process runner
│   │   ├── remove.ts
│   │   └── list.ts
│   ├── lib/
│   │   ├── config.ts
│   │   ├── git.ts
│   │   ├── compose.ts
│   │   ├── traefik.ts
│   │   ├── registry.ts
│   │   ├── hostService.ts       # Host service management
│   │   ├── dns.ts
│   │   ├── sanitize.ts
│   │   └── worktree.ts
│   └── types.ts
├── traefik/
│   └── docker-compose.yml
└── README.md
```

## Requirements

- Bun 1.0+
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

### Testing in Ubuntu Container

The project includes a Docker container running Ubuntu 24.04 with systemd for testing the CLI in a Linux environment. This is useful for testing DNS configuration and other Linux-specific features.

```bash
# Start the container and open a bash shell
make ubuntu

# Stop the container
make down
```

Once inside the container, you can test the CLI:

```bash
# Set up DNS for *.port domains
port install --yes

# Test DNS resolution
dig test.port
```

> **Note:** The container overrides `/etc/resolv.conf` to use systemd-resolved for DNS, which allows `*.port` domain resolution to work. However, this means the container does not have access to the outside network (e.g., `apt-get update` or `curl` to external URLs will fail).

## License

MIT
