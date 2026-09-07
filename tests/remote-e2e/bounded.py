#!/usr/bin/env python3
"""Run a command with a deadline and a bounded, permission-restricted log tail."""
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

LIMIT = 64 * 1024


def interrupt(signum, _frame):
    raise SystemExit(128 + signum)


def main():
    seconds, destination, *command = sys.argv[1:]
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    tail = bytearray()
    process = subprocess.Popen(command, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.monotonic() + float(seconds)
    status = 1
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    tail.extend(b"\nCommand exceeded deadline\n")
                    status = 124
                    break
                for key, _ in selector.select(min(remaining, 0.2)):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        tail.extend(chunk)
                        del tail[:-LIMIT]
            else:
                try:
                    status = process.wait(timeout=max(0.01, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    tail.extend(b"\nCommand exceeded deadline\n")
                    status = 124
    finally:
        # Kill the whole local command group, including grandchildren holding
        # stdout open. Compose down separately removes daemon-side containers.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        process.stdout.close()
        Path(destination).write_bytes(tail[-LIMIT:])
    if status:
        print(f"Command failed ({status}); bounded log: {destination}", file=sys.stderr)
    return status if status >= 0 else 128 - status


if __name__ == "__main__":
    sys.exit(main())
