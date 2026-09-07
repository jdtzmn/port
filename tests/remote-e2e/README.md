# Remote services: phase-0 infrastructure proof

This is **infrastructure proof, not product integration**. It does not invoke
Port, install a shell hook, or automatically bootstrap forwarding when `ssh`
starts. Explicit test-only `ssh -L` arguments establish feasibility. A later
phase must replace those arguments with product behavior and add product tests.

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
locks. No npm dependencies or runner DNS setup are required.

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

These checks do not prove runtime feasibility. Run the full entrypoint on a
Docker-capable runner to establish that. `.github/workflows/remote-e2e.yml` runs
this same entrypoint on GitHub's Ubuntu runner on every push and uploads bounded
diagnostics on failure. No package-script integration is needed.
