"""Assert that a command exits with terminal stdin kept open (macOS/Linux).

Usage (commands run normally; prefer read-only commands or an isolated repo):
  python3 scripts/repro-command-hang.py --repeat 20 -- port list
  python3 scripts/repro-command-hang.py -- fish --no-config -c \
    'port shell-hook fish | source; port list; and echo CHAIN_FINISHED'

Unlike pipe-based smoke tests, the command has a controlling terminal and never
receives stdin EOF. Exit 124 means a hang; other failures preserve the exit code.
Only the last 8 KiB of terminal output is retained. No environment is printed.
"""

import argparse
import errno
import fcntl
import math
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def probe(command, timeout):
    pid, master = pty.fork()
    if pid == 0:
        os.environ.pop("CI", None)
        os.environ["TERM"] = "xterm-256color"
        os.execvp(command[0], command)

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
    output = b""
    status = None
    deadline = time.monotonic() + timeout
    terminal_open = True
    try:
        while True:
            # Drain output before checking exit so a quick command's final lines
            # are included. Terminal EOF alone is NOT evidence of process exit.
            if terminal_open and select.select([master], [], [], 0.02)[0]:
                try:
                    data = os.read(master, 65536)
                    terminal_open = bool(data)
                    output = (output + data)[-8192:]
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    terminal_open = False
            elif not terminal_open:
                time.sleep(0.02)

            exited, status = os.waitpid(pid, os.WNOHANG)
            if exited:
                return os.waitstatus_to_exitcode(status), output
            status = None
            if time.monotonic() >= deadline:
                return 124, output
    finally:
        if status is None:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
        os.close(master)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if not command or args.repeat < 1 or not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("provide a command, positive --repeat, and finite positive --timeout")

    for iteration in range(1, args.repeat + 1):
        code, output = probe(command, args.timeout)
        verdict = "HANG (deadline exceeded)" if code == 124 else f"EXIT {code}"
        print(f"{iteration}/{args.repeat}: {verdict}", flush=True)
        if code:
            print(output.decode(errors="replace"), end="", flush=True)
            return code if code > 0 else 128 - code
    return 0


if __name__ == "__main__":
    sys.exit(main())
