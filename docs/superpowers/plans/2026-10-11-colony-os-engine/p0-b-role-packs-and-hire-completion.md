# Part B (phase 0): role pack v2 and hire completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-overview.md` in this folder first: its contract and global constraints apply to every task here.

**Goal:** A completed hire creates everything a new employee needs to start working on its own: the role pack v2 fields describe the job, and the relay's `complete` transaction writes the employee's goal, one routine per role duty plus the built-in "Plan check" routine (each with its schedule workflow), and exactly one on-hire kickoff message, all or nothing.

**Architecture:** buzz-core gains the role pack v2 types, the `timeZone` field on the hire `complete` action, a hire as the alternative source of a duty head, and two pure builders (`hire_goal_record`, `hire_duty_proposals`). The relay's existing hire `complete` transaction (`crates/buzz-relay/src/handlers/company_hires.rs`) calls three new in-transaction helpers (goal, routines with workflows, kickoff) before it commits, and fans the stored records out after commit. A new buzz-db helper stores the kickoff with its `p`-tag mention index in the same transaction, so an employee that starts later still finds it.

**Tech Stack:** Rust (serde, sqlx on Postgres, nostr), cargo-nextest with the `postgres-ci` profile for relay database tests.

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md` (sections 4 and 7) and `docs/superpowers/specs/2026-10-11-colony-os-screens/10-data-and-engine.md` (engine items E-09 and E-10). Contract: `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md`, section "Role pack v2, hire completion and role context".

## Global Constraints

- The overview's global constraints apply in full (no em dashes, no new `unwrap()` or `expect()` in production code, no `unsafe`, doc comments on new public API, `git commit -s`, PRs into `develop` only).
- Old records keep parsing: a role pack without v2 fields keeps its exact JSON shape, and an ask-sourced duty head keeps parsing and validating.
- The built-in routine is "Plan check", scheduled "Every Monday at 09:00" (overview, section "Role pack v2").
- There is no `workFolder` field and no `RoleWorkFolder` type (overview: no launch role needs a folder on the computer). A role pack that carries `workFolder` is rejected as an unknown key.
- Old desktop TypeScript parsers are not changed; desktops at 1.0.7 or older may reject records with new keys (overview, accepted).
- Final hire approval, employee attachment and `complete` stay owner-only in this part; partners approving hires is engine item E-19 (phase 3).
- Ask head `p` tags are not in this part (part F owns them).
- Relay database tests live in a module named `postgres_tests`, carry `#[ignore = "requires disposable Postgres"]`, and run through `scripts/postgres-test-run.sh` (the `postgres-ci` nextest profile selects `postgres_tests::` paths, `.config/nextest.toml`).

## Review Focus

1. **Any failure after the hire head moves must store nothing.** A goal already at the hire id, an employee or owner that is not a member of the home channel, or a time zone the schedule engine does not know must reject `complete` and leave the hire approved with no member position, goal, routine, workflow or kickoff. Pinned by `a_goal_at_the_hire_id_rolls_back_the_whole_completion` (Task 2.5), `an_employee_outside_the_home_channel_rolls_back_the_goal_and_the_hire`, `a_founder_outside_the_home_channel_cannot_complete_the_hire` and `an_unknown_time_zone_rolls_back_the_completion` (Task 2.6), all through `assert_completion_left_nothing`, which gains the kickoff check in Task 2.7.
2. **A replayed or repeated `complete` never creates a second goal, routine set or kickoff.** The host's hire journal (part D) retries `complete` after a crash, so this is the relay half of overview Review Focus 1. Pinned by `complete_publishes_exactly_one_workflow_tagged_kickoff` (Task 2.7).
3. **Records written before this change keep working.** Pinned by `role_pack_v2_round_trips_and_v1_packs_keep_their_exact_shape` (Task 2.1), `ask_sourced_heads_keep_parsing_and_hire_heads_omit_ask_keys` (Task 2.3) and `a_v1_role_pack_gets_a_title_goal_and_only_the_utc_plan_check_routine` (Task 2.6).
4. **An employee that was offline when it was hired still finds its kickoff.** The kickoff must be indexed under the employee's `p` tag in the same transaction. Pinned by the `kickoffs` helper in Task 2.7, which reads through the `#p` mention index the same way part C's catch-up does.
5. **A role pack accepted at `create` can never fail routine validation at `complete`.** Role duty limits must sit inside duty limits (schedule text at most 180 characters and parseable, title 120 against 180, instructions 2000 against 4000). Pinned by the "padded schedule over 180" and "unsupported schedule" cases in `role_pack_v2_rejects_each_field_rule` (Task 2.1) and by `hire_duty_proposals` validating each built routine (Task 2.4).

## Before you start

- Work on a branch from `origin/develop` (this plan was checked against commit `64534835d`). Activate the pinned toolchain first: `. ./bin/activate-hermit`.
- Pre-commit hooks reformat Rust and re-stage. If a hook rewrites files, run the same `git commit -s` again.
- Tasks 2.5 to 2.7 need Postgres and Redis (`docker compose up -d postgres redis`), cargo-nextest 0.9.136 (`.config/nextest.toml:1`), the PostgreSQL client tools (`psql`, `createdb`, `dropdb`) on `PATH` or in `PG_BIN_DIR`, and this environment (local values from `docker-compose.yml:8-13,36-37`; CI sets the same names in `.github/workflows/_ci-relay.yml`):

```bash
export PGHOST=localhost PGPORT=5432 PGUSER=buzz PGPASSWORD=buzz_dev
export BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres
export REDIS_URL=redis://localhost:6379
```

  `scripts/postgres-test-run.sh` runs `cargo nextest run --profile postgres-ci --run-ignored ignored-only "$@"` (`scripts/postgres-test-run.sh:79-82`), and the wrapper exports `BUZZ_TEST_DATABASE_URL` for each test (`scripts/postgres-test-wrapper.sh:89`), so the new module needs no registration.

## Design decisions in this part (read before Task 2.5)

1. **The kickoff is stored inside the hire transaction and fanned out after commit.** Publishing a fresh event after commit has no durable retry if the process dies between commit and publish (AGENTS.md rule 1). The kickoff is inserted in the same transaction as the hired head, with its thread row and its `p`-tag mention index, and dispatched after commit. The mention index matters: an employee that was offline catches up with a `#p` query, and `#p` reads join `event_mentions` (`crates/buzz-db/src/store/event.rs:54-56`). `insert_mentions_in_transaction` is crate-private in buzz-db (`crates/buzz-db/src/lib.rs:60-63`), so Task 2.7 adds one public buzz-db helper next to `insert_event_with_thread_metadata_in_transaction` (`crates/buzz-db/src/store/event.rs:1513-1521`).
2. **Exactly once per hire.** The hire head moves from `approved` to `hired` once, under the hire advisory lock and an expected-revision replacement (`crates/buzz-relay/src/handlers/company_hires.rs:152-159,397-416`). The goal, routines, workflows and kickoff share that transaction, so each is written once. A replayed `complete` returns the stored duplicate result (`company_hires.rs:163-174`); a second `complete` meets a `hired` head and is rejected with "founder sign-off is required before hiring" (`company_hires.rs:790` before the transaction, `:320` inside it). Task 2.7 proves both.
3. **The owner must be a member of the home channel.** A routine's workflow is owned by the owner, the workflow engine checks the owner's current channel role before it runs (`crates/buzz-workflow/src/lib.rs:151-174`), and the AskAgent sink re-checks it (`crates/buzz-relay/src/workflow_sink.rs:559-567`). Completion therefore rejects a home channel the owner is not in, instead of creating routines that never run.
4. **Goal title from a long `owns`.** `owns` may be 500 characters but a goal title is at most 180 (`crates/buzz-core/src/company_records.rs:26`, `validate_goal_record` at 1437-1445). The goal title is `owns` cut at the last whole word that fits, plus `...`; the done condition keeps the full `owns`.
5. **Routine provenance.** Routine ids are new v4 UUIDs (the workflow id equals the duty id, as for ask-approved duties). `proposedByPubkey` is the hire's proposer, `approvedByPubkey` and the workflow owner are the owner who signed `complete`, `sourceHireId` is the hire id.
6. **Role duty `scheduleText` is capped at 180 characters** (`MAX_DUTY_SCHEDULE_CHARS`, `crates/buzz-core/src/company_duties.rs:11`), so a pack accepted at `create` cannot fail duty validation at `complete`.
7. **Validation order in `complete`:** hire head, member position, goal, routines with workflows, kickoff, commit. A failure at any step rolls back every earlier write.
8. **The relay-signed `buzz:workflow` tag keeps the kickoff from triggering message workflows** (`crates/buzz-relay/src/handlers/event.rs:520-531`), and it is what the employee's author gate accepts as a wake from its owner (`crates/buzz-acp/src/lib.rs:258-321`: kind 9, signed by the relay, exactly one `buzz:workflow`, one `buzz:workflow-owner`, and a `buzz:workflow-mention` naming the employee).

## File map

| File | Responsibility | Tasks |
|-|-|-|
| `crates/buzz-core/src/company_records.rs` | Role pack v2 types and validation, `HireAction.time_zone`, goal and routine builders for a completed hire | 2.1, 2.2, 2.4 |
| `crates/buzz-core/src/company_duties.rs` | Duty head source (ask or hire), public time zone label check | 2.2, 2.3 |
| `crates/buzz-db/src/store/event.rs` | Insert a relay-authored message with its mention index in a caller transaction | 2.7 |
| `crates/buzz-relay/src/handlers/company_records.rs` | Create a completed hire's goal in the hire transaction | 2.5 |
| `crates/buzz-relay/src/handlers/company_duties.rs` | Create a completed hire's routines and workflows in the hire transaction | 2.3, 2.6 |
| `crates/buzz-relay/src/handlers/company_hires.rs` | Call the three helpers inside `complete`, dispatch after commit, build the kickoff | 2.2, 2.5, 2.6, 2.7 |
| `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs` (new) | Postgres-backed tests of hire completion through the production handler | 2.5, 2.6, 2.7 |
| `crates/buzz-test-client/tests/e2e_company_hire.rs`, `e2e_company_duties_lessons.rs` | Struct literals and assertions that follow the type changes | 2.1, 2.2, 2.3 |
| `docs/company-records.md` | The written contract for other clients | 2.8 |

---

### Task 2.1: Role pack v2 fields and validation (buzz-core)

**Files:**
- Modify: `crates/buzz-core/src/company_records.rs:675-704` (new types after `struct HireTool`, new `HireRolePack` fields)
- Modify: `crates/buzz-core/src/company_records.rs:838-933` (`validate_role_pack_v2`, called from `validate_hire_proposal`)
- Modify: `crates/buzz-core/src/company_records.rs:2531-2555` (test fixture `hire_proposal`)
- Modify: `crates/buzz-test-client/tests/e2e_company_hire.rs:127-138` (struct literal)
- Test: `crates/buzz-core/src/company_records.rs` (`mod tests`, from line 2438)

**Interfaces:**
- Consumes: `crate::company_duties::parse_readable_schedule(&str) -> Option<String>` (`company_duties.rs:242`), `crate::company_duties::MAX_DUTY_SCHEDULE_CHARS` (`company_duties.rs:11`), the private `require_text` and `char_len` (`company_records.rs:1375-1385`).
- Produces: `pub struct RoleDutyTemplate { pub title: String, pub schedule_text: String, pub instructions: String }` (serde camelCase, `deny_unknown_fields`); `pub struct RoleOnHire { pub sources: Vec<String>, pub plan_horizon_days: u8 }` (`planHorizonDays` defaults to 14); `pub fn default_plan_horizon_days() -> u8`; `HireRolePack` gains `owns: Option<String>`, `channel: Option<String>`, `duties: Vec<RoleDutyTemplate>`, `on_hire: Option<RoleOnHire>`, `ask_before: Vec<String>`, `home: Option<String>` (JSON `owns`, `channel`, `duties`, `onHire`, `askBefore`, `home`, each omitted when empty). `validate_hire_proposal` enforces: `owns` 1 to 500 characters; `channel` 1 to 80 characters of `a-z`, `0-9` and `-`; at most 8 duties (title 1 to 120, a parseable `scheduleText` of at most 180, instructions 1 to 2000); at most 8 `onHire` sources of 1 to 200 characters and `planHorizonDays` 1 to 30; at most 16 `askBefore` entries of 1 to 120 characters; `home` 1 to 80 characters.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/buzz-core/src/company_records.rs`, directly after the `hire_proposal()` fixture (which ends at line 2555):

```rust
    fn v2_role_pack() -> HireRolePack {
        HireRolePack {
            owns: Some("Show up well on social media every week".into()),
            channel: Some("social".into()),
            duties: vec![RoleDutyTemplate {
                title: "Next week's posts".into(),
                schedule_text: "Every Monday at 10:00".into(),
                instructions: "Draft next week's posts as one batch and send them for approval."
                    .into(),
            }],
            on_hire: Some(RoleOnHire {
                sources: vec!["instagram profile".into(), "product photos".into()],
                plan_horizon_days: 14,
            }),
            ask_before: vec!["anything public".into(), "prices".into()],
            home: Some("social.calendar".into()),
            ..hire_proposal().role_pack
        }
    }

    fn assert_role_pack_rejected(rule: &str, mutate: impl FnOnce(&mut HireRolePack)) {
        let mut proposal = hire_proposal();
        proposal.role_pack = v2_role_pack();
        mutate(&mut proposal.role_pack);
        assert!(
            validate_hire_proposal(&proposal).is_err(),
            "{rule} must be rejected"
        );
    }

    #[test]
    fn role_pack_v2_round_trips_and_v1_packs_keep_their_exact_shape() {
        let v1 = hire_proposal().role_pack;
        let v1_json = serde_json::to_value(&v1).expect("serialize v1 pack");
        let v1_keys = v1_json
            .as_object()
            .expect("role pack object")
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            v1_keys,
            BTreeSet::from(["job", "personaId", "skills", "title", "tools", "workerMenu"])
        );
        assert_eq!(
            serde_json::from_value::<HireRolePack>(v1_json).expect("v1 pack parses"),
            v1
        );

        let v2 = v2_role_pack();
        let v2_json = serde_json::to_value(&v2).expect("serialize v2 pack");
        assert_eq!(v2_json["owns"], "Show up well on social media every week");
        assert_eq!(v2_json["channel"], "social");
        assert_eq!(v2_json["duties"][0]["scheduleText"], "Every Monday at 10:00");
        assert_eq!(v2_json["onHire"]["planHorizonDays"], 14);
        assert_eq!(v2_json["askBefore"][1], "prices");
        assert_eq!(v2_json["home"], "social.calendar");
        assert_eq!(
            serde_json::from_value::<HireRolePack>(v2_json.clone()).expect("v2 pack parses"),
            v2
        );

        let defaulted: RoleOnHire =
            serde_json::from_str(r#"{"sources":["website"]}"#).expect("horizon defaults");
        assert_eq!(defaulted.plan_horizon_days, 14);
        assert_eq!(default_plan_horizon_days(), 14);
        assert!(serde_json::from_str::<RoleOnHire>(r#"{"sources":[],"extra":1}"#).is_err());
        assert!(serde_json::from_str::<RoleDutyTemplate>(
            r#"{"title":"a","scheduleText":"Every day at 09:00","instructions":"b","extra":1}"#
        )
        .is_err());
        let mut unknown = serde_json::to_value(hire_proposal().role_pack).expect("pack json");
        unknown["futureKey"] = serde_json::json!(true);
        assert!(serde_json::from_value::<HireRolePack>(unknown).is_err());
        let mut with_folder = v2_json;
        with_folder["workFolder"] = serde_json::json!("required");
        assert!(
            serde_json::from_value::<HireRolePack>(with_folder).is_err(),
            "workFolder is not part of the role pack format"
        );
    }

    #[test]
    fn role_pack_v2_fields_accept_their_bounds() {
        let mut proposal = hire_proposal();
        proposal.role_pack = v2_role_pack();
        assert!(validate_hire_proposal(&proposal).is_ok());
        let template = RoleDutyTemplate {
            title: "t".repeat(120),
            schedule_text: "Every Friday at 17:30".into(),
            instructions: "i".repeat(2000),
        };
        proposal.role_pack.owns = Some("o".repeat(500));
        proposal.role_pack.channel = Some(format!("{}-9", "c".repeat(78)));
        proposal.role_pack.duties = vec![template; 8];
        proposal.role_pack.on_hire = Some(RoleOnHire {
            sources: vec!["s".repeat(200); 8],
            plan_horizon_days: 30,
        });
        proposal.role_pack.ask_before = vec!["a".repeat(120); 16];
        proposal.role_pack.home = Some("h".repeat(80));
        assert!(validate_hire_proposal(&proposal).is_ok());
        proposal.role_pack.on_hire = Some(RoleOnHire {
            sources: Vec::new(),
            plan_horizon_days: 1,
        });
        assert!(validate_hire_proposal(&proposal).is_ok());
    }

    #[test]
    fn role_pack_v2_rejects_each_field_rule() {
        assert_role_pack_rejected("blank owns", |pack| pack.owns = Some(" \n".into()));
        assert_role_pack_rejected("owns over 500", |pack| pack.owns = Some("o".repeat(501)));
        assert_role_pack_rejected("empty channel", |pack| pack.channel = Some(String::new()));
        assert_role_pack_rejected("channel with capitals", |pack| {
            pack.channel = Some("Social".into())
        });
        assert_role_pack_rejected("channel with a space", |pack| {
            pack.channel = Some("social team".into())
        });
        assert_role_pack_rejected("channel over 80", |pack| pack.channel = Some("c".repeat(81)));
        assert_role_pack_rejected("nine duties", |pack| {
            pack.duties = vec![pack.duties[0].clone(); 9]
        });
        assert_role_pack_rejected("blank duty title", |pack| pack.duties[0].title = " ".into());
        assert_role_pack_rejected("duty title over 120", |pack| {
            pack.duties[0].title = "t".repeat(121)
        });
        assert_role_pack_rejected("unsupported schedule", |pack| {
            pack.duties[0].schedule_text = "Tomorrow at 09:00".into()
        });
        assert_role_pack_rejected("padded schedule over 180", |pack| {
            pack.duties[0].schedule_text = format!("Every{}day at 09:00", " ".repeat(180))
        });
        assert_role_pack_rejected("blank instructions", |pack| {
            pack.duties[0].instructions = "\t".into()
        });
        assert_role_pack_rejected("instructions over 2000", |pack| {
            pack.duties[0].instructions = "i".repeat(2001)
        });
        assert_role_pack_rejected("nine sources", |pack| {
            pack.on_hire = Some(RoleOnHire {
                sources: vec!["s".into(); 9],
                plan_horizon_days: 14,
            })
        });
        assert_role_pack_rejected("blank source", |pack| {
            pack.on_hire = Some(RoleOnHire {
                sources: vec![" ".into()],
                plan_horizon_days: 14,
            })
        });
        assert_role_pack_rejected("source over 200", |pack| {
            pack.on_hire = Some(RoleOnHire {
                sources: vec!["s".repeat(201)],
                plan_horizon_days: 14,
            })
        });
        assert_role_pack_rejected("zero-day plan", |pack| {
            pack.on_hire = Some(RoleOnHire {
                sources: Vec::new(),
                plan_horizon_days: 0,
            })
        });
        assert_role_pack_rejected("31-day plan", |pack| {
            pack.on_hire = Some(RoleOnHire {
                sources: Vec::new(),
                plan_horizon_days: 31,
            })
        });
        assert_role_pack_rejected("seventeen ask-before limits", |pack| {
            pack.ask_before = vec!["prices".into(); 17]
        });
        assert_role_pack_rejected("blank ask-before limit", |pack| {
            pack.ask_before = vec![" ".into()]
        });
        assert_role_pack_rejected("ask-before limit over 120", |pack| {
            pack.ask_before = vec!["a".repeat(121)]
        });
        assert_role_pack_rejected("blank home", |pack| pack.home = Some(" ".into()));
        assert_role_pack_rejected("home over 80", |pack| pack.home = Some("h".repeat(81)));
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p buzz-core --lib company_records::tests::role_pack`
Expected: FAIL to compile with `error[E0422]: cannot find struct, variant or union type 'RoleDutyTemplate' in this scope` and `struct 'HireRolePack' has no field named 'owns'`.

- [ ] **Step 3: Implement**

3a. In `crates/buzz-core/src/company_records.rs`, insert between the closing brace of `struct HireTool` (line 683) and `/// Role metadata projected from a real persona or team catalog record.` (line 685):

```rust
/// A default routine a role pack proposes; approved by the owner's hire signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoleDutyTemplate {
    /// Routine title, 1 to 120 characters.
    pub title: String,
    /// Readable recurrence accepted by [`crate::company_duties::parse_readable_schedule`].
    pub schedule_text: String,
    /// Instructions the employee receives on each run, 1 to 2000 characters.
    pub instructions: String,
}

/// What a new employee studies first and how long its first plan covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoleOnHire {
    /// Sources the employee studies before it writes its first plan.
    pub sources: Vec<String>,
    /// Days the first plan covers, 1 to 30.
    #[serde(default = "default_plan_horizon_days")]
    pub plan_horizon_days: u8,
}

/// Plan horizon used when a role pack names none: 14 days.
pub fn default_plan_horizon_days() -> u8 {
    14
}

// Role pack v2 limits. The new app's record parsers mirror them in phase 1.
const MAX_ROLE_OWNS_CHARS: usize = 500;
const MAX_ROLE_CHANNEL_CHARS: usize = 80;
const MAX_ROLE_DUTIES: usize = 8;
const MAX_ROLE_DUTY_TITLE_CHARS: usize = 120;
const MAX_ROLE_DUTY_INSTRUCTIONS_CHARS: usize = 2000;
const MAX_ROLE_ON_HIRE_SOURCES: usize = 8;
const MAX_ROLE_ON_HIRE_SOURCE_CHARS: usize = 200;
const MAX_PLAN_HORIZON_DAYS: u8 = 30;
const MAX_ROLE_ASK_BEFORE: usize = 16;
const MAX_ROLE_ASK_BEFORE_CHARS: usize = 120;
const MAX_ROLE_HOME_CHARS: usize = 80;
```

3b. Extend `HireRolePack` (lines 686-704). Replace its last field and closing brace:

```rust
    /// Optional allowance metadata supplied by this real catalog record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_allowance: Option<String>,
}
```

with:

```rust
    /// Optional allowance metadata supplied by this real catalog record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_allowance: Option<String>,
    /// Outcome the role owns; becomes the employee's root goal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owns: Option<String>,
    /// Default home conversation name offered while configuring the hire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    /// Default routines, approved by the owner's hire signature.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub duties: Vec<RoleDutyTemplate>,
    /// Sources to study and the first plan's horizon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_hire: Option<RoleOnHire>,
    /// Actions that always need a person.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ask_before: Vec<String>,
    /// Identifier of the role's desk in the app.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
}
```

3c. Insert directly above `/// Validates role-pack metadata and the employee's selected configuration.` (line 839):

```rust
/// Validates the optional role pack v2 fields; absent fields are valid.
fn validate_role_pack_v2(role_pack: &HireRolePack) -> Result<(), CompanyRecordError> {
    if let Some(owns) = role_pack.owns.as_deref() {
        require_text(
            owns,
            MAX_ROLE_OWNS_CHARS,
            "role owns must have 1 to 500 characters",
        )?;
    }
    if role_pack.channel.as_deref().is_some_and(|channel| {
        channel.is_empty()
            || channel.len() > MAX_ROLE_CHANNEL_CHARS
            || !channel
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }) {
        return Err(CompanyRecordError::Invalid(
            "role channel must be 1 to 80 characters of a-z, 0-9 and -",
        ));
    }
    if role_pack.duties.len() > MAX_ROLE_DUTIES {
        return Err(CompanyRecordError::Invalid(
            "a role pack has at most 8 duties",
        ));
    }
    for duty in &role_pack.duties {
        require_text(
            &duty.title,
            MAX_ROLE_DUTY_TITLE_CHARS,
            "role duty title must have 1 to 120 characters",
        )?;
        if char_len(&duty.schedule_text) > crate::company_duties::MAX_DUTY_SCHEDULE_CHARS
            || crate::company_duties::parse_readable_schedule(&duty.schedule_text).is_none()
        {
            return Err(CompanyRecordError::Invalid(
                "role duty scheduleText must be a supported recurring schedule",
            ));
        }
        require_text(
            &duty.instructions,
            MAX_ROLE_DUTY_INSTRUCTIONS_CHARS,
            "role duty instructions must have 1 to 2000 characters",
        )?;
    }
    if let Some(on_hire) = &role_pack.on_hire {
        if on_hire.sources.len() > MAX_ROLE_ON_HIRE_SOURCES
            || on_hire.sources.iter().any(|source| {
                source.trim().is_empty() || char_len(source) > MAX_ROLE_ON_HIRE_SOURCE_CHARS
            })
        {
            return Err(CompanyRecordError::Invalid(
                "onHire has at most 8 sources of 1 to 200 characters",
            ));
        }
        if !(1..=MAX_PLAN_HORIZON_DAYS).contains(&on_hire.plan_horizon_days) {
            return Err(CompanyRecordError::Invalid(
                "onHire planHorizonDays must be 1 to 30",
            ));
        }
    }
    if role_pack.ask_before.len() > MAX_ROLE_ASK_BEFORE
        || role_pack.ask_before.iter().any(|limit| {
            limit.trim().is_empty() || char_len(limit) > MAX_ROLE_ASK_BEFORE_CHARS
        })
    {
        return Err(CompanyRecordError::Invalid(
            "askBefore has at most 16 entries of 1 to 120 characters",
        ));
    }
    if let Some(home) = role_pack.home.as_deref() {
        require_text(
            home,
            MAX_ROLE_HOME_CHARS,
            "role home must have 1 to 80 characters",
        )?;
    }
    Ok(())
}

```

3d. In `validate_hire_proposal`, call it right after the `defaultAllowance` check (lines 892-898), so the block reads:

```rust
    if let Some(allowance) = proposal.role_pack.default_allowance.as_deref() {
        if !is_decimal(allowance) {
            return Err(CompanyRecordError::Invalid(
                "defaultAllowance must be a non-negative decimal",
            ));
        }
    }
    validate_role_pack_v2(&proposal.role_pack)?;
    if let Some(allowance) = proposal.weekly_allowance.as_deref() {
```

3e. Update the test fixture `hire_proposal()` (lines 2531-2555). After `default_allowance: None,` (line 2544) add the v2 fields:

```rust
                worker_menu: vec!["runtime-available".into()],
                default_allowance: None,
                owns: None,
                channel: None,
                duties: Vec::new(),
                on_hire: None,
                ask_before: Vec::new(),
                home: None,
            },
```

3f. Update `crates/buzz-test-client/tests/e2e_company_hire.rs:136-138` the same way:

```rust
            worker_menu: vec!["runtime-e2e".into()],
            default_allowance: None,
            owns: None,
            channel: None,
            duties: Vec::new(),
            on_hire: None,
            ask_before: Vec::new(),
            home: None,
        },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p buzz-core --lib company_records::tests`
Expected: PASS, including `role_pack_v2_round_trips_and_v1_packs_keep_their_exact_shape`, `role_pack_v2_fields_accept_their_bounds` and `role_pack_v2_rejects_each_field_rule`.
Run: `cargo check -p buzz-test-client --tests`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_records.rs crates/buzz-test-client/tests/e2e_company_hire.rs
git commit -s -m "feat(core): add role pack v2 fields and validation"
```

---

### Task 2.2: The hire `complete` action carries the owner's time zone (buzz-core)

**Files:**
- Modify: `crates/buzz-core/src/company_duties.rs:306-312` (`is_timezone_label` becomes public)
- Modify: `crates/buzz-core/src/company_records.rs:807-832` (`HireAction.time_zone`)
- Modify: `crates/buzz-core/src/company_records.rs:935-1055` (`validate_hire_action`)
- Modify: `crates/buzz-core/src/company_records.rs:2758-2856` (the four `HireAction` literals in `hire_action_payloads_are_exact_and_use_the_dynamic_worker_menu`)
- Modify: `crates/buzz-relay/src/handlers/company_hires.rs:661-670` (literal in `parse_hire_head`)
- Modify: `crates/buzz-test-client/tests/e2e_company_hire.rs:257-266,297-306,312-321` (literals)
- Test: `crates/buzz-core/src/company_records.rs` (`mod tests`)

**Interfaces:**
- Consumes: `HireAction`, `validate_hire_action`, `parse_company_command` (all `company_records.rs`).
- Produces: `HireAction.time_zone: Option<String>` (JSON `timeZone`, omitted when absent); `pub fn crate::company_duties::is_timezone_label(value: &str) -> bool`; `validate_hire_action` rejects `timeZone` on every action except `complete`, and rejects a label that is empty, longer than 64 characters or outside `[A-Za-z0-9/_+-]`. Part D's host sends the company time zone in `complete` (`HireCompleteInput.time_zone`, overview).

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/buzz-core/src/company_records.rs`, after `role_pack_v2_rejects_each_field_rule`:

```rust
    fn complete_action() -> HireAction {
        HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: Uuid::from_u128(42),
            action: HireActionKind::Complete,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            employee_pubkey: Some(PK_B.into()),
            introduction_event_id: Some(EV.into()),
            reason: None,
            time_zone: None,
        }
    }

    #[test]
    fn complete_carries_an_optional_iana_time_zone_label() {
        assert!(validate_hire_action(&complete_action()).is_ok());
        for zone in [
            "Africa/Johannesburg",
            "UTC",
            "America/Argentina/Buenos_Aires",
            "Etc/GMT+2",
        ] {
            let mut action = complete_action();
            action.time_zone = Some(zone.into());
            assert!(validate_hire_action(&action).is_ok(), "{zone} is a label");
        }
        let too_long = "A".repeat(65);
        for zone in ["", "Mars Base", "Europe/Paris;", too_long.as_str()] {
            let mut action = complete_action();
            action.time_zone = Some(zone.into());
            assert!(validate_hire_action(&action).is_err(), "{zone:?} is not a label");
        }

        let mut action = complete_action();
        action.time_zone = Some("UTC".into());
        let json = serde_json::to_string(&action).expect("serialize complete");
        assert!(json.contains(r#""timeZone":"UTC""#));
        assert!(matches!(
            parse_company_command(crate::kind::KIND_HIRE_ACTION, &json),
            Ok(CompanyCommand::HireAction(parsed)) if parsed.time_zone.as_deref() == Some("UTC")
        ));
        let without = serde_json::to_string(&complete_action()).expect("serialize complete");
        assert!(!without.contains("timeZone"));
    }

    #[test]
    fn only_complete_may_carry_a_time_zone() {
        let create = HireAction {
            action: HireActionKind::Create,
            expected_head_event_id: None,
            proposal: Some(hire_proposal()),
            employee_pubkey: None,
            introduction_event_id: None,
            ..complete_action()
        };
        let update = HireAction {
            action: HireActionKind::Update,
            expected_head_event_id: Some(EV.into()),
            ..create.clone()
        };
        let approve = HireAction {
            action: HireActionKind::Approve,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            ..create.clone()
        };
        let attach = HireAction {
            action: HireActionKind::AttachEmployee,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            employee_pubkey: Some(PK_B.into()),
            ..create.clone()
        };
        let deny = HireAction {
            action: HireActionKind::Deny,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            reason: Some("Role is not approved".into()),
            ..create.clone()
        };
        for action in [create, update, approve, attach, deny] {
            assert!(
                validate_hire_action(&action).is_ok(),
                "{:?} is valid without a time zone",
                action.action
            );
            let mut with_zone = action.clone();
            with_zone.time_zone = Some("UTC".into());
            assert!(
                validate_hire_action(&with_zone).is_err(),
                "{:?} must not carry timeZone",
                action.action
            );
        }
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p buzz-core --lib company_records::tests::complete_carries_an_optional_iana_time_zone_label`
Expected: FAIL to compile with `error[E0560]: struct 'HireAction' has no field named 'time_zone'`.

- [ ] **Step 3: Implement**

3a. `crates/buzz-core/src/company_duties.rs:306`, replace

```rust
fn is_timezone_label(value: &str) -> bool {
```

with

```rust
/// Returns `true` for an IANA-style time zone label: 1 to 64 ASCII letters,
/// digits, `/`, `_`, `-` or `+`. The workflow engine checks the name against
/// its zone database when a schedule is created.
pub fn is_timezone_label(value: &str) -> bool {
```

3b. `crates/buzz-core/src/company_records.rs`, in `struct HireAction` (lines 807-832), replace

```rust
    /// Decision reason for denial or founder sign-off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
```

with

```rust
    /// Decision reason for denial or founder sign-off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The owner's IANA time zone for the employee's routine schedules; complete only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}
```

3c. In `validate_hire_action`, directly after the `validate_expected_head(...)?;` call (lines 940-943), insert the `timeZone` rule, so that section reads:

```rust
    validate_expected_head(
        action.expected_head_event_id.as_deref(),
        action.action == HireActionKind::Create,
    )?;
    if action.time_zone.is_some() && action.action != HireActionKind::Complete {
        return Err(CompanyRecordError::Invalid(
            "timeZone is allowed only on complete",
        ));
    }
    match action.action {
```

and in the `HireActionKind::Complete` arm replace its tail (lines 1033-1039)

```rust
            if !is_hex_id(employee) || !is_hex_id(introduction) {
                return Err(CompanyRecordError::Invalid(
                    "complete identity coordinates must be lowercase hex ids",
                ));
            }
            Ok(())
        }
```

with

```rust
            if !is_hex_id(employee) || !is_hex_id(introduction) {
                return Err(CompanyRecordError::Invalid(
                    "complete identity coordinates must be lowercase hex ids",
                ));
            }
            if action
                .time_zone
                .as_deref()
                .is_some_and(|zone| !crate::company_duties::is_timezone_label(zone))
            {
                return Err(CompanyRecordError::Invalid(
                    "timeZone must be an IANA time zone name of 1 to 64 characters",
                ));
            }
            Ok(())
        }
```

3d. Add `time_zone: None,` as the last field of the four `HireAction { ... }` literals in `hire_action_payloads_are_exact_and_use_the_dynamic_worker_menu`: `create` (lines 2760-2769), `approve` (2783-2792), `attach` (2810-2819) and `deny` (2845-2854). For example, `create` becomes:

```rust
        let create = HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: proposal.hire_id,
            action: HireActionKind::Create,
            expected_head_event_id: None,
            proposal: Some(proposal.clone()),
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
            time_zone: None,
        };
```

3e. `crates/buzz-relay/src/handlers/company_hires.rs:661-670`, in `parse_hire_head`:

```rust
        || validate_hire_action(&HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: head.proposal.hire_id,
            action: HireActionKind::Create,
            expected_head_event_id: None,
            proposal: Some(head.proposal.clone()),
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
            time_zone: None,
        })
```

3f. `crates/buzz-test-client/tests/e2e_company_hire.rs`: add `time_zone: None,` after the `reason` line of `create` (lines 257-266), `admin_approval` (297-306) and `incomplete_completion` (312-321). The literals built with `..create.clone()` and `..admin_approval` need no change.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p buzz-core --lib company_records::tests`
Expected: PASS.
Run: `cargo test -p buzz-core --lib company_duties::tests`
Expected: PASS.
Run: `cargo check -p buzz-relay --tests && cargo check -p buzz-test-client --tests`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_records.rs crates/buzz-core/src/company_duties.rs crates/buzz-relay/src/handlers/company_hires.rs crates/buzz-test-client/tests/e2e_company_hire.rs
git commit -s -m "feat(core): let hire completion carry the owner's time zone"
```

---

### Task 2.3: Duty heads accept a hire as their source (buzz-core)

**Files:**
- Modify: `crates/buzz-core/src/company_duties.rs:103-106` (`DutyHead` source fields)
- Modify: `crates/buzz-core/src/company_duties.rs:168-189` (`validate_duty_head`)
- Modify: `crates/buzz-relay/src/handlers/company_duties.rs:290-291` (`prepare_approved_duty` literal)
- Modify: `crates/buzz-test-client/tests/e2e_company_duties_lessons.rs:449-450`
- Test: `crates/buzz-core/src/company_duties.rs` (`mod tests`, from line 333)

**Interfaces:**
- Consumes: `DutyHead`, `DutyProposal`, `DutyStatus`, `validate_duty_head`, `COMPANY_RECORD_SCHEMA_VERSION`.
- Produces: `DutyHead.source_ask_id: Option<Uuid>`, `DutyHead.source_ask_channel_id: Option<Uuid>`, `DutyHead.source_hire_id: Option<Uuid>` (each `#[serde(default, skip_serializing_if = "Option::is_none")]`, JSON `sourceAskId`, `sourceAskChannelId`, `sourceHireId`); `validate_duty_head` accepts exactly one non-nil source: an ask with its channel, or a hire. The `colony` CLI already parses duty heads with these core types and `validate_duty_head` (`crates/buzz-cli/src/commands/company_duties_lessons.rs:495-500`), so employees can list hire-created routines with no CLI change.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/buzz-core/src/company_duties.rs`, after `duty_d_tag_is_stable_and_namespaced` (which ends at line 368):

```rust
    fn duty_head() -> DutyHead {
        let duty_id = Uuid::from_u128(7);
        DutyHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            duty_id,
            proposal: DutyProposal {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                duty_id,
                employee_pubkey: "a".repeat(64),
                title: "Plan check".into(),
                schedule_text: "Every Monday at 09:00".into(),
                schedule_cron: "0 9 * * 1".into(),
                time_zone: "UTC".into(),
                channel_id: Uuid::from_u128(8),
                instructions: "Check your plan.".into(),
            },
            status: DutyStatus::Active,
            proposed_by_pubkey: "b".repeat(64),
            approved_by_pubkey: "b".repeat(64),
            approved_at: "2026-10-11T09:00:00Z".into(),
            source_ask_id: Some(Uuid::from_u128(9)),
            source_ask_channel_id: Some(Uuid::from_u128(8)),
            source_hire_id: None,
            workflow_definition_hash: "c".repeat(64),
            created_at: "2026-10-11T09:00:00Z".into(),
            updated_at: "2026-10-11T09:00:00Z".into(),
            source_action_event_id: "d".repeat(64),
        }
    }

    #[test]
    fn duty_heads_name_exactly_one_source() {
        let ask = Some(Uuid::from_u128(9));
        let channel = Some(Uuid::from_u128(8));
        let hire = Some(Uuid::from_u128(10));
        let nil = Some(Uuid::nil());
        // (source_ask_id, source_ask_channel_id, source_hire_id, valid)
        let cases = [
            (ask, channel, None, true),
            (None, None, hire, true),
            (None, None, None, false),
            (ask, None, None, false),
            (None, channel, None, false),
            (ask, channel, hire, false),
            (ask, None, hire, false),
            (None, channel, hire, false),
            (nil, channel, None, false),
            (ask, nil, None, false),
            (None, None, nil, false),
        ];
        for (source_ask_id, source_ask_channel_id, source_hire_id, valid) in cases {
            let mut head = duty_head();
            head.source_ask_id = source_ask_id;
            head.source_ask_channel_id = source_ask_channel_id;
            head.source_hire_id = source_hire_id;
            assert_eq!(
                validate_duty_head(&head).is_ok(),
                valid,
                "ask {source_ask_id:?}, channel {source_ask_channel_id:?}, hire {source_hire_id:?}"
            );
        }
    }

    #[test]
    fn ask_sourced_heads_keep_parsing_and_hire_heads_omit_ask_keys() {
        // The exact key set an ask-sourced duty head has always carried.
        let old = serde_json::json!({
            "schemaVersion": 1,
            "dutyId": Uuid::from_u128(7).to_string(),
            "proposal": serde_json::to_value(duty_head().proposal).expect("proposal json"),
            "status": "active",
            "proposedByPubkey": "b".repeat(64),
            "approvedByPubkey": "b".repeat(64),
            "approvedAt": "2026-10-11T09:00:00Z",
            "sourceAskId": Uuid::from_u128(9).to_string(),
            "sourceAskChannelId": Uuid::from_u128(8).to_string(),
            "workflowDefinitionHash": "c".repeat(64),
            "createdAt": "2026-10-11T09:00:00Z",
            "updatedAt": "2026-10-11T09:00:00Z",
            "sourceActionEventId": "d".repeat(64),
        });
        let parsed: DutyHead = serde_json::from_value(old).expect("ask-sourced head parses");
        assert_eq!(parsed.source_ask_id, Some(Uuid::from_u128(9)));
        assert_eq!(parsed.source_hire_id, None);
        assert!(validate_duty_head(&parsed).is_ok());

        let mut hired = duty_head();
        hired.source_ask_id = None;
        hired.source_ask_channel_id = None;
        hired.source_hire_id = Some(Uuid::from_u128(10));
        let json = serde_json::to_value(&hired).expect("hire head json");
        assert!(json.get("sourceAskId").is_none());
        assert!(json.get("sourceAskChannelId").is_none());
        assert_eq!(json["sourceHireId"], Uuid::from_u128(10).to_string());
        assert_eq!(
            serde_json::from_value::<DutyHead>(json).expect("hire head parses"),
            hired
        );
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p buzz-core --lib company_duties::tests`
Expected: FAIL to compile with `error[E0308]: mismatched types` (`expected 'Uuid', found 'Option<Uuid>'`) and `error[E0560]: struct 'DutyHead' has no field named 'source_hire_id'`.

- [ ] **Step 3: Implement**

3a. `crates/buzz-core/src/company_duties.rs:103-106`, replace

```rust
    /// Ask that created this duty.
    pub source_ask_id: Uuid,
    /// Channel containing the proposal ask.
    pub source_ask_channel_id: Uuid,
```

with

```rust
    /// Ask that created this duty; absent when a completed hire created it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ask_id: Option<Uuid>,
    /// Channel containing the proposal ask; present exactly when `source_ask_id` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ask_channel_id: Option<Uuid>,
    /// Hire whose owner signature created this duty; the alternative to an ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_hire_id: Option<Uuid>,
```

3b. Replace `validate_duty_head` (lines 168-189) with:

```rust
/// Validate relay-authored duty identity, approval provenance and timestamps.
pub fn validate_duty_head(head: &DutyHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.duty_id.is_nil()
        || head.proposal.duty_id != head.duty_id
        || !is_hex_id(&head.proposed_by_pubkey)
        || !is_hex_id(&head.approved_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || !is_hex_id(&head.workflow_definition_hash)
        || !is_rfc3339(&head.approved_at)
        || !is_rfc3339(&head.created_at)
        || !is_rfc3339(&head.updated_at)
    {
        return Err(CompanyRecordError::Invalid(
            "duty head identity, approval and timestamps must be valid",
        ));
    }
    if !has_exactly_one_source(head) {
        return Err(CompanyRecordError::Invalid(
            "a duty head names exactly one source: an ask with its channel, or a hire",
        ));
    }
    validate_duty_proposal(&head.proposal)?;
    Ok(())
}

/// A duty head names exactly one non-nil source: an ask with its channel, or a hire.
fn has_exactly_one_source(head: &DutyHead) -> bool {
    match (
        head.source_ask_id,
        head.source_ask_channel_id,
        head.source_hire_id,
    ) {
        (Some(ask), Some(channel), None) => !ask.is_nil() && !channel.is_nil(),
        (None, None, Some(hire)) => !hire.is_nil(),
        _ => false,
    }
}
```

3c. `crates/buzz-relay/src/handlers/company_duties.rs:289-292` in `prepare_approved_duty`, so the literal reads:

```rust
        approved_at: now.clone(),
        source_ask_id: Some(ask_id),
        source_ask_channel_id: Some(ask_channel_id),
        source_hire_id: None,
        workflow_definition_hash: hex::encode(&definition_hash),
```

3d. `crates/buzz-test-client/tests/e2e_company_duties_lessons.rs:449-450`:

```rust
    assert_eq!(head.source_ask_id, Some(ask_id));
    assert_eq!(head.source_ask_channel_id, Some(channel_id));
    assert_eq!(head.source_hire_id, None);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p buzz-core --lib company_duties::tests`
Expected: PASS.
Run: `cargo check -p buzz-relay --tests && cargo check -p buzz-cli --tests && cargo check -p buzz-test-client --tests`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_duties.rs crates/buzz-relay/src/handlers/company_duties.rs crates/buzz-test-client/tests/e2e_company_duties_lessons.rs
git commit -s -m "feat(core): allow a hire as a duty head source"
```

---

### Task 2.4: Goal and routine builders for a completed hire (buzz-core)

**Files:**
- Modify: `crates/buzz-core/src/company_records.rs` (insert after the closing brace of `validate_hire_action`, directly above `/// Ask create or cancel.`, line 1057 before this part's edits)
- Test: `crates/buzz-core/src/company_records.rs` (`mod tests`)

**Interfaces:**
- Consumes: `HireProposal`, `RoleDutyTemplate` (Task 2.1), `GoalRecord`, `validate_goal_record` (`company_records.rs:1437`), `MAX_TITLE_CHARS` (`company_records.rs:26`), `crate::company_duties::{parse_readable_schedule, validate_duty_proposal, DutyProposal}`.
- Produces:
  - `pub const PLAN_CHECK_DUTY_TITLE: &str = "Plan check"`
  - `pub const PLAN_CHECK_DUTY_SCHEDULE: &str = "Every Monday at 09:00"`
  - `pub const PLAN_CHECK_DUTY_INSTRUCTIONS: &str = "Check your 2-week plan. If it is 14 days old or finished, write the next 2-week plan and send it to your manager for approval."`
  - `pub const DEFAULT_HIRE_TIME_ZONE: &str = "UTC"`
  - `pub const HIRE_GOAL_DEFAULT_DONE_CONDITION: &str = "Plan approved and delivered"`
  - `pub fn hire_goal_record(proposal: &HireProposal, employee_pubkey: &str) -> Result<GoalRecord, CompanyRecordError>`
  - `pub fn hire_duty_proposals(proposal: &HireProposal, employee_pubkey: &str, time_zone: Option<&str>, next_duty_id: impl FnMut() -> Uuid) -> Result<Vec<DutyProposal>, CompanyRecordError>`
  - Part G (Scout) relies on the Plan check routine existing for every hired employee, including Scout itself.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/buzz-core/src/company_records.rs`, after `only_complete_may_carry_a_time_zone`:

```rust
    #[test]
    fn hire_goal_takes_owns_or_falls_back_to_the_hire_title() {
        let mut proposal = hire_proposal();
        proposal.role_pack.owns = Some("Show up well on social media every week".into());
        let goal = hire_goal_record(&proposal, PK_B).expect("goal from owns");
        assert_eq!(goal.schema_version, COMPANY_RECORD_SCHEMA_VERSION);
        assert_eq!(goal.goal_id, proposal.hire_id);
        assert_eq!(goal.parent_goal_id, None);
        assert_eq!(goal.title, "Show up well on social media every week");
        assert_eq!(goal.done_condition, "Show up well on social media every week");
        assert_eq!(goal.owner_pubkey, PK_B);
        assert_eq!(goal.due_date, None);
        assert_eq!(goal.target, None);
        assert_eq!(goal.linked_channel_ids, vec![proposal.introduction_channel_id]);

        proposal.role_pack.owns = None;
        let fallback = hire_goal_record(&proposal, PK_B).expect("goal from the hire title");
        assert_eq!(fallback.title, proposal.title);
        assert_eq!(fallback.done_condition, HIRE_GOAL_DEFAULT_DONE_CONDITION);
        assert_eq!(HIRE_GOAL_DEFAULT_DONE_CONDITION, "Plan approved and delivered");

        assert!(hire_goal_record(&proposal, "not-a-pubkey").is_err());
    }

    #[test]
    fn a_long_owns_is_cut_at_a_word_for_the_goal_title() {
        let owns = "Grow weekly signups ".repeat(25).trim_end().to_owned();
        assert_eq!(owns.chars().count(), 499);
        let mut proposal = hire_proposal();
        proposal.role_pack.owns = Some(owns.clone());
        assert!(validate_hire_proposal(&proposal).is_ok());
        let goal = hire_goal_record(&proposal, PK_B).expect("goal from a long owns");
        assert!(goal.title.chars().count() <= MAX_TITLE_CHARS);
        let kept = goal.title.strip_suffix("...").expect("a cut title ends with ...");
        assert!(owns.starts_with(kept));
        assert!(!kept.ends_with(' '));
        assert!(owns[kept.len()..].starts_with(' '), "the cut falls between words");
        assert_eq!(goal.done_condition, owns);
    }

    #[test]
    fn hire_routines_are_the_role_duties_then_plan_check_in_the_home_channel() {
        let mut proposal = hire_proposal();
        proposal.role_pack.duties = vec![RoleDutyTemplate {
            title: "Follow-up check".into(),
            schedule_text: "Every weekday at 08:00".into(),
            instructions: "Draft today's follow-ups for leads that are due.".into(),
        }];
        let mut ids = (100..).map(Uuid::from_u128);
        let duties = hire_duty_proposals(&proposal, PK_B, Some("Africa/Johannesburg"), || {
            ids.next().expect("an id")
        })
        .expect("hire routines");
        assert_eq!(duties.len(), 2);
        assert_eq!(duties[0].duty_id, Uuid::from_u128(100));
        assert_eq!(duties[0].title, "Follow-up check");
        assert_eq!(duties[0].schedule_cron, "0 8 * * 1-5");
        assert_eq!(duties[1].duty_id, Uuid::from_u128(101));
        assert_eq!(duties[1].title, PLAN_CHECK_DUTY_TITLE);
        assert_eq!(PLAN_CHECK_DUTY_TITLE, "Plan check");
        assert_eq!(duties[1].schedule_text, PLAN_CHECK_DUTY_SCHEDULE);
        assert_eq!(PLAN_CHECK_DUTY_SCHEDULE, "Every Monday at 09:00");
        assert_eq!(duties[1].schedule_cron, "0 9 * * 1");
        assert_eq!(duties[1].instructions, PLAN_CHECK_DUTY_INSTRUCTIONS);
        for duty in &duties {
            assert_eq!(duty.employee_pubkey, PK_B);
            assert_eq!(duty.channel_id, proposal.introduction_channel_id);
            assert_eq!(duty.time_zone, "Africa/Johannesburg");
            assert!(crate::company_duties::validate_duty_proposal(duty).is_ok());
        }

        proposal.role_pack.duties.clear();
        let plan_only =
            hire_duty_proposals(&proposal, PK_B, None, Uuid::new_v4).expect("plan check only");
        assert_eq!(plan_only.len(), 1);
        assert_eq!(plan_only[0].title, PLAN_CHECK_DUTY_TITLE);
        assert_eq!(plan_only[0].time_zone, DEFAULT_HIRE_TIME_ZONE);
        assert_eq!(DEFAULT_HIRE_TIME_ZONE, "UTC");

        proposal.role_pack.duties = vec![RoleDutyTemplate {
            title: "Broken".into(),
            schedule_text: "Tomorrow at 09:00".into(),
            instructions: "Never runs.".into(),
        }];
        assert!(hire_duty_proposals(&proposal, PK_B, None, Uuid::new_v4).is_err());
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p buzz-core --lib company_records::tests::hire_`
Expected: FAIL to compile with `error[E0425]: cannot find function 'hire_goal_record' in this scope`.

- [ ] **Step 3: Implement**

Insert after the closing brace of `validate_hire_action` and before `/// Ask create or cancel.` in `crates/buzz-core/src/company_records.rs`:

```rust
/// Title of the built-in routine that keeps every employee's plan current.
pub const PLAN_CHECK_DUTY_TITLE: &str = "Plan check";
/// Readable schedule of the built-in Plan check routine.
pub const PLAN_CHECK_DUTY_SCHEDULE: &str = "Every Monday at 09:00";
/// Instructions the employee receives on each Plan check run.
pub const PLAN_CHECK_DUTY_INSTRUCTIONS: &str = "Check your 2-week plan. If it is 14 days old or finished, write the next 2-week plan and send it to your manager for approval.";
/// Time zone of a hire's routines when the owner's `complete` names none.
pub const DEFAULT_HIRE_TIME_ZONE: &str = "UTC";
/// Done condition of a hire goal whose role pack names no `owns` outcome.
pub const HIRE_GOAL_DEFAULT_DONE_CONDITION: &str = "Plan approved and delivered";

/// Builds the root goal a completed hire creates for its employee.
///
/// The goal reuses the hire id, is owned by the employee and is linked to the
/// introduction channel. Its title is the role's `owns` outcome, cut at a word
/// to fit a goal title, or the hire title when the pack names none. Its done
/// condition is the full `owns` text or [`HIRE_GOAL_DEFAULT_DONE_CONDITION`].
pub fn hire_goal_record(
    proposal: &HireProposal,
    employee_pubkey: &str,
) -> Result<GoalRecord, CompanyRecordError> {
    let owns = proposal
        .role_pack
        .owns
        .as_deref()
        .map(str::trim)
        .filter(|owns| !owns.is_empty());
    let goal = GoalRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id: proposal.hire_id,
        parent_goal_id: None,
        title: owns.map_or_else(|| proposal.title.clone(), goal_title_from_owns),
        owner_pubkey: employee_pubkey.to_owned(),
        due_date: None,
        done_condition: owns
            .unwrap_or(HIRE_GOAL_DEFAULT_DONE_CONDITION)
            .to_owned(),
        target: None,
        linked_channel_ids: vec![proposal.introduction_channel_id],
    };
    validate_goal_record(&goal)?;
    Ok(goal)
}

/// Fits an `owns` outcome into a goal title, cutting after the last whole word.
fn goal_title_from_owns(owns: &str) -> String {
    if char_len(owns) <= MAX_TITLE_CHARS {
        return owns.to_owned();
    }
    let hard_cut = owns.chars().take(MAX_TITLE_CHARS - 3).collect::<String>();
    let word_cut = hard_cut
        .rsplit_once(char::is_whitespace)
        .map(|(head, _)| head.trim_end())
        .filter(|head| !head.is_empty())
        .unwrap_or(hard_cut.as_str());
    format!("{word_cut}...")
}

/// Builds the routine proposals a completed hire creates: one per role-pack
/// duty, then the built-in Plan check routine.
///
/// Every routine runs for the employee in the hire's introduction channel, in
/// the owner's time zone or [`DEFAULT_HIRE_TIME_ZONE`]. `next_duty_id` supplies
/// one new duty id per proposal, in order.
pub fn hire_duty_proposals(
    proposal: &HireProposal,
    employee_pubkey: &str,
    time_zone: Option<&str>,
    mut next_duty_id: impl FnMut() -> Uuid,
) -> Result<Vec<crate::company_duties::DutyProposal>, CompanyRecordError> {
    let plan_check = RoleDutyTemplate {
        title: PLAN_CHECK_DUTY_TITLE.to_owned(),
        schedule_text: PLAN_CHECK_DUTY_SCHEDULE.to_owned(),
        instructions: PLAN_CHECK_DUTY_INSTRUCTIONS.to_owned(),
    };
    let time_zone = time_zone.unwrap_or(DEFAULT_HIRE_TIME_ZONE);
    proposal
        .role_pack
        .duties
        .iter()
        .chain(std::iter::once(&plan_check))
        .map(|template| {
            let schedule_cron =
                crate::company_duties::parse_readable_schedule(&template.schedule_text).ok_or(
                    CompanyRecordError::Invalid(
                        "role duty scheduleText must be a supported recurring schedule",
                    ),
                )?;
            let duty = crate::company_duties::DutyProposal {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                duty_id: next_duty_id(),
                employee_pubkey: employee_pubkey.to_owned(),
                title: template.title.clone(),
                schedule_text: template.schedule_text.clone(),
                schedule_cron,
                time_zone: time_zone.to_owned(),
                channel_id: proposal.introduction_channel_id,
                instructions: template.instructions.clone(),
            };
            crate::company_duties::validate_duty_proposal(&duty)?;
            Ok(duty)
        })
        .collect()
}

```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p buzz-core --lib company_records::tests`
Expected: PASS, including `hire_goal_takes_owns_or_falls_back_to_the_hire_title`, `a_long_owns_is_cut_at_a_word_for_the_goal_title` and `hire_routines_are_the_role_duties_then_plan_check_in_the_home_channel`.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_records.rs
git commit -s -m "feat(core): build the goal and routines a completed hire creates"
```

---

### Task 2.5: Completing a hire creates the employee goal (relay)

**Files:**
- Modify: `crates/buzz-relay/src/handlers/company_records.rs:13-18` (import `validate_goal_record`)
- Modify: `crates/buzz-relay/src/handlers/company_records.rs` (insert `create_hire_goal_in_transaction` after `handle_goal_action`, which ends at line 309)
- Modify: `crates/buzz-relay/src/handlers/company_hires.rs:14-20` (imports), `:418-431` (call inside the transaction), `:451-462` (dispatch), insert after `handle` (which ends at line 467), and append `mod postgres_tests;` after line 838
- Create: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`
- Test: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`

**Interfaces:**
- Consumes: `hire_goal_record` (Task 2.4); `super::business_records::relay_global_head_event(kind, d_tag, &content, previous, state)` (`crates/buzz-relay/src/handlers/business_records.rs:2630-2649`); `state.db.replace_parameterized_event_in_transaction(tx, community, &event, d_tag, None, ParameterizedReplacePrecondition::CreateOnly)` (`crates/buzz-db/src/store/replaceable.rs:574-591`); `super::event::dispatch_persistent_event` (`crates/buzz-relay/src/handlers/event.rs:349-356`).
- Produces: `pub(super) async fn company_records::create_hire_goal_in_transaction(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, community_id: CommunityId, state: &AppState, goal: GoalRecord, source_action_event_id: &str) -> Result<StoredEvent, IngestError>`; in `company_hires.rs`: `struct HireRecords`, `async fn create_hire_records(...)`, `async fn dispatch_hire_records(...)`; the `postgres_tests` module with the fixture and helpers Tasks 2.6 and 2.7 extend. On the wire: a relay-signed kind 30642 head at `company:goal:<hire uuid>` written in the `complete` transaction.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`:

```rust
//! PostgreSQL-backed tests for hire completion through the production handler.
//!
//! Each test drives one hire through create, owner approval, employee
//! attachment and the employee's introduction, then submits `complete` to
//! `handle` and reads back what the transaction stored.

use super::*;

use std::time::Duration;

use buzz_core::company_members::member_d_tag;
use buzz_core::company_records::{
    goal_d_tag, GoalAction, GoalActionKind, GoalHead, GoalRecord, GoalStatus, HireRolePack,
    HireTool, HireToolRisk, RoleDutyTemplate, RoleOnHire,
};
use buzz_core::kind::{KIND_GOAL_ACTION, KIND_GOAL_HEAD, KIND_MEMBER_POSITION_HEAD};
use buzz_db::channel::{ChannelType, ChannelVisibility};
use buzz_db::channel_members::MemberRole;
use nostr::Keys;

static HIRE_DB_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
    std::sync::OnceLock::new();

const OWNS: &str = "Show up well on social media every week";
const ROLE_DUTY_TITLE: &str = "Next week's posts";

struct Fixture {
    state: Arc<AppState>,
    tenant: TenantContext,
    _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    owner: Keys,
    employee: Keys,
    channel_id: Uuid,
}

async fn fixture() -> Fixture {
    fixture_with(true, true).await
}

/// Builds a community with an owner, a managed employee bound to that owner
/// and a private home channel. Either party can be left out of the channel.
async fn fixture_with(employee_in_channel: bool, owner_in_channel: bool) -> Fixture {
    let serial_guard = HIRE_DB_TEST_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
    let pool = sqlx::PgPool::connect(&database_url)
        .await
        .expect("connect to the disposable test database");
    let state = crate::state::tests::test_state_with_database_url_and_acquire_timeout(
        &database_url,
        Duration::from_secs(10),
    )
    .await;
    let community_uuid = Uuid::new_v4();
    let host = format!("company-hires-{}.test", community_uuid.simple());
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community_uuid)
        .bind(&host)
        .execute(&pool)
        .await
        .expect("insert test community");
    let tenant = TenantContext::resolved(CommunityId::from_uuid(community_uuid), host);
    let community = tenant.community();
    let owner = Keys::generate();
    let employee = Keys::generate();
    let channel_creator = if owner_in_channel {
        owner.clone()
    } else {
        Keys::generate()
    };
    for keys in [&owner, &employee, &channel_creator] {
        state
            .db
            .ensure_user(community, &keys.public_key().to_bytes())
            .await
            .expect("ensure identity");
    }
    state
        .db
        .add_relay_member(community, &owner.public_key().to_hex(), "owner", None)
        .await
        .expect("add community owner");
    assert!(
        state
            .db
            .set_agent_owner(
                community,
                &employee.public_key().to_bytes(),
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("bind the managed employee"),
        "the employee is owned by the owner"
    );
    let channel = state
        .db
        .create_channel(
            community,
            &format!("home-{}", Uuid::new_v4().simple()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &channel_creator.public_key().to_bytes(),
            None,
        )
        .await
        .expect("create the home channel");
    if employee_in_channel {
        state
            .db
            .add_member(
                community,
                channel.id,
                &employee.public_key().to_bytes(),
                MemberRole::Bot,
                Some(&channel_creator.public_key().to_bytes()),
            )
            .await
            .expect("add the employee to its home channel");
    }
    Fixture {
        state,
        tenant,
        _serial_guard: serial_guard,
        owner,
        employee,
        channel_id: channel.id,
    }
}

fn auth(keys: &Keys) -> IngestAuth {
    IngestAuth::Http {
        pubkey: keys.public_key(),
        scopes: vec![buzz_auth::Scope::MessagesWrite],
        auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
    }
}

fn role_pack() -> HireRolePack {
    HireRolePack {
        persona_id: "persona-test-social".into(),
        title: "Social Media Manager".into(),
        job: "Plan, draft and schedule the company's social media posts.".into(),
        skills: vec!["Content planning".into()],
        tools: vec![HireTool {
            name: "social_draft".into(),
            risk: HireToolRisk::Medium,
        }],
        worker_menu: vec!["runtime-test".into()],
        default_allowance: None,
        owns: Some(OWNS.into()),
        channel: Some("social".into()),
        duties: vec![RoleDutyTemplate {
            title: ROLE_DUTY_TITLE.into(),
            schedule_text: "Every Monday at 10:00".into(),
            instructions: "Draft next week's posts as one batch and send them for approval."
                .into(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["instagram profile".into(), "product photos".into()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["anything public".into(), "prices".into()],
        home: Some("social.calendar".into()),
    }
}

fn hire_action(
    hire_id: Uuid,
    action: HireActionKind,
    expected_head_event_id: Option<String>,
) -> HireAction {
    HireAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        hire_id,
        action,
        expected_head_event_id,
        proposal: None,
        employee_pubkey: None,
        introduction_event_id: None,
        reason: None,
        time_zone: None,
    }
}

fn sign_hire_action(keys: &Keys, action: &HireAction) -> Event {
    EventBuilder::new(
        Kind::Custom(KIND_HIRE_ACTION as u16),
        serde_json::to_string(action).expect("serialize hire action"),
    )
    .tags([Tag::parse(["d", hire_d_tag(action.hire_id).as_str()]).expect("hire d tag")])
    .sign_with_keys(keys)
    .expect("sign hire action")
}

async fn submit(fixture: &Fixture, event: Event) -> Result<IngestResult, IngestError> {
    handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner)).await
}

fn rejection(result: Result<IngestResult, IngestError>) -> String {
    match result {
        Err(IngestError::Rejected(message)) => message,
        Err(other) => panic!("expected a rejection, got {other:?}"),
        Ok(accepted) => panic!("expected a rejection, the relay accepted {}", accepted.event_id),
    }
}

async fn hire_head(fixture: &Fixture, hire_id: Uuid) -> StoredEvent {
    current_hire_head(&fixture.state, fixture.tenant.community(), &hire_d_tag(hire_id))
        .await
        .expect("read the hire head")
        .expect("the hire head exists")
}

/// Drives one hire to the point where only `complete` remains and returns
/// that unsigned action.
async fn hire_ready_to_complete(fixture: &Fixture, role_pack: HireRolePack) -> HireAction {
    let hire_id = Uuid::new_v4();
    let mut create = hire_action(hire_id, HireActionKind::Create, None);
    create.proposal = Some(HireProposal {
        hire_id,
        role_pack,
        display_name: format!("Employee {}", hire_id.simple()),
        title: "Social Media Manager".into(),
        manager_pubkey: Some(fixture.owner.public_key().to_hex()),
        introduction_channel_id: fixture.channel_id,
        runtime_id: "runtime-test".into(),
        provider_id: None,
        model_id: None,
        weekly_allowance: None,
    });
    submit(fixture, sign_hire_action(&fixture.owner, &create))
        .await
        .expect("create the hire");
    let approve = hire_action(
        hire_id,
        HireActionKind::Approve,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    submit(fixture, sign_hire_action(&fixture.owner, &approve))
        .await
        .expect("owner approval");
    let mut attach = hire_action(
        hire_id,
        HireActionKind::AttachEmployee,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    attach.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    submit(fixture, sign_hire_action(&fixture.owner, &attach))
        .await
        .expect("attach the employee");
    let introduction = EventBuilder::new(
        Kind::Custom(KIND_STREAM_MESSAGE as u16),
        "Hi, I'm the new social media manager.",
    )
    .tags([Tag::parse(["h", fixture.channel_id.to_string().as_str()]).expect("h tag")])
    .sign_with_keys(&fixture.employee)
    .expect("sign the introduction");
    fixture
        .state
        .db
        .insert_event(
            fixture.tenant.community(),
            &introduction,
            Some(fixture.channel_id),
        )
        .await
        .expect("store the introduction");
    let mut complete = hire_action(
        hire_id,
        HireActionKind::Complete,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    complete.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    complete.introduction_event_id = Some(introduction.id.to_hex());
    complete
}

async fn goal_heads(fixture: &Fixture, goal_id: Uuid) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_GOAL_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(goal_d_tag(goal_id));
    query.global_only = true;
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query goal heads")
}

async fn member_heads(fixture: &Fixture) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(
        member_d_tag(&fixture.employee.public_key().to_hex()).expect("member d tag"),
    );
    query.global_only = true;
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query member heads")
}

/// Asserts a rejected `complete` left the hire approved and stored none of the
/// records that command would have written.
async fn assert_completion_left_nothing(fixture: &Fixture, complete: &HireAction, event: &Event) {
    let hire = parse_hire_head(&hire_head(fixture, complete.hire_id).await)
        .expect("parse the hire head");
    assert_eq!(hire.status, HireStatus::Approved, "the hire stays approved");
    assert!(
        fixture
            .state
            .db
            .get_event_by_id_for_event_write(fixture.tenant.community(), &event.id.to_bytes())
            .await
            .expect("read the complete command")
            .is_none(),
        "the complete command is not stored"
    );
    assert!(member_heads(fixture).await.is_empty(), "no member position");
    let completion_id = event.id.to_hex();
    for stored in goal_heads(fixture, complete.hire_id).await {
        let goal: GoalHead = serde_json::from_str(&stored.event.content).expect("goal head");
        assert_ne!(
            goal.source_action_event_id, completion_id,
            "no goal from this completion"
        );
    }
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_creates_the_employee_goal_with_the_hire() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let hire = parse_hire_head(&hire_head(&fixture, complete.hire_id).await)
        .expect("parse the hire head");
    assert_eq!(hire.status, HireStatus::Hired);
    assert_eq!(member_heads(&fixture).await.len(), 1, "member position written");
    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1, "one goal head for the hire");
    let stored = &goals[0];
    assert_eq!(stored.event.pubkey, fixture.state.relay_keypair.public_key());
    assert_eq!(stored.channel_id, None);
    let head: GoalHead = serde_json::from_str(&stored.event.content).expect("goal head");
    assert_eq!(head.goal_id, complete.hire_id);
    assert_eq!(head.status, GoalStatus::Active);
    assert_eq!(head.source_action_event_id, event.id.to_hex());
    let goal = head.goal.expect("a live goal");
    assert_eq!(goal.title, OWNS);
    assert_eq!(goal.done_condition, OWNS);
    assert_eq!(goal.owner_pubkey, fixture.employee.public_key().to_hex());
    assert_eq!(goal.parent_goal_id, None);
    assert_eq!(goal.linked_channel_ids, vec![fixture.channel_id]);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_goal_at_the_hire_id_rolls_back_the_whole_completion() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let existing = GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id: complete.hire_id,
        action: GoalActionKind::Create,
        expected_head_event_id: None,
        goal: Some(GoalRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id: complete.hire_id,
            parent_goal_id: None,
            title: "An existing company goal".into(),
            owner_pubkey: fixture.owner.public_key().to_hex(),
            due_date: None,
            done_condition: "Already tracked".into(),
            target: None,
            linked_channel_ids: Vec::new(),
        }),
        progress: None,
        status: None,
        reason: None,
    };
    let goal_command = EventBuilder::new(
        Kind::Custom(KIND_GOAL_ACTION as u16),
        serde_json::to_string(&existing).expect("serialize goal action"),
    )
    .tags([Tag::parse(["d", goal_d_tag(complete.hire_id).as_str()]).expect("goal d tag")])
    .sign_with_keys(&fixture.owner)
    .expect("sign goal action");
    crate::handlers::company_records::handle(
        &fixture.tenant,
        &fixture.state,
        goal_command,
        auth(&fixture.owner),
    )
    .await
    .expect("create the existing goal");

    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(message.contains("a goal already uses this hire id"), "{message}");
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1);
    let kept: GoalHead = serde_json::from_str(&goals[0].event.content).expect("goal head");
    assert_eq!(kept.title, "An existing company goal");
}
```

Append to the end of `crates/buzz-relay/src/handlers/company_hires.rs` (after line 838):

```rust

#[cfg(test)]
mod postgres_tests;
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: FAIL. `complete_creates_the_employee_goal_with_the_hire` panics with `one goal head for the hire` (`left: 0`, `right: 1`); `a_goal_at_the_hire_id_rolls_back_the_whole_completion` panics with `expected a rejection, the relay accepted`.

- [ ] **Step 3: Implement**

3a. `crates/buzz-relay/src/handlers/company_records.rs:13-18`, add `validate_goal_record` to the import:

```rust
use buzz_core::company_records::{
    goal_d_tag, goal_parent_creates_cycle, parse_company_command, validate_goal_action,
    validate_goal_d_tag, validate_goal_progress, validate_goal_record, CompanyCommand, GoalAction,
    GoalActionKind, GoalHead, GoalRecord, GoalStatus, RecordedGoalProgress,
    COMPANY_RECORD_SCHEMA_VERSION, MAX_GOAL_DEPTH,
};
```

3b. Insert after the closing brace of `handle_goal_action` (line 309), before `fn goal_command_d_tag`:

```rust

/// Creates a completed hire's root goal inside the hire's transaction.
///
/// The goal reuses the hire id, so a goal already at that coordinate fails the
/// whole hire instead of being overwritten. It takes the same community
/// goal-tree lock as member goal commands.
pub(super) async fn create_hire_goal_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: buzz_core::tenant::CommunityId,
    state: &AppState,
    goal: GoalRecord,
    source_action_event_id: &str,
) -> Result<StoredEvent, IngestError> {
    validate_goal_record(&goal).map_err(|error| invalid(format!("hire goal: {error}")))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-goal-tree:{}", community_id.as_uuid()))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    let d_tag = goal_d_tag(goal.goal_id);
    let head = GoalHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id: goal.goal_id,
        status: GoalStatus::Active,
        title: goal.title.clone(),
        goal: Some(goal),
        progress: None,
        source_action_event_id: source_action_event_id.to_owned(),
    };
    let event = super::business_records::relay_global_head_event(
        KIND_GOAL_HEAD,
        &d_tag,
        &head,
        None,
        state,
    )?;
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &event,
            &d_tag,
            None,
            ParameterizedReplacePrecondition::CreateOnly,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict("a goal already uses this hire id"));
    }
    Ok(replaced.event)
}
```

3c. `crates/buzz-relay/src/handlers/company_hires.rs:14-20`, imports:

```rust
use buzz_core::company_records::{
    hire_d_tag, hire_goal_record, parse_company_command, validate_hire_action, CompanyCommand,
    HireAction, HireActionKind, HireHead, HireProposal, HireStatus,
    COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_GOAL_HEAD, KIND_HIRE_ACTION, KIND_HIRE_HEAD, KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
};
```

3d. In `handle`, replace lines 418-431 (the member position write and the commit) with:

```rust
    let stored_position = if let Some(prepared) = prepared_position.as_ref() {
        Some(
            super::company_member_records::replace_prepared_member_position(
                &mut tx,
                community_id,
                prepared,
                state,
            )
            .await?,
        )
    } else {
        None
    };
    let hire_records = if action.action == HireActionKind::Complete {
        Some(create_hire_records(&mut tx, tenant, state, &next).await?)
    } else {
        None
    };
    tx.commit().await.map_err(internal)?;
```

and replace the member position dispatch and the start of the result (lines 451-462) with:

```rust
    if let Some(stored_position) = stored_position {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored_position,
            buzz_core::kind::KIND_MEMBER_POSITION_HEAD,
            &state.relay_keypair.public_key().to_hex(),
            None,
        )
        .await;
    }
    if let Some(records) = hire_records {
        dispatch_hire_records(tenant, state, records).await;
    }
    Ok(IngestResult {
```

3e. Insert after the closing brace of `handle` (line 467), before `/// Serializes one employee name and checks real member profiles and open hires.`:

```rust

/// Records a completed hire creates inside its transaction.
struct HireRecords {
    /// The employee's root goal head.
    goal: StoredEvent,
}

/// Writes the records a completed hire creates inside the hire transaction, so
/// they commit with the hired head and member position or not at all.
async fn create_hire_records(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    hired: &HireHead,
) -> Result<HireRecords, IngestError> {
    let employee = hired
        .employee_pubkey
        .as_deref()
        .ok_or_else(|| invalid("complete needs employeePubkey"))?;
    let goal = hire_goal_record(&hired.proposal, employee)
        .map_err(|error| invalid(format!("hire goal: {error}")))?;
    let goal = super::company_records::create_hire_goal_in_transaction(
        tx,
        tenant.community(),
        state,
        goal,
        &hired.source_action_event_id,
    )
    .await?;
    Ok(HireRecords { goal })
}

/// Fans out a completed hire's records after commit; each is already durable.
async fn dispatch_hire_records(tenant: &TenantContext, state: &Arc<AppState>, records: HireRecords) {
    let relay_pubkey = state.relay_keypair.public_key().to_hex();
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &records.goal,
        KIND_GOAL_HEAD,
        &relay_pubkey,
        None,
    )
    .await;
}
```

`next.source_action_event_id` is the `complete` event id at this point (set at line 387), so the goal head records that command.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: PASS (`2 tests run: 2 passed`).
Run: `cargo clippy -p buzz-relay --all-targets -- -D warnings`
Expected: PASS (no warnings).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_records.rs crates/buzz-relay/src/handlers/company_hires.rs crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs
git commit -s -m "feat(relay): create the employee goal when a hire completes"
```

---

### Task 2.6: Completing a hire creates its routines and their schedule workflows (relay)

**Files:**
- Modify: `crates/buzz-relay/src/handlers/company_duties.rs` (insert `HireDuties` and `create_hire_duties_in_transaction` after `replace_prepared_duty_head`, which ends at line 364)
- Modify: `crates/buzz-relay/src/handlers/company_hires.rs` (imports; `HireRecords`, `create_hire_records`, `dispatch_hire_records` from Task 2.5; the call in `handle`)
- Modify: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`
- Test: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`

**Interfaces:**
- Consumes: `hire_duty_proposals`, `PLAN_CHECK_*`, `DEFAULT_HIRE_TIME_ZONE`, `HIRE_GOAL_DEFAULT_DONE_CONDITION` (Task 2.4); `DutyHead.source_hire_id` (Task 2.3); `HireAction.time_zone` (Task 2.2); the private `validate_employee_channel` (`crates/buzz-relay/src/handlers/company_duties.rs:446-482`), `workflow_definition` (`:413-444`), `relay_duty_head_event` (`:554-573`), `PreparedDutyHead` (`:28-37`) and `replace_prepared_duty_head` (`:327-364`, which calls `buzz_db::workflow::create_workflow_in_transaction`).
- Produces: `pub(crate) struct company_duties::HireDuties<'a> { proposals: &'a [DutyProposal], proposer_pubkey: &'a str, founder_pubkey: &'a str, hire_id: Uuid, complete_event_id: &'a str }`; `pub(crate) async fn company_duties::create_hire_duties_in_transaction(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, tenant: &TenantContext, state: &AppState, hire: HireDuties<'_>) -> Result<Vec<StoredEvent>, IngestError>`. On the wire: one relay-signed kind 30655 duty head per role duty plus "Plan check", each with `sourceHireId` and a `p` tag naming the employee, and one enabled schedule workflow per routine, owned by the owner, in the home channel.

- [ ] **Step 1: Write the failing tests**

In `postgres_tests.rs`, replace the import block (the `use buzz_core::...` through `use nostr::Keys;` lines) with:

```rust
use buzz_core::company_duties::{validate_duty_head, DutyHead, DutyStatus};
use buzz_core::company_members::member_d_tag;
use buzz_core::company_records::{
    goal_d_tag, GoalAction, GoalActionKind, GoalHead, GoalRecord, GoalStatus, HireRolePack,
    HireTool, HireToolRisk, RoleDutyTemplate, RoleOnHire, DEFAULT_HIRE_TIME_ZONE,
    HIRE_GOAL_DEFAULT_DONE_CONDITION, PLAN_CHECK_DUTY_INSTRUCTIONS, PLAN_CHECK_DUTY_SCHEDULE,
    PLAN_CHECK_DUTY_TITLE,
};
use buzz_core::kind::{
    KIND_DUTY_HEAD, KIND_GOAL_ACTION, KIND_GOAL_HEAD, KIND_MEMBER_POSITION_HEAD,
};
use buzz_db::channel::{ChannelType, ChannelVisibility};
use buzz_db::channel_members::MemberRole;
use buzz_workflow::schema::{ActionDef, TriggerDef, WorkflowDef};
use nostr::Keys;
```

Add these helpers after `member_heads`:

```rust
async fn duty_heads(fixture: &Fixture) -> Vec<(StoredEvent, DutyHead)> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_DUTY_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.p_tag_hex = Some(fixture.employee.public_key().to_hex());
    query.limit = Some(50);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query duty heads")
        .into_iter()
        .map(|stored| {
            let head = serde_json::from_str::<DutyHead>(&stored.event.content)
                .expect("duty head content");
            (stored, head)
        })
        .collect()
}

async fn channel_workflows(fixture: &Fixture) -> Vec<buzz_db::workflow::WorkflowRecord> {
    fixture
        .state
        .db
        .list_channel_workflows(fixture.tenant.community(), fixture.channel_id, Some(50), None)
        .await
        .expect("list home channel workflows")
}
```

Add these two assertions at the end of `assert_completion_left_nothing`:

```rust
    assert!(duty_heads(fixture).await.is_empty(), "no routine heads");
    assert!(channel_workflows(fixture).await.is_empty(), "no routine workflows");
```

Append these tests:

```rust
#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_creates_role_routines_and_plan_check_with_their_workflows() {
    let fixture = fixture().await;
    let mut complete = hire_ready_to_complete(&fixture, role_pack()).await;
    complete.time_zone = Some("Africa/Johannesburg".into());
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let mut duties = duty_heads(&fixture).await;
    duties.sort_by(|left, right| left.1.proposal.title.cmp(&right.1.proposal.title));
    let titles = duties
        .iter()
        .map(|(_, head)| head.proposal.title.as_str())
        .collect::<Vec<_>>();
    assert_eq!(titles, vec![ROLE_DUTY_TITLE, PLAN_CHECK_DUTY_TITLE]);
    let owner = fixture.owner.public_key().to_hex();
    let employee = fixture.employee.public_key().to_hex();
    for (stored, head) in &duties {
        assert_eq!(stored.event.pubkey, fixture.state.relay_keypair.public_key());
        assert!(validate_duty_head(head).is_ok());
        assert_eq!(head.source_hire_id, Some(complete.hire_id));
        assert_eq!(head.source_ask_id, None);
        assert_eq!(head.source_ask_channel_id, None);
        assert_eq!(head.approved_by_pubkey, owner);
        assert_eq!(head.proposed_by_pubkey, owner);
        assert_eq!(head.source_action_event_id, event.id.to_hex());
        assert_eq!(head.status, DutyStatus::Active);
        assert_eq!(head.proposal.employee_pubkey, employee);
        assert_eq!(head.proposal.channel_id, fixture.channel_id);
        assert_eq!(head.proposal.time_zone, "Africa/Johannesburg");
        let workflow = fixture
            .state
            .db
            .get_workflow(fixture.tenant.community(), head.duty_id)
            .await
            .expect("the routine's workflow exists");
        assert_eq!(workflow.owner_pubkey, fixture.owner.public_key().to_bytes().to_vec());
        assert_eq!(workflow.channel_id, Some(fixture.channel_id));
        assert!(workflow.enabled);
        assert_eq!(hex::encode(&workflow.definition_hash), head.workflow_definition_hash);
        let definition: WorkflowDef =
            serde_json::from_value(workflow.definition).expect("workflow definition");
        match definition.trigger {
            TriggerDef::Schedule { cron, timezone, .. } => {
                assert_eq!(cron.as_deref(), Some(head.proposal.schedule_cron.as_str()));
                assert_eq!(timezone.as_deref(), Some("Africa/Johannesburg"));
            }
            other => panic!("a routine workflow is scheduled, got {other:?}"),
        }
        assert!(matches!(
            &definition.steps[0].action,
            ActionDef::AskAgent { agent_pubkey, .. } if *agent_pubkey == employee
        ));
    }
    let role_routine = &duties[0].1;
    assert_eq!(role_routine.proposal.schedule_cron, "0 10 * * 1");
    let plan_check = &duties[1].1;
    assert_eq!(plan_check.proposal.schedule_text, PLAN_CHECK_DUTY_SCHEDULE);
    assert_eq!(plan_check.proposal.schedule_cron, "0 9 * * 1");
    assert_eq!(plan_check.proposal.instructions, PLAN_CHECK_DUTY_INSTRUCTIONS);
    assert_eq!(channel_workflows(&fixture).await.len(), 2);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_v1_role_pack_gets_a_title_goal_and_only_the_utc_plan_check_routine() {
    let fixture = fixture().await;
    let mut pack = role_pack();
    pack.owns = None;
    pack.channel = None;
    pack.duties.clear();
    pack.on_hire = None;
    pack.ask_before.clear();
    pack.home = None;
    let complete = hire_ready_to_complete(&fixture, pack).await;
    submit(&fixture, sign_hire_action(&fixture.owner, &complete))
        .await
        .expect("complete a v1 hire");

    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1);
    let goal = serde_json::from_str::<GoalHead>(&goals[0].event.content)
        .expect("goal head")
        .goal
        .expect("a live goal");
    assert_eq!(goal.title, "Social Media Manager");
    assert_eq!(goal.done_condition, HIRE_GOAL_DEFAULT_DONE_CONDITION);
    let duties = duty_heads(&fixture).await;
    assert_eq!(duties.len(), 1);
    assert_eq!(duties[0].1.proposal.title, PLAN_CHECK_DUTY_TITLE);
    assert_eq!(duties[0].1.proposal.time_zone, DEFAULT_HIRE_TIME_ZONE);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn an_employee_outside_the_home_channel_rolls_back_the_goal_and_the_hire() {
    let fixture = fixture_with(false, true).await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(
        message.contains("duty employee is not an active member of the channel"),
        "{message}"
    );
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(
        goal_heads(&fixture, complete.hire_id).await.is_empty(),
        "the goal written before the routine step rolled back"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_founder_outside_the_home_channel_cannot_complete_the_hire() {
    let fixture = fixture_with(true, false).await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(
        message.contains("the owner must be a member of the home channel"),
        "{message}"
    );
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(goal_heads(&fixture, complete.hire_id).await.is_empty());
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn an_unknown_time_zone_rolls_back_the_completion() {
    let fixture = fixture().await;
    let mut complete = hire_ready_to_complete(&fixture, role_pack()).await;
    complete.time_zone = Some("Mars/Olympus_Mons".into());
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(message.contains("invalid schedule timezone"), "{message}");
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(goal_heads(&fixture, complete.hire_id).await.is_empty());
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: FAIL. `complete_creates_role_routines_and_plan_check_with_their_workflows` and `a_v1_role_pack_gets_a_title_goal_and_only_the_utc_plan_check_routine` fail their routine assertions (no duty heads); the three rollback tests panic with `expected a rejection, the relay accepted`. The two Task 2.5 tests still pass.

- [ ] **Step 3: Implement**

3a. Insert in `crates/buzz-relay/src/handlers/company_duties.rs` after the closing brace of `replace_prepared_duty_head` (line 364), before `/// Resolve one relay-signed duty head by its d-tag.`:

```rust

/// Hire-completion data that creates one employee's routines and workflows.
pub(crate) struct HireDuties<'a> {
    /// Routine definitions built from the role pack plus the Plan check routine.
    pub(crate) proposals: &'a [DutyProposal],
    /// Member who proposed the hire and its role pack.
    pub(crate) proposer_pubkey: &'a str,
    /// Community owner whose hire signature approves every routine.
    pub(crate) founder_pubkey: &'a str,
    /// Hire recorded as each routine's source.
    pub(crate) hire_id: Uuid,
    /// The `complete` command that writes the routine heads.
    pub(crate) complete_event_id: &'a str,
}

/// Creates a completed hire's routines and schedule workflows in the hire's
/// transaction.
///
/// The employee registration and channel membership rows these checks read
/// were committed by attachment and the introduction, so they hold here. The
/// owner owns every workflow, so the owner must be a channel member for the
/// schedules to run. Any failure leaves the caller to roll back the hire.
pub(crate) async fn create_hire_duties_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    hire: HireDuties<'_>,
) -> Result<Vec<StoredEvent>, IngestError> {
    let Some(first) = hire.proposals.first() else {
        return Ok(Vec::new());
    };
    if hire.proposals.iter().any(|proposal| {
        proposal.employee_pubkey != first.employee_pubkey || proposal.channel_id != first.channel_id
    }) {
        return Err(internal("hire routines must share one employee and channel"));
    }
    validate_duty_proposal(first).map_err(|error| invalid(format!("hire routine: {error}")))?;
    validate_employee_channel(state, tenant, first).await?;
    let workflow_owner_pubkey = hex::decode(hire.founder_pubkey).map_err(internal)?;
    if state
        .db
        .get_member_role(tenant.community(), first.channel_id, &workflow_owner_pubkey)
        .await
        .map_err(internal)?
        .is_none()
    {
        return Err(invalid(
            "the owner must be a member of the home channel so the employee's routines can run",
        ));
    }
    let mut stored = Vec::with_capacity(hire.proposals.len());
    for proposal in hire.proposals {
        validate_duty_proposal(proposal)
            .map_err(|error| invalid(format!("hire routine: {error}")))?;
        let (_, definition_json, definition_hash) = workflow_definition(proposal)?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "company-duty:{}:{}",
                tenant.community().as_uuid(),
                proposal.duty_id
            ))
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let head = DutyHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            duty_id: proposal.duty_id,
            proposal: proposal.clone(),
            status: DutyStatus::Active,
            proposed_by_pubkey: hire.proposer_pubkey.to_owned(),
            approved_by_pubkey: hire.founder_pubkey.to_owned(),
            approved_at: now.clone(),
            source_ask_id: None,
            source_ask_channel_id: None,
            source_hire_id: Some(hire.hire_id),
            workflow_definition_hash: hex::encode(&definition_hash),
            created_at: now.clone(),
            updated_at: now,
            source_action_event_id: hire.complete_event_id.to_owned(),
        };
        validate_duty_head(&head).map_err(|error| internal(format!("hire routine head: {error}")))?;
        let d_tag = duty_d_tag(proposal.duty_id);
        let prepared = PreparedDutyHead {
            duty_id: proposal.duty_id,
            event: relay_duty_head_event(&head, &d_tag, None, state)?,
            d_tag,
            workflow_owner_pubkey: workflow_owner_pubkey.clone(),
            workflow_channel_id: proposal.channel_id,
            workflow_name: proposal.title.clone(),
            workflow_definition: definition_json,
            workflow_hash: definition_hash,
        };
        stored.push(replace_prepared_duty_head(tx, tenant.community(), &prepared, state).await?);
    }
    Ok(stored)
}
```

3b. `crates/buzz-relay/src/handlers/company_hires.rs` imports:

```rust
use buzz_core::company_records::{
    hire_d_tag, hire_duty_proposals, hire_goal_record, parse_company_command,
    validate_hire_action, CompanyCommand, HireAction, HireActionKind, HireHead, HireProposal,
    HireStatus, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_DUTY_HEAD, KIND_GOAL_HEAD, KIND_HIRE_ACTION, KIND_HIRE_HEAD, KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
};
```

3c. In `handle`, pass the time zone:

```rust
    let hire_records = if action.action == HireActionKind::Complete {
        Some(
            create_hire_records(&mut tx, tenant, state, &next, action.time_zone.as_deref())
                .await?,
        )
    } else {
        None
    };
```

3d. Replace `HireRecords`, `create_hire_records` and `dispatch_hire_records` (added in Task 2.5) with:

```rust
/// Records a completed hire creates inside its transaction.
struct HireRecords {
    /// The employee's root goal head.
    goal: StoredEvent,
    /// One routine head per role-pack duty plus the Plan check routine.
    duties: Vec<StoredEvent>,
}

/// Writes the records a completed hire creates inside the hire transaction, so
/// they commit with the hired head and member position or not at all.
async fn create_hire_records(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    hired: &HireHead,
    time_zone: Option<&str>,
) -> Result<HireRecords, IngestError> {
    let employee = hired
        .employee_pubkey
        .as_deref()
        .ok_or_else(|| invalid("complete needs employeePubkey"))?;
    let founder = hired
        .founder_pubkey
        .as_deref()
        .ok_or_else(|| forbidden("founder sign-off is required before hiring"))?;
    let goal = hire_goal_record(&hired.proposal, employee)
        .map_err(|error| invalid(format!("hire goal: {error}")))?;
    let goal = super::company_records::create_hire_goal_in_transaction(
        tx,
        tenant.community(),
        state,
        goal,
        &hired.source_action_event_id,
    )
    .await?;
    let proposals = hire_duty_proposals(&hired.proposal, employee, time_zone, Uuid::new_v4)
        .map_err(|error| invalid(format!("hire routines: {error}")))?;
    let duties = super::company_duties::create_hire_duties_in_transaction(
        tx,
        tenant,
        state,
        super::company_duties::HireDuties {
            proposals: &proposals,
            proposer_pubkey: &hired.proposed_by_pubkey,
            founder_pubkey: founder,
            hire_id: hired.proposal.hire_id,
            complete_event_id: &hired.source_action_event_id,
        },
    )
    .await?;
    Ok(HireRecords { goal, duties })
}

/// Fans out a completed hire's records after commit; each is already durable.
async fn dispatch_hire_records(tenant: &TenantContext, state: &Arc<AppState>, records: HireRecords) {
    let relay_pubkey = state.relay_keypair.public_key().to_hex();
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &records.goal,
        KIND_GOAL_HEAD,
        &relay_pubkey,
        None,
    )
    .await;
    for duty in &records.duties {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            duty,
            KIND_DUTY_HEAD,
            &relay_pubkey,
            None,
        )
        .await;
    }
}
```

The schedule loop anchors a new workflow at its `created_at` (`crates/buzz-workflow/src/lib.rs:590-592`), so the new routines need no scheduler call and do not fire for occurrences before the hire.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: PASS (`7 tests run: 7 passed`).
Run: `cargo clippy -p buzz-relay --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_duties.rs crates/buzz-relay/src/handlers/company_hires.rs crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs
git commit -s -m "feat(relay): create role routines and Plan check when a hire completes"
```

---

### Task 2.7: One on-hire kickoff per hire (buzz-db helper, relay)

**Files:**
- Modify: `crates/buzz-db/src/store/event.rs` (new helper after `insert_event_with_thread_metadata_in_transaction`, which ends at line 1521)
- Modify: `crates/buzz-relay/src/handlers/company_hires.rs` (kickoff builder and insert, `HireRecords.kickoff`, `dispatch_hire_records`, the dispatch call in `handle`)
- Modify: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`
- Test: `crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs`

**Interfaces:**
- Consumes: `insert_event_with_thread_metadata_tx` (`crates/buzz-db/src/store/event.rs:1339-1345`), `crate::insert_mentions_in_transaction` (`crates/buzz-db/src/runtime/mod.rs:45-50`), `buzz_db::event::ThreadMetadataParams` (`crates/buzz-db/src/store/event.rs:1318-1337`, built the same way as the workflow sink's top-level message at `crates/buzz-relay/src/workflow_sink.rs:423-433`).
- Produces: `pub async fn buzz_db::event::insert_message_with_mentions_in_transaction(tx: &mut Transaction<'_, Postgres>, community_id: CommunityId, event: &Event, channel_id: Uuid, thread_meta: Option<ThreadMetadataParams<'_>>) -> Result<(StoredEvent, bool)>`. On the wire, per completed hire, exactly one relay-signed kind 9 in the home channel with tags, in order, `["h", <home channel>]`, `["p", <owner>]`, `["p", <employee>]`, `["buzz:workflow","true"]`, `["buzz:workflow-owner", <owner>]`, `["buzz:workflow-mention", <employee>]`, `["colony:on-hire", <hire uuid>]`, and content `@<display name> you're hired. Study the business and your sources, then write your first 2-week plan and send it to your manager for approval.` It is found by a `#p` query for the employee. Part C's missed wake-up catch-up and the employee's author gate (`crates/buzz-acp/src/lib.rs:258-321`) consume it. Part D's hire journal can treat a hire head with status `hired` as "already complete": a replayed `complete` returns accepted with a message starting `duplicate:`, and a second `complete` is rejected with `founder sign-off is required before hiring`.

- [ ] **Step 1: Write the failing test**

In `postgres_tests.rs`, add after `channel_workflows`:

```rust
async fn kickoffs(fixture: &Fixture, hire_id: Uuid) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_STREAM_MESSAGE as i32]);
    query.channel_id = Some(fixture.channel_id);
    query.p_tag_hex = Some(fixture.employee.public_key().to_hex());
    query.custom_tag = Some(("colony:on-hire".to_owned(), hire_id.to_string()));
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query on-hire kickoffs")
}
```

Add as the last statement of `assert_completion_left_nothing`:

```rust
    assert!(
        kickoffs(fixture, complete.hire_id).await.is_empty(),
        "no on-hire kickoff"
    );
```

Append this test:

```rust
#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_publishes_exactly_one_workflow_tagged_kickoff() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let found = kickoffs(&fixture, complete.hire_id).await;
    assert_eq!(found.len(), 1, "one kickoff, found through the employee mention index");
    let kickoff = &found[0];
    assert_eq!(kickoff.event.pubkey, fixture.state.relay_keypair.public_key());
    assert!(kickoff.event.verify().is_ok());
    assert_eq!(kickoff.channel_id, Some(fixture.channel_id));
    let owner = fixture.owner.public_key().to_hex();
    let employee = fixture.employee.public_key().to_hex();
    let expected = vec![
        vec!["h".to_owned(), fixture.channel_id.to_string()],
        vec!["p".to_owned(), owner.clone()],
        vec!["p".to_owned(), employee.clone()],
        vec!["buzz:workflow".to_owned(), "true".to_owned()],
        vec!["buzz:workflow-owner".to_owned(), owner.clone()],
        vec!["buzz:workflow-mention".to_owned(), employee.clone()],
        vec!["colony:on-hire".to_owned(), complete.hire_id.to_string()],
    ];
    let tags = kickoff
        .event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    assert_eq!(tags, expected);
    let proposal = parse_hire_head(&hire_head(&fixture, complete.hire_id).await)
        .expect("parse the hire head")
        .proposal;
    assert_eq!(
        kickoff.event.content,
        format!(
            "@{} you're hired. Study the business and your sources, then write your first 2-week plan and send it to your manager for approval.",
            proposal.display_name
        )
    );

    // A replay of the accepted command and a fresh complete both leave one kickoff.
    match submit(&fixture, event.clone()).await {
        Ok(result) => assert!(result.message.starts_with("duplicate:")),
        Err(IngestError::Rejected(message)) => {
            assert!(message.contains("founder sign-off is required before hiring"), "{message}")
        }
        Err(other) => panic!("unexpected replay result {other:?}"),
    }
    let mut second = complete.clone();
    second.expected_head_event_id =
        Some(hire_head(&fixture, complete.hire_id).await.event.id.to_hex());
    let message = rejection(submit(&fixture, sign_hire_action(&fixture.owner, &second)).await);
    assert!(message.contains("founder sign-off is required before hiring"), "{message}");
    assert_eq!(kickoffs(&fixture, complete.hire_id).await.len(), 1, "once per hire");
    assert_eq!(goal_heads(&fixture, complete.hire_id).await.len(), 1);
    assert_eq!(duty_heads(&fixture).await.len(), 2);
    assert_eq!(channel_workflows(&fixture).await.len(), 2);
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: FAIL. `complete_publishes_exactly_one_workflow_tagged_kickoff` panics with `one kickoff, found through the employee mention index` (`left: 0`, `right: 1`); the other seven tests pass.

- [ ] **Step 3: Implement**

3a. `crates/buzz-db/src/store/event.rs`, insert after the closing brace of `insert_event_with_thread_metadata_in_transaction` (line 1521):

```rust

/// Insert a relay-authored channel message with its thread metadata and its
/// `p`-tag mention index in a caller-owned transaction.
///
/// A `#p` history read joins `event_mentions`, so an agent that was offline
/// finds the message only when the index commits with the message itself.
pub async fn insert_message_with_mentions_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    event: &Event,
    channel_id: Uuid,
    thread_meta: Option<ThreadMetadataParams<'_>>,
) -> Result<(StoredEvent, bool)> {
    let inserted = insert_event_with_thread_metadata_tx(
        tx,
        community_id,
        event,
        Some(channel_id),
        thread_meta,
    )
    .await?;
    if inserted.1 {
        crate::insert_mentions_in_transaction(tx, community_id, event, Some(channel_id)).await?;
    }
    Ok(inserted)
}
```

3b. `crates/buzz-relay/src/handlers/company_hires.rs`: replace `HireRecords`, change the end of `create_hire_records`, and replace the Task 2.6 `dispatch_hire_records` with the version at the end of the second block below. First, `HireRecords`:

```rust
/// Records a completed hire creates inside its transaction.
struct HireRecords {
    /// The employee's root goal head.
    goal: StoredEvent,
    /// One routine head per role-pack duty plus the Plan check routine.
    duties: Vec<StoredEvent>,
    /// The single on-hire kickoff message.
    kickoff: StoredEvent,
}
```

In `create_hire_records`, replace `Ok(HireRecords { goal, duties })` and the closing brace of the function, then delete the Task 2.6 `dispatch_hire_records`, and put this in their place:

```rust
    let kickoff = insert_on_hire_kickoff(tx, tenant.community(), hired, state).await?;
    Ok(HireRecords {
        goal,
        duties,
        kickoff,
    })
}

/// Tag naming the hire an on-hire kickoff belongs to.
const ON_HIRE_TAG: &str = "colony:on-hire";

/// Text of the on-hire kickoff addressed to the new employee.
fn on_hire_kickoff_content(display_name: &str) -> String {
    format!(
        "@{display_name} you're hired. Study the business and your sources, then write your first 2-week plan and send it to your manager for approval."
    )
}

/// Builds the relay-signed on-hire kickoff in the employee's home channel.
///
/// It carries the tags of a workflow agent wake, owned by the owner and
/// mentioning the employee, so the employee's author gate accepts it.
fn on_hire_kickoff_event(hired: &HireHead, state: &AppState) -> Result<Event, IngestError> {
    let founder = hired
        .founder_pubkey
        .as_deref()
        .ok_or_else(|| forbidden("founder sign-off is required before hiring"))?;
    let employee = hired
        .employee_pubkey
        .as_deref()
        .ok_or_else(|| invalid("complete needs employeePubkey"))?;
    let channel_id = hired.proposal.introduction_channel_id.to_string();
    let hire_id = hired.proposal.hire_id.to_string();
    let tags = [
        ["h", channel_id.as_str()],
        ["p", founder],
        ["p", employee],
        ["buzz:workflow", "true"],
        ["buzz:workflow-owner", founder],
        ["buzz:workflow-mention", employee],
        [ON_HIRE_TAG, hire_id.as_str()],
    ]
    .into_iter()
    .map(|tag| Tag::parse(tag).map_err(|error| internal(format!("on-hire tag: {error}"))))
    .collect::<Result<Vec<_>, _>>()?;
    EventBuilder::new(
        Kind::from(KIND_STREAM_MESSAGE as u16),
        on_hire_kickoff_content(&hired.proposal.display_name),
    )
    .tags(tags)
    .sign_with_keys(&state.relay_keypair)
    .map_err(internal)
}

/// Stores the kickoff with its thread row and mention index in the hire
/// transaction. The hire moves to hired once, so its kickoff exists once.
async fn insert_on_hire_kickoff(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    hired: &HireHead,
    state: &AppState,
) -> Result<StoredEvent, IngestError> {
    let kickoff = on_hire_kickoff_event(hired, state)?;
    let channel_id = hired.proposal.introduction_channel_id;
    let created_secs = i64::try_from(kickoff.created_at.as_secs()).map_err(internal)?;
    let created_at = chrono::DateTime::from_timestamp(created_secs, 0)
        .ok_or_else(|| internal("on-hire kickoff timestamp is invalid"))?;
    let event_id = kickoff.id.as_bytes().to_vec();
    let thread_meta = buzz_db::event::ThreadMetadataParams {
        event_id: &event_id,
        event_created_at: created_at,
        channel_id,
        parent_event_id: None,
        parent_event_created_at: None,
        root_event_id: None,
        root_event_created_at: None,
        depth: 0,
        broadcast: false,
    };
    let (stored, inserted) = buzz_db::event::insert_message_with_mentions_in_transaction(
        tx,
        community_id,
        &kickoff,
        channel_id,
        Some(thread_meta),
    )
    .await
    .map_err(internal)?;
    if !inserted {
        return Err(conflict("on-hire kickoff already exists"));
    }
    Ok(stored)
}

/// Fans out a completed hire's records after commit. Each record is already
/// durable, so an employee that misses the live kickoff reads it when it catches up.
async fn dispatch_hire_records(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    records: HireRecords,
    founder_pubkey: &str,
) {
    let relay_pubkey = state.relay_keypair.public_key().to_hex();
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &records.goal,
        KIND_GOAL_HEAD,
        &relay_pubkey,
        None,
    )
    .await;
    for duty in &records.duties {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            duty,
            KIND_DUTY_HEAD,
            &relay_pubkey,
            None,
        )
        .await;
    }
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &records.kickoff,
        KIND_STREAM_MESSAGE,
        founder_pubkey,
        None,
    )
    .await;
}
```

3c. In `handle`, pass the owner (the actor of `complete` is always the owner, `company_hires.rs:71-77`):

```rust
    if let Some(records) = hire_records {
        dispatch_hire_records(tenant, state, records, &actor_pubkey).await;
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `scripts/postgres-test-run.sh -p buzz-relay --lib company_hires::postgres_tests`
Expected: PASS (`8 tests run: 8 passed`).
Run: `cargo clippy -p buzz-db -p buzz-relay --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-db/src/store/event.rs crates/buzz-relay/src/handlers/company_hires.rs crates/buzz-relay/src/handlers/company_hires/postgres_tests.rs
git commit -s -m "feat(relay): post one on-hire kickoff when a hire completes"
```

---

### Task 2.8: Contract documentation for hire completion

**Files:**
- Modify: `docs/company-records.md:553-556` (hire head tags), `:606-609` (what `complete` writes), `:906` (duty sources)

**Interfaces:**
- Consumes: Tasks 2.1 to 2.7.
- Produces: the written contract the new app (phase 1) and other clients rely on.

- [ ] **Step 1: Write the failing check**

There is no automated doc test. The check that the contract terms are present:

```bash
grep -c "sourceHireId\|colony:on-hire\|Plan check\|timeZone" docs/company-records.md
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `grep -c "sourceHireId\|colony:on-hire\|Plan check\|timeZone" docs/company-records.md`
Expected: FAIL, prints `0`.

- [ ] **Step 3: Implement**

3a. Replace the sentence at lines 553-554 (`Hire heads and hire actions carry no `h` tag. The d-tag is` and `` `company:hire:<hire-uuid>`. ``, up to the end of that sentence) with:

```markdown
Hire heads and hire actions carry no `h` tag. The d-tag is
`company:hire:<hire-uuid>`. Once an employee is attached, the hire head also
carries one `p` tag naming the employee pubkey, so clients can find an
employee's hire by `#p`.
```

3b. Replace lines 606-609 (from "`complete` verifies the real" to "after that transaction succeeds.") with:

```markdown
`complete` verifies the real agent and introduction event, then atomically
advances the hire head, creates the employee member-position head, and creates
the hire records described below. The profile opens with the configured title,
manager, channel, and runtime values after that transaction succeeds.

Role packs may carry optional v2 fields: `owns` (the outcome the role owns,
1 to 500 characters), `channel` (default home conversation name, 1 to 80
characters of `a-z`, `0-9` and `-`), `duties` (at most 8 routines, each with a
`title`, a readable `scheduleText` and `instructions`), `onHire` (`sources` to
study, at most 8, and `planHorizonDays`, 1 to 30, default 14), `askBefore` (at
most 16 actions that always need a person) and `home` (the role's desk in the
app). A pack without them keeps its exact shape. The owner's signature on the
hire approves the role's routines.

`complete` may carry the owner's IANA `timeZone`; no other hire action may.
In the same transaction as the hired head and the member position, the relay
writes:

- the employee's root goal at `company:goal:<hire-uuid>`: title from `owns`
  (cut at a word to 180 characters) or the hire title, done condition `owns`
  or "Plan approved and delivered", owned by the employee and linked to the
  introduction channel;
- one routine (duty head) per role-pack duty plus the built-in "Plan check"
  routine (`Every Monday at 09:00`), each in the introduction channel, in
  `timeZone` or UTC, with `sourceHireId`, approved by the owner, and each with
  its schedule workflow owned by the owner;
- one relay-signed kind 9 on-hire kickoff in the introduction channel with
  `p` tags for the owner and the employee, `buzz:workflow`,
  `buzz:workflow-owner` (owner), `buzz:workflow-mention` (employee) and
  `["colony:on-hire", <hire-uuid>]`. It is stored with its mention index and
  fanned out after commit, so an employee that starts later still finds it.

Any failure rejects `complete` and stores none of these records: a goal
already at the hire id, an employee or owner that is not a member of the
introduction channel, or a time zone the schedule engine does not know. A
replayed `complete` returns the stored duplicate result, and a second
`complete` on a hired head is rejected, so each record exists once per hire.
```

3c. After line 906 (`duty. A rejected proposal leaves no active duty head.`) add a new paragraph:

```markdown

A duty head names exactly one source: `sourceAskId` with `sourceAskChannelId`
for a duty approved through an ask, or `sourceHireId` for a routine created
when its hire completed.
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `grep -c "sourceHireId\|colony:on-hire\|Plan check\|timeZone" docs/company-records.md`
Expected: PASS, prints a number of at least `4`.
Run: `git diff docs/company-records.md | grep '^+' | grep -c $'\xe2\x80\x94'`
Expected: prints `0` (no em dash, U+2014, in the added lines).

- [ ] **Step 5: Commit**

```bash
git add docs/company-records.md
git commit -s -m "docs: describe hire completion records and role pack v2"
```

---

## Contract changes

These differ from, or add to, `00-overview.md` and the earlier brief it points to. None renames an overview name.

1. **Kickoff text.** The earlier brief's kickoff asked the employee to write its plan "in this channel's canvas". The new app has no canvas surface for plans (plans become cards, E-08), so the content is now `@<display name> you're hired. Study the business and your sources, then write your first 2-week plan and send it to your manager for approval.` Tags are unchanged. Part C keys on the `colony:on-hire` tag, never on the text.
2. **Plan check instructions.** New constant `PLAN_CHECK_DUTY_INSTRUCTIONS = "Check your 2-week plan. If it is 14 days old or finished, write the next 2-week plan and send it to your manager for approval."` (the overview names only the title and schedule).
3. **The owner must be a member of the home channel for `complete` to succeed** (new rejection: `the owner must be a member of the home channel so the employee's routines can run`). Part D's `team_hire_complete` must pass a home channel the owner belongs to; the new app's conversations always include the owner, so this holds for the first run.
4. **Default time zone.** When `complete` carries no `timeZone`, routines run in `DEFAULT_HIRE_TIME_ZONE` ("UTC"). Part D should always send the company time zone from the business profile.
5. **New shared names** for later parts: `hire_goal_record`, `hire_duty_proposals`, `HIRE_GOAL_DEFAULT_DONE_CONDITION`, `DEFAULT_HIRE_TIME_ZONE`, `buzz_db::event::insert_message_with_mentions_in_transaction`.

## Self-review

**Spec coverage.**

| Requirement | Task |
|-|-|
| E-09 role pack format: `owns`, `channel`, `duties`, `onHire`, `askBefore`, `home`, validated; old packs keep their shape; no `workFolder` | 2.1 |
| Overview: `HireAction.time_zone` allowed only on `complete` | 2.2 |
| Overview: `DutyHead.source_hire_id`, exactly one source, old ask-sourced heads parse | 2.3 |
| Overview: built-in "Plan check", "Every Monday at 09:00" | 2.4, 2.6 |
| E-10 relay side: `complete` creates the goal | 2.4, 2.5 |
| E-10 relay side: one routine per role duty plus Plan check, each with its schedule workflow | 2.4, 2.6 |
| E-10 relay side: all or nothing with the hire head and member position | 2.5, 2.6, 2.7 (`assert_completion_left_nothing`) |
| E-10 relay side: one kickoff after commit with the workflow tags, found by an offline employee | 2.7 |
| Overview Review Focus 1, relay half: a retried `complete` creates nothing twice | 2.7 |
| Written contract for other clients | 2.8 |

Not in this part, by the overview's design: ask head `p` tags (part F), the host's hire command and journal (part D), role context and missed wake-ups in the harness (part C), partners approving hires (E-19, phase 3), the new app's record parsers (phase 1).

**Placeholder scan.** Every code step carries the code to write; every run step names the command and the expected result. No "TBD", no "similar to", no unspecified error handling.

**Type consistency.** `RoleDutyTemplate` and `RoleOnHire` (2.1) are used unchanged in 2.4 and the 2.5 fixture. `HireAction.time_zone` (2.2) is read in 2.6 as `action.time_zone.as_deref()`. `DutyHead.source_*` as `Option<Uuid>` (2.3) is written in 2.6. `PLAN_CHECK_DUTY_TITLE`, `PLAN_CHECK_DUTY_SCHEDULE`, `PLAN_CHECK_DUTY_INSTRUCTIONS`, `DEFAULT_HIRE_TIME_ZONE` and `HIRE_GOAL_DEFAULT_DONE_CONDITION` (2.4) are the names imported in the 2.6 tests. `create_hire_records` gains its `time_zone` parameter in 2.6 and keeps it in 2.7; `dispatch_hire_records` gains `founder_pubkey` in 2.7, and the call in `handle` changes with it (2.7, step 3c).

**Review Focus.** Each of the five items above names the test that pins it, and each of those tests sits in the task that owns the code.

**Risk to watch.** Records with the new keys break older clients: desktops at 1.0.7 or older reject hire heads whose role pack carries v2 keys and duty heads without `sourceAskId`, and their record lists may fail as a whole. The overview accepts this for the new app; any company still opened in an old desktop after a hire through the new engine will see that failure.
