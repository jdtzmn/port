# Setup

One-time machine setup for Port. For a short path to a working worktree, see the [Quick start](../README.md#quick-start).

## DNS and shell integration

```bash
port install
```

Configures your system to resolve your configured wildcard domain (default `*.port`) to `127.0.0.1`, then offers to add the shell hook to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`).

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

# Configure DNS only, leaving the shell profile untouched
port install --no-shell-hook

# Add the shell hook only, skipping DNS setup
port install --shell-hook-only
```

### Linux DNS setup

On Linux systems with `systemd-resolved` running (most modern Ubuntu/Debian systems), the install command automatically:

1. Detects that `systemd-resolved` is using port 53
2. Runs `dnsmasq` on port 5354 to avoid conflicts
3. Configures `systemd-resolved` to forward your wildcard domain queries to dnsmasq

This "dual-mode" setup allows both services to coexist without conflicts.

## Shell integration

`port install` adds this for you. To set it up by hand instead, add the hook to your shell profile so `port enter` and `port exit` can change your working directory:

```bash
# ~/.bashrc
eval "$(port shell-hook bash)"

# ~/.zshrc
eval "$(port shell-hook zsh)"

# ~/.config/fish/config.fish
port shell-hook fish | source
```

Without shell integration, `port enter` and `port exit` will print a `cd` command for you to run manually.

The block `port install` writes is delimited by `# >>> port shell hook >>>` markers, so `port uninstall` can remove it again (pass `--no-shell-hook` to keep it).

## Shell completions

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

## Agent skill

Port ships an installable Agent Skill that teaches compatible coding agents the safe Port workflow: setup, entering worktrees, starting services, viewing URLs, running host processes, and cleaning up.

```bash
npx skills add jdtzmn/port --skill port-cli -g
# or from a local checkout
npx skills add . --skill port-cli --copy -y
```
