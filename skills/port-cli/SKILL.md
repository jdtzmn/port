---
name: port-cli
description: >
  Use when managing git worktrees and local services with the Port CLI,
  including setup, entering worktrees, running Docker Compose or host
  processes, viewing URLs/status, and cleaning up safely.
---

# Port CLI

Port manages Git worktrees and local services so multiple branches can run
simultaneously without port conflicts. It creates/enters worktrees, rewrites
Docker Compose host ports, routes services through Traefik, and can run host
processes behind the same routing layer.

## Safety Rules

- Inspect state before changing it: prefer `port status`, `port list`, and
  `port urls` first.
- Ask before privileged machine setup with `port install` or `port uninstall`.
- Ask before destructive cleanup: `port remove`, `port prune`, and
  `port cleanup` can delete worktrees, branches, containers, volumes, or
  images.
- Do not read or print secret environment files while troubleshooting Port projects.
- If shell integration is not installed, `port enter` and `port exit` may
  print a `cd` command instead of changing the current shell directory.

## First-Time Setup

Use this workflow when a repository has not been prepared for Port yet:

```bash
port onboard
port init
port install
```

Then add shell integration to the user's shell profile:

```bash
eval "$(port shell-hook bash)" # bash
# or
eval "$(port shell-hook zsh)"  # zsh
# or
port shell-hook fish | source  # fish
```

Notes:

- `port init` scaffolds `.port/config.jsonc`, hooks, and templates in the repository.
- `port install` configures wildcard DNS for the configured domain, usually `*.port`.
- `port install` may need administrator privileges.

## Worktree Workflow

Use this flow to work on a branch:

```bash
port enter <branch>
port up [services...]
port urls [service]
```

Common follow-ups:

```bash
port status              # show services across worktrees
port down [services...]  # stop services in the current worktree
port exit                # return to the repository root
```

Guidance:

- Use `port enter <branch>` explicitly when the branch name might collide
  with a command such as `status`, `install`, or `remove`.
- `port <branch>` is shorthand for entering or creating a worktree.
- Run `port up` inside a Port worktree to start Docker Compose services with
  conflict-free routing.
- Use `port urls` to show the exact branch URLs to open or share.

## Host Process Workflow

Use `port run` for non-Docker development servers that honor the `PORT`
environment variable:

```bash
port run 3000 -- npm run dev
port run 8080 -- python -m http.server
```

Then inspect or stop host services with:

```bash
port status
port urls
port kill [port]
```

Port chooses an available host port, sets `PORT` for the child process, and
routes the logical port through Traefik.

## Compose and Hooks

- Use `port compose [args...]` or `port dc [args...]` to run Docker Compose
  with Port's generated file arguments.
- Use `port open` to re-run the repository/worktree `post-up` hook.
- Use `port hook --list` to inspect available hooks, or `port hook
<hook-name>` to re-run one.

## Cleanup Workflow

Before cleanup, inspect state:

```bash
port status
port list
```

Cleanup commands:

```bash
port remove <branch> [--keep-branch]
port prune --dry-run
port cleanup
```

Safety notes:

- `port remove` stops services, removes the worktree, and archives the local
  branch unless `--keep-branch` is used.
- `port prune` removes worktrees for branches that have been merged; start
  with `--dry-run`.
- `port cleanup` deletes archived branches created by `port remove`.
- Docker image cleanup is opt-in with `--cleanup-images`; avoid it unless the
  user explicitly wants image cleanup.

## Troubleshooting Checklist

1. Run `port status` to see known worktrees and services.
2. Run `port urls` inside the worktree to confirm expected hostnames.
3. Verify Docker and Docker Compose are available when using `port up`.
4. If domains do not resolve, confirm `port install` has been run for the
   configured domain.
5. If a branch name matches a Port command, use `port enter <branch>` instead
   of `port <branch>`.
6. For host processes, confirm the command respects the `PORT` environment variable.

## Reference

- Project README: <https://github.com/jdtzmn/port#readme>
- Install the CLI: `npm install -g @jdtzmn/port` or
  `bun add -g @jdtzmn/port`
