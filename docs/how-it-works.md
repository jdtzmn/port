# How Port works

## Architecture

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

## Port Conflict Resolution

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

## Custom 404 Handler

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

## Host Process Routing

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

**Detached mode:**

```bash
port run 3000 -d -- npm run dev
# CLI exits immediately; output goes to .port/logs/<branch>-<port>.log
tail -f .port/logs/feature-1-3000.log
port kill 3000  # stop the detached process
```

Detached processes survive closing the terminal, so they are cleaned up by `port kill` instead of Ctrl+C.

## Compose overrides reference

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

| Port-managed change                                                       | Why it is necessary                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p <project-name>` (compose flag)                                        | Namespaces compose resources per repo/worktree so similarly named stacks do not collide.                                                                             |
| `-f .port/override.yml` (compose flag)                                    | Applies Port's deterministic runtime adjustments without mutating your source compose file.                                                                          |
| `-f .port/override.user.yml` (compose flag, optional)                     | Applies user-provided overrides rendered from `.port/override-compose.yml`, after Port defaults, so user rules win.                                                  |
| `services.<name>.ports: !override []` (for services with published ports) | Removes host port binds so two worktrees can both run services that declare the same host ports.                                                                     |
| `services.<name>.labels: [...]`                                           | Adds Traefik router/service metadata so requests route by hostname (`<branch>.port`) and service aliases (`<service>.<branch>.port`) instead of host port ownership. |
| `services.<name>.networks: [traefik-network]`                             | Ensures Traefik can reach exposed services on the shared network.                                                                                                    |
| `services.<name>.container_name` rewrite (only when upstream sets one)    | Prevents global Docker container name conflicts when upstream hard-codes a fixed `container_name`.                                                                   |
| `networks.traefik-network.external: true`                                 | Connects project services to the globally managed Traefik network instead of creating per-project duplicates.                                                        |

Notes:

- For services without published ports, Port does not inject Traefik labels/ports/network wiring.
- Port intentionally does not override `image`, `build`, `environment`, `volumes`, `depends_on`, or `command`.
- `.port/override-compose.yml` is optional and user-editable; if missing, Port skips the user layer.
- Supported user override variables: `PORT_ROOT_PATH`, `PORT_WORKTREE_PATH`, `PORT_BRANCH`, `PORT_DOMAIN`, `PORT_HOSTNAME_LABEL`, `PORT_HOSTNAME`, `PORT_PROJECT_NAME`, `PORT_COMPOSE_FILE`.

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
