# Real first-run release gate

This opt-in harness runs a supplied packaged Electron application with its real
renderer and native host. It does not import the mock bridge, seed renderer state,
replace IPC, or mark a step passed because source files exist. It refuses CI.

Plan and acceptance gates:

1. Pin the artifact version and hashes. Create a fresh private user-data directory.
   Prove the child sandbox denies existing data paths before launching the app.
2. Drive account signup and email verification using a disposable mail.tm inbox.
   Keep mailbox credentials, passwords and verification codes in memory only.
   Give each smoke company a unique name to avoid production slug collisions.
3. Drive Business, website read, Claude Code selection, real connection test and
   welcome entry. Capture a screenshot, elapsed time and visible-text branding
   scan at every reached step. A failed prerequisite blocks downstream steps.
4. Measure Scout's introduction and business reply. Inspect Team, Scout pages,
   teammate-only mentions, and reply file-reference semantics.
5. Write a self-contained report outside the repository. Validate the harness
   with falsifiable node tests and run affected existing smoke/integration specs.
   Commit and push this branch only. No PR, merge or deployment.

## Run on macOS

From the repository root, activate Hermit, then:

```sh
cd desktop
COLONY_REAL_RUN=1 node tests/real-run/run.mjs \
  --app '/Volumes/Colony 1.0.3-arm64/Colony.app' \
  --relay 'https://relay.colony.ainative.ventures' \
  --website 'https://example.com' \
  --output '/Users/mac/worktrees/.lanes/phase2/real-run-20261004'
```

The released host has two isolation gaps: its identity adapter selects a shared
keyring service and its agent workspace uses a shared home directory. A fresh
Electron user-data directory alone does not isolate these. The harness therefore
launches the unchanged artifact inside a child-process sandbox that denies
keychain services and existing application data. This is a **restricted packaged
baseline**, not normal credential-storage or signed-in provider proof. Sandbox
failures are recorded as harness constraints, not attributed to the product.
Chromium internal sandboxing is disabled only inside this inherited outer policy,
because macOS rejects nested sandbox initialization. This is an additional
reported difference from the normal release launch.
No custom keychain or keychain command is used. No existing data is removed.

If native startup cannot complete inside these constraints, the report records
that blocker and does not silently switch to mocked tests. Full first-run proof
requires a release host with isolated native storage that can run under this
policy. Production account changes are limited to the fresh smoke account;
the report lists its email for coordinator cleanup. The harness never deletes it.

Default intro/reply deadlines are 120 seconds. Override with
`--reply-timeout-ms 180000`, bounded at 300000. No traces, videos, request bodies,
headers, tokens or secret input values are recorded. Screenshots mask password
and verification-code inputs. The script exits nonzero for FAIL or BLOCKED rows.
Use a different output directory for the combined-branch rerun to retain baseline
provenance. Only public account identifiers appear in the report.

For additional baseline screenshots after an authentication blocker, explicitly add
`--inspect-without-ai 1`. This uses the existing Skip for now control and labels
entry as BLOCKED for connected-first-run proof. Downstream screenshots describe
that exploratory state, never a successful connection. The default stops at the
failed prerequisite.

## 1.0.3 baseline on 4 October 2026

The unchanged installed artifact matched the supplied DMG renderer and native-host
hashes. Production signup, inbox verification, website reading, unique business
creation and Claude selection were observed. Claude reported Sign-in needed
under the restricted policy, so its connection test was BLOCKED. An explicitly
exploratory Skip for now remained on Getting your Colony ready through the
45-second entry deadline. No Welcome, Team, Scout pages, mentions or replies were
reached. These observations do not establish product causality under normal
storage and authentication. Full first-run proof remains incomplete.

The local baseline report and four smoke account identifiers for coordinator
cleanup are in `/Users/mac/worktrees/.lanes/phase2/real-run-20261004/index.html`.
No account or production data was deleted. Combined-branch proof awaits the
coordinator's instruction and a usable isolated signed-in Claude environment.
