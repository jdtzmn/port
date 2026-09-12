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
timings="$artifacts/timings.tsv"
printf 'phase\tduration_ms\tstatus\n' > "$timings"
run_started_ns=$(python3 -c 'import time; print(time.monotonic_ns())')
# Disable implicit .env loading, including while validating the Compose model.
export COMPOSE_DISABLE_ENV_FILE=1
compose=(docker compose --env-file /dev/null --project-directory "$here" -p "$project" -f "$here/compose.yaml")
image_dir=''
step() {
  local seconds=$1 label=$2 started_ns finished_ns duration_ms step_status
  shift 2
  printf 'remote-e2e: %s\n' "$label"
  started_ns=$(python3 -c 'import time; print(time.monotonic_ns())')
  if python3 "$here/scenarios/bounded.py" "$seconds" "$artifacts/$label.log" "$@"; then
    step_status=0
  else
    step_status=$?
  fi
  finished_ns=$(python3 -c 'import time; print(time.monotonic_ns())')
  duration_ms=$(( (finished_ns - started_ns) / 1000000 ))
  printf '%s\t%s\t%s\n' "$label" "$duration_ms" "$step_status" >> "$timings"
  printf 'remote-e2e: timing %s=%sms status=%s\n' "$label" "$duration_ms" "$step_status"
  return "$step_status"
}
wait_jobs() {
  local status=0 pid
  for pid in "$@"; do
    if ! wait "$pid"; then
      status=1
    fi
  done
  return "$status"
}
cleanup() {
  local status=$? cleanup_status finished_ns total_ms
  trap - EXIT INT TERM
  set +e
  # Only bounded known-service logs and status, never inspect/env/key dumps.
  step 15 status "${compose[@]}" ps -a
  step 15 fixture-logs "${compose[@]}" logs --no-color --tail 80 remote-a remote-b client docker docker-a docker-b traefik
  step 60 cleanup "${compose[@]}" down --volumes --remove-orphans --timeout 5
  cleanup_status=$?
  [[ -z "$image_dir" ]] || rm -rf -- "$image_dir"
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    status=$cleanup_status
  fi
  finished_ns=$(python3 -c 'import time; print(time.monotonic_ns())')
  total_ms=$(( (finished_ns - run_started_ns) / 1000000 ))
  printf 'total\t%s\t%s\n' "$total_ms" "$status" >> "$timings"
  printf 'remote-e2e: timing total=%sms status=%s\n' "$total_ms" "$status"
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
# Build independent host-side prerequisites concurrently. The fixture topology remains isolated.
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$root/package.json")
handler_image="ghcr.io/jdtzmn/port-404-handler:$version"
pids=()
step 600 build "${compose[@]}" build & pids+=("$!")
# The private DinD network has no registry egress. Seed all three local daemons
# via the runner's Docker CLI; never mount a host Docker socket in any fixture.
step 120 smoke-pull docker pull busybox:1.37.0 & pids+=("$!")
step 120 proxy-pull docker pull traefik:v3.6 & pids+=("$!")
step 180 postgres-pull docker pull postgres:17.4-bookworm & pids+=("$!")
step 180 bun-pull docker pull oven/bun:1.3.3 & pids+=("$!")
step 300 handler-build docker build --pull=false -t "$handler_image" "$root/packages/404-app" & pids+=("$!")
wait_jobs "${pids[@]}"

image_dir=$(mktemp -d "${TMPDIR:-/tmp}/remote-e2e-image.XXXXXXXX")
# Build the actual checkout into a fresh, artifact-only directory; no source or secrets enter fixtures.
mkdir -p "$image_dir/app"
step 120 port-build bun build "$root/src/index.ts" --outdir "$image_dir/app/dist" --target bun --splitting
step 120 snapshot-fixture-build bun build "$here/fixtures/snapshot-workload.ts" --outdir "$image_dir/app/fixtures" --target bun
step 120 forward-probe-build bun build "$here/fixtures/forward-probe.ts" --outdir "$image_dir/app/fixtures" --target bun
step 120 proxy-probe-build bun build "$here/fixtures/proxy-probe.ts" --outdir "$image_dir/app/fixtures" --target bun
cp "$root/package.json" "$image_dir/app/package.json"
chmod -R a+rX "$image_dir/app"

# Save once while the outer fixture becomes healthy. Each private daemon imports the same exact bundle.
pids=()
step 120 fixture-images-save docker image save --output "$image_dir/fixture-images.tar" \
  busybox:1.37.0 postgres:17.4-bookworm oven/bun:1.3.3 traefik:v3.6 "$handler_image" & pids+=("$!")
step 210 readiness "${compose[@]}" up -d --wait --wait-timeout 150 & pids+=("$!")
wait_jobs "${pids[@]}"

# Copy artifacts and seed independent DinD daemons concurrently.
pids=()
for machine in client remote-a remote-b; do
  step 30 "port-copy-$machine" "${compose[@]}" cp "$image_dir/app/." "$machine:/opt/port/" & pids+=("$!")
done
for daemon in docker docker-a docker-b; do
  (
    step 60 "fixture-images-copy-$daemon" "${compose[@]}" cp "$image_dir/fixture-images.tar" "$daemon:/fixture-images.tar"
    step 120 "fixture-images-load-$daemon" "${compose[@]}" exec -T "$daemon" docker image load --input /fixture-images.tar
    step 10 "fixture-images-remove-$daemon" "${compose[@]}" exec -T "$daemon" rm -f /fixture-images.tar
  ) & pids+=("$!")
done
wait_jobs "${pids[@]}"
step 150 proof "${compose[@]}" exec -T client python3 /fixture/harness.py
step 90 multiplexing "${compose[@]}" exec -T client python3 /fixture/mux.py
step 90 baseline "${compose[@]}" exec -T client python3 /fixture/baseline.py
step 600 bootstrap "${compose[@]}" exec -T client python3 /fixture/bootstrap.py

# Preserve ordinary login fallback after both Port-enabled remote product scenarios.
step 10 missing-port "${compose[@]}" exec -T remote-b mv /usr/local/bin/port /usr/local/bin/port-unavailable
step 90 missing-port-bootstrap "${compose[@]}" exec -T client python3 /fixture/bootstrap.py --missing-port-only
printf 'remote-e2e: transport, SSH compatibility, failure-path components, and automatic port up HTTP/TLS-SNI routing passed\n'
