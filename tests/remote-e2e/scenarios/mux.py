#!/usr/bin/env python3
"""Real OpenSSH multiplexing feasibility probe; not a Port integration test."""
import errno
import os
import pty
import select
import signal
import subprocess
import tempfile
import time
import uuid


LIMIT = 8192


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def mux_args(path):
    # Intentionally no fixture config, identity, hostname, or original login args.
    # ProxyCommand=false makes a missing/broken mux fail instead of reconnecting.
    return ["ssh", "-F", "/dev/null", "-S", path,
            "-o", "ControlMaster=no", "-o", "BatchMode=yes",
            "-o", "ProxyCommand=false", "-T", "-n"]


def control(path, operation):
    result = subprocess.run(mux_args(path) + ["-O", operation, "dummy"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=2)
    return result.returncode, result.stdout[-LIMIT:]


class Primary:
    """Foreground interactive login with an actual controlling terminal."""

    def __init__(self, path):
        self.output = b""
        self.status = None
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.execvp("ssh", ["ssh", "-F", "/fixture/ssh_config", "-tt",
                                  "-o", "ControlMaster=yes",
                                  "-o", "ControlPersist=5",
                                  "-o", "ControlPath=" + path, "remote-a"])
            finally:
                os._exit(127)

    def drain(self, timeout=0.05):
        if not select.select([self.fd], [], [], timeout)[0]:
            return
        try:
            chunk = os.read(self.fd, 4096)
        except OSError as exc:
            if exc.errno != errno.EIO:
                raise
            chunk = b""
        self.output = (self.output + chunk)[-LIMIT:]
        if not chunk:
            time.sleep(min(timeout, 0.05))

    def poll(self):
        if self.status is None:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.status = os.waitstatus_to_exitcode(status)
        return self.status

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        while self.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("primary SSH did not exit before deadline")
            self.drain(min(0.05, remaining))
        return self.status

    def ready(self):
        marker = "PRIMARY_" + uuid.uuid4().hex
        # A leading newline prevents a prompt from prefixing the sentinel.
        # Exact line matching excludes the echoed command containing quotes.
        command = "test -t 0 && printf '\\n%s\\n' '" + marker + "'\n"
        os.write(self.fd, command.encode())
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.drain()
            if marker.encode() in self.output.replace(b"\r", b"").split(b"\n"):
                return
            require(self.poll() is None, "primary exited before shell readiness")
        raise TimeoutError("primary shell readiness timed out")

    def close(self):
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if self.poll() is not None:
                    return
                try:
                    os.killpg(self.pid, sig)
                except ProcessLookupError:
                    pass
                try:
                    self.wait(2)
                    return
                except TimeoutError:
                    pass
            raise RuntimeError("could not reap primary SSH")
        finally:
            os.close(self.fd)


def companion_ready(process, marker, output):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if select.select([process.stdout], [], [], 0.05)[0]:
            chunk = os.read(process.stdout.fileno(), 4096)
            output[:] = (output + chunk)[-LIMIT:]
            if marker.encode() in bytes(output).replace(b"\r", b"").split(b"\n"):
                require(process.poll() is None, "companion exited at readiness")
                return
            require(bool(chunk), "companion closed output before readiness")
        require(process.poll() is None, "companion exited before readiness")
    raise TimeoutError("companion readiness timed out")


def reap_companion(process, output):
    try:
        if process.stdout.closed:
            process.wait(timeout=2)
            return
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if process.poll() is None:
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    pass
            try:
                tail, _ = process.communicate(timeout=2)
                output[:] = (output + tail)[-LIMIT:]
                return
            except subprocess.TimeoutExpired:
                pass
        raise RuntimeError("could not reap companion SSH")
    finally:
        process.stdout.close()


def wait_socket_removed(path, timeout=5):
    deadline = time.monotonic() + timeout
    while os.path.lexists(path):
        if time.monotonic() >= deadline:
            raise TimeoutError("owned ControlPath was not removed")
        time.sleep(0.05)


def main():
    # Short path avoids Unix socket length limits; mkdtemp creates mode 0700.
    with tempfile.TemporaryDirectory(prefix="mux-", dir="/tmp") as directory:
        require(os.stat(directory).st_mode & 0o777 == 0o700,
                "control directory is not private")
        path = directory + "/s"
        primary = None
        companion = None
        companion_output = bytearray()
        diagnostics = b""
        cleanup_errors = []
        try:
            # Negative control uses exactly the clean companion invocation.
            missing = subprocess.run(mux_args(directory + "/missing") + ["dummy", "true"],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     timeout=3)
            diagnostics = missing.stdout[-LIMIT:]
            require(missing.returncode != 0, "missing mux unexpectedly connected")
            print("PASS missing mux fails closed without login configuration", flush=True)

            primary = Primary(path)
            deadline = time.monotonic() + 10
            while True:
                require(primary.poll() is None, "primary exited before mux readiness")
                if os.path.exists(path):
                    code, diagnostics = control(path, "check")
                    if code == 0:
                        break
                require(time.monotonic() < deadline, "mux readiness timed out")
                primary.drain()
            primary.ready()

            marker = "COMPANION_" + uuid.uuid4().hex
            companion = subprocess.Popen(
                mux_args(path) + ["dummy", "printf '\\n%s\\n' '" + marker + "'; exec sleep 30"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            companion_ready(companion, marker, companion_output)
            os.write(primary.fd, b"exit 7\n")
            require(primary.wait(5) == 7, "primary did not preserve exit status 7")
            require(companion.poll() is None, "companion was not live after primary exit")
            code, diagnostics = control(path, "check")
            require(code == 0, "authenticated master did not survive primary exit")
            print("PASS primary exits with status 7 within 5s while companion is live", flush=True)

            code, diagnostics = control(path, "exit")
            require(code == 0, "explicit master exit failed")
            tail, _ = companion.communicate(timeout=5)
            companion_output[:] = (companion_output + tail)[-LIMIT:]
            wait_socket_removed(path)
            print("PASS owned master exit reaps companion and removes socket", flush=True)
        finally:
            # Cleanup is unconditional and does not depend on assertions.
            if os.path.lexists(path):
                try:
                    _, diagnostics = control(path, "exit")
                except Exception as exc:
                    cleanup_errors.append("master exit: " + type(exc).__name__)
            if companion is not None:
                try:
                    reap_companion(companion, companion_output)
                except Exception as exc:
                    cleanup_errors.append("companion cleanup: " + type(exc).__name__)
            if primary is not None:
                try:
                    primary.close()
                except Exception as exc:
                    cleanup_errors.append("primary cleanup: " + type(exc).__name__)
            try:
                # ControlPersist provides a bounded fallback after channels close.
                wait_socket_removed(path, timeout=8)
            except Exception as exc:
                cleanup_errors.append("socket cleanup: " + type(exc).__name__)
            for label, output in (("primary", primary.output if primary else b""),
                                  ("companion", companion_output), ("control", diagnostics)):
                print("--- " + label + " (last 8 KiB) ---", flush=True)
                print(bytes(output[-LIMIT:]).decode(errors="replace"), flush=True)
            require(not cleanup_errors, "; ".join(cleanup_errors))


if __name__ == "__main__":
    main()
