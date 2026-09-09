#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 700 -o fixture -g fixture /home/fixture/.port
printf '%s\n' \
  'pid-file=/tmp/dnsmasq.pid' 'local=/port/' 'no-resolv' 'server=127.0.0.11' \
  'listen-address=127.0.0.1' 'bind-interfaces' 'address=/.port/127.0.0.1' \
  > /tmp/dnsmasq.conf
dnsmasq --test --conf-file=/tmp/dnsmasq.conf
dnsmasq --keep-in-foreground --conf-file=/tmp/dnsmasq.conf &
dns_pid=$!
printf 'nameserver 127.0.0.1\noptions timeout:1 attempts:2\n' > /etc/resolv.conf
ssh-keygen -q -t ed25519 -N '' -f /run/ssh-host-key
cp /run/ssh-host-key.pub "/public-keys/${FIXTURE_NAME}.pub.tmp"
mv "/public-keys/${FIXTURE_NAME}.pub.tmp" "/public-keys/${FIXTURE_NAME}.pub"
for ((i=0; i<120; i++)); do
  [[ -f /public-keys/client.pub ]] && break
  sleep 1
done
test -f /public-keys/client.pub
install -d -m 700 -o fixture -g fixture /home/fixture/.ssh
install -m 600 -o fixture -g fixture /public-keys/client.pub /home/fixture/.ssh/authorized_keys
/usr/sbin/sshd -t
/usr/sbin/sshd -D -e &
ssh_pid=$!
# Test-only trust DB: reachable by Traefik on the isolated network; no host ports.
/usr/local/bin/docker-entrypoint.sh postgres -c listen_addresses='*' &
pg_pid=$!
bun /fixture/identity.ts &
http_pid=$!
trap 'kill "$ssh_pid" "$pg_pid" "$http_pid" "$dns_pid" 2>/dev/null || true; wait || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
touch /tmp/ssh-ready
wait -n "$ssh_pid" "$pg_pid" "$http_pid" "$dns_pid"
exit 1
