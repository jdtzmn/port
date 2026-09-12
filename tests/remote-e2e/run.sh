#!/usr/bin/env bash
# Deliberately standalone: no Port bootstrap, npm dependencies or runner DNS edits.
set -euo pipefail
umask 077
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
command -v python3 >/dev/null
command -v docker >/dev/null
project="remote-e2e-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:16])')"
artifacts="$root/.remote-e2e-artifacts/$project"
mkdir -p "$artifacts"
# Disable implicit .env loading, including while validating the Compose model.
export COMPOSE_DISABLE_ENV_FILE=1
compose=(docker compose --env-file /dev/null --project-directory "$here" -p "$project" -f "$here/compose.yaml")
image_dir=''
step() {
  local seconds=$1 label=$2
  shift 2
  printf 'remote-e2e: %s\n' "$label"
  python3 "$here/bounded.py" "$seconds" "$artifacts/$label.log" "$@"
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  # Only bounded known-service logs and status, never inspect/env/key dumps.
  step 15 status "${compose[@]}" ps -a
  step 15 fixture-logs "${compose[@]}" logs --no-color --tail 80 remote-a remote-b client docker docker-a docker-b traefik
  step 60 cleanup "${compose[@]}" down --volumes --remove-orphans --timeout 5
  local cleanup_status=$?
  [[ -z "$image_dir" ]] || rm -rf -- "$image_dir"
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    status=$cleanup_status
  fi
  printf 'remote-e2e: exit=%s; artifacts=%s\n' "$status" "$artifacts"
  if [[ $cleanup_status -ne 0 ]]; then
    printf 'Cleanup failed; retry Compose down for project %s with %s\n' "$project" "$here/compose.yaml" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
step 15 config "${compose[@]}" config --quiet
step 600 build "${compose[@]}" build
# The private DinD network has no registry egress. Seed all three local daemons
# via the runner's Docker CLI; never mount a host Docker socket in any fixture.
step 120 smoke-pull docker pull busybox:1.37.0
step 120 proxy-pull docker pull traefik:v3.6
step 180 postgres-pull docker pull postgres:17.4-bookworm
step 180 bun-pull docker pull oven/bun:1.3.3
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$root/package.json")
handler_image="ghcr.io/jdtzmn/port-404-handler:$version"
step 300 handler-build docker build --pull=false -t "$handler_image" "$root/packages/404-app"
image_dir=$(mktemp -d "${TMPDIR:-/tmp}/remote-e2e-image.XXXXXXXX")
# Build the actual checkout into a fresh, artifact-only directory; no source or secrets enter fixtures.
mkdir -p "$image_dir/app"
step 120 port-build bun build "$root/src/index.ts" --outdir "$image_dir/app/dist" --target bun --splitting
step 120 snapshot-fixture-build bun build "$here/snapshot-workload.ts" --outdir "$image_dir/app/fixtures" --target bun
step 120 forward-probe-build bun build "$here/forward-probe.ts" --outdir "$image_dir/app/fixtures" --target bun
step 120 proxy-probe-build bun build "$here/proxy-probe.ts" --outdir "$image_dir/app/fixtures" --target bun
cp "$root/package.json" "$image_dir/app/package.json"
chmod -R a+rX "$image_dir/app"
step 60 smoke-save docker image save --output "$image_dir/smoke.tar" busybox:1.37.0
step 60 postgres-save docker image save --output "$image_dir/postgres.tar" postgres:17.4-bookworm
step 60 bun-save docker image save --output "$image_dir/bun.tar" oven/bun:1.3.3
step 60 proxy-save docker image save --output "$image_dir/proxy.tar" traefik:v3.6
step 60 handler-save docker image save --output "$image_dir/handler.tar" "$handler_image"
step 210 readiness "${compose[@]}" up -d --wait --wait-timeout 150
for machine in client remote-a remote-b; do
  step 30 "port-copy-$machine" "${compose[@]}" cp "$image_dir/app/." "$machine:/opt/port/"
done
# DinD creates a private /tmp mount; use the root filesystem for docker cp.
for daemon in docker docker-a docker-b; do
  step 30 "smoke-copy-$daemon" "${compose[@]}" cp "$image_dir/smoke.tar" "$daemon:/smoke.tar"
  step 60 "smoke-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /smoke.tar
  step 10 "smoke-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /smoke.tar
done
for daemon in docker-a docker-b; do
  step 30 "postgres-copy-$daemon" "${compose[@]}" cp "$image_dir/postgres.tar" "$daemon:/postgres.tar"
  step 60 "postgres-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /postgres.tar
  step 10 "postgres-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /postgres.tar
done

for daemon in docker-a docker-b; do
  step 30 "bun-copy-$daemon" "${compose[@]}" cp "$image_dir/bun.tar" "$daemon:/bun.tar"
  step 60 "bun-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /bun.tar
  step 10 "bun-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /bun.tar
done

# Production Port starts Traefik and the 404 handler in every participating daemon.
for daemon in docker docker-a docker-b; do
  step 30 "proxy-copy-$daemon" "${compose[@]}" cp "$image_dir/proxy.tar" "$daemon:/proxy.tar"
  step 60 "proxy-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /proxy.tar
  step 10 "proxy-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /proxy.tar
  step 30 "handler-copy-$daemon" "${compose[@]}" cp "$image_dir/handler.tar" "$daemon:/handler.tar"
  step 60 "handler-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /handler.tar
  step 10 "handler-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /handler.tar
done
step 150 proof "${compose[@]}" exec -T client python3 /fixture/harness.py
step 90 multiplexing "${compose[@]}" exec -T client python3 /fixture/mux.py
step 90 baseline "${compose[@]}" exec -T client python3 /fixture/baseline.py
step 600 bootstrap "${compose[@]}" exec -T client python3 /fixture/bootstrap.py

# Preserve ordinary login fallback after both Port-enabled remote product scenarios.
step 10 missing-port "${compose[@]}" exec -T remote-b mv /usr/local/bin/port /usr/local/bin/port-unavailable
step 90 missing-port-bootstrap "${compose[@]}" exec -T client python3 /fixture/bootstrap.py --missing-port-only
printf 'remote-e2e: transport, SSH compatibility, failure-path components, and automatic port up HTTP/TLS-SNI routing passed\n'
