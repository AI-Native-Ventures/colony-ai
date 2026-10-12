# Phase 0 gate: the host runs the team

This gate proves, on a real relay with real AI and the packaged host, that
Colony's host runs a company's team by itself. It is never run in CI.

| Step | What it proves |
|-|-|
| 1 Sign in with an email code | A new account is created by code (part A). |
| 2 Create the company | Self-serve account mode creates the company relay. |
| 3 Set the business profile | The profile head carries the company time zone. |
| 4 Start the host and claim | The host claims the team computer for this computer. |
| 5 Hire the Test Employee | `team_hire_complete` creates, introduces, completes and starts the employee. |
| 6 Kickoff answer | The employee answers the relay's kickoff within 5 minutes (real AI). |
| 7 Interrupted hire | The host is killed after the employee is created; on restart the hire finishes by itself with exactly one employee, one hello and one Complete. |
| 8 No interface | After a kill, a fresh host with no calls starts both employees. |
| 9 Missed routine | The host is stopped from 10 minutes before the daily note to 10 minutes after; after the restart each employee posts exactly one note. |
| 10 Second computer | A second host (another install id) never takes the team and refuses to run employees. |

## Before you run it

- A packaged host downloaded from a CI artifact for this commit, built
  without keychain features (`--no-default-features --features electron-host`).
  The coordinator supplies the extracted `colony-native-host` binary, or
  `colony-native-host.exe` on Windows, with its packaged sidecars. Never build
  the host on this shared Mac. Record the CI run and commit with the report.
- A relay with self-serve account mode on (`BUZZ_SELF_PROVISION_ACCOUNTS`),
  and a fresh email address you can read: the gate asks for the code.
- Claude Code signed in on this computer (or `COLONY_GATE_RUNTIME=codex` with
  Codex signed in).
- About 75 minutes: the daily note is set 40 minutes ahead
  (`COLONY_GATE_DUTY_DELAY_MINUTES`), the host is stopped for 20 minutes
  around it, and the gate waits up to 12 minutes for the notes.
- Leave the computer awake and on power for the whole run.

## Run it

Mac:

```bash
cd desktop
COLONY_REAL_RUN=1 \
COLONY_GATE_HOST_BINARY="/absolute/path/to/ci-artifact/colony-native-host" \
COLONY_GATE_RELAY_URL=https://<relay host> \
COLONY_GATE_EMAIL=<fresh address> \
node tests/real-run/team-host/gate.mjs
```

Windows (PowerShell):

```powershell
cd desktop
$env:COLONY_REAL_RUN = "1"
$env:COLONY_GATE_HOST_BINARY = "C:\path\to\ci-artifact\colony-native-host.exe"
$env:COLONY_GATE_RELAY_URL = "https://<relay host>"
$env:COLONY_GATE_EMAIL = "<fresh address>"
node tests/real-run/team-host/gate.mjs
```

Optional: `COLONY_GATE_APP_IDENTIFIER` when the packaged host uses another
identifier than `src-tauri/tauri.conf.json`; `COLONY_GATE_COMPANY_SLUG`;
`COLONY_GATE_TERMS_VERSION`; `COLONY_GATE_REPORT` for the report path.

The gate writes `out/report-<time>.json` and exits 0 only when every step
passed. A step that could not be observed says NOT OBSERVED, never PASS.

## Proof checklist (attach to the PR)

- [ ] Mac (Apple Silicon or Intel): report JSON attached, verdict PASS.
- [ ] Windows 10 or 11: report JSON attached, verdict PASS.
- [ ] Record the source commit and CI artifact run for each packaged host.
- [ ] Each report shows the host binary, the relay, the runtime and the time
      for every step.
- [ ] The NOT verified list below is copied into the PR.

## Not verified by this gate

- A real computer sleeping (the gate stops the host instead).
- Two physical computers (the second computer is a second install on the
  same machine; the record only sees install ids).
- Moving the team with a forced claim: employees are local to the computer
  that hired them, so a move has nothing to run until a later phase moves
  their keys.
- The new app's screens (phase 1).
- Credits exits (part I).

The host and the gate share this computer's home folder, so the employees'
working folder (the nest) is the real one.
