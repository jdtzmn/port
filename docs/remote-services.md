# Remote VM services (optional, Bash)

Enable remote service routing during the same one-time setup:

```bash
port install --remote-services

# If DNS is already configured and only the shell hook needs updating
port install --remote-services --shell-hook-only
```

Afterward, use ordinary SSH normally:

```bash
ssh devbox
# On devbox
port up
```

While that SSH session is active, remote services use the same local URLs as local worktrees, such as `ui.feature.port` and `feature.port:3000`. If the same worktree exists in more than one place, use the stable machine-qualified `.ssh` alias shown by Port, such as `ui.feature.devbox.ssh`. Ambiguous default URLs fail closed instead of selecting a machine silently.

The initial integration supports Bash, HTTP routing, and TLS/SNI routing. `command ssh ...` bypasses Port's SSH integration. Plaintext protocols that do not carry a hostname remain limited by Port's existing routing model; broader support is tracked in [#149](https://github.com/jdtzmn/port/issues/149). The remote machine must have a compatible `port` executable, but missing or incompatible remote support never blocks the SSH login.

## macOS remote-services smoke test

Before treating remote routing as released on macOS, verify it manually from a Bash shell:

1. Run `port install --remote-services`, start a fresh Bash shell, and confirm `type ssh` reports the Port wrapper.
2. Open an ordinary `ssh devbox` login, run `port up` in a remote worktree, and verify its HTTP, WebSocket, and PostgreSQL/TLS-SNI `.port` addresses.
3. Start the same worktree locally or on another VM. Confirm the default address fails closed and `port urls --remote` shows the exact `.local.port` and `.ssh` alternatives.
4. Close the remote login abruptly, confirm its qualified address becomes unavailable rather than retargeting, then reconnect and verify recovery.
5. Run `command ssh devbox` and confirm the bypass behaves like unwrapped SSH.
6. Confirm Traefik and relay listeners remain local/private and are not exposed on the LAN.

Use a PostgreSQL client with TLS and SNI enabled (`sslmode=require`; libpq 14 or newer). Record the Port, macOS, Docker Desktop, and client versions with the release result.
