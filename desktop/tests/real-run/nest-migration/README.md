# Seeded-HOME proof for the .buzz to .colony nest migration

Proof harness for PR 2 (Worker M1, branch `feat/nest-migration`). The coordinator runs it on a packaged
`Buzz.app` or `Colony.app`. It cannot be run from CI: a packaged app is needed.

Nothing here opens the real home folder. Every case builds a throwaway HOME from synthetic files shaped like the
owner's real `~/.buzz` (names, kinds and modes taken from a read-only `ls -la`; no private contents read or
copied), launches the app with `HOME` pointing at it inside a `sandbox-exec` policy that denies the real
`~/.buzz`, `~/.colony`, the keychain and the shared app-data folders, and compares before and after.

## Run

```sh
cd desktop
COLONY_REAL_RUN=1 node tests/real-run/nest-migration/run.mjs \
  --app '/path/to/Buzz.app' \
  --out /Users/mac/worktrees/.lanes/phase2/real-run-20261004/nest-proof-<name> \
  [--cases owner,crash,both,...] [--flag env|default] [--profile-dir <signed-in user-data dir>] \
  [--crash-at 5:after] [--relay ws://127.0.0.1:9] [--progress <file>] [--strict]
```

- `--app` is the packaged app, a parameter. A PR build is named `Buzz.app`, a release `Colony.app`.
- `--flag env` (default) sets `COLONY_NEST_MIGRATION=1` for migration cases and `0` for the kill-switch cases.
  `--flag default` leaves the build's own default, which is how the release commit's flipped default is proven.
- `--profile-dir` copies a signed-in Electron user-data folder per case so UI checks (Files tab, restored agents)
  can run. Without it those rows are NOT OBSERVED, never PASS.
- Exit code 1 on any FAIL. `--strict` also fails on NOT OBSERVED.
- Output: `index.html` (same format as the earlier gate reports) and `results.json`.

Run it through `/Users/mac/worktrees/.lanes/tools/heavy.sh`, after the 1 minute load average is below 12.

## Cases (15)

| id | HOME shape | What must hold |
| --- | --- | --- |
| owner | only `~/.buzz`, owner-shaped, archive.db with a real WAL | foreign identical, 10 entries moved by rename, journal done, notice, second launch already-migrated |
| repos-symlinked | REPOS is a link outside HOME, `.repos-dir` names it | link moves with the same target |
| repos-dir-inside | `.repos-dir` names a path inside the old nest | outcome aborted, nothing moves, notice, app stays on `.buzz` |
| held-back | REPOS holds an absolute link into the old nest | REPOS stays whole in the old folder, the rest moves, the new folder gets a `.repos-dir` naming it (REPOS-POINTER, REPOS-IN-USE), the notice says the repositories folder stayed and is still used |
| stale | old version stamps | AGENTS.md may be refreshed, owner notes below the markers survive |
| crash | `COLONY_NEST_MIGRATION_CRASH_AT=<n>:<before\|after>` | kill lands between two entries, journal written first, no loss, resume completes, then a no-op |
| both | `~/.colony` already has a nest | conflicts kept both sides, empty placeholders replaced, notice |
| both-unrelated | `~/.colony` holds only an unrelated file | its file untouched, everything moves in |
| colony-only | only `~/.colony` | nothing changes, no `~/.buzz` |
| empty | nothing | fresh install uses `~/.colony`, no journal |
| readonly | HOME is mode 0555 | outcome aborted, nothing touched, window reached, notice |
| running-agent | a process with the ownership marker holds the nest as cwd | outcome deferred-running-agents, nothing moves, migrates after it stops |
| flag-off | `COLONY_NEST_MIGRATION=0` | outcome disabled, nothing moves |
| reset | Reset after a migration | only owned entries of `~/.colony` wiped, foreign untouched |
| reset-legacy | Reset with the migration off | only owned entries of `~/.buzz` wiped, `.venv-*`, `.scratch` and notes untouched |

## Files

- `contract.mjs` every name, env var, path and log prefix shared with the migration. One place to change.
- `fixture.mjs` builder (also a CLI): `node fixture.mjs --out <empty dir> --variant owner`.
- `manifest.mjs`, `sqlite.mjs` lstat manifests, database reads on copies (the original `-wal` and `-shm` are never opened).
- `diff.mjs` differ, `check-rows.mjs` and `checks.mjs` the checks, `report.mjs` HTML.
- `launch.mjs` sandboxed launcher (packaged app through Playwright Electron, plus a fake driver).
- `proof.mjs`, `run.mjs` the flows and the command line.
- `simulate.mjs`, `fake-app.mjs` test-only stand-ins that follow the same contract. They prove the harness; the
  proof run never uses them. Run the tests with `pnpm test:nest-proof` (also part of `pnpm test`).

## Known gaps, stated plainly

- UI evidence (Files tab, agents restored with the new cwd) needs `--profile-dir`; not driven otherwise.
- The running-agent case uses a stand-in process that carries the ownership marker and a `.pid` file, not a real
  agent. A real agent restore is covered only with a signed-in profile.
- The crash seam exit code (86) is read from the Electron process when it exits; under Electron the native host
  is a child, so the harness also accepts the host's own `crash seam` log line.
