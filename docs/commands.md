# Commands

Detailed usage for each Port command. Run `port onboard` for the same guidance in the CLI.

## Command reference

| Command                                                             | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `port init`                                                         | Initialize `.port/` directory structure                             |
| `port onboard`                                                      | Print recommended workflow and command usage guide                  |
| `port install [--dns-ip IP] [--domain DOMAIN]`                      | Set up DNS and shell hook for wildcard domain (default from config) |
| `port shell-hook <bash\|zsh\|fish>`                                 | Print shell integration code for automatic cd                       |
| `port completion <bash\|zsh\|fish>`                                 | Generate shell completion script for tab completion                 |
| `port enter <branch>`                                               | Enter a worktree explicitly (including command names)               |
| `port <branch>`                                                     | Enter a worktree (creates if doesn't exist)                         |
| `port exit`                                                         | Exit the current worktree and return to repo root                   |
| `port rename <branch>` / `port mv <branch>`                         | Rename the current worktree and branch in place                     |
| `port up [services...]`                                             | Start docker-compose services in current worktree                   |
| `port open`                                                         | Re-run the `post-up` hook in the current repo/worktree context      |
| `port down [services...]`                                           | Stop docker-compose services and host processes selectively         |
| `port run <port> [-d] -- <command...>`                              | Run a host process with Traefik routing (`-d` detaches)             |
| `port kill [port]`                                                  | Stop host services (optionally by logical port)                     |
| `port remove <branch> [--force] [--keep-branch] [--cleanup-images]` | Remove worktree, archive branch, clean up Docker resources          |
| `port prune [--dry-run] [--force] [--cleanup-images]`               | Remove worktrees for merged branches, clean up Docker resources     |
| `port cleanup [--cleanup-images]`                                   | Delete archived branches and their Docker resources                 |
| `port compose <args...>` (alias: `dc`)                              | Run docker compose with auto `-f` flags                             |
| `port list`                                                         | Print worktree names, one per line                                  |
| `port status`                                                       | Show service status across all worktrees                            |
| `port doctor [--verbose]`                                           | Diagnose Port prerequisites, routing, and project configuration     |
| `port urls [service]`                                               | Show service URLs for current worktree                              |
| `port uninstall [--yes] [--domain DOMAIN]`                          | Remove DNS configuration for wildcard domain                        |
| `port hook [hook-name] [--list]`                                    | List or manually run a configured lifecycle hook                    |

### Stale worktree warnings

`port status` and `port list` may warn when the repo has 10 or more stale Port worktrees:

`You have X stale port worktrees. Consider running port prune.`

`port enter <branch>` shows the same warning only when the stale count is extreme (25+), and it never blocks worktree creation.

## Enter a worktree

```bash
port feature-1
port enter feature-1
```

This creates a new worktree and changes into it (with shell integration) or prints the path to `cd` into.
Use `port enter <branch>` when your branch name collides with a command (for example `status` or `install`).
If a branch and command collide, running `port <command>` shows a hint to use `port enter <branch>`.
If the branch is already checked out in another worktree, `port enter` shows you where it is and asks whether to enter that worktree instead (non-interactive terminals reuse it automatically).

To enter from a GitHub link, use the explicit form (requires an authenticated `gh` CLI and a matching GitHub `origin`):

```bash
port enter 'https://github.com/owner/repo/issues/42' # <your-github-login>/issue-42
port enter 'https://github.com/owner/repo/pull/57'   # PR head branch
```

Issue links create or reuse a branch named for your GitHub login and issue number. PR links reuse the head branch's worktree; for a new branch, Port fetches the PR head from the repository, including fork PRs. Existing branches are never reset. An unrelated branch with the same name, a conflicting worktree path, or a URL for another repository produces an error rather than entering the wrong worktree. Closed PRs require a previously associated local branch. Other URLs are not treated as branch names.

## Exit a worktree

```bash
port exit
```

Returns to the repository root and clears the `PORT_WORKTREE` environment variable.

## Rename a worktree

```bash
port rename feature-new
# or use the shorthand
port mv feature-new
```

Run this from inside the worktree after stopping its services. It renames the current worktree and branch in place and keeps Port state aligned.

## Start services

```bash
port up [services...]
```

Starts docker-compose services and makes them available at `feature-1.port:PORT`.
Omit `services...` to start everything, or pass specific service names to start a subset and their dependencies.
For services with published ports, the first one is also reachable at `service.feature-1.port`.

If `.port/hooks/post-up.sh` is executable, Port runs it after services are up. You can manually
rerun that hook with:

```bash
port open
```

## Stop services

```bash
port down [services...]
```

Stops all services by default, or a selected subset when service names are provided. The selected containers are removed without tearing down the whole worktree.

## Run host processes (non-Docker)

```bash
port run 3000 -- npm run dev
```

Runs a host process (not in Docker) and routes traffic through Traefik. The command receives the `PORT` environment variable set to an ephemeral port, while users access it via `<branch>.port:3000`.

This is useful for:

- Development servers that don't run in Docker
- Quick testing without containerization
- Running multiple instances of the same service on different worktrees

## Check status and URLs

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

## Remove a worktree

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

## Clean up archived branches

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
