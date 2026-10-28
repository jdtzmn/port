# Hooks

Port supports executable shell hooks in `.port/hooks/`:

- `post-create.sh`: runs after a new worktree is created by `port enter <branch>`
- `post-up.sh`: runs after `port up [services...]` successfully starts services
- `pre-run.sh`: runs before `port run <port> -- <command...>` starts the host process

Hooks receive these environment variables:

- `PORT_ROOT_PATH`
- `PORT_WORKTREE_PATH`
- `PORT_BRANCH`
- `PORT_DOMAIN`
- `PORT_HOSTNAME_LABEL`: sanitized branch name, truncated to 63 characters (the same label Traefik routes on) — use this instead of re-deriving a hostname from `PORT_BRANCH`
- `PORT_HOSTNAME`: `PORT_HOSTNAME_LABEL` + `.` + `PORT_DOMAIN`

`pre-run.sh` also receives `PORT_LOGICAL_PORT`, `PORT_ACTUAL_PORT`, and `PORT_ENV_FILE`. Append `KEY=VALUE` lines to `$PORT_ENV_FILE` to override environment variables for the command spawned by `port run`:

```bash
if [ -n "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL=${DATABASE_URL/localhost:5432/$PORT_HOSTNAME:5432}" >> "$PORT_ENV_FILE"
fi
```

Manual hook commands:

```bash
port hook --list
port hook post-create
port hook post-up

# shorthand for `port hook post-up`
port open
```
