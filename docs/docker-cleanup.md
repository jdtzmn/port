# Docker cleanup

Port automatically manages Docker resources when removing worktrees or cleaning up archived branches.

## Safety Levels

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

## Interactive vs Non-Interactive Mode

**Interactive Mode** (default when running commands manually):

- Shows image count and size estimate
- Prompts with default answer **No**
- Example: `Clean up 3 image(s) (150.0 MB)? (y/N)`

**Non-Interactive Mode** (CI, scripts, `--force` flag):

- Skips image cleanup by default
- Use `--cleanup-images` flag to clean up images
- Example: `port remove feature-1 --cleanup-images`

## Commands with Docker Cleanup

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

## Why Default to No?

Images default to **No** because:

1. Images are expensive to rebuild (time + bandwidth)
2. Base images are typically shared across projects
3. Docker's layer cache means images often cost less disk than expected
4. Users can always run cleanup later with `--cleanup-images`

The conservative default prevents accidental removal of shared resources while still providing automatic cleanup of project-specific resources.
