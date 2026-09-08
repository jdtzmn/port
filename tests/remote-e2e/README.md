# Remote services: transport feasibility, Traefik baseline, SSH bootstrap and live discovery

The networking proof uses explicit test-only `ssh -L` arguments. Separately,
`bootstrap.py` exercises the actual built Port CLI, opt-in Bash shell hook, and
a plain `ssh remote-a` login with an automatic remote handshake, missing-Port
`ssh remote-b` login, and ordinary noninteractive SSH passthrough. It also checks
**automatic live discovery from an explicit disposable fixture seed**, not full
`port up` acceptance. **Product transport coordination and routing remain unwired.**

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
to build Port. OpenSSL/LibreSSL is required for local relay identity creation;
missing identity support fails closed, never falling back to plaintext. No runner DNS setup is required. Only fresh build artifacts and
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

### Private transport component gate (not public routing)

Inside the first plain `ssh remote-a` login, `bootstrap.py` launches the compiled
`forward-probe.js` on the **client**, with only the original owned session directory.
The helper calls the actual `openRemoteStream(directory, {address: '127.0.0.1',
port: 5432})` API, which uses an owned Unix socket and mux `-O forward` / `-O cancel`
without new authentication. No test-built `ssh -L` bypass or intermediate TCP
bridge is used for this component gate. A fixture-only mode-0700 directory from
`mkdtempSync('/tmp/port-stream-query-')` contains `.s.PGSQL.5432`, a symlink to
`stream.path`, solely to adapt libpq's socket naming. The bounded JSON response
is `{status: 'ready', address: queryDirectory, port: 5432}`. Python strictly
validates the directory prefix/suffix, ownership and permissions before real
`psql` uses `host=<queryDirectory> port=5432`. SQL checks
`current_database() = remote_a` and a numeric cluster system identifier.
This gate does not compare identifiers between remotes.

The bounded fixed stdin `close` command makes the helper await `close()` twice
and require `stream.connect() === null` before acknowledging closure. Cleanup,
including SIGINT/SIGTERM handling, cancels the original owned stream and removes
only the helper's own symlink and temporary directory. After helper exit, Python
attempts an AF_UNIX connection to the former `.s.PGSQL.5432` path and requires
ENOENT or connection refusal, with no fallback. A normal marker command through
the original interactive shell then proves mux
cancellation did not kill the master/login. Existing live-discovery/corruption
checks, first-login exit status 7, and session cleanup continue unchanged.
Helper/SQL output reads and waits are bounded, stderr is discarded rather than
logging transport/auth details, and finally blocks reap only owned child processes.
The build joins the existing artifact-only copy loop; no source enters fixtures.

`sslmode=disable` is used **only inside this encrypted private SSH transport**.
This is not a user-facing port, public plaintext support / #149, shared-hostname
routing, or full route acceptance. The Traefik TLS baseline is unchanged; automatic
product transport coordination and `port up` routing are still not claimed.

### Actual HTTP component gate (explicit wiring, not automatic publication)

After live discovery finds and directly probes the remote-a workload, **before**
registry corruption or workload stop, `proxy-probe.js` runs on CLIENT with only the
owned SSH session directory. It reads a bounded, private `ready` cache and uses
`parseRemoteSnapshot` to select `feature.port` / `ui` / logical port 3000. The actual
`openRemoteStream(directory, endpoint.target)` forwards through an owned Unix socket
to the discovered Docker IP:8080. Both components use the Unix-stream API, without
an intermediate loopback TCP listener. Fixture sshd permits `*:8080` in addition to its existing specific targets;
this does not permit all ports or bypass the library's private-IP validation.

A separate nested `traefik:v3.6` container runs on CLIENT's namespace-local DinD
(`--host tcp://127.0.0.1:2375`), on the ordinary `traefik-network` bridge, never host
networking. Its fixed fixture-only name is exclusive within that disposable daemon.
The runner seeds the version-tagged image into **only** this daemon with bounded
save/copy/load/remove operations through its root filesystem, not DinD's private
`/tmp`, and never shares a host socket. The helper inspects only the bridge driver,
gateway, and selected container IP. Both addresses must be RFC1918; the actual
`startSecureRemoteRelay` also verifies local ownership of the gateway. Its only allowed
peer is that exact Traefik IP; its only upstream is the returned owned Unix stream.
The private Traefik-to-relay hop uses TLS pinned to this listener's public certificate
and SAN server name, with verification enabled for both HTTP and TCP transports.
Endpoint and trust are published in the same YAML; certificate rotation changes
transport names to separate connection pools. No private key is serialized.
A direct CLIENT connection to the relay must be rejected.

The nested container initially waits for a fixed start file. The helper copies
explicit YAML file-provider routes into it (no cross-filesystem bind mount), then
starts Traefik on web 80 and logical 3000, published only on CLIENT loopback.
Python `HTTPConnection` uses real hostname DNS and its default Host header to test:

- `http://ui.feature.port/`
- `http://feature.port:3000/`
- `http://ui.feature.remote-a.ssh/`
- `http://feature.remote-a.ssh:3000/`

Every URL must return exactly `remote-a-snapshot-fixture`, through real Traefik,
real peer-filtered TLS-pinned relay, and the real Unix-socket SSH forward. Exact Host routes preserve the
Host header (`passHostHeader: true`). Client dnsmasq defaults `.port` and `.ssh` to
loopback; specific phase-0 DB answers and baseline `addn-hosts` overrides remain.
The outer baseline Traefik lives in a separate port namespace and is unchanged.

After those good routes pass, a fixture-only `POST /cgi-bin/sentinel` with the
known sentinel body increments an owned BusyBox counter exactly once. The static
index body is unchanged. `verify-count` reads that counter by the saved owned
container ID inside the **original remote SSH login**, never through broken Traefik.

The bounded helper protocol then simulates a crashed backend listener: `plaintext`
closes only the original secure relay (not its SSH stream/master or Traefik), binds
a plaintext collector to the **exact same gateway address and port**, and acknowledges
that tuple. Python retries sentinel POSTs on both default and qualified public HTTP
and HTTPS root routes; each must fail or return non-2xx. `plaintext-stats` closes all
collector sockets and reports counters. `wrong-tls` binds the same tuple again with
a fresh `createRemoteRelayIdentity` certificate; the same requests and checks repeat,
followed by `wrong-tls-stats`. Each phase requires accepted connections > 0, application
payload hits = 0, sentinel hits = 0, and the original workload counter still exactly 1.
Plaintext capture inspects at most 4096 bytes of the first chunk (TLS ClientHello is
allowed), prints no bytes, and destroys the socket immediately. Wrong-TLS capture
counts decrypted application data, not handshake bytes. Backend verification is
never disabled. Actual Traefik and its original rendered YAML remain unchanged and
alive throughout both phases. This is **component crash-simulation listener replacement**,
not automatic coordinator recovery or full cross-owner acceptance.

Setup is bounded to 45 seconds and HTTP readiness to 10 seconds. Each protocol wait
and collector lifetime is bounded to 30 seconds, each negative phase to 20 seconds,
and the whole helper to 110 seconds before bounded cleanup. Raw and TLS collector
sockets are destroyed before listener closure; connections have 1.5-second timeouts.
The final stdin `close` removes only the owned nested proxy container, closes relay
before the forward, and removes only its own temporary YAML directory. Finally blocks
reap the helper; the original interactive SSH login must still work afterward.
The fixture now uses the production route planner and YAML renderer. HTTPS probes
on port 3000 also verify the compiled TLS/SNI routes for default and qualified
hostnames. Certificate verification is disabled for this disposable self-signed
public fixture; public certificate trust is not proven. Private-hop certificate pinning
remains enabled. This is the **full positive component path**, not an automatic coordinator
or full `port up`. PostgreSQL through the combined path, conflict behavior, and
automatic coordination remain pending.

### Live-discovery collector gate (explicit fixture seed)

Within the first foreground plain `ssh remote-a` session, the client waits for a
fresh `ready` empty snapshot cache, then types the fixed `snapshot-workload.js`
helper commands into the actual interactive shell. It never invokes observer or
snapshot commands to force observation: the product companion must discover the
changes automatically over its owned multiplexed connection.

The Bun-built helper uses actual `generateOverrideContent` and YAML parsing to
label ONE BusyBox 1.37.0 HTTP container (published/logical 3000, target 8080), with
matching Compose project/service labels and a disposable Port registry entry.
Three isolated DinD daemons model VM-local Docker networking: the client shares
`docker`'s network namespace, and each remote shares its own `docker-a` or
`docker-b` namespace. Filesystems and home identities remain separate. Each
namespace has its own Docker bridge and loopback-published services. Compose DNS
aliases `client`, `remote-a`, and `remote-b` belong to the corresponding DinD
services on the isolated fixture network, preserving the outer Traefik baseline.
All clients use `DOCKER_HOST=tcp://127.0.0.1:2375` by default; the seed helper forces
that fixed daemon regardless of caller settings. No workload ports or host socket
are exposed. This models VM-local networking, **not VM security isolation or
product `port up` routing**.

The client retries atomic-cache reads and decoding races within bounded waits,
requiring fresh `observedAt` and explicit status, not merely file existence. It
checks `feature.port`, the inspected private Docker IP:8080, logical port 3000,
HTTP + TLS-SNI transports, and the HTTP-only `ui` alias. After discovery, the
ordinary remote interactive SSH shell runs the helper's `probe` mode: Bun fetches
the owned container's private IP:8080 directly, with a bounded timeout, and emits
an address marker only after matching its fixed static HTTP body. The client
requires that marker's address to equal the discovered endpoint. This proves
remote SSH namespace reachability, not forwarding or product routing.
Strict field checks reject
paths/environment metadata. Corrupting only the disposable remote registry must
produce `unavailable` with the last-known endpoint; restoring its private fixture
backup must produce a later `ready` revision. Stopping only the known fixture
container must produce a healthy empty snapshot. Instance identity stays stable;
successful revisions increase within this one foreground session (no assertion
across new SSH sessions). Foreground exit removes the entire local session tree
and observer. The helper supports only `start`, `probe`, `verify-count`, `corrupt`, `restore`, and `stop`,
with fixed paths under `/home/fixture/.port`; no user registry is imported.
The bootstrap step has a 210-second outer deadline. See `bootstrap.log`.

The product test checks an actual private handshake file, exit status 7, and
session cleanup on remote-a. After transport feasibility, multiplexing, and the Traefik baseline pass, `run.sh`
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
**Accepted limitation:** OpenSSH multiplexing disables the local `~Ctrl-Z`
suspension escape. Use `command ssh` to bypass integration when needed. Jacob
accepted this narrow limitation; revisit it if users need suspension. It does not
relax Ctrl-C, terminal restoration, or exit-status requirements.
Password authentication and broader disconnect cases remain release gates before
treating the experimental hook as production-ready.

## What is actually exercised

- One disposable Debian client with OpenSSH client, Python stdlib PTYs,
  dnsmasq, `psql`, and the Docker CLI.
- Two separate PostgreSQL 17 clusters (`remote_a`, `remote_b`), each alongside
  a real OpenSSH server. Test-only PostgreSQL `listen_addresses='*'` and HTTP
  `0.0.0.0:3000` listeners let Traefik reach them on the isolated fixture network.
  Neither remote publishes host ports; trust authentication is fixture-only.
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
- Three dedicated `docker:27.5.1-dind` fixtures have separate owned storage volumes.
  The client daemon runs a real `busybox:1.37.0` smoke container and checks its
  output. The runner pulls/saves this small image and loads it into all three
  daemons via their root filesystems (not DinD's private `/tmp` mount), because
  the fixture network has no registry egress.
  The smoke container itself runs with `--network=none` and `--pull=never`.

## Existing Traefik HTTP Host / TLS HostSNI baseline

`baseline.py` exercises real **Traefik v3.6.0**, not an ingress-library stand-in.
The allowlisted `Dockerfile.traefik`, `traefik.yaml`, and `traefik-dynamic.yaml`
provide static entrypoints and explicit fixture routes. No Docker socket or host
ports are exposed by this service. These hand-written routes preserve the existing
`compose.ts` / `generateTraefikTcpLabels` baseline (`tls=true`, represented by
`tls: {}` in file configuration); they do not test automatic remote product wiring.

The client resolves the Traefik service IP, writes `/tmp/baseline-hosts`, and HUPs
its known dnsmasq PID. It asserts that **all four feature names resolve to the
same proxy address**, through actual DNS, never `hostaddr`, hosts-file client
shortcuts, runner DNS changes, or IP-per-hostname routing:

- `ui.feature-a.port:80` and `feature-a.port:3000` use HTTP Host routing to
  `remote-a:3000`; the corresponding b names reach `remote-b:3000`.
- `feature-a.port:5432` and `feature-b.port:5432` use TLS HostSNI on the **same IP
  and same port 5432**, terminating TLS before their respective PostgreSQL backends.
- Real `psql` / libpq uses `sslmode=require sslsni=1` (supported by the Debian 12
  libpq 15 fixture). SQL verifies database names, backend addresses/ports, and
  distinct cluster system identifiers. `\\conninfo` must report client TLS;
  backend `pg_stat_ssl=false` is expected because Traefik terminates TLS.
- Missing SNI, unmatched SNI (also resolved to that same IP), and
  `sslmode=disable` must not successfully run SQL. Each attempt is bounded;
  a protocol-detection timeout is an acceptable fail-closed result. Positive TLS
  probes run again afterward. No catch-all TCP router can choose an arbitrary DB.

The fixture uses Traefik's generated self-signed certificate with an empty client
trust directory. `sslmode=require` tests encryption, **not verify-full identity
validation**; this is acceptable only for this disposable fixture. TLS negotiation
failure fails the gate, never skips or substitutes a fake backend.

The separate phase-0 explicit raw `ssh -L` proof above is **transport feasibility
only**. Its distinct loopback IPs do not prove SNI or shipped plaintext routing.
Separate loopback-IP allocation, a privileged broker, and protocol-independent raw
plaintext TCP are deferred to [#149](https://github.com/jdtzmn/port/issues/149).
They are not requirements of this feature. Automatic discovery is checked separately
by the fixture-seeded bootstrap gate above; transport coordination and product
`port up` routing remain unfinished and are not claimed by this baseline gate.

The `baseline` step runs before remote-b's CLI is renamed, with a 90-second outer
deadline and bounded DNS, HTTP, and libpq operations. See `baseline.log`.

## Isolation and cleanup

Every run uses a random Compose project with its own `internal: true` network,
public-key volume, and three independent DinD storage volumes. There are no runner-published ports, fixed outer container
names, external networks, or host Docker socket mounts. The nested HTTP component
uses a fixed name only inside CLIENT's owned daemon and publishes only CLIENT
loopback ports 80 and 3000. Only the client rewrites
its own `/etc/resolv.conf`; the runner's DNS and hosts files are untouched.
Compose is explicitly passed `/dev/null` as its env file and implicit env-file
loading is disabled; no `.env` files are read.

**Privileged fixture warning:** only the three DinD services are privileged.
Each unauthenticated TCP API binds `127.0.0.1:2375` in its shared namespace, not
its fixture-network address or the runner. Each client/remote depends only on its
own daemon's health; public-key readiness remains concurrent, without a health
dependency cycle. Client dnsmasq still binds only its own loopback. This is disposable test infrastructure, not a secure production daemon
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
