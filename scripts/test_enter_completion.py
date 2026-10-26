"""Exercise real `port enter` shutdown under fish in disposable repositories.

Run: python3 -B -m unittest discover -s scripts -p test_enter_completion.py -v
Requires fish, git, bun, and an installed port. No Docker or user hooks are used.
Both the source CLI and installed CLI must finish new/existing-worktree enters,
apply fish's directory change, and run the next chained command. Five new
worktrees and five re-enters are exercised per case, with terminal stdin open.
"""

import os
import pathlib
import runpy
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
probe = runpy.run_path(str(ROOT / "scripts/repro-command-hang.py"))["probe"]


def fish_quote(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


class EnterCompletionTests(unittest.TestCase):
    def exercise(self, runtime, with_hook):
        (ROOT / ".pi").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="enter-exit-", dir=ROOT / ".pi") as directory:
            fixture = pathlib.Path(directory)
            repo = fixture / "repo with spaces"
            repo.mkdir()
            (repo / ".gitignore").write_text(".port/trees/\n.port/logs/\n")
            (repo / "README.md").write_text("Disposable enter completion test\n")
            (repo / ".port").mkdir()
            (repo / ".port/config.jsonc").write_text("{}\n")
            if with_hook:
                hooks = repo / ".port/hooks"
                hooks.mkdir()
                hook = hooks / "post-create.sh"
                hook.write_text("#!/bin/sh\necho POST_CREATE_FINISHED\ntouch hook-ran\n")
                hook.chmod(0o755)

            def git(*args):
                subprocess.run(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=repo,
                               check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            git("init", "-b", "main")
            git("config", "core.hooksPath", "/dev/null")
            git("add", ".")
            git("-c", "user.name=Port test", "-c", "user.email=test@example.invalid",
                "-c", "commit.gpgsign=false", "commit", "-m", "Create test fixture")
            bin_dir = fixture / "bin"
            bin_dir.mkdir()
            executable = bin_dir / "port"
            if runtime == "source":
                executable.write_text("#!/bin/sh\nexec bun " +
                                      shlex.quote(str(ROOT / "src/index.ts")) + ' "$@"\n')
                executable.chmod(0o755)
            else:
                installed = shutil.which("port")
                self.assertIsNotNone(installed, "An installed port is required for comparison")
                executable.symlink_to(installed)

            script = f"""
                cd {fish_quote(repo)}; or exit 1
                port shell-hook fish | source; or exit 1
                functions -q port; or exit 1
                for n in (seq 1 5)
                    port enter diagnostic-$n; or exit 1
                    test "$PORT_WORKTREE" = diagnostic-$n; or exit 1
                    test "$PWD" = {fish_quote(repo)}/.port/trees/diagnostic-$n; or exit 1
                    port enter diagnostic-$n; or exit 1
                    {"test -f hook-ran; or exit 1" if with_hook else "true"}
                end
                echo CHAIN_FINISHED
            """
            code, output = probe([
                "env", f"PATH={bin_dir}:{os.environ['PATH']}",
                f"PORT_GLOBAL_DIR={fixture / 'global'}",
                "fish", "--no-config", "-c", script,
            ], 30)
            self.assertEqual(code, 0, output.decode(errors="replace"))
            self.assertIn(b"CHAIN_FINISHED", output)

    def test_source_without_hook(self):
        self.exercise("source", False)

    def test_source_with_post_create_hook(self):
        self.exercise("source", True)

    def test_installed_without_hook(self):
        self.exercise("installed", False)

    def test_installed_with_post_create_hook(self):
        self.exercise("installed", True)


if __name__ == "__main__":
    unittest.main()
