#!/usr/bin/env python3
"""Actual plain-SSH bootstrap and live discovery with an explicit fixture seed; no routing."""
import errno
import json
import ipaddress
import re
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import socket
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


def live_discovery(shell, directory):
    """Only read the cache: the product's owned companion must do all observation."""
    def wait_cache(status, since, predicate):
        found = []

        def matches():
            try:
                envelope = json.loads((directory / 'snapshot.json').read_text())
            except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
                return False
            require(set(envelope) == {'version', 'kind', 'status', 'observedAt', 'snapshot'},
                    'unexpected cache fields')
            require(envelope['version'] == 1 and envelope['kind'] == 'port-session-snapshot',
                    'invalid cache envelope')
            observed = envelope['observedAt']
            require(isinstance(observed, (int, float)), 'invalid observation time')
            if envelope['status'] != status or not since <= observed <= time.time() * 1000 + 1000:
                return False
            snapshot = envelope['snapshot']
            if snapshot is None:
                return False
            require(set(snapshot) == {'version', 'kind', 'instanceId', 'revision', 'worktrees'},
                    'unexpected snapshot fields')
            require(snapshot['version'] == 1 and snapshot['kind'] == 'port-service-snapshot',
                    'invalid snapshot')
            require(isinstance(snapshot['revision'], int) and snapshot['revision'] >= 0,
                    'invalid revision')
            require(isinstance(snapshot['instanceId'], str)
                    and re.fullmatch('[a-zA-Z0-9_-]{1,128}', snapshot['instanceId']) is not None,
                    'invalid instance identity')
            if predicate(snapshot):
                found.append(envelope)
                return True
            return False

        shell.wait_for(matches)
        return found[0]

    def mutate(mode):
        since = time.time() * 1000
        shell.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js ' + mode)
        return since

    initial = wait_cache('ready', time.time() * 1000,
                         lambda snapshot: snapshot['worktrees'] == [])['snapshot']
    since = mutate('start')
    addresses = re.findall(rb'^SNAPSHOT_FIXTURE_IP=([0-9.]+)$',
                           shell.output.replace(b'\r', b''), re.MULTILINE)
    require(len(addresses) == 1, 'missing unique fixture Docker address')
    address = addresses[0].decode()
    ip = ipaddress.IPv4Address(address)
    require(ip.is_private and not ip.is_loopback and not ip.is_link_local,
            'fixture target is not a private Docker address')

    def endpoint(snapshot):
        require(len(snapshot['worktrees']) == 1, 'expected one discovered worktree')
        tree = snapshot['worktrees'][0]
        require(set(tree) == {'worktreeId', 'namespace', 'endpoints'}, 'unexpected worktree fields')
        require(re.fullmatch('[a-f0-9]{64}', tree['worktreeId']) is not None,
                'invalid worktree identity')
        require(tree['namespace'] == 'feature.port' and len(tree['endpoints']) == 1,
                'expected one feature.port endpoint')
        item = tree['endpoints'][0]
        require(set(item) == {'id', 'name', 'aliasTransports', 'logicalPort', 'transports', 'target'},
                'unexpected endpoint fields (paths/environment must not escape)')
        require(re.fullmatch('[a-f0-9]{64}', item['id']) is not None, 'invalid endpoint identity')
        require(item == dict(id=item['id'], name='ui', aliasTransports=['http'], logicalPort=3000,
                             transports=['http', 'tls-sni'], target={'address': address, 'port': 8080}),
                'discovered endpoint differs from generated labels/private Docker target')
        return item

    def later(snapshot, previous):
        require(snapshot['instanceId'] == initial['instanceId'], 'instance identity changed')
        return snapshot['revision'] > previous['revision']

    discovered = wait_cache('ready', since, lambda s: later(s, initial) and bool(s['worktrees']))['snapshot']
    original_endpoint = endpoint(discovered)
    # Run HTTP in the ordinary remote SSH shell, not inside the workload or a forward.
    mutate('probe')
    reachable = re.findall(rb'^SNAPSHOT_FIXTURE_REACHABLE=([0-9.]+)$',
                           shell.output.replace(b'\r', b''), re.MULTILINE)
    require(reachable == [address.encode()],
            'remote SSH namespace did not reach the discovered Docker endpoint identity')
    since = mutate('corrupt')
    unavailable = wait_cache('unavailable', since, lambda s: bool(s['worktrees']))['snapshot']
    require(unavailable['instanceId'] == initial['instanceId']
            and unavailable['revision'] >= discovered['revision'], 'last-known identity/revision lost')
    require(endpoint(unavailable) == original_endpoint, 'unavailable cache lost last-known endpoint')
    since = mutate('restore')
    recovered = wait_cache('ready', since, lambda s: later(s, unavailable) and bool(s['worktrees']))['snapshot']
    require(endpoint(recovered) == original_endpoint, 'recovery changed endpoint identity')
    since = mutate('stop')
    wait_cache('ready', since, lambda s: later(s, recovered) and s['worktrees'] == [])
    print('PASS automatic live discovery: empty -> seeded -> unavailable/retained -> ready -> stopped/empty',
          flush=True)


def bounded_line(process, timeout=10, limit=1024):
    """Read one pipe line without buffered-read blocking or unlimited diagnostics."""
    end = time.monotonic() + timeout
    output = bytearray()
    while time.monotonic() < end:
        remaining = max(0, end - time.monotonic())
        if not select.select([process.stdout], [], [], remaining)[0]:
            break
        chunk = os.read(process.stdout.fileno(), 1)
        require(chunk, 'component probe closed before its response')
        if chunk == b'\n':
            return bytes(output)
        output.extend(chunk)
        require(len(output) <= limit, 'component probe response too large')
    raise TimeoutError('component probe response timed out')


def stop_process(process):
    """Only signal this still-live child; always reap with bounded waits."""
    try:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
    finally:
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                stream.close()


def private_forward(shell, directory):
    # Runs on CLIENT while the original foreground remote-a login owns the mux.
    # No hand-built SSH forward or fallback login may replace the actual API.
    helper = subprocess.Popen(
        ['/usr/local/bin/bun', '/opt/port/fixtures/forward-probe.js', str(directory)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        bufsize=0,
    )
    try:
        try:
            ready = json.loads(bounded_line(helper))
        except (ValueError, UnicodeDecodeError):
            raise RuntimeError('invalid private forward response') from None
        require(isinstance(ready, dict) and set(ready) == {'status', 'address', 'port'},
                'unexpected private forward response fields')
        require(ready['status'] == 'ready' and ready['address'] == '127.0.0.1'
                and type(ready['port']) is int and 0 < ready['port'] <= 65535,
                'invalid private forward listener')
        port = ready['port']
        # Plain libpq is ONLY inside the encrypted private SSH transport, never
        # the shared-hostname Traefik baseline or public plaintext support (#149).
        database = subprocess.Popen(
            ['psql', '-X', '-w', '-A', '-t', '-F', '|',
             f'host=127.0.0.1 port={port} user=postgres dbname=remote_a '
             'connect_timeout=3 sslmode=disable', '-v', 'ON_ERROR_STOP=1', '-c',
             'SELECT current_database(), system_identifier FROM pg_control_system()'],
            env={'PATH': os.environ['PATH'], 'HOME': '/tmp/forward-probe-empty-home', 'LC_ALL': 'C'},
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            bufsize=0,
        )
        try:
            row = bounded_line(database, timeout=7)
            require(database.wait(timeout=2) == 0, 'private forward SQL failed')
            require(re.fullmatch(rb'remote_a\|[0-9]+', row) is not None,
                    'private forward reached the wrong database')
        finally:
            stop_process(database)
        assert helper.stdin is not None
        helper.stdin.write(b'close\n')
        helper.stdin.flush()
        try:
            closed = json.loads(bounded_line(helper))
        except (ValueError, UnicodeDecodeError):
            raise RuntimeError('invalid private forward close response') from None
        require(closed == {'status': 'closed'}, 'private forward did not acknowledge close')
        require(helper.wait(timeout=3) == 0, 'private forward helper failed')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=2):
                raise RuntimeError('private forward listener survived close')
        except ConnectionRefusedError:
            pass
        # Cancellation must leave the SAME interactive master/login usable.
        shell.marker('test -t 0 && test "$(id -un)" = fixture && true')
        print('PASS private transport component: actual openRemoteForward -> remote_a SQL; '
              'idempotent cancel refuses new connections and preserves login', flush=True)
    finally:
        stop_process(helper)


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
        directory = private_session(before)
        private_forward(shell, directory)
        try:
            live_discovery(shell, directory)
        except Exception:
            cache = directory / 'snapshot.json'
            if cache.exists():
                print('FAILED_CACHE=' + cache.read_text()[:8192], flush=True)
            raise
        shell.send('exit 7\n')
        shell.wait_for(lambda: all(not path.exists() for path in owned))
        shell.marker('test "$?" -eq 7')
        shell.wait_for(lambda: observer_finished(directory))
        require(session_directories() == before, 'live-discovery login leaked local session state')
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
