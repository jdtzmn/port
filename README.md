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
- **Lifecycle Hooks**: Run custom scripts after worktree creation and after `port up`

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

### 1. (Optional) Initialize Project

```bash
port init
```

This scaffolds `.port/config.jsonc`, hooks, and templates. Core worktree commands can run without this step.

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

### 4. Shell Integration (Recommended)

Add this to your shell profile so `port enter` and `port exit` can change your working directory:

```bash
# ~/.bashrc
eval "$(port shell-hook bash)"

# ~/.zshrc
eval "$(port shell-hook zsh)"

# ~/.config/fish/config.fish
port shell-hook fish | source
```

Without shell integration, `port enter` and `port exit` will print a `cd` command for you to run manually.

### 5. Shell Completions (Optional)

Enable tab completion for port commands and options:

```bash
# Bash - add to ~/.bashrc
eval "$(port completion bash)"

# Zsh - add to ~/.zshrc
eval "$(port completion zsh)"

# Fish - add to ~/.config/fish/config.fish
port completion fish | source
```

This enables tab completion for all port commands, options, and branch names.

### 6. Enter a Worktree

```bash
port feature-1
port enter feature-1
```

This creates a new worktree and changes into it (with shell integration) or prints the path to `cd` into.
Use `port enter <branch>` when your branch name collides with a command (for example `status` or `install`).
If a branch and command collide, running `port <command>` shows a hint to use `port enter <branch>`.

### 7. Exit a Worktree

```bash
port exit
```

Returns to the repository root and clears the `PORT_WORKTREE` environment variable.

### 8. Start Services

```bash
port up
```

Starts docker-compose services and makes them available at `feature-1.port:PORT`.

If `.port/hooks/post-up.sh` is executable, Port runs it after services are up. You can manually
rerun that hook with:

```bash
port open
```

### 9. Stop Services

```bash
port down
```

Stops services and optionally shuts down Traefik if no other projects are running.

### 10. Run Host Processes (Non-Docker)

```bash
port run 3000 -- npm run dev
```

Runs a host process (not in Docker) and routes traffic through Traefik. The command receives the `PORT` environment variable set to an ephemeral port, while users access it via `<branch>.port:3000`.

This is useful for:

- Development servers that don't run in Docker
- Quick testing without containerization
- Running multiple instances of the same service on different worktrees

### 11. Check Status

```bash
port status
```

Shows per-service status grouped by worktree, host services, and Traefik.

Show URLs for services in the current worktree:

```bash
port urls
port urls ui-frontend
```

`port urls` works in either a worktree or the main repository.

### 12. Remove a Worktree

```bash
port remove feature-1
# Skip confirmation for non-standard/stale worktree entries
port rm -f feature-1
# Keep the local branch name unchanged
port rm --keep-branch feature-1
# Clean up Docker images without prompting
port rm --cleanup-images feature-1
```

Stops services, removes the worktree, and soft-deletes the local branch by archiving it under `archive/<name>-<timestamp>`.
Use `--keep-branch` to preserve the local branch name.

**Docker Cleanup Behavior:**

- Always cleans up containers, networks, and volumes (low-risk resources)
- Prompts for image cleanup with default **No** (images may be shared across projects)
- Use `--cleanup-images` to clean up images without prompting
- Image cleanup is opt-in to prevent accidentally removing shared base images

### 13. Clean Up Archived Branches

```bash
port cleanup
# Clean up images without prompting
port cleanup --cleanup-images
```

Shows archived branches created by `port remove` and asks for confirmation before deleting all of them.

**Docker Cleanup Behavior:**

- Automatically cleans up containers, networks, and volumes for archived branches
- Prompts for image cleanup with aggregate size estimate across all branches
- Default answer is **No** to preserve shared images
- Use `--cleanup-images` to clean up images without prompting

## Commands

| Command                                                             | Description                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `port init`                                                         | Initialize `.port/` directory structure                         |
| `port onboard`                                                      | Print recommended workflow and command usage guide              |
| `port install [--dns-ip IP] [--domain DOMAIN]`                      | Set up DNS for wildcard domain (default from config)            |
| `port shell-hook <bash\|zsh\|fish>`                                 | Print shell integration code for automatic cd                   |
| `port completion <bash\|zsh\|fish>`                                 | Generate shell completion script for tab completion             |
| `port enter <branch>`                                               | Enter a worktree explicitly (including command names)           |
| `port <branch>`                                                     | Enter a worktree (creates if doesn't exist)                     |
| `port exit`                                                         | Exit the current worktree and return to repo root               |
| `port up`                                                           | Start docker-compose services in current worktree               |
| `port open`                                                         | Re-run the `post-up` hook in the current repo/worktree context  |
| `port down`                                                         | Stop docker-compose services and host processes                 |
| `port run <port> -- <command...>`                                   | Run a host process with Traefik routing                         |
| `port kill [port]`                                                  | Stop host services (optionally by logical port)                 |
| `port remove <branch> [--force] [--keep-branch] [--cleanup-images]` | Remove worktree, archive branch, clean up Docker resources      |
| `port prune [--dry-run] [--force] [--cleanup-images]`               | Remove worktrees for merged branches, clean up Docker resources |
| `port cleanup [--cleanup-images]`                                   | Delete archived branches and their Docker resources             |
| `port compose <args...>` (alias: `dc`)                              | Run docker compose with auto `-f` flags                         |
| `port list`                                                         | Print worktree names, one per line                              |
| `port status`                                                       | Show service status across all worktrees                        |
| `port urls [service]`                                               | Show service URLs for current worktree                          |
| `port uninstall [--yes] [--domain DOMAIN]`                          | Remove DNS configuration for wildcard domain                    |
| `port hook [hook-name] [--list]`                                    | List or manually run a configured lifecycle hook                |

## Hooks

Port supports executable shell hooks in `.port/hooks/`:

- `post-create.sh`: runs after a new worktree is created by `port enter <branch>`
- `post-up.sh`: runs after `port up` successfully starts services

Both hooks receive these environment variables:

- `PORT_ROOT_PATH`
- `PORT_WORKTREE_PATH`
- `PORT_BRANCH`
- `PORT_DOMAIN`

Manual hook commands:

```bash
port hook --list
port hook post-create
port hook post-up

# shorthand for `port hook post-up`
port open
```

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

### Custom 404 Handler

Port includes a custom 404 handler that helps you discover what's actually running when you visit an unknown URL.

When you navigate to a URL that doesn't match any running worktree (e.g., `http://nonexistent.port:3000`), instead of seeing a generic Traefik error, you'll receive a plain-text response showing:

- **Running worktrees**: If any worktrees have services up, it lists their names
- **Empty state**: If no worktrees are running, it displays "No running worktrees"

**Example responses:**

```
404 - Worktree Not Found

Running worktrees:
feature-1
feature-2
main
```

Or when nothing is running:

```
404 - Worktree Not Found

No running worktrees
```

The handler works by:

1. Running as a lightweight Alpine Linux container alongside Traefik
2. Querying Docker for containers with `traefik.enable=true` labels
3. Extracting worktree names from the `Host()` routing rules
4. Returning the list as plain text on every 404 request

This makes it easy to:

- Debug routing issues
- See what's currently available
- Quickly identify the correct worktree URL to access

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

### Docker Cleanup

Port automatically manages Docker resources when removing worktrees or cleaning up archived branches.

#### Safety Levels

Docker resources are cleaned up in two phases with different safety levels:

**1. Low-Risk Cleanup (Automatic)**

Always runs without prompting for:

- **Containers**: Stopped containers specific to the project
- **Volumes**: Named volumes created by the project
- **Networks**: Custom networks created by compose

These resources are safe to remove because they're project-specific and can be recreated.

**2. High-Risk Cleanup (Opt-In)**

Prompts before removing:

- **Images**: Container images that may be shared across projects

Images require confirmation because:

- Base images (e.g., `node:20`, `postgres:15`) are often shared
- Rebuilding images takes time and bandwidth
- Removing shared images affects other projects

#### Interactive vs Non-Interactive Mode

**Interactive Mode** (default when running commands manually):

- Shows image count and size estimate
- Prompts with default answer **No**
- Example: `Clean up 3 image(s) (150.0 MB)? (y/N)`

**Non-Interactive Mode** (CI, scripts, `--force` flag):

- Skips image cleanup by default
- Use `--cleanup-images` flag to clean up images
- Example: `port remove feature-1 --cleanup-images`

#### Commands with Docker Cleanup

All three cleanup commands follow the same safety pattern:

```bash
# port remove - cleans up single worktree
port remove feature-1              # Prompts for images (default No)
port remove feature-1 --cleanup-images  # Cleans images without prompt

# port prune - cleans up merged worktrees
port prune                         # Shows aggregate image estimate
port prune --force --cleanup-images     # Non-interactive with images

# port cleanup - cleans up archived branches
port cleanup                       # Shows aggregate across all branches
port cleanup --cleanup-images      # Cleans images for all archived branches
```

#### Why Default to No?

Images default to **No** because:

1. Images are expensive to rebuild (time + bandwidth)
2. Base images are typically shared across projects
3. Docker's layer cache means images often cost less disk than expected
4. Users can always run cleanup later with `--cleanup-images`

The conservative default prevents accidental removal of shared resources while still providing automatic cleanup of project-specific resources.

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
│   │   ├── exit.ts
│   │   ├── shell-hook.ts        # Shell integration (bash/zsh/fish)
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
│   │   ├── shell.ts             # Shell command generation
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

# Run a single integration shard (matches CI sharding)
bunx vitest --shard=1/3
bunx vitest --shard=2/3
bunx vitest --shard=3/3
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
