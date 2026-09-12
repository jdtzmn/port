#!/bin/sh
# The runner copies only freshly built CLI artifacts into /opt/port.
# sshd does not inherit the container's DOCKER_HOST for exec channels.
export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"
exec /usr/local/bin/bun /opt/port/dist/index.js "$@"
