# Remote services: infrastructure and SSH bootstrap gates

The networking proof uses explicit test-only `ssh -L` arguments. Separately,
`bootstrap.py` exercises the actual built Port CLI, opt-in Bash shell hook, and
a plain `ssh remote-a` login with an automatic remote handshake, missing-Port
`ssh remote-b` login, and ordinary noninteractive SSH passthrough. **Automatic
service discovery/routing is not implemented or claimed by these tests.**

## Run

From the worktree root:

```sh
bash tests/remote-e2e/run.sh
```

Requires Bash, Python 3 (stdlib only), Git, and a working Docker daemon with
Compose v2 supporting `up --wait` and `cp`. Linux containers and privileged
Docker-in-Docker must be supported (Docker Desktop or a suitable Linux runner).
The build/pull stages need registry and Debian package mirror access. All base
and smoke images use explicit version tags, not `latest`; tags are not digest
locks. Bun and checkout dependencies (`bun install --frozen-lockfile`) are needed
to build Port. No runner DNS setup is required. Only fresh build artifacts and
package metadata are copied into fixtures, not the repository or secret files.

## Experimental bootstrap scope

Enable with `eval "$(port shell-hook bash --remote-services)"` in Bash. Existing
SSH aliases/functions are left alone. Other shells retain normal Port hooks but
currently reject this experimental flag. Unsupported SSH invocations or existing
multiplexing policies pass through unchanged. `command ssh` bypasses integration.

The preflight uses `ssh -G`, which can evaluate `Match exec` a second time; this
is not universally side-effect-free. Authentication stays with foreground SSH;
the companion cannot start fallback transport. Missing remote Port disables the
handshake without breaking login. No remote install or special output occurs.

The product test checks an actual private handshake file, exit status 7, and
session cleanup on remote-a. After networking and multiplexing pass, `run.sh`
renames `/usr/local/bin/port` to `/usr/local/bin/port-unavailable` only on the
disposable remote-b fixture. The same local Bash hook and plain `ssh remote-b`
must still give the fixture user an interactive login with no Port on PATH.
The test checks a locally owned mode-0700 session, waits boundedly for its exact
`__remote-observe` process to disappear using only client-fixture `/proc/*/cmdline`
(no environment reads or command-line dumps), then requires no handshake,
exit status 9, and removal of all owned session state. No code under test is patched.
An ordinary remote command from the same local shell also checks noninteractive
SSH passthrough, exact exit status 23, and no new local session directories during
its completion checks or afterward. All aliases use the fixture's normal SSH config.
Additional gates exercise ProxyJump via remote-b and an encrypted fixture key:
the interactive login must prompt exactly once, establish the companion handshake,
preserve the requested exit status, and clean up. Only the disposable test key is
encrypted with a test-only passphrase; no user keys are used or collected.
Password authentication, job-control suspend/resume, and broader disconnect cases
remain release gates before treating the experimental hook as production-ready.

## What is actually exercised

- One disposable Debian client with OpenSSH client, Python stdlib PTYs,
  dnsmasq, `psql`, and the Docker CLI.
- Two separate PostgreSQL 17 clusters (`remote_a`, `remote_b`), each alongside
  a real OpenSSH server. PostgreSQL listens only on that remote's loopback.
- Runtime-generated Ed25519 client and server keys. Only public keys cross a
  project-scoped volume. Private keys stay in ephemeral container filesystems;
  they are never printed, copied to the runner, or collected as artifacts.
- `known_hosts` is provisioned from the generated server public keys, not
  `ssh-keyscan`/TOFU. Strict checking, identity selection, and batch authentication
  are enforced. A negative test requires rejection with an empty trust file.
- Two concurrent **interactive plain `ssh` processes** launched with controlling
  PTYs by `pty.fork()`. Neither has a remote command nor `-N`: shell commands are
  typed over each PTY and require a real remote terminal and the fixture user.
- dnsmasq answers `db-a.ssh -> 127.77.0.2` and `db-b.ssh -> 127.77.0.3`.
  Both explicit local forwards bind port **5432**, each on a different client
  loopback address, and target the corresponding remote's `127.0.0.1:5432`.
- Before forwarding, `psql` must fail. With both shells alive, `psql` connects
  using each **hostname and original port 5432**, without a `hostaddr` override.
  SQL asserts database name, server address/port, and distinct PostgreSQL system
  identifiers, proving distinct backend clusters rather than just open sockets.
- A dedicated `docker:27.5.1-dind` fixture runs a real `busybox:1.37.0` container
  and checks its output. The runner pulls/saves this small image and loads it
  into the inner daemon because the fixture network has no registry egress.
  The smoke container itself runs with `--network=none` and `--pull=never`.

## Isolation and cleanup

Every run uses a random Compose project with its own `internal: true` network,
public-key volume, and DinD storage. There are no published ports, fixed container
names, external networks, or host Docker socket mounts. Only the client rewrites
its own `/etc/resolv.conf`; the runner's DNS and hosts files are untouched.
Compose is explicitly passed `/dev/null` as its env file and implicit env-file
loading is disabled; no `.env` files are read.

**Privileged fixture warning:** only DinD is privileged. Its unauthenticated TCP
API is reachable solely on the private fixture network, never published on the
runner. This is disposable test infrastructure, not a secure production daemon
configuration. Privileged DinD is not a security boundary against malicious
fixture code; run only trusted test code on an appropriate runner. The runner's
Docker CLI creates fixtures and seeds the image, but the client never receives
access to the runner daemon.

`run.sh` bounds builds (600s), pulls (120s), Compose readiness (150s, with a
210s outer deadline), and the proof (150s). Individual PTY, SQL, daemon smoke,
copy/load, diagnostic and cleanup operations have their own deadlines.
`bounded.py` keeps only the last 64 KiB of each operation's output. Sanitized
operation selection (no environment/inspect/key dumps), log-tail limits, and
private artifact permissions keep diagnostics narrow. PTY transcripts are at
most 16 KiB per shell and contain only fixture shell commands/output.

An EXIT/INT/TERM trap always attempts bounded diagnostics and
`compose down --volumes --remove-orphans`, then removes the temporary image tar.
The original failure status is preserved; cleanup failure changes an otherwise
successful result to failure. As with any process, SIGKILL or a dead Docker daemon
can prevent cleanup; a failure message identifies the unique project to remove.
Images/build cache remain reusable; project containers, networks, anonymous
Postgres volumes, keys and DinD volumes are removed.

Logs live under the already-ignored worktree-root directory
`.remote-e2e-artifacts/remote-e2e-<unique-id>/`. Start with `proof.log`,
`readiness.log`, `fixture-logs.log`, and `cleanup.log` on failure. Do not collect
private key files or entire container filesystems for diagnostics.

## Lightweight validation (no fixture execution)

```sh
bash -n tests/remote-e2e/run.sh tests/remote-e2e/client.sh tests/remote-e2e/remote.sh
python3 -c 'import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path("tests/remote-e2e").glob("*.py")]'
COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null \
  -p remote-e2e-config-check -f tests/remote-e2e/compose.yaml config --quiet
```

## Multiplexing lifecycle gate

`mux.py` additionally probes a private mode-0700 ControlPath and bounded
ControlPersist. A clean companion invocation reuses the authenticated master
without replaying login configuration; `ProxyCommand=false` prevents transport
fallback when the socket is absent. The interactive primary must return exit
status 7 promptly while the companion is still active. Explicit master shutdown
must reap the companion and remove the socket. These are transport feasibility
assertions, not a shipped SSH wrapper. See `multiplexing.log` for bounded results.

These checks do not prove runtime feasibility. Run the full entrypoint on a
Docker-capable runner to establish that. `.github/workflows/remote-e2e.yml` runs
this same entrypoint on GitHub's Ubuntu runner on every push and uploads bounded
diagnostics on failure. No package-script integration is needed.
