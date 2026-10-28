# Development

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
bunx vitest --shard=1/4
bunx vitest --shard=2/4
bunx vitest --shard=3/4
bunx vitest --shard=4/4
```

## Performance benchmarks

```bash
# Run deterministic CLI and worktree benchmarks
bun run benchmark

# Include Docker status and a warm `port up` lifecycle benchmark
BENCHMARK_INCLUDE_DOCKER=1 bun run benchmark
```

The benchmark suite measures p50 and p95 command latency against small and 32-worktree fixtures. p95 budgets are defined in `src/lib/benchmarkPolicy.ts` and may be adjusted by the maintainer as expectations evolve.

For per-command diagnosis, set `PORT_PROFILE=1`. Port emits one machine-readable JSON profile to stderr after the command finishes, including CLI startup, registration, Git/GitHub, and Docker/Compose phases:

```bash
PORT_PROFILE=1 port status
```

Profiling is opt-in, does not change normal command output, and records only the command name—not its arguments.

CI keeps developer-facing CLI, worktree, and Docker history on the generated `gh-pages` branch. Pull requests compare the merge result against that history, upload raw samples and a non-persistent chart preview for 30 days, and fail only when an absolute p95 budget is exceeded. Relative regressions of 25% are reported but do not fail CI.

## Testing in Ubuntu Container

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
