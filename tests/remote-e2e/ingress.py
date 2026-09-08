#!/usr/bin/env python3
"""Actual ingress libraries, explicit test-owned catalog and SSH transport."""
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import time

from harness import SSH, database

PRIVATE = {'remote-a': '127.78.2.2', 'remote-b': '127.78.2.3', 'local': '127.78.2.1'}


def http(host, port=3000, method='GET', original_host=None):
    connection = HTTPConnection(host, port, timeout=3)
    try:
        headers = {'Host': f'{original_host or host}:{port}'}
        connection.request(method, '/', body=b'probe' if method == 'POST' else None, headers=headers)
        response = connection.getresponse()
        body = response.read(16385)
        assert len(body) <= 16384, 'oversized HTTP response'
        return response.status, json.loads(body)
    finally:
        connection.close()


def identity(host, owner, port=3000):
    status, body = http(host, port)
    assert status == 200 and body['owner'] == owner and body['service'] == 'ui'
    return body['posts']


def sql(host, owner):
    result = database(host, owner.replace('-', '_'))
    assert result.returncode == 0, 'database identity query failed'
    fields = result.stdout.strip().split('|')
    assert fields[:3] == [owner.replace('-', '_'), '127.0.0.1', '5432']
    assert len(fields) == 4 and fields[3].isdigit()
    return fields[3]


def protocol(process):
    # Read without buffered readline: a partial line must not bypass the deadline.
    end = time.monotonic() + 10
    line = bytearray()
    while time.monotonic() < end:
        if not select.select([process.stdout], [], [], max(0, end - time.monotonic()))[0]:
            break
        chunk = os.read(process.stdout.fileno(), 1)
        if not chunk:
            raise RuntimeError('ingress protocol closed')
        if chunk == b'\n':
            return json.loads(line)
        line.extend(chunk)
        assert len(line) <= 16384, 'oversized ingress protocol line'
    raise RuntimeError('ingress protocol deadline')


def update(process, owners):
    process.stdin.write((json.dumps({'owners': owners}) + '\n').encode())
    process.stdin.flush()
    assert protocol(process) == {'status': 'updated', 'owners': owners}


def stop(process):
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)
    for stream in (process.stdin, process.stdout):
        if stream:
            stream.close()


def main():
    processes = []
    try:
        for owner in ('remote-a', 'remote-b'):
            address = PRIVATE[owner]
            processes.append(subprocess.Popen(SSH + ['-N', '-L', f'{address}:5432:127.0.0.1:5432',
                '-L', f'{address}:3000:127.0.0.1:3000', owner], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        processes.append(subprocess.Popen(['bun', '/fixture/identity.ts'],
            env={**os.environ, 'FIXTURE_NAME': 'local'}, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        end = time.monotonic() + 30
        while True:
            try:
                assert all(process.poll() is None for process in processes), 'backend process exited'
                ids = {owner: sql(PRIVATE[owner], owner) for owner in ('remote-a', 'remote-b')}
                for owner, address in PRIVATE.items():
                    identity(address, owner)
                assert len(set(ids.values())) == 2
                break
            except (OSError, AssertionError, HTTPException):
                if time.monotonic() >= end:
                    raise
                time.sleep(0.2)
        fixture = subprocess.Popen(['bun', '/opt/port/ingress/ingress-fixture.js'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        processes.append(fixture)
        ready = protocol(fixture)
        assert ready['status'] == 'ready'
        mappings = ready['mappings']
        expected = {'feature.port', 'ui.feature.port', 'feature.local.port', 'ui.feature.local.port'}
        expected.update(f'{prefix}feature.{owner}.ssh' for prefix in ('', 'ui.')
                        for owner in ('remote-a', 'remote-b'))
        assert set(mappings) == expected and len(set(mappings.values())) == len(expected)
        for address in mappings.values():
            assert address.startswith('127.77.') and socket.inet_aton(address)
        Path('/tmp/ingress-hosts').write_text(''.join(f'{ip} {host}\n' for host, ip in mappings.items()))
        os.kill(int(Path('/tmp/dnsmasq.pid').read_text().strip()), signal.SIGHUP)
        end = time.monotonic() + 10
        while True:
            try:
                for host, address in mappings.items():
                    assert {item[4][0] for item in socket.getaddrinfo(host, 80, type=socket.SOCK_STREAM)} == {address}
                break
            except (OSError, AssertionError):
                if time.monotonic() >= end:
                    raise
                time.sleep(0.1)
        retained = socket.gethostbyname('feature.port')
        identity('feature.port', 'remote-a')
        identity('ui.feature.port', 'remote-a', 80)
        assert sql('feature.port', 'remote-a') == ids['remote-a']
        # Positive POST calibrates the counter before proving rejection has no side effects.
        assert http('feature.port', method='POST')[0] == 200
        assert identity(PRIVATE['remote-a'], 'remote-a') == 1

        def rejected(host, candidates, port=3000, original_host=None):
            before = {owner: identity(address, owner) for owner, address in PRIVATE.items()}
            status, body = http(host, port, 'POST', original_host)
            assert status == 409 and body['status'] == 'conflict'
            assert {candidate['owner']['id'] for candidate in body['candidates']} == set(candidates)
            assert {owner: identity(address, owner) for owner, address in PRIVATE.items()} == before

        update(fixture, ['remote-a', 'remote-b'])
        rejected('feature.port', ['remote-a', 'remote-b'])
        rejected('ui.feature.port', ['remote-a', 'remote-b'], 80)
        rejected(retained, ['remote-a', 'remote-b'], original_host='feature.port')
        for host in ('feature.port', retained):
            assert database(host, 'remote_a').returncode != 0, 'ambiguous TCP accepted'
        for owner in ('remote-a', 'remote-b'):
            base = f'feature.{owner}.ssh'
            assert sql(base, owner) == ids[owner]
            identity(base, owner)
            identity(f'ui.{base}', owner, 80)
        print('PASS real ingress: DNS, same-port HTTP/SQL, aliases, conflict, stale DNS', flush=True)

        update(fixture, ['remote-a', 'local'])
        rejected('feature.port', ['remote-a', 'local'])
        rejected('ui.feature.port', ['remote-a', 'local'], 80)
        # Local has no DB: ownership MUST conflict before filtering services.
        assert database('feature.port', 'remote_a').returncode != 0
        identity('feature.local.port', 'local')
        identity('ui.feature.local.port', 'local', 80)
        update(fixture, ['remote-b'])
        before = {owner: identity(address, owner) for owner, address in PRIVATE.items()}
        for host, port in [('feature.remote-a.ssh', 3000), ('ui.feature.remote-a.ssh', 80),
                           ('feature.local.port', 3000), ('ui.feature.local.port', 80)]:
            assert http(host, port, 'POST')[0] == 503, 'removed target fell back'
        assert database('feature.remote-a.ssh', 'remote_a').returncode != 0
        assert {owner: identity(address, owner) for owner, address in PRIVATE.items()} == before
        identity('feature.port', 'remote-b')
        assert sql('feature.port', 'remote-b') == ids['remote-b']
        print('PASS local ownership conflict and removed targets fail closed; counters unchanged', flush=True)
    finally:
        failures = []
        for process in reversed(processes):
            try:
                stop(process)
            except Exception as exc:
                failures.append(type(exc).__name__)
        if failures:
            raise RuntimeError('process cleanup failed: ' + ', '.join(failures))


if __name__ == '__main__':
    main()
