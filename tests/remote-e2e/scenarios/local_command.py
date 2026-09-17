#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid

LIMIT = 8192
CONNECTION_ID = re.compile(r'^[0-9A-Fa-f]{40,64}$')
STATE_DIRECTORY = re.compile(r'^/tmp/lc-[A-Za-z0-9_]+$')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def private_state_directory(path):
    require(STATE_DIRECTORY.fullmatch(str(path)), 'invalid LocalCommand state path')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode), 'LocalCommand state path is not a directory')
    require(info.st_uid == os.geteuid(), 'LocalCommand state path has the wrong owner')
    require(info.st_mode & 0o777 == 0o700, 'LocalCommand state path is not private')


def append_registration(state, connection_id):
    require(CONNECTION_ID.fullmatch(connection_id), 'LocalCommand received an unsafe %C token')
    private_state_directory(state)
    event_path = state / 'events.jsonl'
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW
    descriptor = os.open(event_path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode), 'LocalCommand event path is not a regular file')
        require(info.st_uid == os.geteuid(), 'LocalCommand event path has the wrong owner')
        require(info.st_mode & 0o777 == 0o600, 'LocalCommand event path is not private')
        payload = (json.dumps({
            'connectionId': connection_id,
            'pid': os.getpid(),
        }, separators=(',', ':')) + '\n').encode()
        require(os.write(descriptor, payload) == len(payload), 'incomplete LocalCommand event write')
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_events(state):
    event_path = state / 'events.jsonl'
    if not event_path.exists():
        return []
    return [json.loads(line) for line in event_path.read_text().splitlines() if line]


def wait_for_registrations(state, count, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        events = read_events(state)
        if len(events) >= count:
            return events
        time.sleep(0.05)
    raise RuntimeError(f'timed out waiting for LocalCommand registration #{count}: {read_events(state)}')


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


def run(command, expected=0, timeout=15):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    require(
        result.returncode == expected,
        f'{command!r} returned {result.returncode}, expected {expected}: '
        f'stdout={result.stdout!r} stderr={result.stderr!r}',
    )
    return result


def mux_args(control_path):
    return [
        'ssh', '-F', '/dev/null', '-S', str(control_path),
        '-o', 'ControlMaster=no', '-o', 'BatchMode=yes',
        '-o', 'ProxyCommand=false', '-T', '-n',
    ]


def control(control_path, operation, options=None):
    return run(mux_args(control_path) + ['-O', operation, *(options or []), 'dummy'], timeout=2)


def wait_for_control_removed(control_path, timeout=10):
    deadline = time.monotonic() + timeout
    while os.path.lexists(control_path):
        if time.monotonic() >= deadline:
            raise TimeoutError('ControlMaster did not stop after finite ControlPersist')
        time.sleep(0.05)


def write_config(state):
    config = state / 'ssh_config'
    config.write_text(f'''\
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
    ControlPath {state}/cm-%C
    ControlPersist 3
    PermitLocalCommand yes
    LocalCommand python3 /fixture/local_command.py register {state} %C
''')
    config.chmod(0o600)
    return config


def effective_config(config):
    result = run(['ssh', '-G', '-F', str(config), 'remote-a.od'])
    values = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition(' ')
        if separator:
            values[key] = value
    return values


def wait_for_marker(process, marker, output, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        require(process.poll() is None, 'interactive SSH exited before readiness')
        if select.select([process.stdout], [], [], 0.05)[0]:
            chunk = os.read(process.stdout.fileno(), 4096)
            require(chunk, 'interactive SSH closed output before readiness')
            output[:] = (output + chunk)[-LIMIT:]
            if marker.encode() in bytes(output).replace(b'\r', b'').split(b'\n'):
                return
    raise TimeoutError('interactive SSH readiness timed out')


def start_interactive(config, marker):
    remote_command = (
        'test -t 0 && test "$(id -un)" = fixture || exit 91; '
        f'printf "\\n{marker}\\n"; read status; exit "$status"'
    )
    return subprocess.Popen(
        ['ssh', '-tt', '-F', str(config), 'remote-a.od', remote_command],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )


def finish_interactive(process, output):
    tail, _ = process.communicate(b'7\n', timeout=10)
    output[:] = (output + tail)[-LIMIT:]
    require(process.returncode == 7, f'interactive SSH returned {process.returncode}, expected 7')


def reap_process(process, output):
    if process.poll() is not None:
        if process.stdout and not process.stdout.closed:
            tail, _ = process.communicate(timeout=2)
            output[:] = (output + tail)[-LIMIT:]
        return
    for group_signal in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, group_signal)
        except ProcessLookupError:
            pass
        try:
            tail, _ = process.communicate(timeout=2)
            output[:] = (output + tail)[-LIMIT:]
            return
        except subprocess.TimeoutExpired:
            pass
    raise RuntimeError('could not reap interactive SSH')


def main():
    with tempfile.TemporaryDirectory(prefix='lc-', dir='/tmp') as name:
        state = Path(name)
        private_state_directory(state)
        config = write_config(state)
        values = effective_config(config)
        require(not read_events(state), 'ssh -G unexpectedly ran LocalCommand')
        require(values.get('hostname') == 'remote-a', 'wildcard Host did not select remote-a')
        require(values.get('user') == 'fixture', 'wildcard Host did not select fixture user')
        require(values.get('permitlocalcommand') == 'yes', 'PermitLocalCommand was not enabled')
        require(values.get('controlmaster') == 'auto', 'ControlMaster was not enabled')
        require(values.get('controlpersist') == '3', 'ControlPersist was not finite')
        expected_command = f'python3 /fixture/local_command.py register {state} %C'
        require(values.get('localcommand') == expected_command, 'LocalCommand lost safe %C')
        control_path = Path(values['controlpath'])
        require(control_path.parent == state, 'ControlPath escaped private state')
        connection_id = control_path.name.removeprefix('cm-')
        require(CONNECTION_ID.fullmatch(connection_id), 'ssh -G produced an unsafe %C token')

        primary = None
        primary_output = bytearray()
        cleanup_errors = []
        forward_path = state / 'forward.sock'
        try:
            direct_command = (
                'test ! -t 0 && test "$(id -un)" = fixture || exit 91; sleep 1; exit 23'
            )
            run(['ssh', '-F', str(config), 'remote-a.od', direct_command], expected=23)
            events = wait_for_registrations(state, 1)
            require(events == [{'connectionId': connection_id, 'pid': events[0]['pid']}],
                    'direct noninteractive SSH recorded unexpected LocalCommand data')
            require(control_path.is_socket(), 'noninteractive ControlMaster did not persist')
            control(control_path, 'check')
            wait_for_control_removed(control_path)
            print('PASS direct noninteractive SSH registers and self-cleans', flush=True)

            marker = 'LOCAL_COMMAND_' + uuid.uuid4().hex
            primary = start_interactive(config, marker)
            wait_for_marker(primary, marker, primary_output)
            events = wait_for_registrations(state, 2)
            require(events[-1]['connectionId'] == connection_id,
                    'interactive SSH used a different connection identity')
            require(control_path.is_socket(), 'interactive ControlMaster was not created')
            control(control_path, 'forward', ['-L', f'{forward_path}:127.0.0.1:5432'])
            require(forward_path.is_socket(), 'stream-local forward was not opened')
            require(unix_socket_accepts(forward_path), 'stream-local forward did not accept connections')

            shared_command = (
                'test ! -t 0 && test "$(id -un)" = fixture || exit 91; exit 23'
            )
            run(['ssh', '-F', str(config), 'remote-a.od', shared_command], expected=23)
            time.sleep(0.2)
            require(len(read_events(state)) == 2,
                    'multiplexed SSH unexpectedly reran LocalCommand for the same master')
            require(primary.poll() is None, 'interactive session ended with shared client')
            require(control_path.is_socket(), 'shared master stopped before final active session')
            control(control_path, 'check')
            print('PASS interactive and noninteractive clients share one registration', flush=True)

            finish_interactive(primary, primary_output)
            wait_for_control_removed(control_path)
            require(forward_path.is_socket(), 'OpenSSH did not leave the expected stale forward path')
            require(not unix_socket_accepts(forward_path),
                    'stream-local forward remained active after its master stopped')
            forward_path.unlink()
            require(not forward_path.exists(), 'Port-owned forward path could not be removed')
            print('PASS final session exit stops master and permits owned forward cleanup', flush=True)

            event_count = len(read_events(state))
            transfer_options = [
                '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no',
            ]
            run([
                'scp', '-F', str(config), *transfer_options, '/etc/hostname',
                'remote-a.od:/tmp/local-command-copy',
            ])
            run(['sftp', '-F', str(config), *transfer_options, '-b', '/dev/null', 'remote-a.od'])
            require(len(read_events(state)) == event_count,
                    'scp or sftp unexpectedly ran LocalCommand')
            print('PASS scp and sftp bypass LocalCommand', flush=True)
        finally:
            active_exception = sys.exc_info()[0] is not None
            if primary is not None:
                try:
                    reap_process(primary, primary_output)
                except Exception as error:
                    cleanup_errors.append('interactive SSH: ' + type(error).__name__)
            if os.path.lexists(control_path):
                try:
                    control(control_path, 'exit')
                except Exception as error:
                    cleanup_errors.append('master exit: ' + type(error).__name__)
                try:
                    wait_for_control_removed(control_path, timeout=8)
                except Exception as error:
                    cleanup_errors.append('master cleanup: ' + type(error).__name__)
            if os.path.lexists(forward_path):
                try:
                    forward_path.unlink()
                except Exception as error:
                    cleanup_errors.append('forward cleanup: ' + type(error).__name__)
            print('--- interactive SSH (last 8 KiB) ---', flush=True)
            print(bytes(primary_output[-LIMIT:]).decode(errors='replace'), flush=True)
            if cleanup_errors:
                message = '; '.join(cleanup_errors)
                if active_exception:
                    print('cleanup errors: ' + message, file=sys.stderr, flush=True)
                else:
                    raise RuntimeError(message)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'register':
        append_registration(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 1:
        main()
    else:
        raise RuntimeError('invalid arguments')
