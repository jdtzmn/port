#!/usr/bin/env python3
"""Real Traefik shared-address HTTP Host / PostgreSQL TLS HostSNI baseline."""
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time

HOSTS = ["feature-a.port", "ui.feature-a.port", "feature-b.port", "ui.feature-b.port"]
UNKNOWN = "unmatched.port"


def addresses(host):
    return {item[4][0] for item in socket.getaddrinfo(host, 5432, type=socket.SOCK_STREAM)}


def configure_dns():
    proxy = addresses("traefik")
    assert len(proxy) == 1, proxy
    address = next(iter(proxy))
    # Only the client fixture's dnsmasq hosts file changes, never /etc/hosts,
    # runner DNS, or a libpq hostaddr override. Unknown SNI uses the same IP too.
    Path("/tmp/baseline-hosts").write_text(f"{address} {' '.join(HOSTS + [UNKNOWN])}\n")
    os.kill(int(Path("/tmp/dnsmasq.pid").read_text().strip()), signal.SIGHUP)
    end = time.monotonic() + 10
    while True:
        try:
            assert all(addresses(host) == proxy for host in HOSTS + [UNKNOWN])
            break
        except (OSError, AssertionError):
            if time.monotonic() >= end:
                raise
            time.sleep(0.1)
    print("PASS real DNS: all baseline names share one Traefik address", flush=True)


def http_identity(host, port, owner):
    connection = HTTPConnection(host, port, timeout=3)
    try:
        # HTTPConnection generates the Host header from the actual DNS hostname.
        connection.request("GET", "/")
        response = connection.getresponse()
        body = response.read(16385)
        assert len(body) <= 16384, "oversized HTTP response"
        identity = json.loads(body)
        assert response.status == 200 and identity["owner"] == owner, identity
        assert identity["service"] == "ui", identity
    finally:
        connection.close()
    print(f"PASS HTTP Host: {host}:{port} -> {owner}", flush=True)


def psql(host, database="postgres", sslmode="require", sni=1, query="SELECT 1"):
    # Debian 12 libpq 15 supports sslsni; an unsupported option fails this gate,
    # never silently disables the test. No PG* environment or hostaddr shortcuts.
    return subprocess.run(
        ["psql", "-X", "-w", "-A", "-t", "-F", "|",
         f"host={host} port=5432 user=postgres dbname={database} "
         f"connect_timeout=3 sslmode={sslmode} sslsni={sni}",
         "-v", "ON_ERROR_STOP=1", "-c", "\\conninfo", "-c", query],
        env={"PATH": os.environ["PATH"], "HOME": "/tmp/baseline-empty-trust", "LC_ALL": "C"},
        text=True, capture_output=True, timeout=7,
    )


def database_identity(host, database, remote):
    result = psql(host, database, query=(
        "SELECT current_database(), inet_server_addr(), inet_server_port(), "
        "system_identifier, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) "
        "FROM pg_control_system()"))
    assert result.returncode == 0, result.stderr[-2048:]
    # Backend pg_stat_ssl=false is expected: Traefik terminates client TLS.
    # conninfo reports the client/libpq TLS connection, not the backend leg.
    assert "SSL connection (protocol: TLS" in result.stdout, result.stdout[-2048:]
    fields = result.stdout.strip().splitlines()[-1].split("|")
    assert len(fields) == 5, fields
    assert fields[0] == database and fields[1] in addresses(remote), fields
    assert fields[2] == "5432" and fields[3].isdigit() and fields[4] == "f", fields
    print(f"PASS TLS HostSNI + libpq TLS: {host}:5432 -> {remote}/{database}", flush=True)
    return fields[3]


def reject(label, **kwargs):
    try:
        result = psql(**kwargs)
    except subprocess.TimeoutExpired:
        # A non-TLS connection can wait for protocol detection. Its bounded
        # inability to run SQL is the baseline limitation, not product support.
        print(f"PASS fail closed (bounded timeout): {label}", flush=True)
        return
    assert result.returncode != 0, f"unexpected successful routing: {label}"
    assert "invalid connection option" not in result.stderr, result.stderr[-2048:]
    print(f"PASS fail closed: {label}", flush=True)


def main():
    trust = Path("/tmp/baseline-empty-trust")
    trust.mkdir(mode=0o700, exist_ok=False)
    try:
        configure_dns()
        identifiers = []
        for suffix in ("a", "b"):
            host, remote = f"feature-{suffix}.port", f"remote-{suffix}"
            http_identity(host, 3000, remote)
            http_identity(f"ui.{host}", 80, remote)
            identifiers.append(database_identity(host, f"remote_{suffix}", remote))
        assert len(set(identifiers)) == 2, "expected distinct real PostgreSQL clusters"
        # Use a DB present on BOTH remotes: a wrong default route must succeed
        # and fail this assertion, not hide behind a nonexistent DB name.
        reject("unmatched SNI", host=UNKNOWN)
        for suffix in ("a", "b"):
            host = f"feature-{suffix}.port"
            reject(f"missing SNI ({host})", host=host, sni=0)
            reject(f"plaintext ({host})", host=host, sslmode="disable")
        # Prove negative probes did not merely observe a dead proxy/backend.
        for suffix in ("a", "b"):
            database_identity(f"feature-{suffix}.port", f"remote_{suffix}", f"remote-{suffix}")
        print("PASS Traefik baseline (automatic remote routing not claimed)", flush=True)
    finally:
        trust.rmdir()


if __name__ == "__main__":
    main()
