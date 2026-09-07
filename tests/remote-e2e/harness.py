#!/usr/bin/env python3
"""Phase-0 infrastructure proof, deliberately not a Port integration test."""
import errno
import os
import pty
import select
import signal
import socket
import subprocess
import time
import uuid

SSH = ["ssh", "-F", "/fixture/ssh_config"]
TARGETS = [("remote-a", "db-a.ssh", "127.77.0.2", "remote_a"),
           ("remote-b", "db-b.ssh", "127.77.0.3", "remote_b")]


def run(argv, timeout=20):
    return subprocess.run(argv, text=True, capture_output=True, timeout=timeout)


class Shell:
    """A real ssh process with controlling PTY and no remote-command argument."""

    def __init__(self, remote, address):
        self.remote = remote
        self.output = b""
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp("ssh", SSH + ["-tt", "-L", f"{address}:5432:127.0.0.1:5432", remote])

    def command(self, command, timeout=15):
        marker = "FIXTURE_" + uuid.uuid4().hex
        # Echoed input contains quotes; only the separate, exact marker line
        # proves execution by the remote interactive shell with a remote TTY.
        os.write(self.fd, (command + " && printf '\\n%s\\n' '" + marker + "'\n").encode())
        end = time.monotonic() + timeout
        received = b""
        while time.monotonic() < end:
            ready, _, _ = select.select([self.fd], [], [], max(0, min(0.2, end - time.monotonic())))
            if not ready:
                continue
            try:
                chunk = os.read(self.fd, 4096)
            except OSError as exc:
                if exc.errno != errno.EIO:
                    raise
                chunk = b""
            if not chunk:
                raise RuntimeError(f"{self.remote}: SSH PTY closed before command succeeded")
            self.output = (self.output + chunk)[-16384:]
            received = (received + chunk)[-16384:]
            if marker.encode() in received.replace(b"\r", b"").split(b"\n"):
                return
        raise RuntimeError(f"{self.remote}: timed out waiting for remote shell marker")

    def close(self):
        try:
            os.write(self.fd, b"exit\n")
        except OSError:
            pass
        # Reap even failed sessions; never let a stalled SSH keep the test alive.
        for sig in (None, signal.SIGTERM, signal.SIGKILL):
            if sig is not None:
                try:
                    os.killpg(self.pid, sig)
                except ProcessLookupError:
                    pass
            end = time.monotonic() + 2
            while time.monotonic() < end:
                if os.waitpid(self.pid, os.WNOHANG)[0]:
                    os.close(self.fd)
                    return
                time.sleep(0.05)
        os.close(self.fd)
        raise RuntimeError(f"{self.remote}: could not reap SSH process")


def database(host, database_name):
    # No hostaddr override: libpq must resolve the .ssh hostname through DNS.
    return run(["psql", "-X", "-w", "-A", "-t", "-F", "|",
                f"host={host} port=5432 user=postgres dbname={database_name} connect_timeout=3",
                "-v", "ON_ERROR_STOP=1", "-c",
                "SELECT current_database(), inet_server_addr(), inet_server_port(), "
                "system_identifier FROM pg_control_system()"])


def main():
    sessions = []
    try:
        for remote, hostname, address, database_name in TARGETS:
            answers = {item[4][0] for item in socket.getaddrinfo(
                hostname, 5432, type=socket.SOCK_STREAM)}
            assert answers == {address}, (hostname, answers)
            # The DB must not be reachable before the explicit test tunnel.
            assert database(hostname, database_name).returncode != 0, "unexpected pre-tunnel DB"
            rejected = run(SSH + ["-o", "UserKnownHostsFile=/dev/null", "-T", remote, "true"])
            assert rejected.returncode != 0 and "Host key verification failed" in rejected.stderr, \
                "SSH must reject an unprovisioned host key"
            shell = Shell(remote, address)
            sessions.append(shell)
            shell.command("test -t 0 && test -t 1 && test \"$(id -un)\" = fixture")
            print(f"PASS interactive SSH PTY: {remote}", flush=True)

        identifiers = []
        for remote, hostname, address, database_name in TARGETS:
            result = database(hostname, database_name)
            assert result.returncode == 0, result.stderr[-2048:]
            fields = result.stdout.strip().split("|")
            assert len(fields) == 4 and fields[:3] == [database_name, "127.0.0.1", "5432"], fields
            assert fields[3].isdigit(), fields
            identifiers.append(fields[3])
            print(f"PASS DNS + psql: {hostname}:5432 -> {remote}/{database_name}", flush=True)
        assert len(set(identifiers)) == 2, "expected two different PostgreSQL clusters"
        # Both original PTY shells must still be live while both tunnels exist.
        for shell in sessions:
            shell.command("test -t 0")
        smoke = run(["docker", "run", "--rm", "--pull=never", "--network=none",
                     os.environ["SMOKE_IMAGE"], "sh", "-c", "printf 'DIND_SMOKE_OK\\n'"], timeout=45)
        assert smoke.returncode == 0, smoke.stderr[-2048:]
        assert smoke.stdout.strip() == "DIND_SMOKE_OK", smoke.stdout[-2048:]
        print("PASS private Docker-in-Docker: real isolated container execution", flush=True)
    finally:
        failed = False
        for shell in reversed(sessions):
            try:
                shell.close()
            except Exception as exc:
                failed = True
                print(f"SSH cleanup failed: {exc}", flush=True)
            # Bounded shell-only transcript; keys and environment are never dumped.
            print(f"--- {shell.remote} PTY (last 16 KiB) ---", flush=True)
            print(shell.output.decode(errors="replace"), flush=True)
        if failed:
            raise RuntimeError("SSH cleanup failed")


if __name__ == "__main__":
    main()
