#!/usr/bin/env python3
"""Production managed SSH config, LocalCommand admission, and cleanup proof."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

from bootstrap import LocalShell, require, session_directories


SSH_CONFIG = Path('/root/.ssh/config')
FIXTURE_CONFIG = Path('/fixture/ssh_config')


def run(command, expected=0, timeout=20):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    require(
        result.returncode == expected,
        f'{command!r} returned {result.returncode}, expected {expected}: '
        f'stdout={result.stdout!r} stderr={result.stderr!r}',
    )
    return result


def wait_for(predicate, message, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise TimeoutError(message)


def install_alias_config():
    content = FIXTURE_CONFIG.read_text()
    content = content.replace(
        'Host remote-a remote-b\n',
        'Host remote-a.od\n    HostName remote-a\n\nHost remote-a.od remote-a remote-b\n',
        1,
    )
    require('Host remote-a.od remote-a remote-b' in content, 'failed to add wildcard fixture alias')
    SSH_CONFIG.write_text(content)
    SSH_CONFIG.chmod(0o600)


def effective_config():
    values = {}
    result = run(['ssh', '-G', 'remote-a.od'])
    for line in result.stdout.splitlines():
        key, separator, value = line.partition(' ')
        if separator:
            values[key] = value
    return values


def main():
    install_alias_config()
    shell = LocalShell()
    directory = None
    try:
        shell.marker(
            "SHELL=/bin/bash command port install --remote-services --remote-host '*.od' "
            "--shell-hook-only --yes >/tmp/managed-remote-install.log",
            timeout=60,
        )
        shell.marker('eval "$(command port shell-hook bash)"; declare -F ssh >/dev/null')

        values = effective_config()
        require(values.get('hostname') == 'remote-a', 'managed wildcard did not select the alias')
        require(values.get('controlmaster') == 'auto', 'managed ControlMaster was not enabled')
        require(values.get('controlpersist') == '3', 'managed ControlPersist was not finite')
        require(values.get('permitlocalcommand') == 'yes', 'managed LocalCommand was not permitted')
        require(values.get('localcommand') == 'port __remote-register %C', 'managed LocalCommand changed')
        match = re.fullmatch(r'/tmp/port-control-([a-f0-9]{40,64})', values.get('controlpath', ''))
        require(match is not None, 'managed ControlPath did not contain expanded %C')
        connection_id = match.group(1)

        before = session_directories()
        shell.marker(
            "test -t 0 && test -t 1 && "
            "ssh remote-a.od 'test \"$(id -un)\" = fixture'",
            timeout=30,
        )
        expected = Path(f'/tmp/port-ssh-{connection_id}')
        shell.wait_for(lambda: expected in session_directories(), timeout=10)
        directory = expected
        require(session_directories() - before == {directory}, 'managed SSH created unexpected state')
        metadata = json.loads((directory / 'metadata.json').read_text())
        require(metadata.get('version') == 3, 'managed session did not use metadata version 3')
        require(metadata.get('lifecycle') == 'openssh-managed', 'managed lifecycle marker is missing')
        require(metadata.get('connectionId') == connection_id, 'metadata connection identity changed')
        shell.wait_for(lambda: (directory / 'handshake.json').exists(), timeout=15)
        wait_for(lambda: not directory.exists(), 'managed state survived finite ControlPersist', timeout=20)
        directory = None
        print('PASS production wildcard LocalCommand registers and self-cleans', flush=True)

        before_transfer = session_directories()
        run(['scp', '/etc/hostname', 'remote-a.od:/tmp/managed-local-command-copy'])
        run(['sftp', '-b', '/dev/null', 'remote-a.od'])
        time.sleep(0.5)
        require(session_directories() == before_transfer, 'scp or sftp activated managed Port state')
        print('PASS production scp and sftp bypass managed activation', flush=True)
    finally:
        shell.close()
        if directory and directory.exists():
            subprocess.run(['ssh', '-O', 'exit', 'remote-a.od'], capture_output=True, timeout=5)
        subprocess.run(
            ['port', 'uninstall', '--remote-services', '--no-shell-hook', '--yes'],
            capture_output=True,
            timeout=15,
        )
        shutil.copyfile(FIXTURE_CONFIG, SSH_CONFIG)
        SSH_CONFIG.chmod(0o600)


if __name__ == '__main__':
    main()
