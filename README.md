# Port

**Run 2+ Docker compose worktrees on the same service ports at the same time without conflicts.**

<table>
  <tr>
    <th>Terminal A (<code>feature-1</code> worktree)</th>
    <th>Terminal B (<code>feature-2</code> worktree)</th>
  </tr>
  <tr>
    <td>
      <pre><code>port feature-1
port up
# Services available at feature-1.port</code></pre>
    </td>
    <td>
      <pre><code>port feature-2
port up
# Services available at feature-2.port</code></pre>
    </td>
  </tr>
</table>

## Features

- **Git Worktree Management**: Create and manage git worktrees with a single command
- **Automatic Traefik Configuration**: Dynamically configure Traefik reverse proxy for local domain access
- **Port Conflict Resolution**: Run multiple worktrees simultaneously without port conflicts
- **Host Process Support**: Run non-Docker processes (like `npm serve`) with Traefik routing
- **DNS Setup**: Automated DNS configuration for `*.port` domains
- **Service Discovery**: Easy access to services via hostnames instead of port numbers

## Installation

```bash
# Port is published on npm, but requires Bun at runtime
npm install -g @jdtzmn/port
# or install globally with Bun
bun add -g @jdtzmn/port
```

`port` executes with a Bun shebang (`#!/usr/bin/env bun`), so Bun must be installed and available on `PATH` even when the package is installed via npm.

## Quick Start

Want a guided workflow in the CLI?

```bash
port onboard
```

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

Configures your system to resolve your configured wildcard domain (default `*.port`) to `127.0.0.1`.

On macOS, `port install` runs privileged steps through a centralized elevation helper: it uses the native admin credential dialog when a GUI session is available and falls back to terminal `sudo` in headless/non-GUI environments.

You can optionally specify a custom IP address:

```bash
# Resolve to a specific IP (useful for Docker networks, etc.)
port install --dns-ip 172.25.0.2

# Skip confirmation prompt
port install --yes

# Combine options
port install --yes --dns-ip 192.168.1.100

# Explicit custom domain
port install --domain custom
```

#### Linux DNS Setup

On Linux systems with `systemd-resolved` running (most modern Ubuntu/Debian systems), the install command automatically:

1. Detects that `systemd-resolved` is using port 53
2. Runs `dnsmasq` on port 5354 to avoid conflicts
3. Configures `systemd-resolved` to forward your wildcard domain queries to dnsmasq

This "dual-mode" setup allows both services to coexist without conflicts.

### 4. Enter a Worktree

```bash
port feature-1
port enter feature-1
```

This creates a new worktree and spawns a subshell inside it.
Use `port enter <branch>` when your branch name collides with a command (for example `status` or `install`).
If a branch and command collide, running `port <command>` shows a hint to use `port enter <branch>`.

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

Shows a concise worktree-level running/stopped summary and any running host services.

For per-service details by worktree:

```bash
port status
```

Show URLs for services in the current worktree:

```bash
port urls
port urls ui-frontend
```

`port urls` works in either a worktree or the main repository.

### 9. Remove a Worktree

```bash
port remove feature-1
# Skip confirmation for non-standard/stale worktree entries
port rm -f feature-1
# Keep the local branch name unchanged
port rm --keep-branch feature-1
```

Stops services, removes the worktree, and soft-deletes the local branch by archiving it under `archive/<name>-<timestamp>`.
Use `--keep-branch` to preserve the local branch name.

### 10. Clean Up Archived Branches

```bash
port cleanup
```

Shows archived branches created by `port remove` and asks for confirmation before deleting all of them.

## Commands

| Command                                          | Description                                           |
| ------------------------------------------------ | ----------------------------------------------------- |
| `port init`                                      | Initialize `.port/` directory structure               |
| `port onboard`                                   | Print recommended workflow and command usage guide    |
| `port install [--dns-ip IP] [--domain DOMAIN]`   | Set up DNS for wildcard domain (default from config)  |
| `port enter <branch>`                            | Enter a worktree explicitly (including command names) |
| `port <branch>`                                  | Enter a worktree (creates if doesn't exist)           |
| `port up`                                        | Start docker-compose services in current worktree     |
| `port down`                                      | Stop docker-compose services and host processes       |
| `port run <port> -- <command...>`                | Run a host process with Traefik routing               |
| `port remove <branch> [--force] [--keep-branch]` | Remove worktree and archive local branch              |
| `port compose <args...>`                         | Run docker compose with auto `-f` flags               |
| `port list`                                      | List worktree and host-service summary                |
| `port status`                                    | Show per-service status by worktree                   |
| `port urls [service]`                            | Show service URLs for current worktree                |
| `port cleanup`                                   | Delete archived local branches with confirmation      |
| `port uninstall [--yes] [--domain DOMAIN]`       | Remove DNS configuration for wildcard domain          |

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
│   │   ├── list.ts
│   │   └── status.ts
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

- Bun 1.0+ (required runtime for the `port` CLI)
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

# Type check
bun run typecheck

# Format code
bun run format

# Lint
bun run lint

# Test
bun run test
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

## Compose Overrides Reference

Port isolates worktrees in layered compose files:

1. Your base compose file (`docker-compose.yml` by default)
2. A generated Port override (`.port/override.yml`)
3. An optional rendered user override (`.port/override.user.yml`)

Port runs compose with user overrides last so local customization wins:

```bash
docker compose -p <project-name> -f docker-compose.yml -f .port/override.yml -f .port/override.user.yml up -d
```

`.port/override.user.yml` is generated at runtime from `.port/override-compose.yml` if that file exists.

Here are all Port-managed overrides/compose controls and why they exist:

| Port-managed change                                                       | Why it is necessary                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `-p <project-name>` (compose flag)                                        | Namespaces compose resources per repo/worktree so similarly named stacks do not collide.                             |
| `-f .port/override.yml` (compose flag)                                    | Applies Port's deterministic runtime adjustments without mutating your source compose file.                          |
| `-f .port/override.user.yml` (compose flag, optional)                     | Applies user-provided overrides rendered from `.port/override-compose.yml`, after Port defaults, so user rules win.  |
| `services.<name>.ports: !override []` (for services with published ports) | Removes host port binds so two worktrees can both run services that declare the same host ports.                     |
| `services.<name>.labels: [...]`                                           | Adds Traefik router/service metadata so requests route by hostname (`<branch>.port`) instead of host port ownership. |
| `services.<name>.networks: [traefik-network]`                             | Ensures Traefik can reach exposed services on the shared network.                                                    |
| `services.<name>.container_name` rewrite (only when upstream sets one)    | Prevents global Docker container name conflicts when upstream hard-codes a fixed `container_name`.                   |
| `networks.traefik-network.external: true`                                 | Connects project services to the globally managed Traefik network instead of creating per-project duplicates.        |

Notes:

- For services without published ports, Port does not inject Traefik labels/ports/network wiring.
- Port intentionally does not override `image`, `build`, `environment`, `volumes`, `depends_on`, or `command`.
- `.port/override-compose.yml` is optional and user-editable; if missing, Port skips the user layer.
- Supported user override variables: `PORT_ROOT_PATH`, `PORT_WORKTREE_PATH`, `PORT_BRANCH`, `PORT_DOMAIN`, `PORT_PROJECT_NAME`, `PORT_COMPOSE_FILE`.

Example generated shape:

```yaml
services:
  web:
    container_name: my-repo-feature-1-web
    ports: !override []
    networks:
      - traefik-network
    labels:
      - traefik.enable=true
      - traefik.http.routers.feature-1-web-3000.rule=Host(`feature-1.port`)
      - traefik.http.routers.feature-1-web-3000.entrypoints=port3000
      - traefik.http.routers.feature-1-web-3000.service=feature-1-web-3000
      - traefik.http.services.feature-1-web-3000.loadbalancer.server.port=3000

networks:
  traefik-network:
    external: true
    name: traefik-network
```

## License

MIT
