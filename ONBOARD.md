# Port Onboarding

## Recommended Flow

### 1. `port init`

- **How**: Run in your repository root if setup has not been done yet (check with port status first).
- **Why**: Creates .port config, hooks, and worktree directories.

### 2. `port install`

- **How**: Run once per machine (or when changing domain/IP).
- **Why**: Configures wildcard DNS so branch domains resolve locally.

### 3. `port enter <branch>`

- **How**: Use explicit enter, especially when branch names match commands.
- **Why**: Creates or enters the branch worktree safely and predictably.

### 4. `port up`

- **How**: Run inside a worktree after entering it.
- **Why**: Starts services and wires routing through Traefik.

### 5. `port urls [service]`

- **How**: Run in a worktree or repository root.
- **Why**: Shows the exact branch URLs to open and share.

### 6. `port status`

- **How**: Run anytime when you need service-level visibility.
- **Why**: Shows running/stopped services across all worktrees.

### 7. `port down`

- **How**: Run in a worktree when you are done testing.
- **Why**: Stops project services and offers Traefik shutdown when appropriate.

### 8. `port remove <branch>`

- **How**: Use after a branch is done.
- **Why**: Stops services, removes worktree, and archives the local branch.

## Useful Checks

- `port list`: quick worktree and host-service summary
- `port kill [port]`: stop host processes started with port run
- `port cleanup`: delete archived local branches from port remove
