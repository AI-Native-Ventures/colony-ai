# Part 3: Desktop Rust (Tauri)

Writer 3 of 5. Slice: `desktop/src-tauri` only. Spec: `docs/superpowers/specs/2026-10-11-ai-employees-shared-base-design.md` (Phase 1). Contract: `00-brief.md`.

## Before you start

- Parts 1 and 2 are already on this branch. This part consumes, and only consumes:
  - Part 1: `buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire, RoleWorkFolder}` and the v2 rules in `validate_hire_proposal` (the desktop crate depends on buzz-core as `buzz_core_pkg`, `desktop/src-tauri/Cargo.toml:116`, so the desktop reuses the core types instead of mirroring them).
  - Part 2: `crates/buzz-acp/src/voice.md` and `buzz_acp::VOICE_RULES` (`buzz-acp` is a desktop dependency, `desktop/src-tauri/Cargo.toml:82`).
- Test command used in every task (run from the worktree root). It is the `just desktop-tauri-test` form: `--no-default-features` keeps the OS keychain out of tests.

```bash
just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib <filter>)
```

- No em dashes (U+2014) in anything you write. Several existing comments in the files below contain them; leave those lines alone. Every edit anchor in this plan avoids them.
- File-size ratchet: desktop Rust files are capped at 1500 lines (`desktop/scripts/file-size-policy.mjs:3`), and a file already over the cap may not grow. `src/managed_agents/discovery/tests.rs` is 1756 lines, so Task 3.2 shrinks it instead of adding to it.
- Commit with `git commit -s`. Each task ends with one commit.

## File map

| File | Tasks |
|-|-|
| `src/managed_agents/types.rs` | 3.1, 3.2, 3.4 |
| `src/managed_agents/types/company_role_tests.rs` (new) | 3.1 |
| `src/managed_agents/types/role_context.rs` (new) | 3.2, 3.4 |
| `src/managed_agents/types/tests.rs` | 3.1, 3.2, 3.4 |
| `src/managed_agents/types/requests.rs` | 3.4 |
| 26 files with `ManagedAgentRecord { .. }` literals (script) and `src/managed_agents/discovery/tests.rs` | 3.2 |
| `src/managed_agents/personas.rs`, `src/managed_agents/personas/tests.rs`, `src/managed_agents/nest/brand_guard_tests.rs` | 3.3 |
| `src/commands/agents.rs` | 3.4 |
| `src/managed_agents/runtime/employee_launch.rs` (new), `src/managed_agents/runtime.rs`, `src/managed_agents/reserved_env_keys.rs` | 3.5, 3.6 |
| `src/managed_agents/spawn_snapshot.rs`, `src/managed_agents/spawn_snapshot/diff.rs`, `src/managed_agents/spawn_snapshot/diff/tests.rs`, `src/managed_agents/spawn_snapshot/tests_ext.rs` | 3.6 |
| `src/managed_agents/nest.rs`, `src/managed_agents/nest_skill.md`, `src/managed_agents/nest/voice_rules_tests.rs` (new) | 3.7 |

All paths below are relative to `desktop/src-tauri/` unless they start with `desktop/` or `crates/`.

---

### Task 3.1: Company role v2 fields and validator

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/types.rs:1-2` (re-export the core types)
- Modify: `desktop/src-tauri/src/managed_agents/types.rs:21-32` (`CompanyRoleMetadata`)
- Modify: `desktop/src-tauri/src/managed_agents/types.rs:72-80` (tail of `validate_company_role_metadata`)
- Modify: `desktop/src-tauri/src/managed_agents/types.rs:1082-1083` (register the test module)
- Modify: `desktop/src-tauri/src/managed_agents/types/tests.rs:104-113` (the one existing `CompanyRoleMetadata` literal)
- Create: `desktop/src-tauri/src/managed_agents/types/company_role_tests.rs`
- Test: `desktop/src-tauri/src/managed_agents/types/company_role_tests.rs`

**Interfaces:**
- Consumes: Part 1 `buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire, RoleWorkFolder, HireProposal, validate_hire_proposal}`; existing `buzz_core_pkg::company_duties::parse_readable_schedule(&str) -> Option<String>` (`crates/buzz-core/src/company_duties.rs:242`) and `buzz_core_pkg::company_records::is_decimal`.
- Produces: `CompanyRoleMetadata` gains `owns: Option<String>`, `channel: Option<String>`, `duties: Vec<RoleDutyTemplate>`, `on_hire: Option<RoleOnHire>`, `ask_before: Vec<String>`, `home: Option<String>`, `work_folder: Option<RoleWorkFolder>` (camelCase keys `owns`, `channel`, `duties`, `onHire`, `askBefore`, `home`, `workFolder`, each omitted when empty so v1 roles keep their bytes). `crate::managed_agents::{RoleDutyTemplate, RoleOnHire, RoleWorkFolder}` (re-exported core types). `validate_company_role_metadata` enforces the v2 rules with errors that name the field. Private helper `role_text_within(text: &str, max: usize) -> bool` in `types.rs` (Task 3.4 reuses it).

- [ ] **Step 1: Write the failing test**

Create `desktop/src-tauri/src/managed_agents/types/company_role_tests.rs`:

```rust
//! Role pack v2 on the desktop company role: the camelCase wire shape the
//! hire flow copies into a proposal, its bounds, and parity with the core
//! hire validator the relay runs on that same role pack.

use super::{
    validate_company_role_metadata, CompanyRoleMetadata, CompanyRoleTool, CompanyToolRisk,
    RoleDutyTemplate, RoleOnHire, RoleWorkFolder,
};
use serde_json::json;

fn v2_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Fix bugs and ship roadmap items".to_string(),
        skills: vec!["Debugging".to_string()],
        tools: vec![CompanyRoleTool {
            name: "git".to_string(),
            risk: CompanyToolRisk::Medium,
        }],
        worker_menu: vec!["claude".to_string(), "codex".to_string()],
        default_allowance: Some("25".to_string()),
        owns: Some("Ship fixes and roadmap items every week".to_string()),
        channel: Some("engineering".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Bug triage".to_string(),
            schedule_text: "Every day at 09:00".to_string(),
            instructions: "Triage new bugs and open issues.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["code folder".to_string(), "open issues".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["merge".to_string(), "deploy".to_string()],
        home: Some("engineer.prs".to_string()),
        work_folder: Some(RoleWorkFolder::Required),
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
        ("channel", |role| role.channel = Some("Engineering".to_string())),
        ("channel", |role| role.channel = Some("eng room".to_string())),
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
        "job": "Fix bugs",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"],
        "owns": "Ship fixes",
        "channel": "engineering",
        "duties": [{
            "title": "Bug triage",
            "scheduleText": "Every day at 09:00",
            "instructions": "Triage new bugs."
        }],
        "onHire": { "sources": ["code folder"] },
        "askBefore": ["merge"],
        "home": "engineer.prs",
        "workFolder": "required"
    }))
    .expect("a v2 role from the hire flow parses");
    assert_eq!(role.duties[0].schedule_text, "Every day at 09:00");
    assert_eq!(
        role.on_hire.as_ref().map(|on_hire| on_hire.plan_horizon_days),
        Some(14),
        "the plan horizon defaults to 14 days"
    );
    assert_eq!(role.work_folder, Some(RoleWorkFolder::Required));
    validate_company_role_metadata(&role).expect("the v2 role is valid");

    // A role written before v2 parses and serializes byte for byte, so stored
    // roles and persona events without the new keys do not change.
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

/// The hire flow copies a persona's company role into the proposal's role
/// pack and the relay validates it with buzz-core. Every role the desktop
/// accepts must be a pack core accepts, and every v2 rule the desktop
/// enforces must be one core enforces too.
#[test]
fn desktop_role_rules_match_the_core_hire_validator() {
    fn core_accepts(role: &CompanyRoleMetadata) -> bool {
        let mut pack = serde_json::to_value(role).expect("role serializes");
        pack["personaId"] = json!("custom:engineer");
        pack["title"] = json!("Engineer");
        let proposal = json!({
            "hireId": "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10",
            "rolePack": pack,
            "displayName": "Ada",
            "title": "Engineer",
            "introductionChannelId": "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c",
            "runtimeId": "claude"
        });
        serde_json::from_value::<buzz_core_pkg::company_records::HireProposal>(proposal)
            .is_ok_and(|proposal| {
                buzz_core_pkg::company_records::validate_hire_proposal(&proposal).is_ok()
            })
    }

    assert!(
        core_accepts(&v2_role()),
        "a valid desktop role must be a valid core role pack"
    );
    for (rule, mutate) in invalid_v2_mutations() {
        let mut role = v2_role();
        mutate(&mut role);
        assert!(
            validate_company_role_metadata(&role).is_err(),
            "desktop must reject {rule}"
        );
        assert!(!core_accepts(&role), "core must reject {rule} too");
    }
}
```

Register it in `desktop/src-tauri/src/managed_agents/types.rs` (lines 1082-1083). Replace:

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
Expected: FAIL to compile with `error[E0432]: unresolved imports super::RoleDutyTemplate, super::RoleOnHire, super::RoleWorkFolder` and `error[E0560]: struct CompanyRoleMetadata has no field named owns`.

- [ ] **Step 3: Implement**

In `desktop/src-tauri/src/managed_agents/types.rs`, replace lines 1-2:

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
pub use buzz_core_pkg::company_records::{RoleDutyTemplate, RoleOnHire, RoleWorkFolder};
```

Replace the struct at lines 21-32:

```rust
/// Non-authoritative company role metadata stored on a real persona catalog entry.
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
}
```

with:

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
    /// Default duties, approved by the founder's hire signature.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub duties: Vec<RoleDutyTemplate>,
    /// What a new employee studies first and how long its first plan covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_hire: Option<RoleOnHire>,
    /// Actions that always need the founder.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ask_before: Vec<String>,
    /// The role's native screen id, such as `engineer.prs`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    /// Whether the role needs a working folder on the founder's computer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_folder: Option<RoleWorkFolder>,
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
/// which the relay runs on the role pack the hire flow copies from this role.
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

In `desktop/src-tauri/src/managed_agents/types/tests.rs`, the existing literal (lines 104-113) gains the new fields. Replace:

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
        work_folder: None,
    };
    assert!(validate_company_role_metadata(&valid).is_ok());
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::types)`
Expected: PASS (the three `company_role_tests` tests and every existing `managed_agents::types` test ok, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/types.rs desktop/src-tauri/src/managed_agents/types/company_role_tests.rs desktop/src-tauri/src/managed_agents/types/tests.rs
git commit -s -m "feat(desktop): add role pack v2 fields to company role metadata"
```

---

### Task 3.2: Persist the persona company role, add role context and work folder to agent records

The bug: `ManagedAgentRecord` (`types.rs:319-573`) has no `company_role`, so `into_agent_record` (`types.rs:197-259`) drops it and `to_definition_view` sets `None` (`types.rs:270`). `save_personas` (`personas.rs:451-465`) folds every persona through `into_agent_record`, and `load_personas` (`personas.rs:399-419`) reads them back through `to_definition_view`, so a persona's role is lost on every save and reload. This task adds `company_role` and, in the same pass over the 26 record literals, the two employee fields `role_context` and `work_dir` that Tasks 3.4 to 3.6 use (adding them later would touch every literal twice).

**Files:**
- Create: `desktop/src-tauri/src/managed_agents/types/role_context.rs`
- Modify: `desktop/src-tauri/src/managed_agents/types.rs:254-259` (`into_agent_record` tail), `:268-270` (`to_definition_view`), `:571-575` (record fields), `:906-908` (deserializer helper), `:1079-1080` (module)
- Modify: the 26 files the Step 6 script prints (each gets three `None` fields in its `ManagedAgentRecord` literal)
- Modify: `desktop/src-tauri/src/managed_agents/discovery/tests.rs:207-273` (fixture rebuilt from JSON; the file is over the 1500-line cap and may not grow)
- Test: `desktop/src-tauri/src/managed_agents/types/tests.rs` (append at the end)

**Interfaces:**
- Consumes: Task 3.1 `CompanyRoleMetadata` (v2).
- Produces: `crate::managed_agents::RoleContext { title: String, job: String, owns: Option<String>, ask_before: Vec<String>, manager_name: Option<String>, home_channel_id: Option<String>, goal_id: Option<String>, on_hire_sources: Vec<String>, plan_horizon_days: u8 }` with `#[serde(rename_all = "camelCase")]`, every key always serialized (`null` or `[]` when empty), missing optional keys tolerated on load, `planHorizonDays` defaulting to 14. `ManagedAgentRecord.company_role: Option<CompanyRoleMetadata>`, `.role_context: Option<RoleContext>`, `.work_dir: Option<String>` (snake_case record keys, omitted when `None`; an unreadable stored role or role context degrades to `None` instead of failing the whole store). `into_agent_record` and `to_definition_view` carry `company_role`.

- [ ] **Step 1: Write the failing test**

Append to the end of `desktop/src-tauri/src/managed_agents/types/tests.rs`, after the last test (`summary_with_drift_serializes_restart_diff_entries`, whose last lines are):

```rust
            "change": { "kind": "value", "before": "gpt-5", "after": "claude-4" },
        }]))
    );
}
```

Append:

```rust

// Hire fields on the unified agent store.

fn engineer_role() -> CompanyRoleMetadata {
    serde_json::from_value(serde_json::json!({
        "job": "Fix bugs and ship roadmap items",
        "skills": ["Debugging"],
        "tools": [{ "name": "git", "risk": "medium" }],
        "workerMenu": ["claude", "codex"],
        "defaultAllowance": "25",
        "owns": "Ship fixes and roadmap items every week",
        "channel": "engineering",
        "duties": [{
            "title": "Bug triage",
            "scheduleText": "Every day at 09:00",
            "instructions": "Triage new bugs."
        }],
        "onHire": { "sources": ["code folder", "open issues"], "planHorizonDays": 14 },
        "askBefore": ["merge", "deploy"],
        "home": "engineer.prs",
        "workFolder": "required"
    }))
    .expect("engineer role parses")
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
    persona.company_role = Some(engineer_role());

    let stored = store_round_trip(&[persona.clone().into_agent_record()]);
    let view = stored[0]
        .to_definition_view()
        .expect("slugged record must present a persona view");

    assert_eq!(view.company_role, persona.company_role);
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib persona_company_role_survives_the_agent_store_round_trip)`
Expected: FAIL with "assertion `left == right` failed" where `left: None` and `right: Some(CompanyRoleMetadata { job: "Fix bugs and ship roadmap items", ... })`. This is the save and reload bug.

- [ ] **Step 3: Write the record field tests**

Append to the end of `desktop/src-tauri/src/managed_agents/types/tests.rs`, after the test from Step 1:

```rust

use super::RoleContext;

fn engineer_context() -> RoleContext {
    RoleContext {
        title: "Engineer".to_string(),
        job: "Fix bugs and ship roadmap items".to_string(),
        owns: Some("Ship fixes and roadmap items every week".to_string()),
        ask_before: vec!["merge".to_string(), "deploy".to_string()],
        manager_name: Some("Sam".to_string()),
        home_channel_id: Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c".to_string()),
        goal_id: Some("6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10".to_string()),
        on_hire_sources: vec!["code folder".to_string()],
        plan_horizon_days: 14,
    }
}

#[test]
fn legacy_agent_store_record_loads_without_hire_fields_and_writes_none() {
    let record = sample_agent_record();
    assert_eq!(record.company_role, None);
    assert_eq!(record.role_context, None);
    assert_eq!(record.work_dir, None);
    let json = serde_json::to_string(&record).expect("record serializes");
    for key in ["company_role", "role_context", "work_dir"] {
        assert!(
            !json.contains(key),
            "absent {key} must stay absent on disk: {json}"
        );
    }
}

#[test]
fn hired_employee_fields_survive_the_agent_store_round_trip() {
    let mut record = sample_agent_record();
    record.role_context = Some(engineer_context());
    record.work_dir = Some("/Users/sam/code/app".to_string());

    let stored = store_round_trip(std::slice::from_ref(&record));
    assert_eq!(stored[0], record);

    let json = serde_json::to_value(&record).expect("record serializes");
    assert_eq!(
        json["role_context"]["askBefore"],
        serde_json::json!(["merge", "deploy"]),
        "the stored role context uses the camelCase shape the harness reads"
    );
    assert_eq!(json["role_context"]["goalId"], "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10");
    assert_eq!(json["work_dir"], "/Users/sam/code/app");
}

#[test]
fn role_context_serializes_every_key_and_loads_without_optional_ones() {
    let mut context = engineer_context();
    context.owns = None;
    context.ask_before = Vec::new();
    let json = serde_json::to_value(&context).expect("role context serializes");
    assert_eq!(json["owns"], serde_json::Value::Null);
    assert_eq!(json["askBefore"], serde_json::json!([]));

    let minimal: RoleContext =
        serde_json::from_value(serde_json::json!({ "title": "Engineer", "job": "Fix bugs" }))
            .expect("a role context without optional keys loads");
    assert_eq!(minimal.plan_horizon_days, 14);
    assert!(minimal.ask_before.is_empty());
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
```

Run the Step 2 command again. Expected: FAIL to compile with `error[E0432]: unresolved import super::RoleContext` and `error[E0609]: no field role_context on type ManagedAgentRecord`.

- [ ] **Step 4: Add the `RoleContext` type**

Create `desktop/src-tauri/src/managed_agents/types/role_context.rs`:

```rust
//! The role context a hired employee runs with. It is stored on the
//! employee's record and exported to the harness as `COLONY_ROLE_CONTEXT`
//! (see `runtime::employee_launch`).

use serde::{Deserialize, Serialize};

/// Days a new employee's first plan covers when nothing else is said.
const DEFAULT_PLAN_HORIZON_DAYS: u8 = 14;

fn default_plan_horizon_days() -> u8 {
    DEFAULT_PLAN_HORIZON_DAYS
}

/// What a hired employee needs to know about its role, passed as COLONY_ROLE_CONTEXT.
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
    /// Actions that always need the founder first.
    #[serde(default)]
    pub ask_before: Vec<String>,
    /// Display name of the employee's manager, when it has one.
    #[serde(default)]
    pub manager_name: Option<String>,
    /// UUID of the employee's home channel.
    #[serde(default)]
    pub home_channel_id: Option<String>,
    /// UUID of the employee's goal (the hire id).
    #[serde(default)]
    pub goal_id: Option<String>,
    /// What the employee studies first.
    #[serde(default)]
    pub on_hire_sources: Vec<String>,
    /// Days the first plan covers, 1 to 30.
    #[serde(default = "default_plan_horizon_days")]
    pub plan_horizon_days: u8,
}
```

In `desktop/src-tauri/src/managed_agents/types.rs`, replace (lines 1079-1080):

```rust
mod teams;
pub use teams::{CreateTeamRequest, TeamRecord, UpdateTeamRequest};
```

with:

```rust
mod teams;
pub use teams::{CreateTeamRequest, TeamRecord, UpdateTeamRequest};
mod role_context;
pub use role_context::RoleContext;
```

- [ ] **Step 5: Add the record fields and carry the role through the fold**

In `desktop/src-tauri/src/managed_agents/types.rs`, replace the end of `ManagedAgentRecord` (lines 571-575):

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
    /// `COLONY_ROLE_CONTEXT`. Unset for agents that were not hired.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_optional"
    )]
    pub role_context: Option<RoleContext>,
    /// Absolute folder a hired employee starts in. Unset, or a folder that is
    /// gone, starts it in the default agent folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
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
            work_dir: None,
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

- [ ] **Step 6: Add the three fields to every other record literal**

Run from the worktree root. The script finds each `ManagedAgentRecord { .. }` struct literal (not function signatures, not literals that use `..base` update syntax, not ones already updated) and inserts the three `None` fields after its `effort_level` line. `types.rs` is skipped (edited by hand in Step 5) and `discovery/tests.rs` is skipped (rebuilt in Step 7). A dry run on a copy of the tree changed exactly 26 files.

```bash
python3 - <<'EOF'
import pathlib
import re

ROOT = pathlib.Path("desktop/src-tauri/src")
SKIP = {
    ROOT / "managed_agents/types.rs",
    ROOT / "managed_agents/discovery/tests.rs",
}
OPEN = re.compile(r"\bManagedAgentRecord\s*\{\s*$")
NEW_FIELDS = ("company_role: None,", "role_context: None,", "work_dir: None,")

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
        if any(re.match(r"^\s*(\.\.|work_dir:)", l) for l in body):
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
EOF
```

Expected output ends with `26 files`, and the list is: `commands/agent_config_tests.rs`, `commands/agents.rs`, `commands/agents_tests.rs`, `commands/personas/delete_cascade_tests.rs`, `commands/personas/inbound/inbound_tests.rs`, `commands/personas/snapshot/fidelity_tests.rs`, `commands/personas/snapshot/import.rs`, `commands/personas/snapshot/tests.rs`, `commands/personas/update/name_propagation_tests.rs`, `commands/team_snapshot/tests.rs`, `commands/team_snapshot.rs`, `managed_agents/agent_events.rs`, `managed_agents/agent_snapshot_envelope.rs`, `managed_agents/agent_snapshot_tests.rs`, `managed_agents/config_bridge/effort_tests.rs`, `managed_agents/config_bridge/reader_tests.rs`, `managed_agents/effective_config/tests.rs`, `managed_agents/global_config/tests.rs`, `managed_agents/nest/render_tests.rs`, `managed_agents/parallelism.rs`, `managed_agents/persona_events/tests.rs`, `managed_agents/readiness_tests.rs`, `managed_agents/runtime/test_fixtures.rs`, `managed_agents/spawn_snapshot/tests.rs`, `managed_agents/team_snapshot.rs`, `managed_agents/teams_tests.rs` (all under `desktop/src-tauri/src/`). Running it a second time prints `0 files`.

- [ ] **Step 7: Rebuild the discovery fixture from JSON**

`desktop/src-tauri/src/managed_agents/discovery/tests.rs` is 1756 lines, above the 1500-line cap, so it may not grow by even one line. Replace the whole `record_with` function (lines 207-273, from the doc line `/// Minimal record for \`record_agent_command\` tests; only resolution inputs vary.` through its closing brace) with this shorter version, which also never has to list a new store field again:

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

Every other field of the old literal equals its serde default (`session_policy` channel, `private_key_nsec` empty, `auto_restart_on_config_change` true, `is_active` true, everything optional `None`, every list empty).

- [ ] **Step 8: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::types managed_agents::discovery)`
Expected: PASS (the five new tests, the existing types and discovery tests, 0 failed). The run compiles the whole lib test target, so a record literal the script missed would fail here with `error[E0063]: missing fields company_role, role_context and work_dir`.

Then: `wc -l desktop/src-tauri/src/managed_agents/discovery/tests.rs`
Expected: fewer than 1756 lines.

- [ ] **Step 9: Commit**

```bash
git status --short desktop/src-tauri/src
git add desktop/src-tauri/src
git commit -s -m "fix(desktop): keep persona company role across save and reload"
```

`git status` must list only the 26 script files, `types.rs`, `types/role_context.rs`, `types/tests.rs` and `discovery/tests.rs`.

---

### Task 3.3: Code-owned built-in company roles and the Test Engineer fixture pack

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/personas.rs:5` (imports), `:7-16` (`BuiltInPersona`), `:37-68` (`BUILT_IN_PERSONAS` plus the fixture pack), `:116-120` (`built_in_persona_records`), `:167-172` (sort comparator), `:188-201` (`merge_personas`), `:263-264` (demotion)
- Modify: `desktop/src-tauri/src/managed_agents/personas/tests.rs:1-7` (imports), `:38-40` (first test), append at the end
- Modify: `desktop/src-tauri/src/managed_agents/nest/brand_guard_tests.rs:15`, `:111-117`, `:173`
- Test: `desktop/src-tauri/src/managed_agents/personas/tests.rs`, `desktop/src-tauri/src/managed_agents/nest/brand_guard_tests.rs`

**Interfaces:**
- Consumes: Task 3.1 `CompanyRoleMetadata` v2 and `crate::managed_agents::{RoleDutyTemplate, RoleOnHire, RoleWorkFolder}`; Task 3.2 company role persistence (`into_agent_record` and `to_definition_view`).
- Produces: `personas::TEST_ENGINEER_PERSONA_ID: &str = "builtin:test-engineer"`; `personas::built_in_persona_records_with(now: &str, include_fixtures: bool) -> Vec<AgentDefinition>` (`pub(crate)`); env `COLONY_FIXTURE_ROLE_PACKS=1` (exactly `1`) adds the built-in persona "Test Engineer" with the company role from the brief to every persona load; without it the fixture is not added. `merge_personas` refreshes every built-in's `company_role` from code on every load. `list_personas` (via `load_personas`) therefore returns built-ins with their role to the TypeScript catalog.

- [ ] **Step 1: Write the failing tests**

In `desktop/src-tauri/src/managed_agents/personas/tests.rs`, replace the imports (lines 1-7):

```rust
use super::{
    built_in_persona_records, ensure_persona_ids_are_active, ensure_persona_is_active,
    merge_personas, migrate_retired_personas, validate_persona_activation_change,
    validate_persona_deletion, BUILT_IN_PERSONAS, RETIRED_PERSONAS,
};
use crate::managed_agents::discovery::{default_agent_command, effective_agent_command};
use crate::managed_agents::AgentDefinition;
```

with:

```rust
use super::{
    built_in_persona_records, ensure_persona_ids_are_active, ensure_persona_is_active,
    fixture_role_packs_enabled_from, merge_personas, merge_personas_with,
    migrate_retired_personas, validate_persona_activation_change, validate_persona_deletion,
    BUILT_IN_PERSONAS, RETIRED_PERSONAS, TEST_ENGINEER_PERSONA_ID,
};
use crate::managed_agents::discovery::{default_agent_command, effective_agent_command};
use crate::managed_agents::{
    validate_company_role_metadata, AgentDefinition, ManagedAgentRecord, RoleWorkFolder,
};
```

Make the built-in count test independent of the shell it runs in. Replace (lines 38-40):

```rust
#[test]
fn merge_personas_adds_missing_built_ins() {
    let (records, changed) = merge_personas(Vec::new(), "2026-03-19T00:00:00Z");
```

with:

```rust
#[test]
fn merge_personas_adds_missing_built_ins() {
    // Explicitly without the fixture packs, so a COLONY_FIXTURE_ROLE_PACKS=1
    // left in the test shell cannot change the count.
    let (records, changed) = merge_personas_with(Vec::new(), "2026-03-19T00:00:00Z", false);
```

Append to the end of the file, after the last test (`stock_scout_prompt_migrates_and_custom_instructions_survive`, which ends with):

```rust
    assert_eq!(kept.system_prompt, custom.system_prompt);
    assert_eq!(kept.display_name, custom.display_name);
}
```

Append:

```rust

// Built-in company roles and the fixture role pack.

#[test]
fn fixture_flag_is_on_only_for_one() {
    for (value, expected) in [
        (None, false),
        (Some(""), false),
        (Some("0"), false),
        (Some("true"), false),
        (Some("yes"), false),
        (Some("1"), true),
        (Some(" 1 "), true),
    ] {
        assert_eq!(fixture_role_packs_enabled_from(value), expected, "{value:?}");
    }
}

#[test]
fn fixture_flag_adds_the_test_engineer_after_the_built_ins() {
    let (records, changed) = merge_personas_with(Vec::new(), "2026-10-11T00:00:00Z", true);

    assert!(changed);
    let names: Vec<&str> = records
        .iter()
        .map(|record| record.display_name.as_str())
        .collect();
    assert_eq!(names, vec!["Scout", "Writer", "Researcher", "Test Engineer"]);
    let engineer = records
        .iter()
        .find(|record| record.id == TEST_ENGINEER_PERSONA_ID)
        .expect("the fixture pack is added");
    assert!(engineer.is_builtin && engineer.is_active);
    let role = engineer
        .company_role
        .as_ref()
        .expect("the fixture pack carries a company role");
    validate_company_role_metadata(role).expect("the fixture role is valid");
    assert!(role.owns.is_some());
    assert_eq!(role.channel.as_deref(), Some("engineering"));
    assert_eq!(role.duties.len(), 1);
    assert_eq!(role.duties[0].schedule_text, "Every day at 09:00");
    assert_eq!(
        role.on_hire.as_ref().map(|on_hire| on_hire.sources.clone()),
        Some(vec!["code folder".to_string(), "open issues".to_string()])
    );
    assert_eq!(role.ask_before, vec!["merge", "deploy"]);
    assert_eq!(role.home.as_deref(), Some("engineer.prs"));
    assert_eq!(role.work_folder, Some(RoleWorkFolder::Required));
}

#[test]
fn fixture_pack_is_absent_without_the_flag() {
    let (records, _) = merge_personas_with(Vec::new(), "2026-10-11T00:00:00Z", false);
    assert!(records
        .iter()
        .all(|record| record.id != TEST_ENGINEER_PERSONA_ID));
}

#[test]
fn built_in_company_roles_are_refreshed_from_code_on_load() {
    let (fresh, _) = merge_personas_with(Vec::new(), "2026-10-01T00:00:00Z", true);
    let code_role = fresh
        .iter()
        .find(|record| record.id == TEST_ENGINEER_PERSONA_ID)
        .and_then(|record| record.company_role.clone())
        .expect("the fixture pack has a code role");
    let mut stored = fresh;
    for record in &mut stored {
        match record.id.as_str() {
            // A role written by an older build of the pack.
            TEST_ENGINEER_PERSONA_ID => {
                if let Some(role) = record.company_role.as_mut() {
                    role.owns = Some("A goal from an older build".to_string());
                }
            }
            // A role Scout never shipped with.
            "builtin:fizz" => record.company_role = Some(code_role.clone()),
            _ => {}
        }
    }

    let now = "2026-10-11T00:00:00Z";
    let (records, changed) = merge_personas_with(stored, now, true);

    assert!(changed, "a refreshed role must be saved");
    let engineer = records
        .iter()
        .find(|record| record.id == TEST_ENGINEER_PERSONA_ID)
        .expect("fixture pack");
    assert_eq!(engineer.company_role.as_ref(), Some(&code_role));
    assert_eq!(engineer.updated_at, now);
    let scout = records
        .iter()
        .find(|record| record.id == "builtin:fizz")
        .expect("Scout");
    assert_eq!(scout.company_role, None, "Scout ships no company role");
}

#[test]
fn stored_built_in_roles_round_trip_without_a_save_on_every_load() {
    let (records, _) = merge_personas_with(Vec::new(), "2026-10-11T00:00:00Z", true);
    // Save and load the way the persona shim does: `save_personas` folds each
    // definition into an agent record and writes JSON; `load_personas` parses
    // it and reads each definition back.
    let folded: Vec<ManagedAgentRecord> = records
        .into_iter()
        .map(AgentDefinition::into_agent_record)
        .collect();
    let bytes = serde_json::to_vec_pretty(&folded).expect("store serializes");
    let stored: Vec<ManagedAgentRecord> = serde_json::from_slice(&bytes).expect("store parses");
    let reloaded: Vec<AgentDefinition> = stored
        .iter()
        .filter_map(ManagedAgentRecord::to_definition_view)
        .collect();

    let (reloaded, changed) = merge_personas_with(reloaded, "2026-10-12T00:00:00Z", true);

    assert!(
        !changed,
        "a stored built-in role equal to the code role must not resave on every load"
    );
    assert!(reloaded
        .iter()
        .any(|record| record.id == TEST_ENGINEER_PERSONA_ID && record.company_role.is_some()));
}

#[test]
fn a_fixture_record_left_by_a_flagged_launch_is_kept_as_a_custom_persona() {
    let (with_flag, _) = merge_personas_with(Vec::new(), "2026-10-11T00:00:00Z", true);

    let (records, changed) = merge_personas_with(with_flag, "2026-10-12T00:00:00Z", false);

    assert!(changed);
    let engineer = records
        .iter()
        .find(|record| record.id == TEST_ENGINEER_PERSONA_ID)
        .expect("hired Test Engineers keep their definition, so it is never removed");
    assert!(!engineer.is_builtin, "without the flag it is an ordinary persona");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::personas)`
Expected: FAIL to compile with `error[E0432]: unresolved imports super::fixture_role_packs_enabled_from, super::merge_personas_with, super::TEST_ENGINEER_PERSONA_ID`.

- [ ] **Step 3: Implement**

In `desktop/src-tauri/src/managed_agents/personas.rs`, replace line 5:

```rust
use crate::{managed_agents::AgentDefinition, util::now_iso};
```

with:

```rust
use crate::{
    managed_agents::{
        AgentDefinition, CompanyRoleMetadata, CompanyRoleTool, CompanyToolRisk, RoleDutyTemplate,
        RoleOnHire, RoleWorkFolder,
    },
    util::now_iso,
};
```

Replace `BuiltInPersona` (lines 7-16):

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
    /// Code-owned company role. `merge_personas` copies it onto the stored
    /// built-in on every load, so a role pack change ships with the build.
    company_role: Option<fn() -> CompanyRoleMetadata>,
}
```

Replace the whole `BUILT_IN_PERSONAS` constant (lines 37-68, from `const BUILT_IN_PERSONAS: &[BuiltInPersona] = &[` through its closing `];`) with:

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

/// Id of the "Test Engineer" fixture role pack that the real-run gate hires.
pub(crate) const TEST_ENGINEER_PERSONA_ID: &str = "builtin:test-engineer";

/// Env var that adds the fixture role packs. Phase 1 ships no production
/// pack; the fixture exists only when this is exactly `1`.
const FIXTURE_ROLE_PACKS_ENV_VAR: &str = "COLONY_FIXTURE_ROLE_PACKS";

const TEST_ENGINEER_SYSTEM_PROMPT: &str = "You are the founder's engineer. You own shipping fixes and roadmap items in the founder's code folder. Work on your own, keep each change small and tested, and open a pull request for it. Ask the founder before you merge or deploy.";

/// Built-in personas that exist only with `COLONY_FIXTURE_ROLE_PACKS=1`.
const FIXTURE_ROLE_PACK_PERSONAS: &[BuiltInPersona] = &[BuiltInPersona {
    id: TEST_ENGINEER_PERSONA_ID,
    display_name: "Test Engineer",
    avatar_url: None,
    system_prompt: TEST_ENGINEER_SYSTEM_PROMPT,
    name_pool: &["Test Engineer"],
    model: None,
    runtime: None,
    default_active: true,
    company_role: Some(test_engineer_company_role),
}];

/// The Test Engineer's role pack, in the shape the real Engineer pack will take.
fn test_engineer_company_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Engineer for the founder's product: fix bugs, ship roadmap items and keep the code healthy.".to_string(),
        skills: vec![
            "Debugging".to_string(),
            "Code review".to_string(),
            "Testing".to_string(),
        ],
        tools: vec![
            CompanyRoleTool {
                name: "git".to_string(),
                risk: CompanyToolRisk::Medium,
            },
            CompanyRoleTool {
                name: "shell".to_string(),
                risk: CompanyToolRisk::High,
            },
        ],
        worker_menu: vec!["claude".to_string(), "codex".to_string()],
        default_allowance: Some("25".to_string()),
        owns: Some("Ship fixes and roadmap items every week".to_string()),
        channel: Some("engineering".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Bug triage".to_string(),
            schedule_text: "Every day at 09:00".to_string(),
            instructions: "Triage new bugs and open issues, fix the most urgent one and open a pull request for it.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["code folder".to_string(), "open issues".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["merge".to_string(), "deploy".to_string()],
        home: Some("engineer.prs".to_string()),
        work_folder: Some(RoleWorkFolder::Required),
    }
}

/// Whether the fixture packs are on, from the raw env value. Only `1` turns
/// them on, so `0`, `false` or an empty value keep an install clean.
fn fixture_role_packs_enabled_from(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("1")
}

/// Whether this process adds the fixture role packs.
fn fixture_role_packs_enabled() -> bool {
    fixture_role_packs_enabled_from(std::env::var(FIXTURE_ROLE_PACKS_ENV_VAR).ok().as_deref())
}

/// The code-owned built-in personas, plus the fixture packs when asked.
fn code_built_in_personas(
    include_fixtures: bool,
) -> impl Iterator<Item = &'static BuiltInPersona> {
    let fixtures: &'static [BuiltInPersona] = if include_fixtures {
        FIXTURE_ROLE_PACK_PERSONAS
    } else {
        &[]
    };
    BUILT_IN_PERSONAS.iter().chain(fixtures)
}

/// Whether `id` names a persona this build owns in code.
fn is_code_built_in(id: &str, include_fixtures: bool) -> bool {
    code_built_in_personas(include_fixtures).any(|persona| persona.id == id)
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
    built_in_persona_records_with(now, fixture_role_packs_enabled())
}

/// Built-in persona definitions stamped `now`, with or without the fixture
/// role packs.
pub(crate) fn built_in_persona_records_with(
    now: &str,
    include_fixtures: bool,
) -> Vec<AgentDefinition> {
    code_built_in_personas(include_fixtures)
        .map(|persona| AgentDefinition {
            company_role: persona.company_role.map(|build| build()),
```

(The rest of the function body, `id: persona.id.to_string(),` through `.collect()`, is unchanged.)

Make the persona sort a total order (lines 167-172). With the fixture pack, a built-in can have no position in `BUILT_IN_PERSONAS`; the old `_ => Equal` arm then makes the comparator non-transitive, and Rust's sort may panic on that. Replace:

```rust
            .then_with(
                || match (built_in_order(&left.id), built_in_order(&right.id)) {
                    (Some(left_order), Some(right_order)) => left_order.cmp(&right_order),
                    _ => std::cmp::Ordering::Equal,
                },
            )
```

with:

```rust
            .then_with(
                || match (built_in_order(&left.id), built_in_order(&right.id)) {
                    (Some(left_order), Some(right_order)) => left_order.cmp(&right_order),
                    // Ordered built-ins come before any other built-in (the
                    // fixture packs), which keeps this a total order.
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                },
            )
```

Replace the head of `merge_personas` (lines 188-201):

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
    merge_personas_with(stored, now, fixture_role_packs_enabled())
}

/// [`merge_personas`] with the fixture role packs passed in, so tests never
/// depend on the environment they run in.
fn merge_personas_with(
    mut stored: Vec<AgentDefinition>,
    now: &str,
    include_fixtures: bool,
) -> (Vec<AgentDefinition>, bool) {
    let mut changed = false;

    for built_in in built_in_persona_records_with(now, include_fixtures) {
        if let Some(existing) = stored.iter_mut().find(|record| record.id == built_in.id) {
            if !existing.is_builtin {
                existing.is_builtin = true;
                changed = true;
            }
            // Built-ins are code-owned: their company role is refreshed from
            // code on every load, so a role pack change ships with the build.
            if existing.company_role != built_in.company_role {
                existing.company_role = built_in.company_role;
                existing.updated_at = now.to_string();
                changed = true;
            }
        } else {
            stored.push(built_in);
            changed = true;
        }
    }
```

Replace the demotion condition (lines 263-264):

```rust
    for record in stored.iter_mut() {
        if record.is_builtin && built_in_order(&record.id).is_none() {
```

with:

```rust
    for record in stored.iter_mut() {
        if record.is_builtin && !is_code_built_in(&record.id, include_fixtures) {
```

`load_personas` (`personas.rs:413`) and `load_factory_personas` (`personas.rs:430`) keep calling `merge_personas`, so production reads the flag once per load.

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::personas)`
Expected: PASS (6 new tests and all existing persona tests, 0 failed).

- [ ] **Step 5: Write the failing brand guard test**

The fixture's instructions and role reach the employee, so the nest brand guard must scan them. In `desktop/src-tauri/src/managed_agents/nest/brand_guard_tests.rs`, replace (line 173):

```rust
    assert!(find("persona instructions (Scout)"), "Scout is not scanned");
```

with:

```rust
    assert!(find("persona instructions (Scout)"), "Scout is not scanned");
    assert!(
        find("company role (Test Engineer)"),
        "the fixture role pack is not scanned"
    );
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest::brand_guard_tests)`
Expected: FAIL in `guard_corpus_covers_what_the_writer_produces` with "the fixture role pack is not scanned".

- [ ] **Step 7: Add the fixture to the corpus**

Replace the import (line 15):

```rust
use crate::managed_agents::personas::{built_in_persona_definition, POLLEN_PERSONA_ID};
```

with:

```rust
use crate::managed_agents::personas::{
    built_in_persona_definition, built_in_persona_records_with, POLLEN_PERSONA_ID,
    TEST_ENGINEER_PERSONA_ID,
};
```

Replace the end of `surfaces()` (lines 111-117):

```rust
        out.push(Surface::new(
            format!("persona instructions ({})", persona.display_name),
            persona.system_prompt,
        ));
    }
    out
}
```

with:

```rust
        out.push(Surface::new(
            format!("persona instructions ({})", persona.display_name),
            persona.system_prompt,
        ));
    }

    // The fixture role pack is what the real-run gate hires: its instructions
    // and its company role (job, duties, limits) reach the employee.
    let engineer = built_in_persona_records_with("2026-10-06T08:00:00Z", true)
        .into_iter()
        .find(|persona| persona.id == TEST_ENGINEER_PERSONA_ID)
        .expect("the fixture role pack exists");
    let role = engineer
        .company_role
        .as_ref()
        .expect("the fixture role pack carries a company role");
    out.push(Surface::new(
        format!("company role ({})", engineer.display_name),
        serde_json::to_string_pretty(role).expect("company role serializes"),
    ));
    out.push(Surface::new(
        format!("persona instructions ({})", engineer.display_name),
        engineer.system_prompt.clone(),
    ));
    out
}
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest::brand_guard_tests)`
Expected: PASS (all brand guard tests ok, including `guard_flags_injected_buzz_in_every_real_surface` over the two new surfaces).

- [ ] **Step 9: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/personas.rs desktop/src-tauri/src/managed_agents/personas/tests.rs desktop/src-tauri/src/managed_agents/nest/brand_guard_tests.rs
git commit -s -m "feat(desktop): code-owned built-in company roles and Test Engineer fixture pack"
```

---

### Task 3.4: Accept and validate role context and work folder when creating an agent

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/types/role_context.rs` (imports, append validators and tests)
- Modify: `desktop/src-tauri/src/managed_agents/types.rs` (the `pub use role_context::RoleContext;` line from Task 3.2)
- Modify: `desktop/src-tauri/src/managed_agents/types/requests.rs:8-11` (imports), `:207-209` (`CreateManagedAgentRequest` tail)
- Modify: `desktop/src-tauri/src/commands/agents.rs:378-386` (validation before side effects), the record literal tail (lines 702-706 after Task 3.2)
- Test: `desktop/src-tauri/src/managed_agents/types/role_context.rs`, `desktop/src-tauri/src/managed_agents/types/tests.rs` (after line 313)

**Interfaces:**
- Consumes: Task 3.2 `RoleContext`, `ManagedAgentRecord.role_context`, `ManagedAgentRecord.work_dir`, private `types::role_text_within`; existing `buzz_core_pkg::company_records::{MAX_TITLE_CHARS, MAX_ASK_BODY_CHARS}` (180 and 4000, `crates/buzz-core/src/company_records.rs:26,32`).
- Produces: `CreateManagedAgentRequest.role_context: Option<RoleContext>` (wire key `roleContext`, `null` accepted) and `.work_dir: Option<String>` (wire key `workDir`, `null` accepted); `crate::managed_agents::normalize_role_context(RoleContext) -> Result<RoleContext, String>` (title 1-180, job 1-4000, owns at most 500, manager name at most 180, ask-before at most 16 of 1-120, on-hire sources at most 8 of 1-200, plan horizon 1-30, home channel and goal ids must be UUIDs and are stored lowercase hyphenated, blank optionals become `None`); `crate::managed_agents::normalize_work_dir(Option<&str>) -> Result<Option<String>, String>` (blank means none; otherwise an absolute path to an existing folder, at most 4096 bytes, no control characters). `create_managed_agent` stores both on the new record in its one save.

- [ ] **Step 1: Write the failing tests**

In `desktop/src-tauri/src/managed_agents/types/role_context.rs`, append at the end of the file (after the `RoleContext` struct, which ends with `pub plan_horizon_days: u8,` and `}`):

```rust

#[cfg(test)]
mod tests {
    use super::*;

    fn hire_context() -> RoleContext {
        RoleContext {
            title: "Engineer".to_string(),
            job: "Fix bugs and ship roadmap items.".to_string(),
            owns: Some("Ship fixes".to_string()),
            ask_before: vec!["merge".to_string()],
            manager_name: Some("Sam".to_string()),
            home_channel_id: Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c".to_string()),
            goal_id: Some("6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10".to_string()),
            on_hire_sources: vec!["code folder".to_string()],
            plan_horizon_days: 14,
        }
    }

    #[test]
    fn a_hire_role_context_is_kept_with_blank_optionals_dropped_and_ids_canonical() {
        let mut input = hire_context();
        input.manager_name = Some("   ".to_string());
        input.owns = Some(String::new());
        input.home_channel_id = Some(" 0B8F2A4C-6D1E-4F3A-8B9C-1D2E3F4A5B6C ".to_string());

        let normalized = normalize_role_context(input).expect("a hire role context is valid");

        assert_eq!(normalized.manager_name, None);
        assert_eq!(normalized.owns, None);
        assert_eq!(
            normalized.home_channel_id.as_deref(),
            Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c")
        );
        assert_eq!(normalized.title, "Engineer");
    }

    type Mutation = (&'static str, fn(&mut RoleContext));

    #[test]
    fn role_context_bounds_reject_each_rule_by_name() {
        let cases: Vec<Mutation> = vec![
            ("title", |context| context.title = " ".to_string()),
            ("title", |context| context.title = "t".repeat(181)),
            ("job", |context| context.job = String::new()),
            ("job", |context| context.job = "j".repeat(4_001)),
            ("owns", |context| context.owns = Some("o".repeat(501))),
            ("manager name", |context| {
                context.manager_name = Some("m".repeat(181))
            }),
            ("ask-before", |context| {
                context.ask_before = vec!["a".to_string(); 17]
            }),
            ("ask-before", |context| context.ask_before = vec![" ".to_string()]),
            ("on-hire sources", |context| {
                context.on_hire_sources = vec!["s".to_string(); 9]
            }),
            ("on-hire sources", |context| {
                context.on_hire_sources = vec!["s".repeat(201)]
            }),
            ("plan horizon", |context| context.plan_horizon_days = 0),
            ("plan horizon", |context| context.plan_horizon_days = 31),
            ("home channel id", |context| {
                context.home_channel_id = Some("general".to_string())
            }),
            ("goal id", |context| {
                context.goal_id = Some("not-a-uuid".to_string())
            }),
        ];
        for (rule, mutate) in cases {
            let mut input = hire_context();
            mutate(&mut input);
            let Err(error) = normalize_role_context(input) else {
                panic!("{rule} must be rejected");
            };
            assert!(error.contains(rule), "{rule}: unexpected error {error}");
        }
    }

    #[test]
    fn work_dir_must_be_an_existing_absolute_folder() {
        let folder = tempfile::tempdir().expect("work folder");
        let path = folder.path().display().to_string();
        assert_eq!(
            normalize_work_dir(Some(&format!("  {path}  "))),
            Ok(Some(path.clone()))
        );
        assert_eq!(normalize_work_dir(None), Ok(None));
        assert_eq!(normalize_work_dir(Some("   ")), Ok(None));

        let file = folder.path().join("notes.txt");
        std::fs::write(&file, "not a folder").expect("write file");
        for bad in [
            "relative/project".to_string(),
            folder.path().join("missing").display().to_string(),
            file.display().to_string(),
            format!("{path}/bad\u{0}name"),
        ] {
            assert!(
                normalize_work_dir(Some(&bad)).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }
}
```

In `desktop/src-tauri/src/managed_agents/types/tests.rs`, after `create_request_deserializes_camel_case_relay_mesh` (lines 298-313), which ends with:

```rust
        Some(RelayMeshConfig {
            model_ref: "Qwen3".to_string()
        })
    );
}
```

insert:

```rust

/// Wire-shape test for the hire flow: the create request arrives camelCase
/// and its nested role context is camelCase too (`rename_all` does not
/// recurse, so `RoleContext` carries its own).
#[test]
fn create_request_deserializes_camel_case_role_context_and_work_dir() {
    let request: CreateManagedAgentRequest = serde_json::from_str(
        r#"{
            "name": "Ada",
            "startOnAppLaunch": true,
            "roleContext": {
                "title": "Engineer",
                "job": "Fix bugs",
                "owns": "Ship fixes",
                "askBefore": ["merge"],
                "managerName": "Sam",
                "homeChannelId": "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c",
                "goalId": "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10",
                "onHireSources": ["code folder"],
                "planHorizonDays": 14
            },
            "workDir": "/Users/sam/code/app"
        }"#,
    )
    .expect("the hire create payload from TS deserializes");
    assert!(request.start_on_app_launch);
    assert_eq!(request.work_dir.as_deref(), Some("/Users/sam/code/app"));
    let context = request.role_context.expect("role context");
    assert_eq!(context.ask_before, vec!["merge"]);
    assert_eq!(context.manager_name.as_deref(), Some("Sam"));
    assert_eq!(context.plan_horizon_days, 14);
}

/// TS sends `null` for an agent that is not a hire.
#[test]
fn create_request_accepts_null_hire_fields() {
    let request: CreateManagedAgentRequest =
        serde_json::from_str(r#"{ "name": "Kit", "roleContext": null, "workDir": null }"#)
            .expect("null hire fields deserialize");
    assert_eq!(request.role_context, None);
    assert_eq!(request.work_dir, None);
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::types)`
Expected: FAIL to compile with `error[E0425]: cannot find function normalize_role_context in this scope` and `error[E0609]: no field role_context on type CreateManagedAgentRequest`.

- [ ] **Step 3: Implement the validators**

In `desktop/src-tauri/src/managed_agents/types/role_context.rs`, replace the import line:

```rust
use serde::{Deserialize, Serialize};
```

with:

```rust
use buzz_core_pkg::company_records::{MAX_ASK_BODY_CHARS, MAX_TITLE_CHARS};
use serde::{Deserialize, Serialize};

use super::role_text_within;

/// Longest `owns` text, matching the role pack rule.
const MAX_OWNS_CHARS: usize = 500;
/// Most ask-before entries, and the longest one, matching the role pack rule.
const MAX_ASK_BEFORE: usize = 16;
const MAX_ASK_BEFORE_CHARS: usize = 120;
/// Most on-hire sources, and the longest one, matching the role pack rule.
const MAX_ON_HIRE_SOURCES: usize = 8;
const MAX_ON_HIRE_SOURCE_CHARS: usize = 200;
/// Longest plan horizon in days, matching the role pack rule.
const MAX_PLAN_HORIZON_DAYS: u8 = 30;
/// Longest work folder path accepted, in bytes.
const MAX_WORK_DIR_BYTES: usize = 4096;
```

Then insert the validators directly above the `#[cfg(test)]` line of the tests module you added in Step 1:

```rust
/// Validate a hire's role context before it is stored, drop blank optional
/// values, and write the home channel and goal ids in canonical UUID form.
/// The bounds mirror the core hire limits, so a context built from a valid
/// hire always passes.
pub fn normalize_role_context(mut context: RoleContext) -> Result<RoleContext, String> {
    fn blank_to_none(value: Option<String>) -> Option<String> {
        value.filter(|text| !text.trim().is_empty())
    }
    context.owns = blank_to_none(context.owns.take());
    context.manager_name = blank_to_none(context.manager_name.take());
    context.home_channel_id = blank_to_none(context.home_channel_id.take());
    context.goal_id = blank_to_none(context.goal_id.take());

    if !role_text_within(&context.title, MAX_TITLE_CHARS) {
        return Err(format!(
            "role context title must be 1 to {MAX_TITLE_CHARS} characters"
        ));
    }
    if !role_text_within(&context.job, MAX_ASK_BODY_CHARS) {
        return Err(format!(
            "role context job must be 1 to {MAX_ASK_BODY_CHARS} characters"
        ));
    }
    if context
        .owns
        .as_deref()
        .is_some_and(|owns| !role_text_within(owns, MAX_OWNS_CHARS))
    {
        return Err(format!(
            "role context owns must be at most {MAX_OWNS_CHARS} characters"
        ));
    }
    if context
        .manager_name
        .as_deref()
        .is_some_and(|name| !role_text_within(name, MAX_TITLE_CHARS))
    {
        return Err(format!(
            "role context manager name must be at most {MAX_TITLE_CHARS} characters"
        ));
    }
    if context.ask_before.len() > MAX_ASK_BEFORE
        || context
            .ask_before
            .iter()
            .any(|action| !role_text_within(action, MAX_ASK_BEFORE_CHARS))
    {
        return Err(format!(
            "role context ask-before needs at most {MAX_ASK_BEFORE} entries of 1 to {MAX_ASK_BEFORE_CHARS} characters"
        ));
    }
    if context.on_hire_sources.len() > MAX_ON_HIRE_SOURCES
        || context
            .on_hire_sources
            .iter()
            .any(|source| !role_text_within(source, MAX_ON_HIRE_SOURCE_CHARS))
    {
        return Err(format!(
            "role context on-hire sources need at most {MAX_ON_HIRE_SOURCES} entries of 1 to {MAX_ON_HIRE_SOURCE_CHARS} characters"
        ));
    }
    if !(1..=MAX_PLAN_HORIZON_DAYS).contains(&context.plan_horizon_days) {
        return Err(format!(
            "role context plan horizon must be 1 to {MAX_PLAN_HORIZON_DAYS} days"
        ));
    }
    context.home_channel_id = canonical_uuid(context.home_channel_id, "home channel")?;
    context.goal_id = canonical_uuid(context.goal_id, "goal")?;
    Ok(context)
}

/// Parse an id as a UUID and write it lowercase and hyphenated.
fn canonical_uuid(value: Option<String>, label: &str) -> Result<Option<String>, String> {
    value
        .map(|text| {
            uuid::Uuid::parse_str(text.trim())
                .map(|id| id.to_string())
                .map_err(|_| format!("role context {label} id must be a UUID"))
        })
        .transpose()
}

/// Validate the work folder chosen at hire. Blank or absent means the default
/// agent folder; anything else must be an absolute path to an existing folder.
pub fn normalize_work_dir(work_dir: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = work_dir.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if raw.len() > MAX_WORK_DIR_BYTES || raw.chars().any(char::is_control) {
        return Err("work folder path is not valid".to_string());
    }
    let path = std::path::Path::new(raw);
    if !path.is_absolute() {
        return Err("work folder must be an absolute path".to_string());
    }
    if !path.is_dir() {
        return Err(format!("work folder {raw} is not a folder on this computer"));
    }
    Ok(Some(raw.to_string()))
}
```

In `desktop/src-tauri/src/managed_agents/types.rs`, replace:

```rust
pub use role_context::RoleContext;
```

with:

```rust
pub use role_context::{normalize_role_context, normalize_work_dir, RoleContext};
```

- [ ] **Step 4: Add the request fields and store them at create**

In `desktop/src-tauri/src/managed_agents/types/requests.rs`, replace the imports (lines 8-11):

```rust
use super::{
    default_start_on_app_launch, validate_respond_to_allowlist, AgentDefinition, BackendKind,
    CatalogSource, RelayMeshConfig, RespondTo,
};
```

with:

```rust
use super::{
    default_start_on_app_launch, validate_respond_to_allowlist, AgentDefinition, BackendKind,
    CatalogSource, RelayMeshConfig, RespondTo, RoleContext,
};
```

Replace the end of `CreateManagedAgentRequest` (lines 207-209):

```rust
    #[serde(default)]
    pub relay_mesh: Option<RelayMeshConfig>,
}
```

with:

```rust
    #[serde(default)]
    pub relay_mesh: Option<RelayMeshConfig>,
    /// Role context of a hired employee (`roleContext`), stored on the record
    /// and exported at spawn as `COLONY_ROLE_CONTEXT`. Absent for other agents.
    #[serde(default)]
    pub role_context: Option<RoleContext>,
    /// Absolute folder a hired employee starts in (`workDir`). Absent means
    /// the default agent folder.
    #[serde(default)]
    pub work_dir: Option<String>,
}
```

In `desktop/src-tauri/src/commands/agents.rs`, validate the hire fields with the other boundary checks, before any key is generated or anything is saved. Replace (lines 378-386):

```rust
    let respond_to_allowlist =
        crate::managed_agents::validate_respond_to_allowlist(&input.respond_to_allowlist)?;
    if input.respond_to == Some(crate::managed_agents::RespondTo::Allowlist)
        && respond_to_allowlist.is_empty()
    {
        return Err(
            "respond-to mode 'allowlist' requires at least one pubkey in the allowlist".to_string(),
        );
    }
```

with:

```rust
    let respond_to_allowlist =
        crate::managed_agents::validate_respond_to_allowlist(&input.respond_to_allowlist)?;
    if input.respond_to == Some(crate::managed_agents::RespondTo::Allowlist)
        && respond_to_allowlist.is_empty()
    {
        return Err(
            "respond-to mode 'allowlist' requires at least one pubkey in the allowlist".to_string(),
        );
    }
    // Hire fields are validated here too, before any side effect, and stored
    // with the rest of the record in the one save below.
    let role_context = input
        .role_context
        .clone()
        .map(crate::managed_agents::normalize_role_context)
        .transpose()?;
    let work_dir = crate::managed_agents::normalize_work_dir(input.work_dir.as_deref())?;
```

Then, in the `ManagedAgentRecord` literal of `create_managed_agent` (its end, as Task 3.2 left it), replace:

```rust
            company_role: None,
            role_context: None,
            work_dir: None,
        };
```

with:

```rust
            company_role: None,
            role_context,
            work_dir,
        };
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::types)`
Expected: PASS (3 new `role_context` tests, 2 new request tests, all existing types tests, 0 failed). The run also compiles `commands/agents.rs` with the new bindings.

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/types/role_context.rs desktop/src-tauri/src/managed_agents/types.rs desktop/src-tauri/src/managed_agents/types/requests.rs desktop/src-tauri/src/managed_agents/types/tests.rs desktop/src-tauri/src/commands/agents.rs
git commit -s -m "feat(desktop): accept role context and work folder when creating an agent"
```

---

### Task 3.5: Start hired employees in their work folder with COLONY_ROLE_CONTEXT

`spawn_agent_child` (`runtime.rs:449`) sets the child cwd to `default_agent_workdir()` at `runtime.rs:601-604` and builds the env from about line 609 on. This task routes both through one helper, `apply_employee_launch`, which returns a proof token that `spawn_with_effort_proof` (`runtime.rs:430-435`) consumes, the same compile-time binding the effort projection already uses (`runtime.rs:395-436`). Deleting the call from the spawn path is then a compile error, not a silent regression. `default_agent_workdir()` and `get_agent_workspace_root` (`commands/agent_workspace.rs:7-38`) are not changed, so the Files tab keeps resolving against the nest exactly as today.

**Files:**
- Create: `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`
- Modify: `desktop/src-tauri/src/managed_agents/runtime.rs:29-30` (module), `:430-435` (`spawn_with_effort_proof`), `:601-604` (cwd), `:878` (spawn call)
- Modify: `desktop/src-tauri/src/managed_agents/reserved_env_keys.rs:70-71`
- Test: `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`

**Interfaces:**
- Consumes: Task 3.2 `ManagedAgentRecord.role_context`, `ManagedAgentRecord.work_dir`, `RoleContext`; existing `super::default_agent_workdir() -> Option<PathBuf>` (`managed_agents/mod.rs:138`), `append_log_marker`, `crate::managed_agents::env_vars::{is_reserved_env_key, merged_user_env}`.
- Produces (all `pub(crate)` in `runtime::employee_launch`): `ROLE_CONTEXT_ENV_VAR: &str = "COLONY_ROLE_CONTEXT"`; `role_context_env_value(Option<&RoleContext>) -> Result<Option<String>, String>` (camelCase JSON via `serde_json::to_string`); `resolve_agent_workdir(work_dir: Option<&str>, default_dir: Option<PathBuf>) -> Option<PathBuf>` (the saved folder when it is an absolute path to an existing directory, symlinks followed because the founder picked it, else `default_dir`); `apply_employee_launch(&mut Command, &ManagedAgentRecord, default_dir: Option<PathBuf>) -> Result<EmployeeLaunchApplied, String>` (sets `COLONY_ROLE_CONTEXT` or removes an inherited one, sets cwd); `EmployeeLaunchApplied::missing_work_dir() -> Option<&str>`. `spawn_with_effort_proof(cmd, effort, employee: EmployeeLaunchApplied)`. `COLONY_ROLE_CONTEXT` joins `RESERVED_ENV_KEYS`, so persona and agent env can neither set nor override it.

- [ ] **Step 1: Write the failing test**

Create `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs` with only its tests for now:

```rust
//! Launch inputs that make a managed agent a hired employee.

#[cfg(test)]
mod tests {
    use super::*;

    /// What a launch does with `key`: `None` when untouched, `Some(None)`
    /// when removed, `Some(Some(value))` when set.
    fn env_of(command: &Command, key: &str) -> Option<Option<String>> {
        command
            .get_envs()
            .find(|(name, _)| *name == std::ffi::OsStr::new(key))
            .map(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
    }

    fn record(role_context: Option<RoleContext>, work_dir: Option<String>) -> ManagedAgentRecord {
        let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
            "pubkey": "p",
            "name": "Ada",
            "relay_url": "",
            "acp_command": "buzz-acp",
            "agent_command": "claude",
            "agent_args": [],
            "mcp_command": "",
            "turn_timeout_seconds": 0,
            "system_prompt": null,
            "created_at": "",
            "updated_at": "",
            "last_started_at": null,
            "last_stopped_at": null,
            "last_exit_code": null,
            "last_error": null
        }))
        .expect("minimal record fixture parses");
        record.role_context = role_context;
        record.work_dir = work_dir;
        record
    }

    fn engineer() -> RoleContext {
        RoleContext {
            title: "Engineer".to_string(),
            job: "Fix bugs and ship roadmap items.".to_string(),
            owns: Some("Ship fixes".to_string()),
            ask_before: vec!["merge".to_string(), "deploy".to_string()],
            manager_name: Some("Sam".to_string()),
            home_channel_id: None,
            goal_id: None,
            on_hire_sources: vec!["code folder".to_string()],
            plan_horizon_days: 14,
        }
    }

    #[test]
    fn hired_employee_gets_its_role_context_and_starts_in_its_work_folder() {
        let folder = tempfile::tempdir().expect("work folder");
        let default = tempfile::tempdir().expect("default folder");
        let mut command = Command::new("true");

        let applied = apply_employee_launch(
            &mut command,
            &record(Some(engineer()), Some(folder.path().display().to_string())),
            Some(default.path().to_path_buf()),
        )
        .expect("launch applies");

        let exported = env_of(&command, ROLE_CONTEXT_ENV_VAR)
            .flatten()
            .expect("the role context is exported");
        let json: serde_json::Value = serde_json::from_str(&exported).expect("exported JSON");
        assert_eq!(json["title"], "Engineer");
        assert_eq!(json["askBefore"], serde_json::json!(["merge", "deploy"]));
        assert_eq!(json["planHorizonDays"], 14);
        // Every key is present, so the harness never depends on optional keys.
        assert_eq!(json["goalId"], serde_json::Value::Null);
        assert_eq!(command.get_current_dir(), Some(folder.path()));
        assert_eq!(applied.missing_work_dir(), None);
    }

    #[test]
    fn agent_without_a_role_context_never_inherits_one() {
        let default = tempfile::tempdir().expect("default folder");
        let mut command = Command::new("true");
        // What the environment Colony itself was launched with could hand down.
        command.env(ROLE_CONTEXT_ENV_VAR, r#"{"title":"Someone else"}"#);

        let applied = apply_employee_launch(
            &mut command,
            &record(None, None),
            Some(default.path().to_path_buf()),
        )
        .expect("launch applies");

        assert_eq!(
            env_of(&command, ROLE_CONTEXT_ENV_VAR),
            Some(None),
            "the key must be removed, not inherited"
        );
        assert_eq!(command.get_current_dir(), Some(default.path()));
        assert_eq!(applied.missing_work_dir(), None);
    }

    #[test]
    fn a_work_folder_that_is_not_a_folder_falls_back_and_is_reported() {
        let default = tempfile::tempdir().expect("default folder");
        let file = default.path().join("notes.txt");
        std::fs::write(&file, "not a folder").expect("write file");
        let missing = default.path().join("deleted-project");
        for saved in [
            missing.display().to_string(),
            file.display().to_string(),
            "relative/project".to_string(),
        ] {
            let mut command = Command::new("true");
            let applied = apply_employee_launch(
                &mut command,
                &record(None, Some(saved.clone())),
                Some(default.path().to_path_buf()),
            )
            .expect("launch applies");
            assert_eq!(command.get_current_dir(), Some(default.path()), "{saved}");
            assert_eq!(applied.missing_work_dir(), Some(saved.as_str()));
        }
    }

    #[test]
    fn role_context_env_is_reserved_from_persona_and_agent_env() {
        use crate::managed_agents::env_vars::{is_reserved_env_key, merged_user_env};
        assert!(is_reserved_env_key(ROLE_CONTEXT_ENV_VAR));
        let agent_env = std::collections::BTreeMap::from([(
            ROLE_CONTEXT_ENV_VAR.to_string(),
            r#"{"title":"Forged"}"#.to_string(),
        )]);
        assert!(merged_user_env(&std::collections::BTreeMap::new(), &agent_env).is_empty());
    }
}
```

Register the module in `desktop/src-tauri/src/managed_agents/runtime.rs`. Replace (lines 29-30):

```rust
mod setup_payload;
use setup_payload::apply_setup_payload_env;
```

with:

```rust
mod setup_payload;
use setup_payload::apply_setup_payload_env;

mod employee_launch;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::runtime::employee_launch)`
Expected: FAIL to compile with `error[E0425]: cannot find function apply_employee_launch in this scope` and `error[E0412]: cannot find type Command in this scope`.

- [ ] **Step 3: Implement the helper and reserve the key**

In `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`, replace the first line:

```rust
//! Launch inputs that make a managed agent a hired employee.
```

with:

```rust
//! Launch inputs that make a managed agent a hired employee: the role context
//! it reads from `COLONY_ROLE_CONTEXT` and the work folder it starts in.
//!
//! [`apply_employee_launch`] is the one place a spawn applies both. It returns
//! a proof that `spawn_with_effort_proof` consumes, so a spawn path that skips
//! it does not compile.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::managed_agents::{ManagedAgentRecord, RoleContext};

/// Env var carrying a hired employee's role context to the harness. Reserved
/// in `reserved_env_keys.rs`, so persona and agent env cannot override it.
pub(crate) const ROLE_CONTEXT_ENV_VAR: &str = "COLONY_ROLE_CONTEXT";

/// The exact `COLONY_ROLE_CONTEXT` value a launch exports: the role context as
/// camelCase JSON, or `None` for an agent that was not hired.
pub(crate) fn role_context_env_value(
    role_context: Option<&RoleContext>,
) -> Result<Option<String>, String> {
    role_context
        .map(|context| {
            serde_json::to_string(context)
                .map_err(|error| format!("cannot encode the role context: {error}"))
        })
        .transpose()
}

/// The folder a launch starts in: the saved work folder when it is an absolute
/// path to an existing folder, else `default_dir`.
pub(crate) fn resolve_agent_workdir(
    work_dir: Option<&str>,
    default_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    work_dir
        .map(Path::new)
        .filter(|path| path.is_absolute() && path.is_dir())
        .map(Path::to_path_buf)
        .or(default_dir)
}

/// Proof that [`apply_employee_launch`] ran on a spawn command. The private
/// field means only that function can make one.
#[must_use]
pub(crate) struct EmployeeLaunchApplied {
    missing_work_dir: Option<String>,
}

impl EmployeeLaunchApplied {
    /// The saved work folder when it is not a folder on this computer and the
    /// launch fell back to the default folder.
    pub(crate) fn missing_work_dir(&self) -> Option<&str> {
        self.missing_work_dir.as_deref()
    }
}

/// Export the record's role context, or remove one inherited from the
/// environment Colony was launched with, and start the process in the
/// record's work folder, falling back to `default_dir`.
pub(crate) fn apply_employee_launch(
    command: &mut Command,
    record: &ManagedAgentRecord,
    default_dir: Option<PathBuf>,
) -> Result<EmployeeLaunchApplied, String> {
    match role_context_env_value(record.role_context.as_ref())? {
        Some(value) => {
            command.env(ROLE_CONTEXT_ENV_VAR, value);
        }
        None => {
            command.env_remove(ROLE_CONTEXT_ENV_VAR);
        }
    }
    let workdir = resolve_agent_workdir(record.work_dir.as_deref(), default_dir);
    let missing_work_dir = record
        .work_dir
        .as_deref()
        .filter(|saved| workdir.as_deref() != Some(Path::new(saved)))
        .map(str::to_string);
    if let Some(dir) = workdir {
        command.current_dir(dir);
    }
    Ok(EmployeeLaunchApplied { missing_work_dir })
}
```

In `desktop/src-tauri/src/managed_agents/reserved_env_keys.rs`, replace (lines 70-71):

```rust
    "BUZZ_ACP_AGENT_OWNER",
    // Stable agent identity used for git attribution and private-conversation
```

with:

```rust
    "BUZZ_ACP_AGENT_OWNER",
    // Hired-employee role context: the title, job and ask-before limits the
    // founder approved at hire. User env must not swap in a different role.
    "COLONY_ROLE_CONTEXT",
    // Stable agent identity used for git attribution and private-conversation
```

- [ ] **Step 4: Wire it into the spawn**

In `desktop/src-tauri/src/managed_agents/runtime.rs`, replace the module lines from Step 1:

```rust
mod employee_launch;
```

with:

```rust
mod employee_launch;
use employee_launch::{apply_employee_launch, EmployeeLaunchApplied};
```

Replace the start of `spawn_with_effort_proof` (line 430, directly under its existing doc comment):

```rust
pub(crate) fn spawn_with_effort_proof(
    cmd: &mut std::process::Command,
    _effort: EffortApplied,
) -> std::io::Result<std::process::Child> {
    cmd.spawn()
}
```

with:

```rust
///
/// It also consumes the `EmployeeLaunchApplied` proof, so a spawn that skips
/// `apply_employee_launch` (role context and work folder) does not compile.
pub(crate) fn spawn_with_effort_proof(
    cmd: &mut std::process::Command,
    _effort: EffortApplied,
    _employee: EmployeeLaunchApplied,
) -> std::io::Result<std::process::Child> {
    cmd.spawn()
}
```

Replace the cwd block (lines 601-604):

```rust
    let mut command = std::process::Command::new(&resolved_acp_command);
    if let Some(home) = super::default_agent_workdir() {
        command.current_dir(home);
    }
```

with:

```rust
    let mut command = std::process::Command::new(&resolved_acp_command);
    // A hired employee starts in its work folder with its role context in
    // `COLONY_ROLE_CONTEXT`; every other agent starts in the default agent
    // folder with that key removed. `spawn_with_effort_proof` consumes the
    // returned proof, so deleting this call is a compile error.
    let employee_launch =
        apply_employee_launch(&mut command, record, super::default_agent_workdir())?;
    if let Some(missing) = employee_launch.missing_work_dir() {
        append_log_marker(
            &log_path,
            &format!(
                "work folder {missing} is not a folder on this computer; starting in the default agent folder"
            ),
        )?;
    }
```

Replace the spawn call (line 878):

```rust
    let child = spawn_with_effort_proof(&mut command, effort).map_err(|error| {
```

with:

```rust
    let child = spawn_with_effort_proof(&mut command, effort, employee_launch).map_err(|error| {
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::runtime managed_agents::env_vars)`
Expected: PASS (4 new `employee_launch` tests, existing runtime tests, and the env_vars reserved-key tests, which now cover `COLONY_ROLE_CONTEXT`; 0 failed).

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs desktop/src-tauri/src/managed_agents/runtime.rs desktop/src-tauri/src/managed_agents/reserved_env_keys.rs
git commit -s -m "feat(desktop): start hired employees in their work folder with COLONY_ROLE_CONTEXT"
```

---

### Task 3.6: Restart badge tracks role context and work folder

The harness reads `COLONY_ROLE_CONTEXT` and its cwd only at launch, so a change to either must raise "needs restart". `SpawnConfigSnapshot` (`spawn_snapshot.rs:101-154`) gains both. The role context is stored as the exact env string the launch exported (one leaf, shown as character counts because a job text can be as long as a prompt); the work folder is the configured value, which keeps the prospective snapshot free of disk reads (`spawn_snapshot.rs:290`).

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs` (proof carries the exported value)
- Modify: `desktop/src-tauri/src/managed_agents/runtime.rs` (re-export, `SpawnConfigInputs` literal at lines 841-852)
- Modify: `desktop/src-tauri/src/managed_agents/spawn_snapshot.rs:33-41`, `:78-83`, `:153-154`, `:183-193`, `:258-261`, `:339-352`
- Modify: `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff.rs:81`, `:111`
- Modify: `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff/tests.rs:31-34`, `:76`, `:125-128`
- Test: `desktop/src-tauri/src/managed_agents/spawn_snapshot/tests_ext.rs` (append), `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff/tests.rs`, `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`

**Interfaces:**
- Consumes: Task 3.5 `role_context_env_value`, `EmployeeLaunchApplied`; Task 3.2 record fields.
- Produces: `SpawnConfigSnapshot.role_context: Option<String>` and `.work_dir: Option<String>`; `SpawnConfigInputs.role_context: Option<&'a str>`; `EmployeeLaunchApplied::role_context_env() -> Option<&str>`; `runtime::role_context_env_value` re-exported `pub(crate)`. Restart diff fields `role_context` (kind `text`, character counts only) and `work_dir` (kind `value`, both paths shown). The TypeScript diff renderer humanizes any field path generically (`diff.rs:26-28`), so no UI change is required.

- [ ] **Step 1: Write the failing tests**

In `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff/tests.rs`, the coverage guard `mutation_table_covers_every_serialized_field` already fails for any snapshot field without a mutation row. Replace the end of `base()` (lines 31-34):

```rust
        effort_level: Some("high".into()),
        session_policy: "channel".into(),
    }
}
```

with:

```rust
        effort_level: Some("high".into()),
        session_policy: "channel".into(),
        role_context: Some(r#"{"title":"Engineer"}"#.into()),
        work_dir: Some("/Users/sam/code/app".into()),
    }
}
```

Replace the last mutation row (line 76):

```rust
        ("session_policy", |s| s.session_policy = "thread".into()),
```

with:

```rust
        ("session_policy", |s| s.session_policy = "thread".into()),
        ("role_context", |s| s.role_context = None),
        ("work_dir", |s| s.work_dir = None),
```

After `identical_snapshots_produce_no_entries` (lines 125-128):

```rust
#[test]
fn identical_snapshots_produce_no_entries() {
    assert!(diff(&base(), &base()).is_empty());
}
```

insert:

```rust

#[test]
fn role_context_reports_character_counts_only() {
    let mut after = base();
    after.role_context = Some(r#"{"title":"Lead engineer"}"#.into());
    assert_eq!(
        change_at(&diff(&base(), &after), "role_context"),
        &RestartChange::Text {
            before_chars: Some(r#"{"title":"Engineer"}"#.chars().count()),
            after_chars: Some(r#"{"title":"Lead engineer"}"#.chars().count()),
        }
    );
}

#[test]
fn work_dir_change_shows_both_folders() {
    let mut after = base();
    after.work_dir = Some("/Users/sam/code/app-v2".into());
    assert_eq!(
        change_at(&diff(&base(), &after), "work_dir"),
        &RestartChange::Value {
            before: Value::String("/Users/sam/code/app".into()),
            after: Value::String("/Users/sam/code/app-v2".into()),
        }
    );
}
```

Append to the end of `desktop/src-tauri/src/managed_agents/spawn_snapshot/tests_ext.rs`, after the last test (`definitionless_instance_retains_its_stored_session_policy`, which ends with):

```rust
    assert_eq!(
        crate::managed_agents::effective_acp_session_policy(&instance, &[]),
        AcpSessionPolicy::Thread
    );
}
```

Append:

```rust

use crate::managed_agents::RoleContext;

fn engineer_context(title: &str) -> RoleContext {
    RoleContext {
        title: title.to_string(),
        job: "Fix bugs and ship roadmap items.".to_string(),
        owns: Some("Ship fixes".to_string()),
        ask_before: vec!["merge".to_string()],
        manager_name: None,
        home_channel_id: None,
        goal_id: None,
        on_hire_sources: vec!["code folder".to_string()],
        plan_horizon_days: 14,
    }
}

/// The prospective snapshot of a record with these hire fields.
fn employee_snapshot(
    role_context: Option<RoleContext>,
    work_dir: Option<&str>,
) -> SpawnConfigSnapshot {
    let mut record = record();
    record.role_context = role_context;
    record.work_dir = work_dir.map(str::to_string);
    prospective_spawn_config_snapshot(
        &record,
        &[],
        &[],
        "wss://ws.example",
        &Default::default(),
        false,
    )
}

fn changed_fields(stamped: &SpawnConfigSnapshot, current: &SpawnConfigSnapshot) -> Vec<String> {
    policy_transition_diff(stamped, current)
        .into_iter()
        .map(|entry| entry.field)
        .collect()
}

#[test]
fn editing_an_employee_role_context_requires_restart() {
    let engineer = employee_snapshot(Some(engineer_context("Engineer")), None);
    let lead = employee_snapshot(Some(engineer_context("Lead engineer")), None);
    assert_eq!(changed_fields(&engineer, &lead), vec!["role_context"]);
    // Giving a running agent a role context for the first time also badges.
    let unhired = employee_snapshot(None, None);
    assert_eq!(changed_fields(&unhired, &engineer), vec!["role_context"]);
}

#[test]
fn moving_an_employee_work_folder_requires_restart() {
    let before = employee_snapshot(None, Some("/Users/sam/code/app"));
    let after = employee_snapshot(None, Some("/Users/sam/code/app-v2"));
    assert_eq!(changed_fields(&before, &after), vec!["work_dir"]);
}

#[test]
fn unchanged_hire_fields_do_not_require_restart() {
    let stamped = employee_snapshot(
        Some(engineer_context("Engineer")),
        Some("/Users/sam/code/app"),
    );
    let current = employee_snapshot(
        Some(engineer_context("Engineer")),
        Some("/Users/sam/code/app"),
    );
    assert!(changed_fields(&stamped, &current).is_empty());
    // An agent that was never hired keeps a clean snapshot.
    assert!(changed_fields(&employee_snapshot(None, None), &employee_snapshot(None, None)).is_empty());
}

#[test]
fn snapshot_records_the_exact_role_context_the_launch_exports() {
    let context = engineer_context("Engineer");
    let snapshot = employee_snapshot(Some(context.clone()), None);
    assert_eq!(
        snapshot.role_context,
        crate::managed_agents::runtime::role_context_env_value(Some(&context))
            .expect("the role context encodes")
    );
}
```

In `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`, in `hired_employee_gets_its_role_context_and_starts_in_its_work_folder`, replace:

```rust
        assert_eq!(command.get_current_dir(), Some(folder.path()));
        assert_eq!(applied.missing_work_dir(), None);
```

with:

```rust
        assert_eq!(command.get_current_dir(), Some(folder.path()));
        assert_eq!(applied.missing_work_dir(), None);
        assert_eq!(
            applied.role_context_env(),
            Some(exported.as_str()),
            "the snapshot must record exactly what the child received"
        );
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::spawn_snapshot managed_agents::runtime::employee_launch)`
Expected: FAIL to compile with `error[E0560]: struct SpawnConfigSnapshot has no field named role_context` and `error[E0599]: no method named role_context_env found for struct EmployeeLaunchApplied`.

- [ ] **Step 3: Carry the exported value on the proof**

In `desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs`, replace:

```rust
#[must_use]
pub(crate) struct EmployeeLaunchApplied {
    missing_work_dir: Option<String>,
}

impl EmployeeLaunchApplied {
```

with:

```rust
#[must_use]
pub(crate) struct EmployeeLaunchApplied {
    role_context_env: Option<String>,
    missing_work_dir: Option<String>,
}

impl EmployeeLaunchApplied {
    /// The exact `COLONY_ROLE_CONTEXT` value this launch exported, for the
    /// restart-badge snapshot.
    pub(crate) fn role_context_env(&self) -> Option<&str> {
        self.role_context_env.as_deref()
    }

```

Replace:

```rust
    match role_context_env_value(record.role_context.as_ref())? {
        Some(value) => {
            command.env(ROLE_CONTEXT_ENV_VAR, value);
        }
        None => {
            command.env_remove(ROLE_CONTEXT_ENV_VAR);
        }
    }
```

with:

```rust
    let role_context_env = role_context_env_value(record.role_context.as_ref())?;
    match &role_context_env {
        Some(value) => {
            command.env(ROLE_CONTEXT_ENV_VAR, value);
        }
        None => {
            command.env_remove(ROLE_CONTEXT_ENV_VAR);
        }
    }
```

Replace:

```rust
    Ok(EmployeeLaunchApplied { missing_work_dir })
```

with:

```rust
    Ok(EmployeeLaunchApplied {
        role_context_env,
        missing_work_dir,
    })
```

- [ ] **Step 4: Add the snapshot fields**

In `desktop/src-tauri/src/managed_agents/spawn_snapshot.rs`, replace the imports (lines 33-41):

```rust
use super::{
    effective_config::{resolve_effective_config, EffectiveConfigResult},
    known_acp_runtime, normalize_agent_args,
    persona_events::preview_prospective_persona_snapshot,
    readiness::EffectiveHarnessDescriptor,
    runtime::{resolve_session_title, SESSION_TITLE_ENV_VAR},
    types::{AgentDefinition, ManagedAgentRecord, TeamRecord},
    AcpSessionPolicy, GlobalAgentConfig,
};
```

with:

```rust
use super::{
    effective_config::{resolve_effective_config, EffectiveConfigResult},
    known_acp_runtime, normalize_agent_args,
    persona_events::preview_prospective_persona_snapshot,
    readiness::EffectiveHarnessDescriptor,
    runtime::{resolve_session_title, role_context_env_value, SESSION_TITLE_ENV_VAR},
    types::{AgentDefinition, ManagedAgentRecord, TeamRecord},
    AcpSessionPolicy, GlobalAgentConfig,
};
```

Replace the end of `SpawnConfigInputs` (lines 78-83):

```rust
    /// The effective ACP session policy (`channel`/`thread`) the launch applies.
    /// Resolved from the current linked definition at the shared launch
    /// boundary; captured here so editing the definition while an agent runs
    /// drives the existing restart-required path.
    pub session_policy: AcpSessionPolicy,
}
```

with:

```rust
    /// The effective ACP session policy (`channel`/`thread`) the launch applies.
    /// Resolved from the current linked definition at the shared launch
    /// boundary; captured here so editing the definition while an agent runs
    /// drives the existing restart-required path.
    pub session_policy: AcpSessionPolicy,
    /// The exact `COLONY_ROLE_CONTEXT` value the launch exports (see
    /// `runtime::employee_launch`), `None` for an agent that was not hired.
    pub role_context: Option<&'a str>,
}
```

Replace the end of `SpawnConfigSnapshot` (lines 153-154):

```rust
    pub session_policy: String,
}
```

with:

```rust
    pub session_policy: String,
    /// The `COLONY_ROLE_CONTEXT` JSON this launch exports. The harness reads
    /// it only at launch, so a role change must raise the restart badge.
    /// Shown as character counts only (see `diff::policy_for`).
    pub role_context: Option<String>,
    /// The work folder saved on the record. The configured value, not the
    /// resolved one, so the prospective snapshot never reads the disk.
    pub work_dir: Option<String>,
}
```

Replace the destructuring in `from_inputs` (lines 183-193):

```rust
        let SpawnConfigInputs {
            record,
            descriptor,
            relay_url,
            team_instructions,
            system_prompt,
            model,
            provider,
            enforced_owner_only,
            session_policy,
        } = inputs;
```

with:

```rust
        let SpawnConfigInputs {
            record,
            descriptor,
            relay_url,
            team_instructions,
            system_prompt,
            model,
            provider,
            enforced_owner_only,
            session_policy,
            role_context,
        } = inputs;
```

Replace the end of the struct expression in `from_inputs` (lines 258-261):

```rust
            effort_level: effective_effort(descriptor),
            session_policy: session_policy.as_str().to_string(),
        }
    }
```

with:

```rust
            effort_level: effective_effort(descriptor),
            session_policy: session_policy.as_str().to_string(),
            role_context: role_context.map(str::to_string),
            work_dir: record.work_dir.clone(),
        }
    }
```

Replace the end of `prospective_spawn_config_snapshot` (lines 339-352):

```rust
    SpawnConfigSnapshot::from_inputs(SpawnConfigInputs {
        record,
        descriptor: &descriptor,
        // Resolved, not stored: every record spawns on the workspace relay
        // (legacy pins ignored), so a workspace relay change must badge.
        relay_url: &crate::relay::effective_agent_relay_url(&record.relay_url, workspace_relay),
        team_instructions: effective_team_instructions(record, teams).as_deref(),
        system_prompt: prompt.as_deref(),
        model: model.as_deref(),
        provider: provider.as_deref(),
        enforced_owner_only,
        session_policy: record.session_policy,
    })
}
```

with:

```rust
    // The same encoding the spawn exports. It cannot fail for this struct; if
    // it ever did, the spawn would refuse to start, so the badge shows a
    // change instead of hiding one.
    let role_context = role_context_env_value(record.role_context.as_ref())
        .unwrap_or_else(|error| Some(format!("unencodable role context: {error}")));

    SpawnConfigSnapshot::from_inputs(SpawnConfigInputs {
        record,
        descriptor: &descriptor,
        // Resolved, not stored: every record spawns on the workspace relay
        // (legacy pins ignored), so a workspace relay change must badge.
        relay_url: &crate::relay::effective_agent_relay_url(&record.relay_url, workspace_relay),
        team_instructions: effective_team_instructions(record, teams).as_deref(),
        system_prompt: prompt.as_deref(),
        model: model.as_deref(),
        provider: provider.as_deref(),
        enforced_owner_only,
        session_policy: record.session_policy,
        role_context: role_context.as_deref(),
    })
}
```

In `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff.rs`, replace (line 81):

```rust
        "system_prompt" | "team_instructions" => MaskPolicy::Text,
```

with:

```rust
        // The role context is the employee's job, limits and sources as JSON:
        // as long as a prompt, so it is shown as character counts too.
        "system_prompt" | "team_instructions" | "role_context" => MaskPolicy::Text,
```

Replace (line 111):

```rust
        _ => MaskPolicy::Plain,
```

with:

```rust
        //   work_dir                            : the folder the founder chose
        _ => MaskPolicy::Plain,
```

- [ ] **Step 5: Feed the spawn's exported value into the stamped snapshot**

In `desktop/src-tauri/src/managed_agents/runtime.rs`, replace:

```rust
mod employee_launch;
use employee_launch::{apply_employee_launch, EmployeeLaunchApplied};
```

with:

```rust
mod employee_launch;
pub(crate) use employee_launch::role_context_env_value;
use employee_launch::{apply_employee_launch, EmployeeLaunchApplied};
```

Replace the end of the `SpawnConfigInputs` literal in `spawn_agent_child` (lines 849-852):

```rust
            enforced_owner_only: super::owner_only_access_build(),
            session_policy: acp_session_policy,
        },
    );
```

with:

```rust
            enforced_owner_only: super::owner_only_access_build(),
            session_policy: acp_session_policy,
            role_context: employee_launch.role_context_env(),
        },
    );
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib -- managed_agents::spawn_snapshot managed_agents::runtime::employee_launch)`
Expected: PASS (`every_field_mutation_drifts_the_canonical_value_and_names_that_field` and `mutation_table_covers_every_serialized_field` now include both new fields; the 2 new diff tests, the 4 new badge tests and the employee_launch tests ok; 0 failed).

- [ ] **Step 7: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/runtime/employee_launch.rs desktop/src-tauri/src/managed_agents/runtime.rs desktop/src-tauri/src/managed_agents/spawn_snapshot.rs desktop/src-tauri/src/managed_agents/spawn_snapshot/diff.rs desktop/src-tauri/src/managed_agents/spawn_snapshot/diff/tests.rs desktop/src-tauri/src/managed_agents/spawn_snapshot/tests_ext.rs
git commit -s -m "feat(desktop): restart badge tracks role context and work folder"
```

---

### Task 3.7: Voice rules in the nest skill and the managed AGENTS.md section

`nest_skill.md:141-148` tells agents messages are GitHub-flavored Markdown with "tables, blockquotes, headings", which contradicts voice rule 2. The skill and the managed section of `AGENTS.md` get the shared voice rules the same way they carry the web rules: the skill concatenates the file (`nest.rs:53-57`) and the managed section renders the constant (`nest.rs:679-683`). The skill file is static, so `NEST_SKILL_VERSION` (`nest.rs:71`) goes from 8 to 9; the managed section is rewritten on every launch and needs no template bump.

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/nest.rs:46-57`, `:68-71`, `:680-683`, `:1029-1030`
- Modify: `desktop/src-tauri/src/managed_agents/nest_skill.md:141-148`
- Create: `desktop/src-tauri/src/managed_agents/nest/voice_rules_tests.rs`
- Test: `desktop/src-tauri/src/managed_agents/nest/voice_rules_tests.rs`, plus the existing `nest::web_task_rules_tests` and `nest::brand_guard_tests`

**Interfaces:**
- Consumes: Part 2 `buzz_acp::VOICE_RULES` and `crates/buzz-acp/src/voice.md`.
- Produces: `COLONY_CLI_SKILL_MD` = `nest_skill.md` + voice rules + web task rules (web rules stay last, so `cli_skill_ends_with_the_shared_rules` keeps passing); `NEST_SKILL_VERSION = 9`; `render_dynamic_section` output = roster, workspace, voice rules, web task rules.

- [ ] **Step 1: Write the failing tests**

Create `desktop/src-tauri/src/managed_agents/nest/voice_rules_tests.rs`:

```rust
//! The voice rules reach every file Colony writes for agents to read.
//!
//! The rules have one copy, `voice.md` in buzz-acp, exported as
//! [`buzz_acp::VOICE_RULES`]. These tests go through the real writers
//! ([`ensure_nest_at`], [`render_dynamic_section`], [`upsert_managed_section`])
//! so dropping the rules from any of them fails here.

use super::*;
use std::collections::HashSet;

fn voice() -> &'static str {
    buzz_acp::VOICE_RULES.trim_end()
}

/// The text of the `heading` section, up to the next `## ` heading.
fn section_of<'a>(text: &'a str, heading: &str) -> &'a str {
    let start = text.find(heading).expect("the section exists");
    let rest = &text[start + heading.len()..];
    &rest[..rest.find("\n## ").unwrap_or(rest.len())]
}

#[test]
fn cli_skill_carries_the_voice_rules_once_before_the_web_rules() {
    assert_eq!(COLONY_CLI_SKILL_MD.matches(voice()).count(), 1);
    let voice_at = COLONY_CLI_SKILL_MD
        .find(voice())
        .expect("the voice rules are in the skill");
    let web_at = COLONY_CLI_SKILL_MD
        .find(buzz_acp::WEB_TASK_RULES.trim_end())
        .expect("the web rules are in the skill");
    assert!(
        voice_at < web_at,
        "the skill ends with the web rules, the same order as the base prompt"
    );
}

#[test]
fn message_formatting_follows_the_voice_rules() {
    let section = section_of(COLONY_CLI_SKILL_MD, "## Message Formatting");
    assert!(
        section.contains("no headings, tables or bullet walls in chat"),
        "the formatting guidance must state voice rule 2: {section}"
    );
    assert!(
        !section.contains("tables, blockquotes, headings"),
        "the skill must no longer recommend tables and headings for messages"
    );
    assert!(!COLONY_CLI_SKILL_MD.contains('\u{2014}'), "no em dashes");
}

#[test]
fn fresh_nest_skill_carries_the_voice_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    let skill = fs::read_to_string(root.join(CANONICAL_SKILL_DIR).join("SKILL.md")).unwrap();
    assert!(skill.contains(voice()));
}

#[test]
fn skill_written_by_1_0_7_is_regenerated_with_the_voice_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What 1.0.7 left on disk: a skill without the voice rules, at version 8.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(
        skill_dir.join("SKILL.md"),
        "# Colony CLI Skill\n\nWritten by 1.0.7.\n",
    )
    .unwrap();
    fs::write(skill_dir.join(".skill-version"), "8\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains(voice()),
        "adding the voice rules must bump NEST_SKILL_VERSION past 8 so 1.0.7 nests pick them up"
    );
}

#[test]
fn managed_agents_md_section_carries_the_voice_rules_once() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();
    let agents_md = root.join("AGENTS.md");

    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&agents_md, &managed).unwrap();

    let written = fs::read_to_string(&agents_md).unwrap();
    let begin = written.find(BEGIN_LINE).expect("managed section opens");
    let end = written.find(END_MARKER).expect("managed section closes");
    assert!(
        written[begin..end].contains(voice()),
        "the voice rules live in the managed section"
    );
    assert_eq!(written.matches(voice()).count(), 1);
}
```

Register it in `desktop/src-tauri/src/managed_agents/nest.rs`. Replace (lines 1029-1030):

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

- [ ] **Step 2: Run it and confirm it fails**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest::voice_rules_tests)`
Expected: FAIL: all 5 tests, for example `cli_skill_carries_the_voice_rules_once_before_the_web_rules` with "assertion `left == right` failed, left: 0, right: 1" and `skill_written_by_1_0_7_is_regenerated_with_the_voice_rules` with "adding the voice rules must bump NEST_SKILL_VERSION past 8".

- [ ] **Step 3: Implement**

In `desktop/src-tauri/src/managed_agents/nest.rs`, replace (lines 46-57):

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
/// It ends with the voice rules and then the web task rules, the same order
/// as every agent's base prompt. Their one copies are `voice.md` and
/// `web_tasks.md` in buzz-acp ([`buzz_acp::VOICE_RULES`],
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

Replace (lines 70-71):

```rust
/// Version 8 added the web task rules (see [`COLONY_CLI_SKILL_MD`]).
const NEST_SKILL_VERSION: u32 = 8;
```

with:

```rust
/// Version 8 added the web task rules (see [`COLONY_CLI_SKILL_MD`]).
/// Version 9 added the voice rules and aligned Message Formatting with them.
const NEST_SKILL_VERSION: u32 = 9;
```

Replace (lines 680-683):

```rust
    // The web task rules ride in the managed section, which every launch
    // rewrites, so existing nests pick up a change without a template bump.
    let web_task_rules = buzz_acp::WEB_TASK_RULES.trim_end();
    format!("{active_agents}\n\n## Workspace\n- Relay: {relay_url}\n\n{web_task_rules}")
```

with:

```rust
    // The voice and web task rules ride in the managed section, which every
    // launch rewrites, so existing nests pick up a change without a template
    // bump.
    let voice_rules = buzz_acp::VOICE_RULES.trim_end();
    let web_task_rules = buzz_acp::WEB_TASK_RULES.trim_end();
    format!(
        "{active_agents}\n\n## Workspace\n- Relay: {relay_url}\n\n{voice_rules}\n\n{web_task_rules}"
    )
```

In `desktop/src-tauri/src/managed_agents/nest_skill.md`, replace (lines 141-148):

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

Messages render as Markdown on desktop and mobile, but chat is a conversation: no headings, tables or bullet walls in chat. Use Markdown for code blocks and links only, and follow the voice rules below.

- **Fenced code blocks**: triple-backtick with a language tag for syntax highlighting (190+ languages supported). Omitting the language tag renders a styled monochrome block.
- **Inline code**: single backticks for inline monospace.
- **Links**: plain Markdown links. Long content (plans, research, drafts) goes into a work item, canvas or doc, and the message is one line plus its link.
- **Mentions**: plain `@name` , do NOT bold or italicize (formatting prevents alert delivery).
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib managed_agents::nest)`
Expected: PASS (5 new voice tests; `web_task_rules_tests` unchanged and green, including `cli_skill_ends_with_the_shared_rules`; `brand_guard_tests` green with the voice rules now in the skill and the managed section; `marker_tests` and `render_tests` green; 0 failed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/nest.rs desktop/src-tauri/src/managed_agents/nest_skill.md desktop/src-tauri/src/managed_agents/nest/voice_rules_tests.rs
git commit -s -m "feat(desktop): carry the voice rules in the nest skill and managed AGENTS.md"
```

---

### Task 3.8: Part 3 verification

**Files:**
- Test: whole desktop Tauri crate

**Interfaces:**
- Consumes: Tasks 3.1 to 3.7.
- Produces: a branch whose desktop Rust lane matches CI (`just desktop-tauri-test`, `just desktop-tauri-clippy`, the file-size ratchet).

- [ ] **Step 1: Format**

Run: `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --all && cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --all -- --check`
Expected: the check exits 0.

- [ ] **Step 2: Full desktop lib tests**

Run: `just _ensure-sidecar-stubs && (cd desktop/src-tauri && cargo test -p buzz-desktop --no-default-features --features electron-host --lib)`
Expected: PASS, 0 failed. This is the suite CI runs; it covers the 26 files Task 3.2 touched.

- [ ] **Step 3: Clippy as CI runs it**

Run: `just desktop-tauri-clippy`
Expected: exits 0 with no warnings (it runs with `-D warnings`, with and without `mesh-llm`).

- [ ] **Step 4: File sizes and em dashes**

Run: `git fetch origin develop && CHECK_FILE_SIZES_BASE=origin/develop node desktop/scripts/check-file-sizes.mjs`
Expected: exits 0 (`discovery/tests.rs` shrank; no file over 1500 lines grew).

Run: `git diff origin/develop -- desktop/src-tauri | grep '^+' | grep -c $'\xe2\x80\x94'`
Expected: prints `0`.

- [ ] **Step 5: Commit formatting fixes, if any**

```bash
git status --short desktop/src-tauri
git add desktop/src-tauri/src
git commit -s -m "style(desktop): format employee base changes"
```

Skip this step when `git status` shows nothing to commit.

---

## Decisions and risks for the reviewer

1. **The work folder replaces the nest as the spawn cwd, as the spec asks (`runtime.rs:601-604`), and that has side effects outside this slice.** Agents find the colony-cli skill and the nest `AGENTS.md` through their cwd: the skill lives in the nest (`nest.rs:102` and `ensure_skill_symlinks`), the pi adapter is launched with `--skill <cwd>/.agents/skills` (`crates/buzz-acp/src/acp.rs:503-506`), and the base prompt tells agents their `PLANS/`, `WORK_LOGS/` and `.scratch/` folders are in their working directory (`crates/buzz-acp/src/base_prompt.md:86-103`). An employee started in the founder's repo therefore loses the colony-cli skill and the nest roster, and may write workspace folders into the repo. The Files tab still resolves agent links against the nest (`commands/agent_workspace.rs:31-37`, kept unchanged as the brief requires), so relative links an employee posts from its repo will not open. Part 2's persisted per-agent wake-up floor must not be stored relative to the cwd for the same reason. The real-run gate (Test Engineer, `workFolder: required`) will exercise all of this.
2. **Store safety.** `CompanyRoleMetadata` keeps `deny_unknown_fields`, so a stored role with a key from a newer build would otherwise fail the whole `managed-agents.json` load (`storage.rs:242-263`). The new record fields use a lenient deserializer that degrades only that field to `None`, the same rule `AcpSessionPolicy` follows (`session_policy.rs:40-51`, guarded by `types/tests.rs:500-511`).
3. **Fixture lifecycle.** With the flag off, a Test Engineer stored by an earlier flagged launch is demoted to an ordinary persona, not removed, so a hired Test Engineer is never orphaned (`personas.rs:258-269`).
4. **No edit path for the hire fields after creation.** `UpdateManagedAgentRequest` is unchanged, so `work_dir` and `role_context` are set only at hire; the restart badge for them is in place for when an edit path exists.
5. **COLONY_ROLE_CONTEXT is local only.** Provider (remote) backends do not receive it; cloud-run employees are out of scope.
