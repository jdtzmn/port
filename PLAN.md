# Feature: `port run` for Host Services

## Overview

Add support for running **host-based processes** (not Docker containers) through Traefik routing. This enables running commands like `npm serve` or `python -m http.server` and accessing them via `<branch>.port:<port>` hostnames, just like Docker services.

### Example Usage

```bash
# In .port/trees/feature-1 directory
$ port run 3000 -- npm serve
# Service available at http://feature-1.port:3000

# In another terminal, .port/trees/feature-2 directory
$ port run 3000 -- npm serve
# Service available at http://feature-2.port:3000

# No port conflicts! Both run simultaneously.
```

---

## Problem Statement

The current `port` tool works with Docker Compose services by:

1. Removing host port bindings via `!override`
2. Adding Traefik labels for routing
3. Using Docker's internal networking

But for **host processes** (running directly on the machine, not in containers), there's no way to:

- Register them with Traefik dynamically
- Avoid port conflicts between worktrees

---

## Solution Architecture

### Key Insight

Two processes can't both listen on port 3000 on the same host. So `port run 3000 -- <command>` will:

1. **Allocate a unique ephemeral port** (e.g., 49152)
2. **Run the command** with `PORT=49152` environment variable
3. **Register with Traefik** via file provider: `feature-1.port:3000` → `host.docker.internal:49152`
4. **Clean up** the Traefik config when the process exits

### Traefik File Provider

Currently, Traefik only uses the Docker provider (discovers services via container labels). We need to add a **file provider** that watches a directory for dynamic configuration:

```yaml
providers:
  docker:
    exposedByDefault: false
    network: traefik-network
  file:
    directory: /etc/traefik/dynamic
    watch: true
```

When a host service starts, we write a YAML file to this directory. Traefik picks it up automatically and starts routing traffic. When the service stops, we delete the file.

---

## Implementation Plan

### Files to Create

| File                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `src/commands/run.ts`    | New `port run` command                         |
| `src/lib/hostService.ts` | Host service registry & config file management |

### Files to Modify

| File                   | Changes                                           |
| ---------------------- | ------------------------------------------------- |
| `src/index.ts`         | Register `run` command with Commander             |
| `src/types.ts`         | Add `HostService` interface                       |
| `src/lib/registry.ts`  | Add `hostServices` array to registry schema       |
| `src/lib/traefik.ts`   | Add file provider config, dynamic directory setup |
| `src/commands/down.ts` | Prompt to stop host services when running         |
| `src/commands/list.ts` | Display running host services                     |

---

## Detailed Specifications

### 1. Command Syntax

```bash
port run <logical-port> -- <command...>
```

- `<logical-port>`: The port users access (e.g., 3000)
- `--`: Separator between port args and the command
- `<command...>`: The command to run (receives `PORT` env var)

**Examples:**

```bash
port run 3000 -- npm run dev
port run 8080 -- python -m http.server
port run 4000 -- cargo run
```

The command should use the `PORT` environment variable for its listen port. Most frameworks support this natively.

### 2. Registry Schema Changes

**Current schema** (`~/.port/registry.json`):

```json
{
  "projects": [...]
}
```

**New schema:**

```json
{
  "projects": [...],
  "hostServices": [
    {
      "repo": "/Users/alice/projects/my-app",
      "branch": "feature-1",
      "logicalPort": 3000,
      "actualPort": 49152,
      "pid": 12345,
      "configFile": "/Users/alice/.port/traefik/dynamic/feature-1-3000.yml"
    }
  ]
}
```

**`HostService` interface** (add to `src/types.ts`):

```typescript
export interface HostService {
  /** Absolute path to repo root */
  repo: string
  /** Sanitized branch/worktree name */
  branch: string
  /** Port users access (e.g., 3000) */
  logicalPort: number
  /** Actual port the process listens on */
  actualPort: number
  /** Process ID of the running command */
  pid: number
  /** Path to the Traefik dynamic config file */
  configFile: string
}
```

### 3. Traefik Configuration Changes

**Update `generateTraefikConfig()` in `src/lib/traefik.ts`:**

```yaml
api:
  dashboard: true
  insecure: false

providers:
  docker:
    exposedByDefault: false
    network: traefik-network
  file: # NEW
    directory: /etc/traefik/dynamic # NEW
    watch: true # NEW

entryPoints:
  web:
    address: ':80'
  port3000:
    address: ':3000'
  # ... etc
```

**Update `updateTraefikCompose()` to mount the dynamic directory:**

```yaml
services:
  traefik:
    image: traefik:v3.0
    container_name: port-traefik
    restart: unless-stopped
    ports:
      - '80:80'
      - '3000:3000'
      # ... etc
    volumes:
      - '/var/run/docker.sock:/var/run/docker.sock:ro'
      - './traefik.yml:/etc/traefik/traefik.yml:ro'
      - './dynamic:/etc/traefik/dynamic:ro' # NEW
    networks:
      - traefik-network
```

**Create `~/.port/traefik/dynamic/` directory** (created by `ensureTraefikDir()` or on first `port run`).

### 4. Dynamic Config File Format

When `port run 3000 -- npm serve` is executed in worktree `feature-1`, write this file to `~/.port/traefik/dynamic/feature-1-3000.yml`:

```yaml
http:
  routers:
    feature-1-3000:
      rule: Host(`feature-1.port`)
      entryPoints:
        - port3000
      service: feature-1-3000
  services:
    feature-1-3000:
      loadBalancer:
        servers:
          - url: http://host.docker.internal:49152
```

Where `49152` is the dynamically allocated actual port.

**Note:** On Linux, `host.docker.internal` may need `--add-host` flag or `host.containers.internal`. This may require additional handling depending on Docker version.

### 5. `src/lib/hostService.ts` Functions

```typescript
/**
 * Find an available port in the ephemeral range (49152-65535)
 * Uses Node-compatible `net` APIs to find a free port
 */
export async function findAvailablePort(): Promise<number>

/**
 * Write Traefik dynamic config file for a host service
 */
export async function writeHostServiceConfig(
  branch: string,
  logicalPort: number,
  actualPort: number,
  domain: string
): Promise<string> // Returns path to config file

/**
 * Remove Traefik dynamic config file
 */
export async function removeHostServiceConfig(configFile: string): Promise<void>

/**
 * Register a host service in the global registry
 */
export async function registerHostService(service: HostService): Promise<void>

/**
 * Unregister a host service from the global registry
 */
export async function unregisterHostService(
  repo: string,
  branch: string,
  logicalPort: number
): Promise<void>

/**
 * Get a host service from the registry
 */
export async function getHostService(
  repo: string,
  branch: string,
  logicalPort: number
): Promise<HostService | undefined>

/**
 * Get all host services for a worktree
 */
export async function getHostServicesForWorktree(
  repo: string,
  branch: string
): Promise<HostService[]>

/**
 * Check if a process is still running by PID
 */
export function isProcessRunning(pid: number): boolean

/**
 * Clean up stale host services (dead PIDs)
 * Should be called opportunistically on any port command
 */
export async function cleanupStaleHostServices(): Promise<void>
```

### 6. `src/commands/run.ts` Flow

```
1.  Parse arguments: <logical-port> and <command...>
2.  Detect worktree context via detectWorktree()
    - Error if not in a .port project
3.  Load project config to get domain
4.  Call cleanupStaleHostServices() - opportunistic cleanup
5.  Check if host service already exists for this branch+port
    - If yes: prompt "Service already running for feature-1:3000. Replace? [y/N]"
    - If user says yes: kill old process, remove old config, unregister
    - If user says no: exit
6.  Find available ephemeral port via findAvailablePort()
7.  Ensure Traefik has entrypoint for logical port (reuse ensureTraefikPorts())
8.  Ensure Traefik is running (reuse startTraefik() from up.ts)
9.  Write dynamic config file via writeHostServiceConfig()
10. Register host service with pid: -1 (placeholder)
11. Set up signal handlers (SIGINT, SIGTERM, SIGHUP) for cleanup
12. Spawn child process with:
    - env: { ...process.env, PORT: actualPort.toString() }
    - stdio: 'inherit'
13. Update registry with actual child PID
14. Wait for child process to exit
15. On exit (normal or signal):
    - Remove config file
    - Unregister from registry
    - Exit with same code as child
```

**Signal Handler Example:**

```typescript
const cleanup = async () => {
  await removeHostServiceConfig(configFile)
  await unregisterHostService(repo, branch, logicalPort)
}

process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130) // 128 + SIGINT(2)
})

process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(143) // 128 + SIGTERM(15)
})
```

### 7. Modifications to `src/commands/down.ts`

After stopping Docker services, check for host services:

```typescript
const hostServices = await getHostServicesForWorktree(repo, branch)

if (hostServices.length > 0) {
  const answer = await confirm(
    `${hostServices.length} host service(s) running. Stop them too? [y/N]`
  )

  if (answer) {
    for (const svc of hostServices) {
      try {
        process.kill(svc.pid, 'SIGTERM')
      } catch {
        // Process already dead, just clean up
      }
      await removeHostServiceConfig(svc.configFile)
      await unregisterHostService(svc.repo, svc.branch, svc.logicalPort)
    }
    console.log(`Stopped ${hostServices.length} host service(s)`)
  }
}
```

### 8. Modifications to `src/commands/list.ts`

Add a section showing host services:

```
Worktrees:
  feature-1     3000, 5432    running
  feature-2     3000          stopped

Host Services:
  feature-1:3000  → localhost:49152  (pid: 12345)
  feature-1:8080  → localhost:49201  (pid: 12346)
```

Check if PIDs are still alive and mark dead ones appropriately (or clean them up).

---

## Edge Cases

| Scenario                                | Behavior                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------ |
| SIGKILL (uncatchable)                   | Config file left behind; cleaned up on next `port` command via PID check |
| Port already in use                     | `findAvailablePort()` tries next port in range                           |
| Traefik not running                     | Auto-started before spawning process                                     |
| Not in .port project                    | Error: "Not in a port-managed project. Run 'port init' first."           |
| User Ctrl+C                             | Signal handler cleans up config before exit                              |
| Child process crashes                   | Parent detects exit, cleans up                                           |
| Service already running for branch+port | Prompt to replace; if yes, kill old and start new                        |
| `host.docker.internal` not available    | May need fallback for Linux (see notes below)                            |

---

## Linux `host.docker.internal` Note

On Linux, `host.docker.internal` may not be available by default in older Docker versions. Options:

1. **Docker 20.10+**: Add `extra_hosts: ["host.docker.internal:host-gateway"]` to Traefik's docker-compose
2. **Older Docker**: Use the host's actual IP or `172.17.0.1` (default bridge gateway)

For now, add the `extra_hosts` entry to the Traefik compose file to ensure compatibility.

---

## Testing Checklist

- [ ] `port run 3000 -- npm serve` starts and is accessible at `<branch>.port:3000`
- [ ] Multiple worktrees can run `port run 3000` simultaneously without conflicts
- [ ] Ctrl+C cleanly stops service and removes config
- [ ] `port list` shows running host services
- [ ] `port down` prompts to stop host services
- [ ] Stale services (dead PIDs) are cleaned up on next command
- [ ] Running `port run 3000` twice in same worktree prompts for replacement
- [ ] Works on both macOS and Linux

---

## Implementation Order

1. **Update `src/types.ts`** - Add `HostService` interface
2. **Update `src/lib/registry.ts`** - Handle `hostServices` array in registry
3. **Update `src/lib/traefik.ts`** - Add file provider, dynamic directory, `extra_hosts`
4. **Create `src/lib/hostService.ts`** - All host service functions
5. **Create `src/commands/run.ts`** - Main command implementation
6. **Update `src/index.ts`** - Register the `run` command
7. **Update `src/commands/down.ts`** - Prompt for host service cleanup
8. **Update `src/commands/list.ts`** - Display host services
9. **Test end-to-end**
