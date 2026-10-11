# Brief for plan writers: AI employees shared base, Phase 1

You are one of five writers. Together you produce the implementation plan for Phase 1 of the spec. Each writer owns one part file and one slice of the code. Do not write outside your part file. Do not edit product code, build, or run long test suites; read code, grep, and write the plan.

## Inputs (read first)

- Spec: `docs/superpowers/specs/2026-10-11-ai-employees-shared-base-design.md` (commit 44be75d52). Phase 1 only. Phase 2 (allowance enforcement) is out of scope.
- Repo rules: `AGENTS.md`, `TESTING.md`, `desktop/AGENTS.md` (for desktop writers), and any path-local `AGENTS.md`.
- Worktree: `/Users/mac/worktrees/.lanes/wt-ai-employees-spec` (code equals origin/develop).

## Plan format (mandatory)

Write in the superpowers writing-plans style:

````markdown
### Task N.M: <Component name>

**Files:**
- Create: `exact/path`
- Modify: `exact/path:start-end`
- Test: `exact/path`

**Interfaces:**
- Consumes: <exact names and types from earlier tasks or this brief>
- Produces: <exact names and types later tasks rely on>

- [ ] **Step 1: Write the failing test**
```<lang>
<complete test code>
```
- [ ] **Step 2: Run it and confirm it fails**
Run: `<exact command>`
Expected: FAIL with "<message>"
- [ ] **Step 3: Implement**
```<lang>
<complete code, with enough surrounding lines to locate the edit>
```
- [ ] **Step 4: Run it and confirm it passes**
Run: `<exact command>`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add <paths>
git commit -s -m "<conventional message>"
```
````

Rules for the plan text:

- No placeholders: never "TBD", "TODO", "add validation", "handle edge cases", "similar to Task N", or a step that says what to do without the code.
- Every code step shows real code that compiles against the current tree plus earlier tasks. Name real functions and files you verified by reading them. Quote line numbers you checked.
- Each step is 2 to 5 minutes of work. A task ends with an independently testable deliverable and a commit.
- Tests must bind the production seam and be falsifiable (AGENTS.md rule 3): a guard whose removal does not fail a test protects nothing.
- Exact commands. Rust core: `cargo test -p buzz-core --lib <filter>`. Relay Postgres tests: `scripts/postgres-test-run.sh -p buzz-relay --lib <module>::postgres_tests` (env in the relay section of `.github/workflows/_ci-relay.yml`). buzz-acp: `cargo test -p buzz-acp --lib <filter>`. Desktop Tauri: `just _ensure-sidecar-stubs && cargo test --manifest-path desktop/src-tauri/Cargo.toml -p buzz-desktop --lib <filter>` (or `cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host <filter>`). Desktop unit: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test <file>`. Desktop e2e: `cd desktop && pnpm test:e2e:smoke -- <spec>` and `pnpm test:e2e:integration -- <spec>` (new specs must be registered in `desktop/playwright.config.ts`; run affected specs in both projects when they are mock-bridge specs).
- Commits use `git commit -s`. Conventional messages.

## Global constraints (apply to every task)

- No em dashes (U+2014) anywhere: code, comments, strings, docs, commit messages. Use a hyphen, colon or comma.
- No new `unwrap()` or `expect()` in production paths; tests may use them. No `unsafe`.
- New public API gets doc comments.
- User-visible and agent-visible text never says "Buzz", "Fizz" or "Honey" (brand guards exist). The CLI command is `colony`.
- AGENTS.md review-proven rules: durable retry or propagate on failure; fence async results; one user action = one atomic persist; bound every resource and loop; accessibility semantics on new UI; every input modality.
- Old records (role packs without v2 fields, duty heads with an ask source) must keep parsing.
- Desktops at 1.0.7 or older may reject records with new keys; that is accepted (spec, Rollout).

## Shared interface contract (exact names; all writers use these)

### buzz-core (`crates/buzz-core/src/company_records.rs`)

```rust
/// Whether a role needs a working folder on the founder's computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoleWorkFolder { None, Optional, Required }

/// A default duty a role pack proposes; approved by the founder's hire signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoleDutyTemplate { pub title: String, pub schedule_text: String, pub instructions: String }

/// What a new employee studies first and how long its first plan covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoleOnHire { pub sources: Vec<String>, #[serde(default = "default_plan_horizon_days")] pub plan_horizon_days: u8 }
// default_plan_horizon_days() -> u8 { 14 }; valid 1..=30

// HireRolePack gains, each with #[serde(default, skip_serializing_if = "...")]:
//   owns: Option<String>, channel: Option<String>, duties: Vec<RoleDutyTemplate>,
//   on_hire: Option<RoleOnHire>, ask_before: Vec<String>, home: Option<String>,
//   work_folder: Option<RoleWorkFolder>
// validate_hire_proposal adds: owns 1-500 chars; channel 1-80 chars of [a-z0-9-];
//   duties at most 8 (title 1-120, schedule_text accepted by parse_readable_schedule,
//   instructions 1-2000); on_hire.sources at most 8 (each 1-200), plan_horizon_days 1..=30;
//   ask_before at most 16 (each 1-120); home 1-80.

// HireAction gains #[serde(default, skip_serializing_if = "Option::is_none")]
//   time_zone: Option<String>  (allowed only on Complete; IANA name, 1-64 chars)

pub const PLAN_REVIEW_DUTY_TITLE: &str = "Plan review";
pub const PLAN_REVIEW_DUTY_SCHEDULE: &str = "Every Monday at 09:00";
pub const PLAN_REVIEW_DUTY_INSTRUCTIONS: &str = "Check your plan. If it is 14 days old or finished, write the next 2-week plan in your home channel canvas and send it to your manager.";
```

### buzz-core duties (`crates/buzz-core/src/company_duties.rs`)

```rust
// DutyHead: source_ask_id and source_ask_channel_id become Option<Uuid>
//   (#[serde(default, skip_serializing_if = "Option::is_none")]) and it gains
//   source_hire_id: Option<Uuid> (same attributes).
// validate_duty_head: exactly one source, either (source_ask_id AND source_ask_channel_id,
//   both non-nil) or source_hire_id (non-nil); never both, never neither.
```

### Relay hire completion (`crates/buzz-relay/src/handlers/company_hires.rs`)

Inside the existing Complete transaction:
- Goal: `goal_id = hire_id`, root goal (`parent_goal_id: None`), `title` = `owns` (or the hire title when `owns` is absent), `owner_pubkey` = employee, `done_condition` = `owns` (or "Plan approved and delivered"), `linked_channel_ids = [introduction_channel_id]`. Relay-signed head, `CreateOnly`.
- Duties: one per `role_pack.duties` entry plus the Plan review duty; `channel_id = introduction_channel_id`; `time_zone = action.time_zone` or "UTC"; `source_hire_id = Some(hire_id)`; `approved_by_pubkey` = founder; workflow owner = founder; created with `create_workflow_in_transaction`.
- All or nothing with the hire head and member position already written there.
- After commit: publish one on-hire kickoff, a relay-signed kind 9 with tags `["h", <home channel uuid>]`, `["p", <founder hex>]`, `["p", <employee hex>]`, `["buzz:workflow","true"]`, `["buzz:workflow-owner", <founder hex>]`, `["buzz:workflow-mention", <employee hex>]`, `["colony:on-hire", <hire uuid>]`, content `"@<display name> you're hired. Study the business and your sources, then write your 2-week plan in this channel's canvas and send it to your manager."`

### TypeScript

```ts
// desktop/src/features/company-hiring/companyHireModels.ts (+ askRecords.ts parser)
type RoleDutyTemplate = { title: string; scheduleText: string; instructions: string };
type RoleOnHire = { sources: string[]; planHorizonDays: number };
type RoleWorkFolder = "none" | "optional" | "required";
// rolePack gains optional: owns, channel, duties, onHire, askBefore, home, workFolder
// hire action "complete" gains optional timeZone: string
// duty head gains optional sourceHireId; sourceAskId and sourceAskChannelId become optional
// A hire head with tags ["d", ...] and ["p", <64 hex employee>] parses (bug fix).
```

### Tauri (`desktop/src-tauri/src/managed_agents/types.rs` and friends)

```rust
// CompanyRoleMetadata gains the same v2 fields (serde camelCase), using desktop-local
//   RoleDutyTemplate, RoleOnHire, RoleWorkFolder that mirror core (check whether the
//   desktop crate depends on buzz-core; if it does, reuse the core types).
// ManagedAgentRecord gains, each optional and backward compatible on load:
//   company_role: Option<CompanyRoleMetadata>   (bug fix: persona role survives save/reload)
//   role_context: Option<RoleContext>
//   work_dir: Option<String>
/// What a hired employee needs to know about its role, passed as COLONY_ROLE_CONTEXT.
#[serde(rename_all = "camelCase")]
pub struct RoleContext {
  pub title: String, pub job: String, pub owns: Option<String>, pub ask_before: Vec<String>,
  pub manager_name: Option<String>, pub home_channel_id: Option<String>, pub goal_id: Option<String>,
  pub on_hire_sources: Vec<String>, pub plan_horizon_days: u8,
}
// CreateManagedAgentRequest gains role_context: Option<RoleContext>, work_dir: Option<String>.
// Env at spawn: COLONY_ROLE_CONTEXT = serde_json::to_string(&role_context) when present.
// Spawn cwd: record.work_dir when it is a real directory, else default_agent_workdir().
// SpawnConfigSnapshot includes work_dir and role_context so a change needs a restart.
// COLONY_FIXTURE_ROLE_PACKS=1 adds built-in persona "builtin:test-engineer" ("Test Engineer")
//   with a company role (owns, channel "engineering", one duty "Every day at 09:00",
//   onHire sources ["code folder", "open issues"], askBefore ["merge", "deploy"],
//   home "engineer.prs", workFolder "required").
```

TS mirrors: `CreateManagedAgentInput` gains `roleContext?: RoleContext | null; workDir?: string | null`; `RoleContext` type in `desktop/src/shared/api/types.ts`.

### buzz-acp

```rust
// crates/buzz-acp/src/voice.md (new, single source of the voice rules)
pub const VOICE_RULES: &str = include_str!("voice.md");   // in prompt_framing.rs, re-exported from lib.rs
// DEFAULT_BASE_PROMPT = concat!(include_str!("base_prompt.md"), "\n", include_str!("voice.md"), "\n", include_str!("web_tasks.md"))
// crates/buzz-acp/src/role_context.rs (new)
pub(crate) fn append(prompt: Option<String>, raw: Option<&str>) -> anyhow::Result<Option<String>>
//   appends "\n\n<colony-role>\n<escaped fields>\n</colony-role>" (match business_context.rs style)
// config.rs: #[arg(long, env = "COLONY_ROLE_CONTEXT", hide = true)] pub role_context: Option<String>
// Missed wake-ups: on first subscribe an agent starts from a persisted per-agent floor
//   (bounded look-back, at most 7 days) instead of "now", and never processes an event id twice.
```

## Part ownership (no overlaps)

| Part | Writer | Slice |
|-|-|-|
| `part-1-core-relay.md` | 1 | buzz-core role pack v2 + HireAction time_zone + DutyHead hire source; relay Complete creates goal, duties, workflows, kickoff; relay Postgres tests; TS record parsers in `companyHireModels.ts`, `askRecords.ts`, duty head parser (p-tag fix, v2 keys, timeZone, sourceHireId) |
| `part-2-acp.md` | 2 | buzz-acp: voice.md, base_prompt.md edits (lines 81, 123), prompt binding tests, em dash test, role_context.rs + config, missed wake-up catch-up in the relay subscription |
| `part-3-tauri.md` | 3 | Desktop Rust: CompanyRoleMetadata v2 + validator, built-in company role + merge refresh + fixture pack, ManagedAgentRecord company_role persistence fix + role_context + work_dir, CreateManagedAgentRequest fields, spawn env and cwd, SpawnConfigSnapshot, nest_skill.md voice alignment + NEST_SKILL_VERSION bump + managed AGENTS.md voice section |
| `part-4-react.md` | 4 | Desktop TS/React: catalog (built-ins with role, defaultAllowance), configure (home channel default from pack.channel, folder picker via Electron directory dialog), review (job, owns, duties, askBefore), runApprovedHire (startOnAppLaunch, roleContext, workDir, timeZone, start after Complete), Home tab (home channel lookup, dock tab, panel with goal, open work items, duties), profile summary + Restart button, e2e mock bridge updates and specs |
| `part-5-gate.md` | 5 | Real-run gate script under `desktop/tests/real-run/` per spec testing item 5 |

Task numbering: part 1 uses Task 1.1, 1.2, ...; part 2 uses 2.x; and so on. Execution order is part 1, 2, 3, 4, 5, so a later part may consume anything an earlier part produces in this contract, and nothing else.

## What to return

Write your part file, then reply with: the task list (one line each), any spec requirement in your slice you found impossible or risky as written (with file:line evidence), and any interface in this brief you had to change (do not change it silently; say so).
