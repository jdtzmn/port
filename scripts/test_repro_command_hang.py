"""Self-tests: python3 -m unittest discover -s scripts -p 'test_repro_command_hang.py'."""

import pathlib
import runpy
import sys
import unittest

probe = runpy.run_path(str(pathlib.Path(__file__).with_name("repro-command-hang.py")))["probe"]


class TerminalCompletionTests(unittest.TestCase):
    def run_python(self, code, timeout=2):
        return probe([sys.executable, "-c", code], timeout)

    def test_exits_with_a_controlling_terminal_and_open_stdin(self):
        code, output = self.run_python(
            "import os; assert all(os.isatty(fd) for fd in (0, 1, 2)); "
            "assert os.tcgetpgrp(0) == os.getpgrp(); print('FINISHED', flush=True)"
        )
        self.assertEqual(code, 0)
        self.assertIn(b"FINISHED", output)

    def test_preserves_failure_exit_code(self):
        code, _ = self.run_python("raise SystemExit(7)")
        self.assertEqual(code, 7)

    def test_detects_completed_output_but_live_process(self):
        code, output = self.run_python(
            "print('COMMAND_COMPLETED', flush=True); input()", timeout=0.3
        )
        self.assertEqual(code, 124)
        self.assertIn(b"COMMAND_COMPLETED", output)

    def test_terminal_eof_does_not_count_as_process_exit(self):
        code, _ = self.run_python(
            "import os, time; [os.close(fd) for fd in (0, 1, 2)]; time.sleep(30)",
            timeout=0.3,
        )
        self.assertEqual(code, 124)


if __name__ == "__main__":
    unittest.main()
