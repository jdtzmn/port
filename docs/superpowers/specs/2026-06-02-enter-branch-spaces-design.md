# Support entering worktrees with spaces in the branch name

Issue: https://github.com/jdtzmn/port/issues/114
Scope: `port enter` and the implicit `port <branch>` entry points.

## Problem

A user should be able to enter a worktree whose branch name contains spaces, in
any of these forms:

- `port enter "my feature"` (quoted, one arg)
- `port enter my feature` (bare words, multiple args)
- `port "my feature"` (implicit, quoted)
- `port my feature` (implicit, bare words)

Today this does not work end to end, for three reasons:

1. **The argument parser only captures one word.** Both
   `program.command('enter <branch>')` and the implicit catch-all
   `program.argument('[branch]')` declare a single positional. Given
   `port my feature`, Commander binds `branch = "my"` and treats `feature` as
   excess. The branch name is silently truncated.

2. **Git refs cannot contain spaces.** Even once the full name reaches the
   worktree layer, `git worktree add -b "my feature"` fails with
   `fatal: 'my feature' is not a valid branch name`. Git's ref-format rules
   forbid spaces (and `~`, `:`, `\`, control characters, etc.), so a spaced
   input cannot be used as the literal branch ref.

3. **The E2E test harness cannot pass a space.** `execPortAsync` in
   `tests/utils.ts` builds a single shell string with
   `` `bun ${cliScript()} ` + args.join(' ') `` and runs it through a shell.
   A branch arg `"my feature"` is split into two shell words, and the script
   path itself is unquoted. No faithful E2E for spaced branches can be written
   until this is fixed.

Notably, parts of the **production internals are already space-safe**:

- `sanitizeBranchName("my feature")` -> `"my-feature"` for the on-disk worktree
  directory, so the path never contains a space.
- `createWorktree` passes branch/path to `simple-git` as an argv array, so the
  branch name reaches `git worktree add` without shell splitting.
- The shell-hook eval output quotes paths/values via `posixShellQuote` /
  `fishShellQuote`, both already unit-tested for spaces.

So the fix is concentrated in **argument parsing**, **git ref resolution**, and
the **test harness**, not in the shell-eval internals.

## Approach

### 1. Variadic positional, joined with single spaces (`src/index.ts`)

- Change `enter <branch>` -> `enter <branch...>`. The action receives `string[]`;
  join with a single space and call `enter(joined)`.
- Change the implicit catch-all `.argument('[branch]')` -> `.argument('[branch...]')`.
  The action receives `string[] | undefined`; when non-empty, join with a single
  space, run the existing `isReservedCommand` check on the joined value, then call
  `enter(joined)`. When empty/undefined, keep current behavior (TUI when TTY,
  help otherwise).
- Extract a tiny pure helper
  `joinBranchArgs(parts: string[] | undefined): string | undefined` that returns
  `parts.join(' ')` (or `undefined` when empty). Joining collapses
  separately-typed words (`my   feature` as distinct argv tokens) into single
  spaces, matching natural shell behavior and the chosen UX.

The early-startup `process.argv[2]` checks (`shouldAutoRegisterWorktree`,
`maybeWarnCommandBranchCollision`, `isReservedCommand`) operate on the first
token only and remain correct: a multi-word branch's first word is not a reserved
command (and `port enter ...` routes to the `enter` subcommand regardless).

### 2. Resolve a valid git ref (`src/lib/git.ts`, `src/commands/enter.ts`)

Git forbids spaces in branch names, so the raw input cannot always be used as the
ref. Add two helpers to `git.ts`:

- `isValidBranchRef(repoRoot, branch)` — delegates to
  `git check-ref-format --branch`, the authoritative source of truth (returns
  false when git would reject the name).
- `resolveBranchRef(repoRoot, branch)` — returns the raw name when it is already a
  valid ref (e.g. `feature/auth` keeps its slash), otherwise falls back to
  `sanitizeBranchName(branch)` (`"my feature"` -> `my-feature`). The sanitized
  form is always a valid ref and matches the on-disk worktree directory name.

`createWorktree` resolves the ref internally before any branch-existence check or
`git worktree add`. The worktree **directory** is still derived independently via
`getWorktreePath` (which sanitizes), so directory naming is unchanged.

`enter.ts` resolves the ref once for its own `branchExists` / `remoteBranchExists`
checks so existence detection matches the ref that `createWorktree` will use.

`PORT_WORKTREE` and the worktree directory continue to use the sanitized name
(the worktree identity used for routing/domains) — unchanged.

### 3. Space-safe test harness (`tests/utils.ts`)

Make `execPortAsync` robust to spaces in both the CLI script path and the
arguments. Use an argv-array exec (`execFile`, no shell) so neither the script
path nor the args are subject to shell word-splitting. Preserve the existing
`{ stdout, stderr }` return shape that callers rely on. `renderCLI` already takes
an args array and is unaffected.

### 4. `enter` command notes (`src/commands/enter.ts`)

One known, acceptable limitation: `getForwardedArgs` (typo-confirmation
forwarding) is single-word oriented; it is only reached for command-like
single-word names, so multi-word branches never hit it. Documented, not changed.

## Testing

The new behavior spans the parser join and git ref resolution. Tests target both
plus one end-to-end smoke proof.

1. **Unit - `joinBranchArgs`** (colocated test for `src/index.ts`):
   - `["my","feature"]` -> `"my feature"`
   - `["my feature"]` -> `"my feature"` (already-quoted single arg)
   - `["single"]` -> `"single"`
   - `[]` / `undefined` -> `undefined`

2. **Unit - `resolveBranchRef`** (in `src/lib/git.test.ts`, real temp git repo):
   - `"my feature"` -> `"my-feature"` (invalid ref falls back to sanitized)
   - `"feature/auth"` -> `"feature/auth"` (valid ref preserved, slash kept)
   - `"simple"` -> `"simple"`

3. **Command-level unit - `src/commands/enter.command.test.ts`** (one case):
   `enter("my feature")` resolves the ref to `my-feature`, calls
   `createWorktree('/repo', 'my feature')`, and under the shell-hook eval path
   writes `cd -- '/repo/.port/trees/my-feature'`. `PORT_WORKTREE` uses the
   sanitized identity `my-feature`. Uses existing mocks.

4. **Smoke E2E - `tests/enter-spaces.test.ts`** (modeled on
   `switch-worktree.test.ts`; lightweight `simple-server` sample, no `up`/Docker):
   - `execPortAsync(['enter', 'my feature'], dir)` -> `.port/trees/my-feature`
     exists AND `git branch --list "my-feature"` shows the resolved branch.
   - `execPortAsync(['my feature'], dir)` (implicit form) creates/reuses the same
     worktree.

### Explicitly out of scope / not tested

- Spaces in the repo/worktree **filesystem path** (separate concern).
- `port up` + URL polling for a spaced branch (sanitized dir/domain already
  covered by existing up/down E2Es; spaces never reach the domain).
- Extra shell permutations (fish/zsh) - covered by existing `shell.test.ts`.

## Verification commands

- `bunx vitest run src/index.test.ts src/lib/git.test.ts src/commands/enter.command.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bunx vitest run tests/enter-spaces.test.ts` (smoke E2E; requires git)
