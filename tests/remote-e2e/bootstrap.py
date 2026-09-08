#!/usr/bin/env python3
"""Actual opt-in Port shell bootstrap over plain SSH; handshake only, no routing."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import time
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class LocalShell:
    def __init__(self):
        self.output = b""
        self.status = None
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp("bash", ["bash", "--noprofile", "--norc", "-i"])

    def send(self, text):
        os.write(self.fd, text.encode())

    def marker(self, command):
        marker = "BOOTSTRAP_" + uuid.uuid4().hex
        self.send(command + " && printf '\\n%s\\n' '" + marker + "'\n")
        self.wait_for(lambda: marker.encode() in self.output.replace(b"\r", b"").split(b"\n"))

    def wait_for(self, predicate, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return
            if select.select([self.fd], [], [], 0.05)[0]:
                try:
                    chunk = os.read(self.fd, 4096)
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
                    chunk = b""
                require(chunk, "local shell closed unexpectedly")
                self.output = (self.output + chunk)[-16384:]
        raise TimeoutError("plain-SSH bootstrap condition timed out")

    def close(self):
        try:
            self.send("exit\n")
            for sig in (None, signal.SIGTERM, signal.SIGKILL):
                if sig is not None:
                    try:
                        os.killpg(self.pid, sig)
                    except ProcessLookupError:
                        pass
                end = time.monotonic() + 2
                while time.monotonic() < end:
                    pid, status = os.waitpid(self.pid, os.WNOHANG)
                    if pid:
                        self.status = os.waitstatus_to_exitcode(status)
                        return
                    time.sleep(0.05)
            raise RuntimeError("could not reap local shell")
        finally:
            os.close(self.fd)


def main():
    # Install the fixture's normal SSH config, not command-specific test options.
    shutil.copyfile('/fixture/ssh_config', '/root/.ssh/config')
    os.chmod('/root/.ssh/config', 0o600)
    before = set(Path('/tmp').glob('port-ssh-*'))
    shell = LocalShell()
    try:
        shell.marker('eval "$(port shell-hook bash --remote-services)"; declare -F ssh >/dev/null')
        shell.send('ssh remote-a\n')
        shell.marker('test -t 0 && test "$(id -un)" = fixture')

        def handshake():
            for directory in set(Path('/tmp').glob('port-ssh-*')) - before:
                path = directory / 'handshake.json'
                if path.exists():
                    require(json.loads(path.read_text()) == {'kind': 'port-handshake', 'version': 1},
                            'invalid product handshake')
                    return True
            return False

        shell.wait_for(handshake)
        owned = set(Path('/tmp').glob('port-ssh-*')) - before
        require(len(owned) == 1, 'expected exactly one owned session')
        print('PASS plain ssh + actual Port shell hook + remote CLI handshake', flush=True)
        shell.send('exit 7\n')
        shell.wait_for(lambda: all(not path.exists() for path in owned))
        shell.marker('test "$?" -eq 7')
        print('PASS product shell preserves status 7 and removes session state', flush=True)
    finally:
        shell.close()
        print('--- local bootstrap PTY (last 16 KiB) ---', flush=True)
        print(shell.output.decode(errors='replace'), flush=True)


if __name__ == '__main__':
    main()
