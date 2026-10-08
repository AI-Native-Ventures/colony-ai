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


## Final 1.0.5 gate additions (6 October 2026)

- `safety.mjs` `realEnvironment` and `assertHomeMigrationGuard`: a launcher guard that refuses to start when HOME is the real
  home and `COLONY_NEST_MIGRATION` is not exactly `0`; `GATE_REAL_HOME=1` selects the real HOME (default is a throwaway HOME
  next to the profile), `GATE_HOME_SEED_FROM` moves a pre-built owner-shaped fixture in as that HOME. The HOME and the flag
  value are printed before every launch.
- A throwaway HOME cannot sign Claude Code in under the keychain-deny sandbox (the login keychain is resolved from HOME):
  `claude auth status` reports `loggedIn: false` there and `true` with the real HOME. The fresh-HOME Scout run therefore needs
  an interactive sign-in inside the throwaway HOME (`--pause-before-launch`).
- `netfail.mjs` and `c105-a2.mjs` (`ONLY=retry`, `NETFAIL=proxy`): breaks the avatar upload at the host to relay hop. reqwest
  reuses a pooled keep-alive connection, so the proxy also destroys open tunnels when it blocks.
- `nest-migration`: per-case `case-<id>.json` files are written as soon as a case ends; four documented expectation
  relaxations (checkpointed WAL and SHM, regenerated AGENTS.md managed block, host-provisioned `.scratch` and empty
  placeholders, retired generated `buzz-cli` skill entries, in-flight model download folder) and a no-web sandbox rule.
  Strict and narrowed results are published side by side in the gate report.
- `g2-existing.mjs`: the PR 240 collector, prompts and scanner against an existing signed-in profile (real HOME, migration off).
- `c105f-g8.mjs`, `c105f-misc.mjs`, `c105f-g3.mjs`, `c105f-g4live.mjs`, `gate-manifest.mjs`: escape screen with Switch and
  Remove, window title and Settings text scan, seeded-HOME views.

## Browser tab proof on the packaged app

Two scripts, prepared and NOT yet run on a candidate (the 1.0.6 candidate must contain PR 263, because
the forget-everything and metadata rows need its host). Both refuse CI, run only under the keychain-deny
sandbox, and sign in to nothing.

### `browser-tab.mjs`: the host proof, on a throwaway HOME

Launches the packaged app with the throwaway HOME `privateDir/home` (`GATE_REAL_HOME=1` is refused), a
throwaway profile, a relay address that does not exist, and drives the app's real preload bridge
(`window.colonyBrowserHost`) against a local fixture site (`tests/electron/browser-fixture-site.mjs`).
Downloads go to the throwaway HOME's Downloads folder, never the owner's, and the whole throwaway tree is
removed at the end (only folders this run made under the system temp directory).

```sh
cd desktop
COLONY_REAL_RUN=1 node tests/real-run/browser-tab.mjs \
  --app '/path/to/Colony.app' \
  --output /Users/mac/worktrees/.lanes/phase2/real-run-browser-tab
```

Rows (PASS, FAIL, or BLOCKED; exit 1 on any FAIL or BLOCKED):

1. App is packaged, on a throwaway profile, on a throwaway HOME whose Downloads folder is not the owner's;
   the keychain-deny sandbox refuses a probe folder.
2. Two businesses share no cookie, localStorage or IndexedDB; one business keeps them across tabs.
3. **Visible browser vs app session:** a cookie set in the visible browser is not in the app's own session
   (`session.defaultSession`) or its window storage, and a cookie in the app session never reaches the browser.
4. Pages see no desktop bridge; every permission is denied.
5. **Refusals:** `file:`, `javascript:`, `data:`, `chrome:`, `devtools:`, `view-source:`, `ftp:`, `blob:`,
   `buzz:`, `colony:` and credentialed addresses are refused for create and for navigate (the open page stays);
   a redirect to `file:` does not land; `file:` and `ftp:` windows opened by a page never become tabs.
6. **Metadata and link-local (PR 263):** 10 spellings (169.254.x, decimal and hex IPv4, `fd00:ec2::254`,
   IPv4-mapped IPv6, `fe80::`, `metadata.google.internal`) are refused for create and navigate; a redirect to
   one fails at once; a page's `fetch` to one is cancelled and its window never opens; loopback stays open
   (ordinary private ranges are deliberately not probed, to send no LAN traffic).
7. **Downloads:** land only in the throwaway HOME's Downloads under bare, collision-free names; a download
   named `../../colony-real-run-escape.txt` lands inside it; a tree scan of the whole private folder and the
   temp folder finds nothing outside Downloads, no partial or empty file.
8. Forgetting a business, and forgetting everything (sign out, account delete), clear storage and end tabs
   but never delete downloaded files.

### `browser-tab-ui.mjs`: the two rows that need a signed-in workspace

Relaunches a throwaway profile the gate already holds (label from `state.json`, as `c105-dock.mjs` does) and
drives the real dock. It creates no account and types into no form.

```sh
cd desktop
COLONY_REAL_RUN=1 AI_APP='/path/to/Colony.app' AI_OUT=/Users/mac/worktrees/.lanes/phase2/real-run-browser-ui \
  node tests/real-run/browser-tab-ui.mjs A
```

- `BT-reload`: open a browser page in the dock, load it, reload the app; the dock still shows the same page
  tab, selected, at the same address, and the page loads again (live pages end at reload by design; the tab stays).
- `BT-remove-forget`: a cookie is set in a community's visible browser; one stuck community entry is seeded into
  the profile's list (relay `ws://127.0.0.1:1`, nothing listens, no relay contacted: the only state written);
  the real escape screen's "Remove this community from this device" is pressed; afterwards the list no longer
  holds it, no retry record is left, no tab of it is live, and a fresh tab of that community sees no cookie.
  A row whose precondition is not reached is BLOCKED with the screen text, never PASS.

### Tests of the judgements

`node --test tests/real-run/browser-tab-rows.test.mjs` (no Electron): every address the proof expects refused
is refused by the real host policy, the ordinary ones are not, `isInside` is strict, the downloads verdict
rejects strays, partial and empty files and a wrong count, and the tree scan is bounded and ignores symlinks.
