#!/bin/bash
# Port post-create hook
# Runs automatically when a new worktree is created via `port [branch]`
#
# Available environment variables:
#   PORT_ROOT_PATH     - Absolute path to the main repository root
#   PORT_WORKTREE_PATH - Absolute path to the newly created worktree
#   PORT_BRANCH        - The branch name (sanitized)
#
# Exit with non-zero to abort worktree creation (worktree will be removed)
#
# Example: Symlink .env from root to worktree (stays in sync)
#   ln -s "$PORT_ROOT_PATH/.env" "$PORT_WORKTREE_PATH/.env"

# Uncomment and customize below:
# echo "Setting up worktree for $PORT_BRANCH..."
# ln -s "$PORT_ROOT_PATH/.env" "$PORT_WORKTREE_PATH/.env"
# cd "$PORT_WORKTREE_PATH" && npm install
