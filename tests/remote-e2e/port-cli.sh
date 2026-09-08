#!/bin/sh
# The runner copies only freshly built CLI artifacts into /opt/port.
exec /usr/local/bin/bun /opt/port/dist/index.js "$@"
