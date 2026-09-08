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
import subprocess
import stat
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

    def marker(self, command, check=None):
        marker = "BOOTSTRAP_" + uuid.uuid4().hex
        # Split the token so even a wrapped/echoed command cannot match it.
        self.send(command + " && printf '\\n%s%s\\n' '" + marker[:16] + "' '" + marker[16:] + "'\n")

        def completed():
            if check is not None:
                check()
            return marker.encode() in self.output.replace(b"\r", b"").split(b"\n")

        self.wait_for(completed)

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


def session_directories():
    return set(Path('/tmp').glob('port-ssh-*'))


def private_session(before):
    owned = session_directories() - before
    require(len(owned) == 1, 'expected exactly one owned session')
    directory = next(iter(owned))
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'session directory is not private and owned')
    return directory


def observer_finished(directory):
    # This program runs only in the disposable client fixture. Never read environ
    # or print command lines; match exact argv entries, not substring lookalikes.
    for path in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            argv = path.read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError):
            continue
        if any(argv[index:index + 2] == [b'__remote-observe', os.fsencode(directory)]
               for index in range(len(argv) - 1)):
            return False
    return True


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

        shell.send('ssh -J remote-b remote-a\n')
        shell.marker('test -t 0 && test "$(id -un)" = fixture')
        shell.wait_for(handshake)
        directory = private_session(before)
        shell.send('exit 11\n')
        shell.wait_for(lambda: not directory.exists())
        shell.marker('test "$?" -eq 11')
        print('PASS ProxyJump through remote-b preserves handshake, status 11, cleanup', flush=True)

        # Encrypt only this disposable fixture key; exercise foreground auth once.
        key = '/root/.ssh/id_ed25519'
        passphrase = 'remote-e2e-generated-key-only'
        subprocess.run(['ssh-keygen', '-q', '-p', '-P', '', '-N', passphrase, '-f', key],
                       check=True, capture_output=True, timeout=5)
        try:
            shell.output = b''
            shell.send('ssh -o BatchMode=no remote-a\n')
            shell.wait_for(lambda: b'Enter passphrase for key' in shell.output)
            shell.send(passphrase + '\n')
            # OpenSSH may flush queued terminal input while leaving readpass mode.
            shell.wait_for(lambda: b'\n$ ' in shell.output.replace(b'\r', b''))
            shell.marker('test -t 0 && test "$(id -un)" = fixture')
            shell.wait_for(handshake)
            require(shell.output.count(b'Enter passphrase for key') == 1,
                    'companion caused an additional authentication prompt')
            directory = private_session(before)
            shell.send('exit 13\n')
            shell.wait_for(lambda: not directory.exists())
            shell.marker('test "$?" -eq 13')
            print('PASS encrypted-key login prompts once, handshakes, and preserves status 13', flush=True)
        finally:
            subprocess.run(['ssh-keygen', '-q', '-p', '-P', passphrase, '-N', '', '-f', key],
                           check=True, capture_output=True, timeout=5)

        shell.send('ssh remote-b\n')
        shell.marker('test -t 0 && test "$(id -un)" = fixture && ! command -v port')
        directory = private_session(before)
        shell.wait_for(lambda: observer_finished(directory))
        require(directory.exists(), 'missing-Port login lost its session prematurely')
        require(not (directory / 'handshake.json').exists(), 'missing Port produced a handshake')
        shell.send('exit 9\n')
        shell.wait_for(lambda: not directory.exists())
        shell.marker('test "$?" -eq 9')
        require(session_directories() == before, 'missing-Port login leaked session state')
        print('PASS missing remote Port: interactive login, no handshake, status 9, cleanup', flush=True)

        def no_new_sessions():
            require(session_directories() == before, 'noninteractive SSH created session state')

        no_new_sessions()
        shell.marker("ssh remote-a 'test ! -t 0 && test \"$(id -un)\" = fixture || exit 99; exit 23'; "
                     'test "$?" -eq 23', check=no_new_sessions)
        no_new_sessions()
        print('PASS noninteractive SSH passthrough preserves status 23 without session state', flush=True)
    finally:
        shell.close()
        print('--- local bootstrap PTY (last 16 KiB) ---', flush=True)
        print(shell.output.decode(errors='replace'), flush=True)


if __name__ == '__main__':
    main()
