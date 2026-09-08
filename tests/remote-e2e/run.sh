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
  step 15 fixture-logs "${compose[@]}" logs --no-color --tail 80 remote-a remote-b client docker
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
# The private DinD network has no registry egress. Seed one pinned smoke image
# via the runner's Docker CLI; never mount a host Docker socket in any fixture.
step 120 smoke-pull docker pull busybox:1.37.0
image_dir=$(mktemp -d "${TMPDIR:-/tmp}/remote-e2e-image.XXXXXXXX")
# Build the actual checkout into a fresh, artifact-only directory; no source or secrets enter fixtures.
mkdir -p "$image_dir/app"
step 120 port-build bun build "$root/src/index.ts" --outdir "$image_dir/app/dist" --target bun --splitting
cp "$root/package.json" "$image_dir/app/package.json"
chmod -R a+rX "$image_dir/app"
step 60 smoke-save docker image save --output "$image_dir/smoke.tar" busybox:1.37.0
step 210 readiness "${compose[@]}" up -d --wait --wait-timeout 150
for machine in client remote-a remote-b; do
  step 30 "port-copy-$machine" "${compose[@]}" cp "$image_dir/app/." "$machine:/opt/port/"
done
# DinD creates a private /tmp mount; use the root filesystem for docker cp.
step 30 smoke-copy "${compose[@]}" cp "$image_dir/smoke.tar" docker:/smoke.tar
step 60 smoke-load "${compose[@]}" exec -T docker docker image load --input /smoke.tar
step 10 smoke-remove "${compose[@]}" exec -T docker rm -f /smoke.tar
step 150 proof "${compose[@]}" exec -T client python3 /fixture/harness.py
step 90 multiplexing "${compose[@]}" exec -T client python3 /fixture/mux.py
# Remove only the disposable fixture's CLI, after gates that need both remotes.
step 10 missing-port "${compose[@]}" exec -T remote-b mv /usr/local/bin/port /usr/local/bin/port-unavailable
step 90 bootstrap "${compose[@]}" exec -T client python3 /fixture/bootstrap.py
printf 'remote-e2e: networking and product handshake gates passed (service routing not implemented)\n'
