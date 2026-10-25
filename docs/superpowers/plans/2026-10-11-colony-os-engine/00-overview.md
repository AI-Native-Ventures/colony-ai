# Colony OS engine, phases 0 and 1: plan overview and shared contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each part task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read this overview before any part: it holds the contract every part uses.

**Goal:** Build the engine the new Colony app needs for its first run and daily loop: passwordless sign-in, a company with its business profile, employees that the computer runs by itself (started at hire, restarted after a crash, caught up after sleep, never on two computers), Scout as a real Chief of Staff, a Needs you index, briefs, team status, notification rules, a new app shell with background running, and live credits.

**Architecture:** A fresh app (`app/`, Electron) on the same relay. The engine is reused and extended: relay and buzz-core (new record kinds, accounts endpoints), buzz-acp (voice, role context, missed wake-ups, business profile), buzz-cli (`colony` commands for employees), and the hidden native host in `desktop/src-tauri` (it now owns "the team runs"). The new app talks to the relay directly and to the host through a small typed bridge. No designed screen is built here: phase 1 ships a plain engine console used only for development and proof. Screens are built later from Codex's approved designs.

**Tech Stack:** Rust (axum relay, sqlx Postgres, Tauri host crate), TypeScript (Electron main and preload, React renderer, Vitest, Playwright), Nostr events (NIP-29 groups, NIP-42 auth, NIP-98 HTTP auth), Stripe, OpenRouter through the credits gateway.

**Read first:** the section "Integration decisions" below. It reconciles the parts and wins over them.

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md` and the screen pack `docs/superpowers/specs/2026-10-11-colony-os-screens/` (engine items E-01 to E-33 in `10-data-and-engine.md`; screens referenced by ID). Approved by the owner on 11 October 2026.

## Plan parts and order

| Part | File | Engine items | Depends on | Task numbers |
|-|-|-|-|-|
| **Phase 0: foundations (no interface)** | | | | |
| A | `p0-a-accounts-and-company.md` | E-02 email code sign-in and terms record; E-03 company creation for new accounts; E-04 business profile record; team computer record (relay side of E-12, minimal) | none | 1.x |
| B | `p0-b-role-packs-and-hire-completion.md` | E-09 role pack v2 format; E-10 relay side: hire Complete creates goal, routines and kickoff | none | 2.x |
| C | `p0-c-harness.md` | Voice rules; role context; E-14 missed wake-ups; business profile read from the relay | A (profile kind), B (role context fields) | 3.x |
| D | `p0-d-host-runs-the-team.md` | E-10 host side (hire completes and starts at once); host-owned start on launch; E-29 restart after crash; team pause and resume; team computer claim (host side of E-12, minimal); fixture role pack; phase 0 real-run gate | A, B, C | 4.x |
| **Phase 1: app shell and Scout** | | | | |
| E | `p1-a-app-shell-and-bridge.md` | E-01 new app shell and typed bridge; E-11 background running (menu bar and tray, close to tray, open at login, stay awake while plugged in); updates (Windows install, Mac download); engine console | D | 5.x |
| F | `p1-b-needs-you-and-briefs.md` | E-06 decisions addressed to people; E-07 brief and Friday wrap records; `colony brief` CLI | A, B | 6.x |
| G | `p1-c-scout.md` | E-09 Scout's role pack: instructions, chief-of-staff skill, routines, first real turn (profile proposal, team proposal) | B, C, D, F | 7.x |
| H | `p1-d-team-status-and-notifications.md` | E-13 team status read model and `colony team status`; E-26 notification rules | D, E, F | 8.x |
| I | `p1-e-credits-live.md` | E-16 credits gateway ready for production (capacity, model, out-of-credits mapped to "team paused"); phase 1 real-run gate | D, E | 9.x |

Phase 0 parts A and B can run in parallel; C then D. Phase 1 starts after the phase 0 gate passes. In phase 1, E, F and I can run in parallel; G and H follow.

A later part may use anything an earlier part produces in this contract, and nothing else. If a part must change the contract, it says so in its own "Contract changes" section; it never changes a name silently.

## Global constraints (every task in every part)

- No em dashes (U+2014) anywhere: code, comments, strings, docs, commit messages. Use a hyphen, colon or comma.
- No new `unwrap()` or `expect()` in production paths (tests may use them). No `unsafe`. New public API gets doc comments.
- User-visible and employee-visible text never says "Buzz", "Fizz" or "Honey". The employee command is `colony`.
- User-visible words follow the screen pack glossary (`2026-10-11-colony-os-screens/00-index.md`, section 8): company, conversation, employee, decision, task, routine, weekly budget, credits. Never show keys, file paths, model names or error codes to people.
- AGENTS.md review-proven rules apply: durable retry or propagate on failure; fence async results by generation; regression tests bind the production seam; bound every resource, loop and process tree; one user action = one atomic persist; never hide the only recovery affordance; accessibility semantics on new UI; every input modality.
- New features are Nostr events: new kinds go in `crates/buzz-core/src/kind.rs` first; relay queries always name `kinds`; channel-scoped events use `h` tags.
- Old records keep parsing (role packs without v2 fields, duty heads with an ask source). Desktops at 1.0.7 or older may reject records with new keys; that is accepted for the new app.
- Platforms: Mac (Apple Silicon and Intel) and Windows 10 and 11. Installers are unsigned at launch (owner, 11 October).
- Times run in the company time zone: morning brief weekdays 08:30; Friday wrap Fridays 16:00; Plan check Mondays 09:00.
- Credits: Stripe USD packs of $5, $15, $50 and $120; the gateway flag is `COLONY_CREDITS_GATEWAY`. Never put secrets in code, tests, docs or chat; the owner sets them as Fly secrets.
- Commits use `git commit -s` (DCO). Workers open PRs into `develop` and never merge to `main`. GitHub CI is the gate: run focused local tests for the code you touch (`cargo test -p <crate> <filter>`, `pnpm vitest run <file>`); `just test` only when a relay, db or auth task says so.

## Review focus (the failure modes no single happy-path test catches)

1. **The computer sleeps or Colony quits in the middle of a hire.** Expected: on the next start the hire finishes exactly once (one employee, one hello, one Complete), never two employees. Pinned in part D, task "hire journal".
2. **The owner signs in on a second computer before the move flow exists.** Expected: only the computer holding the team computer record runs employees; the other runs none and reports where the team runs. Pinned in parts A (claim rules) and D (host refuses to start without the claim).
3. **Someone guesses email codes.** Expected: 5 wrong tries burn the code, rate limits per email and per address hold, and an unknown email gets the same answer as a known one. Pinned in part A.
4. **The host crashes while replaying missed wake-ups.** Expected: no event is answered twice, and nothing older than the 7-day bound is replayed. Pinned in part C.
5. **Credits run out in the middle of an employee's turn.** Expected: the employee stops cleanly, the team shows "paused: credits ran out", nothing is posted to chat as an error, and work resumes once credits arrive. Pinned in part I.

## Shared interface contract

### New record kinds (`crates/buzz-core/src/kind.rs`)

| Constant | Value | Kind of event | Written by | Read by |
|-|-|-|-|-|
| `KIND_BUSINESS_PROFILE_HEAD` | 30657 | Parameterized replaceable, company-wide (no `h` tag), `d` = `business-profile`, signed by the relay | Relay, from an accepted action | Every company member and employee |
| `KIND_BUSINESS_PROFILE_ACTION` | 47046 | Regular event, company-wide | Owner or admin (partners are admins) | Relay |
| `KIND_TEAM_COMPUTER_HEAD` | 30658 | Parameterized replaceable, company-wide, `d` = `team-computer`, signed by the relay | Relay, from an accepted action | Members, the host |
| `KIND_TEAM_COMPUTER_ACTION` | 47047 | Regular event, company-wide | Owner or admin, signed by the host with that person's key | Relay |
| `KIND_BRIEF_HEAD` | 30659 | Parameterized replaceable, company-wide, `d` = `brief:<YYYY-MM-DD>:<morning or friday>`, signed by the employee that wrote it | Scout, through `colony brief publish` | Members |

Ask heads (`KIND_ASK_HEAD`, 30643) additionally carry one `["p", <hex>]` tag for every person who may decide the ask when the relay writes the head: the owner and every admin. This is how Needs you finds decisions with a `#p` filter (part F).

### Business profile JSON (head content; also the `profile` field of the action)

```json
{
  "schemaVersion": 1,
  "name": "Lerato Designs",
  "whatYouSell": "Women's clothing in natural linen and cotton, made in Johannesburg.",
  "whoBuys": "Women aged 25 to 45 who like local, made-to-last clothing.",
  "whereYouSell": ["instagram", "website", "markets"],
  "city": "Johannesburg",
  "country": "South Africa",
  "timeZone": "Africa/Johannesburg",
  "links": ["https://leratodesigns.co.za", "https://instagram.com/leratodesigns"],
  "voiceWords": ["warm", "confident", "local"],
  "goals": ["More sales", "Bulk orders and stockists"],
  "contact": { "email": "hello@leratodesigns.co.za", "phone": null, "whatsapp": null, "address": null },
  "buyLink": null,
  "invoice": { "registeredName": null, "registrationNumber": null, "vatNumber": null, "bankDetails": null },
  "socialAccounts": { "instagram": "leratodesigns", "facebook": null, "tiktok": null, "linkedin": null, "x": null }
}
```

The profile also has optional `"bestSellers": []` (at most 3 strings of at most 120 characters) and `"priceRange": null` (at most 120 characters), added during integration (item 10).

Rules: `name` 1 to 120 characters and required; every other text field at most 500 characters; arrays at most 10 items; `timeZone` must be an IANA name; unknown keys are rejected (`deny_unknown_fields`); the whole content is at most 16 KB. The action content is `{ "profile": <profile>, "expectedRevision": <u32 or null> }`; the head carries `["revision", "<n>"]` and the relay rejects an action whose `expectedRevision` is not the current revision (write conflict, CLI exit code 5). The company name shown everywhere is `profile.name`.

### Team computer JSON (head content)

```json
{ "computerId": "3f6e...-uuid-v4", "computerName": "Lerato's MacBook Air", "claimedBy": "<64 hex>", "claimedAt": 1760180000, "lastSeenAt": 1760180300 }
```

Action content: `{ "action": "claim" | "heartbeat" | "release", "computerId": string, "computerName": string, "force": bool }`. Rules: `claim` succeeds when there is no head, when the head was released, or when `force` is true (a move, owner or admin). `heartbeat` succeeds only from the current `computerId` and at most once every 60 seconds. `release` succeeds only from the current `computerId`. The host generates `computerId` once per install and keeps it in its app data.

### Accounts HTTP (`crates/buzz-relay/src/api/accounts.rs`)

- `POST /api/accounts/code/start` with `{ "email": string }` returns 200 `{ "sent": true, "resendAfterSeconds": 30 }` for every well-formed email, known or not.
- `POST /api/accounts/code/verify` with `{ "email": string, "code": string, "termsVersion": string, "displayName": string | null }` returns 200 with the same session JSON the existing sign-in returns, plus `"created": bool`. A new email creates a passwordless account. Errors: 400 `{"error":"invalid_code"}`, 410 `{"error":"code_expired"}`, 429 `{"error":"too_many_attempts"}`. Five wrong tries burn the code.
- `POST /api/accounts/google` accepts an optional `termsVersion` and records it.
- Accounts gain `terms_version` (text, nullable) and `terms_accepted_at` (timestamp, nullable).

### Host commands (Tauri commands in `desktop/src-tauri`, reachable from the new bridge)

```rust
/// A company this computer may run, persisted by the host in its app data (team-companies.json).
#[serde(rename_all = "camelCase")]
pub struct TeamCompany { pub relay_url: String, pub owner_pubkey: String }

team_set_companies(companies: Vec<TeamCompany>) -> Result<(), String>
team_claim_status(relay_url: String) -> Result<TeamComputerStatus, String>
// TeamComputerStatus { this_computer_id: String, holder: Option<TeamComputerInfo>, is_this_computer: bool }
// TeamComputerInfo { computer_id: String, computer_name: String, last_seen_at: i64 }
team_claim(relay_url: String, force: bool) -> Result<TeamComputerStatus, String>
team_hire_complete(input: HireCompleteInput) -> Result<HireCompleteResult, String>
// HireCompleteInput { relay_url, hire_id, persona_id, display_name, home_channel_id, time_zone }
// HireCompleteResult { agent_pubkey: String, state: "started" | "resumed" | "already_complete" }
team_restart_employee(agent_pubkey: String) -> Result<(), String>
team_restart_all(relay_url: String) -> Result<(), String>
team_pause(relay_url: String) -> Result<(), String>
team_resume(relay_url: String) -> Result<(), String>
team_status(relay_url: String) -> Result<Vec<EmployeeRuntimeStatus>, String>
// EmployeeRuntimeStatus { agent_pubkey, name, state: "starting" | "running" | "paused" | "stopped" | "failing" | "away", since: i64, restarts_in_window: u32 }
```

Host events: `team://status` carries one `EmployeeRuntimeStatus` (which also has `pause_reason: Option<PauseReason>`, integration item 1); `team://problem` carries `{ agentPubkey, kind: "start_failed" | "crashed" | "crash_loop" | "credits_out" | "disk_full", detail }` (detail is plain words, never a path or code; `agentPubkey` is null when the whole engine stopped).

Host rules:

- At host start, for each saved `TeamCompany`, the host starts every employee marked start-on-launch, but only when this computer holds the team computer record (claim if none exists). The interface no longer has to call `apply_workspace` first.
- Restart after an unexpected exit with waits of 5 s, 15 s, 45 s, 2 min and 5 min; after 5 unexpected exits within 10 minutes the employee is `failing` and the host stops restarting it and emits `crash_loop`.
- `team_hire_complete` is one journaled operation (`hire-journal.json` in app data): create the employee with start-on-launch on, join the home channel, post the hello as the employee, publish the hire Complete with `time_zone`, start the employee. A restart resumes the journal at the first unfinished step, and every step checks whether it already happened.
- Environment per employee: `COLONY_ROLE_CONTEXT` (JSON of `RoleContext`), `COLONY_WAKE_LEDGER` (`<app data>/agents/<pubkey>/wake-ledger.json`), `COLONY_TEAM_COMPUTER_ID`.
- Pause stops every employee of the company after its current turn and persists `paused: true` for that company; resume clears it and starts them.

### Role pack v2, hire completion and role context

Use the contract in `docs/superpowers/plans/2026-10-11-ai-employees-base-phase1/00-brief.md` (branch `docs/ai-employees-shared-base`) for `RoleDutyTemplate`, `RoleOnHire`, `RoleWorkFolder`, the `HireRolePack` v2 fields, `HireAction.time_zone`, `DutyHead.source_hire_id`, relay Complete (goal, routines with workflows, Plan review routine, kickoff message) and `RoleContext`, with these changes for the new product:

- The built-in routine is named "Plan check" (not "Plan review"): `PLAN_CHECK_DUTY_TITLE = "Plan check"`, `PLAN_CHECK_DUTY_SCHEDULE = "Every Monday at 09:00"`.
- `work_dir` and `RoleWorkFolder` are not built (no launch role needs a folder on the computer). `RoleWorkFolder` stays out of the format.
- Old desktop TypeScript parsers are not changed; the new app parses records in phase 1.

### buzz-acp environment and behaviour

- `COLONY_ROLE_CONTEXT` adds a `<colony-role>` block to the instructions (same escaping style as `business_context.rs`).
- `COLONY_WAKE_LEDGER`: on first subscribe after a start, the employee processes mentions and routine wakes newer than its ledger floor (never more than 7 days back) once each, then continues live. The ledger records each processed event id before the turn starts, so a crash never causes a second answer.
- The business profile: at start and before each turn, the harness uses the latest `KIND_BUSINESS_PROFILE_HEAD` it has seen (subscription), falling back to `COLONY_BUSINESS_PROFILE` when none exists.
- Voice rules from the shared base design (usually 1 to 5 sentences, result first, no headings or bullet walls in chat, long things into cards or documents, one question at a time) are part of every employee's instructions.

### New app bridge (`app/`, phase 1)

```ts
// app/src/bridge/types.ts
export type Unsubscribe = () => void;
export interface ColonyBridge {
  auth: {
    startEmailCode(email: string): Promise<{ resendAfterSeconds: number }>;
    verifyEmailCode(input: { email: string; code: string; termsVersion: string; displayName?: string }): Promise<SessionSummary>;
    signInWithGoogle(termsVersion: string): Promise<SessionSummary>;
    session(): Promise<SessionSummary | null>;
    signOut(): Promise<void>;
  };
  team: {
    setCompanies(companies: TeamCompany[]): Promise<void>;
    claimStatus(relayUrl: string): Promise<TeamComputerStatus>;
    claim(relayUrl: string, force: boolean): Promise<TeamComputerStatus>;
    hireComplete(input: HireCompleteInput): Promise<HireCompleteResult>;
    restartEmployee(agentPubkey: string): Promise<void>;
    restartAll(relayUrl: string): Promise<void>;
    pause(relayUrl: string): Promise<void>;
    resume(relayUrl: string): Promise<void>;
    status(relayUrl: string): Promise<EmployeeRuntimeStatus[]>;
    onStatus(cb: (s: EmployeeRuntimeStatus) => void): Unsubscribe;
    onProblem(cb: (p: EmployeeProblem) => void): Unsubscribe;
  };
  system: {
    getOpenAtLogin(): Promise<boolean>;
    setOpenAtLogin(on: boolean): Promise<void>;
    getKeepAwakeWhilePluggedIn(): Promise<boolean>;
    setKeepAwakeWhilePluggedIn(on: boolean): Promise<void>;
    notificationPermission(): Promise<"granted" | "denied" | "unknown">;
    notify(n: AppNotification): Promise<void>;
    onNavigate(cb: (target: NavTarget) => void): Unsubscribe;
    update: { status(): Promise<UpdateStatus>; download(): Promise<void>; restartToInstall(): Promise<void> };
  };
}
```

`SessionSummary`, `TeamCompany`, `TeamComputerStatus`, `HireCompleteInput`, `HireCompleteResult`, `EmployeeRuntimeStatus` and `EmployeeProblem` mirror the host types in camelCase. `AppNotification` is `{ id: string; title: string; body: string; target: NavTarget }`; `NavTarget` is `{ screen: string; id?: string }`, where `screen` is a screen pack ID such as `"T-05"` or `"C-18"`. `UpdateStatus` is `{ state: "none" | "available" | "downloading" | "ready"; version?: string; installMode: "restart" | "download" }` (`download` on Mac while installers are unsigned).

## Integration decisions (read before any part; they win over the parts)

The nine parts were written in parallel. Each part's "Contract changes" section lists what it needed from the others. The coordinator reconciled them on 11 October. Every change a part lists is accepted unless an item below says otherwise, and where an item below differs from a part's tasks, the item wins.

### Settled across parts

1. **Pause reasons** are `"person" | "credits" | "plan_limit"` everywhere: Rust `pub(crate) enum PauseReason { Person, Credits, PlanLimit }` with serde snake_case in `team_runner.rs`, bridge field `pauseReason`. Part I's `"credits_out"` and `PauseReason::CreditsOut` become `"credits"` and `PauseReason::Credits` in every task and test of part I. The problem event kind stays `"credits_out"`.
2. **Credits seam in the host:** `credits_pause.rs` exactly as part I's "Contract changes" item 3 (`ExitHandling`, `on_harness_exit`, `is_paused_for_credits`, `ensure_watcher`, `resume_if_funded`); part D creates the stub and calls it, part I's task 9.5 fills it.
3. **Handing events back to the wake ledger:** part C's method `WakeLedger::forget_events(event_ids, pending, now) -> SyncOutcome` is the only API. Part I's task 9.4 calls it in-process before exiting with 75 or 77, as part C's "Contract changes" item 5 describes; it does not add the free function `forget_events(path, events)` that part I sketched.
4. **Notifications are decided in Electron main** by part H's engine (`app/src/main/notifications/`), which keeps its own relay socket per company. The renderer never raises a G-03 notification; `system.notify` stays for anything else. Part E's "Contract changes" item 11 stands for its other reasons (the window hides and is reused, the tray and the renderer state survive), not as the notification path.
5. **Closing the window hides the same window** (part E item 11). Part I's gate row `close-window` answers X-14 when it shows, then waits for the same window's `isVisible()` after reopening from the menu bar or tray; it never waits for a new window.
6. **Brief command and links:** part F's command is the only one: `colony brief publish --type morning|friday --date YYYY-MM-DD --text "..." [--link "Label|SCREEN" | --link "Label|SCREEN|ID"]...`. Part G's instructions, skill, routine instructions, examples and tests use it: `--date` is today in the company time zone; a conversation link is `Label|T-03|<conversation id>`, a decision link is `Label|T-05|<ask id>`, a desk link is `Label|D-03` (and so on). Part G never writes `colony://channel/...` targets.
7. **Brief content** gains an optional whole number `doneCount` (0 to 1000) for the Friday wrap ("14 things done this week"). Part F's task 6.1 adds it to the type, validation and tests; part F's task 6.8 adds `--done-count N`.
8. **`colony profile show`** comes from part A's task 1.10. Part G's task 7.4 implements only `colony profile propose` and drops its own `show` subcommand and tests.
9. **Profile names:** the core module is `buzz_core::company_profile` (part A), exporting `BusinessProfile` and `validate_business_profile`. Part G imports those names, not `business_profile`.
10. **Profile fields for the O-07 card:** `BusinessProfile` gains optional `bestSellers` (at most 3 strings, each at most 120 characters) and `priceRange` (string or null, at most 120 characters). Part A's task 1.6 adds them to the type, validation and tests; Scout fills them in its profile proposal.
11. **Team computer record:** part A's items 1 to 4 stand (`releasedAt`, a claim from the current holder refreshes it, heartbeats are not stored as events, the host heartbeats every 2 minutes).
12. **Hire completion:** part B's items stand. Part D's `team_hire_complete` adds the owner to the home channel before Complete when needed and always sends `profile.timeZone` (the computer's time zone only when no profile exists).
13. **Harness environment from the host:** `BUZZ_ACP_REPLAY_FLOOR` (the Unix time captured just before Complete, on an employee's first start), `COLONY_WAKE_LEDGER` (reserved key), `COLONY_ROLE_CONTEXT`, `COLONY_TEAM_COMPUTER_ID`. A run of "wake ledger could not be saved" lines becomes a `team://problem` of kind `"disk_full"` with plain words (X-21).
14. **Sign-in codes last 15 minutes** (part A item 5). The screen pack (O-02, W-06) was updated to say 15 minutes.

### Deferred, on purpose

15. **The agent browser** (employees browsing like a person) is not in the new app yet: part E starts the host with `COLONY_BROWSER_AGENT=0`. It becomes engine item E-34 in phase 2. Until then employees use their own web tools, and Scout's first turn says plainly when a link cannot be read (O-07).
16. **The five launch role packs** (Maya, Naledi, Sipho, Leo, Grace) arrive in phase 2 with E-09. In the phase 1 gate, "Scout proposes the team" means every role in the catalog, which are the fixture packs under `COLONY_FIXTURE_ROLE_PACKS=1`.
17. **Owner-only billing asks** (the `["colony:owner-only","1"]` tag part H asked for) come in phase 2 with C-16 money requests. In phase 1, billing prompts are the owner-only banners G-04c and G-04k.
18. **Pause visible on other computers** (part H item 6: a `pause` field on the team computer record) comes in phase 3 with partners and the full E-12. In phase 1 a pause is known on the team computer only.

19. **Moving the team to another computer** (N-02) needs every employee's key on the new computer. Today an employee's key lives only in the keychain of the computer that hired it (part D's biggest risk), so phase 0 and 1 refuse to start the team anywhere but the computer holding the team computer record, and the move itself comes in phase 3 with the full E-12, where employee keys are kept by the server the same way the account key already is.

## Phase gates

- **Phase 0 gate (headless real run, Mac and Windows):** with a packaged host binary, a clean app data folder and real AI: sign in with an email code (new account) through the relay API; create a company and set its profile; claim the team computer; hire the fixture employee through `team_hire_complete`; the employee says hello within 5 minutes; kill the host in the middle of a second hire and start it again: exactly one employee and one hello result; kill the host, start it with no interface: the employee starts by itself; stop the host for 20 minutes across a routine's time: the missed routine runs exactly once after start; start a second host with a different computer id: it runs no employee. Script and proof page in part D.
- **Phase 1 gate (real run on the new app's engine console, Mac and Windows):** first run end to end on credits: sign in with an email code, company and profile, Scout's first real turn proposes the profile and the team, one approval hires them, the window closes and the team keeps working from the menu bar or tray, a decision raises a notification that opens the right ID, the morning brief record appears at 08:30 company time (clock set for the test), running out of credits pauses the team cleanly and buying a $5 pack resumes it. Script and proof page in part I.

## What each part file contains

Each part starts with the writing-plans header (Goal, Architecture, Tech Stack, Spec), its own Global Constraints (this overview's list applies too) and Review Focus, then tasks numbered as in the table above. Every task lists Files, Interfaces (Consumes, Produces), and bite-sized steps: failing test with real code, the command and expected failure, minimal implementation with real code, the command and expected pass, and a commit. A part ends with a "Contract changes" section (empty when there are none).
