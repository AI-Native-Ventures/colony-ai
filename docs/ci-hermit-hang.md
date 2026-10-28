# CI: Hermit stub hang

## Symptom

On 28 Oct 2026 many CI jobs stalled until the job timeout (25 minutes for the
desktop E2E shards). The log stopped after pnpm printed
`Lockfile is up to date, resolution step is skipped`, then nothing. The runner's
orphan cleanup listed `just` > `sh` > `node` (pnpm) > `hermit`, or `just` > `sh` >
`node` > `sh` > `hermit`. A rerun usually passed. The same stall showed in
`node --test scripts/ci-plan.test.mjs` and once in `just test-unit`.

## Cause (proven)

`bin/node`, `bin/pnpm`, `bin/just` and the other `bin/` entries are Hermit stubs. A
stub downloads its package the first time it is used. pnpm 11 is a single binary, so
the first `node` call of a job is pnpm's own `node --version`, right after the
lockfile check; the Node tarball is therefore downloaded from nodejs.org inside
`pnpm install`.

On some runners that download goes idle: the TCP connection to nodejs.org stays
established and no more data arrives. Hermit v0.54.1 has no read or idle timeout, so
the `hermit exec bin/node -- --version` process waits forever.

Evidence from throwaway probe jobs (PR #418) that wiped Node and repeated a fresh
job start 240 times on 24 runners: 22 starts hung (8 runners; one runner hung 5
starts in a row, then recovered). In all 22 dumps the stuck process is
`hermit --level=fatal exec .../bin/node -- --version`, every thread is in futex or
epoll wait, fd 7 is an open
`cache/../*-node-v24.15.0-linux-x64.tar.gz.*.hermit.tmp.download` file, and `ss` shows
an ESTABLISHED socket owned by that process to nodejs.org (104.16.212.131 or
104.16.213.131, port 443). A healthy `hermit exec` of an installed package makes no
network call at all (`strace -e connect`), and `just` and `pnpm` stubs, whose packages
come from GitHub, did not hang. In another probe one runner hung on 31 of 31 `node`
stub calls over 13 minutes (each call restarts the download), then recovered.

The same pattern explains the other stalls: the first `node` call of the contracts
job (`node --test`) and the first `cargo` call of a Rust job are lazy downloads too.

Not proven: why nodejs.org connections go idle on 28 Oct. It is not a runner image
(slow installs on both 20261012 and 20261025), a repo change (nothing under `bin/`,
`.github/` or the lockfile changed before the first stall) or a new Hermit release
(v0.54.1 since 21 Oct).

## Fix

- `scripts/ci-hermit-ready.sh` runs right after `activate-hermit` in the CI jobs. It
  installs the Hermit packages the job uses at the exact version `bin/` pins, in a
  step of its own under `scripts/ci-bounded.sh`, then re-activates Hermit so the link
  farm gives each installed tool a direct path. After it, `pnpm install` makes no
  stub call (an `strace -e execve` shows zero `bin/` execs) and cannot download
  anything. The install attempt is killed, with its whole process group, when the
  Hermit download cache stops growing for 30 seconds (or after 240 seconds), and
  retried up to 5 times. A slow download that keeps moving is left alone: one CI job
  took 54 seconds for a healthy but slow Node download.
- `scripts/ci-bounded.sh <seconds> <attempts> <command>` runs each attempt in its own
  process group, kills the whole group when the limit passes (or, with
  `CI_BOUNDED_PROGRESS_DIR` and `CI_BOUNDED_IDLE_SECONDS`, when that directory stops
  changing) and retries. Every dependency install step also runs through it (240 s,
  3 attempts), so any stall now costs minutes, not 25.
  `scripts/test-ci-bounded.sh` is its contract and runs in the Workflow contracts job.

Proof the fix recovers from the stall: throwaway probe jobs (PR #418) ran a local
proxy that leaves the first nodejs.org connection established and idle after 200 KB.
Today's flow (`just desktop-install-ci` with the stub downloading Node) hung until
the 130 s guard in 3 of 3 jobs. With the fix the first install attempt was killed and
the second finished, 74 to 76 seconds in total, in 3 of 3 jobs.

Windows jobs do not use Hermit (setup-node and pnpm/action-setup), so they are not
changed. Tools a job still starts through a stub (cmake, pgschema, cargo-deny,
flutter, the Rust toolchain that cargo fetches on first use) keep the lazy-download
exposure; none of them hung in the evidence above.
