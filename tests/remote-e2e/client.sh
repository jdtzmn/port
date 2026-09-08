#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 700 /root/.ssh
ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/id_ed25519
cp /root/.ssh/id_ed25519.pub /public-keys/client.pub.tmp
mv /public-keys/client.pub.tmp /public-keys/client.pub
for ((i=0; i<120; i++)); do
  [[ -f /public-keys/remote-a.pub && -f /public-keys/remote-b.pub ]] && break
  sleep 1
done
# Trust is provisioned directly from ephemeral host public keys, never TOFU/keyscan.
for remote in remote-a remote-b; do
  test -s "/public-keys/$remote.pub"
  printf '%s ' "$remote" >> /root/.ssh/known_hosts
  cut -d ' ' -f 1,2 "/public-keys/$remote.pub" >> /root/.ssh/known_hosts
done
chmod 600 /root/.ssh/known_hosts
# Only this disposable client changes DNS. Docker's embedded resolver still
# resolves fixture service names; .ssh answers point to separate loopback IPs.
touch /tmp/baseline-hosts
chmod 644 /tmp/baseline-hosts
printf '%s\n' \
  'addn-hosts=/tmp/baseline-hosts' 'pid-file=/tmp/dnsmasq.pid' 'local=/port/' \
  'no-resolv' 'local=/ssh/' 'server=127.0.0.11' 'listen-address=127.0.0.1' 'bind-interfaces' \
  'address=/db-a.ssh/127.77.0.2' 'address=/db-b.ssh/127.77.0.3' \
  'address=/.port/127.0.0.1' 'address=/.ssh/127.0.0.1' \
  > /tmp/dnsmasq.conf
dnsmasq --test --conf-file=/tmp/dnsmasq.conf
dnsmasq --keep-in-foreground --conf-file=/tmp/dnsmasq.conf &
dns_pid=$!
trap 'kill "$dns_pid" 2>/dev/null || true; wait || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
printf 'nameserver 127.0.0.1\noptions timeout:1 attempts:2\n' > /etc/resolv.conf
# Readiness includes a real DNS answer rather than only process startup.
python3 - <<'PY'
import socket
import time
end = time.monotonic() + 20
while True:
    try:
        assert socket.gethostbyname('db-a.ssh') == '127.77.0.2'
        assert socket.gethostbyname('remote-a')
        break
    except (OSError, AssertionError):
        if time.monotonic() >= end:
            raise
        time.sleep(0.2)
PY
touch /tmp/client-ready
wait "$dns_pid"
exit 1
