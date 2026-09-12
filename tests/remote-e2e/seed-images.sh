#!/usr/bin/env bash
set -euo pipefail

project=$1
fixture_root=$2
daemon=$3
shift 3

export COMPOSE_DISABLE_ENV_FILE=1
docker image save "$@" |
  docker compose --env-file /dev/null --project-directory "$fixture_root" \
    -p "$project" -f "$fixture_root/compose.yaml" \
    exec -T "$daemon" docker image load
