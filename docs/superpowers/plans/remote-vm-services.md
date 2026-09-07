# Remote VM services: design and implementation plan

Status: agreed product direction; engineering mechanisms require the gates below.
Scope of this change: documentation only. This document does not claim the feature or tests exist.

## 1. Product contract

After one-time local Port integration setup, the user runs ordinary SSH:

```sh
ssh 127.od
cd project
port up
```

Service `ui` in worktree `my-feature` is accessible from the local computer through the same two URL forms as local execution:

```text
http://ui.my-feature.port
http://my-feature.port:3000
```

Execution location is a routing detail, not a required part of the default URL.
Files, containers, databases, and processes stay on their originating machine.
Remote Port must be installed already; no automatic installation is implied.

Required behavior:

- Ordinary `ssh`, not a shipped `port ssh` command.
- No per-VM registration step or required persistent VM inventory.
- No special remote output or laptop-accessibility acknowledgment protocol.
- No browser chooser, remembered preferred destination, or silent fallback.
- No user-visible allocated tunnel ports. Original service ports remain unchanged.
- No public application ingress, hosted relay, or SSH agent-forwarding requirement.
- Existing local service-name URLs are preserved, not introduced as a new feature.
- Remote services continue to start normally without a connected laptop.

Automated acceptance targets Linux and GitHub Actions. Jacob will test macOS manually; macOS CI infrastructure is not required.

## 2. Scope and non-goals

The release scope includes HTTP, WebSockets, and raw TCP, with PostgreSQL as a mandatory real-client acceptance case. Raw TCP is not deferred: it drives the addressing design.

Non-goals: file synchronization, remote filesystems, public sharing, persistent connectivity after the last integrated SSH session closes, arbitrary remote administration, and tab-specific destination selection.

HTTPS support must be explicitly designed and tested before being claimed. Do not assume HTTP Host routing solves TLS certificate trust, SNI routing, or application protocols with optional TLS. UDP is outside initial scope.

## 3. Addressing and ambiguity

### Default and explicit addresses

| Destination | Service address | Port-based address |
| --- | --- | --- |
| Automatic, when unique | `ui.my-feature.port` | `my-feature.port:3000` |
| Explicit local | `ui.my-feature.local.port` | `my-feature.local.port:3000` |
| Explicit remote `127.od` | `ui.my-feature.127.od.ssh` | `my-feature.127.od.ssh:3000` |
| Explicit remote `devbox` | `ui.my-feature.devbox.ssh` | `my-feature.devbox.ssh:3000` |

Explicit aliases always exist for known destinations; only ambiguity makes their use necessary. Scripts may use them from the beginning. PostgreSQL retains port 5432, e.g. `my-feature.127.od.ssh:5432`.

The SSH destination supplies a friendly label. It is not an authentication identity. Define collision-safe handling for aliases that reach the same VM, the same alias resolving to different VMs, custom users/ports, IP literals, DNS-invalid characters, and length limits. Never silently merge different identities because labels sanitize to the same value. Preserve `127.od` naturally in the example above.

Reserve the explicit-local pattern and validate interactions with existing branch/service naming and configured domain suffixes. Default-domain examples are normative UX examples; custom-domain behavior needs a documented decision. Verify `.ssh` namespace implications before release; it is not assumed to be a reserved private DNS suffix.

### Routing rules

- One live eligible owner of an unqualified namespace: route normally.
- More than one owner: fail on ambiguity, including local/remote and remote/remote conflicts.
- Explicit address: route only to that owner; unavailable means unavailable, never fallback.
- Group a worktree's service aliases and logical-port routes under consistent ownership. Do not implicitly combine a UI from one owner with an API from another because their advertised service sets differ.
- Repeated sessions to the same proven remote/worktree identity do not create a conflict.
- Repository/worktree identity must be stronger than a sanitized branch name; unrelated repositories with the same exposed name can conflict too.

HTTP ambiguity returns `409 Conflict` with a readable response and structured alternatives: destination labels and explicit addresses. Do not forward or replay the request, including POST bodies. No selection UI or mutation occurs.

Raw TCP cannot return a universal HTTP-style error. Reject an ambiguous connection before backend contact. Show alternatives through local `port urls` / `port status`; determine the exact local CLI discovery scope during implementation so remote-only worktrees are inspectable without a local checkout. Do not emit HTTP or fabricated PostgreSQL messages into arbitrary protocols.

Existing established connections remain attached to their original backend or are closed; never splice them to a new destination. New connections/HTTP requests observe current conflict state. When an owner disappears and the namespace becomes unique, new unqualified traffic may resolve to the remaining owner under this rule. Explicit addresses are required when callers need destination stability through topology changes. Document this consequence; it is not an implicit fallback for an explicit address.

## 4. Architecture

```text
Remote port up -> remote registry -> discovery over SSH -> local Port bridge
                                                            |
Browser / psql -> local DNS -> local ingress / route resolver |
                                  |                         |
                                  +-> local backend         |
                                  +-> SSH transport -> remote backend/proxy
```

Remote Port owns execution and authoritative service state. Local Port owns DNS, private ingress, conflict resolution, and SSH transport lifecycle. Treat local and remote services as candidate owners in the same routing model.

HTTP should reuse remote Traefik routing where practical, preserving the original Host identity. Explicit remote aliases may require remote proxy aliases or carefully defined upstream Host translation. Validate redirects, cookies, origin checks, forwarded-header trust, and HMR; do not apply blanket response rewriting as a substitute for a canonical-origin design. Applications with fixed allowed origins may require configuration, which must be documented.

Raw TCP may require a dedicated remote forwarding adapter instead of remote HTTP Traefik entrypoints. Confirm current TCP capabilities before selecting that path. Discovery must advertise only supported, constrained backend capabilities; do not treat arbitrary remote metadata as a general forwarding instruction.

### Destination IP routing

Ordinary PostgreSQL does not reliably carry the original DNS hostname. Use private local destination addresses plus original ports rather than relying on HTTP Host or universal TLS SNI.

Allocate ingress addresses at the granularity needed to distinguish route namespaces/owners on the same logical port. A single IP per VM is insufficient if two worktrees on that VM both expose PostgreSQL on 5432. Service aliases can share an address only when the IP/port pair remains unambiguous.

An unqualified namespace needs a stable ingress whose resolver checks current candidate ownership, not a DNS answer that directly pins whichever destination was unique at resolution time. Explicit ingress addresses map to exactly one identity.

Required properties:

- Original externally visible ports; any ephemeral transport ports remain internal.
- No LAN-exposed listeners or accidental wildcard binds.
- Local Traefik containers can reach the intended private endpoints.
- Atomic route generation publication; bounded concurrent updates and allocation locks.
- Local-only traffic still works without an SSH bridge connection.
- Stale DNS cannot bypass conflict checks or target a new owner through IP reuse.
- Do not recycle a retired explicit address to a different owner merely after DNS TTL expiry; applications cache beyond TTL. Establish a durable allocation/tombstone policy and an explicit safe exhaustion/reset strategy.
- Define IPv4/IPv6 answers consistently; an unhandled AAAA path must not bypass routing policy.

## 5. Ordinary SSH bootstrap: first design gate

Evaluate SSH configuration hooks and integration via Port's existing shell hook. This is a feasibility investigation, not a promise that a generic SSH hook suffices.

The selected mechanism must:

1. Observe a supported interactive ordinary `ssh` invocation.
2. Establish or reuse an authenticated companion discovery/transport channel.
3. Execute a narrow remote Port discovery helper when available.
4. Associate resources with local session lifetime.
5. Preserve SSH argv semantics, aliases, identities, custom ports, ProxyJump, authentication prompts, host-key verification, terminal behavior, signals, and exit status.
6. Leave noninteractive SSH, scp, and sftp unchanged.
7. Fall back to ordinary SSH if discovery/integration is unavailable.

Decide connection multiplexing, ControlMaster ownership, repeated authentication behavior, and cleanup without killing user-owned SSH masters. Do not infer authorization from environment variables alone, hijack arbitrary existing sessions, or change global SSH configuration silently.

Missing remote Port must not break login. Missing local integration means ordinary SSH only, not magical discovery. Document one-time setup and the initial supported shell matrix. Experimental commands are test-only scaffolding with a removal gate; no shipped `port ssh` fallback.

## 6. Discovery contract

Use a narrow versioned structured protocol, not raw internal registry copying.

Minimum snapshot fields:

- Protocol version, remote instance identity, snapshot revision/generation.
- Stable repository/worktree identity and display labels.
- Route namespace and existing service aliases.
- Service identity, protocol, logical port, availability.
- Constrained remote ingress/backend routing descriptor.

Full snapshots are authoritative per remote owner. Start with polling; streaming requires evidence of latency/overhead benefit. Bound payload sizes, nesting, candidate count, timeouts, and retry work. Reject malformed/incompatible snapshots without leaving partial routes. Repeated snapshots are idempotent. Reconnect starts a new generation and cannot apply delayed updates from a previous connection.

Do not expose environment values, secrets, or unnecessary filesystem paths. Distinguish remote identity from user-controlled labels, SSH host authentication, and potentially cloned instance identifiers. Version incompatibility affects integration, not SSH login or service startup.

## 7. Lifecycle, performance, and security

### Lifecycle

- Scope initial access to active integrated SSH sessions.
- Reuse resources across sessions only after verifying compatible destination identity and connection policy.
- Closing one session leaves others working; last-session close removes associated access.
- Network loss marks owned routes unavailable and rejects new traffic safely.
- Reconnection reconciles a fresh snapshot before enabling routes.
- Service disappearance removes its routes without touching unrelated owners.
- Bridge restart/crash reconciles owned state and eliminates stale listeners/routes.
- Never stop remote processes as a consequence of tunnel cleanup.

### Performance

Share transport/proxy entrypoints where route identity is preserved; do not create one SSH session or polling process per service. Target a bounded number of control connections per remote and reconcile only changed routes. Pool forwarding resources where safe, but do not sacrifice raw TCP namespace isolation. Measure connection establishment, discovery-to-access latency, idle polling cost, and multi-worktree load before adding streaming or more complex caching. Record explicit budgets during the networking gate instead of inventing unmeasured targets.

### Security

Use OpenSSH authentication and host-key verification. No required agent forwarding, public relay, or inbound laptop connectivity. Local listeners and control sockets need appropriate user isolation. Validate advertised names, lengths, ports, protocols, and destinations. Remote data must not execute local hooks, choose arbitrary local network targets, write arbitrary files, or replace unrelated routes. Escape diagnostics and HTTP conflict output. Keep privileged address/DNS setup narrow and separate from the unprivileged discovery parser. Choose least privileges for production listeners; privileged test containers are not a production security design.

## 8. Linux E2E and GitHub Actions

### Harness topology

An isolated Compose network contains:

- A client machine container representing the laptop: actual Port shell integration, DNS, private ingress/proxy, local services, browser and database clients.
- Remote A and B: real OpenSSH servers, Port built from the current checkout, actual Git repositories/worktrees, HTTP/WebSocket/PostgreSQL fixtures.
- Optional jump host for extended SSH coverage.

Fixtures return destination/worktree identity. PostgreSQL stores identity in each database. All destinations reuse the same logical service ports. Do not fake isolation using different user-facing ports.

Keep the runner's DNS and SSH configuration unchanged. Use generated test SSH keys and provisioned known_hosts with strict host-key checking. Do not upload private keys or secrets. Network capabilities must be confined to explicitly trusted fixture containers, not arbitrary repository services with access to host credentials.

### First harness milestone

Before feature implementation, run a green GitHub Actions feasibility harness proving:

- PTY-driven plain SSH and real interactive shell behavior.
- Isolated DNS inside the client machine.
- Two local destination addresses listening on the same port.
- A real psql client reaches the intended database through transport.

This milestone may use explicit test wiring to prove infrastructure, but must not be presented as passing feature acceptance. Subsequent product tests must bootstrap through installed integration and ordinary SSH, never call bridge internals to bypass it.

### Product entrypoint

Install the intended integration in an isolated shell profile. Drive a real interactive shell via PTY, issue `ssh remote-a`, change into an actual worktree, run `port up`, and verify service access from the client. Preserve transcripts and exit status. Cover host services through supported Port commands and Docker services through actual Compose-backed `port up`.

### Required acceptance cases

| Case | Required evidence |
| --- | --- |
| One remote | Both default URL forms reach correct worktree |
| Two worktrees on one remote | Same HTTP and PostgreSQL ports independently reachable |
| Local versus remote collision | HTTP 409 lists alternatives; explicit aliases target each owner |
| Two remote collision | Same checks without local owner |
| Three-way collision | No priority-based implicit selection |
| Partial service sets | No cross-machine UI/API composition under unqualified namespace |
| PostgreSQL | psql uses 5432 for each explicit owner and reads correct identity |
| Ambiguous raw TCP | Reject before contacting any database backend |
| Explicit missing service/owner | Unavailable, never another backend |
| HTTP semantics | Host, redirects, cookies, origin behavior, POST non-forwarding |
| WebSockets | Upgrade, bidirectional HMR-style traffic, safe connection closure |
| Multiple SSH sessions | Shared resources survive one session closing |
| Last session/network loss | Owned access removed/disabled, remote services remain running |
| Reconnect/remote restart | Fresh snapshot replaces stale service state |
| Missing/incompatible Port | Ordinary SSH still works |
| Changed SSH host key | Verification rejects connection normally |
| Bridge restart | Owned route cleanup and reconciliation |

Assert backend counters/logs as well as client errors: a 409 alone does not prove a POST was not forwarded. Do not inject client DNS overrides or Playwright hostname mappings in primary tests; requests must traverse actual Port DNS.

Use Playwright/Chromium for page behavior, an HTTP client for status/headers/non-forwarding, a WebSocket client for upgrades, and psql for PostgreSQL. Non-GUI cases must pass independently of any browser process.

### Stale cache and identity tests

Resolve an unqualified name while unique, retain its address, introduce a conflict, then connect to the retained address with the original HTTP Host and separately with raw TCP. Both paths must enforce current conflict policy. Disconnect an explicit owner, add another owner, and prove retained explicit addresses never reach the new one. Repeat with a persistent HTTP connection; new requests must not bypass the conflict resolver. Existing database/WebSocket streams may stay pinned or close, never switch destinations.

### Docker-backed tier

Fast host-process fixtures do not prove Docker service reachability. Add a smaller mandatory smoke tier using isolated per-machine Docker daemons, not multiple simulated machines sharing the runner's Docker socket. Validate nested Docker/network feasibility early on GitHub Ubuntu runners. Privilege/runtime failures are blockers, not grounds for silently dropping the real Compose path.

### CI organization

Every PR: unit/protocol tests, Linux plain-SSH E2E with HTTP/PostgreSQL/conflicts/lifecycle, and a Docker-backed smoke test.

Scheduled/pre-release: expanded shells/SSH options, jump hosts, concurrency and repeated faults, larger Docker fixture coverage.

Build artifacts/images once per job; pin tool/image versions and dependencies, isolate Compose project names per run/shard, bound concurrency, use readiness probes and bounded condition polling rather than fixed sleeps, and clean up in unconditional finalizers. Do not hide flaky acceptance failures with retries. A required job must not silently skip when prerequisites fail.

Upload sanitized PTY transcripts, DNS answers, connection lifecycle events, route snapshots, and bounded fixture logs on failure. Exclude private keys, secret files, and credential-bearing database connection strings. Tests need no production credentials or cloud VMs.

Provide one documented local Linux command invoking the same harness as CI. Exact script names and workflow layout are implementation decisions.

### Manual macOS handoff

No automated macOS coverage required. Give Jacob a checklist covering DNS/private address installation, Docker reachability, plain SSH, both URL forms, PostgreSQL on original ports, collisions/explicit aliases, disconnect cleanup, and no LAN exposure. Do not claim Linux results prove macOS behavior.

## 9. Repository integration points

Candidate files to inspect before implementation (not claims that remote support exists):

- `src/commands/shell-hook.ts`, `src/lib/shell.ts`, `src/lib/shellProfile.ts`: setup/bootstrap.
- `src/commands/up.ts`, `src/lib/state.ts`, `src/lib/hostService.ts`: execution/discovery boundaries.
- `src/lib/hostname.ts`, `src/lib/dns.ts`, `src/lib/traefik.ts`: naming, ingress and reconciliation.
- `tests/shell-integration.test.ts`, `tests/hostname-labels.e2e.test.ts`: existing regression patterns.
- `.github/workflows/ci.yml`, `.github/workflows/linux-integration-tests.yml`: CI integration.

The existing Linux integration workflow installs DNS on the runner and runs sharded Vitest. The new remote harness must isolate its own DNS inside the client fixture; do not assume the current runner-level install proves the new isolated path. Preserve existing local-only tests.

## 10. Implementation phases and gates

Each phase is a small validated commit sequence. Add failing requirement tests, implement the minimum change, then demonstrate those tests pass. Do not label test-only wiring as feature completion.

0. **CI harness feasibility:** green plain SSH/DNS/same-port PostgreSQL infrastructure proof on GitHub Ubuntu; verify nested Docker smoke feasibility.
1. **Transparent bootstrap:** select and document mechanism, supported shells and SSH semantics; real PTY acceptance with normal fallback. No shipped alternate command.
2. **Private networking:** implement identity-aware local address/listener allocation and DNS with HTTP/TCP forwarding; prove two worktrees per remote retain identical ports and no LAN exposure.
3. **Discovery/reconciliation:** versioned snapshots, ownership and bounded updates; services appear/disappear automatically through ordinary SSH plus remote Port commands.
4. **Aliases/conflicts:** default/explicit addressing, 409 alternatives, raw TCP rejection, stale DNS and persistent HTTP checks.
5. **Lifecycle/security:** session references, reconnect/crash recovery, malformed metadata, origin/WebSocket behavior, isolation and performance measurements.
6. **Release documentation:** local setup, supported SSH scope, conflict diagnostics, custom-domain decision, raw TCP behavior, limitations and manual macOS checklist.

Release acceptance: matching worktrees run locally and on two remotes. Unqualified routes fail when ambiguous. Explicit local and `.ssh` addresses reach exactly their intended services on original ports. Removing destinations, retaining DNS answers, and reconnecting cannot cause explicit addresses or established streams to reach a different owner. All required Linux E2E tests pass on GitHub Actions.

## 11. Decisions still requiring evidence

- Plain-SSH hook/wrapper mechanism, supported shell matrix, multiplexing/authentication ownership.
- Private IP pool, namespace allocation granularity, privilege boundary, address persistence/exhaustion, IPv6 policy.
- Local Traefik coexistence with IP-specific raw TCP listeners and wildcard binds.
- Remote TCP ingress capability and constrained forwarding implementation.
- Canonical origin handling for explicit aliases, custom domains and TLS scope.
- Stable authenticated destination identity versus aliases, clones, users and ports.
- Exact local CLI interface for inspecting remote-only routes and conflict alternatives.
- `.ssh` namespace validation and reserved local alias compatibility.
- Nested Docker runner feasibility, dependency pinning, runtime budgets and resource caps.

These are explicit implementation gates. None authorizes weakening the agreed UX to dedicated user-facing ports, required registration, a chooser, or `port ssh`.
