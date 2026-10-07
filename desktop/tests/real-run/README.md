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
headers, tokens or secret input values are recorded. DEBUG and PWDEBUG must be
unset because automation diagnostics can disclose filled input values. Screenshots mask password
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

## Fresh-HOME brand proof (Colony 1.0.6 naming gate)

`fresh-home-proof.mjs` proves that a new install shows the old product name nowhere an
agent can speak to a person. It launches the packaged app under the same keychain-deny
sandbox, with `HOME` pointing at a **throwaway directory** that holds no `~/.buzz` and no
`~/.colony`, so the real user's folders are never read or written (the sandbox also denies
them by absolute path). It signs up a disposable smoke account, creates a business,
connects Claude Code, then asks Scout seven things that make it use tools and name files,
folders and commands (`fresh-home-prompts.mjs`).

A page-side collector (`brand-collector.mjs`) records every distinct visible text, plus the
`title`, `aria-label`, `aria-description` and `alt` attributes, on the chat, the agent
session panel and its transcript, the activity strip, the Show details popover, the
Activity page, the Team page, overlays, toasts, notifications and the window title.
`brand-scan.mjs` judges the capture:

- the old name fails everywhere, in any case, including the opt-in popover and an expanded
  transcript (the raw command there must say `colony`);
- pipes, command flags, UUIDs and shell redirects also fail on the plain surfaces (chat,
  transcript, session panel, Activity page, activity strip);
- a surface with no recorded text is NOT OBSERVED, never PASS;
- the throwaway HOME must end with `~/.colony` and without `~/.buzz`, and the host log must
  say `chosen=.colony reason=fresh-install` under that HOME.

`brand-report.mjs` writes `index.html` in the format of the earlier gate reports, next to
`results.json` and screenshots. The exit code is 0 only for PASS.

```sh
cd desktop
COLONY_REAL_RUN=1 node tests/real-run/fresh-home-proof.mjs \
  --app '/path/to/Colony.app' --out /path/outside/the/repo/report-dir \
  --expect-version 1.0.6
```

Useful flags: `--prompts 1,4,7` (subset), `--deadline-min 45`, `--intro-timeout-ms 120000`,
`--pause-before-launch` (prints the throwaway HOME and waits so you can sign Claude Code in
inside it, for example `HOME=<dir> claude`), `--claude-config-dir DIR` (use an existing
Claude config instead of a fresh one), `--no-load-gate`. Env alternatives: `AI_APP`,
`AI_OUT`, `AI_PROGRESS`. The throwaway HOME and the smoke account are never deleted; both
are listed in the report.

Limits to keep in mind: a build without the fresh-install folder choice has no
`nest-folder` log line, so that check reports NOT OBSERVED; Claude Code must be able to
authenticate with the throwaway HOME (see `--pause-before-launch`), otherwise onboarding
stops at the connect screen and the report says so.

Tests that need no app, run from `desktop/`:

```sh
node --test tests/real-run/brand-scan.test.mjs tests/real-run/brand-report.test.mjs \
  tests/real-run/brand-collector.test.mjs tests/real-run/fresh-home.test.mjs \
  tests/real-run/fresh-home-prompts.test.mjs
node tests/real-run/fresh-home-proof.dry-run.mjs   # wiring check, about a minute
```

The dry run executes the real driver against a stubbed Electron and scripted page answers:
a clean script must end PASS and a leaky one FAIL with the old name listed. It proves the
driver's orchestration, judging and report writing, never the product.


## Work, Knowledge, channel notes and pinned messages gate (Colony 1.0.6)

`work-knowledge-proof.mjs` proves the Work and Knowledge dock tabs, channel notes and pinned
messages on the packaged app against the live relay. The mock-bridge specs
(`work-area-work`, `work-area-knowledge`, `work-area-pins`) prove the screens; nothing before
this gate has run them against a real relay or across a real reload.

It launches the packaged app under the same keychain-deny sandbox and throwaway `HOME` as the
brand proof, signs up a disposable smoke account, creates a business and enters the app. These
rows need no AI reply, so when Claude Code is not signed in under the sandbox the app is entered
with Skip for now after a 45 second wait (the report says so; `--require-ai` refuses the shortcut).
Then it clicks through one story in the welcome channel, with a unique run tag in every string:

| Row | What is observed |
|-----|------------------|
| WK0 | a stream channel is open with the Work/Knowledge/Canvas header tabs and a composer |
| WK1 | Work opens and shows rows or an honest empty state, no raw error text |
| WK2 | Knowledge opens with its Channel notes and Pinned sections loaded |
| WK3 | a note is created: the Canvas tab saves a canvas and shows it back |
| WK4 | the note is listed in Knowledge, Channel notes |
| WK5 | a message is sent and pinned; its menu then offers Unpin (the reader saw our pin) |
| WK6 | the pin is listed in Knowledge with its text and a "Pinned by" line |
| WK7 | the Pins screen (header Pins button) lists the same pin |
| WK8 | after an app reload the signed-in channel is back |
| WK9 | after the reload the note is still in Knowledge |
| WK10 | after the reload the pin is still in Knowledge |
| WK11 | after the reload Work still opens to an honest state |
| WK12 | Unpin from the Knowledge list removes the row |
| WK13 | after a second reload the pin stays gone and the note stays |

A row whose prerequisite did not PASS is BLOCKED, never PASS. The verdict is PASS only if every
row was observed. WK5 failing with "Pin was refused" means the live relay rejected kind 40004;
WK13 failing with "did not reach the relay" means Unpin only hid the row.

```sh
cd desktop
COLONY_REAL_RUN=1 node tests/real-run/work-knowledge-proof.mjs \
  --app '/path/to/Colony.app' --out /path/outside/the/repo/report-dir \
  --expect-version 1.0.6
```

Flags: `--no-unpin` (skip WK12 and WK13), `--require-ai`, `--claude-config-dir DIR`,
`--pause-before-launch`, `--no-load-gate`, `--relay`, `--website`. Env: `AI_APP`, `AI_OUT`,
`AI_PROGRESS`. The smoke account, the throwaway HOME and the private profile are never deleted;
the report lists them.

The row sequencing, the prerequisite blocking, every verdict and the report are unit tested with
a scripted app (a relay that refuses the pin, a pin or note the relay does not keep, an unpin that
only hides the row, a reload that does not return); the driver itself needs a packaged build:

```sh
node --test tests/real-run/work-knowledge-rows.test.mjs
```
