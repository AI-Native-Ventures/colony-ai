# CI: Hermit stub hang

## Symptom

On 28 Oct 2026 many CI jobs stalled until the job timeout (25 minutes for the
desktop E2E shards). The log stopped after pnpm printed
`Lockfile is up to date, resolution step is skipped`, then nothing. The runner's
orphan cleanup listed `just` > `sh` > `node` (pnpm) > `hermit`, or `just` > `sh` >
`node` > `sh` > `hermit`. A rerun usually passed. The same stall showed in
`node --test scripts/ci-plan.test.mjs` and once in `just test-unit`.

## What is proven

- Hermit stubs are the `bin/node`, `bin/pnpm`, `bin/just`, `bin/cargo` scripts. Each
  one ends in `exec hermit exec ...`, so a stub call is a Hermit process that starts,
  loads the environment and then execs the real tool.
- `pnpm install` makes two stub calls on its own: `node --version` right after the
  lockfile check, and `node install.js` for the esbuild postinstall (an `strace -e
  execve` of a CI install shows both going through `bin/node`). The hung process in
  both logs is that `hermit`, a child of pnpm or of its `sh`.
- Hermit only had the empty link farm at activation (`HERMIT_LINK_FARM` ends in
  `e3b0c44298fc1c14`, the hash of nothing), so nothing resolved directly and every tool
  call went through a stub.
- Installing the packages first makes Hermit's link farm hold a direct link per tool,
  and an `strace` of `pnpm install` then shows no `bin/` stub call at all.
- The stall is not tied to a runner image (slow installs on both 20261012 and
  20261025), to a repo change (nothing under `bin/`, `.github/` or the lockfile
  changed before the first stall) or to the Hermit version (v0.54.1 since 21 Oct).

## What is not proven

Why one stub call sometimes never returns. 400+ stub calls and about 250 fresh
installs in throwaway probe jobs did not reproduce it after the first stalls at
05:36Z, 09:11Z and 10:43Z, so no stack of the stuck Hermit process was captured.

## Fix

- `scripts/ci-hermit-ready.sh` installs the Hermit packages a job uses at the exact
  version `bin/` pins, re-activates, and checks the tools now run directly. Every
  job in the CI workflows calls it right after `activate-hermit`.
- `scripts/ci-bounded.sh <seconds> <attempts> <command>` runs each attempt in its own
  process group, kills the whole group when an attempt exceeds the time limit and
  retries. The package install, the farm creation and every dependency install step
  use it, so a stall costs minutes instead of 25. `scripts/test-ci-bounded.sh` is its
  contract and runs in the Workflow contracts job.

Windows jobs do not use Hermit (setup-node and pnpm/action-setup), so they are not
changed.
