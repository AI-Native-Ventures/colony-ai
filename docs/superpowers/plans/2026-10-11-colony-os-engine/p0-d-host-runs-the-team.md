# Phase 0, part D: the host runs the team (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hidden native host own "the team runs": it starts a company's employees when Colony starts, finishes a hire in one journaled operation that survives a crash, restarts an employee after an unexpected exit, pauses and resumes the team, and never runs a company's team on a computer that does not hold the team computer record.

**Architecture:** A new `team_runner` module inside `desktop/src-tauri/src/managed_agents/` (the path part I imports) holds the team state: saved companies with their pause reasons, this computer's install id, the team computer record cache, a supervisor book and a hire journal. It drives the engine that already exists: launch restore, the pair runtime commands, `create_managed_agent`, `send_managed_agent_channel_message` and the relay helpers. One fence in `spawn_agent_child` and one filter in launch restore enforce the team computer record and pauses for every start path. Employees get `COLONY_ROLE_CONTEXT`, `COLONY_WAKE_LEDGER`, `COLONY_TEAM_COMPUTER_ID` and, on their first start, `BUZZ_ACP_REPLAY_FLOOR`. A stub `credits_pause` module is the seam part I fills. Nine Tauri commands expose it to the old Electron shell and to the new app over the existing stdio protocol, and a headless gate script proves it end to end.

**Tech Stack:** Rust (Tauri 2 host crate `buzz-desktop`, tokio, serde, nostr 0.44, buzz-core), Node 24 ESM for the real-run gate (`node:test`, nostr-tools), the existing `@colony-native:` stdio protocol (`desktop/electron/native-host.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md`; screen pack `docs/superpowers/specs/2026-10-11-colony-os-screens/` (engine items E-01, E-10, E-12, E-13, E-14, E-29 in `10-data-and-engine.md`); contract `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md` (host contract, phase 0 gate).


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 1, 2, 11, 12, 13 and 19. Where they differ from the tasks below, the amendments win.

## Global Constraints

- Everything in `00-overview.md`, "Global constraints", applies to every task here.
- No em dashes (U+2014) in code, comments, strings, docs or commit messages.
- No new `unwrap()` or `expect()` in production paths (tests may use them). No new `unsafe`: process signalling goes through the existing helper `signal_process_group_or_leader` in `runtime/process.rs`.
- New public API gets doc comments.
- Desktop Rust files stay at or under 1500 lines, and a file already over the cap may not grow (`desktop/scripts/file-size-policy.mjs:3`). `src/managed_agents/discovery/tests.rs` is 1756 lines today.
- Every text a person can see (refusals, problem details, hello messages) is plain words: no file paths, no error codes, no key material, never "Buzz", "Fizz" or "Honey".
- Rust test command for every task, from the worktree root (`--no-default-features` keeps the OS keychain out of tests):
  `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib <filter>)`
- Node test command: `cd desktop && node --test <file>`.
- Lock order: the team runner's mutexes are leaf locks. Never hold one while calling runtime, store or relay code, and never take one while holding another.
- An item a later task wires (for example `emit_status` before Task 4.8) may warn as unused in an intermediate commit; Task 4.16 runs clippy with `-D warnings` on the finished part.
- Commit with `git commit -s`. One commit per task. Workers open a PR into `develop` and never merge to `main`. GitHub CI is the gate.

## Review Focus

1. **The computer sleeps or Colony quits in the middle of a hire** (overview review focus 1). Expected: the next start finishes the hire exactly once: one employee record, one hello, one Complete, the owner in the home channel first, the company time zone sent. Pinned by `interrupted_hire_resumes_to_exactly_one_employee_hello_and_complete` (Task 4.10, which kills the host at every boundary of a hire) and gate step 7 (Task 4.15).
2. **The owner signs in on a second computer before the move flow exists** (overview review focus 2). Expected: only the computer named in the team computer record runs employees; the other spawns none and says where the team runs. Pinned by `spawn_refusal_names_the_computer_that_runs_the_team`, `clearance_fences_only_saved_companies`, `launch_candidates_are_empty_when_this_computer_may_not_run_the_team` (Task 4.4), the compile-time fence token in `spawn_agent_child` (Task 4.5) and gate step 10 (Task 4.15).
3. **An employee keeps crashing.** Expected: restarts wait 5 s, 15 s, 45 s, 2 min and 5 min; the fifth counted exit within ten minutes stops restarting and reports one crash loop, never a restart storm; a credits exit (75 or 77, settled by part I's seam) never counts. Pinned by `fifth_exit_in_ten_minutes_is_a_crash_loop_and_stops_restarts`, `a_restart_that_dies_at_once_is_counted_not_repeated` and `credits_exits_never_count_toward_the_crash_window` (Task 4.7).
4. **A person stops an employee on purpose (old app, pause, delete).** Expected: the supervisor never restarts it. Pinned by `an_employee_stopped_on_purpose_is_never_restarted` (Task 4.7) and `stop_hooks_only_track_saved_company_relays` (Task 4.8, through the production hook functions).
5. **The team is paused and the computer restarts.** Expected: nothing starts until someone resumes. Pinned by `a_paused_team_stays_paused_after_a_restart` (Task 4.9).

## Before you start

This part consumes, and only consumes, these items from earlier parts (names from `00-overview.md`):

- Part A: `buzz_core_pkg::kind::{KIND_BUSINESS_PROFILE_HEAD, KIND_TEAM_COMPUTER_HEAD, KIND_TEAM_COMPUTER_ACTION}` (30657, 30658, 47047); `buzz_core_pkg::team_computer::{TeamComputerAction, TeamComputerActionKind, TEAM_COMPUTER_D_TAG, TEAM_COMPUTER_HEARTBEAT_MIN_SECS}`; `buzz_sdk_pkg::team_computer::build_team_computer_action`; `buzz_core_pkg::company_profile::BUSINESS_PROFILE_D_TAG`; the relay rules: a claim from the current holder succeeds and refreshes its name and time, heartbeats less than 60 s apart are refused with `rate-limited:`, only the head changes on a heartbeat, a released head carries `releasedAt`; the accounts endpoints and self-serve company creation (gate only).
- Part B: `buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire}`, the `HireRolePack` v2 fields `owns`, `channel`, `duties`, `on_hire`, `ask_before`, `home`, `HireAction.time_zone: Option<String>`, `buzz_core_pkg::company_duties::is_timezone_label`, the v2 rules in `validate_hire_proposal`, and the relay rules for `complete` (the owner and the employee are members of the home channel; a replay is answered `duplicate:`; the kickoff is posted with it).
- Part C: `crates/buzz-acp/src/voice.md` and `buzz_acp::VOICE_RULES`; the harness reads `COLONY_ROLE_CONTEXT`, `COLONY_WAKE_LEDGER` and `BUZZ_ACP_REPLAY_FLOOR` (clamped to 15 minutes), and logs `wake ledger could not be saved` while it cannot save its ledger.
- Part I (later) fills the bodies of the `credits_pause` stub this part creates and imports `crate::managed_agents::team_runner::{PauseReason, pause_company, resume_company}`.

The desktop crate already depends on `buzz-core` as `buzz_core_pkg` (`desktop/src-tauri/Cargo.toml:116`) and on `buzz-acp` (`desktop/src-tauri/Cargo.toml:82`), so it reuses those types instead of mirroring them.

All paths below are relative to `desktop/src-tauri/` unless they start with `desktop/`, `crates/` or `docs/`.

## File map

| File | Responsibility | Tasks |
|-|-|-|
| `src/managed_agents/types.rs` | Company role v2 fields and rules; record fields `company_role`, `role_context`; lenient field reader | 4.1, 4.2 |
| `src/managed_agents/types/company_role_tests.rs` (new) | Role pack v2 tests and parity with the core hire validator | 4.1 |
| `src/managed_agents/types/role_context.rs` (new) | `RoleContext` and `validate_role_context` | 4.2 |
| `src/managed_agents/types/requests.rs` | `CreateManagedAgentRequest.role_context` | 4.2 |
| `src/commands/agents.rs` | Store the role context in the same save that creates the employee | 4.2 |
| Record literals across `src/` (script) and `src/managed_agents/discovery/tests.rs` | New record fields | 4.2 |
| `src/managed_agents/team_runner.rs` (new) | Bridge types, state, cache helpers, the spawn fence, hooks, problem words | 4.3, 4.4, 4.7 to 4.12 |
| `src/managed_agents/team_runner/companies.rs`, `computer.rs` (new) | `team-companies.json` with pause reasons; this computer's install id and name | 4.3 |
| `src/managed_agents/team_runner/claim.rs`, `claim_io.rs` (new) | Team computer record: read side and decisions; relay claim, release, refresh | 4.4, 4.6 |
| `src/managed_agents/runtime/employee_env.rs` (new), `runtime.rs`, `reserved_env_keys.rs`, `restore.rs`, `runtime_commands.rs` | Employee spawn environment, the fence at spawn and in restore, the first-start replay floor | 4.5 |
| `src/managed_agents/team_runner/supervisor.rs` (new), `src/managed_agents/credits_pause.rs` (new stub) | Restart policy; the credits seam part I fills | 4.7 |
| `src/managed_agents/team_runner/status.rs`, `watch.rs` (new), `runtime/process.rs`, `runtime/stop.rs`, `runtime_commands.rs` | Status, problems (including `disk_full`), the supervisor loop, stop and spawn hooks, `request_graceful_exit` | 4.8 |
| `src/managed_agents/team_runner/launch.rs` (new), `src/lib.rs` | Start on launch without an interface, heartbeat, pause and resume with reasons | 4.9 |
| `src/managed_agents/team_runner/hire_journal.rs`, `hire.rs` (new) | The hire journal and the step machine | 4.10 |
| `src/managed_agents/team_runner/hire_relay.rs` (new), `Cargo.toml` | The relay side of a hire; resuming hires; `iana-time-zone` | 4.11 |
| `src/managed_agents/team_runner/commands.rs` (new), `src/lib.rs`, `desktop/electron/native-host.mjs` | The nine commands and their registration; old shell deadlines | 4.12 |
| `src/managed_agents/personas.rs`, `personas/tests.rs` | Code-owned built-in company roles, "Test Employee" fixture pack | 4.13 |
| `src/managed_agents/nest.rs`, `nest_skill.md`, `nest/voice_rules_tests.rs` (new) | Voice rules in the skill and the managed AGENTS.md section | 4.14 |
| `desktop/tests/real-run/team-host/*` (new), `desktop/package.json` | Phase 0 real-run gate | 4.15 |

---

### Task 4.1: Company role v2 fields and validator

**Files:**
- Modify: `src/managed_agents/types.rs:1-2` (re-export core types), `:21-32` (`CompanyRoleMetadata`), `:72-80` (tail of `validate_company_role_metadata`), `:1082-1083` (test modules)
- Modify: `src/managed_agents/types/tests.rs:104-113` (the one existing `CompanyRoleMetadata` literal)
- Create: `src/managed_agents/types/company_role_tests.rs`
- Test: `src/managed_agents/types/company_role_tests.rs`

**Interfaces:**
- Consumes: Part B `buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire, HireProposal, validate_hire_proposal}`; existing `buzz_core_pkg::company_duties::parse_readable_schedule(&str) -> Option<String>` (`crates/buzz-core/src/company_duties.rs:242`) and `buzz_core_pkg::company_records::is_decimal`.
- Produces: `CompanyRoleMetadata` gains `owns: Option<String>`, `channel: Option<String>`, `duties: Vec<RoleDutyTemplate>`, `on_hire: Option<RoleOnHire>`, `ask_before: Vec<String>`, `home: Option<String>` (camelCase keys, omitted when empty, so a v1 role keeps its bytes). `crate::managed_agents::{RoleDutyTemplate, RoleOnHire}` (re-exported core types). `validate_company_role_metadata` enforces the v2 rules with errors that name the field.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/types/company_role_tests.rs`:

```rust
//! Role pack v2 on the desktop company role: the camelCase wire shape a hire
//! copies into its role pack, its bounds, and parity with the core hire
//! validator the relay runs on that same role pack.

use super::{
    validate_company_role_metadata, CompanyRoleMetadata, CompanyRoleTool, CompanyToolRisk,
    RoleDutyTemplate, RoleOnHire,
};
use serde_json::json;

fn v2_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Post one short note a day".to_string(),
        skills: vec!["Writing short updates".to_string()],
        tools: vec![CompanyRoleTool {
            name: "notes".to_string(),
            risk: CompanyToolRisk::Low,
        }],
        worker_menu: vec!["claude".to_string(), "codex".to_string()],
        default_allowance: Some("2".to_string()),
        owns: Some("One short note in the home channel every day".to_string()),
        channel: Some("test-employee".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Daily note".to_string(),
            schedule_text: "Every day at 09:00".to_string(),
            instructions: "Post one short note.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["business profile".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["anything public outside this channel".to_string()],
        home: Some("test.note".to_string()),
    }
}

fn on_hire(sources: Vec<String>, plan_horizon_days: u8) -> Option<RoleOnHire> {
    Some(RoleOnHire {
        sources,
        plan_horizon_days,
    })
}

/// One mutation per v2 rule. The name must appear in the desktop error so the
/// person editing the role sees which field is wrong.
type Mutation = (&'static str, fn(&mut CompanyRoleMetadata));

fn invalid_v2_mutations() -> Vec<Mutation> {
    vec![
        ("owns", |role| role.owns = Some("   ".to_string())),
        ("owns", |role| role.owns = Some("o".repeat(501))),
        ("channel", |role| role.channel = Some(String::new())),
        ("channel", |role| role.channel = Some("Team Room".to_string())),
        ("channel", |role| role.channel = Some("e".repeat(81))),
        ("duties", |role| role.duties = vec![role.duties[0].clone(); 9]),
        ("duty title", |role| role.duties[0].title = " ".to_string()),
        ("duty title", |role| role.duties[0].title = "t".repeat(121)),
        ("duty schedule", |role| {
            role.duties[0].schedule_text = "Tomorrow at 08:00".to_string()
        }),
        ("duty instructions", |role| {
            role.duties[0].instructions = String::new()
        }),
        ("duty instructions", |role| {
            role.duties[0].instructions = "i".repeat(2_001)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec!["s".to_string(); 9], 14)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec![" ".to_string()], 14)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec!["s".repeat(201)], 14)
        }),
        ("plan horizon", |role| role.on_hire = on_hire(Vec::new(), 0)),
        ("plan horizon", |role| role.on_hire = on_hire(Vec::new(), 31)),
        ("ask-before", |role| role.ask_before = vec!["a".to_string(); 17]),
        ("ask-before", |role| role.ask_before = vec![String::new()]),
        ("ask-before", |role| role.ask_before = vec!["a".repeat(121)]),
        ("home", |role| role.home = Some(" ".to_string())),
        ("home", |role| role.home = Some("h".repeat(81))),
    ]
}

#[test]
fn v2_role_reads_the_camel_case_wire_shape_and_v1_roles_keep_their_bytes() {
    let role: CompanyRoleMetadata = serde_json::from_value(json!({
        "job": "Post one short note a day",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"],
        "owns": "One short note a day",
        "channel": "test-employee",
        "duties": [{
            "title": "Daily note",
            "scheduleText": "Every day at 09:00",
            "instructions": "Post one short note."
        }],
        "onHire": { "sources": ["business profile"] },
        "askBefore": ["anything public"],
        "home": "test.note"
    }))
    .expect("a v2 role parses");
    assert_eq!(role.duties[0].schedule_text, "Every day at 09:00");
    assert_eq!(
        role.on_hire.as_ref().map(|on_hire| on_hire.plan_horizon_days),
        Some(14),
        "the plan horizon defaults to 14 days"
    );
    validate_company_role_metadata(&role).expect("the v2 role is valid");

    let v1 = json!({
        "job": "Review work",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"]
    });
    let parsed: CompanyRoleMetadata =
        serde_json::from_value(v1.clone()).expect("a v1 role still parses");
    assert_eq!(serde_json::to_value(&parsed).expect("role serializes"), v1);
}

#[test]
fn v2_role_bounds_reject_each_rule_by_name() {
    validate_company_role_metadata(&v2_role()).expect("the base v2 role is valid");
    for (rule, mutate) in invalid_v2_mutations() {
        let mut role = v2_role();
        mutate(&mut role);
        let Err(error) = validate_company_role_metadata(&role) else {
            panic!("{rule} must be rejected");
        };
        assert!(error.contains(rule), "{rule}: unexpected error {error}");
    }
}

/// A hire copies a persona's company role into the proposal's role pack and
/// the relay validates it with buzz-core. Every role the desktop accepts must
/// be a pack core accepts, and every v2 rule the desktop enforces must be one
/// core enforces too.
#[test]
fn desktop_role_rules_match_the_core_hire_validator() {
    fn core_accepts(role: &CompanyRoleMetadata) -> bool {
        let mut pack = serde_json::to_value(role).expect("role serializes");
        pack["personaId"] = json!("builtin:test-employee");
        pack["title"] = json!("Test Employee");
        let proposal = json!({
            "hireId": "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10",
            "rolePack": pack,
            "displayName": "Gate Tester",
            "title": "Test Employee",
            "introductionChannelId": "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c",
            "runtimeId": "claude"
        });
        serde_json::from_value::<buzz_core_pkg::company_records::HireProposal>(proposal)
            .is_ok_and(|proposal| {
                buzz_core_pkg::company_records::validate_hire_proposal(&proposal).is_ok()
            })
    }

    assert!(core_accepts(&v2_role()), "a valid desktop role is a valid core role pack");
    for (rule, mutate) in invalid_v2_mutations() {
        let mut role = v2_role();
        mutate(&mut role);
        assert!(validate_company_role_metadata(&role).is_err(), "desktop rejects {rule}");
        assert!(!core_accepts(&role), "core rejects {rule} too");
    }
}
```

Register it in `src/managed_agents/types.rs`. Replace (lines 1082-1083):

```rust
#[cfg(test)]
mod tests;
```

with:

```rust
#[cfg(test)]
mod tests;
#[cfg(test)]
mod company_role_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::types::company_role_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved imports super::RoleDutyTemplate, super::RoleOnHire` and `error[E0560]: struct CompanyRoleMetadata has no field named owns`.

- [ ] **Step 3: Implement**

In `src/managed_agents/types.rs`, replace lines 1-2:

```rust
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, process::Child};
```

with:

```rust
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, process::Child};

/// Role pack v2 building blocks. The desktop depends on buzz-core, so the
/// company role reuses the relay's own types and the two cannot drift.
pub use buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire};
```

Replace the struct at lines 21-32 (from `/// Non-authoritative company role metadata stored on a real persona catalog entry.` through the closing `}` of `CompanyRoleMetadata`) with:

```rust
/// Non-authoritative company role metadata stored on a real persona catalog entry.
///
/// The v2 fields are optional and omitted when empty, so a role written before
/// them serializes byte for byte as it did.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CompanyRoleMetadata {
    pub job: String,
    pub skills: Vec<String>,
    pub tools: Vec<CompanyRoleTool>,
    /// Runtime identifiers sourced from live ACP discovery.
    pub worker_menu: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_allowance: Option<String>,
    /// The outcome the role owns, used as the title of its goal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owns: Option<String>,
    /// Default home channel name (`a-z`, `0-9` and `-`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    /// Default routines, approved by the founder's hire signature.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub duties: Vec<RoleDutyTemplate>,
    /// What a new employee studies first and how long its first plan covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_hire: Option<RoleOnHire>,
    /// Actions that always need a person first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ask_before: Vec<String>,
    /// The role's desk screen id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
}
```

Replace the tail of `validate_company_role_metadata` (lines 72-80):

```rust
    if let Some(allowance) = value.default_allowance.as_deref() {
        if allowance.len() > 24 || !buzz_core_pkg::company_records::is_decimal(allowance) {
            return Err(
                "company role default allowance must be a non-negative decimal".to_string(),
            );
        }
    }
    Ok(())
}
```

with:

```rust
    if let Some(allowance) = value.default_allowance.as_deref() {
        if allowance.len() > 24 || !buzz_core_pkg::company_records::is_decimal(allowance) {
            return Err(
                "company role default allowance must be a non-negative decimal".to_string(),
            );
        }
    }
    validate_company_role_v2(value)
}

/// Non-blank text of at most `max` characters, counted untrimmed the way the
/// core hire validator counts, so a role the desktop accepts the relay accepts.
fn role_text_within(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max
}

/// Role pack v2 rules. They mirror `validate_hire_proposal` in buzz-core,
/// which the relay runs on the role pack a hire copies from this role.
fn validate_company_role_v2(value: &CompanyRoleMetadata) -> Result<(), String> {
    if value
        .owns
        .as_deref()
        .is_some_and(|owns| !role_text_within(owns, 500))
    {
        return Err("company role owns must be 1 to 500 characters".to_string());
    }
    if value.channel.as_deref().is_some_and(|channel| {
        channel.is_empty()
            || channel.len() > 80
            || !channel
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }) {
        return Err(
            "company role channel must be 1 to 80 characters of a-z, 0-9 and -".to_string(),
        );
    }
    if value.duties.len() > 8 {
        return Err("company role duties are limited to 8".to_string());
    }
    for duty in &value.duties {
        if !role_text_within(&duty.title, 120) {
            return Err("company role duty title must be 1 to 120 characters".to_string());
        }
        let schedule = &duty.schedule_text;
        if buzz_core_pkg::company_duties::parse_readable_schedule(schedule).is_none() {
            return Err(format!(
                "company role duty schedule {schedule:?} is not a supported schedule"
            ));
        }
        if !role_text_within(&duty.instructions, 2_000) {
            return Err(
                "company role duty instructions must be 1 to 2000 characters".to_string(),
            );
        }
    }
    if let Some(on_hire) = &value.on_hire {
        if on_hire.sources.len() > 8
            || on_hire
                .sources
                .iter()
                .any(|source| !role_text_within(source, 200))
        {
            return Err(
                "company role on-hire sources must be 1 to 200 characters and limited to 8"
                    .to_string(),
            );
        }
        if !(1..=30).contains(&on_hire.plan_horizon_days) {
            return Err("company role plan horizon must be 1 to 30 days".to_string());
        }
    }
    if value.ask_before.len() > 16
        || value
            .ask_before
            .iter()
            .any(|action| !role_text_within(action, 120))
    {
        return Err(
            "company role ask-before entries must be 1 to 120 characters and limited to 16"
                .to_string(),
        );
    }
    if value
        .home
        .as_deref()
        .is_some_and(|home| !role_text_within(home, 80))
    {
        return Err("company role home must be 1 to 80 characters".to_string());
    }
    Ok(())
}
```

In `src/managed_agents/types/tests.rs`, the existing literal (lines 104-113) gains the new fields. Replace:

```rust
        worker_menu: vec!["runtime-discovered".to_string()],
        default_allowance: Some("25.50".to_string()),
    };
    assert!(validate_company_role_metadata(&valid).is_ok());
```

with:

```rust
        worker_menu: vec!["runtime-discovered".to_string()],
        default_allowance: Some("25.50".to_string()),
        owns: None,
        channel: None,
        duties: Vec::new(),
        on_hire: None,
        ask_before: Vec::new(),
        home: None,
    };
    assert!(validate_company_role_metadata(&valid).is_ok());
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::types)`
Expected: PASS (the three `company_role_tests` tests and every existing `managed_agents::types` test, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/types.rs desktop/src-tauri/src/managed_agents/types/company_role_tests.rs desktop/src-tauri/src/managed_agents/types/tests.rs
git commit -s -m "feat(desktop): add role pack v2 fields to company role metadata"
```

---

### Task 4.2: Keep the persona company role, add the role context to employee records

The bug: `ManagedAgentRecord` (`src/managed_agents/types.rs:319-573`) has no `company_role`, so `AgentDefinition::into_agent_record` (`types.rs:197-259`) drops it and `to_definition_view` sets `None` (`types.rs:270`). `save_personas` (`personas.rs:451`) folds every persona through `into_agent_record`, and `load_personas` (`personas.rs:399`) reads them back through `to_definition_view`, so a persona's role is lost on every save and reload. This task adds `company_role` and, in the same pass over the record literals, the employee field `role_context` that Tasks 4.5 and 4.11 use. It also lets `create_managed_agent` store the role context in the same save that creates the record (one user action, one atomic persist), which is how a resumed hire finds its employee.

**Files:**
- Create: `src/managed_agents/types/role_context.rs`
- Modify: `src/managed_agents/types.rs:254-259` (`into_agent_record` tail), `:268-270` (`to_definition_view` head), `:571-575` (record fields), `:906-908` (lenient reader after `default_record_active`), `:1079-1080` (module)
- Modify: `src/managed_agents/types/requests.rs:206-209` (`CreateManagedAgentRequest` tail)
- Modify: `src/commands/agents.rs:363-368` (validation), and the record literal that ends at `:702`
- Modify: every other `ManagedAgentRecord { .. }` literal (Step 6 script) and `src/managed_agents/discovery/tests.rs:207-273` (fixture rebuilt from JSON; the file may not grow)
- Test: `src/managed_agents/types/tests.rs` (append)

**Interfaces:**
- Consumes: Task 4.1 `CompanyRoleMetadata`.
- Produces: `crate::managed_agents::RoleContext { title: String, job: String, owns: Option<String>, ask_before: Vec<String>, manager_name: Option<String>, home_channel_id: Option<String>, goal_id: Option<String>, on_hire_sources: Vec<String>, plan_horizon_days: u8 }` (camelCase, every key serialized, optional keys tolerated on load, `planHorizonDays` defaults to 14); `crate::managed_agents::validate_role_context(&RoleContext) -> Result<(), String>`; `ManagedAgentRecord.company_role: Option<CompanyRoleMetadata>` and `.role_context: Option<RoleContext>` (snake_case record keys, omitted when `None`, an unreadable stored value degrades to `None`); `CreateManagedAgentRequest.role_context: Option<RoleContext>` (JSON key `roleContext`).

- [ ] **Step 1: Write the failing test for the round trip bug**

Append to the end of `src/managed_agents/types/tests.rs`, after the last test (`summary_with_drift_serializes_restart_diff_entries`, whose last lines are):

```rust
            "change": { "kind": "value", "before": "gpt-5", "after": "claude-4" },
        }]))
    );
}
```

append:

```rust

// Hire fields on the unified agent store.

fn employee_role() -> CompanyRoleMetadata {
    serde_json::from_value(serde_json::json!({
        "job": "Post one short note a day",
        "skills": ["Writing short updates"],
        "tools": [{ "name": "notes", "risk": "low" }],
        "workerMenu": ["claude", "codex"],
        "defaultAllowance": "2",
        "owns": "One short note a day",
        "channel": "test-employee",
        "duties": [{
            "title": "Daily note",
            "scheduleText": "Every day at 09:00",
            "instructions": "Post one short note."
        }],
        "onHire": { "sources": ["business profile"], "planHorizonDays": 14 },
        "askBefore": ["anything public"],
        "home": "test.note"
    }))
    .expect("employee role parses")
}

/// Save then load the way the persona shim does: `save_personas` folds each
/// definition through `into_agent_record` and the store writer serializes
/// with `serde_json::to_vec_pretty`; `load_personas` parses the store and
/// reads each definition back through `to_definition_view`.
fn store_round_trip(records: &[ManagedAgentRecord]) -> Vec<ManagedAgentRecord> {
    let bytes = serde_json::to_vec_pretty(records).expect("agent store serializes");
    serde_json::from_slice(&bytes).expect("agent store parses")
}

#[test]
fn persona_company_role_survives_the_agent_store_round_trip() {
    let mut persona = sample_persona();
    persona.company_role = Some(employee_role());

    let stored = store_round_trip(&[persona.clone().into_agent_record()]);
    let view = stored[0]
        .to_definition_view()
        .expect("slugged record must present a persona view");

    assert_eq!(view.company_role, persona.company_role);
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib persona_company_role_survives_the_agent_store_round_trip)`
Expected: FAIL with "assertion `left == right` failed" where `left: None` and `right: Some(CompanyRoleMetadata { job: "Post one short note a day", .. })`. This is the save and reload bug.

- [ ] **Step 3: Write the role context tests**

Append to the end of `src/managed_agents/types/tests.rs`:

```rust

use super::{validate_role_context, RoleContext};

fn employee_context() -> RoleContext {
    RoleContext {
        title: "Test Employee".to_string(),
        job: "Post one short note a day".to_string(),
        owns: Some("One short note a day".to_string()),
        ask_before: vec!["anything public".to_string()],
        manager_name: Some("Scout".to_string()),
        home_channel_id: Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c".to_string()),
        goal_id: Some("6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10".to_string()),
        on_hire_sources: vec!["business profile".to_string()],
        plan_horizon_days: 14,
    }
}

#[test]
fn legacy_agent_store_record_loads_without_hire_fields_and_writes_none() {
    let record = sample_agent_record();
    assert_eq!(record.company_role, None);
    assert_eq!(record.role_context, None);
    let json = serde_json::to_string(&record).expect("record serializes");
    for key in ["company_role", "role_context"] {
        assert!(!json.contains(key), "absent {key} must stay absent on disk: {json}");
    }
}

#[test]
fn hired_employee_role_context_survives_the_agent_store_round_trip() {
    let mut record = sample_agent_record();
    record.role_context = Some(employee_context());

    let stored = store_round_trip(std::slice::from_ref(&record));
    assert_eq!(stored[0], record);

    let json = serde_json::to_value(&record).expect("record serializes");
    assert_eq!(
        json["role_context"]["askBefore"],
        serde_json::json!(["anything public"]),
        "the stored role context uses the camelCase shape the harness reads"
    );
    assert_eq!(json["role_context"]["goalId"], "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10");
}

#[test]
fn role_context_serializes_every_key_and_loads_without_optional_ones() {
    let mut context = employee_context();
    context.owns = None;
    context.ask_before = Vec::new();
    let json = serde_json::to_value(&context).expect("role context serializes");
    assert_eq!(json["owns"], serde_json::Value::Null);
    assert_eq!(json["askBefore"], serde_json::json!([]));

    let minimal: RoleContext =
        serde_json::from_value(serde_json::json!({ "title": "Test Employee", "job": "Notes" }))
            .expect("a role context without optional keys loads");
    assert_eq!(minimal.plan_horizon_days, 14);
    assert!(minimal.ask_before.is_empty());
}

#[test]
fn role_context_bounds_are_enforced() {
    validate_role_context(&employee_context()).expect("the sample context is valid");
    let cases: Vec<(&str, fn(&mut RoleContext))> = vec![
        ("title", |c| c.title = " ".to_string()),
        ("job", |c| c.job = "j".repeat(2_001)),
        ("owns", |c| c.owns = Some("o".repeat(501))),
        ("ask-before", |c| c.ask_before = vec!["a".to_string(); 17]),
        ("home channel", |c| c.home_channel_id = Some("not-a-uuid".to_string())),
        ("goal", |c| c.goal_id = Some("not-a-uuid".to_string())),
        ("on-hire sources", |c| c.on_hire_sources = vec!["s".repeat(201)]),
        ("plan horizon", |c| c.plan_horizon_days = 0),
    ];
    for (rule, mutate) in cases {
        let mut context = employee_context();
        mutate(&mut context);
        let Err(error) = validate_role_context(&context) else {
            panic!("{rule} must be rejected");
        };
        assert!(error.contains(rule), "{rule}: unexpected error {error}");
    }
}

#[test]
fn unreadable_hire_fields_degrade_without_dropping_the_agent_store() {
    let mut value = serde_json::to_value(sample_agent_record()).expect("serialize fixture");
    value["company_role"] = serde_json::json!({
        "job": "Review work",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"],
        "keyFromANewerBuild": true
    });
    value["role_context"] = serde_json::json!({ "title": 7 });
    let records: Vec<ManagedAgentRecord> = serde_json::from_value(serde_json::json!([value]))
        .unwrap_or_else(|error| panic!("one role field must not drop the agent store: {error}"));

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].company_role, None);
    assert_eq!(records[0].role_context, None);
}

#[test]
fn create_request_accepts_a_role_context() {
    let request: CreateManagedAgentRequest = serde_json::from_value(serde_json::json!({
        "name": "Gate Tester",
        "relayUrl": null,
        "acpCommand": "buzz-acp",
        "agentCommand": "claude-agent-acp",
        "mcpCommand": null,
        "turnTimeoutSeconds": null,
        "idleTimeoutSeconds": null,
        "maxTurnDurationSeconds": null,
        "parallelism": null,
        "systemPrompt": null,
        "avatarUrl": null,
        "model": null,
        "provider": null,
        "roleContext": serde_json::to_value(employee_context()).expect("context serializes")
    }))
    .expect("create request parses");
    assert_eq!(request.role_context, Some(employee_context()));
}
```

Run the Step 2 command again. Expected: FAIL to compile with `error[E0432]: unresolved imports super::validate_role_context, super::RoleContext` and `error[E0609]: no field role_context on type ManagedAgentRecord`.

- [ ] **Step 4: Add the `RoleContext` type**

Create `src/managed_agents/types/role_context.rs`:

```rust
//! The role context a hired employee runs with. It is stored on the
//! employee's record and exported to the harness as `COLONY_ROLE_CONTEXT`
//! (see `runtime::employee_env`).

use serde::{Deserialize, Serialize};

/// Days a new employee's first plan covers when nothing else is said.
const DEFAULT_PLAN_HORIZON_DAYS: u8 = 14;

fn default_plan_horizon_days() -> u8 {
    DEFAULT_PLAN_HORIZON_DAYS
}

/// What a hired employee needs to know about its role.
///
/// Serialized as camelCase with every key present (`null` or `[]` when
/// empty): that is the JSON the harness reads. Loading tolerates missing
/// optional keys, so a record written by another build still loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleContext {
    /// The employee's configured title.
    pub title: String,
    /// The role's job, from the hired role pack.
    pub job: String,
    /// The outcome the role owns (the title of its goal).
    #[serde(default)]
    pub owns: Option<String>,
    /// Actions that always need a person first.
    #[serde(default)]
    pub ask_before: Vec<String>,
    /// Display name of the employee's manager, when it has one.
    #[serde(default)]
    pub manager_name: Option<String>,
    /// UUID of the employee's home channel.
    #[serde(default)]
    pub home_channel_id: Option<String>,
    /// UUID of the employee's goal, which is the hire id.
    #[serde(default)]
    pub goal_id: Option<String>,
    /// What the employee studies first.
    #[serde(default)]
    pub on_hire_sources: Vec<String>,
    /// Days the first plan covers, 1 to 30.
    #[serde(default = "default_plan_horizon_days")]
    pub plan_horizon_days: u8,
}

/// Bounds for a role context, matching the role pack v2 rules it is built from.
pub fn validate_role_context(context: &RoleContext) -> Result<(), String> {
    let text = |value: &str, max: usize| !value.trim().is_empty() && value.chars().count() <= max;
    if !text(&context.title, 120) {
        return Err("role context title must be 1 to 120 characters".to_string());
    }
    if !text(&context.job, 2_000) {
        return Err("role context job must be 1 to 2000 characters".to_string());
    }
    if context.owns.as_deref().is_some_and(|owns| !text(owns, 500)) {
        return Err("role context owns must be 1 to 500 characters".to_string());
    }
    if context.ask_before.len() > 16 || context.ask_before.iter().any(|item| !text(item, 120)) {
        return Err(
            "role context ask-before entries must be 1 to 120 characters and limited to 16"
                .to_string(),
        );
    }
    if context
        .manager_name
        .as_deref()
        .is_some_and(|name| !text(name, 120))
    {
        return Err("role context manager name must be 1 to 120 characters".to_string());
    }
    for (label, id) in [
        ("home channel", &context.home_channel_id),
        ("goal", &context.goal_id),
    ] {
        if id
            .as_deref()
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
        {
            return Err(format!("role context {label} must be a UUID"));
        }
    }
    if context.on_hire_sources.len() > 8
        || context.on_hire_sources.iter().any(|source| !text(source, 200))
    {
        return Err(
            "role context on-hire sources must be 1 to 200 characters and limited to 8"
                .to_string(),
        );
    }
    if !(1..=30).contains(&context.plan_horizon_days) {
        return Err("role context plan horizon must be 1 to 30 days".to_string());
    }
    Ok(())
}
```

In `src/managed_agents/types.rs`, replace (lines 1079-1080):

```rust
mod teams;
pub use teams::{CreateTeamRequest, TeamRecord, UpdateTeamRequest};
```

with:

```rust
mod teams;
pub use teams::{CreateTeamRequest, TeamRecord, UpdateTeamRequest};
mod role_context;
pub use role_context::{validate_role_context, RoleContext};
```

- [ ] **Step 5: Add the record fields, carry the role through the fold, accept it at create**

In `src/managed_agents/types.rs`, replace the end of `ManagedAgentRecord` (lines 571-575):

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
}

#[derive(Debug)]
pub struct ManagedAgentProcess {
```

with:

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
    /// Company role of a key-less definition record (a persona), so the role
    /// survives `save_personas` and `load_personas`. Instances leave it unset
    /// and read the role through their definition.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_optional"
    )]
    pub company_role: Option<CompanyRoleMetadata>,
    /// What a hired employee knows about its role, exported at spawn as
    /// `COLONY_ROLE_CONTEXT`. Unset for agents that were not hired. Its
    /// `goal_id` is the hire id, which is how a resumed hire finds its employee.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_optional"
    )]
    pub role_context: Option<RoleContext>,
}

#[derive(Debug)]
pub struct ManagedAgentProcess {
```

Replace `default_record_active` (lines 906-908):

```rust
fn default_record_active() -> bool {
    true
}
```

with:

```rust
fn default_record_active() -> bool {
    true
}

/// Read an optional stored value and degrade one this build cannot read to
/// `None`, so one unreadable field never drops the whole agent store (the
/// same rule `AcpSessionPolicy` follows). A record written by a newer build
/// can carry role fields this build does not know.
fn lenient_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| match serde_json::from_value(value) {
        Ok(parsed) => Some(parsed),
        Err(error) => {
            eprintln!(
                "managed agent store: ignoring a stored role field this build cannot read: {error}"
            );
            None
        }
    }))
}
```

Replace the end of `into_agent_record` (lines 254-259):

```rust
            definition_parallelism: self.parallelism,
            relay_mesh: None,
            effort_level: None,
        }
    }
}
```

with:

```rust
            definition_parallelism: self.parallelism,
            relay_mesh: None,
            effort_level: None,
            company_role: self.company_role,
            role_context: None,
        }
    }
}
```

Replace the head of `to_definition_view` (lines 268-270):

```rust
        let slug = self.slug.clone()?;
        Some(AgentDefinition {
            company_role: None,
```

with:

```rust
        let slug = self.slug.clone()?;
        Some(AgentDefinition {
            company_role: self.company_role.clone(),
```

In `src/managed_agents/types/requests.rs`, replace the tail of `CreateManagedAgentRequest` (lines 206-209):

```rust
    #[serde(default)]
    pub relay_mesh: Option<RelayMeshConfig>,
}
```

with:

```rust
    #[serde(default)]
    pub relay_mesh: Option<RelayMeshConfig>,
    /// Role context of a hired employee. Stored on the record in the same
    /// save that creates it (the team runner's hire flow).
    #[serde(default)]
    pub role_context: Option<super::RoleContext>,
}
```

This `}` closes `CreateManagedAgentRequest` (the next item is the doc comment of `UpdateManagedAgentRequest` at line 211); check the match is that one before saving.

In `src/commands/agents.rs`, validate the role context before any side effect. Replace (lines 363-368):

```rust
    validate_create_definition(&name, requested_persona_id.as_deref(), &input)?;
    if let Some(parallelism) = input.parallelism {
        if !(1..=32).contains(&parallelism) {
            return Err("parallelism must be between 1 and 32".to_string());
        }
    }
```

with:

```rust
    validate_create_definition(&name, requested_persona_id.as_deref(), &input)?;
    if let Some(parallelism) = input.parallelism {
        if !(1..=32).contains(&parallelism) {
            return Err("parallelism must be between 1 and 32".to_string());
        }
    }
    if let Some(context) = input.role_context.as_ref() {
        crate::managed_agents::validate_role_context(context)?;
    }
```

- [ ] **Step 6: Add the two fields to every other record literal**

Run from the worktree root. The script finds each `ManagedAgentRecord { .. }` struct literal (not signatures, not literals using `..base` update syntax, not ones already updated) and inserts the two `None` fields after its `effort_level` line. `types.rs` is skipped (edited in Step 5) and `discovery/tests.rs` is skipped (rebuilt in Step 7).

```bash
python3 - <<'EOF_SCRIPT'
import pathlib
import re

ROOT = pathlib.Path("desktop/src-tauri/src")
SKIP = {
    ROOT / "managed_agents/types.rs",
    ROOT / "managed_agents/discovery/tests.rs",
}
OPEN = re.compile(r"\bManagedAgentRecord\s*\{\s*$")
NEW_FIELDS = ("company_role: None,", "role_context: None,")

edited = []
for path in sorted(ROOT.rglob("*.rs")):
    if path in SKIP:
        continue
    lines = path.read_text().split("\n")
    out, i, changed = [], 0, False
    while i < len(lines):
        line = lines[i]
        match = OPEN.search(line)
        head = line[: match.start()] if match else ""
        if not match or "->" in head or re.search(r"\b(impl|fn|struct|for)\b", head):
            out.append(line)
            i += 1
            continue
        depth, j = 0, i
        while True:
            depth += lines[j].count("{") - lines[j].count("}")
            if depth <= 0 and j > i:
                break
            j += 1
        body = lines[i : j + 1]
        if any(re.match(r"^\s*(\.\.|role_context:)", l) for l in body):
            out.extend(body)
            i = j + 1
            continue
        effort = max(k for k, l in enumerate(body) if re.match(r"^\s*effort_level:", l))
        indent = re.match(r"^(\s*)", body[effort]).group(1)
        body[effort + 1 : effort + 1] = [indent + field for field in NEW_FIELDS]
        out.extend(body)
        i = j + 1
        changed = True
    if changed:
        path.write_text("\n".join(out))
        edited.append(str(path))
print("\n".join(edited))
print(len(edited), "files")
EOF_SCRIPT
```

Expected: the script prints each edited file and ends with `N files` (26 on 11 October 2026, `src/commands/agents.rs` among them). Running it a second time prints `0 files`.

Then store the request's role context in the one literal `create_managed_agent` builds. In `src/commands/agents.rs`, replace:

```rust
            effort_level: None,
            company_role: None,
            role_context: None,
        };

        records.push(record);
```

with:

```rust
            effort_level: None,
            company_role: None,
            role_context: input.role_context.clone(),
        };

        records.push(record);
```

- [ ] **Step 7: Rebuild the discovery fixture from JSON**

`src/managed_agents/discovery/tests.rs` is 1756 lines, above the 1500-line cap, so it may not grow by even one line. Replace the whole `record_with` function (lines 207-273, from the doc line `/// Minimal record for \`record_agent_command\` tests; only resolution inputs vary.` through its closing brace) with:

```rust
/// Minimal record for `record_agent_command` tests; only resolution inputs vary.
/// Built from JSON so a new store field never has to be listed here.
fn record_with(
    runtime: Option<&str>,
    persona_id: Option<&str>,
    override_cmd: Option<&str>,
) -> crate::managed_agents::types::ManagedAgentRecord {
    let mut record: crate::managed_agents::types::ManagedAgentRecord =
        serde_json::from_value(serde_json::json!({
            "pubkey": "",
            "name": "r",
            "relay_url": "",
            "acp_command": "",
            "agent_command": "",
            "agent_args": [],
            "mcp_command": "",
            "turn_timeout_seconds": 0,
            "parallelism": 1,
            "system_prompt": null,
            "start_on_app_launch": false,
            "created_at": "",
            "updated_at": "",
            "last_started_at": null,
            "last_stopped_at": null,
            "last_exit_code": null,
            "last_error": null
        }))
        .expect("minimal record fixture parses");
    record.persona_id = persona_id.map(str::to_string);
    record.agent_command_override = override_cmd.map(str::to_string);
    record.runtime = runtime.map(str::to_string);
    record
}
```

Every other field of the old literal equals its serde default (`session_policy` channel, `private_key_nsec` empty, `auto_restart_on_config_change` true, `is_active` true, every option `None`, every list empty).

- [ ] **Step 8: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::types managed_agents::discovery)`
Expected: PASS (the seven new tests plus the existing types and discovery tests, 0 failed). The run compiles the whole lib test target, so a literal the script missed fails here with `error[E0063]: missing fields company_role and role_context`.

Then: `wc -l desktop/src-tauri/src/managed_agents/discovery/tests.rs`
Expected: fewer than 1756 lines.

- [ ] **Step 9: Commit**

```bash
git status --short desktop/src-tauri/src
git add desktop/src-tauri/src
git commit -s -m "fix(desktop): keep persona company role and store employee role context"
```

`git status` must list only the script's files, `types.rs`, `types/role_context.rs`, `types/requests.rs`, `types/tests.rs`, `commands/agents.rs` and `discovery/tests.rs`.

---

### Task 4.3: Team runner foundations: saved companies and this computer's id

**Files:**
- Create: `src/managed_agents/team_runner.rs`
- Create: `src/managed_agents/team_runner/companies.rs`
- Create: `src/managed_agents/team_runner/computer.rs`
- Create: `src/managed_agents/team_runner/foundation_tests.rs`
- Modify: `src/managed_agents/mod.rs:52` (module list)
- Modify: `src/lib.rs:251` (managed state)
- Test: `src/managed_agents/team_runner/foundation_tests.rs`

**Interfaces:**
- Consumes: `buzz_core_pkg::relay::normalize_relay_url`; `crate::managed_agents::storage::atomic_write_json_restricted` (`storage.rs:696`, durable: the `atomic-write-file` crate syncs before it renames).
- Produces (module `crate::managed_agents::team_runner`):
  - Bridge types from the overview contract, camelCase on the wire: `TeamCompany`, `TeamComputerInfo`, `TeamComputerStatus`, `EmployeeRuntimeStatus` (with `pause_reason: Option<PauseReason>`, omitted when `None`), `EmployeeState` (`starting`, `running`, `paused`, `stopped`, `failing`, `away`), `PauseReason` (`person`, `credits`, `plan_limit`), `ProblemKind` (`start_failed`, `crashed`, `crash_loop`, `credits_out`, `disk_full`), `EmployeeProblem`.
  - `STATUS_EVENT = "team://status"`, `PROBLEM_EVENT = "team://problem"`, `emit_status`, `emit_problem`.
  - `TeamRunnerState` (managed by Tauri), `now_unix()`, `normalize_relay(&str)`, `team_dir(app)` (`<app data>/team`), `saved_companies(app)`, `update_companies(app, change)` (one locked read, change, durable write, cache swap), `load_saved_companies(app)`, `ensure_computer(app)`.
  - `companies::{CompaniesFile, StoredCompany, COMPANIES_FILE, MAX_COMPANIES, load, save}`; `StoredCompany.pause_reasons` is the persisted set of active pause reasons (JSON `pauseReasons`, sorted, each once).
  - `computer::{ComputerIdentity, COMPUTER_FILE, load_or_create, this_computer_name, sanitize_name}`.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/foundation_tests.rs`:

```rust
//! Saved companies, this computer's install id and the bridge wire shapes.

use super::companies::{self, CompaniesFile, COMPANIES_FILE, MAX_COMPANIES};
use super::computer::{self, COMPUTER_FILE};
use super::{
    normalize_relay, EmployeeProblem, EmployeeRuntimeStatus, EmployeeState, PauseReason,
    ProblemKind, TeamCompany, TeamComputerInfo, TeamComputerStatus,
};
use serde_json::json;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PARTNER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const RELAY: &str = "wss://lerato.colony.example";

fn company(relay: &str, owner: &str) -> TeamCompany {
    TeamCompany {
        relay_url: relay.to_string(),
        owner_pubkey: owner.to_string(),
    }
}

fn relay(url: &str) -> String {
    normalize_relay(url).expect("valid relay url")
}

#[test]
fn saved_companies_survive_a_restart_with_their_pause_reasons() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    let mut file = CompaniesFile::default();
    file.replace(vec![company(RELAY, OWNER)])
        .expect("valid companies");
    assert!(file.add_pause(RELAY, PauseReason::Person).expect("saved company"));
    assert!(
        !file.add_pause(RELAY, PauseReason::Person).expect("saved company"),
        "a reason is stored once"
    );
    file.add_pause(RELAY, PauseReason::Credits)
        .expect("saved company");
    companies::save(&path, &file).expect("save");

    let loaded = companies::load(&path).expect("load");
    assert_eq!(loaded, file);
    let saved = loaded.find(RELAY).expect("saved company");
    assert_eq!(
        saved.pause_reasons,
        vec![PauseReason::Person, PauseReason::Credits]
    );
    assert!(saved.is_paused());

    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("json");
    assert_eq!(
        on_disk["companies"][0]["pauseReasons"],
        json!(["person", "credits"])
    );

    let mut resumed = loaded.clone();
    assert!(resumed
        .remove_pause(RELAY, PauseReason::Person)
        .expect("saved company"));
    assert!(resumed.find(RELAY).expect("saved").is_paused(), "credits still hold it");
    resumed
        .remove_pause(RELAY, PauseReason::Credits)
        .expect("saved company");
    assert!(!resumed.find(RELAY).expect("saved").is_paused());
}

#[test]
fn replacing_the_list_keeps_pause_reasons_and_reports_removed_companies() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company("wss://a.colony.example", OWNER),
        company("wss://b.colony.example", OWNER),
    ])
    .expect("valid");
    file.add_pause("wss://a.colony.example", PauseReason::Person)
        .expect("saved");

    let removed = file
        .replace(vec![company("wss://a.colony.example", OWNER)])
        .expect("valid");

    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].relay_url, relay("wss://b.colony.example"));
    assert_eq!(file.companies.len(), 1);
    assert_eq!(file.companies[0].pause_reasons, vec![PauseReason::Person]);
}

#[test]
fn companies_are_validated_deduplicated_and_bounded() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company(RELAY, &OWNER.to_uppercase()),
        company(RELAY, PARTNER),
    ])
    .expect("valid");
    assert_eq!(file.companies.len(), 1, "one entry per relay, the first wins");
    assert_eq!(file.companies[0].owner_pubkey, OWNER);
    assert_eq!(file.companies[0].relay_url, relay(RELAY));

    assert!(file.replace(vec![company(RELAY, "not-a-key")]).is_err());
    let too_many = (0..=MAX_COMPANIES)
        .map(|n| company(&format!("wss://c{n}.colony.example"), OWNER))
        .collect();
    assert!(file.replace(too_many).is_err());
    assert_eq!(file.companies.len(), 1, "a rejected list changes nothing");
}

#[test]
fn a_missing_companies_file_is_empty_and_an_unreadable_one_is_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    assert_eq!(
        companies::load(&path).expect("missing file"),
        CompaniesFile::default()
    );
    std::fs::write(&path, b"{ not json").expect("write");
    assert!(
        companies::load(&path).is_err(),
        "an unreadable file must never read as no companies"
    );
}

#[test]
fn the_active_company_is_the_first_one_this_identity_saved() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company("wss://partner.colony.example", PARTNER),
        company("wss://mine.colony.example", OWNER),
    ])
    .expect("valid");
    let active = file.active(OWNER).expect("owned company");
    assert_eq!(active.relay_url, relay("wss://mine.colony.example"));
    assert!(file
        .active("3333333333333333333333333333333333333333333333333333333333333333")
        .is_none());
}

#[test]
fn this_computer_keeps_one_install_id() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPUTER_FILE);
    let first = computer::load_or_create(&path).expect("created");
    let id = uuid::Uuid::parse_str(&first.computer_id).expect("uuid");
    assert_eq!(id.get_version_num(), 4);
    assert_eq!(first.computer_id, id.to_string(), "lowercase and hyphenated");
    assert_eq!(computer::load_or_create(&path).expect("reused"), first);
}

#[test]
fn an_unreadable_computer_file_is_set_aside_and_replaced() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPUTER_FILE);
    std::fs::write(&path, br#"{"computerId":"not-a-uuid"}"#).expect("write");
    let identity = computer::load_or_create(&path).expect("replaced");
    assert!(uuid::Uuid::parse_str(&identity.computer_id).is_ok());
    assert!(
        path.with_extension("json.invalid").exists(),
        "the old file is kept beside it"
    );
}

#[test]
fn computer_names_are_plain_and_bounded() {
    assert_eq!(
        computer::sanitize_name("  Lerato's MacBook Air\n"),
        "Lerato's MacBook Air"
    );
    assert_eq!(computer::sanitize_name("\u{7}\u{1b}"), "This computer");
    assert_eq!(
        computer::sanitize_name(&"n".repeat(200)).chars().count(),
        80
    );
}

#[test]
fn bridge_types_use_the_contract_wire_shape() {
    let status = EmployeeRuntimeStatus {
        agent_pubkey: OWNER.to_string(),
        name: "Naledi".to_string(),
        state: EmployeeState::Paused,
        since: 1_760_180_000,
        restarts_in_window: 0,
        pause_reason: Some(PauseReason::PlanLimit),
    };
    assert_eq!(
        serde_json::to_value(&status).expect("status"),
        json!({
            "agentPubkey": OWNER,
            "name": "Naledi",
            "state": "paused",
            "since": 1_760_180_000,
            "restartsInWindow": 0,
            "pauseReason": "plan_limit"
        })
    );
    let running = EmployeeRuntimeStatus {
        state: EmployeeState::Running,
        pause_reason: None,
        ..status
    };
    assert!(serde_json::to_value(&running)
        .expect("status")
        .get("pauseReason")
        .is_none());

    let problem = EmployeeProblem {
        agent_pubkey: OWNER.to_string(),
        kind: ProblemKind::DiskFull,
        detail: "This computer is almost out of space, so Naledi is waiting.".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&problem).expect("problem")["kind"],
        "disk_full"
    );

    let computer = TeamComputerStatus {
        this_computer_id: "a".into(),
        holder: Some(TeamComputerInfo {
            computer_id: "b".into(),
            computer_name: "Office iMac".into(),
            last_seen_at: 5,
        }),
        is_this_computer: false,
    };
    assert_eq!(
        serde_json::to_value(&computer).expect("status"),
        json!({
            "thisComputerId": "a",
            "holder": { "computerId": "b", "computerName": "Office iMac", "lastSeenAt": 5 },
            "isThisComputer": false
        })
    );
    let input: TeamCompany =
        serde_json::from_value(json!({ "relayUrl": RELAY, "ownerPubkey": OWNER }))
            .expect("company");
    assert_eq!(input.owner_pubkey, OWNER);
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: FAIL to compile with `error[E0583]: file not found for module team_runner` once Step 3's `mod.rs` line exists, or `could not find team_runner in managed_agents` before it.

- [ ] **Step 3: Implement**

In `src/managed_agents/mod.rs`, replace (line 52):

```rust
pub(crate) mod team_events;
```

with:

```rust
pub(crate) mod team_events;
pub(crate) mod team_runner;
```

Create `src/managed_agents/team_runner.rs`:

```rust
//! The team runner: the host owns "the team runs".
//!
//! For each company saved on this computer (`team-companies.json` in app
//! data), the host starts the employees when Colony starts, finishes a hire
//! as one journaled operation, restarts an employee after an unexpected exit,
//! pauses and resumes the team, and runs a company's employees only while
//! this computer holds the company's team computer record.
//!
//! Lock order: the mutexes in [`TeamRunnerState`] are leaf locks. Code never
//! holds one while it calls runtime, store or relay code, and never takes one
//! while it holds another.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

mod companies;
mod computer;

pub(crate) use companies::{CompaniesFile, StoredCompany};
pub(crate) use computer::ComputerIdentity;

/// Event carrying one [`EmployeeRuntimeStatus`] whenever an employee's state changes.
pub(crate) const STATUS_EVENT: &str = "team://status";
/// Event carrying one [`EmployeeProblem`].
pub(crate) const PROBLEM_EVENT: &str = "team://problem";

/// A company this computer may run, persisted in `team-companies.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamCompany {
    /// The company's relay WebSocket URL.
    pub relay_url: String,
    /// The signed-in person who saved the company on this computer.
    pub owner_pubkey: String,
}

/// The computer named in a company's team computer record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamComputerInfo {
    /// Install id of the holding computer.
    pub computer_id: String,
    /// Name people see, for example "Lerato's MacBook Air".
    pub computer_name: String,
    /// Relay time of the holder's latest claim or heartbeat, Unix seconds.
    pub last_seen_at: i64,
}

/// Which computer runs a company's team, from this computer's point of view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamComputerStatus {
    /// This install's id.
    pub this_computer_id: String,
    /// The computer the record names, `None` when no computer holds the team.
    pub holder: Option<TeamComputerInfo>,
    /// Whether the record names this computer.
    pub is_this_computer: bool,
}

/// Why a company's team is paused. A team runs only when no reason remains.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    /// A person paused the team.
    Person,
    /// The company ran out of credits.
    Credits,
    /// The company reached its plan limit.
    PlanLimit,
}

/// What an employee is doing on this computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeState {
    /// Starting, or waiting to start again after an unexpected exit.
    Starting,
    /// Connected and answering.
    Running,
    /// The company is paused.
    Paused,
    /// Stopped on purpose.
    Stopped,
    /// Kept stopping, so restarts stopped until a person restarts it.
    Failing,
    /// Another computer runs the team.
    Away,
}

/// One employee's runtime status (`team_status` and `team://status`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeRuntimeStatus {
    /// The employee's public key (hex).
    pub agent_pubkey: String,
    /// The employee's name.
    pub name: String,
    /// What the employee is doing.
    pub state: EmployeeState,
    /// When the employee entered `state`, Unix seconds.
    pub since: i64,
    /// Unexpected exits in the last ten minutes.
    pub restarts_in_window: u32,
    /// Why the team is paused; set only when `state` is `paused`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_reason: Option<PauseReason>,
}

/// What went wrong for one employee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemKind {
    /// A start attempt failed.
    StartFailed,
    /// The employee exited unexpectedly and is being restarted.
    Crashed,
    /// The fifth unexpected exit within ten minutes; restarts stopped.
    CrashLoop,
    /// The company ran out of credits.
    CreditsOut,
    /// The employee cannot save its wake ledger (the disk is full).
    DiskFull,
}

/// A problem the interface shows a person (`team://problem`). `detail` is
/// plain words, never a path, key, model name or error code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeProblem {
    /// The employee the problem is about.
    pub agent_pubkey: String,
    /// What went wrong.
    pub kind: ProblemKind,
    /// Plain words for a person.
    pub detail: String,
}

/// Host-wide team runner state, managed by Tauri (`lib.rs`).
#[derive(Default)]
pub(crate) struct TeamRunnerState {
    /// Cache of `team-companies.json`. Writers hold this lock across the
    /// durable write, so the file and the cache never disagree.
    companies: Mutex<CompaniesFile>,
    /// This install's id, loaded or created on first use.
    computer: Mutex<Option<ComputerIdentity>>,
}

/// Unix seconds now.
pub(crate) fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// The canonical form of a relay URL, the key every team record uses.
pub(crate) fn normalize_relay(relay_url: &str) -> Result<String, String> {
    buzz_core_pkg::relay::normalize_relay_url(relay_url).map_err(|error| error.to_string())
}

/// `<app data>/team`, created on first use.
pub(crate) fn team_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("team");
    std::fs::create_dir_all(&dir).map_err(|error| format!("failed to create team dir: {error}"))?;
    Ok(dir)
}

fn poisoned() -> String {
    "team state is unavailable".to_string()
}

fn runner<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, TeamRunnerState>, String> {
    app.try_state::<TeamRunnerState>()
        .ok_or_else(|| "team runner is not ready".to_string())
}

/// Emit one employee's status.
pub(crate) fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &EmployeeRuntimeStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        eprintln!("team runner: failed to emit a status: {error}");
    }
}

/// Emit one problem.
pub(crate) fn emit_problem<R: Runtime>(app: &AppHandle<R>, problem: &EmployeeProblem) {
    if let Err(error) = app.emit(PROBLEM_EVENT, problem) {
        eprintln!("team runner: failed to emit a problem: {error}");
    }
}

/// Load `team-companies.json` into the cache. Runs once at boot, before
/// anything can spawn. An unreadable file is an error: it never reads as
/// "no companies", and it stays on disk untouched.
pub(crate) fn load_saved_companies<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = team_dir(app)?.join(companies::COMPANIES_FILE);
    let file = companies::load(&path)?;
    *runner(app)?.companies.lock().map_err(|_| poisoned())? = file;
    Ok(())
}

/// A copy of the saved companies.
pub(crate) fn saved_companies<R: Runtime>(app: &AppHandle<R>) -> Result<CompaniesFile, String> {
    Ok(runner(app)?
        .companies
        .lock()
        .map_err(|_| poisoned())?
        .clone())
}

/// Change the saved companies as one durable write: the change runs on a
/// copy, the copy is written, and only then does the cache take it.
pub(crate) fn update_companies<R: Runtime, T>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut CompaniesFile) -> Result<T, String>,
) -> Result<T, String> {
    let path = team_dir(app)?.join(companies::COMPANIES_FILE);
    let state = runner(app)?;
    let mut cache = state.companies.lock().map_err(|_| poisoned())?;
    let mut next = cache.clone();
    let out = change(&mut next)?;
    companies::save(&path, &next)?;
    *cache = next;
    Ok(out)
}

/// This install's id, loaded or created once.
pub(crate) fn ensure_computer<R: Runtime>(app: &AppHandle<R>) -> Result<ComputerIdentity, String> {
    let state = runner(app)?;
    if let Some(identity) = state.computer.lock().map_err(|_| poisoned())?.clone() {
        return Ok(identity);
    }
    let path = team_dir(app)?.join(computer::COMPUTER_FILE);
    let identity = computer::load_or_create(&path)?;
    *state.computer.lock().map_err(|_| poisoned())? = Some(identity.clone());
    Ok(identity)
}

#[cfg(test)]
mod foundation_tests;
```

Create `src/managed_agents/team_runner/companies.rs`:

```rust
//! `team-companies.json`: the companies this computer may run, with the set
//! of reasons each one is paused for.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{normalize_relay, PauseReason, TeamCompany};

/// File name inside `<app data>/team`.
pub(crate) const COMPANIES_FILE: &str = "team-companies.json";
/// Most companies one computer keeps.
pub(crate) const MAX_COMPANIES: usize = 5;
const FILE_VERSION: u8 = 1;
const NOT_SET_UP: &str = "This company is not set up on this computer.";

/// One saved company.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredCompany {
    /// Normalized relay URL.
    pub(crate) relay_url: String,
    /// Lowercase hex public key of the person who saved it.
    pub(crate) owner_pubkey: String,
    /// Active pause reasons, sorted, each once. Empty means running.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) pause_reasons: Vec<PauseReason>,
}

impl StoredCompany {
    /// Whether any pause reason holds the team.
    pub(crate) fn is_paused(&self) -> bool {
        !self.pause_reasons.is_empty()
    }
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompaniesFile {
    /// File format version.
    pub(crate) version: u8,
    /// Saved companies in the order the interface gave them.
    #[serde(default)]
    pub(crate) companies: Vec<StoredCompany>,
}

impl Default for CompaniesFile {
    fn default() -> Self {
        Self {
            version: FILE_VERSION,
            companies: Vec::new(),
        }
    }
}

impl CompaniesFile {
    /// The saved company at `relay_url`.
    pub(crate) fn find(&self, relay_url: &str) -> Option<&StoredCompany> {
        let relay = normalize_relay(relay_url).ok()?;
        self.companies
            .iter()
            .find(|company| company.relay_url == relay)
    }

    /// The company this computer runs in phase 0: the first saved company
    /// owned by `identity`.
    pub(crate) fn active(&self, identity: &str) -> Option<&StoredCompany> {
        self.companies
            .iter()
            .find(|company| company.owner_pubkey.eq_ignore_ascii_case(identity))
    }

    /// Replace the saved list. A company that stays keeps its pause reasons.
    /// Returns the companies that were removed. A rejected list changes
    /// nothing.
    pub(crate) fn replace(
        &mut self,
        incoming: Vec<TeamCompany>,
    ) -> Result<Vec<StoredCompany>, String> {
        let mut next = normalize(incoming)?;
        for company in &mut next {
            if let Some(kept) = self.companies.iter().find(|existing| {
                existing.relay_url == company.relay_url
                    && existing.owner_pubkey == company.owner_pubkey
            }) {
                company.pause_reasons = kept.pause_reasons.clone();
            }
        }
        let removed = self
            .companies
            .iter()
            .filter(|existing| {
                !next
                    .iter()
                    .any(|company| company.relay_url == existing.relay_url)
            })
            .cloned()
            .collect();
        self.companies = next;
        Ok(removed)
    }

    /// Add `reason`. Returns whether anything changed.
    pub(crate) fn add_pause(&mut self, relay_url: &str, reason: PauseReason) -> Result<bool, String> {
        let company = self.find_mut(relay_url)?;
        if company.pause_reasons.contains(&reason) {
            return Ok(false);
        }
        company.pause_reasons.push(reason);
        company.pause_reasons.sort();
        Ok(true)
    }

    /// Remove `reason`. Returns whether anything changed.
    pub(crate) fn remove_pause(
        &mut self,
        relay_url: &str,
        reason: PauseReason,
    ) -> Result<bool, String> {
        let company = self.find_mut(relay_url)?;
        let before = company.pause_reasons.len();
        company.pause_reasons.retain(|held| *held != reason);
        Ok(company.pause_reasons.len() != before)
    }

    fn find_mut(&mut self, relay_url: &str) -> Result<&mut StoredCompany, String> {
        let relay = normalize_relay(relay_url)?;
        self.companies
            .iter_mut()
            .find(|company| company.relay_url == relay)
            .ok_or_else(|| NOT_SET_UP.to_string())
    }
}

/// Validate and normalize the list the interface saves: 64-hex owners,
/// normalized relays, one entry per relay (the first wins), at most
/// [`MAX_COMPANIES`].
pub(crate) fn normalize(incoming: Vec<TeamCompany>) -> Result<Vec<StoredCompany>, String> {
    let mut out: Vec<StoredCompany> = Vec::new();
    for company in incoming {
        let relay_url = normalize_relay(&company.relay_url)?;
        let owner_pubkey = company.owner_pubkey.trim().to_ascii_lowercase();
        if owner_pubkey.len() != 64 || !owner_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("company owner must be a 64-character hex public key".to_string());
        }
        if out.iter().any(|saved| saved.relay_url == relay_url) {
            continue;
        }
        out.push(StoredCompany {
            relay_url,
            owner_pubkey,
            pause_reasons: Vec::new(),
        });
    }
    if out.len() > MAX_COMPANIES {
        return Err(format!(
            "at most {MAX_COMPANIES} companies can be saved on one computer"
        ));
    }
    Ok(out)
}

/// Read the file. Missing means no companies; unreadable is an error.
pub(crate) fn load(path: &Path) -> Result<CompaniesFile, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CompaniesFile::default())
        }
        Err(error) => return Err(format!("failed to read {COMPANIES_FILE}: {error}")),
    };
    let mut file: CompaniesFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse {COMPANIES_FILE}: {error}"))?;
    for company in &mut file.companies {
        company.pause_reasons.sort();
        company.pause_reasons.dedup();
    }
    Ok(file)
}

/// Write the file durably (temporary file, sync, rename).
pub(crate) fn save(path: &Path, file: &CompaniesFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("failed to serialize {COMPANIES_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)
}
```

Create `src/managed_agents/team_runner/computer.rs`:

```rust
//! This install's id (`team-computer.json`) and the name people see for it.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// File name inside `<app data>/team`.
pub(crate) const COMPUTER_FILE: &str = "team-computer.json";
const MAX_NAME_CHARS: usize = 80;
const FALLBACK_NAME: &str = "This computer";

/// This install's id: a lowercase hyphenated UUID v4, generated once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputerIdentity {
    /// The id the team computer record names.
    pub(crate) computer_id: String,
}

fn is_install_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}

/// Load this install's id, or create one. A file that cannot be read as an
/// id is kept beside it as `team-computer.json.invalid` and replaced, so the
/// person can move the team back to this computer instead of being stuck.
pub(crate) fn load_or_create(path: &Path) -> Result<ComputerIdentity, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if let Ok(identity) = serde_json::from_slice::<ComputerIdentity>(&bytes) {
                if is_install_id(&identity.computer_id) {
                    return Ok(identity);
                }
            }
            std::fs::rename(path, path.with_extension("json.invalid"))
                .map_err(|error| format!("failed to set aside {COMPUTER_FILE}: {error}"))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to read {COMPUTER_FILE}: {error}")),
    }
    let identity = ComputerIdentity {
        computer_id: uuid::Uuid::new_v4().to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&identity)
        .map_err(|error| format!("failed to serialize {COMPUTER_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)?;
    Ok(identity)
}

/// The name people recognize: the Mac's computer name, Windows' computer
/// name, or the host name, cleaned by [`sanitize_name`].
pub(crate) fn this_computer_name() -> String {
    sanitize_name(&raw_computer_name().unwrap_or_default())
}

/// No control characters, trimmed, at most 80 characters, never empty.
pub(crate) fn sanitize_name(raw: &str) -> String {
    let visible: String = raw.chars().filter(|c| !c.is_control()).collect();
    let bounded: String = visible.trim().chars().take(MAX_NAME_CHARS).collect();
    let cleaned = bounded.trim();
    if cleaned.is_empty() {
        FALLBACK_NAME.to_string()
    } else {
        cleaned.to_string()
    }
}

#[cfg(target_os = "macos")]
fn raw_computer_name() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    // Bounded: `scutil` answers at once; a hung one is killed after 2 s.
    let mut child = Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut name = String::new();
    child
        .stdout
        .take()?
        .take(1024)
        .read_to_string(&mut name)
        .ok()?;
    Some(name)
}

#[cfg(windows)]
fn raw_computer_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(not(any(target_os = "macos", windows)))]
fn raw_computer_name() -> Option<String> {
    std::fs::read_to_string("/etc/hostname").ok()
}
```

In `src/lib.rs`, replace (line 251):

```rust
        .manage(channel_head_cache::ChannelHeadCacheStore::default())
```

with:

```rust
        .manage(channel_head_cache::ChannelHeadCacheStore::default())
        .manage(managed_agents::team_runner::TeamRunnerState::default())
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (9 tests in `foundation_tests`, 0 failed). Warnings about functions nothing calls yet (`emit_status`, `update_companies`, `ensure_computer`) are expected until Tasks 4.5 to 4.12 wire them; Task 4.16 runs clippy with `-D warnings` on the finished part.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner desktop/src-tauri/src/managed_agents/mod.rs desktop/src-tauri/src/lib.rs
git commit -s -m "feat(desktop): add the team runner's saved companies and computer id"
```

---

### Task 4.4: Team computer record: read side, spawn fence and launch filter

**Files:**
- Create: `src/managed_agents/team_runner/claim.rs`
- Create: `src/managed_agents/team_runner/claim_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list, state field, claim cache helpers, `SpawnClearance`)
- Test: `src/managed_agents/team_runner/claim_tests.rs`

**Interfaces:**
- Consumes: Part A `buzz_core_pkg::kind::KIND_TEAM_COMPUTER_HEAD` (30658) and `buzz_core_pkg::team_computer::TEAM_COMPUTER_D_TAG` (`"team-computer"`); Task 4.3 types.
- Produces:
  - `claim::HeadView` (lenient read of the head: unknown keys ignored, `releasedAt` read) and `HeadView::holder() -> Option<TeamComputerInfo>` (`None` once released).
  - `claim::parse_head(&nostr::Event, relay_self: &str) -> Result<HeadView, String>` (kind, relay author, id and signature, `d` coordinate).
  - `claim::ClaimView { holder, fetched_at }`, `claim::status_from(Option<&ClaimView>, this_computer_id) -> TeamComputerStatus`.
  - `claim::spawn_refusal(&StoredCompany, Option<&ClaimView>, Option<&str>) -> Option<String>` with the plain refusals `"Your team runs on {name}. Move it here to run it on this computer."`, `CHECKING_REFUSAL` and `PAUSED_REFUSAL`.
  - `claim::TeamSpawn { computer_id }`, `claim::clearance_for(...) -> Result<Option<TeamSpawn>, String>` (`Ok(None)` for a relay that is not a saved company, so nothing changes for it).
  - `claim::launch_candidates(&[ManagedAgentRecord], fenced: bool) -> Vec<String>`.
  - `claim::HEARTBEAT_EVERY_SECS = 120`.
  - Root: `TeamRunnerState.claims`, `record_claim`, `forget_claim`, `claim_view`, `SpawnClearance` (must-use proof the fence ran) and `spawn_clearance(app, relay_url) -> Result<SpawnClearance, String>`.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/claim_tests.rs`:

```rust
//! The team computer fence (overview review focus 2): only the computer the
//! record names starts a saved company's employees.

use std::collections::HashMap;

use nostr::{EventBuilder, Keys, Kind, Tag};

use super::claim::{
    clearance_for, launch_candidates, parse_head, spawn_refusal, status_from, ClaimView,
    CHECKING_REFUSAL, PAUSED_REFUSAL,
};
use super::companies::CompaniesFile;
use super::computer::ComputerIdentity;
use super::{normalize_relay, PauseReason, TeamCompany, TeamComputerInfo};
use crate::managed_agents::ManagedAgentRecord;

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER: &str = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

fn saved() -> CompaniesFile {
    let mut file = CompaniesFile::default();
    file.replace(vec![TeamCompany {
        relay_url: RELAY.into(),
        owner_pubkey: OWNER.into(),
    }])
    .expect("valid");
    file
}

fn held_by(id: &str, name: &str) -> ClaimView {
    ClaimView {
        holder: Some(TeamComputerInfo {
            computer_id: id.into(),
            computer_name: name.into(),
            last_seen_at: 1_760_180_300,
        }),
        fetched_at: 1_760_180_301,
    }
}

fn me() -> ComputerIdentity {
    ComputerIdentity {
        computer_id: ME.into(),
    }
}

fn claims(view: ClaimView) -> HashMap<String, ClaimView> {
    HashMap::from([(normalize_relay(RELAY).expect("relay"), view)])
}

fn record(pubkey: &str, start_on_app_launch: bool) -> ManagedAgentRecord {
    serde_json::from_value(serde_json::json!({
        "pubkey": pubkey,
        "name": "r",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": start_on_app_launch,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses")
}

#[test]
fn spawn_refusal_names_the_computer_that_runs_the_team() {
    let file = saved();
    let company = &file.companies[0];
    assert_eq!(
        spawn_refusal(company, Some(&held_by(OTHER, "Office iMac")), Some(ME)),
        Some("Your team runs on Office iMac. Move it here to run it on this computer.".to_string())
    );
    assert_eq!(
        spawn_refusal(company, Some(&held_by(ME, "Lerato's MacBook Air")), Some(ME)),
        None
    );
}

#[test]
fn nothing_starts_before_this_computer_knows_it_holds_the_team() {
    let file = saved();
    let company = &file.companies[0];
    let released = ClaimView {
        holder: None,
        fetched_at: 1,
    };
    assert_eq!(spawn_refusal(company, None, Some(ME)).as_deref(), Some(CHECKING_REFUSAL));
    assert_eq!(
        spawn_refusal(company, Some(&released), Some(ME)).as_deref(),
        Some(CHECKING_REFUSAL)
    );
    assert_eq!(
        spawn_refusal(company, Some(&held_by(ME, "x")), None).as_deref(),
        Some(CHECKING_REFUSAL)
    );
}

#[test]
fn a_paused_company_starts_no_employee_even_on_its_own_computer() {
    let mut file = saved();
    file.add_pause(RELAY, PauseReason::Person).expect("saved");
    assert_eq!(
        spawn_refusal(&file.companies[0], Some(&held_by(ME, "x")), Some(ME)).as_deref(),
        Some(PAUSED_REFUSAL)
    );
}

#[test]
fn clearance_fences_only_saved_companies() {
    let file = saved();
    let elsewhere = claims(held_by(OTHER, "Office iMac"));
    assert_eq!(
        clearance_for(&file, &elsewhere, Some(&me()), "wss://another.colony.example"),
        Ok(None),
        "a relay that is not a saved company is never fenced"
    );
    assert!(clearance_for(&file, &elsewhere, Some(&me()), RELAY).is_err());

    let mine = claims(held_by(ME, "Lerato's MacBook Air"));
    let team = clearance_for(&file, &mine, Some(&me()), RELAY)
        .expect("this computer runs the team")
        .expect("a team spawn");
    assert_eq!(team.computer_id, ME);
}

#[test]
fn launch_candidates_are_empty_when_this_computer_may_not_run_the_team() {
    let starts = "a".repeat(64);
    let records = vec![record(&starts, true), record(&"b".repeat(64), false)];
    assert_eq!(launch_candidates(&records, false), vec![starts]);
    assert!(launch_candidates(&records, true).is_empty());
}

#[test]
fn only_relay_signed_team_computer_heads_are_read() {
    let relay = Keys::generate();
    let stranger = Keys::generate();
    let relay_hex = relay.public_key().to_hex();
    let held = format!(
        r#"{{"computerId":"{OTHER}","computerName":"Office iMac","claimedBy":"{OWNER}","claimedAt":1,"lastSeenAt":2,"keyFromANewerRelay":true}}"#
    );
    let head = |keys: &Keys, d: &str, content: &str| {
        EventBuilder::new(Kind::Custom(30658), content)
            .tag(Tag::parse(["d", d]).expect("d tag"))
            .sign_with_keys(keys)
            .expect("signed")
    };

    let view = parse_head(&head(&relay, "team-computer", &held), &relay_hex).expect("relay head");
    assert_eq!(
        view.holder().map(|holder| holder.computer_name),
        Some("Office iMac".to_string())
    );
    assert!(parse_head(&head(&stranger, "team-computer", &held), &relay_hex).is_err());
    assert!(parse_head(&head(&relay, "business-profile", &held), &relay_hex).is_err());

    let mut forged = head(&relay, "team-computer", &held);
    forged.content = held.replace("Office iMac", "Forged");
    assert!(parse_head(&forged, &relay_hex).is_err());

    let released = format!(
        r#"{{"computerId":"{OTHER}","computerName":"Office iMac","claimedBy":"{OWNER}","claimedAt":1,"lastSeenAt":3,"releasedAt":3}}"#
    );
    let view = parse_head(&head(&relay, "team-computer", &released), &relay_hex).expect("released");
    assert_eq!(view.holder(), None, "a released record names no computer");
}

#[test]
fn status_reports_whether_this_computer_runs_the_team() {
    assert!(status_from(Some(&held_by(ME, "Lerato's MacBook Air")), ME).is_this_computer);
    let away = status_from(Some(&held_by(OTHER, "Office iMac")), ME);
    assert!(!away.is_this_computer);
    assert_eq!(
        away.holder.map(|holder| holder.computer_name),
        Some("Office iMac".to_string())
    );
    assert_eq!(status_from(None, ME).holder, None);
    assert_eq!(status_from(None, ME).this_computer_id, ME);
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod foundation_tests;
```

with:

```rust
#[cfg(test)]
mod claim_tests;
#[cfg(test)]
mod foundation_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::claim_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved import super::claim`.

- [ ] **Step 3: Implement**

Create `src/managed_agents/team_runner/claim.rs`:

```rust
//! The team computer record: reading the head and deciding whether this
//! computer may start a saved company's employees. No I/O here.

use std::collections::HashMap;

use buzz_core_pkg::kind::KIND_TEAM_COMPUTER_HEAD;
use buzz_core_pkg::team_computer::TEAM_COMPUTER_D_TAG;
use serde::Deserialize;

use super::companies::{CompaniesFile, StoredCompany};
use super::computer::ComputerIdentity;
use super::{normalize_relay, TeamComputerInfo, TeamComputerStatus};
use crate::managed_agents::{BackendKind, ManagedAgentRecord};

/// Seconds between heartbeats. The relay refuses heartbeats less than 60
/// seconds apart (`rate-limited:`), so two minutes stays clear of that limit.
pub(crate) const HEARTBEAT_EVERY_SECS: u64 = 120;

/// Refusal while this computer has not yet confirmed it holds the team.
pub(crate) const CHECKING_REFUSAL: &str =
    "Checking which computer runs your team. Try again in a moment.";
/// Refusal while the company has any pause reason.
pub(crate) const PAUSED_REFUSAL: &str = "Your team is paused. Resume it to start your employees.";

/// Lenient read of the relay-signed head (kind 30658). Keys this build does
/// not know are ignored, so a newer relay never stops the team.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HeadView {
    #[serde(default)]
    pub(crate) computer_id: String,
    #[serde(default)]
    pub(crate) computer_name: String,
    #[serde(default)]
    pub(crate) last_seen_at: i64,
    /// Relay time the holder released the team; absent while it is held.
    #[serde(default)]
    pub(crate) released_at: Option<i64>,
}

impl HeadView {
    /// The computer that holds the team, or `None` once it was released.
    pub(crate) fn holder(&self) -> Option<TeamComputerInfo> {
        if self.released_at.is_some() || self.computer_id.trim().is_empty() {
            return None;
        }
        Some(TeamComputerInfo {
            computer_id: self.computer_id.clone(),
            computer_name: self.computer_name.clone(),
            last_seen_at: self.last_seen_at,
        })
    }
}

/// Read and verify one team computer head returned by the relay.
pub(crate) fn parse_head(event: &nostr::Event, relay_self: &str) -> Result<HeadView, String> {
    if u32::from(event.kind.as_u16()) != KIND_TEAM_COMPUTER_HEAD {
        return Err("not a team computer record".to_string());
    }
    if !event.pubkey.to_hex().eq_ignore_ascii_case(relay_self) {
        return Err("the team computer record is not signed by the relay".to_string());
    }
    event
        .verify()
        .map_err(|_| "the team computer record has a bad signature".to_string())?;
    let coordinate = event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content());
    if coordinate != Some(TEAM_COMPUTER_D_TAG) {
        return Err("the team computer record has the wrong coordinate".to_string());
    }
    serde_json::from_str(&event.content)
        .map_err(|_| "the team computer record is unreadable".to_string())
}

/// What this computer last learned about one company's record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaimView {
    /// The holding computer, `None` when released or never claimed.
    pub(crate) holder: Option<TeamComputerInfo>,
    /// When this computer read or changed the record, Unix seconds.
    pub(crate) fetched_at: i64,
}

/// The bridge status for one company.
pub(crate) fn status_from(view: Option<&ClaimView>, this_computer_id: &str) -> TeamComputerStatus {
    let holder = view.and_then(|view| view.holder.clone());
    let is_this_computer = holder
        .as_ref()
        .is_some_and(|holder| holder.computer_id == this_computer_id);
    TeamComputerStatus {
        this_computer_id: this_computer_id.to_string(),
        holder,
        is_this_computer,
    }
}

/// Why this computer may not start an employee of `company` right now, in
/// plain words, or `None` when it may.
pub(crate) fn spawn_refusal(
    company: &StoredCompany,
    view: Option<&ClaimView>,
    this_computer_id: Option<&str>,
) -> Option<String> {
    let (Some(view), Some(me)) = (view, this_computer_id) else {
        return Some(CHECKING_REFUSAL.to_string());
    };
    match view.holder.as_ref() {
        Some(holder) if holder.computer_id == me => {
            company.is_paused().then(|| PAUSED_REFUSAL.to_string())
        }
        Some(holder) => Some(format!(
            "Your team runs on {}. Move it here to run it on this computer.",
            holder.computer_name
        )),
        None => Some(CHECKING_REFUSAL.to_string()),
    }
}

/// What a cleared team spawn exports to the employee.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TeamSpawn {
    /// This computer's install id (`COLONY_TEAM_COMPUTER_ID`).
    pub(crate) computer_id: String,
}

/// The fence for one spawn on `relay_url`: `Ok(None)` when the relay is not a
/// saved company (nothing changes for it), `Ok(Some)` when this computer runs
/// that company's team, and the plain refusal otherwise.
pub(crate) fn clearance_for(
    companies: &CompaniesFile,
    claims: &HashMap<String, ClaimView>,
    computer: Option<&ComputerIdentity>,
    relay_url: &str,
) -> Result<Option<TeamSpawn>, String> {
    let Ok(relay) = normalize_relay(relay_url) else {
        return Ok(None);
    };
    let Some(company) = companies
        .companies
        .iter()
        .find(|company| company.relay_url == relay)
    else {
        return Ok(None);
    };
    let computer_id = computer.map(|identity| identity.computer_id.clone());
    if let Some(refusal) = spawn_refusal(company, claims.get(&relay), computer_id.as_deref()) {
        return Err(refusal);
    }
    Ok(computer_id.map(|computer_id| TeamSpawn { computer_id }))
}

/// Launch restore candidates: local agents marked start-on-launch, or none
/// when this computer may not run the open company's team.
pub(crate) fn launch_candidates(records: &[ManagedAgentRecord], fenced: bool) -> Vec<String> {
    if fenced {
        return Vec::new();
    }
    records
        .iter()
        .filter(|record| record.start_on_app_launch && record.backend == BackendKind::Local)
        .map(|record| record.pubkey.clone())
        .collect()
}
```

In `src/managed_agents/team_runner.rs`:

Replace:

```rust
use std::path::PathBuf;
use std::sync::Mutex;
```

with:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
```

Replace:

```rust
mod companies;
mod computer;

pub(crate) use companies::{CompaniesFile, StoredCompany};
pub(crate) use computer::ComputerIdentity;
```

with:

```rust
mod claim;
mod companies;
mod computer;

pub(crate) use claim::{launch_candidates, TeamSpawn};
pub(crate) use companies::{CompaniesFile, StoredCompany};
pub(crate) use computer::ComputerIdentity;
```

Replace the state struct:

```rust
    /// This install's id, loaded or created on first use.
    computer: Mutex<Option<ComputerIdentity>>,
}
```

with:

```rust
    /// This install's id, loaded or created on first use.
    computer: Mutex<Option<ComputerIdentity>>,
    /// Latest team computer record seen per normalized company relay.
    claims: Mutex<HashMap<String, claim::ClaimView>>,
}

/// Proof that the team computer fence ran for one spawn. Only
/// [`spawn_clearance`] makes one; `spawn_agent_child` builds the employee
/// environment from it, so removing the fence is a compile error there.
#[must_use]
pub(crate) struct SpawnClearance {
    team: Option<TeamSpawn>,
}

impl SpawnClearance {
    /// The team facts, `None` when the spawn is not for a saved company.
    pub(crate) fn team(&self) -> Option<&TeamSpawn> {
        self.team.as_ref()
    }
}

/// The team computer fence for one spawn on `relay_url`. A relay that is not
/// a saved company passes untouched; a saved company's employee starts only
/// on the computer its record names, and only while it is not paused.
pub(crate) fn spawn_clearance<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
) -> Result<SpawnClearance, String> {
    let Some(state) = app.try_state::<TeamRunnerState>() else {
        return Ok(SpawnClearance { team: None });
    };
    let companies = state.companies.lock().map_err(|_| poisoned())?.clone();
    let claims = state.claims.lock().map_err(|_| poisoned())?.clone();
    let computer = state.computer.lock().map_err(|_| poisoned())?.clone();
    claim::clearance_for(&companies, &claims, computer.as_ref(), relay_url)
        .map(|team| SpawnClearance { team })
}

/// Remember what the relay said about `relay_url`'s record.
pub(crate) fn record_claim<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
    view: claim::ClaimView,
) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    runner(app)?
        .claims
        .lock()
        .map_err(|_| poisoned())?
        .insert(relay, view);
    Ok(())
}

/// Forget `relay_url`'s record (the company was removed from this computer).
pub(crate) fn forget_claim<R: Runtime>(app: &AppHandle<R>, relay_url: &str) {
    let (Ok(relay), Ok(state)) = (normalize_relay(relay_url), runner(app)) else {
        return;
    };
    if let Ok(mut claims) = state.claims.lock() {
        claims.remove(&relay);
    }
}

/// What this computer last learned about `relay_url`'s record.
pub(crate) fn claim_view<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
) -> Result<Option<claim::ClaimView>, String> {
    let relay = normalize_relay(relay_url)?;
    Ok(runner(app)?
        .claims
        .lock()
        .map_err(|_| poisoned())?
        .get(&relay)
        .cloned())
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (7 `claim_tests` and 9 `foundation_tests`, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner
git commit -s -m "feat(desktop): fence a saved company's employees to the computer that holds its team"
```

---

### Task 4.5: Employee spawn environment, the fence at spawn, and the first-start replay floor

**Files:**
- Create: `src/managed_agents/runtime/employee_env.rs`
- Create: `src/managed_agents/runtime/employee_env_tests.rs`
- Modify: `src/managed_agents/runtime.rs:29-30` (modules), `:427-435` (`spawn_with_effort_proof`), `:463` (fence after `runtime_key`), `:802` (environment after the replay floor), `:878` (spawn call)
- Modify: `src/managed_agents/reserved_env_keys.rs:94-96` (three reserved keys)
- Modify: `src/managed_agents/restore.rs:1-6` (imports) and `:174-178` (launch candidates)
- Modify: `src/managed_agents/runtime_commands.rs:227-233`, `:244-250`, `:290-291`, `:392`, `:511-517` (`start_pair` gains the replay floor)
- Test: `src/managed_agents/runtime/employee_env_tests.rs`

**Interfaces:**
- Consumes: Task 4.2 `ManagedAgentRecord.role_context`; Task 4.4 `spawn_clearance`, `SpawnClearance`, `TeamSpawn`, `launch_candidates`; part C's harness reads `COLONY_ROLE_CONTEXT`, `COLONY_WAKE_LEDGER` and `BUZZ_ACP_REPLAY_FLOOR`.
- Produces:
  - `runtime::employee_env::{ROLE_CONTEXT_ENV_VAR, WAKE_LEDGER_ENV_VAR, TEAM_COMPUTER_ID_ENV_VAR}` (`COLONY_ROLE_CONTEXT`, `COLONY_WAKE_LEDGER`, `COLONY_TEAM_COMPUTER_ID`).
  - `wake_ledger_path(agents_dir, pubkey)` = `<app data>/agents/<pubkey>/wake-ledger.json`.
  - `EmployeeEnv`, `employee_env_for(record, team: Option<&TeamSpawn>, agents_dir) -> Result<EmployeeEnv, String>`, `apply_employee_env(&mut Command, &EmployeeEnv) -> EmployeeEnvApplied` (must-use token).
  - `spawn_with_effort_proof(cmd, EffortApplied, EmployeeEnvApplied)`.
  - `crate::managed_agents::start_managed_agent_runtime_pair_with_floor(pubkey, relay_url, replay_floor_unix: Option<u64>, app)`.
  - Rules: the role context is exported for any record that has one; the wake ledger and computer id only for a spawn on a saved company's relay (agents of the old app keep today's behaviour); all three keys are reserved; a key that is not set is removed, so a value inherited from the process that started the host never reaches an employee.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/runtime/employee_env_tests.rs`:

```rust
//! What a team employee's harness receives at spawn.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::employee_env::{
    apply_employee_env, employee_env_for, wake_ledger_path, ROLE_CONTEXT_ENV_VAR,
    TEAM_COMPUTER_ID_ENV_VAR, WAKE_LEDGER_ENV_VAR,
};
use crate::managed_agents::team_runner::TeamSpawn;
use crate::managed_agents::{ManagedAgentRecord, RoleContext};

const PUBKEY: &str = "abababababababababababababababababababababababababababababababab";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

fn record() -> ManagedAgentRecord {
    serde_json::from_value(serde_json::json!({
        "pubkey": PUBKEY,
        "name": "naledi",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": true,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses")
}

fn context() -> RoleContext {
    RoleContext {
        title: "Test Employee".to_string(),
        job: "Post one short note a day".to_string(),
        owns: Some("One short note a day".to_string()),
        ask_before: vec!["anything public".to_string()],
        manager_name: None,
        home_channel_id: Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c".to_string()),
        goal_id: Some("6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10".to_string()),
        on_hire_sources: vec!["business profile".to_string()],
        plan_horizon_days: 14,
    }
}

/// `Some(Some(value))` set, `Some(None)` removed, `None` untouched.
fn env_of(command: &Command, key: &str) -> Option<Option<String>> {
    command
        .get_envs()
        .find(|(name, _)| *name == OsStr::new(key))
        .map(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
}

#[test]
fn a_team_employee_gets_its_role_its_wake_ledger_and_this_computers_id() {
    let mut employee = record();
    employee.role_context = Some(context());
    let team = TeamSpawn {
        computer_id: ME.to_string(),
    };
    let agents = Path::new("/data/agents");

    let env = employee_env_for(&employee, Some(&team), agents).expect("environment");
    let mut command = Command::new("buzz-acp");
    let _applied = apply_employee_env(&mut command, &env);

    let role = env_of(&command, ROLE_CONTEXT_ENV_VAR)
        .flatten()
        .expect("role context set");
    let role: RoleContext = serde_json::from_str(&role).expect("role context is JSON");
    assert_eq!(role, context());
    assert_eq!(
        env_of(&command, WAKE_LEDGER_ENV_VAR).flatten().map(PathBuf::from),
        Some(wake_ledger_path(agents, PUBKEY))
    );
    assert_eq!(
        env_of(&command, TEAM_COMPUTER_ID_ENV_VAR).flatten().as_deref(),
        Some(ME)
    );
}

#[test]
fn an_agent_outside_a_saved_company_inherits_none_of_the_team_keys() {
    let env = employee_env_for(&record(), None, Path::new("/data/agents")).expect("environment");
    let mut command = Command::new("buzz-acp");
    // As if the host itself had been started with these set.
    command.env(WAKE_LEDGER_ENV_VAR, "/tmp/somewhere-else.json");
    command.env(TEAM_COMPUTER_ID_ENV_VAR, "not-this-computer");
    let _applied = apply_employee_env(&mut command, &env);

    for key in [ROLE_CONTEXT_ENV_VAR, WAKE_LEDGER_ENV_VAR, TEAM_COMPUTER_ID_ENV_VAR] {
        assert_eq!(env_of(&command, key), Some(None), "{key} is removed, never inherited");
    }
}

#[test]
fn the_wake_ledger_lives_in_the_employees_agents_folder() {
    let upper = "AB".repeat(32);
    assert_eq!(
        wake_ledger_path(Path::new("/data/agents"), &upper),
        Path::new("/data/agents")
            .join("ab".repeat(32))
            .join("wake-ledger.json")
    );
}

#[test]
fn team_keys_are_reserved_so_saved_environment_cannot_shadow_them() {
    for key in [ROLE_CONTEXT_ENV_VAR, WAKE_LEDGER_ENV_VAR, TEAM_COMPUTER_ID_ENV_VAR] {
        assert!(
            crate::managed_agents::env_vars::is_reserved_env_key(key),
            "{key} must be reserved"
        );
    }
}
```

In `src/managed_agents/runtime.rs`, replace (lines 29-30):

```rust
mod setup_payload;
use setup_payload::apply_setup_payload_env;
```

with:

```rust
mod employee_env;
pub(crate) use employee_env::{apply_employee_env, employee_env_for, EmployeeEnvApplied};
#[cfg(test)]
mod employee_env_tests;

mod setup_payload;
use setup_payload::apply_setup_payload_env;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::runtime::employee_env_tests)`
Expected: FAIL to compile with `error[E0583]: file not found for module employee_env`.

- [ ] **Step 3: Add the environment module and reserve the keys**

Create `src/managed_agents/runtime/employee_env.rs`:

```rust
//! The environment a team employee's harness gets at spawn.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::managed_agents::team_runner::TeamSpawn;
use crate::managed_agents::ManagedAgentRecord;

/// The employee's role as JSON; the harness renders a `<colony-role>` block.
pub(crate) const ROLE_CONTEXT_ENV_VAR: &str = "COLONY_ROLE_CONTEXT";
/// The employee's wake ledger file: missed wake-ups are answered once.
pub(crate) const WAKE_LEDGER_ENV_VAR: &str = "COLONY_WAKE_LEDGER";
/// This computer's install id, the one the team computer record names.
pub(crate) const TEAM_COMPUTER_ID_ENV_VAR: &str = "COLONY_TEAM_COMPUTER_ID";

/// `<app data>/agents/<pubkey>/wake-ledger.json`. The harness creates the folder.
pub(crate) fn wake_ledger_path(agents_dir: &Path, pubkey: &str) -> PathBuf {
    agents_dir
        .join(pubkey.to_ascii_lowercase())
        .join("wake-ledger.json")
}

/// What one spawn exports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EmployeeEnv {
    pub(crate) role_context: Option<String>,
    pub(crate) wake_ledger: Option<PathBuf>,
    pub(crate) team_computer_id: Option<String>,
}

/// Build the environment for `record`. `team` is the fence's answer for this
/// spawn: `Some` only on a saved company's relay on the computer that runs it.
pub(crate) fn employee_env_for(
    record: &ManagedAgentRecord,
    team: Option<&TeamSpawn>,
    agents_dir: &Path,
) -> Result<EmployeeEnv, String> {
    let role_context = record
        .role_context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| format!("{} could not start: its role could not be prepared.", record.name))?;
    Ok(EmployeeEnv {
        role_context,
        wake_ledger: team.map(|_| wake_ledger_path(agents_dir, &record.pubkey)),
        team_computer_id: team.map(|team| team.computer_id.clone()),
    })
}

/// Proof the employee environment was written. `spawn_with_effort_proof`
/// consumes it, so removing [`apply_employee_env`] from the spawn is a
/// compile error.
#[must_use]
pub(crate) struct EmployeeEnvApplied(());

/// Write the three keys, or remove them when unset, so a value inherited from
/// the process that started the host never reaches an employee.
pub(crate) fn apply_employee_env(command: &mut Command, env: &EmployeeEnv) -> EmployeeEnvApplied {
    match &env.role_context {
        Some(value) => command.env(ROLE_CONTEXT_ENV_VAR, value),
        None => command.env_remove(ROLE_CONTEXT_ENV_VAR),
    };
    match &env.wake_ledger {
        Some(path) => command.env(WAKE_LEDGER_ENV_VAR, path),
        None => command.env_remove(WAKE_LEDGER_ENV_VAR),
    };
    match &env.team_computer_id {
        Some(value) => command.env(TEAM_COMPUTER_ID_ENV_VAR, value),
        None => command.env_remove(TEAM_COMPUTER_ID_ENV_VAR),
    };
    EmployeeEnvApplied(())
}
```

In `src/managed_agents/reserved_env_keys.rs`, replace (lines 94-96):

```rust
    "BUZZ_MANAGED_AGENT",
    "BUZZ_MANAGED_AGENT_START_NONCE",
];
```

with:

```rust
    "BUZZ_MANAGED_AGENT",
    "BUZZ_MANAGED_AGENT_START_NONCE",
    // Team employee environment: the role an employee was hired for, its wake
    // ledger (answered-once catch-up) and the computer that runs the team
    // come from the host alone.
    "COLONY_ROLE_CONTEXT",
    "COLONY_WAKE_LEDGER",
    "COLONY_TEAM_COMPUTER_ID",
];
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::runtime::employee_env_tests managed_agents::env_vars)`
Expected: PASS (4 new tests and the existing `env_vars` tests, 0 failed).

- [ ] **Step 5: Wire the fence and the environment into `spawn_agent_child`**

In `src/managed_agents/runtime.rs`, replace the signature of `spawn_with_effort_proof` (lines 430-433; its three doc lines above stay):

```rust
pub(crate) fn spawn_with_effort_proof(
    cmd: &mut std::process::Command,
    _effort: EffortApplied,
) -> std::io::Result<std::process::Child> {
```

with:

```rust
///
/// The `EmployeeEnvApplied` token binds `apply_employee_env` the same way:
/// deleting that call from `spawn_agent_child` is a compile error too.
pub(crate) fn spawn_with_effort_proof(
    cmd: &mut std::process::Command,
    _effort: EffortApplied,
    _employee_env: EmployeeEnvApplied,
) -> std::io::Result<std::process::Child> {
```

Replace (line 463):

```rust
    let runtime_key = ManagedAgentRuntimeKey::new(record.pubkey.clone(), relay_url)?;
```

with:

```rust
    let runtime_key = ManagedAgentRuntimeKey::new(record.pubkey.clone(), relay_url)?;
    // Team computer fence: a saved company's employee starts only on the
    // computer its team computer record names, and only while the team is not
    // paused. Checked before any side effect, like the refusals below. Every
    // start path (launch restore, interactive start, the team runner) comes
    // through here.
    let team_clearance = super::team_runner::spawn_clearance(app, &runtime_key.relay_url)?;
```

Replace (line 802):

```rust
    apply_replay_floor_env(&mut command, replay_floor_unix);
```

with:

```rust
    apply_replay_floor_env(&mut command, replay_floor_unix);
    // Team employee environment: role context, wake ledger and this
    // computer's id. The keys are reserved, so `descriptor.env` above never
    // carries them; unset keys are removed so nothing is inherited. The token
    // is consumed by the spawn below.
    let employee_env = apply_employee_env(
        &mut command,
        &employee_env_for(
            record,
            team_clearance.team(),
            &super::managed_agents_base_dir(app)?,
        )?,
    );
```

Replace (line 878):

```rust
    let child = spawn_with_effort_proof(&mut command, effort).map_err(|error| {
```

with:

```rust
    let child = spawn_with_effort_proof(&mut command, effort, employee_env).map_err(|error| {
```

- [ ] **Step 6: Filter launch restore and give `start_pair` a replay floor**

In `src/managed_agents/restore.rs`, replace (lines 1-6):

```rust
use super::{
    bestie_assignment::recover_pending_assignment_cleanup, find_managed_agent_mut,
    kill_stale_tracked_processes, load_managed_agents, load_personas, managed_agents_base_dir,
    save_managed_agents, spawn_agent_child, sync_managed_agent_processes, BackendKind,
    ManagedAgentProcess,
};
```

with:

```rust
use super::{
    bestie_assignment::recover_pending_assignment_cleanup, find_managed_agent_mut,
    kill_stale_tracked_processes, load_managed_agents, load_personas, managed_agents_base_dir,
    save_managed_agents, spawn_agent_child, sync_managed_agent_processes, ManagedAgentProcess,
};
```

Replace (lines 174-178):

```rust
        let candidates: Vec<String> = records
            .iter()
            .filter(|record| record.start_on_app_launch && record.backend == BackendKind::Local)
            .map(|record| record.pubkey.clone())
            .collect();
```

with:

```rust
        // Team computer fence: when the open relay is a saved company this
        // computer may not run (another computer holds it, or it is paused),
        // restore starts nothing instead of recording a refusal on every
        // employee. Spawns are fenced again in `spawn_agent_child`.
        let team_fenced = super::team_runner::spawn_clearance(
            app,
            &crate::relay::relay_ws_url_with_override(&state),
        )
        .is_err();
        let candidates = super::team_runner::launch_candidates(&records, team_fenced);
```

In `src/managed_agents/runtime_commands.rs`, replace (lines 227-233):

```rust
pub(crate) fn start_managed_agent_runtime_pair_lazy(
    pubkey: String,
    relay_url: String,
    app: AppHandle,
) -> Result<ManagedAgentRuntimeStatus, String> {
    start_pair(pubkey, relay_url, true, None, app)
}
```

with:

```rust
pub(crate) fn start_managed_agent_runtime_pair_lazy(
    pubkey: String,
    relay_url: String,
    app: AppHandle,
) -> Result<ManagedAgentRuntimeStatus, String> {
    start_pair(pubkey, relay_url, true, None, None, app)
}

/// Start a newly hired employee's lazy pair with the harness replay floor at
/// the moment just before its hire was completed, so the on-hire kickoff the
/// relay posted is answered and nothing older is replayed.
pub(crate) fn start_managed_agent_runtime_pair_with_floor(
    pubkey: String,
    relay_url: String,
    replay_floor_unix: Option<u64>,
    app: AppHandle,
) -> Result<ManagedAgentRuntimeStatus, String> {
    start_pair(pubkey, relay_url, true, None, replay_floor_unix, app)
}
```

Replace the head of `start_pair` (lines 244-250):

```rust
fn start_pair(
    pubkey: String,
    relay_url: String,
    lazy: bool,
    expected_updated_at: Option<&str>,
    app: AppHandle,
) -> Result<ManagedAgentRuntimeStatus, String> {
```

with:

```rust
fn start_pair(
    pubkey: String,
    relay_url: String,
    lazy: bool,
    expected_updated_at: Option<&str>,
    replay_floor_unix: Option<u64>,
    app: AppHandle,
) -> Result<ManagedAgentRuntimeStatus, String> {
```

Replace its spawn call (lines 290-291):

```rust
    let mut process =
        spawn_agent_child(&app, record, &key.relay_url, lazy, owner.as_deref(), None)?;
```

with:

```rust
    let mut process = spawn_agent_child(
        &app,
        record,
        &key.relay_url,
        lazy,
        owner.as_deref(),
        replay_floor_unix,
    )?;
```

Replace in `restart_managed_agent_runtime` (line 392):

```rust
    start_pair(pubkey, relay_url, true, None, app)
```

with:

```rust
    start_pair(pubkey, relay_url, true, None, None, app)
```

Replace in the reconcile loop (lines 511-517):

```rust
                    match start_pair(
                        record.pubkey.clone(),
                        key.relay_url.clone(),
                        true,
                        Some(&record.updated_at),
                        app.clone(),
                    ) {
```

with:

```rust
                    match start_pair(
                        record.pubkey.clone(),
                        key.relay_url.clone(),
                        true,
                        Some(&record.updated_at),
                        None,
                        app.clone(),
                    ) {
```

- [ ] **Step 7: Run the runtime and restore tests**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::runtime managed_agents::restore managed_agents::team_runner managed_agents::config_bridge)`
Expected: PASS, 0 failed. The whole lib test target compiles, which proves every `start_pair` and `spawn_with_effort_proof` call site was updated.

- [ ] **Step 8: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/runtime.rs desktop/src-tauri/src/managed_agents/runtime desktop/src-tauri/src/managed_agents/reserved_env_keys.rs desktop/src-tauri/src/managed_agents/restore.rs desktop/src-tauri/src/managed_agents/runtime_commands.rs
git commit -s -m "feat(desktop): give team employees their role, wake ledger and computer id at spawn"
```

---

### Task 4.6: Team computer record I/O: read, claim at every start, release

**Files:**
- Create: `src/managed_agents/team_runner/claim_io.rs`
- Create: `src/managed_agents/team_runner/claim_io_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list)
- Test: `src/managed_agents/team_runner/claim_io_tests.rs`

**Interfaces:**
- Consumes: Part A `buzz_core_pkg::team_computer::{TeamComputerAction, TeamComputerActionKind, TEAM_COMPUTER_D_TAG, TEAM_COMPUTER_HEARTBEAT_MIN_SECS}` and `buzz_sdk_pkg::team_computer::build_team_computer_action` (one `d` tag, no `h` tag); part A refusal prefixes `conflict:`, `restricted:`, `rate-limited:`; `crate::commands::fetch_relay_self_at` (`commands/identity_archive.rs:363`, cached NIP-11 `self`); `crate::relay::{query_relay_at, submit_event_at_with_keys, relay_http_base_url}`; `AppState::signing_keys`.
- Produces: `claim_io::{refresh, publish, claim, release, is_conflict, is_rate_limited, is_not_holder, newest}`. `claim(app, relay, force)` never fails just because another computer holds the team: a `conflict:` answer refreshes the record so the caller sees the holder. A claim from the computer that already holds the team succeeds and refreshes its name and time (part A), so the host claims at every start without asking first.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/claim_io_tests.rs`:

```rust
//! How the host reads the relay's answers to team computer actions.

use buzz_core_pkg::team_computer::TEAM_COMPUTER_HEARTBEAT_MIN_SECS;
use nostr::{EventBuilder, Keys, Kind, Timestamp};

use super::claim::HEARTBEAT_EVERY_SECS;
use super::claim_io::{is_conflict, is_not_holder, is_rate_limited, newest};

#[test]
fn relay_refusals_are_told_apart() {
    let held = "relay rejected event: conflict: the team runs on Office iMac; move it with a forced claim";
    let not_holder = "relay rejected event: restricted: only the computer that runs the team can do this";
    let too_soon = "relay rejected event: rate-limited: heartbeat at most once every 60 seconds; retry in 12 seconds";
    let offline = "network error: connection refused";

    assert!(is_conflict(held) && !is_conflict(too_soon) && !is_conflict(offline));
    assert!(is_rate_limited(too_soon) && !is_rate_limited(held));
    assert!(is_not_holder(held) && is_not_holder(not_holder));
    assert!(!is_not_holder(too_soon) && !is_not_holder(offline));
}

#[test]
fn the_heartbeat_stays_clear_of_the_relay_limit() {
    let every = i64::try_from(HEARTBEAT_EVERY_SECS).expect("small");
    assert!(
        every >= 2 * TEAM_COMPUTER_HEARTBEAT_MIN_SECS,
        "a heartbeat every {every} s could collide with the relay's {TEAM_COMPUTER_HEARTBEAT_MIN_SECS} s limit"
    );
}

#[test]
fn the_newest_event_wins() {
    let keys = Keys::generate();
    let at = |secs: u64| {
        EventBuilder::new(Kind::Custom(30658), secs.to_string())
            .custom_created_at(Timestamp::from(secs))
            .sign_with_keys(&keys)
            .expect("signed")
    };
    let picked = newest(vec![at(10), at(30), at(20)]).expect("one event");
    assert_eq!(picked.content, "30");
    assert!(newest(Vec::new()).is_none());
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod claim_tests;
```

with:

```rust
#[cfg(test)]
mod claim_io_tests;
#[cfg(test)]
mod claim_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::claim_io_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved import super::claim_io`.

- [ ] **Step 3: Implement**

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod claim;
mod companies;
```

with:

```rust
mod claim;
mod claim_io;
mod companies;
```

Create `src/managed_agents/team_runner/claim_io.rs`:

```rust
//! Reading and writing the team computer record on the company relay.

use buzz_core_pkg::kind::KIND_TEAM_COMPUTER_HEAD;
use buzz_core_pkg::team_computer::{
    TeamComputerAction, TeamComputerActionKind, TEAM_COMPUTER_D_TAG,
};
use tauri::{AppHandle, Manager};

use super::claim::{parse_head, ClaimView};
use super::{computer, ensure_computer, normalize_relay, now_unix, record_claim};
use crate::app_state::AppState;

const UNREACHABLE: &str = "Colony could not reach your company. Check the connection and try again.";

/// Whether the relay refused because another computer holds the team.
pub(crate) fn is_conflict(error: &str) -> bool {
    error.contains("conflict:")
}

/// Whether the relay refused a heartbeat as too soon. Harmless.
pub(crate) fn is_rate_limited(error: &str) -> bool {
    error.contains("rate-limited:")
}

/// Whether the relay says this computer no longer holds the team.
pub(crate) fn is_not_holder(error: &str) -> bool {
    error.contains("restricted:") || is_conflict(error)
}

/// The newest of `events`.
pub(crate) fn newest(events: Vec<nostr::Event>) -> Option<nostr::Event> {
    events.into_iter().max_by_key(|event| event.created_at)
}

/// The relay's own signing key (NIP-11 `self`, cached by the app).
pub(crate) async fn relay_self(app: &AppHandle, relay_url: &str) -> Result<String, String> {
    let state = app.state::<AppState>();
    crate::commands::fetch_relay_self_at(&state, relay_url)
        .await?
        .ok_or_else(|| UNREACHABLE.to_string())
}

/// Read the company's record from the relay and remember it.
pub(crate) async fn refresh(app: &AppHandle, relay_url: &str) -> Result<ClaimView, String> {
    let relay = normalize_relay(relay_url)?;
    let relay_self = relay_self(app, &relay).await?;
    let state = app.state::<AppState>();
    let events = crate::relay::query_relay_at(
        &state,
        &crate::relay::relay_http_base_url(&relay),
        &[serde_json::json!({
            "kinds": [KIND_TEAM_COMPUTER_HEAD],
            "authors": [relay_self],
            "#d": [TEAM_COMPUTER_D_TAG],
            "limit": 1
        })],
    )
    .await?;
    let holder = match newest(events) {
        Some(event) => parse_head(&event, &relay_self)?.holder(),
        None => None,
    };
    let view = ClaimView {
        holder,
        fetched_at: now_unix(),
    };
    record_claim(app, &relay, view.clone())?;
    Ok(view)
}

/// Sign one team computer action with the signed-in person's key and send it.
pub(crate) async fn publish(
    app: &AppHandle,
    relay_url: &str,
    action: TeamComputerActionKind,
    force: bool,
) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    let state = app.state::<AppState>();
    let keys = state.signing_keys()?;
    let identity = ensure_computer(app)?;
    let action = TeamComputerAction {
        action,
        computer_id: identity.computer_id,
        computer_name: computer::this_computer_name(),
        force,
    };
    let builder = buzz_sdk_pkg::team_computer::build_team_computer_action(&action)
        .map_err(|error| error.to_string())?;
    crate::relay::submit_event_at_with_keys(
        builder,
        &state,
        &crate::relay::relay_http_base_url(&relay),
        &keys,
    )
    .await
    .map(|_| ())
}

/// Claim the team for this computer (`force` moves it from another one) and
/// return the record afterwards. When another computer holds it and this is
/// not a move, the refreshed record names that computer; that is not an error.
pub(crate) async fn claim(app: &AppHandle, relay_url: &str, force: bool) -> Result<ClaimView, String> {
    match publish(app, relay_url, TeamComputerActionKind::Claim, force).await {
        Ok(()) => refresh(app, relay_url).await,
        Err(error) if is_conflict(&error) => refresh(app, relay_url).await,
        Err(error) => Err(error),
    }
}

/// Give the team up from this computer.
pub(crate) async fn release(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    publish(app, relay_url, TeamComputerActionKind::Release, false).await?;
    refresh(app, relay_url).await.map(|_| ())
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (3 `claim_io_tests` plus the earlier team runner tests, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner
git commit -s -m "feat(desktop): read, claim and release the team computer record"
```

---

### Task 4.7: Restart policy: backoff, crash loop, credits exits

**Files:**
- Create: `src/managed_agents/team_runner/supervisor.rs`
- Create: `src/managed_agents/team_runner/supervisor_tests.rs`
- Create: `src/managed_agents/credits_pause.rs` (stub; part I replaces the bodies)
- Modify: `src/managed_agents/mod.rs:19` (module list)
- Modify: `src/managed_agents/team_runner.rs` (module list, state field, `with_book`)
- Test: `src/managed_agents/team_runner/supervisor_tests.rs`

**Interfaces:**
- Consumes: Task 4.3 `EmployeeState`.
- Produces:
  - The credits seam part I fills (`crate::managed_agents::credits_pause`), as a stub with exactly these signatures: `pub(crate) enum ExitHandling { PausedForCredits, RestartNow, Crash }`; `pub(crate) async fn on_harness_exit(app: &tauri::AppHandle, relay_url: &str, agent_pubkey: &str, code: Option<i32>) -> ExitHandling` (stub `Crash`; the supervisor calls it for every unexpected exit before the crash policy, Task 4.8); `pub(crate) fn is_paused_for_credits(app: &tauri::AppHandle, relay_url: &str) -> bool` (stub `false`) and `pub(crate) fn ensure_watcher(app: &tauri::AppHandle, relay_url: &str)` (stub no-op), used by start on launch (Task 4.9); `pub(crate) async fn resume_if_funded(app: &tauri::AppHandle, relay_url: &str) -> Result<bool, String>` (stub `Ok(false)`), called first by `team_resume` (Task 4.12). Part I's body maps harness exit codes 75 (out of credits) and 77 (credits session ended) to `PausedForCredits` or `RestartNow`, so they never count as crashes.
  - `supervisor::{BACKOFF_SECS = [5, 15, 45, 120, 300], CRASH_WINDOW_SECS = 600, CRASH_LOOP_EXITS = 5, HEALTHY_AFTER_SECS = 600, DownDecision, Settled, SupervisorBook}`.
  - `SupervisorBook` methods: `expect_running(pubkey, relay)`, `note_stopped(pubkey, relay)` (only when the relay matches), `reset(pubkey)`, `note_up(pubkey, now)`, `observe_down(pubkey, now) -> DownDecision`, `settle_exit(pubkey, now, ExitHandling) -> Option<Settled>`, `restarting(pubkey)`, `start_failed(pubkey, now) -> Option<Settled>`, `record_state(pubkey, state, now) -> (since, changed)`, `restarts_in_window(pubkey, now) -> u32`, `is_failing`, `is_expected`, `expected_on(relay) -> Vec<String>`.
  - Root: `TeamRunnerState.book`, `with_book(app, f)`.
  - Rules: waits grow 5 s, 15 s, 45 s, 2 min, 5 min along a streak of exits; an employee that stays up ten minutes starts a new streak; the fifth counted exit within ten minutes is a crash loop (failing, no restart until a person restarts it); a credits exit is never counted and never triggers a backoff restart; an employee stopped on purpose is never restarted.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/supervisor_tests.rs`:

```rust
//! Restart policy (review focus 3 and 4).

use super::supervisor::{DownDecision, Settled, SupervisorBook};
use super::EmployeeState;
use crate::managed_agents::credits_pause::ExitHandling;

const PK: &str = "abababababababababababababababababababababababababababababababab";
const RELAY: &str = "wss://lerato.colony.example";
const OTHER_RELAY: &str = "wss://elsewhere.colony.example";

fn expecting() -> SupervisorBook {
    let mut book = SupervisorBook::default();
    book.expect_running(PK, RELAY);
    book
}

/// Crash once at `now`, restart when due, and come back up. Returns the wait.
fn crash_and_restart(book: &mut SupervisorBook, now: &mut i64) -> i64 {
    assert_eq!(book.observe_down(PK, *now), DownDecision::NewExit);
    let Some(Settled::Crashed { restart_in_secs }) = book.settle_exit(PK, *now, ExitHandling::Crash)
    else {
        panic!("a counted exit below the limit schedules a restart");
    };
    assert_eq!(
        book.observe_down(PK, *now + restart_in_secs - 1),
        DownDecision::Wait
    );
    *now += restart_in_secs;
    assert_eq!(book.observe_down(PK, *now), DownDecision::RestartNow);
    book.restarting(PK);
    book.note_up(PK, *now);
    restart_in_secs
}

#[test]
fn fifth_exit_in_ten_minutes_is_a_crash_loop_and_stops_restarts() {
    let mut book = expecting();
    let mut now = 1_000;
    let mut waits = Vec::new();
    for _ in 0..4 {
        waits.push(crash_and_restart(&mut book, &mut now));
        now += 1; // it dies a second after each restart
    }
    assert_eq!(waits, vec![5, 15, 45, 120]);

    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now, ExitHandling::Crash),
        Some(Settled::CrashLoop)
    );
    assert!(book.is_failing(PK));
    assert_eq!(book.restarts_in_window(PK, now), 5);
    assert_eq!(
        book.observe_down(PK, now + 3_600),
        DownDecision::Ignore,
        "a failing employee is never restarted by itself"
    );

    book.reset(PK);
    book.expect_running(PK, RELAY);
    assert!(!book.is_failing(PK), "a person's restart clears the crash loop");
    assert_eq!(book.observe_down(PK, now + 3_601), DownDecision::NewExit);
}

#[test]
fn waits_reach_five_minutes_when_exits_are_spread_out() {
    let mut book = expecting();
    let mut now = 1_000;
    let mut waits = Vec::new();
    for _ in 0..6 {
        waits.push(crash_and_restart(&mut book, &mut now));
        now += 240; // runs four minutes each time, never five exits in ten minutes
        assert!(!book.is_failing(PK));
    }
    assert_eq!(waits, vec![5, 15, 45, 120, 300, 300]);
}

#[test]
fn an_employee_up_for_ten_minutes_starts_a_new_streak() {
    let mut book = expecting();
    let mut now = 1_000;
    assert_eq!(crash_and_restart(&mut book, &mut now), 5);
    now += 1;
    assert_eq!(crash_and_restart(&mut book, &mut now), 15);
    book.note_up(PK, now + 600);
    now += 601;
    assert_eq!(crash_and_restart(&mut book, &mut now), 5);
}

#[test]
fn credits_exits_never_count_toward_the_crash_window() {
    let mut book = expecting();
    let mut now = 1_000;
    for _ in 0..10 {
        assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
        assert_eq!(
            book.settle_exit(PK, now, ExitHandling::PausedForCredits),
            Some(Settled::Paused)
        );
        assert_eq!(
            book.observe_down(PK, now + 600),
            DownDecision::Wait,
            "no backoff restart is scheduled"
        );
        // The credits seam pauses the company, which stops it on purpose;
        // buying credits resumes it.
        book.note_stopped(PK, RELAY);
        book.expect_running(PK, RELAY);
        now += 1;
    }
    assert_eq!(book.restarts_in_window(PK, now), 0);
    assert!(!book.is_failing(PK));

    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now, ExitHandling::RestartNow),
        Some(Settled::RestartNow)
    );
    assert_eq!(book.observe_down(PK, now), DownDecision::RestartNow);
    assert_eq!(book.restarts_in_window(PK, now), 0, "a reauthorized restart is not a crash");
}

#[test]
fn an_employee_stopped_on_purpose_is_never_restarted() {
    let mut book = expecting();
    book.note_stopped(PK, RELAY);
    for now in [1_000, 2_000, 90_000] {
        assert_eq!(book.observe_down(PK, now), DownDecision::Ignore);
    }
    assert!(!book.is_expected(PK));
    assert_eq!(book.start_failed(PK, 1_000), None, "a stopped employee is not counted");
}

#[test]
fn stopping_a_pair_on_another_relay_keeps_the_employee_expected() {
    let mut book = expecting();
    book.note_stopped(PK, OTHER_RELAY);
    assert!(book.is_expected(PK));
    assert_eq!(book.expected_on(RELAY), vec![PK.to_string()]);
    assert!(book.expected_on(OTHER_RELAY).is_empty());
}

#[test]
fn a_restart_that_dies_at_once_is_counted_not_repeated() {
    let mut book = expecting();
    let now = 1_000;
    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    book.settle_exit(PK, now, ExitHandling::Crash);
    assert_eq!(book.observe_down(PK, now + 5), DownDecision::RestartNow);
    book.restarting(PK);
    // It died before the next tick saw it up: that is a new, counted exit.
    assert_eq!(book.observe_down(PK, now + 7), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now + 7, ExitHandling::Crash),
        Some(Settled::Crashed { restart_in_secs: 15 })
    );
}

#[test]
fn failed_starts_follow_the_same_waits() {
    let mut book = expecting();
    assert_eq!(
        book.start_failed(PK, 1_000),
        Some(Settled::Crashed { restart_in_secs: 5 })
    );
    assert_eq!(book.observe_down(PK, 1_004), DownDecision::Wait);
    assert_eq!(book.observe_down(PK, 1_005), DownDecision::RestartNow);
}

#[test]
fn state_changes_keep_their_first_time() {
    let mut book = SupervisorBook::default();
    assert_eq!(book.record_state(PK, EmployeeState::Starting, 10), (10, true));
    assert_eq!(book.record_state(PK, EmployeeState::Starting, 20), (10, false));
    assert_eq!(book.record_state(PK, EmployeeState::Running, 30), (30, true));
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod foundation_tests;
```

with:

```rust
#[cfg(test)]
mod foundation_tests;
#[cfg(test)]
mod supervisor_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::supervisor_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved import super::supervisor` and `could not find credits_pause in managed_agents`.

- [ ] **Step 3: Add the credits exit stub**

In `src/managed_agents/mod.rs`, replace (line 19):

```rust
pub(crate) mod credits_gateway;
```

with:

```rust
pub(crate) mod credits_gateway;
pub(crate) mod credits_pause;
```

Create `src/managed_agents/credits_pause.rs`:

```rust
//! Credits seam between the team runner and live credits (stub).
//!
//! The harness exits with code 75 when the company is out of credits and
//! with 77 when its credits session ended. Neither is a crash: neither may
//! count toward the crash-loop window or trigger a backoff restart. Part I
//! (live credits, task 9.5) fills these bodies, mapping those codes to
//! `PausedForCredits` or `RestartNow`, and keeps every signature. Until then
//! no harness exits with those codes, and the stub changes nothing.

use tauri::AppHandle;

/// What the team runner does with one unexpected harness exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitHandling {
    /// The company is paused for credits: do not restart.
    PausedForCredits,
    /// Restart at once without counting a crash.
    RestartNow,
    /// Apply the crash policy (backoff, crash loop).
    Crash,
}

/// Called for every unexpected harness exit, before the crash policy.
pub(crate) async fn on_harness_exit(
    _app: &AppHandle,
    _relay_url: &str,
    _agent_pubkey: &str,
    _code: Option<i32>,
) -> ExitHandling {
    ExitHandling::Crash
}

/// Whether the company is paused because its credits ran out. Start on
/// launch skips such a company and watches it instead.
pub(crate) fn is_paused_for_credits(_app: &AppHandle, _relay_url: &str) -> bool {
    false
}

/// Watch a company paused for credits, to resume it once credits arrive.
pub(crate) fn ensure_watcher(_app: &AppHandle, _relay_url: &str) {}

/// Called first by `team_resume`: `Ok(true)` when it resumed a credits pause
/// (nothing more to do), `Ok(false)` when the caller resumes as a person.
pub(crate) async fn resume_if_funded(_app: &AppHandle, _relay_url: &str) -> Result<bool, String> {
    Ok(false)
}
```

- [ ] **Step 4: Add the supervisor book**

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod companies;
mod computer;
```

with:

```rust
mod companies;
mod computer;
mod supervisor;
```

Replace:

```rust
    /// Latest team computer record seen per normalized company relay.
    claims: Mutex<HashMap<String, claim::ClaimView>>,
}
```

with:

```rust
    /// Latest team computer record seen per normalized company relay.
    claims: Mutex<HashMap<String, claim::ClaimView>>,
    /// Which employees should run, and their crash history.
    book: Mutex<supervisor::SupervisorBook>,
}

/// Run `f` on the supervisor book (a leaf lock).
pub(crate) fn with_book<R: Runtime, T>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut supervisor::SupervisorBook) -> T,
) -> Result<T, String> {
    let state = runner(app)?;
    let mut book = state.book.lock().map_err(|_| poisoned())?;
    Ok(f(&mut book))
}
```

Create `src/managed_agents/team_runner/supervisor.rs`:

```rust
//! Restart policy for a company's employees. No I/O here.
//!
//! The book is desired state: an employee the team runner expects to run and
//! finds down is restarted after a wait that grows 5 s, 15 s, 45 s, 2 min and
//! 5 min along a streak of exits. The fifth counted exit within ten minutes
//! is a crash loop: the employee is failing and nothing restarts it until a
//! person does. An employee stopped on purpose is not expected and is never
//! restarted. A credits exit is settled by `credits_pause` and never counted.

use std::collections::{HashMap, VecDeque};

use super::EmployeeState;
use crate::managed_agents::credits_pause::ExitHandling;

/// Waits before a restart, by position in the current streak of exits.
pub(crate) const BACKOFF_SECS: [i64; 5] = [5, 15, 45, 120, 300];
/// The crash-loop window.
pub(crate) const CRASH_WINDOW_SECS: i64 = 600;
/// Counted exits inside the window that make a crash loop.
pub(crate) const CRASH_LOOP_EXITS: usize = 5;
/// An employee that stays up this long starts a fresh streak.
pub(crate) const HEALTHY_AFTER_SECS: i64 = 600;

/// What to do about an expected employee that is not running.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DownDecision {
    /// Not expected, failing, or nothing to do.
    Ignore,
    /// First sighting of this exit: settle it with its exit code.
    NewExit,
    /// A restart is scheduled and not due yet.
    Wait,
    /// Start it now.
    RestartNow,
}

/// How one exit or failed start was settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Settled {
    /// Credits paused the company; nothing restarts.
    Paused,
    /// Restart at once, not counted.
    RestartNow,
    /// Counted; restart after this many seconds.
    Crashed {
        /// Seconds until the restart.
        restart_in_secs: i64,
    },
    /// Counted; the fifth in ten minutes: failing, no restart.
    CrashLoop,
}

#[derive(Debug, Clone, Default)]
struct Entry {
    relay_url: String,
    expected: bool,
    exits: VecDeque<i64>,
    streak: usize,
    up_since: Option<i64>,
    down_since: Option<i64>,
    restart_at: Option<i64>,
    failing: bool,
    state: Option<(EmployeeState, i64)>,
}

/// Every employee the team runner knows about, keyed by lowercase pubkey.
#[derive(Debug, Default)]
pub(crate) struct SupervisorBook {
    entries: HashMap<String, Entry>,
}

fn key(pubkey: &str) -> String {
    pubkey.to_ascii_lowercase()
}

impl SupervisorBook {
    /// The team runner wants `pubkey` running on `relay_url`.
    pub(crate) fn expect_running(&mut self, pubkey: &str, relay_url: &str) {
        let entry = self.entries.entry(key(pubkey)).or_default();
        entry.relay_url = relay_url.to_string();
        entry.expected = true;
        entry.down_since = None;
        entry.restart_at = None;
    }

    /// The pair on `relay_url` was stopped on purpose (a person, pause,
    /// delete or a move). A stop on another relay changes nothing.
    pub(crate) fn note_stopped(&mut self, pubkey: &str, relay_url: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            if entry.relay_url == relay_url {
                entry.expected = false;
                entry.down_since = None;
                entry.restart_at = None;
                entry.up_since = None;
            }
        }
    }

    /// Forget the crash history: a person restarted the employee.
    pub(crate) fn reset(&mut self, pubkey: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.exits.clear();
            entry.streak = 0;
            entry.failing = false;
            entry.down_since = None;
            entry.restart_at = None;
        }
    }

    /// The pair is running.
    pub(crate) fn note_up(&mut self, pubkey: &str, now: i64) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.down_since = None;
            entry.restart_at = None;
            let up_since = *entry.up_since.get_or_insert(now);
            if now - up_since >= HEALTHY_AFTER_SECS {
                entry.streak = 0;
            }
        }
    }

    /// The pair is not running.
    pub(crate) fn observe_down(&mut self, pubkey: &str, now: i64) -> DownDecision {
        let Some(entry) = self.entries.get_mut(&key(pubkey)) else {
            return DownDecision::Ignore;
        };
        if !entry.expected || entry.failing {
            return DownDecision::Ignore;
        }
        entry.up_since = None;
        if entry.down_since.is_none() {
            entry.down_since = Some(now);
            return DownDecision::NewExit;
        }
        match entry.restart_at {
            Some(at) if now >= at => DownDecision::RestartNow,
            _ => DownDecision::Wait,
        }
    }

    /// Settle a new exit with what the credits seam decided.
    pub(crate) fn settle_exit(
        &mut self,
        pubkey: &str,
        now: i64,
        handling: ExitHandling,
    ) -> Option<Settled> {
        match handling {
            ExitHandling::PausedForCredits => {
                self.entries.get_mut(&key(pubkey))?.restart_at = None;
                Some(Settled::Paused)
            }
            ExitHandling::RestartNow => {
                self.entries.get_mut(&key(pubkey))?.restart_at = Some(now);
                Some(Settled::RestartNow)
            }
            ExitHandling::Crash => self.count_failure(pubkey, now),
        }
    }

    /// A restart is being attempted: the next sighting of this employee down
    /// is a new exit, so a harness that dies at once is counted.
    pub(crate) fn restarting(&mut self, pubkey: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.down_since = None;
            entry.restart_at = None;
        }
    }

    /// A start attempt failed; counted like a crash.
    pub(crate) fn start_failed(&mut self, pubkey: &str, now: i64) -> Option<Settled> {
        self.count_failure(pubkey, now)
    }

    fn count_failure(&mut self, pubkey: &str, now: i64) -> Option<Settled> {
        let entry = self.entries.get_mut(&key(pubkey))?;
        if !entry.expected || entry.failing {
            return None;
        }
        entry.down_since.get_or_insert(now);
        entry.exits.push_back(now);
        while entry
            .exits
            .front()
            .is_some_and(|at| now - at >= CRASH_WINDOW_SECS)
        {
            entry.exits.pop_front();
        }
        entry.streak += 1;
        if entry.exits.len() >= CRASH_LOOP_EXITS {
            entry.failing = true;
            entry.restart_at = None;
            return Some(Settled::CrashLoop);
        }
        let wait = BACKOFF_SECS[(entry.streak - 1).min(BACKOFF_SECS.len() - 1)];
        entry.restart_at = Some(now + wait);
        Some(Settled::Crashed {
            restart_in_secs: wait,
        })
    }

    /// Remember the reported state; returns when it began and whether it changed.
    pub(crate) fn record_state(&mut self, pubkey: &str, state: EmployeeState, now: i64) -> (i64, bool) {
        let entry = self.entries.entry(key(pubkey)).or_default();
        match entry.state {
            Some((current, since)) if current == state => (since, false),
            _ => {
                entry.state = Some((state, now));
                (now, true)
            }
        }
    }

    /// Counted exits in the last ten minutes.
    pub(crate) fn restarts_in_window(&self, pubkey: &str, now: i64) -> u32 {
        self.entries.get(&key(pubkey)).map_or(0, |entry| {
            let recent = entry
                .exits
                .iter()
                .filter(|at| now - **at < CRASH_WINDOW_SECS)
                .count();
            u32::try_from(recent).unwrap_or(u32::MAX)
        })
    }

    /// Whether restarts stopped after a crash loop.
    pub(crate) fn is_failing(&self, pubkey: &str) -> bool {
        self.entries
            .get(&key(pubkey))
            .is_some_and(|entry| entry.failing)
    }

    /// Whether the team runner wants `pubkey` running.
    pub(crate) fn is_expected(&self, pubkey: &str) -> bool {
        self.entries
            .get(&key(pubkey))
            .is_some_and(|entry| entry.expected)
    }

    /// Employees expected to run on `relay_url`.
    pub(crate) fn expected_on(&self, relay_url: &str) -> Vec<String> {
        let mut pubkeys: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.expected && entry.relay_url == relay_url)
            .map(|(pubkey, _)| pubkey.clone())
            .collect();
        pubkeys.sort();
        pubkeys
    }
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (9 `supervisor_tests` and the earlier team runner tests, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner desktop/src-tauri/src/managed_agents/credits_pause.rs desktop/src-tauri/src/managed_agents/mod.rs
git commit -s -m "feat(desktop): restart policy with backoff, crash loops and credits exits"
```

---

### Task 4.8: Status, problems, the supervisor loop and the stop hooks

**Files:**
- Create: `src/managed_agents/team_runner/status.rs`, `src/managed_agents/team_runner/watch.rs`
- Create: `src/managed_agents/team_runner/status_tests.rs`, `src/managed_agents/team_runner/watch_tests.rs`, `src/managed_agents/team_runner/hooks_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (modules, hooks, company helpers, `problem_detail`)
- Modify: `src/managed_agents/team_runner/companies.rs` (`NOT_SET_UP` becomes `pub(crate)`)
- Modify: `src/managed_agents/runtime.rs` (spawn hook after the `harness_spawn_ms` line; `request_graceful_exit` export)
- Modify: `src/managed_agents/runtime/process.rs` (after `terminate_process` for Unix, line 330)
- Modify: `src/managed_agents/runtime/stop.rs:46` and `src/managed_agents/runtime_commands.rs:333` (stop hooks)
- Test: the three new test files

**Interfaces:**
- Consumes: Task 4.7 book and `credits_pause::ExitHandling`; `crate::managed_agents::{sync_managed_agent_processes, load_managed_agents, save_managed_agents, current_instance_id, start_managed_agent_runtime_pair_lazy, ManagedAgentRuntimeLifecycle}`; part C's stable log text `wake ledger could not be saved` (it logs it every 30 s while no turn may start).
- Produces:
  - `status::{shown_pause_reason, EmployeeFacts, employee_state, is_team_employee, display_name, snapshot, emit_changes}`. State precedence: away, paused, failing, then the pair: `listening`, `waking` or `ready` is `running`; `starting` (or an expected employee with no live pair) is `starting`; otherwise `stopped`. A paused status carries `pause_reason`, credits first, then plan limit, then person.
  - `watch::{spawn_supervisor_loop, DiskWatch, read_window, contains_ledger_failure, LEDGER_FAILURE_TEXT, MAX_LOG_SCAN_BYTES, DISK_PROBLEM_REPEAT_SECS}`. Every 2 s the loop reaps exited harnesses with the canonical reaper (exit codes land on the records), restarts expected employees by the book, sends every new exit through `credits_pause::on_harness_exit` (Task 4.7 stub, part I fills it) before the crash policy, reports `crashed`, `start_failed`, `crash_loop` and `disk_full`, and emits status changes.
  - Root: `note_spawned`, `note_stopped_on_purpose`, `shutting_down`, `identity`, `runs_here`, `held_company`, `running_company`, `problem_detail(kind, name)`.
  - `crate::managed_agents::request_graceful_exit(pid)` (Unix: `SIGTERM` to the harness group, which drains its turns for up to 30 s; Windows: no signal exists, the caller's hard stop follows).

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/status_tests.rs`:

```rust
//! What `team_status` reports.

use super::status::{display_name, employee_state, is_team_employee, shown_pause_reason, EmployeeFacts};
use super::{EmployeeState, PauseReason};
use crate::managed_agents::{ManagedAgentRecord, ManagedAgentRuntimeLifecycle};

fn facts<'a>(
    pause_reasons: &'a [PauseReason],
    lifecycle: Option<&'a ManagedAgentRuntimeLifecycle>,
) -> EmployeeFacts<'a> {
    EmployeeFacts {
        away: false,
        pause_reasons,
        failing: false,
        expected: true,
        lifecycle,
    }
}

#[test]
fn away_wins_over_paused_and_failing() {
    let mut employee = facts(&[PauseReason::Person], None);
    employee.failing = true;
    employee.away = true;
    assert_eq!(employee_state(&employee), EmployeeState::Away);
    employee.away = false;
    assert_eq!(employee_state(&employee), EmployeeState::Paused);
    employee.pause_reasons = &[];
    assert_eq!(employee_state(&employee), EmployeeState::Failing);
}

#[test]
fn a_paused_team_shows_the_reason_a_person_must_act_on_first() {
    assert_eq!(
        shown_pause_reason(&[PauseReason::Person, PauseReason::Credits]),
        Some(PauseReason::Credits)
    );
    assert_eq!(
        shown_pause_reason(&[PauseReason::Person, PauseReason::PlanLimit]),
        Some(PauseReason::PlanLimit)
    );
    assert_eq!(shown_pause_reason(&[PauseReason::Person]), Some(PauseReason::Person));
    assert_eq!(shown_pause_reason(&[]), None);
}

#[test]
fn the_pair_lifecycle_maps_to_starting_running_and_stopped() {
    use ManagedAgentRuntimeLifecycle as L;
    for (lifecycle, expected) in [
        (L::Starting, EmployeeState::Starting),
        (L::Listening, EmployeeState::Running),
        (L::Waking, EmployeeState::Running),
        (L::Ready, EmployeeState::Running),
        (L::Failed, EmployeeState::Starting),
    ] {
        assert_eq!(employee_state(&facts(&[], Some(&lifecycle))), expected, "{lifecycle:?}");
    }
    assert_eq!(
        employee_state(&facts(&[], None)),
        EmployeeState::Starting,
        "an expected employee waiting for its restart is starting"
    );
    let mut stopped = facts(&[], None);
    stopped.expected = false;
    assert_eq!(employee_state(&stopped), EmployeeState::Stopped);
}

#[test]
fn employees_are_local_agents_that_start_with_colony_and_keep_their_names() {
    let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
        "pubkey": "ab".repeat(32),
        "name": "naledi",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": true,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses");
    assert!(is_team_employee(&record));
    assert_eq!(display_name(&record), "naledi");
    record.display_name = Some("Naledi".to_string());
    assert_eq!(display_name(&record), "Naledi");
    record.start_on_app_launch = false;
    assert!(!is_team_employee(&record));
}
```

Create `src/managed_agents/team_runner/watch_tests.rs`:

```rust
//! The full-disk watch and the plain problem words.

use std::io::Write;

use super::watch::{contains_ledger_failure, read_window, DiskWatch, MAX_LOG_SCAN_BYTES};
use super::{problem_detail, ProblemKind};

#[test]
fn the_log_window_reads_only_new_bytes_and_at_most_64_kib() {
    assert_eq!(read_window(100, 40), (40, 60));
    assert_eq!(read_window(40, 40), (40, 0));
    assert_eq!(read_window(10, 40), (0, 10), "a replaced log is read from the start");
    let len = 10 * MAX_LOG_SCAN_BYTES;
    assert_eq!(read_window(len, 0), (len - MAX_LOG_SCAN_BYTES, MAX_LOG_SCAN_BYTES));
}

#[test]
fn the_wake_ledger_failure_line_is_found() {
    assert!(contains_ledger_failure(
        b"2026-10-11T09:00:00Z WARN buzz_acp: wake ledger could not be saved; new turns wait until it can\n"
    ));
    assert!(!contains_ledger_failure(b"wake ledger saved\n"));
}

#[test]
fn a_full_disk_is_reported_once_every_ten_minutes() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = dir.path().join("agent.log");
    std::fs::write(&log, b"wake ledger could not be saved; from an earlier run\n").expect("write");
    let mut watch = DiskWatch::default();
    let pubkey = "ab".repeat(32);

    assert!(!watch.check(&pubkey, &log, 1_000), "lines written before the watch began are not reported");
    let mut file = std::fs::OpenOptions::new().append(true).open(&log).expect("open");
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n").expect("append");
    assert!(watch.check(&pubkey, &log, 1_002));
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n").expect("append");
    assert!(!watch.check(&pubkey, &log, 1_032), "repeated within ten minutes");
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n").expect("append");
    assert!(watch.check(&pubkey, &log, 1_602));
}

#[test]
fn problem_details_are_plain_words() {
    for kind in [
        ProblemKind::StartFailed,
        ProblemKind::Crashed,
        ProblemKind::CrashLoop,
        ProblemKind::CreditsOut,
        ProblemKind::DiskFull,
    ] {
        let detail = problem_detail(kind, "Naledi");
        for banned in ["Buzz", "Fizz", "Honey", "\u{2014}", "/", "error", "exit"] {
            assert!(!detail.contains(banned), "{kind:?}: {detail}");
        }
    }
    assert_eq!(
        problem_detail(ProblemKind::DiskFull, "Naledi"),
        "This computer is almost out of space, so Naledi is waiting."
    );
}
```

Create `src/managed_agents/team_runner/hooks_tests.rs`:

```rust
//! The spawn and stop hooks bind to the production functions.

use tauri::Manager;

use super::{note_spawned, note_stopped_on_purpose, TeamCompany, TeamRunnerState};

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PK: &str = "abababababababababababababababababababababababababababababababab";
const ELSEWHERE: &str = "wss://elsewhere.colony.example";

#[test]
fn stop_hooks_only_track_saved_company_relays() {
    let state = TeamRunnerState::default();
    state
        .companies
        .lock()
        .expect("companies")
        .replace(vec![TeamCompany {
            relay_url: RELAY.into(),
            owner_pubkey: OWNER.into(),
        }])
        .expect("valid");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds headless");
    let handle = app.handle();
    let expected = |pubkey: &str| {
        handle
            .state::<TeamRunnerState>()
            .book
            .lock()
            .expect("book")
            .is_expected(pubkey)
    };

    note_spawned(handle, PK, ELSEWHERE);
    assert!(!expected(PK), "a pair on a relay that is not a saved company is not the team's");

    note_spawned(handle, PK, RELAY);
    assert!(expected(PK));

    note_stopped_on_purpose(handle, PK, ELSEWHERE);
    assert!(expected(PK), "stopping another relay's pair keeps the employee expected");

    note_stopped_on_purpose(handle, PK, RELAY);
    assert!(!expected(PK), "a pair stopped on purpose is never restarted");
}
```

Register the three test modules in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod foundation_tests;
```

with:

```rust
#[cfg(test)]
mod foundation_tests;
#[cfg(test)]
mod hooks_tests;
#[cfg(test)]
mod status_tests;
#[cfg(test)]
mod watch_tests;
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: FAIL to compile with `error[E0432]: unresolved imports super::status, super::watch, super::note_spawned, super::problem_detail`.

- [ ] **Step 3: Root helpers and hooks**

In `src/managed_agents/team_runner/companies.rs`, replace:

```rust
const NOT_SET_UP: &str = "This company is not set up on this computer.";
```

with:

```rust
/// Refusal for a relay that is not a saved company.
pub(crate) const NOT_SET_UP: &str = "This company is not set up on this computer.";
```

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod companies;
mod computer;
mod supervisor;
```

with:

```rust
mod companies;
mod computer;
mod status;
mod supervisor;
mod watch;
```

Replace:

```rust
pub(crate) use companies::{CompaniesFile, StoredCompany};
```

with:

```rust
pub(crate) use companies::{CompaniesFile, StoredCompany, NOT_SET_UP};
```

Then append, before the first `#[cfg(test)]` line of the file:

```rust
/// Whether the host is shutting down (no restarts, no activations).
pub(crate) fn shutting_down<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<crate::app_state::AppState>()
        .is_some_and(|state| {
            state
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire)
        })
}

/// The signed-in person's public key (hex).
pub(crate) fn identity<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let state = app
        .try_state::<crate::app_state::AppState>()
        .ok_or_else(|| "Colony is still starting.".to_string())?;
    Ok(state.signing_keys()?.public_key().to_hex())
}

/// Whether the record for `relay_url` names this computer.
pub(crate) fn runs_here<R: Runtime>(app: &AppHandle<R>, relay_url: &str) -> bool {
    let Ok(me) = ensure_computer(app) else {
        return false;
    };
    claim_view(app, relay_url)
        .ok()
        .flatten()
        .and_then(|view| view.holder)
        .is_some_and(|holder| holder.computer_id == me.computer_id)
}

/// The signed-in person's company when this computer holds its team, paused
/// or not (the heartbeat keeps a paused team's record fresh).
pub(crate) fn held_company<R: Runtime>(app: &AppHandle<R>) -> Option<StoredCompany> {
    let identity = identity(app).ok()?;
    let company = saved_companies(app).ok()?.active(&identity).cloned()?;
    runs_here(app, &company.relay_url).then_some(company)
}

/// [`held_company`] when it is not paused: the team the supervisor keeps running.
pub(crate) fn running_company<R: Runtime>(app: &AppHandle<R>) -> Option<StoredCompany> {
    held_company(app).filter(|company| !company.is_paused())
}

/// The normalized relay when it belongs to a saved company.
fn team_relay<R: Runtime>(app: &AppHandle<R>, relay_url: &str) -> Option<String> {
    let relay = normalize_relay(relay_url).ok()?;
    saved_companies(app)
        .ok()?
        .companies
        .iter()
        .any(|company| company.relay_url == relay)
        .then_some(relay)
}

/// Spawn hook (`spawn_agent_child`): a saved company's employee that starts is
/// one the team runner keeps running on that relay.
pub(crate) fn note_spawned<R: Runtime>(app: &AppHandle<R>, pubkey: &str, relay_url: &str) {
    if let Some(relay) = team_relay(app, relay_url) {
        if let Err(error) = with_book(app, |book| book.expect_running(pubkey, &relay)) {
            eprintln!("team runner: could not record a start: {error}");
        }
    }
}

/// Stop hook (`stop_managed_agent_pair`, `stop_managed_agent_runtime`): a pair
/// stopped on purpose is never restarted by the supervisor.
pub(crate) fn note_stopped_on_purpose<R: Runtime>(app: &AppHandle<R>, pubkey: &str, relay_url: &str) {
    if let Some(relay) = team_relay(app, relay_url) {
        if let Err(error) = with_book(app, |book| book.note_stopped(pubkey, &relay)) {
            eprintln!("team runner: could not record a stop: {error}");
        }
    }
}

/// Plain words for each problem: never a path, code, key or model name.
pub(crate) fn problem_detail(kind: ProblemKind, name: &str) -> String {
    match kind {
        ProblemKind::StartFailed => format!("{name} could not start. Colony will try again shortly."),
        ProblemKind::Crashed => format!("{name} stopped unexpectedly. Colony is starting them again."),
        ProblemKind::CrashLoop => format!(
            "{name} keeps stopping, so Colony stopped restarting them. Restart them when you are ready."
        ),
        ProblemKind::CreditsOut => {
            "Your credits ran out, so your team is paused. Add credits to continue.".to_string()
        }
        ProblemKind::DiskFull => {
            format!("This computer is almost out of space, so {name} is waiting.")
        }
    }
}
```

- [ ] **Step 4: Status**

Create `src/managed_agents/team_runner/status.rs`:

```rust
//! Employee runtime status for `team_status` and `team://status`.

use std::collections::HashMap;

use tauri::{AppHandle, Manager};

use super::{
    claim_view, emit_status, ensure_computer, normalize_relay, now_unix, saved_companies,
    with_book, EmployeeRuntimeStatus, EmployeeState, PauseReason, NOT_SET_UP,
};
use crate::app_state::AppState;
use crate::managed_agents::{
    load_managed_agents, BackendKind, ManagedAgentRecord, ManagedAgentRuntimeLifecycle,
};

/// The reason a paused employee shows: credits first, then the plan limit,
/// then a person's pause, the order in which a person must act on them.
pub(crate) fn shown_pause_reason(reasons: &[PauseReason]) -> Option<PauseReason> {
    [PauseReason::Credits, PauseReason::PlanLimit, PauseReason::Person]
        .into_iter()
        .find(|reason| reasons.contains(reason))
}

/// Everything one employee's state depends on.
pub(crate) struct EmployeeFacts<'a> {
    pub(crate) away: bool,
    pub(crate) pause_reasons: &'a [PauseReason],
    pub(crate) failing: bool,
    pub(crate) expected: bool,
    /// The live pair's lifecycle on the company relay, if one is alive.
    pub(crate) lifecycle: Option<&'a ManagedAgentRuntimeLifecycle>,
}

/// Away, then paused, then failing, then the pair's lifecycle.
pub(crate) fn employee_state(facts: &EmployeeFacts<'_>) -> EmployeeState {
    if facts.away {
        return EmployeeState::Away;
    }
    if !facts.pause_reasons.is_empty() {
        return EmployeeState::Paused;
    }
    if facts.failing {
        return EmployeeState::Failing;
    }
    match facts.lifecycle {
        Some(ManagedAgentRuntimeLifecycle::Listening)
        | Some(ManagedAgentRuntimeLifecycle::Waking)
        | Some(ManagedAgentRuntimeLifecycle::Ready) => EmployeeState::Running,
        Some(ManagedAgentRuntimeLifecycle::Starting) => EmployeeState::Starting,
        _ if facts.expected => EmployeeState::Starting,
        _ => EmployeeState::Stopped,
    }
}

/// A company's employees: local agents that start with Colony.
pub(crate) fn is_team_employee(record: &ManagedAgentRecord) -> bool {
    record.start_on_app_launch && record.backend == BackendKind::Local
}

/// The name people see for an employee.
pub(crate) fn display_name(record: &ManagedAgentRecord) -> String {
    record
        .display_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| record.name.clone())
}

/// Every employee's status on `relay_url`, and the ones whose state changed
/// since the last snapshot.
pub(crate) fn snapshot(
    app: &AppHandle,
    relay_url: &str,
) -> Result<(Vec<EmployeeRuntimeStatus>, Vec<EmployeeRuntimeStatus>), String> {
    let relay = normalize_relay(relay_url)?;
    let company = saved_companies(app)?
        .find(&relay)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    let me = ensure_computer(app)?.computer_id;
    let away = claim_view(app, &relay)?
        .and_then(|view| view.holder)
        .is_some_and(|holder| holder.computer_id != me);
    let state = app.state::<AppState>();
    let records = {
        let _store = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        load_managed_agents(app)?
    };
    let lifecycles: HashMap<String, ManagedAgentRuntimeLifecycle> = {
        let mut runtimes = state
            .managed_agent_processes
            .lock()
            .map_err(|error| error.to_string())?;
        runtimes
            .iter_mut()
            .filter(|(key, _)| key.relay_url == relay)
            .filter_map(|(key, runtime)| {
                runtime
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .is_none()
                    .then(|| (key.pubkey.clone(), runtime.lifecycle.clone()))
            })
            .collect()
    };
    let now = now_unix();
    with_book(app, |book| {
        let mut all = Vec::new();
        let mut changed = Vec::new();
        for record in records.iter().filter(|record| is_team_employee(record)) {
            let pubkey = record.pubkey.to_ascii_lowercase();
            let facts = EmployeeFacts {
                away,
                pause_reasons: &company.pause_reasons,
                failing: book.is_failing(&pubkey),
                expected: book.is_expected(&pubkey),
                lifecycle: lifecycles.get(&pubkey),
            };
            let current = employee_state(&facts);
            let (since, moved) = book.record_state(&pubkey, current, now);
            let status = EmployeeRuntimeStatus {
                agent_pubkey: pubkey.clone(),
                name: display_name(record),
                state: current,
                since,
                restarts_in_window: book.restarts_in_window(&pubkey, now),
                pause_reason: if current == EmployeeState::Paused {
                    shown_pause_reason(&company.pause_reasons)
                } else {
                    None
                },
            };
            if moved {
                changed.push(status.clone());
            }
            all.push(status);
        }
        (all, changed)
    })
}

/// Emit `team://status` for every employee whose state changed.
pub(crate) fn emit_changes(app: &AppHandle, relay_url: &str) {
    match snapshot(app, relay_url) {
        Ok((_, changed)) => {
            for status in &changed {
                emit_status(app, status);
            }
        }
        Err(error) => eprintln!("team runner: status is unavailable: {error}"),
    }
}
```

- [ ] **Step 5: The supervisor loop and the full-disk watch**

Create `src/managed_agents/team_runner/watch.rs`:

```rust
//! The supervisor loop and the full-disk watch.
//!
//! Every two seconds: reap exited harnesses (the canonical reaper records each
//! exit code on its record), restart the employees the book expects, send
//! every new exit through the credits seam before the crash policy, report
//! problems, and emit status changes.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::supervisor::{DownDecision, Settled};
use super::{
    emit_problem, now_unix, problem_detail, running_company, shutting_down, with_book,
    EmployeeProblem, ProblemKind,
};
use crate::app_state::AppState;
use crate::managed_agents::{
    credits_pause, current_instance_id, load_managed_agents, save_managed_agents,
    sync_managed_agent_processes, ManagedAgentRecord,
};

const TICK: Duration = Duration::from_secs(2);
/// Part C's stable log text while the wake ledger cannot be saved.
pub(crate) const LEDGER_FAILURE_TEXT: &str = "wake ledger could not be saved";
/// A full disk is reported again at most this often per employee.
pub(crate) const DISK_PROBLEM_REPEAT_SECS: i64 = 600;
/// Most log bytes read per employee per tick.
pub(crate) const MAX_LOG_SCAN_BYTES: u64 = 64 * 1024;

/// Start the loop (once, from activation).
pub(crate) fn spawn_supervisor_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut disk = DiskWatch::default();
        loop {
            tokio::time::sleep(TICK).await;
            if shutting_down(&app) {
                return;
            }
            if let Err(error) = tick(&app, &mut disk).await {
                eprintln!("team runner: supervisor tick failed: {error}");
            }
        }
    });
}

fn report(app: &AppHandle, pubkey: &str, kind: ProblemKind, name: &str) {
    emit_problem(
        app,
        &EmployeeProblem {
            agent_pubkey: pubkey.to_string(),
            kind,
            detail: problem_detail(kind, name),
        },
    );
}

async fn tick(app: &AppHandle, disk: &mut DiskWatch) -> Result<(), String> {
    let Some(company) = running_company(app) else {
        return Ok(());
    };
    let relay = company.relay_url;
    let (records, live) = {
        let (app, relay) = (app.clone(), relay.clone());
        tauri::async_runtime::spawn_blocking(move || reap(&app, &relay))
            .await
            .map_err(|error| error.to_string())??
    };
    let now = now_unix();
    let name_of = |pubkey: &str| {
        records
            .iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey))
            .map(super::status::display_name)
            .unwrap_or_else(|| "An employee".to_string())
    };

    let (new_exits, mut restarts) = with_book(app, |book| {
        let (mut new_exits, mut restarts) = (Vec::new(), Vec::new());
        for pubkey in book.expected_on(&relay) {
            if live.contains_key(&pubkey) {
                book.note_up(&pubkey, now);
                continue;
            }
            match book.observe_down(&pubkey, now) {
                DownDecision::NewExit => new_exits.push(pubkey),
                DownDecision::RestartNow => restarts.push(pubkey),
                DownDecision::Wait | DownDecision::Ignore => {}
            }
        }
        (new_exits, restarts)
    })?;

    for pubkey in new_exits {
        let exit_code = records
            .iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(&pubkey))
            .and_then(|record| record.last_exit_code);
        let handling = credits_pause::on_harness_exit(app, &relay, &pubkey, exit_code).await;
        match with_book(app, |book| book.settle_exit(&pubkey, now, handling))? {
            Some(Settled::Crashed { .. }) => {
                report(app, &pubkey, ProblemKind::Crashed, &name_of(&pubkey))
            }
            Some(Settled::CrashLoop) => {
                report(app, &pubkey, ProblemKind::CrashLoop, &name_of(&pubkey))
            }
            Some(Settled::RestartNow) => restarts.push(pubkey),
            Some(Settled::Paused) | None => {}
        }
    }

    for pubkey in restarts {
        with_book(app, |book| book.restarting(&pubkey))?;
        let started = {
            let (app, pubkey, relay) = (app.clone(), pubkey.clone(), relay.clone());
            tauri::async_runtime::spawn_blocking(move || {
                crate::managed_agents::start_managed_agent_runtime_pair_lazy(pubkey, relay, app)
            })
            .await
        };
        if !matches!(started, Ok(Ok(_))) {
            match with_book(app, |book| book.start_failed(&pubkey, now_unix()))? {
                Some(Settled::CrashLoop) => {
                    report(app, &pubkey, ProblemKind::CrashLoop, &name_of(&pubkey))
                }
                Some(_) => report(app, &pubkey, ProblemKind::StartFailed, &name_of(&pubkey)),
                None => {}
            }
        }
    }

    for (pubkey, log_path) in &live {
        if disk.check(pubkey, log_path, now) {
            report(app, pubkey, ProblemKind::DiskFull, &name_of(pubkey));
        }
    }
    super::status::emit_changes(app, &relay);
    Ok(())
}

/// Reap exited harnesses and list the pairs still alive on `relay` with
/// their log files.
fn reap(
    app: &AppHandle,
    relay: &str,
) -> Result<(Vec<ManagedAgentRecord>, HashMap<String, PathBuf>), String> {
    let state = app.state::<AppState>();
    let _store = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut records = load_managed_agents(app)?;
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    let (changed, _exited) =
        sync_managed_agent_processes(&mut records, &mut runtimes, &current_instance_id(app));
    let live = runtimes
        .iter()
        .filter(|(key, _)| key.relay_url == relay)
        .map(|(key, runtime)| (key.pubkey.clone(), runtime.log_path.clone()))
        .collect();
    drop(runtimes);
    if changed {
        save_managed_agents(app, &records)?;
    }
    Ok((records, live))
}

/// Which bytes to read: everything new since `offset`, at most the newest
/// 64 KiB, and from the start when the log was replaced or truncated.
pub(crate) fn read_window(len: u64, offset: u64) -> (u64, u64) {
    let start = if len < offset { 0 } else { offset };
    let fresh = len - start;
    if fresh > MAX_LOG_SCAN_BYTES {
        (len - MAX_LOG_SCAN_BYTES, MAX_LOG_SCAN_BYTES)
    } else {
        (start, fresh)
    }
}

/// Whether `chunk` holds part C's wake ledger failure text.
pub(crate) fn contains_ledger_failure(chunk: &[u8]) -> bool {
    chunk
        .windows(LEDGER_FAILURE_TEXT.len())
        .any(|window| window == LEDGER_FAILURE_TEXT.as_bytes())
}

#[derive(Debug, Default)]
struct LogCursor {
    path: PathBuf,
    offset: u64,
    last_problem_at: Option<i64>,
}

/// Per-employee log cursors for the full-disk watch.
#[derive(Debug, Default)]
pub(crate) struct DiskWatch {
    cursors: HashMap<String, LogCursor>,
}

impl DiskWatch {
    /// Whether `pubkey`'s log gained the failure text since the last check and
    /// no full disk was reported for it in the last ten minutes. A log seen
    /// for the first time is read from its current end: older lines may come
    /// from an earlier run.
    pub(crate) fn check(&mut self, pubkey: &str, log_path: &Path, now: i64) -> bool {
        let len = std::fs::metadata(log_path).map_or(0, |meta| meta.len());
        let cursor = self.cursors.entry(pubkey.to_string()).or_default();
        if cursor.path != log_path {
            cursor.path = log_path.to_path_buf();
            cursor.offset = len;
            return false;
        }
        let (start, take) = read_window(len, cursor.offset);
        cursor.offset = len;
        if take == 0 {
            return false;
        }
        let Ok(chunk) = read_range(log_path, start, take) else {
            return false;
        };
        if !contains_ledger_failure(&chunk) {
            return false;
        }
        if cursor
            .last_problem_at
            .is_some_and(|at| now - at < DISK_PROBLEM_REPEAT_SECS)
        {
            return false;
        }
        cursor.last_problem_at = Some(now);
        true
    }
}

fn read_range(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut chunk = Vec::new();
    file.take(len).read_to_end(&mut chunk)?;
    Ok(chunk)
}
```

- [ ] **Step 6: The hooks and the graceful exit request in the runtime**

In `src/managed_agents/runtime/process.rs`, after the Unix `terminate_process` (the function ending `signal_process_group_or_leader(pid, libc::SIGKILL, "kill")?;` then `Ok(())` and `}` at line 330), add:

```rust

/// Ask a harness to finish its current turn and exit: `SIGTERM` to its group.
/// The harness drains in-flight turns for up to 30 seconds. The caller stops
/// the pair afterwards.
#[cfg(unix)]
pub(crate) fn request_graceful_exit(pid: u32) -> Result<(), String> {
    signal_process_group_or_leader(pid, libc::SIGTERM, "stop")
}

/// Windows has no signal a harness can drain on; the caller's stop follows at once.
#[cfg(not(unix))]
pub(crate) fn request_graceful_exit(_pid: u32) -> Result<(), String> {
    Ok(())
}
```

In `src/managed_agents/runtime.rs`, replace:

```rust
pub(crate) use process::{
    current_instance_id, probe_buzz_marker, process_belongs_to_us, process_has_buzz_marker,
    process_is_running, terminate_process, terminate_untracked_pair_runtime,
    valid_agent_runtime_receipt, MarkerProbe,
};
```

with:

```rust
pub(crate) use process::{
    current_instance_id, probe_buzz_marker, process_belongs_to_us, process_has_buzz_marker,
    process_is_running, request_graceful_exit, terminate_process,
    terminate_untracked_pair_runtime, valid_agent_runtime_receipt, MarkerProbe,
};
```

Replace:

```rust
    eprintln!(
        "colony-agent timing harness_spawn_ms={}",
        spawn_started.elapsed().as_millis()
    );
```

with:

```rust
    eprintln!(
        "colony-agent timing harness_spawn_ms={}",
        spawn_started.elapsed().as_millis()
    );
    // A saved company's employee that starts is one the team runner keeps running.
    super::team_runner::note_spawned(app, &record.pubkey, &runtime_key.relay_url);
```

In `src/managed_agents/runtime/stop.rs` (`stop_managed_agent_pair`, line 46), replace:

```rust
    let Some(mut runtime) = runtimes.remove(key) else {
        return Ok(());
    };
```

with:

```rust
    // Stopped on purpose: the team runner never restarts this pair.
    crate::managed_agents::team_runner::note_stopped_on_purpose(app, &record.pubkey, &key.relay_url);
    let Some(mut runtime) = runtimes.remove(key) else {
        return Ok(());
    };
```

In `src/managed_agents/runtime_commands.rs` (`stop_managed_agent_runtime`, line 333), replace:

```rust
    let record = find_managed_agent_mut(&mut records, &pubkey)?;
    let key = ManagedAgentRuntimeKey::new(pubkey, &relay_url)?;
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(mut runtime) = runtimes.remove(&key) {
```

with:

```rust
    let record = find_managed_agent_mut(&mut records, &pubkey)?;
    let key = ManagedAgentRuntimeKey::new(pubkey, &relay_url)?;
    // Stopped on purpose: the team runner never restarts this pair.
    super::team_runner::note_stopped_on_purpose(&app, &key.pubkey, &key.relay_url);
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(mut runtime) = runtimes.remove(&key) {
```

- [ ] **Step 7: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::team_runner managed_agents::runtime)`
Expected: PASS (4 `status_tests`, 4 `watch_tests`, 1 `hooks_tests` and every earlier test, 0 failed).

- [ ] **Step 8: Commit**

```bash
git add desktop/src-tauri/src/managed_agents
git commit -s -m "feat(desktop): supervise team employees, report problems and track stops"
```

---

### Task 4.9: Start on launch without an interface, the heartbeat, pause and resume

**Files:**
- Create: `src/managed_agents/team_runner/launch.rs`
- Create: `src/managed_agents/team_runner/launch_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list, state fields, re-exports)
- Modify: `src/lib.rs` (boot, after the event-flush loop at line 562)
- Test: `src/managed_agents/team_runner/launch_tests.rs`

**Interfaces:**
- Consumes: Tasks 4.3 to 4.8; `crate::managed_agents::{restore_managed_agents_on_launch, load_managed_agents, stop_managed_agent_runtime, request_graceful_exit}`; `AppState::{relay_url_override, managed_agent_restore_pending, shutdown_started}`; `crate::relay_admission::reset_gate_for_workspace_change`; the Task 4.7 credits seam (`is_paused_for_credits`, `ensure_watcher`).
- Produces (module `team_runner::launch`, the two pause functions re-exported at `crate::managed_agents::team_runner` for part I):
  - `pub(crate) async fn pause_company(app: &tauri::AppHandle, relay_url: &str, reason: PauseReason) -> Result<(), String>`: saves the reason first, then stops the team when this computer runs it.
  - `pub(crate) async fn resume_company(app: &tauri::AppHandle, relay_url: &str, reason: PauseReason) -> Result<(), String>`: removes the reason; when none remains and this computer runs the team, clears crash loops and starts it.
  - `ActivationPlan { Idle, StartTeam, Away, Paused { credits }, Retry }`, `activation_plan(view, this_computer_id, reasons, paused_for_credits)`, `still_paused_message(reasons)`.
  - `spawn_on_boot(app)`, `start_loops(app)`, `activate_with_retry(app)`, `activate(app)`, `open_company`, `close_company`, `team_company`, `ensure_runs_here`, `team_employee_pubkeys`, `start_team`, `stop_team`, `stand_down`.
  - Boot behaviour: with a saved company and no interface, the host loads the companies, opens the active company's relay (the new app never calls `apply_workspace`), claims the team (a no-op refresh for the current holder), and when this computer holds it and nothing pauses it, runs launch restore for it. `apply_workspace` from the old app finds `managed_agent_restore_pending` already cleared, so the team is never restored twice.
  - Heartbeat every 2 minutes while this computer holds the team (paused or not). `rate-limited:` is ignored; a refusal that says this computer no longer holds it refreshes the record and stands the team down when another computer took it.
  - Pause stops each employee after its turn: `SIGTERM`, then up to 35 s for the harness's 30 s drain, then the pair stop. On Windows the stop is immediate.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/launch_tests.rs`:

```rust
//! Start on launch and pause decisions (review focus 5).

use super::claim::{spawn_refusal, ClaimView, PAUSED_REFUSAL};
use super::companies::{self, CompaniesFile, COMPANIES_FILE};
use super::launch::{activation_plan, still_paused_message, ActivationPlan};
use super::{PauseReason, TeamCompany, TeamComputerInfo};

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER: &str = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

fn held_by(id: &str) -> ClaimView {
    ClaimView {
        holder: Some(TeamComputerInfo {
            computer_id: id.into(),
            computer_name: "Lerato's MacBook Air".into(),
            last_seen_at: 1_760_180_300,
        }),
        fetched_at: 1_760_180_301,
    }
}

#[test]
fn a_paused_team_stays_paused_after_a_restart() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    let mut file = CompaniesFile::default();
    file.replace(vec![TeamCompany {
        relay_url: RELAY.into(),
        owner_pubkey: OWNER.into(),
    }])
    .expect("valid");
    file.add_pause(RELAY, PauseReason::Person).expect("saved");
    companies::save(&path, &file).expect("save");

    // The computer restarts: the host reads everything back from disk.
    let reloaded = companies::load(&path).expect("load");
    let company = reloaded.find(RELAY).expect("saved");
    assert_eq!(
        activation_plan(&held_by(ME), ME, &company.pause_reasons, false),
        ActivationPlan::Paused { credits: false }
    );
    assert_eq!(
        spawn_refusal(company, Some(&held_by(ME)), Some(ME)).as_deref(),
        Some(PAUSED_REFUSAL),
        "no other start path can start it either"
    );
}

#[test]
fn activation_starts_the_team_only_on_its_own_computer() {
    assert_eq!(activation_plan(&held_by(ME), ME, &[], false), ActivationPlan::StartTeam);
    assert_eq!(activation_plan(&held_by(OTHER), ME, &[], false), ActivationPlan::Away);
    assert_eq!(
        activation_plan(&held_by(OTHER), ME, &[PauseReason::Person], false),
        ActivationPlan::Away,
        "another computer runs it, paused or not"
    );
    let released = ClaimView {
        holder: None,
        fetched_at: 1,
    };
    assert_eq!(activation_plan(&released, ME, &[], false), ActivationPlan::Retry);
}

#[test]
fn a_credits_pause_is_watched_instead_of_started() {
    assert_eq!(
        activation_plan(&held_by(ME), ME, &[PauseReason::Credits], false),
        ActivationPlan::Paused { credits: true }
    );
    assert_eq!(
        activation_plan(&held_by(ME), ME, &[], true),
        ActivationPlan::Paused { credits: true },
        "the credits seam can report a credits pause by itself"
    );
}

#[test]
fn resume_names_the_reason_that_still_holds_the_team() {
    assert_eq!(still_paused_message(&[]), None);
    assert_eq!(
        still_paused_message(&[PauseReason::Credits]).as_deref(),
        Some("Your team is still paused because your credits ran out. Add credits to continue.")
    );
    assert_eq!(
        still_paused_message(&[PauseReason::PlanLimit]).as_deref(),
        Some("Your team is still paused because your plan limit was reached.")
    );
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod hooks_tests;
```

with:

```rust
#[cfg(test)]
mod hooks_tests;
#[cfg(test)]
mod launch_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::launch_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved import super::launch`.

- [ ] **Step 3: Implement**

In `src/managed_agents/team_runner.rs`:

Replace:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
```

with:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
```

Replace:

```rust
mod computer;
mod status;
```

with:

```rust
mod computer;
mod launch;
mod status;
```

Replace:

```rust
pub(crate) use claim::{launch_candidates, TeamSpawn};
```

with:

```rust
pub(crate) use claim::{launch_candidates, TeamSpawn};
pub(crate) use launch::{pause_company, resume_company, spawn_on_boot};
```

Replace:

```rust
    /// Which employees should run, and their crash history.
    book: Mutex<supervisor::SupervisorBook>,
}
```

with:

```rust
    /// Which employees should run, and their crash history.
    book: Mutex<supervisor::SupervisorBook>,
    /// One activation at a time (boot, saved companies, claim, resume).
    activation: tokio::sync::Mutex<()>,
    /// The supervisor and heartbeat loops start once per host.
    loops_started: AtomicBool,
}
```

Create `src/managed_agents/team_runner/launch.rs`:

```rust
//! Start on launch, the claim at every start, the heartbeat, pause and resume.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use buzz_core_pkg::team_computer::TeamComputerActionKind;
use tauri::{AppHandle, Manager};

use super::claim::{ClaimView, HEARTBEAT_EVERY_SECS};
use super::companies::StoredCompany;
use super::{
    claim_io, claim_view, ensure_computer, held_company, identity, normalize_relay, runner,
    runs_here, saved_companies, shutting_down, update_companies, with_book, PauseReason,
    NOT_SET_UP,
};
use crate::app_state::AppState;
use crate::managed_agents::credits_pause;

/// Time a harness gets to finish its turn (it drains for up to 30 s).
const PAUSE_GRACE: Duration = Duration::from_secs(35);
const ACTIVATION_RETRY_FIRST_SECS: u64 = 15;
const ACTIVATION_RETRY_MAX_SECS: u64 = 300;

/// What activation does for the open company.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivationPlan {
    /// No company is saved for the signed-in person.
    Idle,
    /// This computer runs the team: start every employee.
    StartTeam,
    /// Another computer runs the team: start nothing.
    Away,
    /// The team is paused: start nothing (watch credits when paused for credits).
    Paused {
        /// Whether a credits pause is among the reasons.
        credits: bool,
    },
    /// The record names no computer even after a claim: try again later.
    Retry,
}

/// Decide activation from the record, this computer's id and the pause reasons.
pub(crate) fn activation_plan(
    view: &ClaimView,
    this_computer_id: &str,
    reasons: &[PauseReason],
    paused_for_credits: bool,
) -> ActivationPlan {
    let credits = paused_for_credits || reasons.contains(&PauseReason::Credits);
    match view.holder.as_ref() {
        Some(holder) if holder.computer_id != this_computer_id => ActivationPlan::Away,
        Some(_) if credits || !reasons.is_empty() => ActivationPlan::Paused { credits },
        Some(_) => ActivationPlan::StartTeam,
        None => ActivationPlan::Retry,
    }
}

/// Why the team is still paused after a person's resume, in plain words.
pub(crate) fn still_paused_message(reasons: &[PauseReason]) -> Option<String> {
    let message = match super::status::shown_pause_reason(reasons)? {
        PauseReason::Credits => {
            "Your team is still paused because your credits ran out. Add credits to continue."
        }
        PauseReason::PlanLimit => "Your team is still paused because your plan limit was reached.",
        PauseReason::Person => "Your team is still paused.",
    };
    Some(message.to_string())
}

/// Boot (`lib.rs`): load the saved companies, start the loops and activate
/// the team in the background. Nothing waits for an interface.
pub(crate) fn spawn_on_boot(app: AppHandle) {
    if let Err(error) = super::load_saved_companies(&app) {
        eprintln!(
            "team runner: the saved companies could not be read, so the team does not start: {error}"
        );
        return;
    }
    if saved_companies(&app).map_or(true, |file| file.companies.is_empty()) {
        return;
    }
    start_loops(&app);
    tauri::async_runtime::spawn(activate_with_retry(app));
}

/// Start the supervisor and heartbeat loops once per host.
pub(crate) fn start_loops(app: &AppHandle) {
    let Ok(state) = runner(app) else {
        return;
    };
    if state.loops_started.swap(true, Ordering::AcqRel) {
        return;
    }
    super::watch::spawn_supervisor_loop(app.clone());
    spawn_heartbeat_loop(app.clone());
}

/// Activate, retrying after 15 s, 30 s, and so on up to every 5 minutes while
/// the relay or the identity is not ready. Ends on success, on shutdown, or
/// when no company is saved for the signed-in person.
pub(crate) async fn activate_with_retry(app: AppHandle) {
    let mut wait = ACTIVATION_RETRY_FIRST_SECS;
    loop {
        if shutting_down(&app) {
            return;
        }
        match activate(&app).await {
            Ok(_) => return,
            Err(error) => {
                eprintln!("team runner: starting the team will be retried in {wait} s: {error}")
            }
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        wait = (wait * 2).min(ACTIVATION_RETRY_MAX_SECS);
    }
}

/// Bring the signed-in person's company to the state its record and pause
/// reasons call for.
pub(crate) async fn activate(app: &AppHandle) -> Result<ActivationPlan, String> {
    let state = runner(app)?;
    let _one_at_a_time = state.activation.lock().await;
    let identity = identity(app)?;
    let Some(company) = saved_companies(app)?.active(&identity).cloned() else {
        return Ok(ActivationPlan::Idle);
    };
    open_company(app, &company.relay_url)?;
    let me = ensure_computer(app)?.computer_id;
    // Claim at every start: for the current holder this only refreshes its
    // name and time; when another computer holds the team it reads the record.
    let view = claim_io::claim(app, &company.relay_url, false).await?;
    let paused_for_credits = credits_pause::is_paused_for_credits(app, &company.relay_url);
    let plan = activation_plan(&view, &me, &company.pause_reasons, paused_for_credits);
    match plan {
        ActivationPlan::StartTeam => start_team(app, &company).await?,
        ActivationPlan::Paused { credits: true } => {
            credits_pause::ensure_watcher(app, &company.relay_url)
        }
        ActivationPlan::Retry => {
            return Err("the team computer record could not be read yet".to_string())
        }
        ActivationPlan::Paused { credits: false } | ActivationPlan::Away | ActivationPlan::Idle => {}
    }
    super::status::emit_changes(app, &company.relay_url);
    Ok(plan)
}

/// Make `relay_url` the open relay: the one every spawn, message and profile
/// write uses. The new app never calls `apply_workspace`, so the team runner
/// opens the company. A different open relay is never replaced.
pub(crate) fn open_company(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    let wanted = normalize_relay(relay_url)?;
    let state = app.state::<AppState>();
    {
        let mut open = state
            .relay_url_override
            .lock()
            .map_err(|error| error.to_string())?;
        match open.as_deref().and_then(|url| normalize_relay(url).ok()) {
            Some(current) if current == wanted => return Ok(()),
            Some(_) => return Err("Another company is open in Colony. Close it first.".to_string()),
            None => *open = Some(wanted),
        }
    }
    crate::relay_admission::reset_gate_for_workspace_change();
    Ok(())
}

/// Close `relay_url` when it is the open relay (the company was removed).
pub(crate) fn close_company(app: &AppHandle, relay_url: &str) {
    let Ok(relay) = normalize_relay(relay_url) else {
        return;
    };
    let state = app.state::<AppState>();
    let Ok(mut open) = state.relay_url_override.lock() else {
        return;
    };
    if open.as_deref().and_then(|url| normalize_relay(url).ok()).as_deref() == Some(relay.as_str()) {
        *open = None;
    }
}

/// The saved company at `relay_url` for the signed-in person, opened.
pub(crate) fn team_company(app: &AppHandle, relay_url: &str) -> Result<StoredCompany, String> {
    let identity = identity(app)?;
    let company = saved_companies(app)?
        .find(relay_url)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    if !company.owner_pubkey.eq_ignore_ascii_case(&identity) {
        return Err("Sign in as the person who set up this company on this computer.".to_string());
    }
    open_company(app, &company.relay_url)?;
    Ok(company)
}

/// `Ok` when this computer runs `company`'s team; reads the record first when
/// it was never read.
pub(crate) async fn ensure_runs_here(app: &AppHandle, company: &StoredCompany) -> Result<(), String> {
    let me = ensure_computer(app)?.computer_id;
    let view = match claim_view(app, &company.relay_url)? {
        Some(view) => view,
        None => claim_io::refresh(app, &company.relay_url).await?,
    };
    match view.holder {
        Some(holder) if holder.computer_id == me => Ok(()),
        Some(holder) => Err(format!(
            "Your team runs on {}. Do this there, or move the team here first.",
            holder.computer_name
        )),
        None => Err("No computer runs your team yet. Run it on this computer first.".to_string()),
    }
}

/// The public keys of the company's employees on this computer.
pub(crate) fn team_employee_pubkeys(app: &AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let _store = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(crate::managed_agents::load_managed_agents(app)?
        .iter()
        .filter(|record| super::status::is_team_employee(record))
        .map(|record| record.pubkey.to_ascii_lowercase())
        .collect())
}

/// Start every employee of `company` (launch restore with the company open)
/// and expect them to keep running.
pub(crate) async fn start_team(app: &AppHandle, company: &StoredCompany) -> Result<(), String> {
    let state = app.state::<AppState>();
    // This start replaces the deferred restore `apply_workspace` would run,
    // so the old app never restores the team a second time.
    state
        .managed_agent_restore_pending
        .store(false, Ordering::Release);
    let employees = team_employee_pubkeys(app)?;
    with_book(app, |book| {
        for pubkey in &employees {
            book.expect_running(pubkey, &company.relay_url);
        }
    })?;
    crate::managed_agents::restore_managed_agents_on_launch(app, &state.shutdown_started).await
}

fn live_pids(app: &AppHandle, relay: &str, employees: &[String]) -> Result<Vec<u32>, String> {
    let state = app.state::<AppState>();
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(runtimes
        .iter_mut()
        .filter(|(key, _)| key.relay_url == relay && employees.contains(&key.pubkey))
        .filter(|(_, runtime)| runtime.child.try_wait().ok().flatten().is_none())
        .map(|(_, runtime)| runtime.child.id())
        .collect())
}

/// Stop every employee of `relay_url` after its current turn: ask each
/// harness to finish, wait up to 35 s, then stop each pair. The supervisor
/// learns first that the stops are on purpose.
pub(crate) async fn stop_team(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    let employees = team_employee_pubkeys(app)?;
    with_book(app, |book| {
        for pubkey in &employees {
            book.note_stopped(pubkey, &relay);
        }
    })?;
    for pid in live_pids(app, &relay, &employees)? {
        if let Err(error) = crate::managed_agents::request_graceful_exit(pid) {
            eprintln!("team runner: could not ask an employee to finish its turn: {error}");
        }
    }
    let grace = if cfg!(unix) { PAUSE_GRACE } else { Duration::ZERO };
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline && !live_pids(app, &relay, &employees)?.is_empty() {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let mut first_error = None;
    for pubkey in employees {
        let (app, relay) = (app.clone(), relay.clone());
        let stopped = tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::stop_managed_agent_runtime(pubkey, relay, app)
        })
        .await;
        match stopped {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
            }
            Err(error) => {
                first_error.get_or_insert(error.to_string());
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Another computer took the team: stop here and report away.
pub(crate) async fn stand_down(app: &AppHandle, relay_url: &str) {
    if let Err(error) = stop_team(app, relay_url).await {
        eprintln!("team runner: standing down left an employee running: {error}");
    }
    super::status::emit_changes(app, relay_url);
}

/// Pause `relay_url`'s team for `reason`. The reason is saved before anything
/// stops, so a restart keeps the team paused; the team stops when this
/// computer runs it.
pub(crate) async fn pause_company(
    app: &AppHandle,
    relay_url: &str,
    reason: PauseReason,
) -> Result<(), String> {
    update_companies(app, |file| file.add_pause(relay_url, reason))?;
    if runs_here(app, relay_url) {
        stop_team(app, relay_url).await?;
    }
    super::status::emit_changes(app, relay_url);
    Ok(())
}

/// Clear `reason`. When no reason remains and this computer runs the team,
/// give failing employees a fresh start and start the team.
pub(crate) async fn resume_company(
    app: &AppHandle,
    relay_url: &str,
    reason: PauseReason,
) -> Result<(), String> {
    update_companies(app, |file| file.remove_pause(relay_url, reason))?;
    let company = saved_companies(app)?
        .find(relay_url)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    if !company.is_paused() && runs_here(app, &company.relay_url) {
        let employees = team_employee_pubkeys(app)?;
        with_book(app, |book| {
            for pubkey in &employees {
                book.reset(pubkey);
            }
        })?;
        start_team(app, &company).await?;
    }
    super::status::emit_changes(app, &company.relay_url);
    Ok(())
}

/// Heartbeat every two minutes while this computer holds the team.
fn spawn_heartbeat_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(HEARTBEAT_EVERY_SECS)).await;
            if shutting_down(&app) {
                return;
            }
            let Some(company) = held_company(&app) else {
                continue;
            };
            let sent = claim_io::publish(
                &app,
                &company.relay_url,
                TeamComputerActionKind::Heartbeat,
                false,
            )
            .await;
            match sent {
                Ok(()) => {}
                Err(error) if claim_io::is_rate_limited(&error) => {}
                Err(error) if claim_io::is_not_holder(&error) => {
                    match claim_io::refresh(&app, &company.relay_url).await {
                        Ok(_) if !runs_here(&app, &company.relay_url) => {
                            stand_down(&app, &company.relay_url).await
                        }
                        Ok(_) => {}
                        Err(refresh_error) => eprintln!(
                            "team runner: could not check which computer runs the team: {refresh_error}"
                        ),
                    }
                }
                Err(error) => {
                    eprintln!("team runner: heartbeat failed; the team keeps running: {error}")
                }
            }
        }
    });
}
```

In `src/lib.rs`, replace (the end of the event-flush block and of `setup`, lines 560-565):

```rust
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
```

with:

```rust
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                });
            }

            // The team runner starts saved companies' employees with no
            // interface: no `apply_workspace` is needed. Same gates as launch
            // restore: nothing starts during repos or identity recovery.
            if restore_agents && !recovery_mode {
                managed_agents::team_runner::spawn_on_boot(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (4 `launch_tests` and every earlier team runner test, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner desktop/src-tauri/src/lib.rs
git commit -s -m "feat(desktop): start the team on launch without an interface; pause and resume with reasons"
```

---

### Task 4.10: The hire journal and the hire step machine

**Files:**
- Create: `src/managed_agents/team_runner/hire_journal.rs`
- Create: `src/managed_agents/team_runner/hire.rs`
- Create: `src/managed_agents/team_runner/hire_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list, re-exports, state field)
- Test: `src/managed_agents/team_runner/hire_tests.rs`

**Interfaces:**
- Consumes: Task 4.2 `RoleContext`; part B `buzz_core_pkg::company_duties::is_timezone_label`; part B relay rules (an approved head, `AttachEmployee` on the exact head, the owner and the employee members of the home channel before `Complete`, a replayed `Complete` answered `duplicate:`).
- Produces:
  - `hire_journal::{JOURNAL_FILE = "hire-journal.json", HireStep { Opened, EmployeeCreated, EmployeeAttached, EmployeeInChannel, OwnerInChannel, HelloPosted, Completed, Started }, HireJournalEntry, HireJournal, load, save}`. An entry keeps the hire, the resolved company time zone, the step, the employee, the introduction event, the replay floor and the last error. Unfinished entries are never pruned; finished ones go after 30 days; at most 200 entries.
  - `hire::{HireCompleteInput, HireCompleteState { Started, Resumed, AlreadyComplete }, HireCompleteResult, HireView, ProposalView, RolePackView, OnHireView, ValidatedHire, HireIo, run_hire, validated_input, new_entry, existing_entry_state, choose_time_zone, hire_view_from, role_context_for, hello_text, hello_marker, gate_hold_from, GATE_HOLD}` and the plain refusals `FINISHED_ELSEWHERE`, `CHANGED`, `NOT_APPROVED`, `DECLINED`, `GONE`, `NOT_FOUNDER`.
  - `HireCompleteInput` keeps the overview's shape and accepts `timeZone` but ignores it (contract change 1): the time zone comes from the business profile head.
  - Step rules, each checking whether it already happened: find the employee by its role context goal (the hire id) or create it; attach it unless the head already names it; add it to the home channel; add the owner to the home channel (coordinator rule: before `Complete`, idempotent); post the hello as the employee under the marker `company-hire:<hire id>:introduction`; capture the replay floor and publish `Complete` with the company time zone unless the head already says `hired`; start the employee with that floor.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/hire_tests.rs`:

```rust
//! A hire finishes exactly once wherever the host was killed (overview review
//! focus 1): one employee, one hello, one Complete.

use std::collections::BTreeSet;

use uuid::Uuid;

use super::hire::{
    choose_time_zone, existing_entry_state, gate_hold_from, hello_marker, hello_text,
    hire_view_from, new_entry, role_context_for, run_hire, validated_input, HireCompleteInput,
    HireCompleteState, HireIo, HireView, CHANGED, FINISHED_ELSEWHERE, NOT_FOUNDER,
};
use super::hire_journal::{self, HireJournal, HireJournalEntry, HireStep, JOURNAL_FILE};
use crate::managed_agents::RoleContext;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const STRANGER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const HIRE: &str = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const CHANNEL: &str = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const RELAY: &str = "wss://lerato.colony.example";
const ZONE: &str = "Africa/Johannesburg";

/// The relay and this computer: what a killed host leaves behind.
struct World {
    status: String,
    head_version: u32,
    founder: String,
    attached: Option<String>,
    /// Local employee records: public key and role context goal.
    employees: Vec<(String, Option<String>)>,
    members: BTreeSet<String>,
    /// Posted hellos: marker and event id.
    hellos: Vec<(String, String)>,
    completes: u32,
    completed_zone: Option<String>,
    completed_at: Option<i64>,
    running: BTreeSet<String>,
    start_floors: Vec<Option<u64>>,
    journal: Option<HireJournalEntry>,
    clock: i64,
    log: Vec<&'static str>,
}

impl World {
    fn approved() -> Self {
        Self {
            status: "approved".into(),
            head_version: 1,
            founder: OWNER.into(),
            attached: None,
            employees: Vec::new(),
            members: BTreeSet::new(),
            hellos: Vec::new(),
            completes: 0,
            completed_zone: None,
            completed_at: None,
            running: BTreeSet::new(),
            start_floors: Vec::new(),
            journal: None,
            clock: 1_760_180_000,
            log: Vec::new(),
        }
    }
}

/// Every effect is fenced by boundaries. The host dies at boundary
/// `crash_at`; after that nothing happens.
struct FakeIo<'w> {
    world: &'w mut World,
    crash_at: Option<usize>,
    seen: usize,
    dead: bool,
}

impl<'w> FakeIo<'w> {
    fn new(world: &'w mut World, crash_at: Option<usize>) -> Self {
        Self {
            world,
            crash_at,
            seen: 0,
            dead: false,
        }
    }

    fn boundary(&mut self) -> Result<(), String> {
        if self.dead {
            return Err("the host is gone".into());
        }
        let here = self.seen;
        self.seen += 1;
        if self.crash_at == Some(here) {
            self.dead = true;
            return Err(format!("the host was killed at boundary {here}"));
        }
        self.world.clock += 1;
        Ok(())
    }
}

fn proposal() -> serde_json::Value {
    serde_json::json!({
        "hireId": HIRE,
        "rolePack": {
            "personaId": "builtin:test-employee",
            "title": "Test Employee",
            "job": "Post one short note a day",
            "skills": [],
            "tools": [],
            "workerMenu": ["claude"],
            "owns": "One short note a day",
            "askBefore": ["anything public"],
            "onHire": { "sources": ["business profile"], "planHorizonDays": 14 }
        },
        "displayName": "Gate Tester",
        "title": "Test Employee",
        "introductionChannelId": CHANNEL,
        "runtimeId": "claude"
    })
}

fn view_of(world: &World) -> HireView {
    let head = serde_json::json!({
        "schemaVersion": 1,
        "proposal": proposal(),
        "status": world.status,
        "proposedByPubkey": OWNER,
        "founderPubkey": world.founder,
        "employeePubkey": world.attached,
        "sourceActionEventId": "00",
        "fieldFromANewerRelay": true
    });
    hire_view_from(&format!("head-{}", world.head_version), &head.to_string())
        .expect("head parses")
}

impl HireIo for FakeIo<'_> {
    fn owner(&self) -> &str {
        OWNER
    }

    fn now(&self) -> i64 {
        self.world.clock
    }

    async fn hire(&mut self, _hire_id: Uuid) -> Result<Option<HireView>, String> {
        self.boundary()?;
        Ok(Some(view_of(self.world)))
    }

    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String> {
        self.boundary()?;
        let goal = hire_id.to_string();
        Ok(self
            .world
            .employees
            .iter()
            .find(|(pubkey, made_for)| {
                made_for.as_deref() == Some(goal.as_str()) || Some(pubkey.as_str()) == attached
            })
            .map(|(pubkey, _)| pubkey.clone()))
    }

    async fn manager_name(&mut self, _manager_pubkey: &str) -> Option<String> {
        None
    }

    async fn create_employee(&mut self, _view: &HireView, role: RoleContext) -> Result<String, String> {
        self.boundary()?;
        let pubkey = format!("{:064x}", self.world.employees.len() + 1);
        self.world.employees.push((pubkey.clone(), role.goal_id));
        self.world.log.push("create_employee");
        self.boundary()?;
        Ok(pubkey)
    }

    async fn ensure_profile(&mut self, _employee: &str) -> Result<(), String> {
        self.boundary()?;
        self.boundary()
    }

    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String> {
        self.boundary()?;
        if view.head_event_id != format!("head-{}", self.world.head_version)
            || self.world.attached.is_some()
        {
            return Err("relay rejected event: the hire head moved".into());
        }
        self.world.attached = Some(employee.to_string());
        self.world.head_version += 1;
        self.world.log.push("attach_employee");
        self.boundary()
    }

    async fn add_employee_to_channel(&mut self, _channel: Uuid, employee: &str) -> Result<(), String> {
        self.boundary()?;
        self.world.members.insert(employee.to_string());
        self.world.log.push("employee_in_channel");
        self.boundary()
    }

    async fn ensure_owner_in_channel(&mut self, _channel: Uuid) -> Result<(), String> {
        self.boundary()?;
        self.world.members.insert(OWNER.to_string());
        self.world.log.push("owner_in_channel");
        self.boundary()
    }

    async fn post_hello(
        &mut self,
        _employee: &str,
        _channel: Uuid,
        _text: &str,
        marker: &str,
    ) -> Result<String, String> {
        self.boundary()?;
        if let Some((_, id)) = self.world.hellos.iter().find(|(posted, _)| posted == marker) {
            return Ok(id.clone());
        }
        let id = format!("{:064x}", 900 + self.world.hellos.len());
        self.world.hellos.push((marker.to_string(), id.clone()));
        self.world.log.push("hello");
        self.boundary()?;
        Ok(id)
    }

    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String> {
        self.boundary()?;
        // The relay's rules (part B).
        if self.world.status == "hired" {
            return Err("relay rejected event: founder sign-off is required before hiring".into());
        }
        if view.head_event_id != format!("head-{}", self.world.head_version) {
            return Err("relay rejected event: the hire head moved".into());
        }
        assert_eq!(self.world.attached.as_deref(), Some(employee));
        assert!(
            self.world.members.contains(OWNER) && self.world.members.contains(employee),
            "the owner and the employee join the home channel before Complete"
        );
        assert!(self.world.hellos.iter().any(|(_, id)| id == introduction_event_id));
        self.world.status = "hired".into();
        self.world.head_version += 1;
        self.world.completes += 1;
        self.world.completed_zone = Some(time_zone.to_string());
        self.world.completed_at = Some(self.world.clock);
        self.world.log.push("complete");
        self.boundary()
    }

    async fn start_employee(&mut self, employee: &str, replay_floor: Option<u64>) -> Result<(), String> {
        self.boundary()?;
        // A pair that already runs is not started twice (`start_pair`).
        self.world.running.insert(employee.to_string());
        self.world.start_floors.push(replay_floor);
        self.boundary()
    }

    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String> {
        self.boundary()?;
        self.world.journal = Some(entry.clone());
        self.boundary()
    }

    async fn hold_after(&mut self, _step: HireStep) {}
}

fn input() -> HireCompleteInput {
    HireCompleteInput {
        relay_url: RELAY.into(),
        hire_id: HIRE.into(),
        persona_id: "builtin:test-employee".into(),
        display_name: "Gate Tester".into(),
        home_channel_id: CHANNEL.into(),
        time_zone: None,
    }
}

fn fresh_entry() -> HireJournalEntry {
    new_entry(
        &validated_input(&input()).expect("valid input"),
        ZONE.to_string(),
        1_760_180_000,
    )
}

#[tokio::test]
async fn interrupted_hire_resumes_to_exactly_one_employee_hello_and_complete() {
    let mut boundary = 0;
    loop {
        let mut world = World::approved();
        let entry = fresh_entry();
        // The command saves the entry before the first side effect.
        world.journal = Some(entry.clone());

        let first = run_hire(&mut FakeIo::new(&mut world, Some(boundary)), entry).await;
        if first.is_ok() {
            assert!(boundary > 20, "every boundary of a hire was interrupted once");
            break;
        }

        // Colony starts again and resumes from the journal on disk.
        let resumed = world.journal.clone().expect("a journal entry is on disk");
        let employee = run_hire(&mut FakeIo::new(&mut world, None), resumed)
            .await
            .unwrap_or_else(|error| panic!("boundary {boundary}: {error}"));

        assert_eq!(world.employees.len(), 1, "boundary {boundary}: one employee");
        assert_eq!(world.hellos.len(), 1, "boundary {boundary}: one hello");
        assert_eq!(world.completes, 1, "boundary {boundary}: one Complete");
        assert_eq!(world.attached.as_deref(), Some(employee.as_str()));
        assert!(world.members.contains(OWNER) && world.members.contains(&employee));
        assert_eq!(world.completed_zone.as_deref(), Some(ZONE));
        assert_eq!(world.running, BTreeSet::from([employee.clone()]));
        let floor = world
            .start_floors
            .last()
            .copied()
            .flatten()
            .expect("the first start carries a replay floor");
        assert!(
            i64::try_from(floor).expect("small") < world.completed_at.expect("completed"),
            "boundary {boundary}: the floor is taken before Complete, so the kickoff is replayed"
        );
        assert_eq!(world.journal.map(|entry| entry.step), Some(HireStep::Started));
        boundary += 1;
    }
}

#[tokio::test]
async fn the_owner_joins_the_home_channel_before_complete() {
    let mut world = World::approved();
    run_hire(&mut FakeIo::new(&mut world, None), fresh_entry())
        .await
        .expect("hire finishes");
    let at = |what: &str| {
        world
            .log
            .iter()
            .position(|done| *done == what)
            .unwrap_or_else(|| panic!("{what} happened"))
    };
    assert!(at("employee_in_channel") < at("complete"));
    assert!(at("owner_in_channel") < at("complete"));
    assert!(at("hello") < at("complete"));
    assert!(at("attach_employee") < at("hello"));
}

#[tokio::test]
async fn a_hire_finished_on_another_computer_creates_no_employee() {
    let mut world = World::approved();
    world.status = "hired".into();
    world.attached = Some(STRANGER.into());
    let result = run_hire(&mut FakeIo::new(&mut world, None), fresh_entry()).await;
    assert_eq!(result, Err(FINISHED_ELSEWHERE.to_string()));
    assert!(world.employees.is_empty());
}

#[tokio::test]
async fn only_the_approving_founder_finishes_a_hire() {
    let mut world = World::approved();
    world.founder = STRANGER.into();
    let result = run_hire(&mut FakeIo::new(&mut world, None), fresh_entry()).await;
    assert_eq!(result, Err(NOT_FOUNDER.to_string()));
    assert!(world.employees.is_empty());
}

#[tokio::test]
async fn a_hire_that_changed_is_refused_before_anything_happens() {
    let mut world = World::approved();
    let mut entry = fresh_entry();
    entry.display_name = "Someone Else".into();
    let result = run_hire(&mut FakeIo::new(&mut world, None), entry).await;
    assert_eq!(result, Err(CHANGED.to_string()));
    assert!(world.employees.is_empty());
}

#[test]
fn a_journal_entry_says_whether_the_hire_resumed_or_was_already_complete() {
    let mut entry = fresh_entry();
    entry.step = HireStep::HelloPosted;
    assert_eq!(existing_entry_state(&entry), HireCompleteState::Resumed);
    entry.step = HireStep::Started;
    assert_eq!(existing_entry_state(&entry), HireCompleteState::AlreadyComplete);
}

#[test]
fn the_company_time_zone_comes_from_the_profile_then_this_computer() {
    assert_eq!(choose_time_zone(Some(ZONE), Some("Europe/London")), ZONE);
    assert_eq!(choose_time_zone(None, Some("Europe/London")), "Europe/London");
    assert_eq!(choose_time_zone(None, Some("not a zone!")), "UTC");
    assert_eq!(choose_time_zone(None, None), "UTC");
}

#[test]
fn the_hello_is_plain_and_names_the_role() {
    let hello = hello_text("Naledi", "Social Media Manager");
    assert_eq!(
        hello,
        "Hi everyone, I'm Naledi, the new Social Media Manager. I'm reading up on the business and will share my plan soon."
    );
    for banned in ["Buzz", "Fizz", "Honey", "\u{2014}"] {
        assert!(!hello.contains(banned));
    }
    let hire_id = Uuid::parse_str(HIRE).expect("uuid");
    assert_eq!(hello_marker(hire_id), format!("company-hire:{HIRE}:introduction"));
}

#[test]
fn the_role_context_carries_the_hire_as_its_goal() {
    let world = World::approved();
    let role = role_context_for(&view_of(&world), Some("Scout".into()));
    assert_eq!(role.goal_id.as_deref(), Some(HIRE));
    assert_eq!(role.home_channel_id.as_deref(), Some(CHANNEL));
    assert_eq!(role.title, "Test Employee");
    assert_eq!(role.manager_name.as_deref(), Some("Scout"));
    assert_eq!(role.ask_before, vec!["anything public".to_string()]);
    assert_eq!(role.on_hire_sources, vec!["business profile".to_string()]);
    assert_eq!(role.plan_horizon_days, 14);
    crate::managed_agents::validate_role_context(&role).expect("a valid role context");
}

#[test]
fn the_gate_hold_needs_both_variables() {
    assert_eq!(gate_hold_from(Some("1"), Some("employee_created")), Some(HireStep::EmployeeCreated));
    assert_eq!(gate_hold_from(None, Some("employee_created")), None);
    assert_eq!(gate_hold_from(Some("1"), None), None);
    assert_eq!(gate_hold_from(Some("1"), Some("hello_posted")), None);
}

#[test]
fn hire_input_is_validated_and_ignores_a_time_zone() {
    let hire = validated_input(&input()).expect("valid");
    assert_eq!(hire.hire_id.to_string(), HIRE);
    let mut bad = input();
    bad.hire_id = "not-a-uuid".into();
    assert!(validated_input(&bad).is_err());
    let mut bad = input();
    bad.home_channel_id = "general".into();
    assert!(validated_input(&bad).is_err());

    let sent: HireCompleteInput = serde_json::from_value(serde_json::json!({
        "relayUrl": RELAY,
        "hireId": HIRE,
        "personaId": "builtin:test-employee",
        "displayName": "Gate Tester",
        "homeChannelId": CHANNEL,
        "timeZone": "Europe/London"
    }))
    .expect("the overview shape still parses");
    let entry = new_entry(&validated_input(&sent).expect("valid"), ZONE.to_string(), 1);
    assert_eq!(entry.time_zone, ZONE, "the host's time zone wins over the caller's");
}

#[test]
fn the_journal_keeps_unfinished_hires_and_prunes_old_finished_ones() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(JOURNAL_FILE);
    assert_eq!(hire_journal::load(&path).expect("missing"), HireJournal::default());

    let now = 1_800_000_000;
    let mut journal = HireJournal::default();
    let unfinished = HireJournalEntry {
        hire_id: Uuid::new_v4(),
        updated_at: now - 90 * 24 * 3_600,
        ..fresh_entry()
    };
    journal.upsert(unfinished.clone());
    for age in 0..205 {
        journal.upsert(HireJournalEntry {
            hire_id: Uuid::new_v4(),
            step: HireStep::Started,
            updated_at: now - age * 3_600,
            ..fresh_entry()
        });
    }
    journal.upsert(HireJournalEntry {
        hire_id: Uuid::new_v4(),
        step: HireStep::Started,
        updated_at: now - 31 * 24 * 3_600,
        ..fresh_entry()
    });
    journal.prune(now);
    assert!(journal.entries.len() <= 200);
    assert!(journal.find(unfinished.hire_id).is_some(), "an unfinished hire is never pruned");
    assert_eq!(journal.unfinished(&unfinished.relay_url).len(), 1);

    hire_journal::save(&path, &journal).expect("save");
    assert_eq!(hire_journal::load(&path).expect("load"), journal);
    std::fs::write(&path, b"not json").expect("write");
    assert!(hire_journal::load(&path).is_err(), "an unreadable journal is never read as empty");
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod foundation_tests;
```

with:

```rust
#[cfg(test)]
mod foundation_tests;
#[cfg(test)]
mod hire_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::hire_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved imports super::hire, super::hire_journal`.

- [ ] **Step 3: The journal**

Create `src/managed_agents/team_runner/hire_journal.rs`:

```rust
//! `hire-journal.json`: one entry per hire this computer is finishing, saved
//! after every step so a restart resumes at the first unfinished step.

use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// File name inside `<app data>/team`.
pub(crate) const JOURNAL_FILE: &str = "hire-journal.json";
const MAX_ENTRIES: usize = 200;
const KEEP_FINISHED_SECS: i64 = 30 * 24 * 60 * 60;

/// The last step a hire finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HireStep {
    /// The entry exists; nothing happened yet.
    Opened,
    /// The employee record exists on this computer.
    EmployeeCreated,
    /// The hire head names the employee.
    EmployeeAttached,
    /// The employee is a member of the home channel.
    EmployeeInChannel,
    /// The owner is a member of the home channel.
    OwnerInChannel,
    /// The employee posted its hello.
    HelloPosted,
    /// The hire head says `hired`.
    Completed,
    /// The employee is started. Finished.
    Started,
}

/// One hire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HireJournalEntry {
    pub(crate) hire_id: Uuid,
    pub(crate) relay_url: String,
    pub(crate) persona_id: String,
    pub(crate) display_name: String,
    pub(crate) home_channel_id: Uuid,
    /// The company time zone, resolved once when the hire opened.
    pub(crate) time_zone: String,
    pub(crate) step: HireStep,
    #[serde(default)]
    pub(crate) employee_pubkey: Option<String>,
    #[serde(default)]
    pub(crate) introduction_event_id: Option<String>,
    /// Unix seconds captured just before `Complete`: the first start's replay floor.
    #[serde(default)]
    pub(crate) replay_floor: Option<u64>,
    pub(crate) started_at: i64,
    pub(crate) updated_at: i64,
    #[serde(default)]
    pub(crate) last_error: Option<String>,
}

impl HireJournalEntry {
    /// Whether the hire finished.
    pub(crate) fn is_finished(&self) -> bool {
        self.step == HireStep::Started
    }
}

/// The whole file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct HireJournal {
    #[serde(default)]
    pub(crate) entries: Vec<HireJournalEntry>,
}

impl HireJournal {
    /// The entry for `hire_id`.
    pub(crate) fn find(&self, hire_id: Uuid) -> Option<&HireJournalEntry> {
        self.entries.iter().find(|entry| entry.hire_id == hire_id)
    }

    /// Insert or replace the entry for its hire.
    pub(crate) fn upsert(&mut self, entry: HireJournalEntry) {
        match self
            .entries
            .iter_mut()
            .find(|existing| existing.hire_id == entry.hire_id)
        {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
    }

    /// Unfinished hires on `relay_url`.
    pub(crate) fn unfinished(&self, relay_url: &str) -> Vec<HireJournalEntry> {
        self.entries
            .iter()
            .filter(|entry| !entry.is_finished() && entry.relay_url == relay_url)
            .cloned()
            .collect()
    }

    /// Drop finished hires older than 30 days, then the oldest finished ones
    /// beyond 200 entries. Unfinished hires are never dropped.
    pub(crate) fn prune(&mut self, now: i64) {
        self.entries
            .retain(|entry| !entry.is_finished() || now - entry.updated_at < KEEP_FINISHED_SECS);
        if self.entries.len() <= MAX_ENTRIES {
            return;
        }
        let mut finished: Vec<(i64, Uuid)> = self
            .entries
            .iter()
            .filter(|entry| entry.is_finished())
            .map(|entry| (entry.updated_at, entry.hire_id))
            .collect();
        finished.sort();
        let excess = self.entries.len() - MAX_ENTRIES;
        let dropped: Vec<Uuid> = finished.into_iter().take(excess).map(|(_, id)| id).collect();
        self.entries.retain(|entry| !dropped.contains(&entry.hire_id));
    }
}

/// Read the journal. Missing means empty; unreadable is an error, so no
/// unfinished hire is ever forgotten.
pub(crate) fn load(path: &Path) -> Result<HireJournal, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("failed to parse {JOURNAL_FILE}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HireJournal::default()),
        Err(error) => Err(format!("failed to read {JOURNAL_FILE}: {error}")),
    }
}

/// Write the journal durably (temporary file, sync, rename).
pub(crate) fn save(path: &Path, journal: &HireJournal) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("failed to serialize {JOURNAL_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)
}
```

- [ ] **Step 4: The step machine**

Create `src/managed_agents/team_runner/hire.rs`:

```rust
//! Finishing a hire as one journaled operation. Every step checks whether it
//! already happened, so a host killed anywhere resumes to exactly one
//! employee, one hello and one Complete. The relay and host side plugs in
//! through [`HireIo`] (`hire_relay.rs`).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::hire_journal::{HireJournalEntry, HireStep};
use super::normalize_relay;
use crate::managed_agents::RoleContext;

/// How long the real-run gate holds a hire after a step.
pub(crate) const GATE_HOLD: std::time::Duration = std::time::Duration::from_secs(20);

/// Plain refusals.
pub(crate) const FINISHED_ELSEWHERE: &str = "This hire was finished on another computer.";
pub(crate) const CHANGED: &str = "This hire changed. Open it again to finish it.";
pub(crate) const NOT_APPROVED: &str = "This hire is not approved yet.";
pub(crate) const DECLINED: &str = "This hire was declined.";
pub(crate) const GONE: &str = "This hire no longer exists.";
pub(crate) const NOT_FOUNDER: &str = "Only the person who approved this hire can finish it.";

/// `team_hire_complete` input (overview shape).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HireCompleteInput {
    /// The company relay.
    pub relay_url: String,
    /// The approved hire.
    pub hire_id: String,
    /// The role's persona.
    pub persona_id: String,
    /// The employee's name.
    pub display_name: String,
    /// The conversation the employee joins.
    pub home_channel_id: String,
    /// Accepted from callers that still send it and ignored: the host sends
    /// the company time zone from the business profile.
    #[serde(default)]
    pub time_zone: Option<String>,
}

/// What `team_hire_complete` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HireCompleteState {
    /// A fresh hire finished.
    Started,
    /// An interrupted hire finished.
    Resumed,
    /// The hire had already finished.
    AlreadyComplete,
}

/// `team_hire_complete` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HireCompleteResult {
    /// The employee's public key (hex).
    pub agent_pubkey: String,
    /// What happened.
    pub state: HireCompleteState,
}

/// Lenient read of a hire proposal: keys this build does not know are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalView {
    pub(crate) hire_id: Uuid,
    pub(crate) role_pack: RolePackView,
    pub(crate) display_name: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) manager_pubkey: Option<String>,
    pub(crate) introduction_channel_id: Uuid,
    pub(crate) runtime_id: String,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    #[serde(default)]
    pub(crate) model_id: Option<String>,
}

/// The role pack fields the host uses.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RolePackView {
    pub(crate) persona_id: String,
    pub(crate) job: String,
    #[serde(default)]
    pub(crate) owns: Option<String>,
    #[serde(default)]
    pub(crate) ask_before: Vec<String>,
    #[serde(default)]
    pub(crate) on_hire: Option<OnHireView>,
}

/// What a new employee studies first.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnHireView {
    #[serde(default)]
    pub(crate) sources: Vec<String>,
    #[serde(default = "default_plan_horizon_days")]
    pub(crate) plan_horizon_days: u8,
}

fn default_plan_horizon_days() -> u8 {
    14
}

/// The relay's hire head, read leniently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HireView {
    pub(crate) head_event_id: String,
    /// `proposed`, `awaiting_founder`, `approved`, `hired` or `denied`.
    pub(crate) status: String,
    pub(crate) founder_pubkey: Option<String>,
    pub(crate) employee_pubkey: Option<String>,
    pub(crate) proposal: ProposalView,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeadContent {
    status: String,
    #[serde(default)]
    founder_pubkey: Option<String>,
    #[serde(default)]
    employee_pubkey: Option<String>,
    proposal: ProposalView,
}

/// Read a hire head's content.
pub(crate) fn hire_view_from(head_event_id: &str, content: &str) -> Result<HireView, String> {
    let head: HeadContent =
        serde_json::from_str(content).map_err(|_| "the hire record is unreadable".to_string())?;
    Ok(HireView {
        head_event_id: head_event_id.to_string(),
        status: head.status,
        founder_pubkey: head.founder_pubkey,
        employee_pubkey: head.employee_pubkey,
        proposal: head.proposal,
    })
}

/// A checked `HireCompleteInput`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedHire {
    pub(crate) relay_url: String,
    pub(crate) hire_id: Uuid,
    pub(crate) persona_id: String,
    pub(crate) display_name: String,
    pub(crate) home_channel_id: Uuid,
}

/// Check the input before anything happens.
pub(crate) fn validated_input(input: &HireCompleteInput) -> Result<ValidatedHire, String> {
    let relay_url = normalize_relay(&input.relay_url)?;
    let hire_id = Uuid::parse_str(input.hire_id.trim())
        .map_err(|_| "hire id must be a UUID".to_string())?;
    let home_channel_id = Uuid::parse_str(input.home_channel_id.trim())
        .map_err(|_| "home channel id must be a UUID".to_string())?;
    let persona_id = input.persona_id.trim().to_string();
    let display_name = input.display_name.trim().to_string();
    if persona_id.is_empty() || persona_id.chars().count() > 120 {
        return Err("persona id must be 1 to 120 characters".to_string());
    }
    if display_name.is_empty() || display_name.chars().count() > 120 {
        return Err("display name must be 1 to 120 characters".to_string());
    }
    Ok(ValidatedHire {
        relay_url,
        hire_id,
        persona_id,
        display_name,
        home_channel_id,
    })
}

/// A fresh journal entry.
pub(crate) fn new_entry(hire: &ValidatedHire, time_zone: String, now: i64) -> HireJournalEntry {
    HireJournalEntry {
        hire_id: hire.hire_id,
        relay_url: hire.relay_url.clone(),
        persona_id: hire.persona_id.clone(),
        display_name: hire.display_name.clone(),
        home_channel_id: hire.home_channel_id,
        time_zone,
        step: HireStep::Opened,
        employee_pubkey: None,
        introduction_event_id: None,
        replay_floor: None,
        started_at: now,
        updated_at: now,
        last_error: None,
    }
}

/// What a call reports when the journal already holds the hire.
pub(crate) fn existing_entry_state(entry: &HireJournalEntry) -> HireCompleteState {
    if entry.is_finished() {
        HireCompleteState::AlreadyComplete
    } else {
        HireCompleteState::Resumed
    }
}

/// The company time zone: the business profile's when the profile has one,
/// this computer's when there is no profile, `UTC` when neither is a valid
/// IANA label.
pub(crate) fn choose_time_zone(profile_zone: Option<&str>, computer_zone: Option<&str>) -> String {
    let valid = |zone: &&str| buzz_core_pkg::company_duties::is_timezone_label(zone);
    match profile_zone.map(str::trim).filter(valid) {
        Some(zone) => zone.to_string(),
        None => computer_zone
            .map(str::trim)
            .filter(valid)
            .unwrap_or("UTC")
            .to_string(),
    }
}

/// The role context a hired employee runs with. Its goal is the hire id,
/// which is how a resumed hire finds the employee it already made.
pub(crate) fn role_context_for(view: &HireView, manager_name: Option<String>) -> RoleContext {
    let proposal = &view.proposal;
    RoleContext {
        title: proposal.title.clone(),
        job: proposal.role_pack.job.clone(),
        owns: proposal.role_pack.owns.clone(),
        ask_before: proposal.role_pack.ask_before.clone(),
        manager_name,
        home_channel_id: Some(proposal.introduction_channel_id.to_string()),
        goal_id: Some(proposal.hire_id.to_string()),
        on_hire_sources: proposal
            .role_pack
            .on_hire
            .as_ref()
            .map(|on_hire| on_hire.sources.clone())
            .unwrap_or_default(),
        plan_horizon_days: proposal
            .role_pack
            .on_hire
            .as_ref()
            .map_or(14, |on_hire| on_hire.plan_horizon_days),
    }
}

/// The new employee's hello, posted as the employee.
pub(crate) fn hello_text(display_name: &str, title: &str) -> String {
    format!(
        "Hi everyone, I'm {display_name}, the new {title}. I'm reading up on the business and will share my plan soon."
    )
}

/// The marker that makes the hello idempotent.
pub(crate) fn hello_marker(hire_id: Uuid) -> String {
    format!("company-hire:{hire_id}:introduction")
}

/// Real-run gate seam: hold after `employee_created` only when
/// `COLONY_TEAM_GATE=1` and `COLONY_TEAM_GATE_HOLD_AFTER=employee_created`.
pub(crate) fn gate_hold_from(gate: Option<&str>, hold_after: Option<&str>) -> Option<HireStep> {
    match (gate, hold_after) {
        (Some("1"), Some("employee_created")) => Some(HireStep::EmployeeCreated),
        _ => None,
    }
}

/// The relay and host operations a hire needs. Each one is safe to repeat.
pub(crate) trait HireIo {
    /// The signed-in person, who signs every hire action.
    fn owner(&self) -> &str;
    /// Unix seconds now.
    fn now(&self) -> i64;
    /// The relay's hire head; `None` when the relay has no such hire.
    async fn hire(&mut self, hire_id: Uuid) -> Result<Option<HireView>, String>;
    /// The local employee made for `hire_id`, or the local record `attached` names.
    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String>;
    /// The manager's name, when the relay knows it.
    async fn manager_name(&mut self, manager_pubkey: &str) -> Option<String>;
    /// Create the employee (start with Colony on) with `role` in the same save.
    async fn create_employee(&mut self, view: &HireView, role: RoleContext) -> Result<String, String>;
    /// Make sure the employee's profile is on the relay.
    async fn ensure_profile(&mut self, employee: &str) -> Result<(), String>;
    /// Publish `AttachEmployee` on the exact current head.
    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String>;
    /// Add the employee to the home channel unless it is a member.
    async fn add_employee_to_channel(&mut self, channel: Uuid, employee: &str) -> Result<(), String>;
    /// Add the owner to the home channel unless they are a member.
    async fn ensure_owner_in_channel(&mut self, channel: Uuid) -> Result<(), String>;
    /// Post `text` as the employee; a message already posted under `marker` is returned instead.
    async fn post_hello(
        &mut self,
        employee: &str,
        channel: Uuid,
        text: &str,
        marker: &str,
    ) -> Result<String, String>;
    /// Publish `Complete` with the company time zone.
    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String>;
    /// Start the employee with the replay floor (a running pair is left alone).
    async fn start_employee(&mut self, employee: &str, replay_floor: Option<u64>) -> Result<(), String>;
    /// Write the journal entry durably.
    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String>;
    /// Real-run gate seam (Task 4.15).
    async fn hold_after(&mut self, step: HireStep);
}

fn employee_of(entry: &HireJournalEntry) -> Result<&str, String> {
    entry
        .employee_pubkey
        .as_deref()
        .ok_or_else(|| "the new employee is missing from the hire journal".to_string())
}

fn step_to<I: HireIo>(io: &mut I, entry: &mut HireJournalEntry, step: HireStep) -> Result<(), String> {
    entry.step = step;
    entry.updated_at = io.now();
    entry.last_error = None;
    io.save(entry)
}

async fn current_hire<I: HireIo>(io: &mut I, entry: &HireJournalEntry) -> Result<HireView, String> {
    let view = io
        .hire(entry.hire_id)
        .await?
        .ok_or_else(|| GONE.to_string())?;
    match view.status.as_str() {
        "approved" | "hired" => Ok(view),
        "denied" => Err(DECLINED.to_string()),
        _ => Err(NOT_APPROVED.to_string()),
    }
}

fn check_unchanged(entry: &HireJournalEntry, view: &HireView) -> Result<(), String> {
    let proposal = &view.proposal;
    if proposal.role_pack.persona_id != entry.persona_id
        || proposal.display_name != entry.display_name
        || proposal.introduction_channel_id != entry.home_channel_id
    {
        return Err(CHANGED.to_string());
    }
    Ok(())
}

/// Finish one hire from wherever its journal entry stopped. Returns the
/// employee's public key.
pub(crate) async fn run_hire<I: HireIo>(io: &mut I, mut entry: HireJournalEntry) -> Result<String, String> {
    while entry.step != HireStep::Started {
        let before = entry.step;
        if let Err(error) = advance(io, &mut entry).await {
            entry.last_error = Some(error.clone());
            entry.updated_at = io.now();
            if let Err(save_error) = io.save(&entry) {
                eprintln!("team runner: could not note why a hire stopped: {save_error}");
            }
            return Err(error);
        }
        if entry.step == before {
            return Err("the hire made no progress".to_string());
        }
    }
    employee_of(&entry).map(str::to_string)
}

async fn advance<I: HireIo>(io: &mut I, entry: &mut HireJournalEntry) -> Result<(), String> {
    match entry.step {
        HireStep::Opened => {
            let view = current_hire(io, entry).await?;
            check_unchanged(entry, &view)?;
            let found = io
                .find_employee(entry.hire_id, view.employee_pubkey.as_deref())
                .await?;
            let employee = match found {
                Some(pubkey) => pubkey,
                None if view.status == "hired" || view.employee_pubkey.is_some() => {
                    return Err(FINISHED_ELSEWHERE.to_string())
                }
                None => {
                    let founder_is_owner = view
                        .founder_pubkey
                        .as_deref()
                        .is_some_and(|founder| founder.eq_ignore_ascii_case(io.owner()));
                    if !founder_is_owner {
                        return Err(NOT_FOUNDER.to_string());
                    }
                    let manager = match view.proposal.manager_pubkey.as_deref() {
                        Some(pubkey) => io.manager_name(pubkey).await,
                        None => None,
                    };
                    io.create_employee(&view, role_context_for(&view, manager))
                        .await?
                }
            };
            entry.employee_pubkey = Some(employee);
            step_to(io, entry, HireStep::EmployeeCreated)?;
            io.hold_after(HireStep::EmployeeCreated).await;
        }
        HireStep::EmployeeCreated => {
            let employee = employee_of(entry)?.to_string();
            io.ensure_profile(&employee).await?;
            let view = current_hire(io, entry).await?;
            match view.employee_pubkey.as_deref() {
                None => io.attach_employee(&view, &employee).await?,
                Some(attached) if attached.eq_ignore_ascii_case(&employee) => {}
                Some(_) => return Err(FINISHED_ELSEWHERE.to_string()),
            }
            step_to(io, entry, HireStep::EmployeeAttached)?;
        }
        HireStep::EmployeeAttached => {
            let employee = employee_of(entry)?.to_string();
            io.add_employee_to_channel(entry.home_channel_id, &employee)
                .await?;
            step_to(io, entry, HireStep::EmployeeInChannel)?;
        }
        HireStep::EmployeeInChannel => {
            io.ensure_owner_in_channel(entry.home_channel_id).await?;
            step_to(io, entry, HireStep::OwnerInChannel)?;
        }
        HireStep::OwnerInChannel => {
            let employee = employee_of(entry)?.to_string();
            let view = current_hire(io, entry).await?;
            let text = hello_text(&entry.display_name, &view.proposal.title);
            let marker = hello_marker(entry.hire_id);
            let event_id = io
                .post_hello(&employee, entry.home_channel_id, &text, &marker)
                .await?;
            entry.introduction_event_id = Some(event_id);
            step_to(io, entry, HireStep::HelloPosted)?;
        }
        HireStep::HelloPosted => {
            let employee = employee_of(entry)?.to_string();
            let introduction = entry
                .introduction_event_id
                .clone()
                .ok_or_else(|| "the hello is missing from the hire journal".to_string())?;
            let view = current_hire(io, entry).await?;
            if view.status == "hired" {
                let ours = view
                    .employee_pubkey
                    .as_deref()
                    .is_some_and(|attached| attached.eq_ignore_ascii_case(&employee));
                if !ours {
                    return Err(FINISHED_ELSEWHERE.to_string());
                }
            } else {
                if entry.replay_floor.is_none() {
                    // Taken before Complete, so the kickoff the relay posts
                    // with Complete is newer than the floor and is answered.
                    entry.replay_floor = Some(u64::try_from(io.now()).unwrap_or(0));
                    entry.updated_at = io.now();
                    io.save(entry)?;
                }
                let time_zone = entry.time_zone.clone();
                io.complete(&view, &employee, &introduction, &time_zone)
                    .await?;
            }
            step_to(io, entry, HireStep::Completed)?;
        }
        HireStep::Completed => {
            let employee = employee_of(entry)?.to_string();
            io.start_employee(&employee, entry.replay_floor).await?;
            step_to(io, entry, HireStep::Started)?;
        }
        HireStep::Started => {}
    }
    Ok(())
}
```

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod computer;
mod launch;
```

with:

```rust
mod computer;
mod hire;
mod hire_journal;
mod launch;
```

Replace:

```rust
pub(crate) use companies::{CompaniesFile, StoredCompany, NOT_SET_UP};
```

with:

```rust
pub(crate) use companies::{CompaniesFile, StoredCompany, NOT_SET_UP};
pub use hire::{HireCompleteInput, HireCompleteResult, HireCompleteState};
```

Replace:

```rust
    /// The supervisor and heartbeat loops start once per host.
    loops_started: AtomicBool,
}
```

with:

```rust
    /// The supervisor and heartbeat loops start once per host.
    loops_started: AtomicBool,
    /// One hire at a time, so a resumed hire and a new call never race.
    hire_lock: tokio::sync::Mutex<()>,
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::hire_tests)`
Expected: PASS (11 tests, 0 failed). `interrupted_hire_resumes_to_exactly_one_employee_hello_and_complete` kills the first attempt at every boundary of a hire (more than 30 of them) and resumes each one.

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner
git commit -s -m "feat(desktop): finish a hire as one journaled operation that resumes exactly once"
```

---

### Task 4.11: The relay side of a hire, and resuming hires at start

**Files:**
- Create: `src/managed_agents/team_runner/hire_relay.rs`
- Create: `src/managed_agents/team_runner/hire_relay_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list)
- Modify: `src/managed_agents/team_runner/launch.rs` (`activate` resumes unfinished hires)
- Modify: `desktop/src-tauri/Cargo.toml:138` (`iana-time-zone`, already in `Cargo.lock` through `chrono`)
- Test: `src/managed_agents/team_runner/hire_relay_tests.rs`

**Interfaces:**
- Consumes: Task 4.10 `HireIo`, `run_hire`, journal; part A `buzz_core_pkg::company_profile::BUSINESS_PROFILE_D_TAG` and `KIND_BUSINESS_PROFILE_HEAD` (head content carries `timeZone`); part B `buzz_core_pkg::company_records::{HireAction (with time_zone), HireActionKind, hire_d_tag, COMPANY_RECORD_SCHEMA_VERSION}`, `KIND_HIRE_HEAD` (30650), `KIND_HIRE_ACTION` (47039, one `d` tag `company:hire:<id>`, no `h` tag); `crate::commands::{create_managed_agent, send_managed_agent_channel_message}`; `crate::events::build_add_member` (kind 9000); `crate::relay::{query_relay_at, submit_event_at_with_keys, sync_managed_agent_profile}`; `crate::managed_agents::{known_acp_runtime_exact, load_personas, load_managed_agents, start_managed_agent_runtime_pair_with_floor}`.
- Produces: `hire_relay::{RelayHireIo, resume_unfinished, snapshot_has_member, time_zone_from_profile, employee_for}`.
  - `RelayHireIo::new(app, relay_url)` snapshots the signed-in keys and the relay's own key (every head it reads must be signed by the relay); `company_time_zone()` reads the profile head's `timeZone` and falls back to this computer's IANA zone only when there is no profile.
  - The employee is created through `create_managed_agent` with start with Colony on and its role context in the same save; the runtime command comes from the proposal's runtime id, `harnessOverride` follows the old interface's rule.
  - Membership checks read the relay-signed snapshot (kind 39002) before any `kind 9000`, so re-running never changes the owner's role.
  - `Complete` that already landed is recognised from the head.
  - `resume_unfinished(app, relay)` runs every unfinished hire for the company in the background after the team starts.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/hire_relay_tests.rs`:

```rust
//! Reading the relay's answers during a hire.

use nostr::{EventBuilder, Keys, Kind, Tag};
use uuid::Uuid;

use super::hire_relay::{employee_for, snapshot_has_member, time_zone_from_profile};
use crate::managed_agents::{ManagedAgentRecord, RoleContext};

const CHANNEL: &str = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const HIRE: &str = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const EMPLOYEE: &str = "abababababababababababababababababababababababababababababababab";

fn record(pubkey: &str, goal: Option<&str>) -> ManagedAgentRecord {
    let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
        "pubkey": pubkey,
        "name": "gate-tester",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": true,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses");
    record.role_context = goal.map(|goal| RoleContext {
        title: "Test Employee".into(),
        job: "Post one short note a day".into(),
        owns: None,
        ask_before: Vec::new(),
        manager_name: None,
        home_channel_id: Some(CHANNEL.into()),
        goal_id: Some(goal.into()),
        on_hire_sources: Vec::new(),
        plan_horizon_days: 14,
    });
    record
}

#[test]
fn membership_snapshots_list_members_by_their_p_tags() {
    let relay = Keys::generate();
    let snapshot = EventBuilder::new(Kind::Custom(39002), "")
        .tags([
            Tag::parse(["d", CHANNEL]).expect("d"),
            Tag::parse(["p", OWNER, "", "owner"]).expect("p"),
            Tag::parse(["p", EMPLOYEE, "", "bot"]).expect("p"),
        ])
        .sign_with_keys(&relay)
        .expect("signed");
    assert!(snapshot_has_member(&snapshot, OWNER));
    assert!(snapshot_has_member(&snapshot, &EMPLOYEE.to_uppercase()));
    assert!(!snapshot_has_member(&snapshot, &"cd".repeat(32)));
}

#[test]
fn the_company_time_zone_is_read_from_the_profile_head() {
    assert_eq!(
        time_zone_from_profile(
            r#"{"schemaVersion":1,"name":"Lerato Designs","timeZone":"Africa/Johannesburg","keyFromANewerRelay":1}"#
        )
        .as_deref(),
        Some("Africa/Johannesburg")
    );
    assert_eq!(time_zone_from_profile(r#"{"schemaVersion":1,"name":"Lerato Designs"}"#), None);
    assert_eq!(time_zone_from_profile("not json"), None);
}

#[test]
fn a_resumed_hire_finds_the_employee_it_already_made() {
    let hire = Uuid::parse_str(HIRE).expect("uuid");
    let made = record(EMPLOYEE, Some(HIRE));
    let other = record(&"cd".repeat(32), Some("7a1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10"));
    assert_eq!(
        employee_for(&[other.clone(), made.clone()], hire, None).as_deref(),
        Some(EMPLOYEE)
    );
    assert_eq!(
        employee_for(&[record(EMPLOYEE, None)], hire, Some(&EMPLOYEE.to_uppercase())).as_deref(),
        Some(EMPLOYEE),
        "the head's attached employee counts when it is a local record"
    );
    assert_eq!(employee_for(&[other], hire, None), None);
}
```

Register it in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod hire_tests;
```

with:

```rust
#[cfg(test)]
mod hire_relay_tests;
#[cfg(test)]
mod hire_tests;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::hire_relay_tests)`
Expected: FAIL to compile with `error[E0432]: unresolved import super::hire_relay`.

- [ ] **Step 3: Implement**

In `desktop/src-tauri/Cargo.toml`, replace (line 138):

```toml
chrono = { version = "0.4", features = ["serde"] }
```

with:

```toml
chrono = { version = "0.4", features = ["serde"] }
iana-time-zone = "0.1"
```

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod hire;
mod hire_journal;
```

with:

```rust
mod hire;
mod hire_journal;
mod hire_relay;
```

Create `src/managed_agents/team_runner/hire_relay.rs`:

```rust
//! The real [`HireIo`]: the company relay and this computer.

use std::path::PathBuf;

use buzz_core_pkg::company_profile::BUSINESS_PROFILE_D_TAG;
use buzz_core_pkg::company_records::{
    hire_d_tag, HireAction, HireActionKind, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core_pkg::kind::{KIND_BUSINESS_PROFILE_HEAD, KIND_HIRE_ACTION, KIND_HIRE_HEAD};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::hire::{
    choose_time_zone, gate_hold_from, hire_view_from, run_hire, HireIo, HireView, GATE_HOLD,
};
use super::hire_journal::{self, HireJournal, HireJournalEntry, HireStep, JOURNAL_FILE};
use super::{normalize_relay, now_unix, runner, team_dir, with_book};
use crate::app_state::AppState;
use crate::managed_agents::{CreateManagedAgentRequest, ManagedAgentRecord, RoleContext};

const NO_RUNTIME: &str = "This employee's AI is not available on this computer.";

/// Whether a relay-signed channel membership snapshot (kind 39002) lists `pubkey`.
pub(crate) fn snapshot_has_member(event: &nostr::Event, pubkey: &str) -> bool {
    event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.first().map(String::as_str) == Some("p")
            && parts
                .get(1)
                .is_some_and(|member| member.eq_ignore_ascii_case(pubkey))
    })
}

/// The business profile head's `timeZone`, when it has one.
pub(crate) fn time_zone_from_profile(content: &str) -> Option<String> {
    serde_json::from_str::<Value>(content)
        .ok()?
        .get("timeZone")?
        .as_str()
        .map(str::to_string)
}

/// The local employee made for `hire_id` (its role context goal), or the
/// local record the hire head names.
pub(crate) fn employee_for(
    records: &[ManagedAgentRecord],
    hire_id: Uuid,
    attached: Option<&str>,
) -> Option<String> {
    let goal = hire_id.to_string();
    records
        .iter()
        .find(|record| {
            record
                .role_context
                .as_ref()
                .and_then(|role| role.goal_id.as_deref())
                == Some(goal.as_str())
        })
        .or_else(|| {
            attached.and_then(|pubkey| {
                records
                    .iter()
                    .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey))
            })
        })
        .map(|record| record.pubkey.to_ascii_lowercase())
}

/// Hire operations against one company relay, signed by the signed-in person.
pub(crate) struct RelayHireIo {
    app: AppHandle,
    owner: nostr::Keys,
    owner_hex: String,
    relay_url: String,
    api_base: String,
    relay_self: String,
    journal_path: PathBuf,
    gate_hold: Option<HireStep>,
}

impl RelayHireIo {
    /// Bind to `relay_url` with the signed-in keys and the relay's own key.
    pub(crate) async fn new(app: &AppHandle, relay_url: &str) -> Result<Self, String> {
        let relay_url = normalize_relay(relay_url)?;
        let owner = app.state::<AppState>().signing_keys()?;
        let relay_self = super::claim_io::relay_self(app, &relay_url).await?;
        Ok(Self {
            app: app.clone(),
            owner_hex: owner.public_key().to_hex(),
            owner,
            api_base: crate::relay::relay_http_base_url(&relay_url),
            relay_url,
            relay_self,
            journal_path: team_dir(app)?.join(JOURNAL_FILE),
            gate_hold: gate_hold_from(
                std::env::var("COLONY_TEAM_GATE").ok().as_deref(),
                std::env::var("COLONY_TEAM_GATE_HOLD_AFTER").ok().as_deref(),
            ),
        })
    }

    /// The hire journal on disk.
    pub(crate) fn journal(&self) -> Result<HireJournal, String> {
        hire_journal::load(&self.journal_path)
    }

    /// The company time zone for a new hire: the business profile's
    /// `timeZone`, or this computer's zone only when there is no profile.
    pub(crate) async fn company_time_zone(&self) -> Result<String, String> {
        let heads = self
            .query(json!({
                "kinds": [KIND_BUSINESS_PROFILE_HEAD],
                "authors": [self.relay_self],
                "#d": [BUSINESS_PROFILE_D_TAG],
                "limit": 1
            }))
            .await?;
        let profile_zone = self
            .newest_relay_signed(heads)
            .and_then(|head| time_zone_from_profile(&head.content));
        let computer_zone = iana_time_zone::get_timezone().ok();
        Ok(choose_time_zone(
            profile_zone.as_deref(),
            computer_zone.as_deref(),
        ))
    }

    async fn query(&self, filter: Value) -> Result<Vec<nostr::Event>, String> {
        let state = self.app.state::<AppState>();
        crate::relay::query_relay_at(&state, &self.api_base, &[filter]).await
    }

    fn newest_relay_signed(&self, events: Vec<nostr::Event>) -> Option<nostr::Event> {
        events
            .into_iter()
            .filter(|event| {
                event.pubkey.to_hex().eq_ignore_ascii_case(&self.relay_self) && event.verify().is_ok()
            })
            .max_by_key(|event| event.created_at)
    }

    fn records(&self) -> Result<Vec<ManagedAgentRecord>, String> {
        let state = self.app.state::<AppState>();
        let _store = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        crate::managed_agents::load_managed_agents(&self.app)
    }

    async fn publish_hire(&self, action: &HireAction) -> Result<(), String> {
        let content = serde_json::to_string(action)
            .map_err(|error| format!("the hire step could not be prepared: {error}"))?;
        let coordinate = hire_d_tag(action.hire_id);
        let builder = nostr::EventBuilder::new(nostr::Kind::Custom(KIND_HIRE_ACTION as u16), content)
            .tag(nostr::Tag::parse(["d", coordinate.as_str()]).map_err(|error| error.to_string())?);
        let state = self.app.state::<AppState>();
        crate::relay::submit_event_at_with_keys(builder, &state, &self.api_base, &self.owner)
            .await
            .map(|_| ())
    }

    async fn is_member(&self, channel: Uuid, pubkey: &str) -> Result<bool, String> {
        let snapshots = self
            .query(json!({
                "kinds": [39002],
                "authors": [self.relay_self],
                "#d": [channel.to_string()],
                "limit": 1
            }))
            .await?;
        Ok(self
            .newest_relay_signed(snapshots)
            .is_some_and(|snapshot| snapshot_has_member(&snapshot, pubkey)))
    }

    async fn add_member(&self, channel: Uuid, pubkey: &str, role: Option<&str>) -> Result<(), String> {
        let builder = crate::events::build_add_member(channel, pubkey, role)?;
        let state = self.app.state::<AppState>();
        crate::relay::submit_event_at_with_keys(builder, &state, &self.api_base, &self.owner)
            .await
            .map(|_| ())
    }

    fn hire_action(view: &HireView, action: HireActionKind) -> HireAction {
        HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: view.proposal.hire_id,
            action,
            expected_head_event_id: Some(view.head_event_id.clone()),
            proposal: None,
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
            time_zone: None,
        }
    }
}

impl HireIo for RelayHireIo {
    fn owner(&self) -> &str {
        &self.owner_hex
    }

    fn now(&self) -> i64 {
        now_unix()
    }

    async fn hire(&mut self, hire_id: Uuid) -> Result<Option<HireView>, String> {
        let heads = self
            .query(json!({
                "kinds": [KIND_HIRE_HEAD],
                "authors": [self.relay_self],
                "#d": [hire_d_tag(hire_id)],
                "limit": 1
            }))
            .await?;
        self.newest_relay_signed(heads)
            .map(|head| hire_view_from(&head.id.to_hex(), &head.content))
            .transpose()
    }

    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String> {
        Ok(employee_for(&self.records()?, hire_id, attached))
    }

    async fn manager_name(&mut self, manager_pubkey: &str) -> Option<String> {
        let profiles = self
            .query(json!({ "kinds": [0], "authors": [manager_pubkey], "limit": 1 }))
            .await
            .ok()?;
        let newest = profiles.into_iter().max_by_key(|event| event.created_at)?;
        let profile: Value = serde_json::from_str(&newest.content).ok()?;
        ["display_name", "name"].into_iter().find_map(|key| {
            profile
                .get(key)?
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
    }

    async fn create_employee(&mut self, view: &HireView, role: RoleContext) -> Result<String, String> {
        let proposal = &view.proposal;
        let runtime = crate::managed_agents::known_acp_runtime_exact(&proposal.runtime_id)
            .ok_or_else(|| NO_RUNTIME.to_string())?;
        let command = runtime
            .commands
            .first()
            .copied()
            .ok_or_else(|| NO_RUNTIME.to_string())?;
        let personas = crate::managed_agents::load_personas(&self.app)?;
        let persona = personas
            .iter()
            .find(|persona| persona.id == proposal.role_pack.persona_id)
            .ok_or_else(|| "This role is not available on this computer.".to_string())?;
        // Same harness rule as the old hire screen: pin the runtime unless the
        // persona names a different one.
        let harness_override = persona
            .runtime
            .as_deref()
            .map_or(true, |persona_runtime| persona_runtime == runtime.id);
        let request: CreateManagedAgentRequest = serde_json::from_value(json!({
            "name": proposal.display_name,
            "personaId": persona.id,
            "relayUrl": null,
            "acpCommand": "buzz-acp",
            "agentCommand": command,
            "harnessOverride": harness_override,
            "agentArgs": [],
            "mcpCommand": runtime.mcp_command.unwrap_or(""),
            "turnTimeoutSeconds": null,
            "idleTimeoutSeconds": null,
            "maxTurnDurationSeconds": null,
            "parallelism": null,
            "systemPrompt": null,
            "avatarUrl": null,
            "model": proposal.model_id,
            "provider": proposal.provider_id,
            "spawnAfterCreate": false,
            "startOnAppLaunch": true,
            "backend": { "type": "local" },
            "roleContext": role
        }))
        .map_err(|error| format!("the new employee could not be prepared: {error}"))?;
        let state = self.app.state::<AppState>();
        let created = crate::commands::create_managed_agent(request, self.app.clone(), state).await?;
        Ok(created.agent.pubkey.to_ascii_lowercase())
    }

    async fn ensure_profile(&mut self, employee: &str) -> Result<(), String> {
        let published = self
            .query(json!({ "kinds": [0], "authors": [employee], "limit": 1 }))
            .await?;
        if !published.is_empty() {
            return Ok(());
        }
        let record = self
            .records()?
            .into_iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(employee))
            .ok_or_else(|| "The new employee is missing on this computer.".to_string())?;
        let keys = nostr::Keys::parse(record.private_key_nsec.trim())
            .map_err(|_| "The new employee's identity could not be read.".to_string())?;
        let name = super::status::display_name(&record);
        let state = self.app.state::<AppState>();
        crate::relay::sync_managed_agent_profile(
            &state,
            &self.relay_url,
            &keys,
            &name,
            record.avatar_url.as_deref(),
            None,
            record.auth_tag.as_deref(),
        )
        .await
    }

    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String> {
        let mut action = Self::hire_action(view, HireActionKind::AttachEmployee);
        action.employee_pubkey = Some(employee.to_string());
        self.publish_hire(&action).await
    }

    async fn add_employee_to_channel(&mut self, channel: Uuid, employee: &str) -> Result<(), String> {
        if self.is_member(channel, employee).await? {
            return Ok(());
        }
        self.add_member(channel, employee, Some("bot")).await
    }

    async fn ensure_owner_in_channel(&mut self, channel: Uuid) -> Result<(), String> {
        let owner = self.owner_hex.clone();
        if self.is_member(channel, &owner).await? {
            return Ok(());
        }
        self.add_member(channel, &owner, None).await
    }

    async fn post_hello(
        &mut self,
        employee: &str,
        channel: Uuid,
        text: &str,
        marker: &str,
    ) -> Result<String, String> {
        let state = self.app.state::<AppState>();
        let sent = crate::commands::send_managed_agent_channel_message(
            employee.to_string(),
            channel.to_string(),
            text.to_string(),
            Some(marker.to_string()),
            Some("agent".to_string()),
            None,
            None,
            None,
            self.app.clone(),
            state,
        )
        .await?;
        Ok(sent.event_id)
    }

    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String> {
        let mut action = Self::hire_action(view, HireActionKind::Complete);
        action.employee_pubkey = Some(employee.to_string());
        action.introduction_event_id = Some(introduction_event_id.to_string());
        action.time_zone = Some(time_zone.to_string());
        let Err(error) = self.publish_hire(&action).await else {
            return Ok(());
        };
        // A Complete that already landed: the relay refuses a second one, and
        // the head says `hired` with this employee.
        match self.hire(view.proposal.hire_id).await? {
            Some(head)
                if head.status == "hired"
                    && head
                        .employee_pubkey
                        .as_deref()
                        .is_some_and(|attached| attached.eq_ignore_ascii_case(employee)) =>
            {
                Ok(())
            }
            _ => Err(error),
        }
    }

    async fn start_employee(&mut self, employee: &str, replay_floor: Option<u64>) -> Result<(), String> {
        let relay = self.relay_url.clone();
        with_book(&self.app, |book| book.expect_running(employee, &relay))?;
        let (app, pubkey) = (self.app.clone(), employee.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::start_managed_agent_runtime_pair_with_floor(
                pubkey,
                relay,
                replay_floor,
                app,
            )
        })
        .await
        .map_err(|error| error.to_string())?
        .map(|_| ())
    }

    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String> {
        let mut journal = hire_journal::load(&self.journal_path)?;
        journal.upsert(entry.clone());
        journal.prune(now_unix());
        hire_journal::save(&self.journal_path, &journal)
    }

    async fn hold_after(&mut self, step: HireStep) {
        if self.gate_hold == Some(step) {
            eprintln!("colony-team-gate: holding the hire after {step:?}");
            tokio::time::sleep(GATE_HOLD).await;
        }
    }
}

/// Finish every unfinished hire for `relay_url` in the background, one at a
/// time. A hire that still cannot finish keeps its journal entry and its last
/// error, and resumes at the next start or the next `team_hire_complete`.
pub(crate) fn resume_unfinished(app: &AppHandle, relay_url: &str) {
    let (app, relay_url) = (app.clone(), relay_url.to_string());
    tauri::async_runtime::spawn(async move {
        let Ok(state) = runner(&app) else {
            return;
        };
        let _one_hire_at_a_time = state.hire_lock.lock().await;
        let mut io = match RelayHireIo::new(&app, &relay_url).await {
            Ok(io) => io,
            Err(error) => {
                eprintln!("team runner: unfinished hires wait for the next start: {error}");
                return;
            }
        };
        let entries = match io.journal() {
            Ok(journal) => journal.unfinished(&io.relay_url),
            Err(error) => {
                eprintln!("team runner: the hire journal could not be read: {error}");
                return;
            }
        };
        for entry in entries {
            if let Err(error) = run_hire(&mut io, entry).await {
                eprintln!("team runner: a hire could not finish yet: {error}");
            }
        }
    });
}
```

In `src/managed_agents/team_runner/launch.rs` (`activate`), replace:

```rust
        ActivationPlan::StartTeam => start_team(app, &company).await?,
```

with:

```rust
        ActivationPlan::StartTeam => {
            start_team(app, &company).await?;
            // Hires a killed host left unfinished finish now, exactly once.
            super::hire_relay::resume_unfinished(app, &company.relay_url);
        }
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (3 `hire_relay_tests` and every earlier team runner test, 0 failed). The run compiles `RelayHireIo` against part B's `HireAction` (including `time_zone`) and the real command signatures.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner
git commit -s -m "feat(desktop): finish hires on the company relay and resume them at start"
```

---

### Task 4.12: Team commands for the old shell and the new app

**Files:**
- Create: `src/managed_agents/team_runner/commands.rs`
- Create: `src/managed_agents/team_runner/commands_tests.rs`
- Modify: `src/managed_agents/team_runner.rs` (module list)
- Modify: `src/lib.rs` (`generate_handler!`, after `google_desktop_sign_in,`)
- Modify: `desktop/electron/native-host.mjs:12-19` (`LONG_COMMANDS`), `desktop/electron/native-host.test.mjs` (append)
- Test: `src/managed_agents/team_runner/commands_tests.rs`, `desktop/electron/native-host.test.mjs`

**Interfaces:**
- Consumes: everything above; part I's seam `credits_pause::resume_if_funded`.
- Produces the overview's host commands, registered once in `generate_handler!`, which serves the old Electron shell and the new app alike (both reach the host through the same `@colony-native:` invoke protocol, which has no command allow list):
  - `team_set_companies(companies: Vec<TeamCompany>) -> Result<(), String>`: for each removed company this computer runs, stops its team and releases the record first; then saves the list; then activates.
  - `team_claim_status(relay_url) -> Result<TeamComputerStatus, String>` (reads the record fresh).
  - `team_claim(relay_url, force) -> Result<TeamComputerStatus, String>` (`force` moves the team here; when this computer holds it afterwards, the team starts).
  - `team_hire_complete(input: HireCompleteInput) -> Result<HireCompleteResult, String>` (this computer must run the team and the team must not be paused; one hire at a time; the entry is saved before the first side effect).
  - `team_restart_employee(agent_pubkey)`, `team_restart_all(relay_url)` (clear crash loops; a person's restart).
  - `team_pause(relay_url)` and `team_resume(relay_url)` with reason `person`, only on the team computer. `team_resume` asks `credits_pause::resume_if_funded` first (`Ok(true)`: done; `Err`: returned; `Ok(false)`: resume as a person) and returns plain words when another reason still holds the team.
  - `team_status(relay_url) -> Result<Vec<EmployeeRuntimeStatus>, String>` (also emits any state change it notices).
  - Old shell deadlines: `team_hire_complete` 5 minutes, `team_restart_all` 3 minutes (the same values part E gives the new app).

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/team_runner/commands_tests.rs`:

```rust
//! The host registers every team command under the overview's names.

const TEAM_COMMANDS: [&str; 9] = [
    "team_set_companies",
    "team_claim_status",
    "team_claim",
    "team_hire_complete",
    "team_restart_employee",
    "team_restart_all",
    "team_pause",
    "team_resume",
    "team_status",
];

#[test]
fn every_team_command_is_registered_with_the_host() {
    let lib = include_str!("../../lib.rs");
    let handler = lib
        .split("tauri::generate_handler![")
        .nth(1)
        .expect("the invoke handler list");
    for name in TEAM_COMMANDS {
        assert!(
            handler.contains(&format!("managed_agents::team_runner::commands::{name},")),
            "{name} must be registered"
        );
    }
}

#[test]
fn every_team_command_exists_with_its_contract_name() {
    let commands = include_str!("commands.rs");
    for name in TEAM_COMMANDS {
        assert!(
            commands.contains(&format!("pub async fn {name}(")),
            "{name} must be a command"
        );
    }
}
```

Append to `desktop/electron/native-host.test.mjs`:

```js

test("team commands that wait on employees get longer deadlines", () => {
  assert.equal(
    nativeRequestTimeout("invoke", "team_hire_complete", 60_000),
    300_000,
  );
  assert.equal(
    nativeRequestTimeout("invoke", "team_restart_all", 60_000),
    180_000,
  );
  assert.equal(nativeRequestTimeout("invoke", "team_status", 60_000), 60_000);
  assert.equal(
    nativeRequestTimeout("listen", "team_hire_complete", 60_000),
    60_000,
  );
});
```

Register the Rust test in `src/managed_agents/team_runner.rs`. Replace:

```rust
#[cfg(test)]
mod claim_io_tests;
```

with:

```rust
#[cfg(test)]
mod claim_io_tests;
#[cfg(test)]
mod commands_tests;
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner::commands_tests)`
Expected: FAIL to compile with `couldn't read src/managed_agents/team_runner/commands.rs`.

Run: `cd desktop && node --test electron/native-host.test.mjs`
Expected: FAIL in `team commands that wait on employees get longer deadlines` with `Expected values to be strictly equal: 60000 !== 300000`.

- [ ] **Step 3: Implement the commands**

In `src/managed_agents/team_runner.rs`, replace:

```rust
mod claim;
mod claim_io;
```

with:

```rust
mod claim;
mod claim_io;
pub(crate) mod commands;
```

Create `src/managed_agents/team_runner/commands.rs`:

```rust
//! The team runner's Tauri commands. One registration serves the old app
//! shell and the new app: both invoke the host by command name.

use tauri::AppHandle;

use super::claim::status_from;
use super::hire::{
    existing_entry_state, new_entry, run_hire, validated_input, HireCompleteInput,
    HireCompleteResult, HireCompleteState, HireIo,
};
use super::hire_relay::RelayHireIo;
use super::launch::{
    activate, activate_with_retry, close_company, ensure_runs_here, start_loops, start_team,
    still_paused_message, stop_team, team_company, team_employee_pubkeys,
};
use super::{
    claim_io, claim_view, ensure_computer, forget_claim, identity, now_unix, runner, runs_here,
    saved_companies, update_companies, with_book, EmployeeRuntimeStatus, PauseReason,
    TeamCompany, TeamComputerStatus, NOT_SET_UP,
};
use crate::managed_agents::credits_pause;

const PAUSED: &str = "Your team is paused. Resume it first.";

/// Save the companies this computer may run, then start the active one.
/// Removed companies are given up first (team stopped here, record
/// released); a failure saves nothing, so a retry sees the same removal.
#[tauri::command]
pub async fn team_set_companies(companies: Vec<TeamCompany>, app: AppHandle) -> Result<(), String> {
    let next = super::companies::normalize(companies.clone())?;
    let removed: Vec<_> = saved_companies(&app)?
        .companies
        .into_iter()
        .filter(|saved| !next.iter().any(|company| company.relay_url == saved.relay_url))
        .collect();
    for company in &removed {
        if runs_here(&app, &company.relay_url) {
            stop_team(&app, &company.relay_url).await?;
            claim_io::release(&app, &company.relay_url).await?;
        }
    }
    update_companies(&app, |file| file.replace(companies).map(|_| ()))?;
    for company in &removed {
        forget_claim(&app, &company.relay_url);
        close_company(&app, &company.relay_url);
    }
    start_loops(&app);
    tauri::async_runtime::spawn(activate_with_retry(app.clone()));
    Ok(())
}

/// Which computer runs the company's team (read fresh from the relay).
#[tauri::command]
pub async fn team_claim_status(relay_url: String, app: AppHandle) -> Result<TeamComputerStatus, String> {
    let company = team_company(&app, &relay_url)?;
    let view = claim_io::refresh(&app, &company.relay_url).await?;
    Ok(status_from(Some(&view), &ensure_computer(&app)?.computer_id))
}

/// Run the team on this computer. `force` moves it from another computer,
/// which stands down at its next heartbeat.
#[tauri::command]
pub async fn team_claim(relay_url: String, force: bool, app: AppHandle) -> Result<TeamComputerStatus, String> {
    let company = team_company(&app, &relay_url)?;
    let me = ensure_computer(&app)?.computer_id;
    let view = claim_io::claim(&app, &company.relay_url, force).await?;
    if view
        .holder
        .as_ref()
        .is_some_and(|holder| holder.computer_id == me)
    {
        start_loops(&app);
        activate(&app).await?;
    }
    let view = claim_view(&app, &company.relay_url)?.unwrap_or(view);
    Ok(status_from(Some(&view), &me))
}

/// Finish an approved hire: create the employee, attach it, add it and the
/// owner to the home channel, post its hello, publish Complete with the
/// company time zone, and start it. Journaled: a killed host finishes it once.
#[tauri::command]
pub async fn team_hire_complete(
    input: HireCompleteInput,
    app: AppHandle,
) -> Result<HireCompleteResult, String> {
    let hire = validated_input(&input)?;
    let company = team_company(&app, &hire.relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err("Your team is paused. Resume it to finish this hire.".to_string());
    }
    let state = runner(&app)?;
    let _one_hire_at_a_time = state.hire_lock.lock().await;
    let mut io = RelayHireIo::new(&app, &hire.relay_url).await?;
    let journal = io.journal()?;
    let (entry, outcome) = match journal.find(hire.hire_id) {
        Some(existing) => (existing.clone(), existing_entry_state(existing)),
        None => (
            new_entry(&hire, io.company_time_zone().await?, now_unix()),
            HireCompleteState::Started,
        ),
    };
    if outcome == HireCompleteState::AlreadyComplete {
        let agent_pubkey = entry
            .employee_pubkey
            .clone()
            .ok_or_else(|| "the finished hire has no employee".to_string())?;
        return Ok(HireCompleteResult {
            agent_pubkey,
            state: outcome,
        });
    }
    // Durable before the first side effect: a killed host resumes from here.
    io.save(&entry)?;
    let agent_pubkey = run_hire(&mut io, entry).await?;
    Ok(HireCompleteResult {
        agent_pubkey,
        state: outcome,
    })
}

/// Restart one employee now and clear its crash loop.
#[tauri::command]
pub async fn team_restart_employee(agent_pubkey: String, app: AppHandle) -> Result<(), String> {
    let pubkey = agent_pubkey.trim().to_ascii_lowercase();
    if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("employee key must be 64 hexadecimal characters".to_string());
    }
    let identity = identity(&app)?;
    let active = saved_companies(&app)?
        .active(&identity)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    let company = team_company(&app, &active.relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err(PAUSED.to_string());
    }
    if !team_employee_pubkeys(&app)?.contains(&pubkey) {
        return Err("This employee is not part of your team on this computer.".to_string());
    }
    with_book(&app, |book| book.reset(&pubkey))?;
    let relay = company.relay_url.clone();
    let (stop_app, stop_key, stop_relay) = (app.clone(), pubkey.clone(), relay.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::managed_agents::stop_managed_agent_runtime(stop_key, stop_relay, stop_app)
    })
    .await
    .map_err(|error| error.to_string())??;
    with_book(&app, |book| book.expect_running(&pubkey, &relay))?;
    let (start_app, start_relay) = (app.clone(), relay.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::managed_agents::start_managed_agent_runtime_pair_lazy(pubkey, start_relay, start_app)
    })
    .await
    .map_err(|error| error.to_string())??;
    super::status::emit_changes(&app, &relay);
    Ok(())
}

/// Restart every employee (each finishes its turn first) and clear crash loops.
#[tauri::command]
pub async fn team_restart_all(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err(PAUSED.to_string());
    }
    stop_team(&app, &company.relay_url).await?;
    let employees = team_employee_pubkeys(&app)?;
    with_book(&app, |book| {
        for pubkey in &employees {
            book.reset(pubkey);
        }
    })?;
    start_team(&app, &company).await?;
    super::status::emit_changes(&app, &company.relay_url);
    Ok(())
}

/// Pause the team (reason: a person). Only on the computer that runs it.
#[tauri::command]
pub async fn team_pause(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    super::pause_company(&app, &company.relay_url, PauseReason::Person).await
}

/// Resume the team. Credits come first: a funded credits pause resumes in
/// part I's seam. Otherwise the person's pause is cleared; another reason
/// that still holds the team is reported in plain words.
#[tauri::command]
pub async fn team_resume(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if credits_pause::resume_if_funded(&app, &company.relay_url).await? {
        return Ok(());
    }
    super::resume_company(&app, &company.relay_url, PauseReason::Person).await?;
    let reasons = saved_companies(&app)?
        .find(&company.relay_url)
        .map(|saved| saved.pause_reasons.clone())
        .unwrap_or_default();
    match still_paused_message(&reasons) {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

/// Every employee's runtime status on this computer.
#[tauri::command]
pub async fn team_status(relay_url: String, app: AppHandle) -> Result<Vec<EmployeeRuntimeStatus>, String> {
    let (all, changed) = super::status::snapshot(&app, &relay_url)?;
    for status in &changed {
        super::emit_status(&app, status);
    }
    Ok(all)
}
```

In `src/lib.rs`, replace (inside `tauri::generate_handler![`):

```rust
            google_desktop_sign_in,
```

with:

```rust
            google_desktop_sign_in,
            managed_agents::team_runner::commands::team_set_companies,
            managed_agents::team_runner::commands::team_claim_status,
            managed_agents::team_runner::commands::team_claim,
            managed_agents::team_runner::commands::team_hire_complete,
            managed_agents::team_runner::commands::team_restart_employee,
            managed_agents::team_runner::commands::team_restart_all,
            managed_agents::team_runner::commands::team_pause,
            managed_agents::team_runner::commands::team_resume,
            managed_agents::team_runner::commands::team_status,
```

In `desktop/electron/native-host.mjs`, replace (lines 17-19):

```js
  // Native Google OAuth allows 180 seconds for the browser and 20 for exchange.
  ["google_desktop_sign_in", 210_000],
]);
```

with:

```js
  // Native Google OAuth allows 180 seconds for the browser and 20 for exchange.
  ["google_desktop_sign_in", 210_000],
  // Creating, joining and starting a new employee can outlast one minute.
  ["team_hire_complete", 5 * 60_000],
  // Restarting every employee waits for each one to finish its turn.
  ["team_restart_all", 3 * 60_000],
]);
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::team_runner)`
Expected: PASS (2 `commands_tests` and every earlier team runner test, 0 failed).

Run: `cd desktop && node --test electron/native-host.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/team_runner.rs desktop/src-tauri/src/managed_agents/team_runner desktop/src-tauri/src/lib.rs desktop/electron/native-host.mjs desktop/electron/native-host.test.mjs
git commit -s -m "feat(desktop): register the team commands for the old shell and the new app"
```

---

### Task 4.13: Code-owned company roles on built-in personas, and the "Test Employee" fixture

**Files:**
- Modify: `src/managed_agents/personas.rs:5` (imports), `:7-16` (`BuiltInPersona`), `:37-68` (`BUILT_IN_PERSONAS`), `:70-75`, `:116-146`, `:154-158`, `:188-202`, `:258-266`
- Modify: `src/managed_agents/personas/tests.rs` (append)
- Test: `src/managed_agents/personas/tests.rs`

**Interfaces:**
- Consumes: Task 4.1 `CompanyRoleMetadata`, `RoleDutyTemplate`, `RoleOnHire`, `validate_company_role_metadata`; part B `validate_hire_proposal`; `buzz_core_pkg::company_duties::parse_readable_schedule`.
- Produces (the names part G assumes):
  - `BuiltInPersona.company_role: Option<fn() -> CompanyRoleMetadata>`; every launch persona starts with `company_role: None` (part G fills Scout's).
  - `merge_personas` refreshes a stored built-in's `company_role` from code on every load (a role is code-owned, so a role change ships with the app); `merge_personas_with(stored, now, built_ins)` is the same merge against an explicit built-in list.
  - `TEST_EMPLOYEE_PERSONA_ID = "builtin:test-employee"`, `FIXTURE_ROLE_PACKS_ENV = "COLONY_FIXTURE_ROLE_PACKS"`, `FIXTURE_DUTY_TIME_ENV = "COLONY_FIXTURE_DUTY_TIME"`, `fixture_role_packs_enabled_from`, `fixture_duty_schedule_from`.
  - The fixture "Test Employee" (only when `COLONY_FIXTURE_ROLE_PACKS=1`, exactly): worker menu `claude`, `codex`, `buzz-agent`; owns "One short note in the home channel every day"; channel `test-employee`; one routine "Daily note" at `Every day at HH:MM` (`COLONY_FIXTURE_DUTY_TIME`, default 09:00); on-hire source "business profile", 14-day plan; home `test.note`. Its instructions keep it to one ready line after the hire and one note per routine wake, so the gate can count messages.

- [ ] **Step 1: Write the failing tests**

Append to `src/managed_agents/personas/tests.rs`:

```rust

// Code-owned company roles and the real-run gate's fixture.

use super::{
    fixture_duty_schedule_from, fixture_role_packs_enabled_from, merge_personas_with,
    test_employee_role, BuiltInPersona, FIXTURE_PERSONAS, TEST_EMPLOYEE_PERSONA_ID,
    TEST_EMPLOYEE_SYSTEM_PROMPT,
};

const NOW: &str = "2026-10-11T00:00:00Z";

fn with_fixture() -> Vec<&'static BuiltInPersona> {
    BUILT_IN_PERSONAS
        .iter()
        .chain(FIXTURE_PERSONAS.iter())
        .collect()
}

#[test]
fn built_in_company_roles_are_refreshed_from_code_on_every_load() {
    let built_ins = with_fixture();
    let (mut stored, _) = merge_personas_with(Vec::new(), NOW, &built_ins);
    let tester = stored
        .iter_mut()
        .find(|persona| persona.id == TEST_EMPLOYEE_PERSONA_ID)
        .expect("the fixture is merged in");
    let mut stale = tester.company_role.clone().expect("the fixture has a role");
    stale.job = "An old job".to_string();
    tester.company_role = Some(stale);

    let (merged, changed) = merge_personas_with(stored, NOW, &built_ins);
    assert!(changed);
    let refreshed = merged
        .iter()
        .find(|persona| persona.id == TEST_EMPLOYEE_PERSONA_ID)
        .expect("kept");
    assert_eq!(refreshed.company_role, Some(test_employee_role()));
    assert!(refreshed.is_builtin);

    let (_, changed_again) = merge_personas_with(merged, NOW, &built_ins);
    assert!(!changed_again, "an up-to-date role is not written again");
}

#[test]
fn the_fixture_pack_is_off_unless_the_gate_turns_it_on() {
    assert!(fixture_role_packs_enabled_from(Some("1")));
    for value in [None, Some(""), Some("0"), Some("true"), Some("yes")] {
        assert!(!fixture_role_packs_enabled_from(value), "{value:?}");
    }
    assert!(
        built_in_persona_records(NOW)
            .iter()
            .all(|persona| persona.id != TEST_EMPLOYEE_PERSONA_ID),
        "without the flag, no fixture reaches anyone's catalog"
    );
}

#[test]
fn the_gate_sets_the_fixture_routine_time() {
    assert_eq!(fixture_duty_schedule_from(Some("14:35")), "Every day at 14:35");
    assert_eq!(fixture_duty_schedule_from(None), "Every day at 09:00");
    for bad in ["25:00", "9:00", "noon", "14:60", "14:35:00"] {
        assert_eq!(
            fixture_duty_schedule_from(Some(bad)),
            "Every day at 09:00",
            "{bad}"
        );
    }
}

#[test]
fn the_fixture_role_is_a_valid_hire_role_pack() {
    let role = test_employee_role();
    crate::managed_agents::validate_company_role_metadata(&role).expect("the desktop accepts it");
    let mut pack = serde_json::to_value(&role).expect("role serializes");
    pack["personaId"] = serde_json::json!(TEST_EMPLOYEE_PERSONA_ID);
    pack["title"] = serde_json::json!("Test Employee");
    let proposal: buzz_core_pkg::company_records::HireProposal =
        serde_json::from_value(serde_json::json!({
            "hireId": "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10",
            "rolePack": pack,
            "displayName": "Gate Tester",
            "title": "Test Employee",
            "introductionChannelId": "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c",
            "runtimeId": "claude"
        }))
        .expect("a hire proposal");
    buzz_core_pkg::company_records::validate_hire_proposal(&proposal)
        .expect("the relay accepts the role pack");
    for text in [TEST_EMPLOYEE_SYSTEM_PROMPT, role.job.as_str()] {
        for banned in ["Buzz", "Fizz", "Honey", "\u{2014}"] {
            assert!(!text.contains(banned), "{banned} in {text}");
        }
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::personas)`
Expected: FAIL to compile with `error[E0432]: unresolved imports super::fixture_duty_schedule_from, super::merge_personas_with, super::FIXTURE_PERSONAS`.

- [ ] **Step 3: Implement**

In `src/managed_agents/personas.rs`, replace (line 5):

```rust
use crate::{managed_agents::AgentDefinition, util::now_iso};
```

with:

```rust
use crate::{
    managed_agents::{AgentDefinition, CompanyRoleMetadata, RoleDutyTemplate, RoleOnHire},
    util::now_iso,
};
```

Replace the struct (lines 7-16):

```rust
struct BuiltInPersona {
    id: &'static str,
    display_name: &'static str,
    avatar_url: Option<&'static str>,
    system_prompt: &'static str,
    name_pool: &'static [&'static str],
    model: Option<&'static str>,
    runtime: Option<&'static str>,
    default_active: bool,
}
```

with:

```rust
struct BuiltInPersona {
    id: &'static str,
    display_name: &'static str,
    avatar_url: Option<&'static str>,
    system_prompt: &'static str,
    name_pool: &'static [&'static str],
    model: Option<&'static str>,
    runtime: Option<&'static str>,
    default_active: bool,
    /// The role a hire copies. Code-owned: `merge_personas` refreshes the
    /// stored built-in from it on every load.
    company_role: Option<fn() -> CompanyRoleMetadata>,
}
```

Replace `BUILT_IN_PERSONAS` (lines 37-68):

```rust
const BUILT_IN_PERSONAS: &[BuiltInPersona] = &[
    BuiltInPersona {
        id: "builtin:fizz",
        display_name: "Scout",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: FIZZ_SYSTEM_PROMPT,
        name_pool: &["Scout"],
        model: None,
        runtime: None,
        default_active: true,
    },
    BuiltInPersona {
        id: "builtin:honey",
        display_name: "Writer",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a writing assistant. Help the user communicate clearly, summarize information, and prepare useful drafts. Be calm, thoughtful, and concise.",
        name_pool: &["Writer"],
        model: None,
        runtime: None,
        default_active: false,
    },
    BuiltInPersona {
        id: POLLEN_PERSONA_ID,
        display_name: "Researcher",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a research assistant. Compare sources, check assumptions, and explain findings clearly. Be candid about uncertainty and provide useful evidence.",
        name_pool: &["Researcher"],
        model: None,
        runtime: None,
        default_active: false,
    },
];
```

with:

```rust
const BUILT_IN_PERSONAS: &[BuiltInPersona] = &[
    BuiltInPersona {
        id: "builtin:fizz",
        display_name: "Scout",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: FIZZ_SYSTEM_PROMPT,
        name_pool: &["Scout"],
        model: None,
        runtime: None,
        default_active: true,
        company_role: None,
    },
    BuiltInPersona {
        id: "builtin:honey",
        display_name: "Writer",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a writing assistant. Help the user communicate clearly, summarize information, and prepare useful drafts. Be calm, thoughtful, and concise.",
        name_pool: &["Writer"],
        model: None,
        runtime: None,
        default_active: false,
        company_role: None,
    },
    BuiltInPersona {
        id: POLLEN_PERSONA_ID,
        display_name: "Researcher",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a research assistant. Compare sources, check assumptions, and explain findings clearly. Be candid about uncertainty and provide useful evidence.",
        name_pool: &["Researcher"],
        model: None,
        runtime: None,
        default_active: false,
        company_role: None,
    },
];

/// Persona id of the real-run gate's fixture employee.
pub(crate) const TEST_EMPLOYEE_PERSONA_ID: &str = "builtin:test-employee";
/// `1` turns the fixture role pack on (real-run gate only).
pub(crate) const FIXTURE_ROLE_PACKS_ENV: &str = "COLONY_FIXTURE_ROLE_PACKS";
/// The fixture's daily note time, `HH:MM` in the company time zone (gate only).
pub(crate) const FIXTURE_DUTY_TIME_ENV: &str = "COLONY_FIXTURE_DUTY_TIME";
const DEFAULT_FIXTURE_DUTY_TIME: &str = "09:00";

const TEST_EMPLOYEE_SYSTEM_PROMPT: &str = "You are a test employee that shows Colony runs a team by itself. When you are hired, reply once in your conversation with one short sentence saying you are ready. When your Daily note routine wakes you, post one short note in your conversation saying the daily note ran, with today's date. Never post anything else.";

/// Built-ins that exist only when the real-run gate turns them on.
const FIXTURE_PERSONAS: &[BuiltInPersona] = &[BuiltInPersona {
    id: TEST_EMPLOYEE_PERSONA_ID,
    display_name: "Test Employee",
    avatar_url: Some(include_str!("scout_avatar.txt")),
    system_prompt: TEST_EMPLOYEE_SYSTEM_PROMPT,
    name_pool: &["Gate Tester"],
    model: None,
    runtime: None,
    default_active: true,
    company_role: Some(test_employee_role),
}];

/// Whether `value` (of `COLONY_FIXTURE_ROLE_PACKS`) turns the fixture on: only `1`.
pub(crate) fn fixture_role_packs_enabled_from(value: Option<&str>) -> bool {
    value == Some("1")
}

fn fixture_role_packs_enabled() -> bool {
    fixture_role_packs_enabled_from(std::env::var(FIXTURE_ROLE_PACKS_ENV).ok().as_deref())
}

fn is_clock(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.len() == 2
        && minute.len() == 2
        && hour.parse::<u8>().is_ok_and(|hour| hour < 24)
        && minute.parse::<u8>().is_ok_and(|minute| minute < 60)
}

/// The fixture routine's schedule: `Every day at HH:MM` from the gate, else 09:00.
pub(crate) fn fixture_duty_schedule_from(value: Option<&str>) -> String {
    let time = value
        .map(str::trim)
        .filter(|time| is_clock(time))
        .unwrap_or(DEFAULT_FIXTURE_DUTY_TIME);
    let schedule = format!("Every day at {time}");
    if buzz_core_pkg::company_duties::parse_readable_schedule(&schedule).is_some() {
        schedule
    } else {
        format!("Every day at {DEFAULT_FIXTURE_DUTY_TIME}")
    }
}

/// The fixture's role pack.
fn test_employee_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Post one short note in your conversation every day, so the owner can see the team runs by itself.".to_string(),
        skills: vec!["Writing one short note".to_string()],
        tools: Vec::new(),
        worker_menu: vec![
            "claude".to_string(),
            "codex".to_string(),
            "buzz-agent".to_string(),
        ],
        default_allowance: None,
        owns: Some("One short note in the home channel every day".to_string()),
        channel: Some("test-employee".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Daily note".to_string(),
            schedule_text: fixture_duty_schedule_from(
                std::env::var(FIXTURE_DUTY_TIME_ENV).ok().as_deref(),
            ),
            instructions: "Post one short note in this conversation saying the daily note ran, with today's date.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["business profile".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["posting anywhere other than this conversation".to_string()],
        home: Some("test.note".to_string()),
    }
}

/// The code-owned built-ins: the launch personas, then the fixture when the
/// real-run gate turned it on.
fn built_in_personas() -> Vec<&'static BuiltInPersona> {
    let fixtures: &'static [BuiltInPersona] = if fixture_role_packs_enabled() {
        FIXTURE_PERSONAS
    } else {
        &[]
    };
    BUILT_IN_PERSONAS.iter().chain(fixtures.iter()).collect()
}
```

Replace `built_in_persona_avatar_url` (lines 70-75):

```rust
pub(crate) fn built_in_persona_avatar_url(id: &str) -> Option<&'static str> {
    BUILT_IN_PERSONAS
        .iter()
        .find(|persona| persona.id == id)
        .and_then(|persona| persona.avatar_url)
}
```

with:

```rust
pub(crate) fn built_in_persona_avatar_url(id: &str) -> Option<&'static str> {
    built_in_personas()
        .into_iter()
        .find(|persona| persona.id == id)
        .and_then(|persona| persona.avatar_url)
}
```

Replace the head of `built_in_persona_records` (lines 116-120):

```rust
fn built_in_persona_records(now: &str) -> Vec<AgentDefinition> {
    BUILT_IN_PERSONAS
        .iter()
        .map(|persona| AgentDefinition {
            company_role: None,
```

with:

```rust
fn built_in_persona_records(now: &str) -> Vec<AgentDefinition> {
    persona_records(&built_in_personas(), now)
}

fn persona_records(built_ins: &[&'static BuiltInPersona], now: &str) -> Vec<AgentDefinition> {
    built_ins
        .iter()
        .map(|persona| AgentDefinition {
            company_role: persona.company_role.map(|role| role()),
```

Replace `built_in_order` (lines 154-158):

```rust
fn built_in_order(id: &str) -> Option<usize> {
    BUILT_IN_PERSONAS
        .iter()
        .position(|persona| persona.id == id)
}
```

with:

```rust
fn built_in_order(id: &str) -> Option<usize> {
    built_in_personas()
        .iter()
        .position(|persona| persona.id == id)
}
```

Replace the head of `merge_personas` (lines 188-202):

```rust
fn merge_personas(mut stored: Vec<AgentDefinition>, now: &str) -> (Vec<AgentDefinition>, bool) {
    let mut changed = false;

    for built_in in built_in_persona_records(now) {
        if let Some(existing) = stored.iter_mut().find(|record| record.id == built_in.id) {
            if !existing.is_builtin {
                existing.is_builtin = true;
                changed = true;
            }
        } else {
            stored.push(built_in);
            changed = true;
        }
    }
```

with:

```rust
fn merge_personas(stored: Vec<AgentDefinition>, now: &str) -> (Vec<AgentDefinition>, bool) {
    merge_personas_with(stored, now, &built_in_personas())
}

/// [`merge_personas`] against an explicit built-in list, so tests can merge
/// the fixture without touching the process environment.
fn merge_personas_with(
    mut stored: Vec<AgentDefinition>,
    now: &str,
    built_ins: &[&'static BuiltInPersona],
) -> (Vec<AgentDefinition>, bool) {
    let mut changed = false;

    for built_in in persona_records(built_ins, now) {
        if let Some(existing) = stored.iter_mut().find(|record| record.id == built_in.id) {
            if !existing.is_builtin {
                existing.is_builtin = true;
                changed = true;
            }
            // A built-in's company role is code-owned: refresh it on every load.
            if existing.company_role != built_in.company_role {
                existing.company_role = built_in.company_role.clone();
                existing.updated_at = now.to_string();
                changed = true;
            }
        } else {
            stored.push(built_in);
            changed = true;
        }
    }
```

Replace the demotion check (lines 258-260):

```rust
    for record in stored.iter_mut() {
        if record.is_builtin && built_in_order(&record.id).is_none() {
```

with:

```rust
    for record in stored.iter_mut() {
        if record.is_builtin && !built_ins.iter().any(|persona| persona.id == record.id) {
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::personas managed_agents::nest::brand_guard_tests)`
Expected: PASS (4 new persona tests, the existing persona tests and the brand guard, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/personas.rs desktop/src-tauri/src/managed_agents/personas/tests.rs
git commit -s -m "feat(desktop): code-owned company roles on built-ins and the gate's Test Employee"
```

---

### Task 4.14: Voice rules in the employee's skill and AGENTS.md

**Files:**
- Modify: `src/managed_agents/nest.rs:46-57` (`COLONY_CLI_SKILL_MD`), `:67-71` (`NEST_SKILL_VERSION`), `render_dynamic_section` tail (around line 694), `:1029-1030` (test modules)
- Modify: `src/managed_agents/nest_skill.md:141-148` ("Message Formatting")
- Create: `src/managed_agents/nest/voice_rules_tests.rs`
- Test: `src/managed_agents/nest/voice_rules_tests.rs`

**Interfaces:**
- Consumes: part C `crates/buzz-acp/src/voice.md` (starts with `## Voice`) and `buzz_acp::VOICE_RULES`.
- Produces: the colony-cli skill carries the voice rules once, between `nest_skill.md` and the web task rules; `NEST_SKILL_VERSION` is 9, so every existing nest rewrites its skill; the managed section of `AGENTS.md` carries the voice rules before the web task rules; "Message Formatting" no longer invites headings, tables or bullet lists in chat.

- [ ] **Step 1: Write the failing tests**

Create `src/managed_agents/nest/voice_rules_tests.rs`:

```rust
//! The voice rules reach every file Colony writes for employees to read.
//!
//! One copy, `voice.md` in buzz-acp ([`buzz_acp::VOICE_RULES`]); these tests
//! go through the real writers, so dropping the rules from any of them fails.

use super::*;
use std::collections::HashSet;

fn voice() -> &'static str {
    buzz_acp::VOICE_RULES.trim_end()
}

#[test]
fn the_skill_carries_the_voice_rules_once_before_the_web_task_rules() {
    let voice_at = COLONY_CLI_SKILL_MD
        .find(voice())
        .expect("the skill carries the voice rules");
    let web_at = COLONY_CLI_SKILL_MD
        .find("## Web Tasks")
        .expect("the skill carries the web task rules");
    assert!(voice_at < web_at);
    assert_eq!(COLONY_CLI_SKILL_MD.matches("## Voice").count(), 1);
    assert!(COLONY_CLI_SKILL_MD.ends_with(buzz_acp::WEB_TASK_RULES));
}

#[test]
fn message_formatting_points_at_the_voice_rules() {
    let section = COLONY_CLI_SKILL_MD
        .split("## Message Formatting")
        .nth(1)
        .and_then(|rest| rest.split("\n## ").next())
        .expect("the formatting section");
    assert!(section.contains("Voice rules"));
    assert!(!section.contains("headings: standard GFM"), "chat is not a report");
    assert!(section.contains("plain `@name`"), "mentions still alert");
}

#[test]
fn a_skill_written_by_the_previous_release_is_regenerated_with_the_voice_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What 1.0.7 left on disk: the skill without the voice rules, version 8.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(skill_dir.join("SKILL.md"), include_str!("../nest_skill.md")).unwrap();
    fs::write(skill_dir.join(".skill-version"), "8\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains(voice()),
        "adding the voice rules must bump NEST_SKILL_VERSION so existing nests pick them up"
    );
}

#[test]
fn the_managed_agents_md_section_carries_the_voice_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();
    let agents_md = root.join("AGENTS.md");

    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&agents_md, &managed).unwrap();

    let written = fs::read_to_string(&agents_md).unwrap();
    let begin = written.find(BEGIN_LINE).expect("managed section opens");
    let end = written.find(END_MARKER).expect("managed section closes");
    let section = &written[begin..end];
    let voice_at = section.find(voice()).expect("the voice rules live in the managed section");
    let web_at = section.find("## Web Tasks").expect("so do the web task rules");
    assert!(voice_at < web_at);
    assert_eq!(written.matches("## Voice").count(), 1);
}
```

In `src/managed_agents/nest.rs`, replace (lines 1029-1030):

```rust
#[cfg(test)]
mod web_task_rules_tests;
```

with:

```rust
#[cfg(test)]
mod voice_rules_tests;
#[cfg(test)]
mod web_task_rules_tests;
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest::voice_rules_tests)`
Expected: FAIL: `the skill carries the voice rules` panics in the first test, and the others fail on their `contains(voice())` checks.

- [ ] **Step 3: Implement**

In `src/managed_agents/nest.rs`, replace (lines 46-57):

```rust
/// Default SKILL.md content for the colony-cli skill.
/// Written to `<nest>/.agents/skills/colony-cli/SKILL.md` on first init.
///
/// It ends with the web task rules. Their one copy is `web_tasks.md` in
/// buzz-acp, which is also the end of every agent's base prompt
/// ([`buzz_acp::WEB_TASK_RULES`]); the file is included here because a const
/// cannot be built from another crate's const.
const COLONY_CLI_SKILL_MD: &str = concat!(
    include_str!("nest_skill.md"),
    "\n",
    include_str!("../../../../crates/buzz-acp/src/web_tasks.md")
);
```

with:

```rust
/// Default SKILL.md content for the colony-cli skill.
/// Written to `<nest>/.agents/skills/colony-cli/SKILL.md` on first init.
///
/// It ends with the voice rules and then the web task rules. Their one copies
/// are `voice.md` and `web_tasks.md` in buzz-acp, which every agent's base
/// prompt also carries ([`buzz_acp::VOICE_RULES`],
/// [`buzz_acp::WEB_TASK_RULES`]); the files are included here because a const
/// cannot be built from another crate's const.
const COLONY_CLI_SKILL_MD: &str = concat!(
    include_str!("nest_skill.md"),
    "\n",
    include_str!("../../../../crates/buzz-acp/src/voice.md"),
    "\n",
    include_str!("../../../../crates/buzz-acp/src/web_tasks.md")
);
```

Replace (lines 67-71):

```rust
/// Version 8 added the web task rules (see [`COLONY_CLI_SKILL_MD`]).
const NEST_SKILL_VERSION: u32 = 8;
```

with:

```rust
/// Version 8 added the web task rules (see [`COLONY_CLI_SKILL_MD`]).
/// Version 9 added the voice rules and rewrote "Message Formatting".
const NEST_SKILL_VERSION: u32 = 9;
```

In `render_dynamic_section`, replace:

```rust
    let relay_url = relay_url.replace(['\n', '\r'], "");
    // The web task rules ride in the managed section, which every launch
    // rewrites, so existing nests pick up a change without a template bump.
    let web_task_rules = buzz_acp::WEB_TASK_RULES.trim_end();
    format!("{active_agents}\n\n## Workspace\n- Relay: {relay_url}\n\n{web_task_rules}")
```

with:

```rust
    let relay_url = relay_url.replace(['\n', '\r'], "");
    // The voice and web task rules ride in the managed section, which every
    // launch rewrites, so existing nests pick up a change without a template bump.
    let voice_rules = buzz_acp::VOICE_RULES.trim_end();
    let web_task_rules = buzz_acp::WEB_TASK_RULES.trim_end();
    format!(
        "{active_agents}\n\n## Workspace\n- Relay: {relay_url}\n\n{voice_rules}\n\n{web_task_rules}"
    )
```

In `src/managed_agents/nest_skill.md`, replace the section (lines 141-148):

```markdown
## Message Formatting

Message content is rendered as GitHub-flavored Markdown on both desktop and mobile. Key formatting:

- **Fenced code blocks**: triple-backtick with a language tag for syntax highlighting (190+ languages supported). Omitting the language tag renders a styled monochrome block.
- **Inline code**: single backticks for inline monospace.
- **Mentions**: plain `@name` , do NOT bold or italicize (formatting prevents alert delivery).
- **Links, images, tables, blockquotes, headings**: standard GFM.
```

with:

```markdown
## Message Formatting

Messages render as GitHub-flavored Markdown on desktop and mobile, but a conversation is a chat, not a report: follow the Voice rules near the end of this skill. Keep replies short, put long work in a document or a decision card, and leave headings, tables and bullet lists out of chat.

- **Code**: a fenced code block with a language tag, only when you share code.
- **Mentions**: plain `@name`, never bold or italic (formatting stops the alert).
- **Links**: plain links are fine.
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest)`
Expected: PASS (4 `voice_rules_tests`, the web task rule tests and the existing nest tests, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/nest.rs desktop/src-tauri/src/managed_agents/nest_skill.md desktop/src-tauri/src/managed_agents/nest/voice_rules_tests.rs
git commit -s -m "feat(desktop): carry the voice rules in the employee skill and AGENTS.md"
```

---

### Task 4.15: Phase 0 real-run gate (headless, Mac and Windows)

**Files:**
- Create: `desktop/tests/real-run/team-host/README.md` (what it proves, how to run, proof checklist)
- Create: `desktop/tests/real-run/team-host/steps.mjs` (pure helpers)
- Create: `desktop/tests/real-run/team-host/steps.test.mjs`
- Create: `desktop/tests/real-run/team-host/relay-api.mjs` (NIP-98 relay calls)
- Create: `desktop/tests/real-run/team-host/host-driver.mjs` (starts the packaged host through `NativeHost`)
- Create: `desktop/tests/real-run/team-host/gate.mjs` (the ten steps and the JSON report)
- Create: `desktop/tests/real-run/team-host/.gitignore`
- Modify: `desktop/package.json:17` (unit tests of the pure helpers run with the desktop tests)
- Test: `desktop/tests/real-run/team-host/steps.test.mjs`

**Interfaces:**
- Consumes: the overview's phase 0 gate; part A accounts endpoints (`/api/accounts/code/start`, `/api/accounts/code/verify` returning `nsec` and `created`), `POST /api/communities` (`community.normalized_host`), the profile action (kind 47046, `d` = `business-profile`, OK message `response:{"revision":n}`) and head (30657); part B hire actions (kind 47039, `create` then `approve`, `d` = `company:hire:<id>`) and heads (30650); Tasks 4.3 to 4.14 through the host commands `list_personas`, `team_set_companies`, `team_claim_status`, `team_hire_complete`, `team_status`; the host's files `<app data>/team/hire-journal.json` and `<app data>/agents/managed-agents.json` (read only, counted, never printed); `desktop/electron/native-host.mjs` `NativeHost`.
- Produces: `node desktop/tests/real-run/team-host/gate.mjs` (refuses unless `COLONY_REAL_RUN=1`, refuses when `CI` is set) and a JSON report: `{ gate, startedAt, finishedAt, platform, hostBinary, relay, timeZone, runtime, steps: [{ id, label, status: "PASS" | "FAIL" | "NOT OBSERVED", detail, ms }], verdict: "PASS" | "FAIL" | "INCOMPLETE" }`. A step never reports PASS without an observation behind it; a step whose prerequisite did not pass is NOT OBSERVED.
- Steps: 1 sign in with an email code (new account); 2 create the company; 3 set the business profile; 4 start the host and claim the team computer; 5 hire the Test Employee; 6 the employee answers its kickoff within 5 minutes; 7 a hire interrupted by a killed host finishes exactly once; 8 the team starts with no interface; 9 a routine missed while the host was stopped runs exactly once; 10 a second computer runs nothing.

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

Create `desktop/tests/real-run/team-host/steps.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  STEPS,
  businessProfile,
  clockIn,
  completeRows,
  createChannel,
  dutyTime,
  employeeMessages,
  employeesForHire,
  hellos,
  hireAction,
  hireProposal,
  journalEntry,
  profileAction,
  row,
  verdictOf,
} from "./steps.mjs";

const EMPLOYEE = "ab".repeat(32);
const RELAY_SELF = "cd".repeat(32);
const CHANNEL = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const HIRE = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const MARKER = `company-hire:${HIRE}:introduction`;

const persona = {
  id: "builtin:test-employee",
  display_name: "Test Employee",
  company_role: {
    job: "Post one short note",
    skills: [],
    tools: [],
    workerMenu: ["claude"],
    duties: [{ title: "Daily note", scheduleText: "Every day at 14:35", instructions: "Post one short note." }],
  },
};

const message = (overrides) => ({
  kind: 9,
  pubkey: EMPLOYEE,
  created_at: 1_000,
  tags: [["h", CHANNEL]],
  content: "Ready.",
  ...overrides,
});

test("the verdict is PASS only when every step passed", () => {
  const all = STEPS.map((step) => row(step.id, PASS, "seen", 1));
  assert.equal(verdictOf(all), "PASS");
  assert.equal(verdictOf([...all.slice(1), row(STEPS[0].id, FAIL, "x", 1)]), "FAIL");
  const partial = completeRows(all.slice(0, 3));
  assert.equal(partial.length, STEPS.length);
  assert.equal(partial[5].status, NOT_OBSERVED);
  assert.equal(verdictOf(partial), "INCOMPLETE");
});

test("the hire proposal carries the host's role pack", () => {
  const proposal = hireProposal({
    hireId: HIRE,
    persona,
    displayName: "Gate Tester",
    channelId: CHANNEL,
    runtimeId: "claude",
  });
  assert.equal(proposal.rolePack.personaId, "builtin:test-employee");
  assert.equal(proposal.rolePack.title, "Test Employee");
  assert.equal(proposal.rolePack.duties[0].scheduleText, "Every day at 14:35");
  assert.equal(proposal.introductionChannelId, CHANNEL);
  assert.throws(() => hireProposal({ hireId: HIRE, persona: { id: "x" }, displayName: "y", channelId: CHANNEL, runtimeId: "claude" }));
});

test("record actions use the contract kinds and coordinates", () => {
  const profile = profileAction(businessProfile("Africa/Johannesburg"));
  assert.equal(profile.kind, 47046);
  assert.deepEqual(profile.tags, [["d", "business-profile"]]);
  const body = JSON.parse(profile.content);
  assert.equal(body.expectedRevision, null);
  assert.equal(body.profile.timeZone, "Africa/Johannesburg");
  assert.equal(body.profile.schemaVersion, 1);

  const hire = hireAction({ hireId: HIRE, action: "approve", expectedHeadEventId: "e".repeat(64) });
  assert.equal(hire.kind, 47039);
  assert.deepEqual(hire.tags, [["d", `company:hire:${HIRE}`]]);
  assert.equal(JSON.parse(hire.content).schemaVersion, 1);

  const channel = createChannel(CHANNEL, "gate-one");
  assert.equal(channel.kind, 9007);
  assert.deepEqual(channel.tags[0], ["h", CHANNEL]);
});

test("the routine time is a whole minute in the company time zone", () => {
  const noonUtc = Date.UTC(2026, 9, 11, 12, 0, 30);
  assert.equal(clockIn(noonUtc, "Africa/Johannesburg"), "14:00");
  const duty = dutyTime(noonUtc, 35, "Africa/Johannesburg");
  assert.equal(duty.atMs % 60_000, 0);
  assert.equal(duty.clock, "14:36");
});

test("employee messages leave out the hello, other channels, other authors and older posts", () => {
  const events = [
    message({ content: "Ready." }),
    message({ tags: [["h", CHANNEL], ["client", MARKER]], content: "Hi everyone" }),
    message({ tags: [["h", "other"]] }),
    message({ pubkey: RELAY_SELF }),
    message({ created_at: 10 }),
  ];
  const found = employeeMessages(events, {
    employee: EMPLOYEE,
    channelId: CHANNEL,
    sinceSec: 500,
    helloMarker: MARKER,
  });
  assert.deepEqual(found.map((event) => event.content), ["Ready."]);
  assert.equal(hellos(events, MARKER).length, 1);
});

test("a hire's employees are counted from the agent store and its journal entry is found", () => {
  const store = [
    { pubkey: EMPLOYEE, role_context: { goalId: HIRE } },
    { pubkey: RELAY_SELF, role_context: { goalId: "another" } },
    { pubkey: "", role_context: { goalId: HIRE } },
  ];
  assert.equal(employeesForHire(store, HIRE).length, 1);
  assert.equal(employeesForHire(null, HIRE).length, 0);
  const journal = { entries: [{ hireId: HIRE, step: "employee_created" }] };
  assert.equal(journalEntry(journal, HIRE)?.step, "employee_created");
  assert.equal(journalEntry(null, HIRE), null);
});
```

In `desktop/package.json`, replace (line 17):

```json
    "test": "node --import ./test-loader.mjs --experimental-strip-types --test \"src/**/*.test.mjs\" \"scripts/*.test.mjs\" \"electron/**/*.test.mjs\" \"tests/real-run/nest-migration/*.test.mjs\"",
```

with:

```json
    "test": "node --import ./test-loader.mjs --experimental-strip-types --test \"src/**/*.test.mjs\" \"scripts/*.test.mjs\" \"electron/**/*.test.mjs\" \"tests/real-run/nest-migration/*.test.mjs\" \"tests/real-run/team-host/*.test.mjs\"",
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd desktop && node --test tests/real-run/team-host/steps.test.mjs`
Expected: FAIL with `Cannot find module '.../tests/real-run/team-host/steps.mjs'`.

- [ ] **Step 3: The pure helpers**

Create `desktop/tests/real-run/team-host/steps.mjs`:

```js
// Pure helpers for the phase 0 team host gate: the step list, report rows,
// record actions, the role pack sent with a hire, message counting and clock
// maths. Unit tested without a relay or a host (steps.test.mjs).

export const PASS = "PASS";
export const FAIL = "FAIL";
export const NOT_OBSERVED = "NOT OBSERVED";

/** The ten steps, in order. */
export const STEPS = [
  { id: "sign_in", label: "Sign in with an email code (new account)" },
  { id: "create_company", label: "Create the company" },
  { id: "set_profile", label: "Set the business profile" },
  { id: "claim", label: "Start the host and claim the team computer" },
  { id: "hire", label: "Hire the Test Employee" },
  { id: "kickoff_answer", label: "The employee answers its kickoff within 5 minutes" },
  { id: "interrupted_hire", label: "A hire interrupted by a killed host finishes exactly once" },
  { id: "no_interface", label: "The team starts with no interface" },
  { id: "missed_routine", label: "A routine missed while the host was stopped runs exactly once" },
  { id: "second_computer", label: "A second computer runs nothing" },
];

/** One report row. */
export const row = (id, status, detail, ms) => ({
  id,
  label: STEPS.find((step) => step.id === id)?.label ?? id,
  status,
  detail,
  ms,
});

/** Every step gets a row: a step that never ran is NOT OBSERVED, never PASS. */
export function completeRows(rows) {
  return STEPS.map(
    (step) =>
      rows.find((item) => item.id === step.id) ??
      row(step.id, NOT_OBSERVED, "did not run", 0),
  );
}

/** PASS only when every step passed; FAIL when any failed; otherwise INCOMPLETE. */
export function verdictOf(rows) {
  if (rows.some((item) => item.status === FAIL)) return "FAIL";
  const passed = STEPS.every(
    (step) => rows.find((item) => item.id === step.id)?.status === PASS,
  );
  return passed ? "PASS" : "INCOMPLETE";
}

/** The business profile the gate saves (overview JSON). */
export function businessProfile(timeZone) {
  return {
    schemaVersion: 1,
    name: "Gate Test Company",
    whatYouSell: "Handmade notebooks, made to check that Colony runs a team by itself.",
    whoBuys: "People who test software.",
    whereYouSell: ["website"],
    city: "Johannesburg",
    country: "South Africa",
    timeZone,
    links: [],
    voiceWords: ["plain"],
    goals: ["Check the team runs"],
    contact: { email: null, phone: null, whatsapp: null, address: null },
    buyLink: null,
    invoice: { registeredName: null, registrationNumber: null, vatNumber: null, bankDetails: null },
    socialAccounts: { instagram: null, facebook: null, tiktok: null, linkedin: null, x: null },
  };
}

/** Business profile action (kind 47046) for a company with no profile yet. */
export const profileAction = (profile) => ({
  kind: 47046,
  tags: [["d", "business-profile"]],
  content: JSON.stringify({ profile, expectedRevision: null }),
});

/** Create a private conversation (kind 9007) the owner belongs to. */
export const createChannel = (channelId, name) => ({
  kind: 9007,
  tags: [
    ["h", channelId],
    ["name", name],
    ["visibility", "private"],
    ["channel_type", "stream"],
  ],
  content: "",
});

/** Hire action (kind 47039), company-wide: one `d` tag, no `h` tag. */
export const hireAction = (action) => ({
  kind: 47039,
  tags: [["d", `company:hire:${action.hireId}`]],
  content: JSON.stringify({ schemaVersion: 1, ...action }),
});

/** The hire role pack, built from the host's persona (`list_personas`). */
export function rolePackFromPersona(persona) {
  const role = persona?.company_role;
  if (!role) throw new Error(`persona ${persona?.id} has no company role`);
  return { ...role, personaId: persona.id, title: persona.display_name };
}

/** A direct hire proposal for the fixture. */
export function hireProposal({ hireId, persona, displayName, channelId, runtimeId }) {
  return {
    hireId,
    rolePack: rolePackFromPersona(persona),
    displayName,
    title: persona.display_name,
    introductionChannelId: channelId,
    runtimeId,
  };
}

/** `HH:MM` in `timeZone` at `epochMs`. */
export function clockIn(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** The routine time: `delayMinutes` from now, rounded up to a whole minute. */
export function dutyTime(nowMs, delayMinutes, timeZone) {
  const atMs = Math.ceil((nowMs + delayMinutes * 60_000) / 60_000) * 60_000;
  return { atMs, clock: clockIn(atMs, timeZone) };
}

const tagValue = (event, name) => event.tags.find((tag) => tag[0] === name)?.[1];
const marked = (event, marker) =>
  event.tags.some((tag) => tag[0] === "client" && tag[1] === marker);

/** Messages the employee wrote in its channel since `sinceSec`, its hello left out. */
export function employeeMessages(events, { employee, channelId, sinceSec, helloMarker }) {
  return (events ?? []).filter(
    (event) =>
      event.kind === 9 &&
      event.pubkey === employee &&
      tagValue(event, "h") === channelId &&
      event.created_at >= sinceSec &&
      !marked(event, helloMarker),
  );
}

/** The hellos posted under a hire's marker. */
export function hellos(events, marker) {
  return (events ?? []).filter((event) => event.kind === 9 && marked(event, marker));
}

/** Relay-signed messages in the channel that tag the employee (wakes), in a time range. */
export function relayWakes(events, { relaySelf, employee, channelId, fromSec, toSec }) {
  return (events ?? []).filter(
    (event) =>
      event.kind === 9 &&
      event.pubkey === relaySelf &&
      tagValue(event, "h") === channelId &&
      event.tags.some((tag) => tag[0] === "p" && tag[1] === employee) &&
      event.created_at >= fromSec &&
      event.created_at <= toSec,
  );
}

/** Employee records in a host's agent store made for `hireId`. */
export function employeesForHire(store, hireId) {
  return (Array.isArray(store) ? store : []).filter(
    (record) => record?.pubkey && record?.role_context?.goalId === hireId,
  );
}

/** The hire journal entry for `hireId`. */
export function journalEntry(journal, hireId) {
  return journal?.entries?.find((entry) => entry.hireId === hireId) ?? null;
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd desktop && node --test tests/real-run/team-host/steps.test.mjs`
Expected: PASS, `# pass 6`, `# fail 0`.

- [ ] **Step 5: Relay calls and the host driver**

Create `desktop/tests/real-run/team-host/relay-api.mjs`:

```js
// Relay calls for the team host gate: email code sign-in, company creation,
// and signed events and queries with NIP-98 auth. Never logs a key.
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";

/** Keys from the `nsec` the code sign-in returns. */
export function keysFromNsec(nsec) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error("the sign-in returned no private key");
  return { secret: decoded.data, pubkey: getPublicKey(decoded.data), nsec };
}

/** `wss://host` to `https://host`. */
export const httpBase = (relayUrl) =>
  relayUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/+$/, "");

async function send(url, method, body, keys) {
  const headers = { "content-type": "application/json" };
  if (keys) {
    headers.authorization = await getToken(
      url,
      method,
      (template) => finalizeEvent(template, keys.secret),
      true,
      body,
    );
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`${method} ${new URL(url).pathname} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

/** Ask the relay to email a sign-in code. */
export const startEmailCode = (base, email) =>
  send(`${base}/api/accounts/code/start`, "POST", { email });

/** Exchange the code for the session (`{ account, nsec, created }`). */
export const verifyEmailCode = (base, input) =>
  send(`${base}/api/accounts/code/verify`, "POST", input);

/** Create a company (self-serve account mode). */
export async function createCompany(base, keys, slug) {
  const result = await send(`${base}/api/communities`, "POST", { name: slug }, keys);
  const host = result?.community?.normalized_host;
  if (!host) throw new Error("company creation returned no host");
  return { host, relayUrl: `wss://${host}` };
}

/** The relay's own key (NIP-11 `self`). */
export async function relaySelf(relayUrl) {
  const response = await fetch(httpBase(relayUrl), {
    headers: { accept: "application/nostr+json" },
  });
  const document = await response.json();
  if (!document?.self) throw new Error("the relay did not name its own key");
  return document.self;
}

/** Sign and submit one event as `keys`. */
export async function publish(relayUrl, keys, template) {
  const event = finalizeEvent(
    { created_at: Math.floor(Date.now() / 1000), ...template },
    keys.secret,
  );
  const result = await send(`${httpBase(relayUrl)}/events`, "POST", event, keys);
  if (!result?.accepted) throw new Error(`relay rejected event: ${result?.message}`);
  return { event, message: result.message };
}

/** NIP-01 filters over HTTP. */
export const query = (relayUrl, keys, filters) =>
  send(`${httpBase(relayUrl)}/query`, "POST", filters, keys);
```

Create `desktop/tests/real-run/team-host/host-driver.mjs`:

```js
// Starts and stops the packaged native host the way the apps do (NativeHost
// over the `@colony-native:` protocol). Each simulated computer is its own
// Electron profile, so it has its own app data folder and install id.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeHost } from "../../../electron/native-host.mjs";

/** A fresh profile id: 16 lowercase hex characters. */
export const newProfileId = () => randomBytes(8).toString("hex");

/** The host's app data folder for `identifier` and `profile`. */
export function appDataDir(identifier, profile, env = process.env, platform = process.platform) {
  const folder = `${identifier}.electron.${profile}`;
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", folder);
  }
  if (platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), folder);
  }
  return path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), folder);
}

/** Start one host. `nsec` is the signed-in person (no keychain is used). */
export async function startHost({ binary, profile, nsec, extraEnv = {} }) {
  const host = new NativeHost(binary, {
    env: {
      ...process.env,
      BUZZ_PRIVATE_KEY: nsec,
      COLONY_ELECTRON_PROFILE_ID: profile,
      COLONY_FIXTURE_ROLE_PACKS: "1",
      COLONY_TEAM_GATE: "1",
      ...extraEnv,
    },
    timeout: 60_000,
  });
  await host.ready;
  return {
    invoke: (command, args = {}) => host.request("invoke", { command, args }),
    /** Hard kill, like a crash or a power cut. */
    kill: async () => {
      host.child.kill("SIGKILL");
      await host.exited;
    },
    /** Normal quit: the host drains its employees. */
    close: () => host.close(),
  };
}

/** Read a JSON file the host wrote, or `null`. */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
```

Create `desktop/tests/real-run/team-host/.gitignore`:

```text
out/
```

- [ ] **Step 6: The gate**

Create `desktop/tests/real-run/team-host/gate.mjs`:

```js
#!/usr/bin/env node
// Phase 0 gate: the host runs the team by itself (plan part D, Task 4.15).
// A real relay, real AI, the packaged host and clean app data. Writes a JSON
// report. Read README.md first.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as api from "./relay-api.mjs";
import * as driver from "./host-driver.mjs";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  completeRows,
  createChannel,
  dutyTime,
  employeeMessages,
  employeesForHire,
  hellos,
  hireAction,
  hireProposal,
  journalEntry,
  profileAction,
  businessProfile,
  relayWakes,
  row,
  verdictOf,
} from "./steps.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TIME_ZONE = "Africa/Johannesburg";

function refuse(message) {
  console.error(`team-host gate: ${message}`);
  process.exit(2);
}

if (process.env.COLONY_REAL_RUN !== "1") refuse("set COLONY_REAL_RUN=1: this gate uses a real relay and real AI");
if (process.env.CI) refuse("the real-run gate never runs in CI");
const binary = process.env.COLONY_GATE_HOST_BINARY ?? refuse("set COLONY_GATE_HOST_BINARY");
const relayBase = (process.env.COLONY_GATE_RELAY_URL ?? refuse("set COLONY_GATE_RELAY_URL")).replace(/\/+$/, "");
const email = process.env.COLONY_GATE_EMAIL ?? refuse("set COLONY_GATE_EMAIL to a fresh address you can read");
const runtimeId = process.env.COLONY_GATE_RUNTIME ?? "claude";
const termsVersion = process.env.COLONY_GATE_TERMS_VERSION ?? "2026-10-11";
const dutyDelayMinutes = Number(process.env.COLONY_GATE_DUTY_DELAY_MINUTES ?? "40");
const identifier =
  process.env.COLONY_GATE_APP_IDENTIFIER ??
  JSON.parse(await readFile(path.join(here, "../../../src-tauri/tauri.conf.json"), "utf8")).identifier;

class NotObserved extends Error {}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function until(what, timeoutMs, probe, everyMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

const rows = [];
const context = {};
const startedAt = new Date().toISOString();

async function step(id, needs, run) {
  const blocked = needs.find((need) => rows.find((item) => item.id === need)?.status !== PASS);
  if (blocked) {
    rows.push(row(id, NOT_OBSERVED, `needs ${blocked}`, 0));
    return;
  }
  const started = Date.now();
  console.log(`team-host gate: ${id} ...`);
  try {
    rows.push(row(id, PASS, await run(), Date.now() - started));
  } catch (error) {
    const status = error instanceof NotObserved ? NOT_OBSERVED : FAIL;
    rows.push(row(id, status, String(error?.message ?? error), Date.now() - started));
  }
  console.log(`team-host gate: ${id} ${rows.at(-1).status}: ${rows.at(-1).detail}`);
}

const startA = () =>
  driver.startHost({
    binary,
    profile: context.profileA,
    nsec: context.owner.nsec,
    extraEnv: context.hostEnv,
  });

async function hireHead(hireId, accept) {
  return until(`hire ${hireId}`, 30_000, async () => {
    const [event] = await api.query(context.relayUrl, context.owner, [
      { kinds: [30650], authors: [context.relaySelf], "#d": [`company:hire:${hireId}`], limit: 1 },
    ]);
    if (!event) return null;
    const head = { ...JSON.parse(event.content), eventId: event.id };
    return accept(head) ? head : null;
  }, 2_000);
}

/** Create a conversation and an approved owner-direct hire for the fixture. */
async function approvedHire(host, displayName, channelName) {
  const channelId = randomUUID();
  await api.publish(context.relayUrl, context.owner, createChannel(channelId, channelName));
  const personas = await host.invoke("list_personas");
  const persona = personas.find((item) => item.id === "builtin:test-employee");
  if (!persona) throw new Error("the host has no Test Employee: COLONY_FIXTURE_ROLE_PACKS=1 did not reach it");
  const hireId = randomUUID();
  const proposal = hireProposal({ hireId, persona, displayName, channelId, runtimeId });
  await api.publish(context.relayUrl, context.owner, hireAction({ hireId, action: "create", proposal }));
  let head = await hireHead(hireId, (item) => Boolean(item.status));
  if (head.status !== "approved") {
    await api.publish(
      context.relayUrl,
      context.owner,
      hireAction({ hireId, action: "approve", expectedHeadEventId: head.eventId }),
    );
    head = await hireHead(hireId, (item) => item.status === "approved");
  }
  return {
    hireId,
    channelId,
    marker: `company-hire:${hireId}:introduction`,
    input: { relayUrl: context.relayUrl, hireId, personaId: persona.id, displayName, homeChannelId: channelId },
  };
}

async function channelMessages(channelId, sinceSec) {
  return api.query(context.relayUrl, context.owner, [
    { kinds: [9], "#h": [channelId], since: sinceSec, limit: 200 },
  ]);
}

async function answers(hire, sinceSec) {
  return employeeMessages(await channelMessages(hire.channelId, sinceSec), {
    employee: hire.employee,
    channelId: hire.channelId,
    sinceSec,
    helloMarker: hire.marker,
  });
}

try {
  await step("sign_in", [], async () => {
    const sent = await api.startEmailCode(relayBase, email);
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = (await prompt.question(`Code sent to ${email}: `)).trim();
    prompt.close();
    const session = await api.verifyEmailCode(relayBase, { email, code, termsVersion, displayName: "Gate Owner" });
    if (session?.created !== true) throw new Error("this email already had an account; use a fresh one");
    context.owner = api.keysFromNsec(session.nsec);
    return `new account ${context.owner.pubkey.slice(0, 8)}; resend allowed after ${sent.resendAfterSeconds} s`;
  });

  await step("create_company", ["sign_in"], async () => {
    const slug = process.env.COLONY_GATE_COMPANY_SLUG ?? `gate-${Date.now().toString(36)}`;
    const company = await api.createCompany(relayBase, context.owner, slug);
    context.relayUrl = company.relayUrl;
    context.relaySelf = await api.relaySelf(company.relayUrl);
    return `${slug} at ${company.host}`;
  });

  await step("set_profile", ["create_company"], async () => {
    const { message } = await api.publish(
      context.relayUrl,
      context.owner,
      profileAction(businessProfile(TIME_ZONE)),
    );
    const head = await until("the profile head", 30_000, async () => {
      const [event] = await api.query(context.relayUrl, context.owner, [
        { kinds: [30657], authors: [context.relaySelf], "#d": ["business-profile"], limit: 1 },
      ]);
      return event ?? null;
    }, 2_000);
    const zone = JSON.parse(head.content).timeZone;
    if (zone !== TIME_ZONE) throw new Error(`the profile head says ${zone}`);
    return `saved (${message}); time zone ${zone}`;
  });

  await step("claim", ["set_profile"], async () => {
    context.duty = dutyTime(Date.now(), dutyDelayMinutes, TIME_ZONE);
    context.profileA = driver.newProfileId();
    context.dataA = driver.appDataDir(identifier, context.profileA);
    context.hostEnv = {
      COLONY_FIXTURE_DUTY_TIME: context.duty.clock,
      COLONY_TEAM_GATE_HOLD_AFTER: "employee_created",
    };
    context.hostA = await startA();
    await context.hostA.invoke("team_set_companies", {
      companies: [{ relayUrl: context.relayUrl, ownerPubkey: context.owner.pubkey }],
    });
    const status = await until("this computer to hold the team", 60_000, async () => {
      const current = await context.hostA.invoke("team_claim_status", { relayUrl: context.relayUrl });
      return current?.isThisComputer ? current : null;
    }, 3_000);
    context.computerA = status.thisComputerId;
    return `held by ${status.holder.computerName}; daily note at ${context.duty.clock} ${TIME_ZONE}`;
  });

  await step("hire", ["claim"], async () => {
    const first = await approvedHire(context.hostA, "Gate Tester", "gate-one");
    first.sinceSec = Math.floor(Date.now() / 1000) - 5;
    const result = await context.hostA.invoke("team_hire_complete", { input: first.input });
    if (result?.state !== "started") throw new Error(`the hire answered ${JSON.stringify(result)}`);
    first.employee = result.agentPubkey;
    context.first = first;
    const posted = hellos(await channelMessages(first.channelId, first.sinceSec), first.marker);
    if (posted.length !== 1) throw new Error(`${posted.length} hellos`);
    return `employee ${first.employee.slice(0, 8)} hired, said hello and started`;
  });

  await step("kickoff_answer", ["hire"], async () => {
    const begun = Date.now();
    const found = await until("the answer to the kickoff", 5 * 60_000, async () => {
      const list = await answers(context.first, context.first.sinceSec);
      return list.length > 0 ? list : null;
    }, 10_000);
    return `answered after ${Math.round((Date.now() - begun) / 1000)} s: "${found[0].content.slice(0, 80)}"`;
  });

  await step("interrupted_hire", ["hire"], async () => {
    const second = await approvedHire(context.hostA, "Gate Tester Two", "gate-two");
    second.sinceSec = Math.floor(Date.now() / 1000) - 5;
    context.second = second;
    const journalFile = path.join(context.dataA, "team", "hire-journal.json");
    const pending = context.hostA
      .invoke("team_hire_complete", { input: second.input })
      .catch((error) => error);
    await until("the employee to be created", 120_000, async () =>
      journalEntry(await driver.readJson(journalFile), second.hireId)?.step === "employee_created", 1_000);
    await context.hostA.kill();
    await pending;
    context.hostA = await startA();
    await until("the hire to finish by itself", 180_000, async () =>
      journalEntry(await driver.readJson(journalFile), second.hireId)?.step === "started", 3_000);
    const again = await context.hostA.invoke("team_hire_complete", { input: second.input });
    if (again?.state !== "already_complete") throw new Error(`a second call answered ${JSON.stringify(again)}`);
    second.employee = again.agentPubkey;
    const store = await driver.readJson(path.join(context.dataA, "agents", "managed-agents.json"));
    const made = employeesForHire(store, second.hireId).length;
    const posted = hellos(await channelMessages(second.channelId, second.sinceSec), second.marker).length;
    const head = await hireHead(second.hireId, (item) => item.status === "hired");
    if (made !== 1 || posted !== 1 || head.employeePubkey !== second.employee) {
      throw new Error(`${made} employees, ${posted} hellos, hired employee ${head.employeePubkey}`);
    }
    return "killed after the employee was created; restarted: one employee, one hello, one Complete";
  });

  await step("no_interface", ["interrupted_hire"], async () => {
    await context.hostA.kill();
    context.hostA = await startA();
    // From here on the gate only reads `team_status`: nothing is saved, opened or started.
    const employees = [context.first.employee, context.second.employee];
    const list = await until("both employees to run", 120_000, async () => {
      const statuses = await context.hostA.invoke("team_status", { relayUrl: context.relayUrl });
      const running = statuses.filter(
        (status) => employees.includes(status.agentPubkey) && status.state === "running",
      );
      return running.length === employees.length ? statuses : null;
    }, 5_000);
    return list.map((status) => `${status.name} ${status.state}`).join(", ");
  });

  await step("missed_routine", ["no_interface"], async () => {
    const hires = [context.first, context.second];
    // The second employee answers its own kickoff before the stop, so the
    // only message after the restart is the daily note.
    await until("the second employee's kickoff answer", 5 * 60_000, async () =>
      (await answers(context.second, context.second.sinceSec)).length > 0, 10_000);
    const { atMs, clock } = context.duty;
    if (Date.now() > atMs - 10 * 60_000) {
      throw new NotObserved(`the routine at ${clock} came too soon; raise COLONY_GATE_DUTY_DELAY_MINUTES`);
    }
    await sleep(atMs - 10 * 60_000 - Date.now());
    await context.hostA.close();
    await sleep(atMs + 10 * 60_000 - Date.now());
    const restartedSec = Math.floor(Date.now() / 1000);
    context.hostA = await startA();
    const count = async () =>
      Promise.all(hires.map(async (hire) => (await answers(hire, restartedSec)).length));
    await until("one daily note from each employee", 10 * 60_000, async () =>
      (await count()).every((notes) => notes >= 1), 15_000);
    await sleep(2 * 60_000);
    const settled = await count();
    if (settled.some((notes) => notes !== 1)) {
      throw new Error(`notes after the restart: ${settled.join(", ")}; each must be exactly 1`);
    }
    const wakeSec = Math.floor(atMs / 1000);
    const wakes = await Promise.all(
      hires.map(async (hire) =>
        relayWakes(await channelMessages(hire.channelId, wakeSec - 60), {
          relaySelf: context.relaySelf,
          employee: hire.employee,
          channelId: hire.channelId,
          fromSec: wakeSec - 60,
          toSec: wakeSec + 120,
        }).length),
    );
    return `stopped from 10 minutes before ${clock} to 10 minutes after; one note each; relay wakes seen near ${clock}: ${wakes.join(", ")}`;
  });

  await step("second_computer", ["claim"], async () => {
    const hostB = await driver.startHost({
      binary,
      profile: driver.newProfileId(),
      nsec: context.owner.nsec,
      extraEnv: context.hostEnv,
    });
    try {
      await hostB.invoke("team_set_companies", {
        companies: [{ relayUrl: context.relayUrl, ownerPubkey: context.owner.pubkey }],
      });
      const status = await until("the second computer to read the record", 60_000, async () => {
        const current = await hostB.invoke("team_claim_status", { relayUrl: context.relayUrl });
        return current?.holder ? current : null;
      }, 3_000);
      if (status.isThisComputer || status.holder.computerId !== context.computerA) {
        throw new Error(`the record names ${status.holder.computerId}, not the first computer`);
      }
      const third = await approvedHire(hostB, "Gate Tester Three", "gate-three");
      const refused = await hostB
        .invoke("team_hire_complete", { input: third.input })
        .then((result) => `not refused: ${JSON.stringify(result)}`, (error) => String(error));
      if (!refused.includes("Your team runs on")) throw new Error(refused);
      const statusesB = await hostB.invoke("team_status", { relayUrl: context.relayUrl });
      if (statusesB.some((item) => item.state !== "away")) throw new Error("the second computer runs an employee");
      const statusesA = await context.hostA.invoke("team_status", { relayUrl: context.relayUrl });
      if (statusesA.some((item) => item.state !== "running")) throw new Error("the first computer stopped its team");
      return `the record still names the first computer; the second refused: "${refused}"`;
    } finally {
      await hostB.close().catch(() => {});
    }
  });
} finally {
  await context.hostA?.close().catch(() => {});
}

const steps = completeRows(rows);
const report = {
  gate: "phase-0-team-host",
  startedAt,
  finishedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  hostBinary: path.basename(binary),
  relay: context.relayUrl ?? null,
  timeZone: TIME_ZONE,
  runtime: runtimeId,
  steps,
  verdict: verdictOf(steps),
};
const out = process.env.COLONY_GATE_REPORT ?? path.join(here, "out", `report-${Date.now()}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`team-host gate: ${report.verdict}; report at ${out}`);
process.exit(report.verdict === "PASS" ? 0 : 1);
```

- [ ] **Step 7: The README and proof checklist**

Create `desktop/tests/real-run/team-host/README.md`:

````markdown
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

- A packaged host binary built without the keychain features, so nothing
  prompts: `cargo build --release --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --features electron-host`
  (the binary is `desktop/src-tauri/target/release/colony-native-host`, with
  `.exe` on Windows).
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
COLONY_GATE_HOST_BINARY="$PWD/src-tauri/target/release/colony-native-host" \
COLONY_GATE_RELAY_URL=https://<relay host> \
COLONY_GATE_EMAIL=<fresh address> \
node tests/real-run/team-host/gate.mjs
```

Windows (PowerShell):

```powershell
cd desktop
$env:COLONY_REAL_RUN = "1"
$env:COLONY_GATE_HOST_BINARY = "$PWD\src-tauri\target\release\colony-native-host.exe"
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
````

- [ ] **Step 8: Check the scripts load and the unit tests pass**

Run: `cd desktop && node --check tests/real-run/team-host/gate.mjs && node --check tests/real-run/team-host/relay-api.mjs && node --check tests/real-run/team-host/host-driver.mjs && node --test tests/real-run/team-host/steps.test.mjs`
Expected: no output from the three checks, then `# pass 6`, `# fail 0`.

Run: `cd desktop && COLONY_REAL_RUN= node tests/real-run/team-host/gate.mjs; echo "exit $?"`
Expected: `team-host gate: set COLONY_REAL_RUN=1: this gate uses a real relay and real AI` and `exit 2`.

- [ ] **Step 9: Commit**

```bash
git add desktop/tests/real-run/team-host desktop/package.json
git commit -s -m "test(desktop): phase 0 real-run gate for the team host"
```

The live run (Mac and Windows) happens after the part's PR is merged into `develop` and a host is built from it; its two reports are the phase 0 proof.

---

### Task 4.16: Verify the whole part

**Files:** none changed unless a check fails.

- [ ] **Step 1: Formatting and lints**

Run: `cd desktop/src-tauri && cargo fmt --check && cargo clippy --no-default-features --features electron-host --lib --tests -- -D warnings`
Expected: no output from `fmt`; clippy finishes with no warnings (every item added in Tasks 4.3 to 4.14 is used by the end of Task 4.14).

- [ ] **Step 2: The desktop lib tests this part touches**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents commands::agents)`
Expected: PASS, 0 failed.

- [ ] **Step 3: Node tests**

Run: `cd desktop && node --test electron/native-host.test.mjs tests/real-run/team-host/steps.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 4: File sizes, em dashes and product names**

Run: `cd desktop && node scripts/file-size-policy.mjs`
Expected: exit 0 (every new file is under 1500 lines; `discovery/tests.rs` shrank).

Run: `git diff origin/develop...HEAD -- desktop | grep '^+' | perl -CSD -ne '$n++ if /\x{2014}/; END { print $n + 0, "\n" }'`
Expected: `0` (no em dash added anywhere).

Run: `git diff origin/develop...HEAD -- desktop/src-tauri/src/managed_agents/team_runner desktop/src-tauri/src/managed_agents/credits_pause.rs desktop/tests/real-run/team-host | grep '^+' | grep -v 'buzz_\|buzz-\|BUZZ_\|builtin:' | grep -ci 'buzz\|fizz\|honey'`
Expected: `0` (crate and environment names are code, not words people see).

- [ ] **Step 5: Push and open the PR into `develop`**

```bash
git push -u origin HEAD
```

Open the PR into `develop` with the commits of Tasks 4.1 to 4.15. GitHub CI is the gate; never merge to `main`.

---

## Contract changes

1. **`HireCompleteInput.time_zone` is accepted and ignored** (coordinator). The host sends `HireAction.time_zone` on `complete` from the business profile head's `timeZone` (kind 30657, `d` = `business-profile`), falls back to this computer's IANA zone only when no profile head exists, and to `UTC` when that is not a valid label. The zone is fixed once per hire in the journal, so a resumed hire sends the same one.
2. **The owner joins the home channel before `complete`** (coordinator). New journal step `owner_in_channel`: when the relay-signed membership snapshot (kind 39002) does not list the owner, the host adds them (kind 9000, no role). It never re-adds a member, so an owner or admin role is never downgraded. The same check guards adding the employee as `bot`.
3. **Team computer, host side** (part A). The host claims at every start without asking first (a claim from the current holder only refreshes its name and time), which replaces the overview's "claim if none exists". It heartbeats every 2 minutes (`HEARTBEAT_EVERY_SECS = 120`), ignores a `rate-limited:` refusal, and on a `restricted:` or `conflict:` heartbeat refusal re-reads the record and stands the team down when another computer holds it. A head with `releasedAt` names no computer. Heads must be relay-signed and are read leniently (unknown keys ignored). Actions are built with `buzz_sdk::team_computer::build_team_computer_action` (one `d` tag, no `h` tag). The record is released only when a company is removed from this computer.
4. **Pause reasons** (part I and part H). `PauseReason { Person, Credits, PlanLimit }`, on the wire `"person" | "credits" | "plan_limit"`, lives in `team_runner.rs`. `EmployeeRuntimeStatus` gains `pause_reason` (bridge `pauseReason`), present only when `state` is `paused`, showing credits first, then the plan limit, then a person. The overview's persisted `paused: true` becomes the persisted set `pauseReasons` in `team-companies.json`; a team runs only when no reason remains. `pause_company(app, relay_url, reason)` and `resume_company(app, relay_url, reason)` are async and take the app handle (needed to stop and start pairs); `team_pause` and `team_resume` use `Person`. Part I's plan file still names the reason `PauseReason::CreditsOut` with `"credits_out"` in places; it must use `PauseReason::Credits` and `"credits"`. The problem kind stays `credits_out`.
5. **Credits seam** (part I, the coordinator's final version). `crate::managed_agents::credits_pause` is a stub with exactly part I's signatures: `ExitHandling { PausedForCredits, RestartNow, Crash }`, `on_harness_exit(app, relay_url, agent_pubkey, code) -> ExitHandling` (stub `Crash`), `is_paused_for_credits(app, relay_url) -> bool` (stub `false`), `ensure_watcher(app, relay_url)` (stub no-op), `resume_if_funded(app, relay_url) -> Result<bool, String>` (stub `Ok(false)`). The supervisor calls `on_harness_exit` for every unexpected exit before the crash policy and counts only `Crash`; start on launch skips and watches a credits pause; `team_resume` asks `resume_if_funded` first (`Ok(true)` ends it). Mapping exit codes 75 and 77 to `PausedForCredits` or `RestartNow` is part I's body; before part I no harness exits with those codes. The earlier `on_credits_exit` sketch is dropped.
6. **First-start replay floor** (part C). A new hire's first start sets `BUZZ_ACP_REPLAY_FLOOR` to the Unix time captured just before `complete` (journal `replayFloor`), through the new `start_managed_agent_runtime_pair_with_floor`.
7. **Scope of the employee environment** (part C). `COLONY_WAKE_LEDGER` (`<app data>/agents/<pubkey>/wake-ledger.json`) and `COLONY_TEAM_COMPUTER_ID` are set only for a spawn on a saved company's relay, so agents of the old app keep today's behaviour. `COLONY_ROLE_CONTEXT` is set for any record that has a role context. All three are reserved environment keys, and an unset key is removed rather than inherited.
8. **`disk_full` problem** (part C, screen X-21). `ProblemKind` gains `disk_full`, raised when an employee's log gains `wake ledger could not be saved`, at most once per employee every ten minutes, with the detail "This computer is almost out of space, so {name} is waiting."
9. **Module path.** The host module is `crate::managed_agents::team_runner` (the path part I imports), with the commands in `team_runner::commands`.
10. **One company per computer in phase 0.** The host runs the first saved company owned by the signed-in identity. It opens that company's relay itself (the new app never calls `apply_workspace`) and never replaces a different open relay.
11. **Pause and resume only on the team computer.** Pause gives each harness 35 seconds to finish its turn (the harness drains for 30), and is immediate on Windows. `team_resume` answers in plain words when another reason still holds the team.
12. **States.** `away` means another computer holds the record; `starting` also covers an employee waiting for a restart.
13. **`team_hire_complete` preconditions.** The company's relay is open (or nothing is open), this computer runs the team, and the team is not paused. The hire head must still match the persona, name and channel; only the founder who approved the hire can finish it. One hire runs at a time.
14. **`team_set_companies`** stops a removed company's team and releases its record before it saves the new list; offline, it fails and saves nothing, so a retry sees the same removal.
15. **Gate-only environment:** `COLONY_FIXTURE_ROLE_PACKS=1`, `COLONY_FIXTURE_DUTY_TIME`, `COLONY_TEAM_GATE=1`, `COLONY_TEAM_GATE_HOLD_AFTER=employee_created`.
16. **Old shell deadlines** match part E's new app: `team_hire_complete` 5 minutes, `team_restart_all` 3 minutes.
17. **Part G names** are provided as part G assumes: `BuiltInPersona.company_role: Option<fn() -> CompanyRoleMetadata>`, refreshed by `merge_personas`, and every launch persona starts with `company_role: None`.

## Self-review

- **Spec coverage.** Saved companies and start on launch without `apply_workspace`: 4.3, 4.9. Install id, claim at every start, heartbeat every 2 minutes, release, refusal without the claim: 4.3, 4.4, 4.6, 4.9, 4.12. Journaled `team_hire_complete` with the owner-in-channel step and the profile time zone: 4.10, 4.11, 4.12. Restart with backoff, crash loop, credits exits through the seam, restart commands: 4.7, 4.8, 4.12. Pause and resume with persisted reasons, `pause_reason`, `team_status`, both events including `disk_full`: 4.8, 4.9, 4.12. `company_role` round trip and `role_context`: 4.1, 4.2. Employee environment, reserved keys and the first-start replay floor: 4.5. Built-in company roles with merge refresh and the Test Employee: 4.13. Voice rules and `NEST_SKILL_VERSION` 9: 4.14. Registration for both shells: 4.12. The real-run gate with a JSON report and proof checklist: 4.15. Overview review focus 1 and 2 are pinned by named tests and gate steps.
- **Placeholder scan.** Every step has real code or an exact command. No step says "TBD", "similar to" or "handle errors". The coordinator's earlier `on_credits_exit` sketch was replaced by the final seam before any task used it.
- **Type consistency.** `TeamCompany`, `TeamComputerStatus`, `TeamComputerInfo`, `EmployeeRuntimeStatus`, `EmployeeState`, `PauseReason`, `ProblemKind`, `EmployeeProblem` (4.3); `ClaimView`, `TeamSpawn`, `SpawnClearance` (4.4); `EmployeeEnv`, `EmployeeEnvApplied` (4.5); `ExitHandling`, `SupervisorBook`, `DownDecision`, `Settled` (4.7); `HireStep`, `HireJournalEntry`, `HireIo`, `HireView`, `HireCompleteInput`, `HireCompleteResult`, `HireCompleteState` (4.10); `RelayHireIo` (4.11) are each defined once and used with the same names and fields. Wire names follow the overview (`relayUrl`, `ownerPubkey`, `thisComputerId`, `isThisComputer`, `computerId`, `computerName`, `lastSeenAt`, `agentPubkey`, `restartsInWindow`, `pauseReason`, `hireId`, `personaId`, `displayName`, `homeChannelId`, `state`).
- **Biggest risk.** Employee keys and records are local to the computer that hired them. The fence keeps a second computer from running anything, but a forced move (`team_claim` with `force`) moves the record while the employees stay behind, so the new computer has no one to run and the old one stands down. The gate proves the refusal, not a move. A second risk: a killed host can leave a harness alive until the next start's sweeps; gate steps 7 to 9 count messages, so a double answer would show there.
- **Other risks.** Part C clamps the replay floor to 15 minutes, so a hire whose start is delayed more than 15 minutes after `complete` (a host killed between the two) misses the kickoff replay; the gate's interruption point is before `complete`. Pause depends on the harness draining on `SIGTERM`. If the old app applies a different workspace in the same host, the team runner refuses to switch the open relay and reports it.
- **Not verified while planning** (the executor's first compile or test shows any drift): the plan was written without building. Part A, B and C names come from their plan files as of 11 October 2026; `CreateManagedAgentRequest` field names come from `types/requests.rs`; the nostr 0.44 calls (`Tag::as_slice`, `Tag::content`, `Event::verify`, `EventBuilder::custom_created_at`) and `tauri::test::mock_builder().manage(...)` follow existing desktop code; `list_personas` serializes `AgentDefinition` in snake case; the shape of a relay routine wake is only reported by the gate, never required; the hire status right after an owner-direct `create` is handled whether or not it is already `approved`.
