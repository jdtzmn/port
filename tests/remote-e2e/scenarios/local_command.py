#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time

CONFIG = Path('/tmp/port-local-command.conf')
EVENTS = Path('/tmp/port-local-command-events.jsonl')
SOCKET_PREFIX = '/tmp/port-local-command-'
FORWARD = Path('/tmp/port-local-command-forward.sock')
CONNECTION_ID = re.compile(r'^[0-9A-Fa-f]{40,64}$')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def unix_socket_accepts(path):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(1)
    try:
        client.connect(str(path))
        return True
    except OSError:
        return False
    finally:
        client.close()

def append_event(event, connection_id):
    with EVENTS.open('a') as stream:
        stream.write(json.dumps({
            'event': event,
            'connectionId': connection_id,
            'pid': os.getpid(),
        }) + '\n')


def watch(connection_id):
    socket = Path(SOCKET_PREFIX + connection_id)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if socket.is_socket():
            append_event('alive', connection_id)
            break
        time.sleep(0.05)
    else:
        append_event('never-alive', connection_id)
        return 1

    # Observe the path without opening mux clients: every `ssh -O check` can reset
    # ControlPersist and accidentally keep the master alive.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not socket.exists():
            append_event('stopped', connection_id)
            return 0
        time.sleep(0.1)

    append_event('still-alive', connection_id)
    return 1


def register(connection_id):
    require(CONNECTION_ID.fullmatch(connection_id), 'LocalCommand received an unsafe %C token')
    append_event('registered', connection_id)
    subprocess.Popen(
        [sys.executable, __file__, 'watch', connection_id],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def read_events():
    if not EVENTS.exists():
        return []
    return [json.loads(line) for line in EVENTS.read_text().splitlines() if line]


def wait_for_event(event, count=1, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        matches = [item for item in read_events() if item['event'] == event]
        if len(matches) >= count:
            return matches[-1]
        time.sleep(0.05)
    raise RuntimeError(f'timed out waiting for LocalCommand event {event!r} #{count}: {read_events()}')


def run(command, expected=0, timeout=15):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    require(
        result.returncode == expected,
        f'{command!r} returned {result.returncode}, expected {expected}: '
        f'stdout={result.stdout!r} stderr={result.stderr!r}',
    )
    return result


def effective_config():
    result = run(['ssh', '-G', '-F', str(CONFIG), 'remote-a.od'])
    values = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition(' ')
        if separator:
            values[key] = value
    return values


def write_config():
    CONFIG.write_text('''\
Host remote-a.od
    HostName remote-a
    HostKeyAlias remote-a

Host *.od
    User fixture
    IdentityFile /root/.ssh/id_ed25519
    IdentitiesOnly yes
    UserKnownHostsFile /root/.ssh/known_hosts
    GlobalKnownHostsFile /dev/null
    StrictHostKeyChecking yes
    UpdateHostKeys no
    BatchMode yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ConnectTimeout 5
    ConnectionAttempts 1
    ExitOnForwardFailure yes
    LogLevel ERROR
    ControlMaster auto
    ControlPath /tmp/port-local-command-%C
    ControlPersist 3
    PermitLocalCommand yes
    LocalCommand python3 /fixture/local_command.py register %C
''')
    CONFIG.chmod(0o600)


def cleanup():
    for path in Path('/tmp').glob('port-local-command-*'):
        if path.is_socket():
            subprocess.run(
                ['ssh', '-F', '/dev/null', '-S', str(path), '-O', 'exit', 'dummy'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=2,
            )
        if path.is_socket() or path.is_file():
            path.unlink(missing_ok=True)


def lifecycle(command, expected_status, registration_count):
    result = subprocess.Popen(
        ['ssh', '-F', str(CONFIG), *command],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if command == ['-tt', 'remote-a.od']:
        stdout, stderr = result.communicate(
            'test -t 0 && test "$(id -un)" = fixture || exit 91; exit 7\n',
            timeout=15,
        )
    else:
        stdout, stderr = result.communicate(timeout=15)
    require(
        result.returncode == expected_status,
        f'SSH returned {result.returncode}, expected {expected_status}: '
        f'stdout={stdout!r} stderr={stderr!r}',
    )

    registration = wait_for_event('registered', registration_count)
    wait_for_event('alive', registration_count)
    return registration['connectionId']


def main():
    cleanup()
    try:
        write_config()
        config = effective_config()
        require(config.get('hostname') == 'remote-a', 'wildcard Host did not select remote-a')
        require(config.get('user') == 'fixture', 'wildcard Host did not select fixture user')
        require(config.get('permitlocalcommand') == 'yes', 'PermitLocalCommand was not enabled')
        require(config.get('controlmaster') == 'auto', 'ControlMaster was not enabled')
        require(config.get('controlpersist') == '3', 'ControlPersist was not finite')
        require(config.get('localcommand', '').endswith(' register %C'), 'LocalCommand lost safe %C')

        remote_command = (
            'test ! -t 0 && test "$(id -un)" = fixture || exit 91; sleep 1; exit 23'
        )
        connection_id = lifecycle(['remote-a.od', remote_command], 23, 1)
        socket = Path(SOCKET_PREFIX + connection_id)
        require(socket.exists(), 'ControlMaster socket disappeared before ControlPersist')
        run([
            'ssh', '-F', '/dev/null', '-S', str(socket), '-o', 'ControlMaster=no',
            '-o', 'BatchMode=yes', '-o', 'ProxyCommand=false', '-T', '-n',
            '-O', 'check', 'dummy',
        ])
        run([
            'ssh', '-F', '/dev/null', '-S', str(socket), '-o', 'ControlMaster=no',
            '-o', 'BatchMode=yes', '-o', 'ProxyCommand=false', '-T', '-n',
            '-O', 'forward', '-L', f'{FORWARD}:127.0.0.1:5432', 'dummy',
        ])
        require(FORWARD.is_socket(), 'stream-local forward was not opened')
        require(unix_socket_accepts(FORWARD), 'stream-local forward did not accept connections')
        wait_for_event('stopped', 1)
        require(not socket.exists(), 'finite ControlPersist left its master socket behind')
        require(
            not unix_socket_accepts(FORWARD),
            'Port-style stream-local forward remained active after its master stopped',
        )
        # OpenSSH leaves the bound Unix pathname behind after closing the listener.
        # The coordinator may safely unlink this Port-owned path after master shutdown.
        FORWARD.unlink(missing_ok=True)
        require(not FORWARD.exists(), 'Port-owned forward path could not be removed')
        print('PASS wildcard LocalCommand follows noninteractive ControlMaster cleanup', flush=True)

        lifecycle(['-tt', 'remote-a.od'], 7, 2)
        wait_for_event('stopped', 2)
        print('PASS interactive SSH preserves PTY status and self-cleans', flush=True)

        event_count = len(read_events())
        transfer_options = [
            '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no',
        ]
        run([
            'scp', '-F', str(CONFIG), *transfer_options, '/etc/hostname',
            'remote-a.od:/tmp/local-command-copy',
        ])
        run(['sftp', '-F', str(CONFIG), *transfer_options, '-b', '/dev/null', 'remote-a.od'])
        time.sleep(0.2)
        require(len(read_events()) == event_count, 'scp or sftp unexpectedly ran LocalCommand')
        print('PASS scp and sftp bypass LocalCommand', flush=True)
    finally:
        cleanup()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'register':
        register(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == 'watch':
        raise SystemExit(watch(sys.argv[2]))
    elif len(sys.argv) == 1:
        main()
    else:
        raise RuntimeError('invalid arguments')
