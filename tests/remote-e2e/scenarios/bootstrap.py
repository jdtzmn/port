#!/usr/bin/env python3
"""Real SSH discovery, automatic remote routing, and conflict acceptance scenarios."""
import errno
import http.client
import json
import ipaddress
import re
import sys
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import socket
import ssl
import subprocess
import tempfile
import stat
import time
import uuid
from baseline import psql


def wait_for_database(host, database):
    end = time.monotonic() + 45
    last = None
    while time.monotonic() < end:
        result = psql(
            host,
            database,
            query=('SELECT current_database(), inet_server_port(), '
                   '(SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())'),
        )
        try:
            require(result.returncode == 0, result.stderr[-2048:])
            require('SSL connection (protocol: TLS' in result.stdout, result.stdout[-2048:])
            fields = result.stdout.strip().splitlines()[-1].split('|')
            require(
                fields == [database, '5432', 'f'],
                f'automatic PostgreSQL reached the wrong backend: {fields}',
            )
            return
        except RuntimeError as error:
            last = error
            time.sleep(0.2)
    raise RuntimeError(f'automatic PostgreSQL route did not become ready for {host}: {last}')


def websocket_attempt(host, port):
    program = '''
const url = process.argv.at(-1)
const messages = []
const timer = setTimeout(() => process.exit(1), 5000)
const socket = new WebSocket(url)
socket.onerror = () => process.exit(1)
socket.onmessage = event => {
  messages.push(String(event.data))
  if (messages.length === 1) socket.send('port-websocket-probe')
  else {
    clearTimeout(timer)
    console.log(JSON.stringify(messages))
    socket.close()
  }
}
'''
    return subprocess.run(
        ['/usr/local/bin/bun', '-e', program, f'ws://{host}:{port}/ws'],
        env={'PATH': os.environ['PATH'], 'HOME': '/tmp/bootstrap-empty-home', 'LC_ALL': 'C'},
        text=True,
        capture_output=True,
        timeout=7,
    )


def websocket_messages(host, port, machine):
    result = websocket_attempt(host, port)
    expected = [
        f'{machine}-product-runtime-ws-ready',
        f'{machine}-product-runtime-ws-echo:port-websocket-probe',
    ]
    require(
        result.returncode == 0,
        f'WebSocket route unavailable for {host}: exit={result.returncode}; '
        f'stdout={result.stdout[-1024:]!r}; stderr={result.stderr[-1024:]!r}',
    )
    require(
        json.loads(result.stdout) == expected,
        f'WebSocket route reached the wrong endpoint for {host}: '
        f'stdout={result.stdout[-1024:]!r}; stderr={result.stderr[-1024:]!r}',
    )


def wait_for_websocket_ready(host, port, machine, timeout=45):
    end = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < end:
        try:
            websocket_messages(host, port, machine)
            return
        except (RuntimeError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(0.1)
    runtime_diagnostics()
    raise RuntimeError(f'WebSocket route readiness timed out for {host}: {last_error}')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class LocalShell:
    def __init__(self):
        self.output = b""
        self.status = None
        self.closed = False
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp("bash", ["bash", "--noprofile", "--norc", "-i"])

    def send(self, text):
        os.write(self.fd, text.encode())

    def marker(self, command, check=None, timeout=20):
        marker = "BOOTSTRAP_" + uuid.uuid4().hex
        # Split the token so even a wrapped/echoed command cannot match it.
        self.send(command + " && printf '\\n%s%s\\n' '" + marker[:16] + "' '" + marker[16:] + "'\n")

        def completed():
            if check is not None:
                check()
            return marker.encode() in self.output.replace(b"\r", b"").split(b"\n")

        self.wait_for(completed, timeout=timeout)

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


    def abort(self):
        if self.closed:
            return
        try:
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            end = time.monotonic() + 2
            while time.monotonic() < end:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    self.status = os.waitstatus_to_exitcode(status)
                    return
                time.sleep(0.05)
            raise RuntimeError("could not reap aborted local shell")
        finally:
            self.closed = True
            os.close(self.fd)
    def close(self):
        if self.closed:
            return
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
            self.closed = True
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
    http_component(shell, directory)
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


def http_component(shell, directory):
    """Explicit real HTTP wiring from discovered metadata, not a coordinator gate."""
    diagnostics = tempfile.TemporaryFile()
    helper = subprocess.Popen(
        ['/usr/local/bin/bun', '/opt/port/fixtures/proxy-probe.js', str(directory)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostics, bufsize=0,
    )
    assert helper.stdin is not None
    try:
        ready = json.loads(bounded_line(helper, timeout=45))
        require(isinstance(ready, dict) and set(ready) == {'status', 'address', 'port'},
                'unexpected HTTP component response')
        require(ready['status'] == 'ready' and type(ready['port']) is int
                and 0 < ready['port'] <= 65535, 'invalid HTTP component listener')
        address = ipaddress.IPv4Address(ready['address'])
        require(any(address in ipaddress.IPv4Network(cidr) for cidr in
                    ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')),
                'HTTP relay is not private')
        end = time.monotonic() + 10
        for host, port in [('ui.feature.port', 80), ('feature.port', 3000),
                           ('ui.feature.remote-a.ssh', 80), ('feature.remote-a.ssh', 3000)]:
            require(socket.gethostbyname(host) == '127.0.0.1', 'component DNS did not resolve locally')
            while True:
                remaining = end - time.monotonic()
                require(remaining > 0, 'HTTP component readiness timed out')
                connection = http.client.HTTPConnection(host, port, timeout=min(1, remaining))
                try:
                    # Actual hostname resolution and default Host header, no IP/Host override.
                    connection.request('GET', '/')
                    response = connection.getresponse()
                    body = response.read(1024)
                    if response.status == 200 and body == b'remote-a-snapshot-fixture':
                        break
                except (OSError, http.client.HTTPException):
                    pass
                finally:
                    connection.close()
                time.sleep(0.05)
        # Fixture-only generated certificate: prove SNI routing, not public trust.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        for host in ('feature.port', 'feature.remote-a.ssh'):
            connection = http.client.HTTPSConnection(host, 3000, timeout=3, context=context)
            try:
                connection.request('GET', '/')
                response = connection.getresponse()
                require(response.status == 200 and response.read(1024) == b'remote-a-snapshot-fixture',
                        'compiled TLS/SNI route reached the wrong endpoint')
            finally:
                connection.close()
        print('PASS compiled HTTP/TLS-SNI route configuration through actual Traefik', flush=True)
        # A local client is NOT the inspected Traefik peer, even on the bridge gateway.
        try:
            with socket.create_connection((ready['address'], ready['port']), timeout=2) as direct:
                direct.settimeout(2)
                direct.sendall(b'GET / HTTP/1.0\r\n\r\n')
                require(direct.recv(1024) == b'', 'relay accepted a non-Traefik peer')
        except (ConnectionResetError, BrokenPipeError):
            pass
        # A mutating positive control must reach the original workload exactly once.
        connection = http.client.HTTPConnection('feature.port', 3000, timeout=3)
        try:
            connection.request('POST', '/cgi-bin/sentinel', body=b'port-stale-sentinel')
            response = connection.getresponse()
            require(response.status == 200 and response.read(1024) == b'accepted',
                    'sentinel positive control failed')
        finally:
            connection.close()
        shell.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js verify-count')

        def command(value, timeout=10):
            assert helper.stdin is not None
            helper.stdin.write((value + '\n').encode())
            helper.stdin.flush()
            return json.loads(bounded_line(helper, timeout=timeout))

        for phase in ('plaintext', 'wrong-tls'):
            require(command(phase) == dict(status=phase, address=ready['address'], port=ready['port']),
                    'replacement did not bind the original backend tuple')
            # Fresh requests retry each default/qualified root route, HTTP and HTTPS.
            # Public fixture trust alone is disabled; backend verification stays pinned.
            phase_end = time.monotonic() + 20
            for _ in range(2):
                for host in ('feature.port', 'feature.remote-a.ssh'):
                    for secure in (False, True):
                        remaining = phase_end - time.monotonic()
                        require(remaining > 0, 'stale backend phase timed out')
                        if secure:
                            connection = http.client.HTTPSConnection(
                                host, 3000, timeout=min(2, remaining), context=context)
                        else:
                            connection = http.client.HTTPConnection(host, 3000, timeout=min(2, remaining))
                        try:
                            connection.request('POST', '/cgi-bin/sentinel', body=b'port-stale-sentinel')
                            response = connection.getresponse()
                            require(not 200 <= response.status < 300,
                                    'stale backend accepted sentinel POST')
                            response.read(1024)
                        except (OSError, http.client.HTTPException):
                            pass
                        finally:
                            connection.close()
            counters = command(phase + '-stats')
            require(set(counters) == {'status', 'connections', 'applicationHits', 'sentinelHits'}
                    and counters['status'] == phase + '-stats'
                    and type(counters['connections']) is int and counters['connections'] > 0
                    and counters['applicationHits'] == 0 and counters['sentinelHits'] == 0,
                    'replacement received application payload or no connection attempts')
            # This goes through the SAME original remote SSH login, not broken Traefik.
            shell.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js verify-count')
            print('PASS stale backend ' + phase + ': connections=' + str(counters['connections'])
                  + ' applicationHits=0 sentinelHits=0 originalCount=1', flush=True)
        require(command('guards', timeout=25) == {'status': 'guards'},
                'unready backend guards did not acknowledge publication')
        # Real Traefik's verified Go TLS client must reach all four direct TLS guards.
        # A stale 502 is not readiness: require the production guard's JSON 503.
        guard_end = time.monotonic() + 15
        for host, port in [('ui.feature.port', 80), ('feature.port', 3000),
                           ('ui.feature.remote-a.ssh', 80), ('feature.remote-a.ssh', 3000)]:
            while True:
                remaining = guard_end - time.monotonic()
                require(remaining > 0, 'unready backend guard reload timed out')
                connection = http.client.HTTPConnection(host, port, timeout=min(1, remaining))
                try:
                    connection.request('POST', '/cgi-bin/sentinel', body=b'port-stale-sentinel')
                    response = connection.getresponse()
                    body = response.read(4096)
                    if response.status == 503 and json.loads(body).get('status') == 'unavailable':
                        break
                except (OSError, http.client.HTTPException, ValueError):
                    pass
                finally:
                    connection.close()
                time.sleep(0.05)
        # HTTP readiness establishes reload completion before testing TCP guards.
        for host in ('feature.port', 'feature.remote-a.ssh'):
            connection = http.client.HTTPSConnection(host, 3000, timeout=3, context=context)
            try:
                connection.request('POST', '/cgi-bin/sentinel', body=b'port-stale-sentinel')
                connection.getresponse()
            except (OSError, http.client.HTTPException):
                pass
            else:
                raise RuntimeError('TLS/SNI unready guard returned an HTTP response')
            finally:
                connection.close()
        shell.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js verify-count')
        print('PASS unready backend guards: four HTTP JSON 503 unavailable routes; '
              'TLS/SNI roots reject without response; originalCount=1', flush=True)
        helper.stdin.write(b'close\n')
        helper.stdin.flush()
        require(json.loads(bounded_line(helper, timeout=15)) == {'status': 'closed'},
                'HTTP component did not close')
        require(helper.wait(timeout=3) == 0, 'HTTP component helper failed')
        shell.marker('test -t 0 && test "$(id -un)" = fixture && true')
        print('PASS actual HTTP component: DNS -> nested Traefik -> peer-filtered relay -> '
              'openRemoteStream -> discovered remote-a Docker workload (four URL forms); '
              'non-Traefik peer rejected; original login preserved', flush=True)
    finally:
        # Give the helper its bounded owned-resource cleanup before forced process reaping.
        if helper.poll() is None:
            try:
                helper.stdin.write(b'close\n')
                helper.stdin.flush()
                helper.wait(timeout=15)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                pass
        stop_process(helper)
        diagnostics.close()


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
        require(ready['status'] == 'ready' and isinstance(ready['address'], str)
                and re.fullmatch(r'/tmp/port-stream-query-[A-Za-z0-9]{6}', ready['address']) is not None
                and type(ready['port']) is int and ready['port'] == 5432,
                'invalid private stream listener')
        query_directory = Path(ready['address'])
        info = query_directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'query directory is not private and owned')
        # Plain libpq is ONLY inside the encrypted private SSH transport, never
        # the shared-hostname Traefik baseline or public plaintext support (#149).
        database = subprocess.Popen(
            ['psql', '-X', '-w', '-A', '-t', '-F', '|',
             f'host={query_directory} port=5432 user=postgres dbname=remote_a '
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
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(2)
            try:
                connection.connect(str(query_directory / '.s.PGSQL.5432'))
            except OSError as exc:
                require(exc.errno in (errno.ENOENT, errno.ECONNREFUSED),
                        'unexpected private stream connection failure after close')
            else:
                raise RuntimeError('private stream listener survived close')
        require(not query_directory.exists(), 'private stream query directory survived close')
        # Cancellation must leave the SAME interactive master/login usable.
        shell.marker('test -t 0 && test "$(id -un)" = fixture && true')
        print('PASS private Unix transport component: actual openRemoteStream -> remote_a SQL; '
              'idempotent cancel refuses new connections and preserves login', flush=True)
    finally:
        # Allow bounded owned-stream cleanup before escalating to process reaping.
        if helper.poll() is None and helper.stdin is not None:
            try:
                helper.stdin.write(b'close\n')
                helper.stdin.flush()
                helper.wait(timeout=10)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                pass
        stop_process(helper)


def runtime_diagnostics():
    state = Path('/root/.port/remote')
    controls = list(Path('/tmp').glob('port-remote-*'))
    processes = {'supervisor': 0, 'runtime': 0}
    for cmdline in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            value = cmdline.read_bytes()
        except OSError:
            continue
        for name, token in [('supervisor', b'__remote-supervise'), ('runtime', b'__remote-runtime')]:
            if token in value:
                processes[name] += 1
    container = 'missing'
    try:
        result = subprocess.run(
            ['docker', 'inspect', '--type', 'container', '--format', '{{.State.Status}}', 'port-traefik'],
            check=False, capture_output=True, timeout=5, text=True,
        )
        if result.returncode == 0 and result.stdout.strip() in ('created', 'running', 'exited', 'dead'):
            container = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    print('RUNTIME_DIAGNOSTICS=' + json.dumps({
        'marker': (state / 'enabled.json').is_file(),
        'catalog': (state / 'sessions.jsonl').is_file(),
        'checkpoint': (state / 'checkpoint.json').is_file(),
        'routes': Path('/root/.port/traefik/dynamic/port-remote-routes.yml').is_file(),
        'control': any((path / 'endpoint.json').is_file() for path in controls),
        'processes': processes,
        'traefik': container,
    }, sort_keys=True), flush=True)


def wait_for_fixture_stats(host, owner, branch, port=80, timeout=45):
    end = time.monotonic() + timeout
    last = None
    while time.monotonic() < end:
        remaining = end - time.monotonic()
        connection = http.client.HTTPConnection(host, port, timeout=min(2, remaining))
        try:
            connection.request('GET', '/__fixture/stats')
            response = connection.getresponse()
            body = response.read(2048)
            if response.status == 200:
                payload = json.loads(body)
                if payload.get('owner') == owner and payload.get('branch') == branch:
                    return payload
                last = payload
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as error:
            last = str(error)
        finally:
            connection.close()
        time.sleep(0.1)
    runtime_diagnostics()
    raise RuntimeError(f'fixture stats timed out for {host}: {last!r}')

def route_fixture_stats(host, port=3100):
    connection = http.client.HTTPConnection(host, port, timeout=3)
    try:
        connection.request('GET', '/__fixture/stats')
        response = connection.getresponse()
        body = response.read(2048)
        require(response.status == 200, f'fixture stats route failed for {host}: {response.status}')
        payload = json.loads(body)
        require(isinstance(payload, dict) and isinstance(payload.get('counters'), dict),
                f'invalid fixture stats for {host}: {body[:256]!r}')
        return payload
    finally:
        connection.close()

def database_sessions(host, database):
    result = psql(
        host,
        database,
        query='SELECT pg_stat_force_next_flush(); SELECT COALESCE(sum(sessions), 0) FROM pg_stat_database',
    )
    require(result.returncode == 0, f'could not read PostgreSQL session counter for {host}: {result.stderr[-1024:]}')
    try:
        return int(result.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        raise RuntimeError(f'invalid PostgreSQL session counter for {host}: {result.stdout[-1024:]!r}') from None

def product_runtime_port(shell, owner, branch):
    matches = re.findall(
        rb'^PRODUCT_RUNTIME=(\{[^\n]+\})$',
        shell.output.replace(b'\r', b''),
        re.MULTILINE,
    )
    for encoded in reversed(matches):
        try:
            runtime = json.loads(encoded)
        except json.JSONDecodeError:
            continue
        ui = runtime.get('ui') if isinstance(runtime, dict) else None
        if (
            runtime.get('owner') == owner
            and runtime.get('branch') == branch
            and isinstance(ui, dict)
            and type(ui.get('publishedPort')) is int
        ):
            return ui['publishedPort']
    raise RuntimeError(f'missing published UI port for {owner}/{branch}')

def port_command(*args, cwd=None, timeout=15):
    result = subprocess.run(
        ['/usr/local/bin/port', *args],
        cwd=cwd,
        env={'PATH': os.environ['PATH'], 'HOME': '/root', 'LC_ALL': 'C'},
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    output = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout + result.stderr)
    require(
        result.returncode == 0,
        f'port {" ".join(args)} failed: exit={result.returncode}; output={output[-2048:]!r}',
    )
    return output

def automatic_runtime(shell, machine):
    before = session_directories()
    shell.marker(
        'SHELL=/bin/bash command port install --remote-services --shell-hook-only --yes '
        '>/tmp/remote-install.log && eval "$(command port shell-hook bash)"; declare -F ssh >/dev/null',
        timeout=60,
    )
    shell.send(f'ssh {machine}\n')
    shell.marker('test -t 0 && test "$(id -un)" = fixture')
    shell.wait_for(lambda: any((path / 'handshake.json').exists() for path in session_directories() - before))
    directory = private_session(before)
    shell.marker(
        f'/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js product-start {machine}',
        timeout=90,
    )
    shell.marker(
        f'/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js '
        f'product-start {machine} sibling ui-only',
        timeout=90,
    )

    expected = f'{machine}-product-runtime'.encode()
    routes = [
        ('ui.feature.port', 80),
        ('feature.port', 3100),
        (f'ui.feature.{machine}.ssh', 80),
        (f'feature.{machine}.ssh', 3100),
    ]
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    end = time.monotonic() + 45
    for host, port in routes:
        require(socket.gethostbyname(host) == '127.0.0.1', 'automatic route DNS did not resolve locally')
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0:
                runtime_diagnostics()
                raise RuntimeError('automatic route publication timed out')
            connection = http.client.HTTPConnection(host, port, timeout=min(2, remaining))
            try:
                connection.request('GET', '/')
                response = connection.getresponse()
                if response.status == 200 and response.read(1024) == expected:
                    break
            except (OSError, http.client.HTTPException):
                pass
            finally:
                connection.close()
            time.sleep(0.1)
    sibling_port = product_runtime_port(shell, machine, 'sibling')
    for host in ('sibling.port', f'sibling.{machine}.ssh'):
        require(socket.gethostbyname(host) == '127.0.0.1', 'sibling route DNS did not resolve locally')
        stats = wait_for_fixture_stats(host, machine, 'sibling', port=sibling_port)
        require(
            stats.get('profile') == 'ui-only' and stats.get('service') == 'ui',
            f'sibling worktree route did not preserve its service profile: {stats!r}',
        )
    remote_urls = port_command('urls', '--remote')
    require(
        'feature.port' in remote_urls and 'sibling.port' in remote_urls,
        f'port urls --remote omitted a live remote worktree: {remote_urls[-2048:]!r}',
    )
    for host in ('feature.port', f'feature.{machine}.ssh'):
        connection = http.client.HTTPSConnection(host, 3100, timeout=3, context=context)
        try:
            connection.request('GET', '/')
            response = connection.getresponse()
            require(response.status == 200 and response.read(1024) == expected,
                    'automatic TLS/SNI route reached the wrong endpoint')
        finally:
            connection.close()
    for host in ('feature.port', f'feature.{machine}.ssh'):
        wait_for_websocket_ready(host, 3100, machine)
        websocket_messages(host, 3100, machine)
    database = f'{machine.replace("-", "_")}_automatic'
    wait_for_database('feature.port', database)
    wait_for_database(f'feature.{machine}.ssh', database)
    connection = http.client.HTTPConnection('feature.port', 3100, timeout=3)
    try:
        connection.request('POST', '/cgi-bin/sentinel', body=b'port-runtime-sentinel')
        response = connection.getresponse()
        body = response.read(1024)
        require(
            response.status == 200 and body == b'accepted',
            f'automatic route sentinel failed: status={response.status} body={body[:128]!r}',
        )
    finally:
        connection.close()
    connection = http.client.HTTPConnection('feature.port', 3100, timeout=3)
    try:
        connection.request('GET', '/cgi-bin/sentinel')
        response = connection.getresponse()
        require(
            response.status == 200 and response.read(1024) == b'1',
            'automatic route did not preserve exactly one sentinel mutation',
        )
    finally:
        connection.close()
    shell.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js product-stop', timeout=90)

    end = time.monotonic() + 30
    while True:
        remaining = end - time.monotonic()
        require(remaining > 0, 'removed automatic route retained the old backend')
        connection = http.client.HTTPConnection('feature.port', 3100, timeout=min(2, remaining))
        try:
            connection.request('GET', '/')
            response = connection.getresponse()
            stale = response.status == 200 and response.read(1024) == expected
            if not stale:
                break
        except (OSError, http.client.HTTPException):
            break
        finally:
            connection.close()
        time.sleep(0.1)
    shell.send('exit 17\n')
    shell.wait_for(lambda: not directory.exists(), timeout=45)
    shell.marker('test "$?" -eq 17')
    require(session_directories() == before, 'automatic runtime login leaked session state')
    print(
        f'PASS {machine}: ordinary SSH -> port up -> automatic HTTP/TLS-SNI routing; removal and status 17 preserved',
        flush=True,
    )

def concurrent_owners():
    before_a = session_directories()
    shell_a = LocalShell()
    shell_b = LocalShell()
    try:
        shell_a.marker(
            'SHELL=/bin/bash command port install --remote-services --shell-hook-only --yes '
            '>/tmp/remote-install.log && eval "$(command port shell-hook bash)"',
            timeout=60,
        )
        shell_b.marker('eval "$(port shell-hook bash --remote-services)"; declare -F ssh >/dev/null')
        shell_a.send('ssh remote-a\n')
        shell_a.marker('test -t 0 && test "$(id -un)" = fixture')
        shell_a.wait_for(lambda: len(session_directories() - before_a) == 1)
        directory_a = private_session(before_a)
        shell_a.marker(
            '/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js product-start remote-a',
            timeout=90,
        )
        before_b = session_directories()
        shell_b.send('ssh remote-b\n')
        shell_b.marker('test -t 0 && test "$(id -un)" = fixture')
        shell_b.wait_for(lambda: len(session_directories() - before_b) == 1)
        directory_b = private_session(before_b)
        shell_b.marker(
            '/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js product-start remote-b',
            timeout=90,
        )

        def request(host, port, method='GET', path=None):
            connection = http.client.HTTPConnection(host, port, timeout=3)
            try:
                body = b'port-runtime-sentinel' if method == 'POST' else None
                if path is None:
                    path = '/cgi-bin/sentinel' if method == 'POST' else '/'
                connection.request(method, path, body=body)
                response = connection.getresponse()
                return response.status, response.read(1024)
            finally:
                connection.close()

        end = time.monotonic() + 45
        while True:
            remaining = end - time.monotonic()
            require(remaining > 0, 'simultaneous owner conflict publication timed out')
            try:
                status, body = request('ui.feature.port', 80)
                if status == 409:
                    conflict = json.loads(body)
                    candidates = conflict.get('candidates', [])
                    addresses = {item.get('hostname') for item in candidates}
                    require(
                        addresses == {'ui.feature.remote-a.ssh', 'ui.feature.remote-b.ssh'},
                        f'conflict alternatives were not explicit: {conflict!r}',
                    )
                    break
            except (OSError, http.client.HTTPException, json.JSONDecodeError):
                pass
            time.sleep(0.1)

        for machine in ('remote-a', 'remote-b'):
            status, body = request(f'ui.feature.{machine}.ssh', 80)
            require(
                status == 200 and body == f'{machine}-product-runtime'.encode(),
                f'qualified route did not reach {machine}: status={status} body={body[:128]!r}',
            )
            status, body = request(f'feature.{machine}.ssh', 3100, 'POST')
            require(status == 200 and body == b'accepted', 'qualified sentinel mutation failed')


        # A successful HTTP request only proves publication of the HTTP backend. Wait
        # for each WebSocket relay independently before its final one-shot assertion.
        for machine in ('remote-a', 'remote-b'):
            wait_for_websocket_ready(f'feature.{machine}.ssh', 3100, machine)

        websocket_counters = {
            machine: route_fixture_stats(f'feature.{machine}.ssh')['counters']
            for machine in ('remote-a', 'remote-b')
        }
        conflict_websocket = websocket_attempt('feature.port', 3100)
        require(
            conflict_websocket.returncode != 0,
            'ambiguous WebSocket route reached an application backend',
        )
        for machine in ('remote-a', 'remote-b'):
            counters = route_fixture_stats(f'feature.{machine}.ssh')['counters']
            require(
                counters['websocketOpens'] == websocket_counters[machine]['websocketOpens']
                and counters['websocketMessages'] == websocket_counters[machine]['websocketMessages'],
                f'ambiguous WebSocket route contacted {machine}',
            )
        for machine in ('remote-a', 'remote-b'):
            websocket_messages(f'feature.{machine}.ssh', 3100, machine)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        def tls_request(host, path='/'):
            connection = http.client.HTTPSConnection(host, 3100, timeout=3, context=context)
            try:
                connection.request('GET', path)
                response = connection.getresponse()
                return response.status, response.read(1024)
            finally:
                connection.close()

        tls_counters = {
            machine: route_fixture_stats(f'feature.{machine}.ssh')['counters']
            for machine in ('remote-a', 'remote-b')
        }
        try:
            tls_request('feature.port', '/__fixture/probe/tls')
            raise RuntimeError('ambiguous TLS/SNI route reached an application response')
        except (OSError, http.client.HTTPException):
            pass
        for machine in ('remote-a', 'remote-b'):
            counters = route_fixture_stats(f'feature.{machine}.ssh')['counters']
            require(
                counters['tlsProbeRequests'] == tls_counters[machine]['tlsProbeRequests'],
                f'ambiguous TLS/SNI route contacted {machine}',
            )
        for machine in ('remote-a', 'remote-b'):
            status, body = tls_request(f'feature.{machine}.ssh')
            require(
                status == 200 and body == f'{machine}-product-runtime'.encode(),
                f'qualified TLS/SNI route did not reach {machine}: status={status} body={body[:128]!r}',
            )
        for machine in ('remote-a', 'remote-b'):
            database = f'{machine.replace("-", "_")}_automatic'
            wait_for_database(f'feature.{machine}.ssh', database)
        database_sessions_before = {}
        for machine in ('remote-a', 'remote-b'):
            database = f'{machine.replace("-", "_")}_automatic'
            first = database_sessions(f'feature.{machine}.ssh', database)
            second = database_sessions(f'feature.{machine}.ssh', database)
            require(second == first + 1, f'PostgreSQL session counter is not monotonic for {machine}')
            database_sessions_before[machine] = second
        conflict_database = psql('feature.port', 'remote_a_automatic')
        require(
            conflict_database.returncode != 0,
            'ambiguous PostgreSQL TLS/SNI route reached an application backend',
        )
        for machine in ('remote-a', 'remote-b'):
            database = f'{machine.replace("-", "_")}_automatic'
            sessions = database_sessions(f'feature.{machine}.ssh', database)
            require(
                sessions == database_sessions_before[machine] + 1,
                f'ambiguous PostgreSQL route contacted {machine}',
            )
        status, _ = request('feature.port', 3100, 'POST')
        require(status == 409, 'ambiguous POST did not fail closed')
        for machine in ('remote-a', 'remote-b'):
            status, body = request(f'feature.{machine}.ssh', 3100, 'GET', '/cgi-bin/sentinel')
            require(
                status == 200 and body == b'1',
                f'qualified route did not preserve one sentinel mutation for {machine}: '
                f'status={status} body={body[:128]!r}',
            )

        shell_b.send('exit 19\n')
        shell_b.wait_for(lambda: not directory_b.exists())
        shell_b.marker('test "$?" -eq 19')
        end = time.monotonic() + 30
        while True:
            remaining = end - time.monotonic()
            require(remaining > 0, 'surviving owner did not recover default route')
            try:
                status, body = request('ui.feature.port', 80)
                if status == 200 and body == b'remote-a-product-runtime':
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(0.1)
        wait_for_websocket_ready('feature.port', 3100, 'remote-a')
        websocket_messages('feature.port', 3100, 'remote-a')
        disconnected_websocket = websocket_attempt('feature.remote-b.ssh', 3100)
        require(
            disconnected_websocket.returncode != 0,
            'disconnected qualified WebSocket owner was retargeted',
        )
        wait_for_database('feature.port', 'remote_a_automatic')
        disconnected_database = psql('feature.remote-b.ssh', 'remote_b_automatic')
        require(
            disconnected_database.returncode != 0,
            'disconnected qualified PostgreSQL owner was retargeted',
        )
        status, body = tls_request('feature.port')
        require(
            status == 200 and body == b'remote-a-product-runtime',
            f'surviving owner did not recover default TLS/SNI route: status={status} body={body[:128]!r}',
        )
        try:
            tls_request('feature.remote-b.ssh')
            raise RuntimeError('disconnected explicit TLS/SNI owner was retargeted')
        except (OSError, http.client.HTTPException):
            pass
        status, _ = request('ui.feature.remote-b.ssh', 80)
        require(
            status == 503,
            f'disconnected explicit owner was retargeted: status={status} body={_[:128]!r}',
        )

        shell_a.marker('/usr/local/bin/bun /opt/port/fixtures/snapshot-workload.js product-stop', timeout=90)
        shell_a.send('exit 17\n')
        shell_a.wait_for(lambda: not directory_a.exists())
        shell_a.marker('test "$?" -eq 17')
        require(session_directories() == before_a, 'concurrent owner test leaked session state')
        print('PASS simultaneous remote owners: conflict alternatives, qualified routes, POST isolation, and disconnect recovery', flush=True)
    finally:
        shell_a.close()
        shell_b.close()


def missing_port_only():
    before = session_directories()
    shell = LocalShell()
    try:
        shell.marker('eval "$(port shell-hook bash --remote-services)"; declare -F ssh >/dev/null')
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
    finally:
        shell.close()


def configure_ssh():
    shutil.copyfile('/fixture/ssh_config', '/root/.ssh/config')
    os.chmod('/root/.ssh/config', 0o600)


def automatic_runtime_only(machine):
    configure_ssh()
    shell = LocalShell()
    try:
        automatic_runtime(shell, machine)
    finally:
        shell.close()
        print(f'--- {machine} automatic runtime PTY (last 16 KiB) ---', flush=True)
        print(shell.output.decode(errors='replace'), flush=True)


def concurrent_owners_only():
    configure_ssh()
    concurrent_owners()


def main(include_product_scenarios=True):
    # Install the fixture's normal SSH config, not command-specific test options.
    configure_ssh()
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
        if include_product_scenarios:
            automatic_runtime(shell, 'remote-a')
            automatic_runtime(shell, 'remote-b')
            concurrent_owners()

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
            shell.wait_for(
                lambda: any(
                    line.endswith(b'$ ')
                    for line in shell.output.replace(b'\r', b'').split(b'\n')
                )
            )
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
    if sys.argv[1:] == ['--missing-port-only']:
        missing_port_only()
    elif sys.argv[1:] == ['--foundation-only']:
        main(include_product_scenarios=False)
    elif sys.argv[1:] == ['--automatic-runtime', 'remote-a']:
        automatic_runtime_only('remote-a')
    elif sys.argv[1:] == ['--automatic-runtime', 'remote-b']:
        automatic_runtime_only('remote-b')
    elif sys.argv[1:] == ['--concurrent-owners']:
        concurrent_owners_only()
    elif len(sys.argv) == 1:
        main()
    else:
        raise RuntimeError('invalid arguments')
