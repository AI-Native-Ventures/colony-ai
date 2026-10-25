# Team status and notification rules (part H) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Scout and the new app one honest picture of every employee (the G-07 status words), and turn relay records and host events into the computer notifications of G-03, with quiet hours, no repeats and nothing for what is already in front of the person.

**Architecture:** Three layers. (1) A pure Rust assembly in buzz-core feeds a new `colony team status` command, which Scout runs to see each employee's current work, last activity and decisions waiting on people. (2) Pure TypeScript modules in `app/src/shared/team/` parse relay records and derive each employee's G-07 status from the host's runtime status plus relay facts; a team status service in the Electron main process loads, refreshes (fenced by generation) and exposes these through the bridge. (3) A pure rules module in `app/src/main/notifications/` decides, for every typed event, whether to show, replace, withdraw or suppress a notification; producers turn relay records and host events into typed events, a small store keeps delivered keys and preferences on disk, and a service applies decisions through part E's notifier. Part E's main process is plain ES modules (`app/electron/*.mjs`) with one allowlisted bridge channel and no relay socket, so this part's main-side TypeScript (team status, the notification engine, a relay feed over part E's `RelayConnection`, and handlers for part E's bridge router) is bundled by esbuild into `app/electron/team-and-notifications.mjs`, which `main.mjs` imports.

**Tech Stack:** Rust (buzz-core, buzz-cli, serde, clap); TypeScript with Vitest, bundled into Electron main by esbuild 0.28.2 (already in part E's toolchain); `Intl` for time zones; Node `fs/promises` for the store. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md`; screen pack `docs/superpowers/specs/2026-10-11-colony-os-screens/01-shell-and-global.md` (G-03 computer notifications, G-07 employee identity), `06-settings.md` (S-06 notifications) and `10-data-and-engine.md` (E-13 team status, E-26 notifications). Contract: `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md` (this part is H, tasks 8.x; it depends on parts D, E and F).


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 4, 17 (owner-only billing asks deferred to phase 2) and 18 (pause on other computers deferred to phase 3). Where they differ from the tasks below, the amendments win.

## Global Constraints

The global constraints in `00-overview.md` apply to every task. In addition:

- Notification titles, bodies and click targets use the G-03 words exactly; the only adaptation is gender-neutral wording ("Want me to restart them?").
- Quiet hours default to on, from 21:00 to 07:00 in this computer's local time. "Let urgent problems through" defaults to on. Urgent means: employee problem, Scout stopped, team stopped, team paused.
- Decisions and urgent problems cannot be switched off. Morning brief, Friday wrap, time to post and customer waiting can be.
- Decisions that arrive within 60 seconds of the first one become one notification. Problems are never grouped with decisions.
- Colony never repeats a notification: every shown or suppressed key is remembered (at most 2,000 keys, at most 14 days), and anything created before the last time Colony ran is history.
- Other computers show an employee as Away once the team computer has not been seen for more than 600 seconds.
- Every relay filter names its kinds; one query carries at most 10 filters.
- Record parsers never throw on a bad record: they return `null` and the record is skipped.
- No notification text contains a file path, key, model name or error code.
- No new npm or Cargo dependency.
- Main-side TypeScript in this part never imports Electron; part E's `main.mjs` passes every Electron object and host call in, so every module runs under Vitest with fakes.

## Review Focus

1. **Colony restarts and the relay replays history.** Expected: no notification for any decision created before Colony last ran, and never two for the same decision. Pinned in Task 8.7 (history and duplicate cases) and Task 8.9 (service restart test).
2. **Quiet hours across midnight.** Expected: with 21:00 to 07:00, a decision at 20:59 notifies, at 21:00 and 06:59 it does not (and never does later), at 07:00 it does; an employee problem at 03:00 notifies unless "Let urgent problems through" is off. Pinned in Task 8.7.
3. **A partner and billing.** Expected: a partner never gets an owner-only decision or a credits-low notification, and the team-paused notification tells a partner who can fix it. Pinned in Task 8.7.
4. **A computer that does not run the team.** Expected: once the team computer has been silent for more than 10 minutes, every employee shows Away with that computer's name, never Free or Working. Pinned in Task 8.5.
5. **A slow refresh finishing late.** Expected: a team status refresh that started first but finished last never overwrites the newer statuses (AGENTS.md rule 2). Pinned in Task 8.6.

## File map

| File | Responsibility |
|-|-|
| `crates/buzz-core/src/company_team_status.rs` | Pure assembly of per-employee status for Scout |
| `crates/buzz-core/tests/company_team_status.rs` | Tests for the assembly |
| `crates/buzz-cli/src/commands/team.rs` | `colony team status`: fetch records, call the assembly, print JSON |
| `app/src/shared/team/kinds.ts` | Record kind numbers used here |
| `app/src/shared/team/nostr.ts` | Event and filter types, tag helpers |
| `app/src/shared/team/records.ts` | Parsers for member, work item, ask, duty, team computer, brief and profile records |
| `app/src/shared/team/testEvents.ts` | Shared test fixtures |
| `app/src/shared/team/schedule.ts` | Next run of a routine and local clock formatting |
| `app/src/shared/team/teamStatus.ts` | G-07 status derivation |
| `app/src/shared/notifications/preferences.ts` | S-06 preferences, focus report, validators |
| `app/src/shared/notifications/context.ts` | Who uses Colony here and for which company (reported by the renderer), with validators |
| `app/src/main/team/relayFeed.ts` | The relay access main needs, and the relay's own key |
| `app/src/main/team/teamStatusService.ts` | Load, refresh and watch team status |
| `app/src/main/team/hostPayloads.ts` | Checks host answers and events before use |
| `app/src/main/team/mainRelayFeed.ts` | Main's own relay socket per company over part E's `RelayConnection`: queries, live views, reconnect |
| `app/src/main/notifications/types.ts` | Typed notification events, context, decisions, rules state |
| `app/src/main/notifications/rules.ts` | Pure G-03 rules |
| `app/src/main/notifications/producers.ts` | Relay records and host events to typed events |
| `app/src/main/notifications/store.ts` | Delivered keys, last run time and preferences on disk |
| `app/src/main/notifications/service.ts` | Applies decisions to native notifications |
| `app/src/main/notifications/bridgeHandlers.ts` | Bridge methods for part E's router, with argument checks |
| `app/src/main/teamAndNotifications.ts` | The engine: company in use, Needs you reads, live views, host events, overview pushes |
| `app/src/main/entry.ts` | Bundle entry for main |
| `app/scripts/build-main.mjs` | Bundles `app/src/main/entry.ts` into the ignored `app/electron/team-and-notifications.mjs` |
| `app/src/bridge/teamAndNotifications.contract.ts` | Compile-time check of the bridge additions |
| Part E files changed in Tasks 8.14 and 8.15 | `app/package.json`, `app/.gitignore`, `app/electron/notifications.mjs`, `app/electron/navigation.mjs`, `app/electron/bridge-contract.mjs`, `app/electron/preload.cjs`, `app/electron/main.mjs`, `app/src/bridge/types.ts`, `app/src/console/EngineConsole.tsx` and their tests |

Commands: Rust tests run with `cargo test -p <crate> ...`; TypeScript tests with `pnpm -C app exec vitest run <path>` (part E creates the `app` package with Vitest).

---

### Task 8.1: Team status assembly in buzz-core

**Files:**
- Create: `crates/buzz-core/src/company_team_status.rs`
- Modify: `crates/buzz-core/src/lib.rs:24-27` (module list, between `company_spend` and `company_work_tracking`)
- Test: `crates/buzz-core/tests/company_team_status.rs`

**Interfaces:**
- Consumes: `MemberPositionHead`, `MemberKind`, `MemberStatus` (`crates/buzz-core/src/company_members.rs:16-103`); `CompanyWorkItemHead`, `CompanyWorkStatus` (`crates/buzz-core/src/business_records.rs:514-630`); `AskHead`, `AskStatus`, `AskSubjectKind` (`crates/buzz-core/src/company_records.rs:566-589, 1144-1228`).
- Produces:
  - `pub struct WorkItemSnapshot { pub head: CompanyWorkItemHead, pub updated_at: u64 }`
  - `pub struct AskSnapshot { pub head: AskHead, pub people: Vec<String> }`
  - `pub struct ActivitySnapshot { pub pubkey: String, pub at: u64 }`
  - `pub struct CurrentWork { pub work_item_id: Uuid, pub title: String, pub status: CompanyWorkStatus, pub due_at: Option<String> }` (serializes camelCase)
  - `pub struct TeamMemberStatus { pub pubkey: String, pub name: Option<String>, pub title: String, pub status: MemberStatus, pub paused_reason: Option<String>, pub current_work: Option<CurrentWork>, pub last_activity_at: Option<u64>, pub open_asks_waiting_on_people: u32 }` (serializes camelCase, empty options omitted)
  - `pub fn assemble_team_status(members: &[MemberPositionHead], names: &HashMap<String, String>, work_items: &[WorkItemSnapshot], asks: &[AskSnapshot], activity: &[ActivitySnapshot]) -> Vec<TeamMemberStatus>`

- [ ] **Step 1: Write the failing test**

Create `crates/buzz-core/tests/company_team_status.rs`:

```rust
//! Tests for the read-only team status behind `colony team status`.

use std::collections::HashMap;

use buzz_core::business_records::CompanyWorkStatus;
use buzz_core::company_members::{MemberPositionHead, MemberStatus};
use buzz_core::company_team_status::{
    assemble_team_status, ActivitySnapshot, AskSnapshot, WorkItemSnapshot,
};
use serde_json::json;
use uuid::Uuid;

const NALEDI: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const SIPHO: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const LERATO: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const LEO: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const SCOUT: &str = "5555555555555555555555555555555555555555555555555555555555555555";

const WORK_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORK_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORK_C: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASK_1: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASK_2: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ASK_3: &str = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ASK_4: &str = "12121212-1212-4121-8121-121212121212";
const ASK_5: &str = "34343434-3434-4343-8343-343434343434";

fn member(
    pubkey: &str,
    title: &str,
    kind: &str,
    status: &str,
    reason: Option<&str>,
) -> MemberPositionHead {
    serde_json::from_value(json!({
        "schemaVersion": 1,
        "pubkey": pubkey,
        "title": title,
        "kind": kind,
        "status": status,
        "reason": reason,
        "sourceActionEventId": "a".repeat(64),
        "updatedAt": "2026-10-11T08:00:00Z"
    }))
    .expect("member position head")
}

fn work(id: &str, title: &str, status: &str, assignee: &str, updated_at: u64) -> WorkItemSnapshot {
    WorkItemSnapshot {
        head: serde_json::from_value(json!({
            "schemaVersion": 1,
            "workItemId": id,
            "title": title,
            "status": status,
            "assignedPubkeys": [assignee],
            "approverPubkeys": [],
            "deliverables": [],
            "requesterPubkey": LERATO,
            "doneCondition": "Lerato approves it",
            "sourceActionEventId": "b".repeat(64)
        }))
        .expect("work item head"),
        updated_at,
    }
}

fn ask(
    id: &str,
    asker: &str,
    status: &str,
    people: &[&str],
    about_work: Option<&str>,
    addressee: Option<&str>,
) -> AskSnapshot {
    let mut record = json!({
        "schemaVersion": 1,
        "askId": id,
        "type": "approval",
        "category": "general",
        "title": "Approve next week's posts"
    });
    if let Some(work_item_id) = about_work {
        record["subject"] = json!({ "kind": "workItem", "id": work_item_id });
    }
    if let Some(addressee) = addressee {
        record["addresseePubkey"] = json!(addressee);
    }
    AskSnapshot {
        head: serde_json::from_value(json!({
            "schemaVersion": 1,
            "askId": id,
            "status": status,
            "askerPubkey": asker,
            "createdAt": "2026-10-11T08:00:00Z",
            "ask": record,
            "sourceActionEventId": "c".repeat(64)
        }))
        .expect("ask head"),
        people: people.iter().map(|person| (*person).to_owned()).collect(),
    }
}

fn names() -> HashMap<String, String> {
    HashMap::from([
        (NALEDI.to_owned(), "Naledi".to_owned()),
        (SIPHO.to_owned(), "Sipho".to_owned()),
        (LEO.to_owned(), "Leo".to_owned()),
        (SCOUT.to_owned(), "Scout".to_owned()),
    ])
}

#[test]
fn includes_only_active_and_paused_employees_sorted_by_name() {
    let members = vec![
        member(SIPHO, "Sales Director", "employee", "active", None),
        member(LERATO, "Owner", "human", "active", None),
        member(LEO, "Website Builder", "employee", "terminated", Some("Let go by Lerato")),
        member(NALEDI, "Social Media Manager", "employee", "paused", Some("Paused by Kagiso")),
    ];
    let statuses = assemble_team_status(&members, &names(), &[], &[], &[]);
    let order: Vec<&str> = statuses.iter().map(|status| status.pubkey.as_str()).collect();
    assert_eq!(order, vec![NALEDI, SIPHO]);
    assert_eq!(statuses[0].status, MemberStatus::Paused);
    assert_eq!(statuses[0].paused_reason.as_deref(), Some("Paused by Kagiso"));
    assert_eq!(statuses[1].paused_reason, None);
    assert_eq!(statuses[1].name.as_deref(), Some("Sipho"));
}

#[test]
fn current_work_prefers_the_newest_active_item_then_blocked() {
    let members = vec![member(NALEDI, "Social Media Manager", "employee", "active", None)];
    let items = vec![
        work(WORK_A, "Draft next week's posts", "active", NALEDI, 100),
        work(WORK_B, "Spring carousel", "active", NALEDI, 200),
        work(WORK_C, "Old campaign", "done_verified", NALEDI, 300),
    ];
    let statuses = assemble_team_status(&members, &names(), &items, &[], &[]);
    let current = statuses[0].current_work.as_ref().expect("current work");
    assert_eq!(current.work_item_id, Uuid::parse_str(WORK_B).expect("uuid"));
    assert_eq!(current.status, CompanyWorkStatus::Active);

    let blocked_only = vec![
        work(WORK_A, "Waiting for photos", "blocked", NALEDI, 100),
        work(WORK_C, "Sipho's leads", "active", SIPHO, 400),
    ];
    let statuses = assemble_team_status(&members, &names(), &blocked_only, &[], &[]);
    let current = statuses[0]
        .current_work
        .as_ref()
        .expect("blocked work counts when nothing is active");
    assert_eq!(current.title, "Waiting for photos");
    assert_eq!(current.status, CompanyWorkStatus::Blocked);
}

#[test]
fn counts_open_asks_by_or_about_the_employee_that_wait_on_people() {
    let members = vec![
        member(NALEDI, "Social Media Manager", "employee", "active", None),
        member(SCOUT, "Chief of Staff", "employee", "active", None),
    ];
    let items = vec![work(WORK_A, "Draft next week's posts", "active", NALEDI, 100)];
    let asks = vec![
        ask(ASK_1, NALEDI, "open", &[LERATO], None, None),
        ask(ASK_2, SCOUT, "open", &[LERATO], Some(WORK_A), None),
        ask(ASK_3, NALEDI, "resolved", &[LERATO], None, None),
        ask(ASK_4, NALEDI, "open", &[], None, None),
        ask(ASK_5, NALEDI, "open", &[LERATO], None, Some(SCOUT)),
    ];
    let statuses = assemble_team_status(&members, &names(), &items, &asks, &[]);
    let naledi = statuses.iter().find(|status| status.pubkey == NALEDI).expect("Naledi");
    let scout = statuses.iter().find(|status| status.pubkey == SCOUT).expect("Scout");
    assert_eq!(naledi.open_asks_waiting_on_people, 2);
    assert_eq!(scout.open_asks_waiting_on_people, 1);
}

#[test]
fn last_activity_is_the_newest_event_of_that_employee() {
    let members = vec![
        member(NALEDI, "Social Media Manager", "employee", "active", None),
        member(SIPHO, "Sales Director", "employee", "active", None),
    ];
    let activity = vec![
        ActivitySnapshot { pubkey: NALEDI.to_owned(), at: 1_760_180_000 },
        ActivitySnapshot { pubkey: NALEDI.to_owned(), at: 1_760_183_600 },
        ActivitySnapshot { pubkey: LERATO.to_owned(), at: 1_760_190_000 },
    ];
    let statuses = assemble_team_status(&members, &names(), &[], &[], &activity);
    let naledi = statuses.iter().find(|status| status.pubkey == NALEDI).expect("Naledi");
    let sipho = statuses.iter().find(|status| status.pubkey == SIPHO).expect("Sipho");
    assert_eq!(naledi.last_activity_at, Some(1_760_183_600));
    assert_eq!(sipho.last_activity_at, None);
}

#[test]
fn serializes_in_camel_case_without_empty_fields() {
    let members = vec![member(SIPHO, "Sales Director", "employee", "active", None)];
    let statuses = assemble_team_status(&members, &HashMap::new(), &[], &[], &[]);
    let value = serde_json::to_value(&statuses).expect("serialize");
    assert_eq!(
        value,
        json!([{
            "pubkey": SIPHO,
            "title": "Sales Director",
            "status": "active",
            "openAsksWaitingOnPeople": 0
        }])
    );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p buzz-core --test company_team_status`
Expected: FAIL to compile with `could not find `company_team_status` in `buzz_core``.

- [ ] **Step 3: Write the implementation**

Create `crates/buzz-core/src/company_team_status.rs`:

```rust
//! Read-only team status assembled from company records.
//!
//! `colony team status` uses this to tell Scout, for every employee, what it
//! is working on now, when it last did something, and how many of its
//! decisions are waiting on people. Pure and I/O free: callers fetch and
//! verify the records first.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use uuid::Uuid;

use crate::business_records::{CompanyWorkItemHead, CompanyWorkStatus};
use crate::company_members::{MemberKind, MemberPositionHead, MemberStatus};
use crate::company_records::{AskHead, AskStatus, AskSubjectKind};

/// A company work item head and the time the relay last wrote it.
#[derive(Debug, Clone)]
pub struct WorkItemSnapshot {
    /// Current head content.
    pub head: CompanyWorkItemHead,
    /// `created_at` of the head event, in Unix seconds.
    pub updated_at: u64,
}

/// An ask head and the people its event names in `p` tags.
#[derive(Debug, Clone)]
pub struct AskSnapshot {
    /// Current head content.
    pub head: AskHead,
    /// Lowercase 64-hex pubkeys from the head event's `p` tags.
    pub people: Vec<String>,
}

/// One event a member authored.
#[derive(Debug, Clone)]
pub struct ActivitySnapshot {
    /// Member pubkey in lowercase 64-hex.
    pub pubkey: String,
    /// `created_at` of that event, in Unix seconds.
    pub at: u64,
}

/// The work item an employee is on now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWork {
    /// Work item UUID.
    pub work_item_id: Uuid,
    /// Short work title.
    pub title: String,
    /// Active, or blocked when nothing is active.
    pub status: CompanyWorkStatus,
    /// Due date in UTC RFC 3339 form, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
}

/// One employee's status, as `colony team status` prints it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberStatus {
    /// Employee pubkey in lowercase 64-hex.
    pub pubkey: String,
    /// Display name from the employee's profile, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Title from the member position.
    pub title: String,
    /// Active or paused.
    pub status: MemberStatus,
    /// Why the employee is paused, when it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused_reason: Option<String>,
    /// The work item the employee is on now, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_work: Option<CurrentWork>,
    /// Newest event the employee authored, in Unix seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<u64>,
    /// Open asks raised by, or about the work of, this employee that name
    /// people to decide and are not addressed to another employee.
    pub open_asks_waiting_on_people: u32,
}

/// Builds one status per active or paused employee, sorted by name then pubkey.
pub fn assemble_team_status(
    members: &[MemberPositionHead],
    names: &HashMap<String, String>,
    work_items: &[WorkItemSnapshot],
    asks: &[AskSnapshot],
    activity: &[ActivitySnapshot],
) -> Vec<TeamMemberStatus> {
    let employees: HashSet<String> = members
        .iter()
        .filter(|member| member.kind == MemberKind::Employee)
        .map(|member| member.pubkey.to_ascii_lowercase())
        .collect();
    let mut statuses: Vec<TeamMemberStatus> = members
        .iter()
        .filter(|member| {
            member.kind == MemberKind::Employee && member.status != MemberStatus::Terminated
        })
        .map(|member| status_for(member, names, work_items, asks, activity, &employees))
        .collect();
    statuses.sort_by(|left, right| {
        left.name
            .as_deref()
            .unwrap_or_default()
            .cmp(right.name.as_deref().unwrap_or_default())
            .then_with(|| left.pubkey.cmp(&right.pubkey))
    });
    statuses
}

fn status_for(
    member: &MemberPositionHead,
    names: &HashMap<String, String>,
    work_items: &[WorkItemSnapshot],
    asks: &[AskSnapshot],
    activity: &[ActivitySnapshot],
    employees: &HashSet<String>,
) -> TeamMemberStatus {
    let pubkey = member.pubkey.to_ascii_lowercase();
    let paused = member.status == MemberStatus::Paused;
    TeamMemberStatus {
        name: names.get(&pubkey).cloned(),
        title: member.title.clone(),
        status: member.status,
        paused_reason: if paused { member.reason.clone() } else { None },
        current_work: current_work(&pubkey, work_items),
        last_activity_at: activity
            .iter()
            .filter(|event| event.pubkey.eq_ignore_ascii_case(&pubkey))
            .map(|event| event.at)
            .max(),
        open_asks_waiting_on_people: waiting_on_people(&pubkey, asks, work_items, employees),
        pubkey,
    }
}

fn is_assigned(item: &WorkItemSnapshot, pubkey: &str) -> bool {
    item.head
        .assigned_pubkeys
        .iter()
        .any(|assignee| assignee.eq_ignore_ascii_case(pubkey))
}

fn newest_with_status<'a>(
    pubkey: &str,
    work_items: &'a [WorkItemSnapshot],
    status: CompanyWorkStatus,
) -> Option<&'a WorkItemSnapshot> {
    work_items
        .iter()
        .filter(|item| item.head.status == status && is_assigned(item, pubkey))
        .max_by_key(|item| item.updated_at)
}

fn current_work(pubkey: &str, work_items: &[WorkItemSnapshot]) -> Option<CurrentWork> {
    newest_with_status(pubkey, work_items, CompanyWorkStatus::Active)
        .or_else(|| newest_with_status(pubkey, work_items, CompanyWorkStatus::Blocked))
        .map(|item| CurrentWork {
            work_item_id: item.head.work_item_id,
            title: item.head.title.clone(),
            status: item.head.status,
            due_at: item.head.due_at.clone(),
        })
}

fn waiting_on_people(
    pubkey: &str,
    asks: &[AskSnapshot],
    work_items: &[WorkItemSnapshot],
    employees: &HashSet<String>,
) -> u32 {
    let count = asks
        .iter()
        .filter(|ask| ask.head.status == AskStatus::Open && !ask.people.is_empty())
        .filter(|ask| !addressed_to_employee(ask, employees))
        .filter(|ask| {
            ask.head.asker_pubkey.eq_ignore_ascii_case(pubkey)
                || is_about_work_of(ask, pubkey, work_items)
        })
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

fn addressed_to_employee(ask: &AskSnapshot, employees: &HashSet<String>) -> bool {
    ask.head
        .ask
        .addressee_pubkey
        .as_deref()
        .is_some_and(|addressee| employees.contains(&addressee.to_ascii_lowercase()))
}

fn is_about_work_of(ask: &AskSnapshot, pubkey: &str, work_items: &[WorkItemSnapshot]) -> bool {
    let Some(subject) = ask.head.ask.subject.as_ref() else {
        return false;
    };
    if subject.kind != AskSubjectKind::WorkItem {
        return false;
    }
    let Ok(work_item_id) = Uuid::parse_str(&subject.id) else {
        return false;
    };
    work_items
        .iter()
        .any(|item| item.head.work_item_id == work_item_id && is_assigned(item, pubkey))
}
```

In `crates/buzz-core/src/lib.rs`, after the `company_spend` lines (24-25), add:

```rust
/// Read-only team status assembled from company records.
pub mod company_team_status;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-core --test company_team_status`
Expected: PASS, 5 tests.

Run: `cargo clippy -p buzz-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_team_status.rs crates/buzz-core/src/lib.rs crates/buzz-core/tests/company_team_status.rs
git commit -s -m "feat(core): assemble read-only team status from company records"
```

---

### Task 8.2: `colony team status`

**Files:**
- Modify: `crates/buzz-cli/src/lib.rs:1273-1321` (add the `Status` variant to `TeamCmd`) and `crates/buzz-cli/src/lib.rs:3531-3534` (stable subcommand names)
- Modify: `crates/buzz-cli/src/commands/team.rs:1-31` (imports, dispatch), `:156-181` (relay self lookup), and add functions and tests
- Modify: `crates/buzz-cli/src/commands/work.rs:24-28` and `:550` (let `team.rs` reuse the verified work head query)
- Test: `crates/buzz-cli/src/commands/team.rs` (tests module), `crates/buzz-cli/src/lib.rs` (`subcommand_names_are_stable`)

**Interfaces:**
- Consumes: `assemble_team_status`, `WorkItemSnapshot`, `AskSnapshot`, `ActivitySnapshot` (Task 8.1); `query_work_heads` (`crates/buzz-cli/src/commands/work.rs:550-578`); `BuzzClient::{get_public, query, query_multi, query_all_bounded}` (`crates/buzz-cli/src/client.rs:735-800`).
- Produces: `colony team status` printing a JSON array of `TeamMemberStatus` (camelCase), read only. Scout's role pack (part G) teaches this command.

- [ ] **Step 1: Write the failing tests**

In `crates/buzz-cli/src/lib.rs`, change the expected team subcommands in `subcommand_names_are_stable` (lines 3531-3534) to:

```rust
        assert_eq!(
            names(&cmd, "team"),
            vec!["get", "list", "set-manager", "set-position", "set-title", "status"]
        );
```

In `crates/buzz-cli/src/commands/team.rs`, add to the `tests` module (after the existing tests, before the closing brace):

```rust
    #[test]
    fn profile_names_keep_the_newest_display_name_per_author() {
        let author = "ab".repeat(32);
        let events = vec![
            serde_json::json!({ "pubkey": author.to_uppercase(), "created_at": 10, "content": "{\"name\":\"naledi\"}" }),
            serde_json::json!({ "pubkey": author, "created_at": 20, "content": "{\"display_name\":\"Naledi\",\"name\":\"naledi\"}" }),
            serde_json::json!({ "pubkey": "cd".repeat(32), "created_at": 5, "content": "not json" }),
        ];
        let names = profile_names(&events);
        assert_eq!(names.get(&author).map(String::as_str), Some("Naledi"));
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn ask_snapshots_keep_lowercase_people_from_p_tags() {
        let head = serde_json::json!({
            "schemaVersion": 1,
            "askId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "status": "open",
            "askerPubkey": "ab".repeat(32),
            "createdAt": "2026-10-11T08:00:00Z",
            "ask": {
                "schemaVersion": 1,
                "askId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "type": "approval",
                "category": "general",
                "title": "Approve next week's posts"
            },
            "sourceActionEventId": "c".repeat(64)
        });
        let event = serde_json::json!({
            "content": head.to_string(),
            "tags": [["d", "x"], ["h", "y"], ["p", "AB".repeat(32)], ["p", "cd".repeat(32)]]
        });
        let snapshot = parse_ask_snapshot(&event).expect("ask snapshot");
        assert_eq!(snapshot.people, vec!["ab".repeat(32), "cd".repeat(32)]);
    }

    #[test]
    fn latest_activity_skips_events_without_author_or_time() {
        let events = vec![
            serde_json::json!({ "pubkey": "AB".repeat(32), "created_at": 42 }),
            serde_json::json!({ "pubkey": "cd".repeat(32) }),
            serde_json::json!({ "created_at": 7 }),
        ];
        let activity = latest_activity(&events);
        assert_eq!(activity.len(), 1);
        assert_eq!(activity[0].pubkey, "ab".repeat(32));
        assert_eq!(activity[0].at, 42);
    }

    #[test]
    fn employee_pubkeys_skip_humans_and_terminated_employees() {
        let head = |pubkey: &str, kind: MemberKind, status: MemberStatus| MemberPositionHead {
            schema_version: 1,
            pubkey: pubkey.to_owned(),
            title: "Title".into(),
            manager_pubkey: None,
            kind,
            status,
            reason: (status != MemberStatus::Active).then(|| "Reason".to_owned()),
            source_action_event_id: "b".repeat(64),
            updated_at: "2026-10-11T08:00:00Z".into(),
        };
        let members = vec![
            head(&"AB".repeat(32), MemberKind::Employee, MemberStatus::Active),
            head(&"cd".repeat(32), MemberKind::Human, MemberStatus::Active),
            head(&"ef".repeat(32), MemberKind::Employee, MemberStatus::Terminated),
            head(&"12".repeat(32), MemberKind::Employee, MemberStatus::Paused),
        ];
        assert_eq!(employee_pubkeys(&members), vec!["ab".repeat(32), "12".repeat(32)]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-cli --lib commands::team`
Expected: FAIL to compile with `cannot find function `profile_names` in this scope` (and the same for `parse_ask_snapshot`, `latest_activity`, `employee_pubkeys`).

Run: `cargo test -p buzz-cli --lib subcommand_names_are_stable`
Expected: FAIL to compile for the same reason (the crate's tests build together).

- [ ] **Step 3: Write the implementation**

In `crates/buzz-cli/src/commands/work.rs`, make the verified work head query reusable. Replace lines 24-28:

```rust
pub(crate) struct WorkHeadEvent {
    pub(crate) event: Value,
    pub(crate) head: CompanyWorkItemHead,
    pub(crate) channel_id: Uuid,
}
```

and change line 550 from `async fn query_work_heads(client: &BuzzClient) -> Result<Vec<WorkHeadEvent>, CliError> {` to:

```rust
pub(crate) async fn query_work_heads(client: &BuzzClient) -> Result<Vec<WorkHeadEvent>, CliError> {
```

In `crates/buzz-cli/src/lib.rs`, add a variant to `TeamCmd` (after the `Get` variant, around line 1286):

```rust
    /// Show each employee's current work, last activity and open asks waiting on people
    Status,
```

In `crates/buzz-cli/src/commands/team.rs`, replace the imports (lines 3-9) with:

```rust
use std::collections::HashMap;

use buzz_core::company_members::{member_d_tag, MemberKind, MemberPositionHead, MemberStatus};
use buzz_core::company_records::AskHead;
use buzz_core::company_team_status::{
    assemble_team_status, ActivitySnapshot, AskSnapshot, WorkItemSnapshot,
};
use buzz_core::kind::{
    KIND_ASK_ACTION, KIND_ASK_HEAD, KIND_MEMBER_POSITION_HEAD, KIND_STREAM_MESSAGE,
    KIND_WORK_ITEM_ACTION,
};
use serde_json::{json, Value};

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;
```

After `const MEMBER_POSITION_QUERY_BOUND: u32 = 10_000;` add:

```rust
const ASK_QUERY_BOUND: u32 = 10_000;
const ACTIVITY_FILTERS_PER_QUERY: usize = 10;
```

In `dispatch`, add the arm after `TeamCmd::Get { member } => cmd_get(client, &member).await,`:

```rust
        TeamCmd::Status => cmd_status(client).await,
```

Replace the relay self lookup at the top of `query_member_position_events` (lines 157-167, from `let nip11_raw` to `let relay_self = normalize_member_pubkey(relay_self)?;`) with:

```rust
    let relay_self = relay_self_hex(client).await?;
```

and add these functions after `query_member_position_events`:

```rust
async fn relay_self_hex(client: &BuzzClient) -> Result<String, CliError> {
    let nip11_raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&nip11_raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    normalize_member_pubkey(relay_self)
}

async fn cmd_status(client: &BuzzClient) -> Result<(), CliError> {
    let relay_self = relay_self_hex(client).await?;
    let members = query_member_position_events(client)
        .await?
        .iter()
        .map(parse_member_position_head)
        .collect::<Result<Vec<_>, _>>()?;
    let employees = employee_pubkeys(&members);
    let work_items = crate::commands::work::query_work_heads(client)
        .await?
        .into_iter()
        .map(|head| {
            Ok(WorkItemSnapshot {
                updated_at: event_created_at(&head.event)?,
                head: head.head,
            })
        })
        .collect::<Result<Vec<_>, CliError>>()?;
    let asks = query_ask_snapshots(client, &relay_self).await?;
    let names = query_profile_names(client, &employees).await?;
    let activity = query_latest_activity(client, &employees).await?;
    let statuses = assemble_team_status(&members, &names, &work_items, &asks, &activity);
    let output = serde_json::to_string(&statuses)
        .map_err(|error| CliError::Other(format!("team status could not be encoded: {error}")))?;
    println!("{output}");
    Ok(())
}

fn employee_pubkeys(members: &[MemberPositionHead]) -> Vec<String> {
    members
        .iter()
        .filter(|member| {
            member.kind == MemberKind::Employee && member.status != MemberStatus::Terminated
        })
        .map(|member| member.pubkey.to_ascii_lowercase())
        .collect()
}

fn event_created_at(event: &Value) -> Result<u64, CliError> {
    event
        .get("created_at")
        .and_then(Value::as_u64)
        .ok_or_else(|| CliError::Other("record event has no created_at".into()))
}

async fn query_ask_snapshots(
    client: &BuzzClient,
    relay_self: &str,
) -> Result<Vec<AskSnapshot>, CliError> {
    let events = client
        .query_all_bounded(
            json!({ "kinds": [KIND_ASK_HEAD], "authors": [relay_self] }),
            ASK_QUERY_BOUND,
        )
        .await?;
    events.iter().map(parse_ask_snapshot).collect()
}

fn parse_ask_snapshot(event: &Value) -> Result<AskSnapshot, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("ask head has no string content".into()))?;
    let head: AskHead = serde_json::from_str(content)
        .map_err(|error| CliError::Other(format!("ask head content is invalid: {error}")))?;
    let people = tag_values(event, "p")
        .into_iter()
        .map(str::to_ascii_lowercase)
        .collect();
    Ok(AskSnapshot { head, people })
}

async fn query_profile_names(
    client: &BuzzClient,
    pubkeys: &[String],
) -> Result<HashMap<String, String>, CliError> {
    if pubkeys.is_empty() {
        return Ok(HashMap::new());
    }
    let raw = client
        .query(&json!({ "kinds": [0], "authors": pubkeys }))
        .await?;
    let events: Vec<Value> = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("invalid profile query response: {error}")))?;
    Ok(profile_names(&events))
}

fn profile_names(events: &[Value]) -> HashMap<String, String> {
    let mut newest: HashMap<String, (u64, String)> = HashMap::new();
    for event in events {
        let (Some(pubkey), Some(created_at), Some(name)) = (
            event.get("pubkey").and_then(Value::as_str),
            event.get("created_at").and_then(Value::as_u64),
            profile_display_name(event),
        ) else {
            continue;
        };
        let pubkey = pubkey.to_ascii_lowercase();
        if newest
            .get(&pubkey)
            .is_none_or(|(seen, _)| created_at > *seen)
        {
            newest.insert(pubkey, (created_at, name));
        }
    }
    newest
        .into_iter()
        .map(|(pubkey, (_, name))| (pubkey, name))
        .collect()
}

fn profile_display_name(event: &Value) -> Option<String> {
    let content: Value = serde_json::from_str(event.get("content")?.as_str()?).ok()?;
    ["display_name", "name"]
        .iter()
        .filter_map(|key| content.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_owned)
}

async fn query_latest_activity(
    client: &BuzzClient,
    pubkeys: &[String],
) -> Result<Vec<ActivitySnapshot>, CliError> {
    let filters: Vec<Value> = pubkeys
        .iter()
        .map(|pubkey| {
            json!({
                "kinds": [KIND_STREAM_MESSAGE, KIND_WORK_ITEM_ACTION, KIND_ASK_ACTION],
                "authors": [pubkey],
                "limit": 1
            })
        })
        .collect();
    let mut events = Vec::new();
    for batch in filters.chunks(ACTIVITY_FILTERS_PER_QUERY) {
        let raw = client.query_multi(batch).await?;
        let mut page: Vec<Value> = serde_json::from_str(&raw).map_err(|error| {
            CliError::Other(format!("invalid activity query response: {error}"))
        })?;
        events.append(&mut page);
    }
    Ok(latest_activity(&events))
}

fn latest_activity(events: &[Value]) -> Vec<ActivitySnapshot> {
    events
        .iter()
        .filter_map(|event| {
            Some(ActivitySnapshot {
                pubkey: event.get("pubkey")?.as_str()?.to_ascii_lowercase(),
                at: event.get("created_at")?.as_u64()?,
            })
        })
        .collect()
}

fn tag_values<'a>(event: &'a Value, name: &str) -> Vec<&'a str> {
    event
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .filter(|tag| tag.first().and_then(Value::as_str) == Some(name))
        .filter_map(|tag| tag.get(1).and_then(Value::as_str))
        .collect()
}
```

The work head query already runs without an `h` filter and returns what this key may read (`crates/buzz-cli/src/commands/work.rs:563-568`); the ask and activity queries follow the same pattern, so Scout sees the asks and events of the conversations it belongs to.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-cli --lib commands::team`
Expected: PASS (the 2 existing tests and the 4 new ones).

Run: `cargo test -p buzz-cli --lib subcommand_names_are_stable`
Expected: PASS.

Run: `cargo clippy -p buzz-cli --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Try it against a dev relay**

With a dev relay running (`just relay`) and an employee key in the environment, run: `colony team status`
Expected: a JSON array such as `[{"pubkey":"...","name":"Naledi","title":"Social Media Manager","status":"active","currentWork":{"workItemId":"...","title":"Draft next week's posts","status":"active"},"lastActivityAt":1760183600,"openAsksWaitingOnPeople":1}]`.

- [ ] **Step 6: Commit**

```bash
git add crates/buzz-cli/src/lib.rs crates/buzz-cli/src/commands/team.rs crates/buzz-cli/src/commands/work.rs
git commit -s -m "feat(cli): add colony team status for Scout"
```

---

### Task 8.3: Record parsers for the new app

**Files:**
- Create: `app/src/shared/team/kinds.ts`, `app/src/shared/team/nostr.ts`, `app/src/shared/team/records.ts`, `app/src/shared/team/testEvents.ts`
- Test: `app/src/shared/team/records.test.ts`

**Interfaces:**
- Consumes: record shapes from buzz-core: member position heads (`crates/buzz-core/src/company_members.rs:82-103`), company work item heads (`crates/buzz-core/src/business_records.rs:585-630`, d-tag `company:work:<uuid>` at `:1181`), ask heads (`crates/buzz-core/src/company_records.rs:594-649, 1207-1228`, subject kinds in camelCase at `:564-579`), duty heads (`crates/buzz-core/src/company_duties.rs:18-37, 76-115`); the team computer and brief heads from the overview contract (kinds 30658 and 30659).
- Produces:
  - `kinds.ts`: `KIND_PROFILE = 0`, `KIND_MESSAGE = 9`, `KIND_CHANNEL_MEMBERS = 39002`, `KIND_WORK_ITEM_HEAD = 30634`, `KIND_ASK_HEAD = 30643`, `KIND_MEMBER_POSITION_HEAD = 30648`, `KIND_DUTY_HEAD = 30655`, `KIND_TEAM_COMPUTER_HEAD = 30658`, `KIND_BRIEF_HEAD = 30659`
  - `nostr.ts`: `type NostrEvent`, `type NostrFilter`, `tagValues(event, name): string[]`, `singleTag(event, name): string | null`, `normalizePubkey(value: unknown): string | null`
  - `records.ts`: `OWNER_ONLY_TAG`, types `MemberRecord`, `WorkItemRecord`, `AskRecordView`, `RoutineRecord`, `TeamComputerRecord`, `BriefRecord`, and `parseMemberPositionHead`, `parseWorkItemHead`, `parseAskHead`, `parseDutyHead`, `parseTeamComputerHead`, `parseBriefHead`, `parseProfileName`, `parseMemberChannelId` (each `(event: NostrEvent) => T | null`)
  - `testEvents.ts` (tests only): fixed pubkeys `NALEDI`, `SIPHO`, `SCOUT`, `MAYA`, `LERATO`, `KAGISO`, `RELAY`; `makeEvent(kind, content, tags?, createdAt?, pubkey?)`; `manualTimers()` returning `{ setTimer, fire(ms), count() }`

- [ ] **Step 1: Write the failing test**

Create `app/src/shared/team/testEvents.ts` (test fixtures only; no production code imports it):

```ts
import type { NostrEvent } from "./nostr";

export const NALEDI = "ab".repeat(32);
export const SIPHO = "cd".repeat(32);
export const SCOUT = "ef".repeat(32);
export const MAYA = "12".repeat(32);
export const LERATO = "34".repeat(32);
export const KAGISO = "56".repeat(32);
export const RELAY = "78".repeat(32);

let sequence = 0;

/** An event shaped like a relay event; parsers do not check signatures. */
export function makeEvent(
  kind: number,
  content: unknown,
  tags: string[][] = [],
  createdAt = 1_760_180_000,
  pubkey = RELAY,
): NostrEvent {
  sequence += 1;
  return {
    id: sequence.toString(16).padStart(64, "0"),
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content: typeof content === "string" ? content : JSON.stringify(content),
    sig: "0".repeat(128),
  };
}

/** Timers that only fire when a test says so, for injected `setTimer` dependencies. */
export function manualTimers() {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  return {
    setTimer(callback: () => void, ms: number): () => void {
      next += 1;
      const id = next;
      pending.set(id, { callback, ms });
      return () => {
        pending.delete(id);
      };
    },
    fire(ms: number): void {
      for (const [id, timer] of [...pending]) {
        if (timer.ms === ms) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
    count: (): number => pending.size,
  };
}
```

Create `app/src/shared/team/records.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  KIND_ASK_HEAD,
  KIND_BRIEF_HEAD,
  KIND_CHANNEL_MEMBERS,
  KIND_DUTY_HEAD,
  KIND_MEMBER_POSITION_HEAD,
  KIND_PROFILE,
  KIND_TEAM_COMPUTER_HEAD,
  KIND_WORK_ITEM_HEAD,
} from "./kinds";
import {
  parseAskHead,
  parseBriefHead,
  parseDutyHead,
  parseMemberChannelId,
  parseMemberPositionHead,
  parseProfileName,
  parseTeamComputerHead,
  parseWorkItemHead,
} from "./records";
import { KAGISO, LERATO, MAYA, NALEDI, SCOUT, SIPHO, makeEvent } from "./testEvents";

const WORK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("parseMemberPositionHead", () => {
  it("reads an employee position and lowercases keys", () => {
    const record = parseMemberPositionHead(
      makeEvent(KIND_MEMBER_POSITION_HEAD, {
        schemaVersion: 1,
        pubkey: NALEDI.toUpperCase(),
        title: "Social Media Manager",
        kind: "employee",
        status: "paused",
        reason: "Paused by Kagiso",
        managerPubkey: MAYA.toUpperCase(),
        sourceActionEventId: "a".repeat(64),
        updatedAt: "2026-10-11T08:00:00Z",
      }),
    );
    expect(record).toEqual({
      pubkey: NALEDI,
      title: "Social Media Manager",
      kind: "employee",
      status: "paused",
      reason: "Paused by Kagiso",
      managerPubkey: MAYA,
    });
  });

  it("rejects unknown statuses, bad keys, other kinds and bad JSON", () => {
    const head = { pubkey: NALEDI, title: "Social Media Manager", kind: "employee", status: "active" };
    expect(parseMemberPositionHead(makeEvent(KIND_MEMBER_POSITION_HEAD, { ...head, status: "sleeping" }))).toBeNull();
    expect(parseMemberPositionHead(makeEvent(KIND_MEMBER_POSITION_HEAD, { ...head, pubkey: "not-a-key" }))).toBeNull();
    expect(parseMemberPositionHead(makeEvent(KIND_ASK_HEAD, head))).toBeNull();
    expect(parseMemberPositionHead(makeEvent(KIND_MEMBER_POSITION_HEAD, "not json"))).toBeNull();
  });
});

describe("parseWorkItemHead", () => {
  const head = {
    schemaVersion: 1,
    workItemId: WORK_ID,
    title: "Draft next week's posts",
    status: "active",
    assignedPubkeys: [NALEDI],
    approverPubkeys: [],
    deliverables: [],
    requesterPubkey: LERATO,
    doneCondition: "Lerato approves",
    dueAt: "2026-10-14T16:00:00Z",
    sourceActionEventId: "b".repeat(64),
  };

  it("reads a company work item with its conversation and update time", () => {
    const record = parseWorkItemHead(
      makeEvent(KIND_WORK_ITEM_HEAD, head, [["d", `company:work:${WORK_ID}`], ["h", "conv-1"]], 1_760_190_000),
    );
    expect(record).toEqual({
      workItemId: WORK_ID,
      title: "Draft next week's posts",
      status: "active",
      assignee: NALEDI,
      channelId: "conv-1",
      updatedAt: 1_760_190_000,
      dueAt: "2026-10-14T16:00:00Z",
    });
  });

  it("ignores client work items and items without exactly one assignee", () => {
    expect(parseWorkItemHead(makeEvent(KIND_WORK_ITEM_HEAD, head, [["d", "client:x:work:y"]]))).toBeNull();
    expect(
      parseWorkItemHead(
        makeEvent(KIND_WORK_ITEM_HEAD, { ...head, assignedPubkeys: [NALEDI, SIPHO] }, [["d", `company:work:${WORK_ID}`]]),
      ),
    ).toBeNull();
  });
});

describe("parseAskHead", () => {
  const head = {
    schemaVersion: 1,
    askId: ASK_ID,
    status: "open",
    askerPubkey: NALEDI,
    createdAt: "2026-10-11T08:00:00Z",
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "money",
      title: "Naledi's posts for next week are ready for your OK.",
      subject: { kind: "workItem", id: WORK_ID },
    },
    sourceActionEventId: "c".repeat(64),
  };

  it("reads people, subject, the owner-only flag and both times", () => {
    const record = parseAskHead(
      makeEvent(
        KIND_ASK_HEAD,
        head,
        [["d", `channel:conv-1:ask:${ASK_ID}`], ["h", "conv-1"], ["p", LERATO.toUpperCase()], ["p", KAGISO], ["colony:owner-only", "1"]],
        1_760_181_000,
      ),
    );
    expect(record).toEqual({
      askId: ASK_ID,
      status: "open",
      askerPubkey: NALEDI,
      title: "Naledi's posts for next week are ready for your OK.",
      category: "money",
      channelId: "conv-1",
      createdAt: Date.parse("2026-10-11T08:00:00Z") / 1000,
      updatedAt: 1_760_181_000,
      people: [LERATO, KAGISO],
      addresseePubkey: null,
      subjectWorkItemId: WORK_ID,
      ownerOnly: true,
    });
  });

  it("reads the addressee and treats a missing owner-only tag as false", () => {
    const record = parseAskHead(
      makeEvent(KIND_ASK_HEAD, { ...head, ask: { ...head.ask, addresseePubkey: SCOUT, subject: undefined } }, [["h", "conv-1"]]),
    );
    expect(record?.addresseePubkey).toBe(SCOUT);
    expect(record?.ownerOnly).toBe(false);
    expect(record?.subjectWorkItemId).toBeNull();
  });

  it("rejects heads without a valid status or creation time", () => {
    expect(parseAskHead(makeEvent(KIND_ASK_HEAD, { ...head, status: "maybe" }))).toBeNull();
    expect(parseAskHead(makeEvent(KIND_ASK_HEAD, { ...head, createdAt: "yesterday" }))).toBeNull();
  });
});

describe("parseDutyHead", () => {
  it("reads the employee, schedule and whether it is active", () => {
    const record = parseDutyHead(
      makeEvent(KIND_DUTY_HEAD, {
        schemaVersion: 1,
        dutyId: "duty-1",
        proposal: {
          schemaVersion: 1,
          dutyId: "duty-1",
          employeePubkey: SIPHO.toUpperCase(),
          title: "Lead hunt",
          scheduleText: "Every Tuesday at 09:00",
          scheduleCron: "0 9 * * 2",
          timeZone: "Africa/Johannesburg",
          channelId: "conv-1",
          instructions: "Find 10 new leads.",
        },
        status: "paused",
      }),
    );
    expect(record).toEqual({
      dutyId: "duty-1",
      employeePubkey: SIPHO,
      title: "Lead hunt",
      scheduleCron: "0 9 * * 2",
      timeZone: "Africa/Johannesburg",
      active: false,
    });
  });
});

describe("parseTeamComputerHead", () => {
  it("reads the team computer record and requires its d tag", () => {
    const content = { computerId: "c-1", computerName: "Lerato's MacBook Air", claimedBy: LERATO, claimedAt: 100, lastSeenAt: 200 };
    expect(parseTeamComputerHead(makeEvent(KIND_TEAM_COMPUTER_HEAD, content, [["d", "team-computer"]]))).toEqual({
      ...content,
    });
    expect(parseTeamComputerHead(makeEvent(KIND_TEAM_COMPUTER_HEAD, content, [["d", "other"]]))).toBeNull();
  });
});

describe("parseBriefHead", () => {
  it("reads a morning brief and an optional done count on a Friday wrap", () => {
    const morning = parseBriefHead(
      makeEvent(KIND_BRIEF_HEAD, { type: "morning", text: "Morning.", links: [], writtenAt: 1_760_336_000 }, [["d", "brief:2026-10-13:morning"]], 1_760_336_005, SCOUT),
    );
    expect(morning).toEqual({ dTag: "brief:2026-10-13:morning", type: "morning", text: "Morning.", doneCount: null, writtenAt: 1_760_336_000, authorPubkey: SCOUT });
    const friday = parseBriefHead(
      makeEvent(KIND_BRIEF_HEAD, { type: "friday", text: "Good week.", links: [], writtenAt: "2026-10-16T14:00:00Z", doneCount: 14 }, [["d", "brief:2026-10-16:friday"]]),
    );
    expect(friday?.doneCount).toBe(14);
    expect(friday?.writtenAt).toBe(Date.parse("2026-10-16T14:00:00Z") / 1000);
  });

  it("rejects a d tag that does not match the type", () => {
    expect(
      parseBriefHead(makeEvent(KIND_BRIEF_HEAD, { type: "friday", text: "x", links: [] }, [["d", "brief:2026-10-13:morning"]])),
    ).toBeNull();
  });
});

describe("parseProfileName", () => {
  it("prefers the display name and ignores blank names", () => {
    expect(parseProfileName(makeEvent(KIND_PROFILE, { display_name: " Naledi ", name: "naledi" }))).toBe("Naledi");
    expect(parseProfileName(makeEvent(KIND_PROFILE, { display_name: "  ", name: "naledi" }))).toBe("naledi");
    expect(parseProfileName(makeEvent(KIND_PROFILE, {}))).toBeNull();
  });
});

describe("parseMemberChannelId", () => {
  it("reads the conversation id of a membership list and ignores other kinds", () => {
    expect(parseMemberChannelId(makeEvent(KIND_CHANNEL_MEMBERS, "", [["d", "conv-1"], ["p", LERATO]]))).toBe("conv-1");
    expect(parseMemberChannelId(makeEvent(KIND_ASK_HEAD, "", [["d", "conv-1"]]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/shared/team/records.test.ts`
Expected: FAIL with `Failed to resolve import "./kinds"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/shared/team/kinds.ts`:

```ts
/** Record kinds used by team status and notifications (crates/buzz-core/src/kind.rs). */
export const KIND_PROFILE = 0;
export const KIND_MESSAGE = 9;
export const KIND_CHANNEL_MEMBERS = 39002;
export const KIND_WORK_ITEM_HEAD = 30634;
export const KIND_ASK_HEAD = 30643;
export const KIND_MEMBER_POSITION_HEAD = 30648;
export const KIND_DUTY_HEAD = 30655;
export const KIND_TEAM_COMPUTER_HEAD = 30658;
export const KIND_BRIEF_HEAD = 30659;
```

Create `app/src/shared/team/nostr.ts`:

```ts
/** A signed event as the relay returns it. */
export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

/** A relay filter. Every filter names its kinds (relay rule). */
export type NostrFilter = {
  kinds: number[];
  authors?: string[];
  since?: number;
  limit?: number;
  "#p"?: string[];
  "#h"?: string[];
  "#d"?: string[];
};

/** Every value of one tag name, in order. */
export function tagValues(event: NostrEvent, name: string): string[] {
  const values: string[] = [];
  for (const tag of event.tags) {
    const value = tag[1];
    if (tag[0] === name && typeof value === "string") values.push(value);
  }
  return values;
}

/** The value of a tag that appears exactly once, otherwise null. */
export function singleTag(event: NostrEvent, name: string): string | null {
  const values = tagValues(event, name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A lowercase 64-hex pubkey, or null. */
export function normalizePubkey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return HEX64.test(lower) ? lower : null;
}
```

Create `app/src/shared/team/records.ts`:

```ts
import {
  KIND_ASK_HEAD,
  KIND_BRIEF_HEAD,
  KIND_CHANNEL_MEMBERS,
  KIND_DUTY_HEAD,
  KIND_MEMBER_POSITION_HEAD,
  KIND_PROFILE,
  KIND_TEAM_COMPUTER_HEAD,
  KIND_WORK_ITEM_HEAD,
} from "./kinds";
import { type NostrEvent, normalizePubkey, singleTag, tagValues } from "./nostr";

/** Tag on an ask head that marks a billing decision only the owner may make. */
export const OWNER_ONLY_TAG = "colony:owner-only";

export type MemberKind = "human" | "employee";
export type MemberStatus = "active" | "paused" | "terminated";
export type MemberRecord = {
  pubkey: string;
  title: string;
  kind: MemberKind;
  status: MemberStatus;
  reason: string | null;
  managerPubkey: string | null;
};

export type WorkStatus = "active" | "paused" | "blocked" | "done_unverified" | "done_verified" | "archived";
export type WorkItemRecord = {
  workItemId: string;
  title: string;
  status: WorkStatus;
  assignee: string;
  channelId: string | null;
  updatedAt: number;
  dueAt: string | null;
};

export type AskStatus = "open" | "resolved" | "cancelled";
export type AskCategory = "general" | "money" | "hire" | "tool" | "secret" | "duty";
export type AskRecordView = {
  askId: string;
  status: AskStatus;
  askerPubkey: string;
  title: string;
  category: AskCategory;
  channelId: string | null;
  /** When the ask was created, in Unix seconds. */
  createdAt: number;
  /** When the relay last wrote the head, in Unix seconds. */
  updatedAt: number;
  /** People the relay named as deciders (part F). */
  people: string[];
  addresseePubkey: string | null;
  subjectWorkItemId: string | null;
  ownerOnly: boolean;
};

export type RoutineRecord = {
  dutyId: string;
  employeePubkey: string;
  title: string;
  scheduleCron: string;
  timeZone: string;
  active: boolean;
};

export type TeamComputerRecord = {
  computerId: string;
  computerName: string;
  claimedBy: string;
  claimedAt: number;
  lastSeenAt: number;
};

export type BriefRecord = {
  dTag: string;
  type: "morning" | "friday";
  text: string;
  doneCount: number | null;
  writtenAt: number;
  authorPubkey: string;
};

type Json = Record<string, unknown>;

const MEMBER_KINDS: readonly MemberKind[] = ["human", "employee"];
const MEMBER_STATUSES: readonly MemberStatus[] = ["active", "paused", "terminated"];
const WORK_STATUSES: readonly WorkStatus[] = [
  "active",
  "paused",
  "blocked",
  "done_unverified",
  "done_verified",
  "archived",
];
const ASK_STATUSES: readonly AskStatus[] = ["open", "resolved", "cancelled"];
const ASK_CATEGORIES: readonly AskCategory[] = ["general", "money", "hire", "tool", "secret", "duty"];
const BRIEF_D_TAG = /^brief:\d{4}-\d{2}-\d{2}:(morning|friday)$/;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(content: string): Json | null {
  try {
    const value: unknown = JSON.parse(content);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function rfc3339Seconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Reads a relay-signed member position head (kind 30648). */
export function parseMemberPositionHead(event: NostrEvent): MemberRecord | null {
  if (event.kind !== KIND_MEMBER_POSITION_HEAD) return null;
  const head = parseObject(event.content);
  if (!head) return null;
  const pubkey = normalizePubkey(head.pubkey);
  const title = text(head.title);
  const kind = oneOf(MEMBER_KINDS, head.kind);
  const status = oneOf(MEMBER_STATUSES, head.status);
  if (!pubkey || !title || !kind || !status) return null;
  return { pubkey, title, kind, status, reason: text(head.reason), managerPubkey: normalizePubkey(head.managerPubkey) };
}

/** Reads a relay-signed company work item head (kind 30634, d tag `company:work:<uuid>`). */
export function parseWorkItemHead(event: NostrEvent): WorkItemRecord | null {
  if (event.kind !== KIND_WORK_ITEM_HEAD) return null;
  if (!singleTag(event, "d")?.startsWith("company:work:")) return null;
  const head = parseObject(event.content);
  if (!head) return null;
  const workItemId = text(head.workItemId);
  const title = text(head.title);
  const status = oneOf(WORK_STATUSES, head.status);
  const assigned = Array.isArray(head.assignedPubkeys) ? head.assignedPubkeys : [];
  const assignee = assigned.length === 1 ? normalizePubkey(assigned[0]) : null;
  if (!workItemId || !title || !status || !assignee) return null;
  return {
    workItemId,
    title,
    status,
    assignee,
    channelId: singleTag(event, "h"),
    updatedAt: event.created_at,
    dueAt: text(head.dueAt),
  };
}

/** Reads a relay-signed ask head (kind 30643) with the people named in its `p` tags. */
export function parseAskHead(event: NostrEvent): AskRecordView | null {
  if (event.kind !== KIND_ASK_HEAD) return null;
  const head = parseObject(event.content);
  if (!head || !isObject(head.ask)) return null;
  const ask = head.ask;
  const askId = text(head.askId);
  const status = oneOf(ASK_STATUSES, head.status);
  const askerPubkey = normalizePubkey(head.askerPubkey);
  const title = text(ask.title);
  const category = oneOf(ASK_CATEGORIES, ask.category);
  const createdAt = rfc3339Seconds(head.createdAt);
  if (!askId || !status || !askerPubkey || !title || !category || createdAt === null) return null;
  const subject = isObject(ask.subject) ? ask.subject : null;
  const people = tagValues(event, "p")
    .map((value) => normalizePubkey(value))
    .filter((value): value is string => value !== null);
  return {
    askId,
    status,
    askerPubkey,
    title,
    category,
    channelId: singleTag(event, "h"),
    createdAt,
    updatedAt: event.created_at,
    people,
    addresseePubkey: normalizePubkey(ask.addresseePubkey),
    subjectWorkItemId: subject !== null && subject.kind === "workItem" ? text(subject.id) : null,
    ownerOnly: tagValues(event, OWNER_ONLY_TAG).includes("1"),
  };
}

/** Reads a relay-signed duty head (kind 30655); duties are the employee routines. */
export function parseDutyHead(event: NostrEvent): RoutineRecord | null {
  if (event.kind !== KIND_DUTY_HEAD) return null;
  const head = parseObject(event.content);
  if (!head || !isObject(head.proposal)) return null;
  const proposal = head.proposal;
  const dutyId = text(head.dutyId);
  const employeePubkey = normalizePubkey(proposal.employeePubkey);
  const title = text(proposal.title);
  const scheduleCron = text(proposal.scheduleCron);
  const timeZone = text(proposal.timeZone);
  const status = text(head.status);
  if (!dutyId || !employeePubkey || !title || !scheduleCron || !timeZone || !status) return null;
  return { dutyId, employeePubkey, title, scheduleCron, timeZone, active: status === "active" };
}

/** Reads the team computer head (kind 30658, d tag `team-computer`). */
export function parseTeamComputerHead(event: NostrEvent): TeamComputerRecord | null {
  if (event.kind !== KIND_TEAM_COMPUTER_HEAD || singleTag(event, "d") !== "team-computer") return null;
  const head = parseObject(event.content);
  if (!head) return null;
  const computerId = text(head.computerId);
  const computerName = text(head.computerName);
  const claimedBy = normalizePubkey(head.claimedBy);
  const claimedAt = wholeNumber(head.claimedAt);
  const lastSeenAt = wholeNumber(head.lastSeenAt);
  if (!computerId || !computerName || !claimedBy || claimedAt === null || lastSeenAt === null) return null;
  return { computerId, computerName, claimedBy, claimedAt, lastSeenAt };
}

/** Reads a brief or Friday wrap head (kind 30659, d tag `brief:<date>:<type>`). */
export function parseBriefHead(event: NostrEvent): BriefRecord | null {
  if (event.kind !== KIND_BRIEF_HEAD) return null;
  const dTag = singleTag(event, "d");
  const match = dTag === null ? null : BRIEF_D_TAG.exec(dTag);
  const head = parseObject(event.content);
  const type = match?.[1] === "morning" || match?.[1] === "friday" ? match[1] : null;
  if (dTag === null || type === null || !head || head.type !== type) return null;
  const briefText = text(head.text);
  if (!briefText) return null;
  const writtenAt = wholeNumber(head.writtenAt) ?? rfc3339Seconds(head.writtenAt) ?? event.created_at;
  return {
    dTag,
    type,
    text: briefText,
    doneCount: wholeNumber(head.doneCount),
    writtenAt,
    authorPubkey: event.pubkey.toLowerCase(),
  };
}

/** The display name from a profile event (kind 0), preferring `display_name`. */
export function parseProfileName(event: NostrEvent): string | null {
  if (event.kind !== KIND_PROFILE) return null;
  const content = parseObject(event.content);
  if (!content) return null;
  for (const key of ["display_name", "name"]) {
    const value = text(content[key]);
    if (value) return value.trim();
  }
  return null;
}

/** The conversation id of a membership list (kind 39002, read with `#p` = this person). */
export function parseMemberChannelId(event: NostrEvent): string | null {
  return event.kind === KIND_CHANNEL_MEMBERS ? singleTag(event, "d") : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/shared/team/records.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/shared/team/kinds.ts app/src/shared/team/nostr.ts app/src/shared/team/records.ts app/src/shared/team/testEvents.ts app/src/shared/team/records.test.ts
git commit -s -m "feat(app): parse team records for status and notifications"
```

---

### Task 8.4: When a routine runs next

**Files:**
- Create: `app/src/shared/team/schedule.ts`
- Test: `app/src/shared/team/schedule.test.ts`

**Interfaces:**
- Consumes: the cron forms that `parse_readable_schedule` writes (`crates/buzz-core/src/company_duties.rs:242-281`): `M H * * *`, `M H * * 1-5`, `M H * * D` and `M H DOM * *`.
- Produces:
  - `WEEKDAY_NAMES` (Sunday first)
  - `type RoutineCron = { minute: number; hour: number; dayOfMonth: number | null; daysOfWeek: number[] | null }`
  - `type RoutineOccurrence = { daysAhead: number; weekday: number; hour: number; minute: number }`
  - `parseRoutineCron(cron: string): RoutineCron | null`
  - `nextRoutineOccurrence(cron: string, timeZone: string, nowMs: number): RoutineOccurrence | null`
  - `describeOccurrence(occurrence: RoutineOccurrence): string` ("today 09:00", "tomorrow 07:00", "Monday 10:00")
  - `clockAt(unixSeconds: number, timeZone: string): string` ("14:00"; falls back to this computer's zone for a bad zone)

- [ ] **Step 1: Write the failing test**

Create `app/src/shared/team/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clockAt, describeOccurrence, nextRoutineOccurrence, parseRoutineCron } from "./schedule";

// 2026-10-13 is a Tuesday; 06:00 UTC is 08:00 in Johannesburg.
const TUESDAY_0800_JOBURG = Date.UTC(2026, 9, 13, 6, 0);
const ZONE = "Africa/Johannesburg";

describe("parseRoutineCron", () => {
  it("accepts the four readable schedule forms", () => {
    expect(parseRoutineCron("0 9 * * *")).toEqual({ minute: 0, hour: 9, dayOfMonth: null, daysOfWeek: null });
    expect(parseRoutineCron("30 8 * * 1-5")).toEqual({ minute: 30, hour: 8, dayOfMonth: null, daysOfWeek: [1, 2, 3, 4, 5] });
    expect(parseRoutineCron("0 10 * * 1")).toEqual({ minute: 0, hour: 10, dayOfMonth: null, daysOfWeek: [1] });
    expect(parseRoutineCron("0 9 1 * *")).toEqual({ minute: 0, hour: 9, dayOfMonth: 1, daysOfWeek: null });
  });

  it("rejects every other form", () => {
    for (const cron of ["", "0 24 * * *", "60 9 * * *", "0 9 * 1 *", "0 9 32 * *", "*/5 * * * *", "0 9 * * 7", "0 9 1 * 1"]) {
      expect(parseRoutineCron(cron)).toBeNull();
    }
  });
});

describe("nextRoutineOccurrence", () => {
  it.each([
    ["later today", "0 9 * * 2", { daysAhead: 0, weekday: 2, hour: 9, minute: 0 }, "today 09:00"],
    ["not the current minute", "0 8 * * 2", { daysAhead: 7, weekday: 2, hour: 8, minute: 0 }, "Tuesday 08:00"],
    ["weekdays", "30 8 * * 1-5", { daysAhead: 0, weekday: 2, hour: 8, minute: 30 }, "today 08:30"],
    ["tomorrow", "0 7 * * *", { daysAhead: 1, weekday: 3, hour: 7, minute: 0 }, "tomorrow 07:00"],
    ["the Friday wrap", "0 16 * * 5", { daysAhead: 3, weekday: 5, hour: 16, minute: 0 }, "Friday 16:00"],
    ["next Monday", "0 10 * * 1", { daysAhead: 6, weekday: 1, hour: 10, minute: 0 }, "Monday 10:00"],
    ["a day of the month", "0 9 31 * *", { daysAhead: 18, weekday: 6, hour: 9, minute: 0 }, "Saturday 09:00"],
  ])("finds %s", (_name, cron, expected, words) => {
    const occurrence = nextRoutineOccurrence(cron, ZONE, TUESDAY_0800_JOBURG);
    expect(occurrence).toEqual(expected);
    expect(occurrence === null ? null : describeOccurrence(occurrence)).toBe(words);
  });

  it("uses the routine's own time zone", () => {
    // 06:00 UTC is 07:00 in London on 13 October 2026 (summer time ends on 25 October).
    expect(nextRoutineOccurrence("30 7 * * *", "Europe/London", TUESDAY_0800_JOBURG)).toEqual({
      daysAhead: 0,
      weekday: 2,
      hour: 7,
      minute: 30,
    });
  });

  it("returns null for a bad time zone or cron", () => {
    expect(nextRoutineOccurrence("0 9 * * *", "Not/AZone", TUESDAY_0800_JOBURG)).toBeNull();
    expect(nextRoutineOccurrence("every day", ZONE, TUESDAY_0800_JOBURG)).toBeNull();
  });
});

describe("clockAt", () => {
  it("formats a time in a zone and falls back to this computer's zone for a bad one", () => {
    expect(clockAt(Date.UTC(2026, 9, 13, 12, 0) / 1000, ZONE)).toBe("14:00");
    expect(clockAt(0, "Not/AZone")).toMatch(/^\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/shared/team/schedule.test.ts`
Expected: FAIL with `Failed to resolve import "./schedule"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/shared/team/schedule.ts`:

```ts
/** Weekday names, Sunday first, matching cron day numbers. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A routine schedule in the cron forms `parse_readable_schedule` writes. */
export type RoutineCron = {
  minute: number;
  hour: number;
  dayOfMonth: number | null;
  daysOfWeek: number[] | null;
};

/** When a routine runs next, counted in the routine's own time zone. */
export type RoutineOccurrence = { daysAhead: number; weekday: number; hour: number; minute: number };

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const CRON = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|[0-6]|1-5)$/;
const SEARCH_DAYS = 62;

/** Parses the four readable-schedule cron forms; anything else is null. */
export function parseRoutineCron(cron: string): RoutineCron | null {
  const match = CRON.exec(cron.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute > 59 || hour > 23) return null;
  const dayOfMonth = match[3] === "*" ? null : Number(match[3]);
  if (dayOfMonth !== null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) return null;
  const weekdays = match[4];
  const daysOfWeek = weekdays === "*" ? null : weekdays === "1-5" ? [1, 2, 3, 4, 5] : [Number(weekdays)];
  if (dayOfMonth !== null && daysOfWeek !== null) return null;
  return { minute, hour, dayOfMonth, daysOfWeek };
}

function wallClock(nowMs: number, timeZone: string): WallClock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    const clock = { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
    return Object.values(clock).every((value) => Number.isFinite(value)) ? clock : null;
  } catch {
    return null;
  }
}

/** The next run strictly after now, or null for a bad cron or time zone. */
export function nextRoutineOccurrence(cron: string, timeZone: string, nowMs: number): RoutineOccurrence | null {
  const rule = parseRoutineCron(cron);
  const now = wallClock(nowMs, timeZone);
  if (!rule || !now) return null;
  for (let daysAhead = 0; daysAhead <= SEARCH_DAYS; daysAhead += 1) {
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + daysAhead));
    const weekday = date.getUTCDay();
    const dayMatches =
      rule.dayOfMonth !== null
        ? date.getUTCDate() === rule.dayOfMonth
        : rule.daysOfWeek === null || rule.daysOfWeek.includes(weekday);
    if (!dayMatches) continue;
    if (daysAhead === 0 && rule.hour * 60 + rule.minute <= now.hour * 60 + now.minute) continue;
    return { daysAhead, weekday, hour: rule.hour, minute: rule.minute };
  }
  return null;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** "today 09:00", "tomorrow 07:00" or "Monday 10:00". */
export function describeOccurrence(occurrence: RoutineOccurrence): string {
  const day =
    occurrence.daysAhead === 0
      ? "today"
      : occurrence.daysAhead === 1
        ? "tomorrow"
        : (WEEKDAY_NAMES[occurrence.weekday] ?? "");
  return `${day} ${pad(occurrence.hour)}:${pad(occurrence.minute)}`;
}

/** A 24-hour clock time ("14:00") in a zone, or in this computer's zone when the zone is bad. */
export function clockAt(unixSeconds: number, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const date = new Date(unixSeconds * 1000);
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/shared/team/schedule.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/shared/team/schedule.ts app/src/shared/team/schedule.test.ts
git commit -s -m "feat(app): compute when an employee routine runs next"
```

---

### Task 8.5: The G-07 status of each employee

**Files:**
- Create: `app/src/shared/team/teamStatus.ts`
- Test: `app/src/shared/team/teamStatus.test.ts`

**Interfaces:**
- Consumes: `EmployeeRuntimeStatus` from `app/src/bridge/types.ts` (part E, contract in `00-overview.md`), including the optional `pauseReason?: "person" | "credits" | "plan_limit"` that part I adds; `MemberRecord`, `WorkItemRecord`, `AskRecordView`, `RoutineRecord` (Task 8.3); `nextRoutineOccurrence`, `describeOccurrence`, `clockAt` (Task 8.4).
- Produces:
  - `type TeamStatusWord = "starting" | "working" | "free" | "waiting_on_you" | "paused" | "stopped" | "away"`
  - `STATUS_LABELS: Readonly<Record<TeamStatusWord, string>>` ("Starting", "Working", "Free", "Waiting on you", "Paused", "Stopped", "Away")
  - `type TeamPause = { reason: "person"; byName: string; atSec: number } | { reason: "credits_out" } | { reason: "plan_limit"; planName: string; untilSec: number | null } | null`
  - `type EmployeeStatusView = { agentPubkey: string; name: string; title: string; status: TeamStatusWord; label: string; detail: string; waitingNote: string | null; waitingDecisions: number; currentTask: { workItemId: string; title: string } | null; since: number | null }`
  - `type TeamStatusInput = { nowMs: number; localTimeZone: string; members: MemberRecord[]; names: ReadonlyMap<string, string>; runtime: EmployeeRuntimeStatus[] | null; workItems: WorkItemRecord[]; asks: AskRecordView[]; routines: RoutineRecord[]; teamComputer: { computerName: string; lastSeenAt: number } | null; isThisTeamComputer: boolean; teamPause: TeamPause }`
  - `AWAY_AFTER_SECONDS = 600`
  - `deriveTeamStatus(input: TeamStatusInput): EmployeeStatusView[]`

The precedence is G-07's: Stopped, Paused, Away, Starting, Waiting on you, Working, Free. "Waiting on you" means an open decision and no task; an employee with a task and an open decision shows "Working" plus a waiting note.

- [ ] **Step 1: Write the failing test**

Create `app/src/shared/team/teamStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { EmployeeRuntimeStatus } from "../../bridge/types";
import type { AskRecordView, MemberRecord, RoutineRecord, WorkItemRecord } from "./records";
import { type EmployeeStatusView, type TeamStatusInput, deriveTeamStatus } from "./teamStatus";
import { KAGISO, LERATO, MAYA, NALEDI, SCOUT, SIPHO } from "./testEvents";

// 2026-10-13 is a Tuesday; 06:00 UTC is 08:00 in Johannesburg.
const NOW_MS = Date.UTC(2026, 9, 13, 6, 0);
const NOW = NOW_MS / 1000;

function member(pubkey: string, title: string, overrides: Partial<MemberRecord> = {}): MemberRecord {
  return { pubkey, title, kind: "employee", status: "active", reason: null, managerPubkey: null, ...overrides };
}

function runtime(
  pubkey: string,
  state: EmployeeRuntimeStatus["state"] = "running",
  since = NOW - 3600,
): EmployeeRuntimeStatus {
  return { agentPubkey: pubkey, name: "From host", state, since, restartsInWindow: 0 };
}

function pausedRuntime(pubkey: string, pauseReason: "person" | "credits" | "plan_limit"): EmployeeRuntimeStatus {
  return { ...runtime(pubkey, "paused"), pauseReason };
}

function work(assignee: string, title: string, overrides: Partial<WorkItemRecord> = {}): WorkItemRecord {
  return {
    workItemId: `work-${title}`,
    title,
    status: "active",
    assignee,
    channelId: "conv-1",
    updatedAt: NOW - 60,
    dueAt: null,
    ...overrides,
  };
}

let askNumber = 0;
function ask(askerPubkey: string, overrides: Partial<AskRecordView> = {}): AskRecordView {
  askNumber += 1;
  return {
    askId: `ask-${askNumber}`,
    status: "open",
    askerPubkey,
    title: "Approve next week's posts",
    category: "general",
    channelId: "conv-1",
    createdAt: NOW - 120,
    updatedAt: NOW - 120,
    people: [LERATO],
    addresseePubkey: null,
    subjectWorkItemId: null,
    ownerOnly: false,
    ...overrides,
  };
}

function routine(employeePubkey: string, title: string, scheduleCron: string): RoutineRecord {
  return { dutyId: `duty-${title}`, employeePubkey, title, scheduleCron, timeZone: "Africa/Johannesburg", active: true };
}

function input(overrides: Partial<TeamStatusInput> = {}): TeamStatusInput {
  return {
    nowMs: NOW_MS,
    localTimeZone: "Africa/Johannesburg",
    members: [member(SCOUT, "Chief of Staff"), member(NALEDI, "Social Media Manager")],
    names: new Map([
      [SCOUT, "Scout"],
      [NALEDI, "Naledi"],
    ]),
    runtime: [runtime(SCOUT), runtime(NALEDI)],
    workItems: [],
    asks: [],
    routines: [],
    teamComputer: { computerName: "Lerato's MacBook Air", lastSeenAt: NOW - 30 },
    isThisTeamComputer: true,
    teamPause: null,
    ...overrides,
  };
}

function statusOf(views: EmployeeStatusView[], pubkey: string): EmployeeStatusView {
  const view = views.find((candidate) => candidate.agentPubkey === pubkey);
  if (!view) throw new Error(`no view for ${pubkey}`);
  return view;
}

describe("deriveTeamStatus", () => {
  it("shows Free with the next routine when there is nothing to do", () => {
    const views = deriveTeamStatus(
      input({
        routines: [routine(NALEDI, "Next week's posts", "0 10 * * 1"), routine(SCOUT, "Morning brief", "30 8 * * 1-5")],
      }),
    );
    expect(statusOf(views, NALEDI)).toMatchObject({
      status: "free",
      label: "Free",
      detail: "Next: Next week's posts, Monday 10:00",
    });
    expect(statusOf(views, SCOUT)).toMatchObject({ status: "free", detail: "Next: Morning brief, today 08:30" });
  });

  it("says there is nothing to do when no routine is active", () => {
    const views = deriveTeamStatus(input({ routines: [{ ...routine(NALEDI, "Old", "0 10 * * 1"), active: false }] }));
    expect(statusOf(views, NALEDI)).toMatchObject({ status: "free", detail: "Nothing to do right now" });
  });

  it("shows Working with the task and a waiting note for open decisions", () => {
    const views = deriveTeamStatus(input({ workItems: [work(NALEDI, "Drafting next week's posts")], asks: [ask(NALEDI)] }));
    expect(statusOf(views, NALEDI)).toMatchObject({
      status: "working",
      label: "Working",
      detail: "Drafting next week's posts",
      waitingNote: "1 decision waiting",
      waitingDecisions: 1,
      currentTask: { workItemId: "work-Drafting next week's posts", title: "Drafting next week's posts" },
    });
  });

  it("uses a blocked task when nothing is active, and the newest active task otherwise", () => {
    const blocked = deriveTeamStatus(
      input({
        workItems: [work(NALEDI, "Waiting for photos", { status: "blocked" }), work(NALEDI, "Old", { status: "done_verified", updatedAt: NOW })],
      }),
    );
    expect(statusOf(blocked, NALEDI).detail).toBe("Waiting for photos");
    const newest = deriveTeamStatus(
      input({ workItems: [work(NALEDI, "Older", { updatedAt: NOW - 600 }), work(NALEDI, "Newer", { updatedAt: NOW - 10 })] }),
    );
    expect(statusOf(newest, NALEDI).detail).toBe("Newer");
  });

  it("shows Waiting on you when decisions wait and there is no task", () => {
    const views = deriveTeamStatus(input({ asks: [ask(NALEDI), ask(NALEDI)] }));
    expect(statusOf(views, NALEDI)).toMatchObject({
      status: "waiting_on_you",
      label: "Waiting on you",
      detail: "2 decisions",
      waitingNote: null,
    });
  });

  it("counts decisions about the employee's work, not ones addressed to an employee, without people or closed", () => {
    const task = work(NALEDI, "Spring carousel", { status: "blocked" });
    const views = deriveTeamStatus(
      input({
        workItems: [task],
        asks: [
          ask(SCOUT, { subjectWorkItemId: task.workItemId }),
          ask(NALEDI, { addresseePubkey: SCOUT }),
          ask(NALEDI, { people: [] }),
          ask(NALEDI, { status: "resolved" }),
        ],
      }),
    );
    expect(statusOf(views, NALEDI).waitingDecisions).toBe(1);
  });

  it("shows Stopped before anything else, with the local time it stopped", () => {
    const views = deriveTeamStatus(
      input({ runtime: [runtime(SCOUT), runtime(NALEDI, "failing", NOW - 1800)], teamPause: { reason: "credits_out" } }),
    );
    expect(statusOf(views, NALEDI)).toMatchObject({
      status: "stopped",
      label: "Stopped",
      detail: "Stopped at 07:30. Restart?",
    });
  });

  it.each([
    [
      "the employee's own pause reason",
      { members: [member(SCOUT, "Chief of Staff"), member(NALEDI, "Social Media Manager", { status: "paused", reason: "Paused by Kagiso" })] },
      "Paused by Kagiso",
    ],
    ["a person pausing the team", { teamPause: { reason: "person", byName: "Kagiso", atSec: NOW - 60 } }, "Paused by Kagiso"],
    ["credits running out", { teamPause: { reason: "credits_out" } }, "Credits ran out"],
    [
      "a plan limit with a reset time",
      { teamPause: { reason: "plan_limit", planName: "Claude", untilSec: Date.UTC(2026, 9, 13, 12, 0) / 1000 } },
      "Claude plan limit until 14:00",
    ],
    ["a plan limit without a reset time", { teamPause: { reason: "plan_limit", planName: "ChatGPT", untilSec: null } }, "ChatGPT plan limit reached"],
    ["the host reporting a pause", { runtime: [runtime(SCOUT), runtime(NALEDI, "paused")] }, "Paused"],
    ["the host pausing for credits", { runtime: [runtime(SCOUT), pausedRuntime(NALEDI, "credits")] }, "Credits ran out"],
    ["the host pausing for a plan limit", { runtime: [runtime(SCOUT), pausedRuntime(NALEDI, "plan_limit")] }, "Plan limit reached"],
    ["the host pausing for a person", { runtime: [runtime(SCOUT), pausedRuntime(NALEDI, "person")] }, "Paused"],
  ] as Array<[string, Partial<TeamStatusInput>, string]>)("shows Paused for %s", (_name, overrides, detail) => {
    expect(statusOf(deriveTeamStatus(input(overrides)), NALEDI)).toMatchObject({ status: "paused", label: "Paused", detail });
  });

  it("shows Away on another computer only after more than ten minutes of silence", () => {
    const elsewhere = { isThisTeamComputer: false, runtime: null };
    const at600 = deriveTeamStatus(
      input({ ...elsewhere, teamComputer: { computerName: "Lerato's MacBook Air", lastSeenAt: NOW - 600 } }),
    );
    expect(statusOf(at600, NALEDI).status).toBe("free");
    const at601 = deriveTeamStatus(
      input({
        ...elsewhere,
        workItems: [work(NALEDI, "Drafting")],
        teamComputer: { computerName: "Lerato's MacBook Air", lastSeenAt: NOW - 601 },
      }),
    );
    expect(statusOf(at601, NALEDI)).toMatchObject({ status: "away", label: "Away", detail: "Lerato's MacBook Air is off" });
  });

  it("shows Away when no computer runs the team yet", () => {
    const views = deriveTeamStatus(input({ isThisTeamComputer: false, runtime: null, teamComputer: null }));
    expect(statusOf(views, NALEDI)).toMatchObject({ status: "away", detail: "Your team isn't running on any computer yet" });
  });

  it("shows Starting while the host starts the employee", () => {
    const views = deriveTeamStatus(
      input({ runtime: [runtime(SCOUT), runtime(NALEDI, "starting")], workItems: [work(NALEDI, "Drafting")] }),
    );
    expect(statusOf(views, NALEDI)).toMatchObject({ status: "starting", detail: "Getting ready" });
  });

  it("leaves out people and former employees and orders the team like G-07", () => {
    const views = deriveTeamStatus(
      input({
        members: [
          member(SIPHO, "Sales Director"),
          member(LERATO, "Owner", { kind: "human" }),
          member(KAGISO, "Website Builder", { status: "terminated", reason: "Let go" }),
          member(NALEDI, "Social Media Manager"),
          member(MAYA, "Growth Marketer"),
          member(SCOUT, "Chief of Staff"),
        ],
        runtime: null,
      }),
    );
    expect(views.map((view) => view.title)).toEqual(["Chief of Staff", "Growth Marketer", "Social Media Manager", "Sales Director"]);
  });

  it("falls back to the host's name, then the title, when there is no profile name", () => {
    expect(statusOf(deriveTeamStatus(input({ names: new Map() })), NALEDI).name).toBe("From host");
    expect(statusOf(deriveTeamStatus(input({ names: new Map(), runtime: null })), NALEDI).name).toBe("Social Media Manager");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/shared/team/teamStatus.test.ts`
Expected: FAIL with `Failed to resolve import "./teamStatus"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/shared/team/teamStatus.ts`:

```ts
import type { EmployeeRuntimeStatus } from "../../bridge/types";
import type { AskRecordView, MemberRecord, RoutineRecord, WorkItemRecord } from "./records";
import { clockAt, describeOccurrence, nextRoutineOccurrence, type RoutineOccurrence } from "./schedule";

export type TeamStatusWord = "starting" | "working" | "free" | "waiting_on_you" | "paused" | "stopped" | "away";

/** The G-07 status words. */
export const STATUS_LABELS: Readonly<Record<TeamStatusWord, string>> = {
  starting: "Starting",
  working: "Working",
  free: "Free",
  waiting_on_you: "Waiting on you",
  paused: "Paused",
  stopped: "Stopped",
  away: "Away",
};

/** Why the whole team is paused, when it is. */
export type TeamPause =
  | { reason: "person"; byName: string; atSec: number }
  | { reason: "credits_out" }
  | { reason: "plan_limit"; planName: string; untilSec: number | null }
  | null;

/** One employee as Today, Team and the menu bar show it. */
export type EmployeeStatusView = {
  agentPubkey: string;
  name: string;
  title: string;
  status: TeamStatusWord;
  label: string;
  detail: string;
  waitingNote: string | null;
  waitingDecisions: number;
  currentTask: { workItemId: string; title: string } | null;
  since: number | null;
};

export type TeamStatusInput = {
  nowMs: number;
  /** This computer's time zone, for "Stopped at 11:02" and "until 14:00". */
  localTimeZone: string;
  members: MemberRecord[];
  names: ReadonlyMap<string, string>;
  /** The host's view of each employee; null on a computer that does not run the team. */
  runtime: EmployeeRuntimeStatus[] | null;
  workItems: WorkItemRecord[];
  asks: AskRecordView[];
  routines: RoutineRecord[];
  teamComputer: { computerName: string; lastSeenAt: number } | null;
  isThisTeamComputer: boolean;
  teamPause: TeamPause;
};

/** Seconds of silence after which other computers show the team as away (G-04h default). */
export const AWAY_AFTER_SECONDS = 600;

const TITLE_ORDER = [
  "Chief of Staff",
  "Growth Marketer",
  "Social Media Manager",
  "Sales Director",
  "Website Builder",
  "Customer Care and Admin",
];

/** Derives the G-07 status of every active or paused employee, in G-07 team order. */
export function deriveTeamStatus(input: TeamStatusInput): EmployeeStatusView[] {
  const nowSec = Math.floor(input.nowMs / 1000);
  const employees = new Set(input.members.filter((member) => member.kind === "employee").map((member) => member.pubkey));
  return input.members
    .filter((member) => member.kind === "employee" && member.status !== "terminated")
    .map((member) => viewFor(member, input, nowSec, employees))
    .sort(compareViews);
}

function viewFor(
  member: MemberRecord,
  input: TeamStatusInput,
  nowSec: number,
  employees: ReadonlySet<string>,
): EmployeeStatusView {
  const pubkey = member.pubkey;
  const runtime = input.runtime?.find((status) => status.agentPubkey.toLowerCase() === pubkey) ?? null;
  const task = currentTask(pubkey, input.workItems);
  const waiting = waitingDecisions(pubkey, input.asks, input.workItems, employees);
  const base = {
    agentPubkey: pubkey,
    name: input.names.get(pubkey) ?? runtime?.name ?? member.title,
    title: member.title,
    waitingDecisions: waiting,
    currentTask: task ? { workItemId: task.workItemId, title: task.title } : null,
    since: runtime?.since ?? null,
  };
  const make = (status: TeamStatusWord, detail: string, waitingNote: string | null = null): EmployeeStatusView => ({
    ...base,
    status,
    label: STATUS_LABELS[status],
    detail,
    waitingNote,
  });

  if (runtime && (runtime.state === "stopped" || runtime.state === "failing")) {
    return make("stopped", `Stopped at ${clockAt(runtime.since, input.localTimeZone)}. Restart?`);
  }
  if (member.status === "paused" || input.teamPause !== null || runtime?.state === "paused") {
    return make("paused", pauseDetail(member, input.teamPause, runtime, input.localTimeZone));
  }
  if (runtime?.state === "away" || isAwayFromHere(input, nowSec)) {
    return make("away", input.teamComputer ? `${input.teamComputer.computerName} is off` : "Your team isn't running on any computer yet");
  }
  if (runtime?.state === "starting") {
    return make("starting", "Getting ready");
  }
  if (task) {
    return make("working", task.title, waiting > 0 ? `${decisions(waiting)} waiting` : null);
  }
  if (waiting > 0) {
    return make("waiting_on_you", decisions(waiting));
  }
  return make("free", freeDetail(pubkey, input));
}

function decisions(count: number): string {
  return `${count} ${count === 1 ? "decision" : "decisions"}`;
}

function pauseDetail(
  member: MemberRecord,
  pause: TeamPause,
  runtime: EmployeeRuntimeStatus | null,
  timeZone: string,
): string {
  if (member.status === "paused") return member.reason?.trim() || "Paused";
  if (pause?.reason === "person") return `Paused by ${pause.byName}`;
  if (pause?.reason === "credits_out" || runtime?.pauseReason === "credits") return "Credits ran out";
  if (pause?.reason === "plan_limit") {
    const plan = pause.planName ? `${pause.planName} plan` : "Plan";
    return pause.untilSec === null ? `${plan} limit reached` : `${plan} limit until ${clockAt(pause.untilSec, timeZone)}`;
  }
  if (runtime?.pauseReason === "plan_limit") return "Plan limit reached";
  return "Paused";
}

function isAwayFromHere(input: TeamStatusInput, nowSec: number): boolean {
  if (input.isThisTeamComputer) return false;
  if (input.teamComputer === null) return true;
  return nowSec - input.teamComputer.lastSeenAt > AWAY_AFTER_SECONDS;
}

function newest(items: WorkItemRecord[]): WorkItemRecord | null {
  return items.reduce<WorkItemRecord | null>((best, item) => (best === null || item.updatedAt > best.updatedAt ? item : best), null);
}

function currentTask(pubkey: string, workItems: WorkItemRecord[]): WorkItemRecord | null {
  const mine = workItems.filter((item) => item.assignee === pubkey);
  return newest(mine.filter((item) => item.status === "active")) ?? newest(mine.filter((item) => item.status === "blocked"));
}

function waitingDecisions(
  pubkey: string,
  asks: AskRecordView[],
  workItems: WorkItemRecord[],
  employees: ReadonlySet<string>,
): number {
  return asks.filter((ask) => {
    if (ask.status !== "open" || ask.people.length === 0) return false;
    if (ask.addresseePubkey !== null && employees.has(ask.addresseePubkey)) return false;
    if (ask.askerPubkey === pubkey) return true;
    return ask.subjectWorkItemId !== null && workItems.some((item) => item.workItemId === ask.subjectWorkItemId && item.assignee === pubkey);
  }).length;
}

function freeDetail(pubkey: string, input: TeamStatusInput): string {
  let best: { title: string; occurrence: RoutineOccurrence; rank: number } | null = null;
  for (const routine of input.routines) {
    if (!routine.active || routine.employeePubkey !== pubkey) continue;
    const occurrence = nextRoutineOccurrence(routine.scheduleCron, routine.timeZone, input.nowMs);
    if (!occurrence) continue;
    const rank = occurrence.daysAhead * 1440 + occurrence.hour * 60 + occurrence.minute;
    if (best === null || rank < best.rank) best = { title: routine.title, occurrence, rank };
  }
  return best === null ? "Nothing to do right now" : `Next: ${best.title}, ${describeOccurrence(best.occurrence)}`;
}

function titleRank(title: string): number {
  const index = TITLE_ORDER.indexOf(title);
  return index === -1 ? TITLE_ORDER.length : index;
}

function compareViews(left: EmployeeStatusView, right: EmployeeStatusView): number {
  return (
    titleRank(left.title) - titleRank(right.title) ||
    left.name.localeCompare(right.name) ||
    left.agentPubkey.localeCompare(right.agentPubkey)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/shared/team/teamStatus.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/shared/team/teamStatus.ts app/src/shared/team/teamStatus.test.ts
git commit -s -m "feat(app): derive the G-07 status of each employee"
```

---

### Task 8.6: Team status service in the main process

**Files:**
- Create: `app/src/main/team/relayFeed.ts`, `app/src/main/team/teamStatusService.ts`
- Test: `app/src/main/team/relayFeed.test.ts`, `app/src/main/team/teamStatusService.test.ts`

**Interfaces:**
- Consumes: `EmployeeRuntimeStatus`, `TeamComputerStatus` (`app/src/bridge/types.ts`, part E); record parsers (Task 8.3); `deriveTeamStatus`, `TeamPause`, `EmployeeStatusView` (Task 8.5).
- Produces:
  - `relayFeed.ts`: `type Unsubscribe = () => void`; `interface RelayFeed { query(relayUrl: string, filters: NostrFilter[]): Promise<NostrEvent[]>; subscribe(relayUrl: string, filters: NostrFilter[], onEvent: (event: NostrEvent) => void): Unsubscribe }`; `fetchRelaySelf(relayUrl: string, fetchImpl?: typeof fetch): Promise<string>`; `cachedRelaySelf(fetchImpl?: typeof fetch): (relayUrl: string) => Promise<string>`
  - `teamStatusService.ts`: `MAX_FILTERS_PER_QUERY = 10`, `RECORD_QUERY_LIMIT = 1000`, `REFRESH_DEBOUNCE_MS = 500`, `AWAY_RECHECK_MS = 60_000`; `queryInBatches(relay, relayUrl, filters): Promise<NostrEvent[]>`; `latestHeads(events): NostrEvent[]`; `recordFilters(relaySelf: string): NostrFilter[]`; `type TeamStatusDeps`; `type TeamStatusService = { overview(relayUrl: string): Promise<EmployeeStatusView[]>; refresh(relayUrl: string): Promise<void>; watch(relayUrl: string): Unsubscribe; hostStatusChanged(relayUrl: string): void }`; `createTeamStatusService(deps: TeamStatusDeps): TeamStatusService`

- [ ] **Step 1: Write the failing tests**

Create `app/src/main/team/relayFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { RELAY } from "../../shared/team/testEvents";
import { cachedRelaySelf, fetchRelaySelf } from "./relayFeed";

describe("fetchRelaySelf", () => {
  it("asks the relay's web address for its info document and lowercases the key", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${String(url)} ${new Headers(init?.headers).get("Accept")}`);
      return new Response(JSON.stringify({ self: RELAY.toUpperCase() }), { status: 200 });
    }) as typeof fetch;
    await expect(fetchRelaySelf("wss://lerato.colony.global/ws?x=1", fetchImpl)).resolves.toBe(RELAY);
    expect(calls).toEqual(["https://lerato.colony.global/ application/nostr+json"]);
  });

  it("rejects a document without a valid key", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ name: "relay" }))) as typeof fetch;
    await expect(fetchRelaySelf("ws://localhost:3000", fetchImpl)).rejects.toThrow("no valid self key");
  });

  it("caches the key and retries after a failure", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return attempts === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify({ self: RELAY }));
    }) as typeof fetch;
    const lookup = cachedRelaySelf(fetchImpl);
    await expect(lookup("wss://a.example")).rejects.toThrow("status 503");
    await expect(lookup("wss://a.example")).resolves.toBe(RELAY);
    await expect(lookup("wss://a.example")).resolves.toBe(RELAY);
    expect(attempts).toBe(2);
  });
});
```

Create `app/src/main/team/teamStatusService.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { EmployeeRuntimeStatus, TeamComputerStatus } from "../../bridge/types";
import { KIND_MEMBER_POSITION_HEAD, KIND_PROFILE, KIND_WORK_ITEM_HEAD } from "../../shared/team/kinds";
import type { NostrEvent, NostrFilter } from "../../shared/team/nostr";
import { LERATO, NALEDI, RELAY, SCOUT, makeEvent, manualTimers } from "../../shared/team/testEvents";
import type { RelayFeed } from "./relayFeed";
import {
  MAX_FILTERS_PER_QUERY,
  REFRESH_DEBOUNCE_MS,
  type TeamStatusDeps,
  createTeamStatusService,
  queryInBatches,
} from "./teamStatusService";

const RELAY_URL = "wss://lerato.colony.global";
const NOW_MS = Date.UTC(2026, 9, 13, 6, 0);
const NOW = NOW_MS / 1000;

function memberEvent(pubkey: string, title: string, status = "active", reason: string | null = null): NostrEvent {
  return makeEvent(
    KIND_MEMBER_POSITION_HEAD,
    { schemaVersion: 1, pubkey, title, kind: "employee", status, reason, sourceActionEventId: "a".repeat(64), updatedAt: "2026-10-13T06:00:00Z" },
    [["d", `company:member:${pubkey}`]],
  );
}

function workEvent(assignee: string, title: string): NostrEvent {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return makeEvent(
    KIND_WORK_ITEM_HEAD,
    {
      schemaVersion: 1,
      workItemId: id,
      title,
      status: "active",
      assignedPubkeys: [assignee],
      approverPubkeys: [],
      deliverables: [],
      requesterPubkey: LERATO,
      doneCondition: "Lerato approves",
      sourceActionEventId: "b".repeat(64),
    },
    [["d", `company:work:${id}`], ["h", "conv-1"]],
    NOW - 60,
  );
}

function profileEvent(pubkey: string, name: string): NostrEvent {
  return makeEvent(KIND_PROFILE, { display_name: name }, [], NOW - 3600, pubkey);
}

const isProfileQuery = (filters: NostrFilter[]) => filters.every((filter) => filter.kinds.includes(KIND_PROFILE));

function staticRelay(records: NostrEvent[], profiles: NostrEvent[] = []): RelayFeed {
  return {
    query: async (_url, filters) => (isProfileQuery(filters) ? profiles : records),
    subscribe: () => () => {},
  };
}

function running(pubkey: string): EmployeeRuntimeStatus {
  return { agentPubkey: pubkey, name: "From host", state: "running", since: NOW - 3600, restartsInWindow: 0 };
}

function claim(isThisComputer: boolean, lastSeenAt = NOW - 30): TeamComputerStatus {
  return {
    thisComputerId: "this",
    holder: { computerId: isThisComputer ? "this" : "other", computerName: "Lerato's MacBook Air", lastSeenAt },
    isThisComputer,
  };
}

function setup(relay: RelayFeed, overrides: Partial<TeamStatusDeps> = {}) {
  const timers = manualTimers();
  const changes: Array<{ relayUrl: string; views: unknown[] }> = [];
  const deps: TeamStatusDeps = {
    relay,
    relaySelf: async () => RELAY,
    hostStatus: async () => [running(SCOUT), running(NALEDI)],
    claimStatus: async () => claim(true),
    teamPause: () => null,
    nowMs: () => NOW_MS,
    localTimeZone: () => "Africa/Johannesburg",
    setTimer: timers.setTimer,
    onChange: (relayUrl, views) => changes.push({ relayUrl, views }),
    onError: () => {},
    ...overrides,
  };
  return { service: createTeamStatusService(deps), timers, changes };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTeamStatusService", () => {
  it("joins the host's runtime with relay records on the team computer", async () => {
    const relay = staticRelay(
      [memberEvent(SCOUT, "Chief of Staff"), memberEvent(NALEDI, "Social Media Manager"), workEvent(NALEDI, "Drafting next week's posts")],
      [profileEvent(NALEDI, "Naledi"), profileEvent(SCOUT, "Scout")],
    );
    const views = await setup(relay).service.overview(RELAY_URL);
    expect(views.map((view) => [view.name, view.status, view.detail])).toEqual([
      ["Scout", "free", "Nothing to do right now"],
      ["Naledi", "working", "Drafting next week's posts"],
    ]);
  });

  it("does not ask the host on another computer and shows Away after ten minutes", async () => {
    const hostStatus = vi.fn(async () => [] as EmployeeRuntimeStatus[]);
    const { service } = setup(staticRelay([memberEvent(NALEDI, "Social Media Manager")]), {
      hostStatus,
      claimStatus: async () => claim(false, NOW - 601),
    });
    const views = await service.overview(RELAY_URL);
    expect(hostStatus).not.toHaveBeenCalled();
    expect(views[0]).toMatchObject({ status: "away", detail: "Lerato's MacBook Air is off" });
  });

  it("never lets a slow refresh overwrite a newer one", async () => {
    let recordQueries = 0;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const relay: RelayFeed = {
      async query(_url, filters) {
        if (isProfileQuery(filters)) return [];
        recordQueries += 1;
        if (recordQueries === 1) {
          await firstGate;
          return [memberEvent(NALEDI, "Social Media Manager")];
        }
        return [memberEvent(NALEDI, "Social Media Manager", "paused", "Paused by Kagiso")];
      },
      subscribe: () => () => {},
    };
    const { service, changes } = setup(relay);
    const slow = service.refresh(RELAY_URL);
    await flush();
    await service.refresh(RELAY_URL);
    releaseFirst();
    await slow;
    expect(changes).toHaveLength(1);
    expect(changes[0]?.views).toMatchObject([{ status: "paused", detail: "Paused by Kagiso" }]);
  });

  it("names kinds in every filter and sends at most ten filters per query", async () => {
    const seen: NostrFilter[][] = [];
    const relay: RelayFeed = {
      query: async (_url, filters) => {
        seen.push(filters);
        return isProfileQuery(filters) ? [] : [memberEvent(NALEDI, "Social Media Manager")];
      },
      subscribe: () => () => {},
    };
    await setup(relay).service.overview(RELAY_URL);
    expect(seen.length).toBeGreaterThan(0);
    for (const filters of seen) {
      expect(filters.length).toBeLessThanOrEqual(MAX_FILTERS_PER_QUERY);
      for (const filter of filters) expect(filter.kinds.length).toBeGreaterThan(0);
    }
  });

  it("refreshes once per burst of relay events and stops cleanly", async () => {
    const listeners: Array<(event: NostrEvent) => void> = [];
    let unsubscribed = false;
    let recordQueries = 0;
    const relay: RelayFeed = {
      query: async (_url, filters) => {
        if (!isProfileQuery(filters)) recordQueries += 1;
        return isProfileQuery(filters) ? [] : [memberEvent(NALEDI, "Social Media Manager")];
      },
      subscribe: (_url, filters, listener) => {
        expect(filters.every((filter) => filter.since === NOW && filter.kinds.length > 0)).toBe(true);
        listeners.push(listener);
        return () => {
          unsubscribed = true;
        };
      },
    };
    const { service, timers, changes } = setup(relay);
    const stop = service.watch(RELAY_URL);
    await flush();
    timers.fire(REFRESH_DEBOUNCE_MS);
    await flush();
    expect(recordQueries).toBe(1);
    for (const listener of listeners) {
      listener(memberEvent(NALEDI, "Social Media Manager", "paused", "Paused"));
      listener(memberEvent(NALEDI, "Social Media Manager", "paused", "Paused"));
    }
    timers.fire(REFRESH_DEBOUNCE_MS);
    await flush();
    expect(recordQueries).toBe(2);
    expect(changes).toHaveLength(2);
    stop();
    expect(unsubscribed).toBe(true);
    expect(timers.count()).toBe(0);
  });
});

describe("queryInBatches", () => {
  it("splits long filter lists into batches of ten and drops duplicate events", async () => {
    const sizes: number[] = [];
    const shared = makeEvent(KIND_PROFILE, { name: "x" });
    const relay: RelayFeed = {
      query: async (_url, filters) => {
        sizes.push(filters.length);
        return [shared];
      },
      subscribe: () => () => {},
    };
    const filters = Array.from({ length: 23 }, () => ({ kinds: [KIND_PROFILE] }));
    await expect(queryInBatches(relay, RELAY_URL, filters)).resolves.toEqual([shared]);
    expect(sizes).toEqual([10, 10, 3]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C app exec vitest run src/main/team`
Expected: FAIL with `Failed to resolve import "./relayFeed"` and `Failed to resolve import "./teamStatusService"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/team/relayFeed.ts`:

```ts
import { type NostrEvent, type NostrFilter, normalizePubkey } from "../../shared/team/nostr";

/** Stops a subscription or a timer. */
export type Unsubscribe = () => void;

/**
 * The relay access the main process needs (Task 8.11 builds it over part E's
 * `RelayConnection`). `query` runs one request; `subscribe` delivers stored
 * matches first, then live events, until stopped. Every filter names its kinds.
 */
export interface RelayFeed {
  query(relayUrl: string, filters: NostrFilter[]): Promise<NostrEvent[]>;
  subscribe(relayUrl: string, filters: NostrFilter[], onEvent: (event: NostrEvent) => void): Unsubscribe;
}

/** Reads the relay's own key from its NIP-11 document; relay-signed heads are authored by it. */
export async function fetchRelaySelf(relayUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/";
  url.search = "";
  const response = await fetchImpl(url.toString(), { headers: { Accept: "application/nostr+json" } });
  if (!response.ok) throw new Error(`relay info request failed with status ${response.status}`);
  const info: unknown = await response.json();
  const self = normalizePubkey(typeof info === "object" && info !== null ? (info as { self?: unknown }).self : null);
  if (!self) throw new Error("relay info has no valid self key");
  return self;
}

/** Caches the relay key per relay URL; a failed lookup is tried again next time. */
export function cachedRelaySelf(fetchImpl: typeof fetch = fetch): (relayUrl: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (relayUrl) => {
    const cached = cache.get(relayUrl);
    if (cached) return cached;
    const pending = fetchRelaySelf(relayUrl, fetchImpl);
    cache.set(relayUrl, pending);
    pending.catch(() => cache.delete(relayUrl));
    return pending;
  };
}
```

Create `app/src/main/team/teamStatusService.ts`:

```ts
import type { EmployeeRuntimeStatus, TeamComputerStatus } from "../../bridge/types";
import {
  KIND_ASK_HEAD,
  KIND_DUTY_HEAD,
  KIND_MEMBER_POSITION_HEAD,
  KIND_PROFILE,
  KIND_WORK_ITEM_HEAD,
} from "../../shared/team/kinds";
import { type NostrEvent, type NostrFilter, singleTag } from "../../shared/team/nostr";
import {
  parseAskHead,
  parseDutyHead,
  parseMemberPositionHead,
  parseProfileName,
  parseWorkItemHead,
} from "../../shared/team/records";
import { type EmployeeStatusView, type TeamPause, deriveTeamStatus } from "../../shared/team/teamStatus";
import type { RelayFeed, Unsubscribe } from "./relayFeed";

export const MAX_FILTERS_PER_QUERY = 10;
export const RECORD_QUERY_LIMIT = 1000;
export const REFRESH_DEBOUNCE_MS = 500;
export const AWAY_RECHECK_MS = 60_000;

export type TeamStatusDeps = {
  relay: RelayFeed;
  relaySelf(relayUrl: string): Promise<string>;
  hostStatus(relayUrl: string): Promise<EmployeeRuntimeStatus[]>;
  claimStatus(relayUrl: string): Promise<TeamComputerStatus>;
  teamPause(relayUrl: string): TeamPause;
  nowMs(): number;
  localTimeZone(): string;
  /** Starts a one-shot timer and returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
  onChange(relayUrl: string, views: EmployeeStatusView[]): void;
  onError(relayUrl: string, error: unknown): void;
};

export type TeamStatusService = {
  /** Loads the current statuses now. */
  overview(relayUrl: string): Promise<EmployeeStatusView[]>;
  /** Loads and reports through `onChange`, unless a newer refresh started meanwhile. */
  refresh(relayUrl: string): Promise<void>;
  /** Refreshes on relay changes and every minute until stopped. */
  watch(relayUrl: string): Unsubscribe;
  /** Call when the host reports a runtime change (`team://status`). */
  hostStatusChanged(relayUrl: string): void;
};

/** Runs filters in batches of at most ten and drops duplicate events. */
export async function queryInBatches(relay: RelayFeed, relayUrl: string, filters: NostrFilter[]): Promise<NostrEvent[]> {
  const seen = new Map<string, NostrEvent>();
  for (let index = 0; index < filters.length; index += MAX_FILTERS_PER_QUERY) {
    for (const event of await relay.query(relayUrl, filters.slice(index, index + MAX_FILTERS_PER_QUERY))) {
      seen.set(event.id, event);
    }
  }
  return [...seen.values()];
}

/** Keeps the newest event per kind, author and d tag. */
export function latestHeads(events: NostrEvent[]): NostrEvent[] {
  const newest = new Map<string, NostrEvent>();
  for (const event of events) {
    const key = `${event.kind}:${event.pubkey}:${singleTag(event, "d") ?? ""}`;
    const current = newest.get(key);
    if (!current || event.created_at > current.created_at) newest.set(key, event);
  }
  return [...newest.values()];
}

/** The relay-signed records team status reads. */
export function recordFilters(relaySelf: string): NostrFilter[] {
  return [KIND_MEMBER_POSITION_HEAD, KIND_WORK_ITEM_HEAD, KIND_ASK_HEAD, KIND_DUTY_HEAD].map((kind) => ({
    kinds: [kind],
    authors: [relaySelf],
    limit: RECORD_QUERY_LIMIT,
  }));
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export function createTeamStatusService(deps: TeamStatusDeps): TeamStatusService {
  const generations = new Map<string, number>();
  const pendingRefresh = new Map<string, () => void>();

  const nextGeneration = (relayUrl: string): number => {
    const next = (generations.get(relayUrl) ?? 0) + 1;
    generations.set(relayUrl, next);
    return next;
  };

  async function load(relayUrl: string): Promise<EmployeeStatusView[]> {
    const [relaySelf, claim] = await Promise.all([deps.relaySelf(relayUrl), deps.claimStatus(relayUrl)]);
    const heads = latestHeads(await queryInBatches(deps.relay, relayUrl, recordFilters(relaySelf)));
    const members = heads.map((event) => parseMemberPositionHead(event)).filter(isPresent);
    const employeeKeys = members
      .filter((member) => member.kind === "employee" && member.status !== "terminated")
      .map((member) => member.pubkey);
    const names = new Map<string, string>();
    if (employeeKeys.length > 0) {
      const profiles = latestHeads(
        await queryInBatches(deps.relay, relayUrl, [{ kinds: [KIND_PROFILE], authors: employeeKeys, limit: employeeKeys.length * 2 }]),
      );
      for (const profile of profiles) {
        const name = parseProfileName(profile);
        if (name) names.set(profile.pubkey.toLowerCase(), name);
      }
    }
    const runtime = claim.isThisComputer ? await deps.hostStatus(relayUrl) : null;
    return deriveTeamStatus({
      nowMs: deps.nowMs(),
      localTimeZone: deps.localTimeZone(),
      members,
      names,
      runtime,
      workItems: heads.map((event) => parseWorkItemHead(event)).filter(isPresent),
      asks: heads.map((event) => parseAskHead(event)).filter(isPresent),
      routines: heads.map((event) => parseDutyHead(event)).filter(isPresent),
      teamComputer: claim.holder ? { computerName: claim.holder.computerName, lastSeenAt: claim.holder.lastSeenAt } : null,
      isThisTeamComputer: claim.isThisComputer,
      teamPause: deps.teamPause(relayUrl),
    });
  }

  async function refresh(relayUrl: string): Promise<void> {
    const generation = nextGeneration(relayUrl);
    try {
      const views = await load(relayUrl);
      if (generations.get(relayUrl) === generation) deps.onChange(relayUrl, views);
    } catch (error) {
      if (generations.get(relayUrl) === generation) deps.onError(relayUrl, error);
    }
  }

  function scheduleRefresh(relayUrl: string): void {
    pendingRefresh.get(relayUrl)?.();
    pendingRefresh.set(
      relayUrl,
      deps.setTimer(() => {
        pendingRefresh.delete(relayUrl);
        void refresh(relayUrl);
      }, REFRESH_DEBOUNCE_MS),
    );
  }

  function watch(relayUrl: string): Unsubscribe {
    let stopped = false;
    let stopRelay: Unsubscribe | null = null;
    let cancelTick: (() => void) | null = null;
    const tick = (): void => {
      scheduleRefresh(relayUrl);
      cancelTick = deps.setTimer(tick, AWAY_RECHECK_MS);
    };
    deps.relaySelf(relayUrl).then(
      (relaySelf) => {
        if (stopped) return;
        const since = Math.floor(deps.nowMs() / 1000);
        const live = recordFilters(relaySelf).map((filter) => ({ kinds: filter.kinds, authors: filter.authors, since }));
        stopRelay = deps.relay.subscribe(relayUrl, live, () => scheduleRefresh(relayUrl));
      },
      (error: unknown) => deps.onError(relayUrl, error),
    );
    scheduleRefresh(relayUrl);
    cancelTick = deps.setTimer(tick, AWAY_RECHECK_MS);
    return () => {
      stopped = true;
      stopRelay?.();
      cancelTick?.();
      pendingRefresh.get(relayUrl)?.();
      pendingRefresh.delete(relayUrl);
      nextGeneration(relayUrl);
    };
  }

  return {
    overview: load,
    refresh,
    watch,
    hostStatusChanged: scheduleRefresh,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C app exec vitest run src/main/team`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/team/relayFeed.ts app/src/main/team/relayFeed.test.ts app/src/main/team/teamStatusService.ts app/src/main/team/teamStatusService.test.ts
git commit -s -m "feat(app): load and watch team status in the main process"
```

---

### Task 8.7: Notification preferences and the G-03 rules

**Files:**
- Create: `app/src/shared/notifications/preferences.ts`, `app/src/main/notifications/types.ts`, `app/src/main/notifications/rules.ts`
- Modify: `app/src/bridge/types.ts` (part E): `NavTarget` gains an optional `subId`
- Test: `app/src/shared/notifications/preferences.test.ts`, `app/src/main/notifications/rules.test.ts`

**Interfaces:**
- Consumes: `AppNotification`, `NavTarget` (`app/src/bridge/types.ts`, part E); `clockAt` (Task 8.4).
- Produces:
  - `preferences.ts`: `type NotificationPreferences`, `DEFAULT_NOTIFICATION_PREFERENCES`, `type FocusReport = { screen: string | null; itemId: string | null; conversationId: string | null }`, `NO_FOCUS`, `isNotificationPreferences(value: unknown)`, `isFocusReport(value: unknown)`
  - `types.ts`: the event types `DecisionEvent`, `DecisionHandledEvent`, `EmployeeProblemEvent`, `TeamStoppedEvent`, `TeamPausedEvent`, `TeamResumedEvent`, `CreditsLowEvent`, `BriefEvent`, `TimeToPostEvent`, `CustomerWaitingEvent`, `ReplyToYouEvent`, `TeamMovedAwayEvent`; unions `NotifyEvent` and `KeyedEvent`; `type ViewerRole = "owner" | "partner"`; `type NotifyContext`; `type SuppressReason`; `type NotifyDecision`; `type DecisionGroup`; `type RulesState`; `INITIAL_RULES_STATE`; `isUrgent(event: KeyedEvent): boolean`
  - `rules.ts`: `GROUP_WINDOW_SECONDS = 60`, `MAX_BODY_CHARS = 160`, `type RulesResult = { decisions: NotifyDecision[]; state: RulesState }`, `decideNotification(event: NotifyEvent, ctx: NotifyContext, state: RulesState): RulesResult`, `inQuietHours(localMinutes: number, preferences: NotificationPreferences): boolean`, `minutesOf(clock: string): number | null`, `groupBody(labels: string[]): string`, `truncate(text: string, max?: number): string`
  - `NavTarget` becomes `{ screen: string; id?: string; subId?: string }` (`subId` is the message inside a conversation, for "Reply to you").

The rules are pure: the same event, context and state always give the same decisions. Event types for time to post, customer waiting and credits low exist now with their rules and tests; their producers arrive with the content calendar (E-24), the customer inbox (E-22) and the company wallet (E-15), which phase 1 does not have.

- [ ] **Step 1: Write the failing tests**

Create `app/src/shared/notifications/preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES, isFocusReport, isNotificationPreferences } from "./preferences";

const without = (key: string) =>
  Object.fromEntries(Object.entries(DEFAULT_NOTIFICATION_PREFERENCES).filter(([name]) => name !== key));

describe("isNotificationPreferences", () => {
  it("accepts the S-06 defaults", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      morningBrief: true,
      fridayWrap: true,
      timeToPost: true,
      customerWaiting: true,
      quietHours: { enabled: true, start: "21:00", end: "07:00" },
      letUrgentThrough: true,
      sound: true,
    });
    expect(isNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
  });

  it.each([
    ["a missing switch", without("sound")],
    ["an extra key", { ...DEFAULT_NOTIFICATION_PREFERENCES, phone: true }],
    ["a switch that is not a boolean", { ...DEFAULT_NOTIFICATION_PREFERENCES, sound: "yes" }],
    ["a bad clock time", { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: true, start: "24:00", end: "07:00" } }],
    ["missing quiet hours fields", { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: true, start: "21:00" } }],
    ["not an object", "quiet"],
  ])("rejects %s", (_name, value) => {
    expect(isNotificationPreferences(value)).toBe(false);
  });
});

describe("isFocusReport", () => {
  it("accepts strings or nulls and nothing else", () => {
    expect(isFocusReport({ screen: "T-03", itemId: null, conversationId: "conv-1" })).toBe(true);
    expect(isFocusReport({ screen: null, itemId: null, conversationId: null })).toBe(true);
    expect(isFocusReport({ screen: 3, itemId: null, conversationId: null })).toBe(false);
    expect(isFocusReport({ screen: "T-03", itemId: null })).toBe(false);
    expect(isFocusReport({ screen: "x".repeat(201), itemId: null, conversationId: null })).toBe(false);
  });
});
```

Create `app/src/main/notifications/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { NavTarget } from "../../bridge/types";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "../../shared/notifications/preferences";
import { KAGISO, LERATO, SIPHO } from "../../shared/team/testEvents";
import { GROUP_WINDOW_SECONDS, MAX_BODY_CHARS, decideNotification, groupBody, inQuietHours, truncate } from "./rules";
import {
  type BriefEvent,
  type DecisionEvent,
  type EmployeeProblemEvent,
  INITIAL_RULES_STATE,
  type NotifyContext,
  type NotifyDecision,
  type NotifyEvent,
  type ReplyToYouEvent,
  type RulesState,
  type TeamPausedEvent,
} from "./types";

const NOW = 1_760_340_000;
const UNTIL_TWO_PM_JOBURG = Date.UTC(2026, 9, 13, 12, 0) / 1000;

function ctx(overrides: Partial<NotifyContext> = {}): NotifyContext {
  return {
    nowSec: NOW,
    localMinutes: 10 * 60,
    localTimeZone: "Africa/Johannesburg",
    viewer: { pubkey: LERATO, firstName: "Lerato", role: "owner" },
    ownerFirstName: "Lerato",
    openDecisionCount: 2,
    windowFocused: false,
    focus: { screen: null, itemId: null, conversationId: null },
    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    permission: "granted",
    historyBeforeSec: NOW - 3600,
    delivered: new Set<string>(),
    ...overrides,
  };
}

const partner: Partial<NotifyContext> = { viewer: { pubkey: KAGISO, firstName: "Kagiso", role: "partner" } };

function prefs(overrides: Partial<NotificationPreferences>): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides };
}

function decision(askId: string, overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    type: "decision",
    key: `decision:${askId}`,
    askId,
    channelId: "conv-1",
    label: `the ${askId} card`,
    body: `Naledi's ${askId} is ready for your OK.`,
    ownerOnly: false,
    createdAt: NOW,
    ...overrides,
  };
}

function problem(overrides: Partial<EmployeeProblemEvent> = {}): EmployeeProblemEvent {
  return {
    type: "employee_problem",
    key: `problem:${SIPHO}:crash_loop:${NOW}`,
    agentPubkey: SIPHO,
    employeeName: "Sipho",
    isScout: false,
    problem: "crash_loop",
    createdAt: NOW,
    ...overrides,
  };
}

function paused(reason: TeamPausedEvent["reason"], untilSec: number | null = null): TeamPausedEvent {
  return {
    type: "team_paused",
    key: `paused:${reason}:${NOW}`,
    reason,
    planName: reason === "credits_out" ? "" : "Claude",
    untilSec,
    createdAt: NOW,
  };
}

function brief(briefType: "morning" | "friday", doneCount: number | null): BriefEvent {
  return { type: "brief", key: `brief:2026-10-13:${briefType}`, briefType, doneCount, createdAt: NOW };
}

function reply(authorIsScout: boolean): ReplyToYouEvent {
  return {
    type: "reply_to_you",
    key: "reply:m1",
    channelId: "conv-1",
    messageId: "m1",
    authorName: authorIsScout ? "Scout" : "Naledi",
    authorIsScout,
    snippet: "Done. The price list is in Spring launch.",
    createdAt: NOW,
  };
}

function only(decisions: NotifyDecision[]): NotifyDecision {
  expect(decisions).toHaveLength(1);
  const [first] = decisions;
  if (!first) throw new Error("no decision");
  return first;
}

function shown(event: NotifyEvent, context = ctx(), state: RulesState = INITIAL_RULES_STATE) {
  const made = only(decideNotification(event, context, state).decisions);
  if (made.action !== "show") throw new Error(`expected show, got ${made.action}`);
  return made;
}

function suppressedReason(event: NotifyEvent, context = ctx(), state: RulesState = INITIAL_RULES_STATE) {
  const made = only(decideNotification(event, context, state).decisions);
  if (made.action !== "suppress") throw new Error(`expected suppress, got ${made.action}`);
  return made.reason;
}

type CopyCase = {
  name: string;
  event: NotifyEvent;
  title: string;
  body: string;
  target: NavTarget;
  context?: Partial<NotifyContext>;
};

const COPY: CopyCase[] = [
  {
    name: "an employee that keeps failing",
    event: problem(),
    title: "Scout",
    body: "Sipho has stopped working. Want me to restart them?",
    target: { screen: "C-18", id: SIPHO },
  },
  {
    name: "an employee that could not start",
    event: problem({ problem: "start_failed" }),
    title: "Scout",
    body: "Sipho couldn't start. Want me to try again?",
    target: { screen: "C-18", id: SIPHO },
  },
  {
    name: "Scout stopping",
    event: problem({ isScout: true, employeeName: "Scout" }),
    title: "Colony",
    body: "Scout has stopped, so nobody is running your team. Open Colony to restart Scout.",
    target: { screen: "X-09" },
  },
  {
    name: "the team stopping",
    event: { type: "team_stopped", key: `team-stopped:${NOW}`, createdAt: NOW },
    title: "Colony",
    body: "Your team has stopped. Open Colony to restart it.",
    target: { screen: "X-10" },
  },
  {
    name: "credits running out, owner",
    event: paused("credits_out"),
    title: "Colony",
    body: "Your team is paused: credits ran out. Buy credits to carry on.",
    target: { screen: "S-02", id: "buy-credits" },
  },
  {
    name: "credits running out, partner",
    event: paused("credits_out"),
    context: partner,
    title: "Colony",
    body: "Your team is paused: credits ran out. Lerato can top up.",
    target: { screen: "T-01" },
  },
  {
    name: "a plan limit, owner",
    event: paused("plan_limit", UNTIL_TWO_PM_JOBURG),
    title: "Colony",
    body: "Your team is paused until 14:00: your Claude plan reached its limit.",
    target: { screen: "S-03" },
  },
  {
    name: "a plan limit, partner",
    event: paused("plan_limit", UNTIL_TWO_PM_JOBURG),
    context: partner,
    title: "Colony",
    body: "Your team is paused until 14:00: Lerato's Claude plan reached its limit.",
    target: { screen: "T-01" },
  },
  {
    name: "a plan limit the host reports without a plan name",
    event: { ...paused("plan_limit"), planName: "" },
    title: "Colony",
    body: "Your team is paused: your plan reached its limit.",
    target: { screen: "S-03" },
  },
  {
    name: "a disconnected plan, owner",
    event: paused("plan_disconnected"),
    title: "Colony",
    body: "Your team can't reach your Claude plan. Sign in again to carry on.",
    target: { screen: "S-03" },
  },
  {
    name: "a disconnected plan, partner",
    event: paused("plan_disconnected"),
    context: partner,
    title: "Colony",
    body: "Your team can't reach Lerato's Claude plan. Lerato needs to sign in again.",
    target: { screen: "T-01" },
  },
  {
    name: "credits running low",
    event: { type: "credits_low", key: `credits-low:${NOW}`, daysLeft: 2, createdAt: NOW },
    title: "Colony",
    body: "Credits are running low: about 2 days left.",
    target: { screen: "S-02" },
  },
  {
    name: "the morning brief",
    event: brief("morning", null),
    title: "Scout",
    body: "Morning, Lerato. 2 things need you today.",
    target: { screen: "T-01" },
  },
  {
    name: "the Friday wrap",
    event: brief("friday", 14),
    context: { openDecisionCount: 1 },
    title: "Scout",
    body: "Friday wrap: 14 things done this week, 1 needs you.",
    target: { screen: "T-01" },
  },
  {
    name: "time to post",
    event: {
      type: "time_to_post",
      key: "post:p1",
      postId: "p1",
      postTitle: "spring linen carousel",
      platform: "Instagram",
      employeeName: "Naledi",
      cardScreen: "C-05",
      createdAt: NOW,
    },
    title: "Scout",
    body: "Time to post Naledi's spring linen carousel on Instagram.",
    target: { screen: "C-05", id: "p1" },
  },
  {
    name: "a customer waiting",
    event: {
      type: "customer_waiting",
      key: "customer:r1",
      replyCardId: "r1",
      customerName: "Thabo",
      careEmployeeName: "Grace",
      createdAt: NOW,
    },
    title: "Scout",
    body: "Thabo has waited a day for a reply. Grace's draft is ready.",
    target: { screen: "C-09", id: "r1" },
  },
  {
    name: "a reply from Scout",
    event: reply(true),
    title: "Scout",
    body: "Done. The price list is in Spring launch.",
    target: { screen: "T-03", id: "conv-1", subId: "m1" },
  },
  {
    name: "a reply from an employee",
    event: reply(false),
    title: "Scout",
    body: "Naledi: Done. The price list is in Spring launch.",
    target: { screen: "T-03", id: "conv-1", subId: "m1" },
  },
  {
    name: "the team moving away",
    event: { type: "team_moved_away", key: "moved:c2:1", newComputerName: "Kagiso's laptop", createdAt: NOW },
    title: "Colony",
    body: "Your team now runs on Kagiso's laptop.",
    target: { screen: "X-13" },
  },
];

describe("G-03 words and click targets", () => {
  it.each(COPY)("uses the G-03 words for $name", ({ event, title, body, target, context }) => {
    expect(shown(event, ctx(context)).notification).toMatchObject({ title, body, target });
  });
});

describe("decisions", () => {
  it("opens the card in Needs you with Scout's words", () => {
    const made = shown(decision("a1"));
    expect(made.notification).toEqual({
      id: "decision:a1",
      title: "Scout",
      body: "Naledi's a1 is ready for your OK.",
      target: { screen: "T-05", id: "a1" },
    });
    expect(made.silent).toBe(false);
  });

  it("groups decisions within a minute into one quiet replacement", () => {
    const first = decideNotification(decision("a1"), ctx(), INITIAL_RULES_STATE);
    const second = decideNotification(decision("a2"), ctx({ nowSec: NOW + 30 }), first.state);
    expect(only(second.decisions)).toMatchObject({
      action: "show",
      silent: true,
      replaces: ["decision:a1"],
      notification: {
        id: `decisions:${NOW}`,
        title: "Scout",
        body: "2 things need you: the a1 card and the a2 card.",
        target: { screen: "T-05" },
      },
    });
    const third = decideNotification(decision("a3"), ctx({ nowSec: NOW + GROUP_WINDOW_SECONDS - 1 }), second.state);
    expect(only(third.decisions)).toMatchObject({
      replaces: [],
      notification: { id: `decisions:${NOW}`, body: "3 things need you: the a1 card, the a2 card and the a3 card." },
    });
  });

  it("starts a new notification once the minute has passed", () => {
    const first = decideNotification(decision("a1"), ctx(), INITIAL_RULES_STATE);
    const later = decideNotification(decision("a2"), ctx({ nowSec: NOW + GROUP_WINDOW_SECONDS }), first.state);
    expect(only(later.decisions)).toMatchObject({ replaces: [], notification: { id: "decision:a2" } });
  });

  it("withdraws a decision handled elsewhere, and a group only when all of it is handled", () => {
    const single = decideNotification(decision("a1"), ctx(), INITIAL_RULES_STATE);
    expect(decideNotification({ type: "decision_handled", askId: "a1" }, ctx(), single.state).decisions).toEqual([
      { action: "withdraw", notificationIds: ["decision:a1"] },
    ]);
    const grouped = decideNotification(decision("a2"), ctx({ nowSec: NOW + 10 }), single.state);
    const firstHandled = decideNotification({ type: "decision_handled", askId: "a1" }, ctx(), grouped.state);
    expect(firstHandled.decisions).toEqual([]);
    const bothHandled = decideNotification({ type: "decision_handled", askId: "a2" }, ctx(), firstHandled.state);
    expect(bothHandled.decisions).toEqual([{ action: "withdraw", notificationIds: [`decisions:${NOW}`] }]);
    expect(decideNotification({ type: "decision_handled", askId: "unknown" }, ctx(), bothHandled.state).decisions).toEqual([]);
  });

  it("keeps owner-only decisions from partners", () => {
    expect(suppressedReason(decision("a1", { ownerOnly: true }), ctx(partner))).toBe("not_for_viewer");
    expect(shown(decision("a1", { ownerOnly: true })).notification.id).toBe("decision:a1");
  });

  it("stays quiet when the card or its conversation is in front", () => {
    expect(
      suppressedReason(decision("a1"), ctx({ windowFocused: true, focus: { screen: "T-05", itemId: "a1", conversationId: null } })),
    ).toBe("in_front");
    expect(
      suppressedReason(decision("a1"), ctx({ windowFocused: true, focus: { screen: "T-03", itemId: null, conversationId: "conv-1" } })),
    ).toBe("in_front");
    expect(
      shown(decision("a1"), ctx({ windowFocused: true, focus: { screen: "T-03", itemId: null, conversationId: "conv-2" } }))
        .notification.id,
    ).toBe("decision:a1");
    expect(
      shown(decision("a1"), ctx({ windowFocused: false, focus: { screen: "T-05", itemId: "a1", conversationId: null } }))
        .notification.id,
    ).toBe("decision:a1");
  });
});

describe("history, repeats and permission", () => {
  it("never notifies about something created before Colony last ran", () => {
    expect(suppressedReason(decision("a1", { createdAt: NOW - 3601 }))).toBe("history");
  });

  it("never repeats a delivered key", () => {
    expect(suppressedReason(decision("a1"), ctx({ delivered: new Set(["decision:a1"]) }))).toBe("duplicate");
  });

  it("shows one team-paused notification at a time and withdraws it on resume", () => {
    const first = decideNotification(paused("credits_out"), ctx(), INITIAL_RULES_STATE);
    expect(first.state.pausedNotificationId).toBe("team-paused");
    expect(suppressedReason({ ...paused("credits_out"), key: "paused:credits_out:again" }, ctx(), first.state)).toBe("duplicate");
    expect(decideNotification({ type: "team_resumed" }, ctx(), first.state).decisions).toEqual([
      { action: "withdraw", notificationIds: ["team-paused"] },
    ]);
    expect(decideNotification({ type: "team_resumed" }, ctx(), INITIAL_RULES_STATE).decisions).toEqual([]);
  });

  it("sends nothing when the computer blocks notifications", () => {
    expect(suppressedReason(problem(), ctx({ permission: "denied" }))).toBe("no_permission");
  });
});

describe("quiet hours", () => {
  it.each([
    [20 * 60 + 59, "show"],
    [21 * 60, "suppress"],
    [3 * 60, "suppress"],
    [6 * 60 + 59, "suppress"],
    [7 * 60, "show"],
  ] as Array<[number, "show" | "suppress"]>)("treats a decision at minute %i as %s", (minute, action) => {
    expect(only(decideNotification(decision("a1"), ctx({ localMinutes: minute }), INITIAL_RULES_STATE).decisions).action).toBe(action);
  });

  it("lets urgent problems through unless the person turned that off", () => {
    expect(shown(problem(), ctx({ localMinutes: 3 * 60 })).notification.id).toBe(`problem:${SIPHO}`);
    expect(suppressedReason(problem(), ctx({ localMinutes: 3 * 60, preferences: prefs({ letUrgentThrough: false }) }))).toBe("quiet_hours");
    expect(
      suppressedReason({ type: "credits_low", key: "credits-low:night", daysLeft: 1, createdAt: NOW }, ctx({ localMinutes: 3 * 60 })),
    ).toBe("quiet_hours");
  });

  it("handles windows that do not cross midnight, are off, or are empty", () => {
    const noon = prefs({ quietHours: { enabled: true, start: "12:00", end: "14:00" } });
    expect(inQuietHours(13 * 60, noon)).toBe(true);
    expect(inQuietHours(14 * 60, noon)).toBe(false);
    expect(inQuietHours(22 * 60, prefs({ quietHours: { enabled: false, start: "21:00", end: "07:00" } }))).toBe(false);
    expect(inQuietHours(22 * 60, prefs({ quietHours: { enabled: true, start: "09:00", end: "09:00" } }))).toBe(false);
  });
});

describe("viewer and preferences", () => {
  it("tells only the owner that credits are low", () => {
    expect(suppressedReason({ type: "credits_low", key: "credits-low:p", daysLeft: 2, createdAt: NOW }, ctx(partner))).toBe(
      "not_for_viewer",
    );
  });

  it.each([
    ["morningBrief", brief("morning", null)],
    ["fridayWrap", brief("friday", 3)],
    [
      "timeToPost",
      { type: "time_to_post", key: "post:p2", postId: "p2", postTitle: "a reel", platform: "TikTok", employeeName: "Naledi", cardScreen: "C-06", createdAt: NOW },
    ],
    ["customerWaiting", { type: "customer_waiting", key: "customer:r2", replyCardId: "r2", customerName: "Aisha", careEmployeeName: "Grace", createdAt: NOW }],
  ] as Array<[keyof NotificationPreferences, NotifyEvent]>)("respects the %s switch", (key, event) => {
    const off = Object.fromEntries([[key, false]]) as Partial<NotificationPreferences>;
    expect(suppressedReason(event, ctx({ preferences: prefs(off) }))).toBe("preference_off");
  });

  it("keeps decisions and problems on whatever the switches say", () => {
    const allOff = prefs({ morningBrief: false, fridayWrap: false, timeToPost: false, customerWaiting: false });
    expect(shown(decision("a9"), ctx({ preferences: allOff })).notification.id).toBe("decision:a9");
    expect(shown(problem(), ctx({ preferences: allOff })).notification.id).toBe(`problem:${SIPHO}`);
  });

  it("makes new notifications silent when sound is off", () => {
    expect(shown(decision("a1"), ctx({ preferences: prefs({ sound: false }) })).silent).toBe(true);
  });

  it("does not notify a reply while Colony is in front, or the brief while Today is", () => {
    const onToday = { windowFocused: true, focus: { screen: "T-01", itemId: null, conversationId: null } };
    expect(suppressedReason(reply(true), ctx(onToday))).toBe("in_front");
    expect(suppressedReason(brief("morning", null), ctx(onToday))).toBe("in_front");
  });
});

describe("text helpers", () => {
  it("joins labels and falls back to a count when too long", () => {
    expect(groupBody(["posts", "a website change", "a reply to Thabo"])).toBe(
      "3 things need you: posts, a website change and a reply to Thabo.",
    );
    expect(groupBody(["x".repeat(100), "y".repeat(100)])).toBe("2 things need you.");
  });

  it("cuts long bodies", () => {
    const cut = truncate("word ".repeat(60));
    expect(cut.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(cut.endsWith("...")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/notifications src/main/notifications/rules.test.ts`
Expected: FAIL with `Failed to resolve import "./preferences"` and `Failed to resolve import "./rules"`.

- [ ] **Step 3: Write the implementation**

In `app/src/bridge/types.ts` (part E), change `NavTarget` to:

```ts
/** A screen pack ID to open, with an optional record and an optional item inside it. */
export type NavTarget = { screen: string; id?: string; subId?: string };
```

Create `app/src/shared/notifications/preferences.ts`:

```ts
/** S-06: what notifies this person and when Colony stays quiet. */
export type NotificationPreferences = {
  morningBrief: boolean;
  fridayWrap: boolean;
  timeToPost: boolean;
  customerWaiting: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  letUrgentThrough: boolean;
  sound: boolean;
};

/** S-06 defaults: everything on, quiet from 21:00 to 07:00, urgent problems still come through. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  morningBrief: true,
  fridayWrap: true,
  timeToPost: true,
  customerWaiting: true,
  quietHours: { enabled: true, start: "21:00", end: "07:00" },
  letUrgentThrough: true,
  sound: true,
};

/** What the person is looking at, reported by the renderer. */
export type FocusReport = { screen: string | null; itemId: string | null; conversationId: string | null };

export const NO_FOCUS: FocusReport = { screen: null, itemId: null, conversationId: null };

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const PREFERENCE_KEYS = ["customerWaiting", "fridayWrap", "letUrgentThrough", "morningBrief", "quietHours", "sound", "timeToPost"];
const QUIET_HOURS_KEYS = ["enabled", "end", "start"];
const FOCUS_KEYS = ["conversationId", "itemId", "screen"];
const MAX_FOCUS_FIELD_CHARS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isClock(value: unknown): boolean {
  return typeof value === "string" && CLOCK.test(value);
}

/** True for a complete, well-formed preferences object with no extra keys. */
export function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (!isRecord(value) || !hasExactKeys(value, PREFERENCE_KEYS)) return false;
  const quiet = value.quietHours;
  if (!isRecord(quiet) || !hasExactKeys(quiet, QUIET_HOURS_KEYS)) return false;
  const switches = [value.morningBrief, value.fridayWrap, value.timeToPost, value.customerWaiting, value.letUrgentThrough, value.sound, quiet.enabled];
  return switches.every((item) => typeof item === "boolean") && isClock(quiet.start) && isClock(quiet.end);
}

/** True for a focus report whose fields are each a short string or null. */
export function isFocusReport(value: unknown): value is FocusReport {
  if (!isRecord(value) || !hasExactKeys(value, FOCUS_KEYS)) return false;
  return [value.screen, value.itemId, value.conversationId].every(
    (field) => field === null || (typeof field === "string" && field.length <= MAX_FOCUS_FIELD_CHARS),
  );
}
```

Create `app/src/main/notifications/types.ts`:

```ts
import type { AppNotification } from "../../bridge/types";
import type { FocusReport, NotificationPreferences } from "../../shared/notifications/preferences";

export type ViewerRole = "owner" | "partner";

/** A decision (ask) that names this person, created at `createdAt`. */
export type DecisionEvent = {
  type: "decision";
  key: string;
  askId: string;
  channelId: string | null;
  /** Short words for a grouped notification ("the spring posts"). */
  label: string;
  /** Scout's sentence for a single notification. */
  body: string;
  ownerOnly: boolean;
  createdAt: number;
};
/** A decision was decided, cancelled or withdrawn anywhere. */
export type DecisionHandledEvent = { type: "decision_handled"; askId: string };
export type EmployeeProblemEvent = {
  type: "employee_problem";
  key: string;
  agentPubkey: string;
  employeeName: string;
  isScout: boolean;
  problem: "start_failed" | "crash_loop";
  createdAt: number;
};
export type TeamStoppedEvent = { type: "team_stopped"; key: string; createdAt: number };
export type TeamPausedEvent = {
  type: "team_paused";
  key: string;
  reason: "credits_out" | "plan_limit" | "plan_disconnected";
  /** "Claude" or "ChatGPT"; empty for credits. */
  planName: string;
  untilSec: number | null;
  createdAt: number;
};
export type TeamResumedEvent = { type: "team_resumed" };
export type CreditsLowEvent = { type: "credits_low"; key: string; daysLeft: number; createdAt: number };
export type BriefEvent = {
  type: "brief";
  key: string;
  briefType: "morning" | "friday";
  doneCount: number | null;
  createdAt: number;
};
export type TimeToPostEvent = {
  type: "time_to_post";
  key: string;
  postId: string;
  postTitle: string;
  platform: string;
  employeeName: string;
  cardScreen: "C-04" | "C-05" | "C-06";
  createdAt: number;
};
export type CustomerWaitingEvent = {
  type: "customer_waiting";
  key: string;
  replyCardId: string;
  customerName: string;
  careEmployeeName: string;
  createdAt: number;
};
export type ReplyToYouEvent = {
  type: "reply_to_you";
  key: string;
  channelId: string;
  messageId: string;
  authorName: string;
  authorIsScout: boolean;
  snippet: string;
  createdAt: number;
};
export type TeamMovedAwayEvent = { type: "team_moved_away"; key: string; newComputerName: string; createdAt: number };

export type NotifyEvent =
  | DecisionEvent
  | DecisionHandledEvent
  | EmployeeProblemEvent
  | TeamStoppedEvent
  | TeamPausedEvent
  | TeamResumedEvent
  | CreditsLowEvent
  | BriefEvent
  | TimeToPostEvent
  | CustomerWaitingEvent
  | ReplyToYouEvent
  | TeamMovedAwayEvent;

/** Events that can show a notification; each has a key that is never shown twice. */
export type KeyedEvent = Exclude<NotifyEvent, DecisionHandledEvent | TeamResumedEvent>;

export type NotifyContext = {
  nowSec: number;
  /** Minutes since midnight on this computer's clock. */
  localMinutes: number;
  localTimeZone: string;
  viewer: { pubkey: string; firstName: string; role: ViewerRole };
  ownerFirstName: string;
  /** Open decisions this person can act on, for the brief's words. */
  openDecisionCount: number;
  windowFocused: boolean;
  focus: FocusReport;
  preferences: NotificationPreferences;
  permission: "granted" | "denied" | "unknown";
  /** Anything created before this existed before Colony last ran: history, never notified. */
  historyBeforeSec: number;
  delivered: ReadonlySet<string>;
};

export type SuppressReason =
  | "history"
  | "duplicate"
  | "no_permission"
  | "not_for_viewer"
  | "preference_off"
  | "quiet_hours"
  | "in_front";

export type NotifyDecision =
  | { action: "show"; key: string; notification: AppNotification; silent: boolean; replaces: string[] }
  | { action: "withdraw"; notificationIds: string[] }
  | { action: "suppress"; key: string; reason: SuppressReason };

export type DecisionGroup = {
  startedAtSec: number;
  notificationId: string;
  members: Array<{ askId: string; label: string }>;
};

export type RulesState = {
  group: DecisionGroup | null;
  /** Which notification currently shows each decision. */
  shownByAsk: Readonly<Record<string, string>>;
  pausedNotificationId: string | null;
};

export const INITIAL_RULES_STATE: RulesState = { group: null, shownByAsk: {}, pausedNotificationId: null };

/** Urgent problems may come through quiet hours (S-06). */
export function isUrgent(event: KeyedEvent): boolean {
  return event.type === "employee_problem" || event.type === "team_stopped" || event.type === "team_paused";
}
```

Create `app/src/main/notifications/rules.ts`:

```ts
import type { AppNotification, NavTarget } from "../../bridge/types";
import type { NotificationPreferences } from "../../shared/notifications/preferences";
import { clockAt } from "../../shared/team/schedule";
import {
  type BriefEvent,
  type DecisionEvent,
  type KeyedEvent,
  type NotifyContext,
  type NotifyDecision,
  type NotifyEvent,
  type RulesState,
  type SuppressReason,
  type TeamPausedEvent,
  isUrgent,
} from "./types";

/** Decisions within this many seconds of the first one become one notification. */
export const GROUP_WINDOW_SECONDS = 60;
/** The longest notification body; longer text is cut. */
export const MAX_BODY_CHARS = 160;

export type RulesResult = { decisions: NotifyDecision[]; state: RulesState };

type OtherEvent = Exclude<KeyedEvent, DecisionEvent>;

/** Decides what one event does to this person's notifications (G-03, S-06). Pure. */
export function decideNotification(event: NotifyEvent, ctx: NotifyContext, state: RulesState): RulesResult {
  if (event.type === "decision_handled") return handleDecisionHandled(event.askId, state);
  if (event.type === "team_resumed") {
    if (state.pausedNotificationId === null) return { decisions: [], state };
    return {
      decisions: [{ action: "withdraw", notificationIds: [state.pausedNotificationId] }],
      state: { ...state, pausedNotificationId: null },
    };
  }
  const reason = suppression(event, ctx, state);
  if (reason !== null) return { decisions: [{ action: "suppress", key: event.key, reason }], state };
  if (event.type === "decision") return showDecision(event, ctx, state);
  const notification = buildNotification(event, ctx);
  return {
    decisions: [{ action: "show", key: event.key, notification, silent: !ctx.preferences.sound, replaces: [] }],
    state: event.type === "team_paused" ? { ...state, pausedNotificationId: notification.id } : state,
  };
}

/** Minutes since midnight for "HH:MM", or null. */
export function minutesOf(clock: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** True inside the quiet hours; a window may cross midnight; an empty window is never quiet. */
export function inQuietHours(localMinutes: number, preferences: NotificationPreferences): boolean {
  const { enabled, start, end } = preferences.quietHours;
  if (!enabled) return false;
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null || from === to) return false;
  return from < to ? localMinutes >= from && localMinutes < to : localMinutes >= from || localMinutes < to;
}

/** "3 things need you: a, b and c.", or just the count when that is too long. */
export function groupBody(labels: string[]): string {
  const joined = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const full = `${labels.length} things need you: ${joined}.`;
  return full.length <= MAX_BODY_CHARS ? full : `${labels.length} things need you.`;
}

/** Cuts text to at most `max` characters, ending in "...". */
export function truncate(text: string, max: number = MAX_BODY_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function suppression(event: KeyedEvent, ctx: NotifyContext, state: RulesState): SuppressReason | null {
  if (event.createdAt < ctx.historyBeforeSec) return "history";
  if (ctx.delivered.has(event.key)) return "duplicate";
  if (event.type === "team_paused" && state.pausedNotificationId !== null) return "duplicate";
  if (ctx.permission === "denied") return "no_permission";
  if (!isForViewer(event, ctx)) return "not_for_viewer";
  if (!isSwitchedOn(event, ctx.preferences)) return "preference_off";
  if (inQuietHours(ctx.localMinutes, ctx.preferences) && !(isUrgent(event) && ctx.preferences.letUrgentThrough)) {
    return "quiet_hours";
  }
  if (isInFront(event, ctx)) return "in_front";
  return null;
}

function isForViewer(event: KeyedEvent, ctx: NotifyContext): boolean {
  if (event.type === "decision") return !event.ownerOnly || ctx.viewer.role === "owner";
  if (event.type === "credits_low") return ctx.viewer.role === "owner";
  return true;
}

function isSwitchedOn(event: KeyedEvent, preferences: NotificationPreferences): boolean {
  switch (event.type) {
    case "brief":
      return event.briefType === "morning" ? preferences.morningBrief : preferences.fridayWrap;
    case "time_to_post":
      return preferences.timeToPost;
    case "customer_waiting":
      return preferences.customerWaiting;
    default:
      return true;
  }
}

function isInFront(event: KeyedEvent, ctx: NotifyContext): boolean {
  if (!ctx.windowFocused) return false;
  if (event.type === "reply_to_you") return true;
  if (event.type === "decision") {
    return ctx.focus.itemId === event.askId || (event.channelId !== null && ctx.focus.conversationId === event.channelId);
  }
  const target = targetFor(event, ctx);
  return ctx.focus.screen === target.screen && (target.id === undefined || ctx.focus.itemId === target.id);
}

function showDecision(event: DecisionEvent, ctx: NotifyContext, state: RulesState): RulesResult {
  const group = state.group;
  if (group !== null && ctx.nowSec - group.startedAtSec < GROUP_WINDOW_SECONDS) {
    const members = [...group.members, { askId: event.askId, label: event.label }];
    const id = `decisions:${group.startedAtSec}`;
    const notification: AppNotification = {
      id,
      title: "Scout",
      body: groupBody(members.map((member) => member.label)),
      target: { screen: "T-05" },
    };
    const shownByAsk: Record<string, string> = { ...state.shownByAsk };
    for (const member of members) shownByAsk[member.askId] = id;
    return {
      decisions: [
        { action: "show", key: event.key, notification, silent: true, replaces: group.notificationId === id ? [] : [group.notificationId] },
      ],
      state: { ...state, group: { startedAtSec: group.startedAtSec, notificationId: id, members }, shownByAsk },
    };
  }
  const id = `decision:${event.askId}`;
  const notification: AppNotification = {
    id,
    title: "Scout",
    body: truncate(event.body),
    target: { screen: "T-05", id: event.askId },
  };
  return {
    decisions: [{ action: "show", key: event.key, notification, silent: !ctx.preferences.sound, replaces: [] }],
    state: {
      ...state,
      group: { startedAtSec: ctx.nowSec, notificationId: id, members: [{ askId: event.askId, label: event.label }] },
      shownByAsk: { ...state.shownByAsk, [event.askId]: id },
    },
  };
}

function handleDecisionHandled(askId: string, state: RulesState): RulesResult {
  const notificationId = state.shownByAsk[askId];
  if (notificationId === undefined) return { decisions: [], state };
  const shownByAsk = Object.fromEntries(Object.entries(state.shownByAsk).filter(([id]) => id !== askId));
  const stillShowing = Object.values(shownByAsk).includes(notificationId);
  let group = state.group;
  if (group !== null && group.notificationId === notificationId) {
    const members = group.members.filter((member) => member.askId !== askId);
    group = members.length === 0 ? null : { ...group, members };
  }
  return {
    decisions: stillShowing ? [] : [{ action: "withdraw", notificationIds: [notificationId] }],
    state: { ...state, shownByAsk, group },
  };
}

function targetFor(event: OtherEvent, ctx: NotifyContext): NavTarget {
  switch (event.type) {
    case "employee_problem":
      return event.isScout ? { screen: "X-09" } : { screen: "C-18", id: event.agentPubkey };
    case "team_stopped":
      return { screen: "X-10" };
    case "team_paused":
      if (ctx.viewer.role !== "owner") return { screen: "T-01" };
      return event.reason === "credits_out" ? { screen: "S-02", id: "buy-credits" } : { screen: "S-03" };
    case "credits_low":
      return { screen: "S-02" };
    case "brief":
      return { screen: "T-01" };
    case "time_to_post":
      return { screen: event.cardScreen, id: event.postId };
    case "customer_waiting":
      return { screen: "C-09", id: event.replyCardId };
    case "reply_to_you":
      return { screen: "T-03", id: event.channelId, subId: event.messageId };
    case "team_moved_away":
      return { screen: "X-13" };
  }
}

function buildNotification(event: OtherEvent, ctx: NotifyContext): AppNotification {
  const target = targetFor(event, ctx);
  switch (event.type) {
    case "employee_problem":
      if (event.isScout) {
        return {
          id: "scout-stopped",
          title: "Colony",
          body: "Scout has stopped, so nobody is running your team. Open Colony to restart Scout.",
          target,
        };
      }
      return {
        id: `problem:${event.agentPubkey}`,
        title: "Scout",
        body: truncate(
          event.problem === "start_failed"
            ? `${event.employeeName} couldn't start. Want me to try again?`
            : `${event.employeeName} has stopped working. Want me to restart them?`,
        ),
        target,
      };
    case "team_stopped":
      return { id: "team-stopped", title: "Colony", body: "Your team has stopped. Open Colony to restart it.", target };
    case "team_paused":
      return { id: "team-paused", title: "Colony", body: truncate(pausedBody(event, ctx)), target };
    case "credits_low":
      return {
        id: "credits-low",
        title: "Colony",
        body: `Credits are running low: about ${event.daysLeft} ${event.daysLeft === 1 ? "day" : "days"} left.`,
        target,
      };
    case "brief":
      return { id: event.key, title: "Scout", body: truncate(briefBody(event, ctx)), target };
    case "time_to_post":
      return {
        id: `post:${event.postId}`,
        title: "Scout",
        body: truncate(`Time to post ${event.employeeName}'s ${event.postTitle} on ${event.platform}.`),
        target,
      };
    case "customer_waiting":
      return {
        id: `customer:${event.replyCardId}`,
        title: "Scout",
        body: truncate(`${event.customerName} has waited a day for a reply. ${event.careEmployeeName}'s draft is ready.`),
        target,
      };
    case "reply_to_you":
      return {
        id: `reply:${event.messageId}`,
        title: "Scout",
        body: truncate(event.authorIsScout ? event.snippet : `${event.authorName}: ${event.snippet}`),
        target,
      };
    case "team_moved_away":
      return { id: "team-moved", title: "Colony", body: truncate(`Your team now runs on ${event.newComputerName}.`), target };
  }
}

function pausedBody(event: TeamPausedEvent, ctx: NotifyContext): string {
  const owner = ctx.ownerFirstName;
  const isOwner = ctx.viewer.role === "owner";
  if (event.reason === "credits_out") {
    return isOwner
      ? "Your team is paused: credits ran out. Buy credits to carry on."
      : `Your team is paused: credits ran out. ${owner} can top up.`;
  }
  const plan = event.planName ? `${event.planName} plan` : "plan";
  const whose = isOwner ? `your ${plan}` : `${owner}'s ${plan}`;
  if (event.reason === "plan_limit") {
    return event.untilSec === null
      ? `Your team is paused: ${whose} reached its limit.`
      : `Your team is paused until ${clockAt(event.untilSec, ctx.localTimeZone)}: ${whose} reached its limit.`;
  }
  return isOwner
    ? `Your team can't reach ${whose}. Sign in again to carry on.`
    : `Your team can't reach ${whose}. ${owner} needs to sign in again.`;
}

function briefBody(event: BriefEvent, ctx: NotifyContext): string {
  const count = ctx.openDecisionCount;
  if (event.briefType === "morning") {
    const needs = count === 0 ? "Nothing needs you today." : `${count} ${count === 1 ? "thing needs" : "things need"} you today.`;
    return `Morning, ${ctx.viewer.firstName}. ${needs}`;
  }
  const needs = count === 0 ? "nothing needs you" : `${count} ${count === 1 ? "needs" : "need"} you`;
  return event.doneCount === null
    ? `Friday wrap is ready, ${needs}.`
    : `Friday wrap: ${event.doneCount} ${event.doneCount === 1 ? "thing" : "things"} done this week, ${needs}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C app exec vitest run src/shared/notifications src/main/notifications/rules.test.ts`
Expected: PASS (preferences: 8 tests; rules: 19 G-03 cases plus 27 rule tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/bridge/types.ts app/src/shared/notifications app/src/main/notifications/types.ts app/src/main/notifications/rules.ts app/src/main/notifications/rules.test.ts
git commit -s -m "feat(app): decide computer notifications with the G-03 rules"
```

---

### Task 8.8: Producers: relay records and host events to notification events

**Files:**
- Create: `app/src/main/notifications/producers.ts`
- Test: `app/src/main/notifications/producers.test.ts`

**Interfaces:**
- Consumes: `EmployeeProblem`, `EmployeeRuntimeStatus` (`app/src/bridge/types.ts`); `parseAskHead`, `parseBriefHead`, `parseTeamComputerHead`, `TeamComputerRecord` (Task 8.3); event types (Task 8.7).
- Produces:
  - `type EmployeeDirectory = ReadonlyMap<string, { name: string; isScout: boolean }>`
  - `shortLabel(title: string): string`, `snippetOf(content: string): string`
  - `eventFromAskHead(event: NostrEvent, viewerPubkey: string): NotifyEvent | null` (decision, or decision handled)
  - `eventFromBriefHead(event: NostrEvent): NotifyEvent | null`
  - `eventFromMessage(event: NostrEvent, viewerPubkey: string, employees: EmployeeDirectory): NotifyEvent | null` (reply to you)
  - `eventFromTeamComputerHead(event: NostrEvent, previous: TeamComputerRecord | null, thisComputerId: string): { record: TeamComputerRecord | null; notify: NotifyEvent | null }`
  - `eventFromHostProblem(problem: EmployeeProblem, employees: EmployeeDirectory, nowSec: number): NotifyEvent | null` (part E reports the whole engine stopping as a problem with `agentPubkey: null`: the team stopped, X-10)
  - `resumedFromStatus(status: EmployeeRuntimeStatus): NotifyEvent | null`
  - `pausedFromStatus(status: EmployeeRuntimeStatus, nowSec: number): NotifyEvent | null` (part I's `pauseReason`: credits or plan limit pauses the team; a person's pause does not notify)
  - `teamStoppedEvent(nowSec: number): NotifyEvent`

A decision notifies this person when the ask is open, the relay named this person in a `p` tag (part F), and the ask is not addressed to someone else. Asks addressed to an employee (for example to Scout) never notify people.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/notifications/producers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { EmployeeProblem, EmployeeRuntimeStatus } from "../../bridge/types";
import { KIND_ASK_HEAD, KIND_BRIEF_HEAD, KIND_MESSAGE, KIND_TEAM_COMPUTER_HEAD } from "../../shared/team/kinds";
import { KAGISO, LERATO, NALEDI, SCOUT, SIPHO, makeEvent } from "../../shared/team/testEvents";
import {
  type EmployeeDirectory,
  eventFromAskHead,
  eventFromBriefHead,
  eventFromHostProblem,
  eventFromMessage,
  eventFromTeamComputerHead,
  pausedFromStatus,
  resumedFromStatus,
  shortLabel,
  snippetOf,
  teamStoppedEvent,
} from "./producers";

const ASK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TITLE = "Naledi's posts for next week are ready for your OK.";
const CREATED = "2026-10-13T06:00:00Z";
const directory: EmployeeDirectory = new Map([
  [SCOUT, { name: "Scout", isScout: true }],
  [NALEDI, { name: "Naledi", isScout: false }],
]);

function askEvent(status: string, tags: string[][], askOverrides: Record<string, unknown> = {}) {
  return makeEvent(
    KIND_ASK_HEAD,
    {
      schemaVersion: 1,
      askId: ASK_ID,
      status,
      askerPubkey: SCOUT,
      createdAt: CREATED,
      ask: { schemaVersion: 1, askId: ASK_ID, type: "approval", category: "general", title: TITLE, ...askOverrides },
      sourceActionEventId: "c".repeat(64),
    },
    [["h", "conv-1"], ...tags],
  );
}

describe("eventFromAskHead", () => {
  it("turns an open decision naming this person into a decision event", () => {
    expect(eventFromAskHead(askEvent("open", [["p", LERATO], ["p", KAGISO]]), LERATO)).toEqual({
      type: "decision",
      key: `decision:${ASK_ID}`,
      askId: ASK_ID,
      channelId: "conv-1",
      label: shortLabel(TITLE),
      body: TITLE,
      ownerOnly: false,
      createdAt: Date.parse(CREATED) / 1000,
    });
  });

  it("marks owner-only decisions", () => {
    const event = eventFromAskHead(askEvent("open", [["p", LERATO], ["colony:owner-only", "1"]]), LERATO);
    expect(event).toMatchObject({ type: "decision", ownerOnly: true });
  });

  it("reports a decided or cancelled ask as handled", () => {
    expect(eventFromAskHead(askEvent("resolved", [["p", LERATO]]), LERATO)).toEqual({ type: "decision_handled", askId: ASK_ID });
    expect(eventFromAskHead(askEvent("cancelled", []), LERATO)).toEqual({ type: "decision_handled", askId: ASK_ID });
  });

  it("ignores asks that do not name this person or are addressed to someone else", () => {
    expect(eventFromAskHead(askEvent("open", [["p", KAGISO]]), LERATO)).toBeNull();
    expect(eventFromAskHead(askEvent("open", [["p", LERATO]], { addresseePubkey: SCOUT }), LERATO)).toBeNull();
    expect(eventFromAskHead(askEvent("open", [["p", LERATO]], { addresseePubkey: LERATO }), LERATO)).toMatchObject({ type: "decision" });
    expect(eventFromAskHead(makeEvent(KIND_ASK_HEAD, "not json"), LERATO)).toBeNull();
  });
});

describe("eventFromBriefHead", () => {
  it("uses the brief's d tag as its key and its writing time", () => {
    const event = makeEvent(
      KIND_BRIEF_HEAD,
      { type: "friday", text: "Good week.", links: [], writtenAt: 1_760_630_400, doneCount: 14 },
      [["d", "brief:2026-10-16:friday"]],
      1_760_630_405,
      SCOUT,
    );
    expect(eventFromBriefHead(event)).toEqual({
      type: "brief",
      key: "brief:2026-10-16:friday",
      briefType: "friday",
      doneCount: 14,
      createdAt: 1_760_630_400,
    });
  });
});

describe("eventFromMessage", () => {
  const message = (author: string, tags: string[][], content = "Done.\nThe price list is in Spring launch.") =>
    makeEvent(KIND_MESSAGE, content, tags, 1_760_340_000, author);

  it("notifies a person an employee replied to", () => {
    const event = message(NALEDI, [["h", "conv-1"], ["p", LERATO]]);
    expect(eventFromMessage(event, LERATO, directory)).toEqual({
      type: "reply_to_you",
      key: `reply:${event.id}`,
      channelId: "conv-1",
      messageId: event.id,
      authorName: "Naledi",
      authorIsScout: false,
      snippet: "Done.",
      createdAt: 1_760_340_000,
    });
  });

  it("ignores people's messages, messages not naming this person and messages outside a conversation", () => {
    expect(eventFromMessage(message(KAGISO, [["h", "conv-1"], ["p", LERATO]]), LERATO, directory)).toBeNull();
    expect(eventFromMessage(message(SCOUT, [["h", "conv-1"], ["p", KAGISO]]), LERATO, directory)).toBeNull();
    expect(eventFromMessage(message(SCOUT, [["p", LERATO]]), LERATO, directory)).toBeNull();
  });
});

describe("eventFromTeamComputerHead", () => {
  const head = (computerId: string, computerName: string, lastSeenAt: number) =>
    makeEvent(
      KIND_TEAM_COMPUTER_HEAD,
      { computerId, computerName, claimedBy: LERATO, claimedAt: 1_760_000_000, lastSeenAt },
      [["d", "team-computer"]],
    );

  it("notifies only when the team leaves this computer", () => {
    const first = eventFromTeamComputerHead(head("this", "Lerato's MacBook Air", 1), null, "this");
    expect(first.notify).toBeNull();
    const heartbeat = eventFromTeamComputerHead(head("this", "Lerato's MacBook Air", 2), first.record, "this");
    expect(heartbeat.notify).toBeNull();
    const moved = eventFromTeamComputerHead(head("other", "Kagiso's laptop", 3), heartbeat.record, "this");
    expect(moved.notify).toEqual({
      type: "team_moved_away",
      key: "moved:other:1760000000",
      newComputerName: "Kagiso's laptop",
      createdAt: 1_760_000_000,
    });
    expect(eventFromTeamComputerHead(head("other", "Kagiso's laptop", 4), moved.record, "this").notify).toBeNull();
  });

  it("keeps the previous record when an event cannot be read", () => {
    const previous = eventFromTeamComputerHead(head("this", "Lerato's MacBook Air", 1), null, "this").record;
    expect(eventFromTeamComputerHead(makeEvent(KIND_TEAM_COMPUTER_HEAD, "bad", [["d", "team-computer"]]), previous, "this")).toEqual({
      record: previous,
      notify: null,
    });
  });
});

describe("host events", () => {
  const problem = (agentPubkey: string, kind: EmployeeProblem["kind"]): EmployeeProblem => ({ agentPubkey, kind, detail: "plain words" });

  it("turns a crash loop or failed start into an employee problem, and Scout's into Scout stopped", () => {
    expect(eventFromHostProblem(problem(NALEDI.toUpperCase(), "crash_loop"), directory, 100)).toEqual({
      type: "employee_problem",
      key: `problem:${NALEDI}:crash_loop:100`,
      agentPubkey: NALEDI,
      employeeName: "Naledi",
      isScout: false,
      problem: "crash_loop",
      createdAt: 100,
    });
    expect(eventFromHostProblem(problem(SCOUT, "start_failed"), directory, 100)).toMatchObject({ isScout: true, problem: "start_failed" });
    expect(eventFromHostProblem(problem(SIPHO, "crash_loop"), directory, 100)).toMatchObject({ employeeName: "An employee" });
  });

  it("ignores a single crash (the host restarts it) and pauses the team when credits run out", () => {
    expect(eventFromHostProblem(problem(NALEDI, "crashed"), directory, 100)).toBeNull();
    expect(eventFromHostProblem(problem(NALEDI, "credits_out"), directory, 100)).toEqual({
      type: "team_paused",
      key: "paused:credits_out:100",
      reason: "credits_out",
      planName: "",
      untilSec: null,
      createdAt: 100,
    });
  });

  it("reports a running employee as resumed and a stopped engine as the team stopping", () => {
    expect(resumedFromStatus({ agentPubkey: NALEDI, name: "Naledi", state: "running", since: 1, restartsInWindow: 0 })).toEqual({
      type: "team_resumed",
    });
    expect(resumedFromStatus({ agentPubkey: NALEDI, name: "Naledi", state: "paused", since: 1, restartsInWindow: 0 })).toBeNull();
    expect(teamStoppedEvent(100)).toEqual({ type: "team_stopped", key: "team-stopped:100", createdAt: 100 });
    expect(eventFromHostProblem({ agentPubkey: null, kind: "crashed", detail: "Colony's engine stopped." }, directory, 100)).toEqual({
      type: "team_stopped",
      key: "team-stopped:100",
      createdAt: 100,
    });
  });

  it("pauses the team when the host reports a credits or plan-limit pause, not a person's pause", () => {
    const status = (pauseReason: "person" | "credits" | "plan_limit"): EmployeeRuntimeStatus => ({
      agentPubkey: NALEDI,
      name: "Naledi",
      state: "paused",
      since: 1,
      restartsInWindow: 0,
      pauseReason,
    });
    expect(pausedFromStatus(status("credits"), 100)).toMatchObject({ type: "team_paused", reason: "credits_out", key: "paused:credits_out:100" });
    expect(pausedFromStatus(status("plan_limit"), 100)).toMatchObject({ type: "team_paused", reason: "plan_limit", planName: "" });
    expect(pausedFromStatus(status("person"), 100)).toBeNull();
    expect(pausedFromStatus({ ...status("credits"), state: "running" }, 100)).toBeNull();
  });
});

describe("words", () => {
  it("shortens labels at a word and keeps the first line of a message", () => {
    expect(shortLabel(TITLE)).toBe("Naledi's posts for next week are ready...");
    expect(shortLabel("Hire Leo?")).toBe("Hire Leo");
    expect(snippetOf("\n  Done.  \nMore")).toBe("Done.");
    expect(snippetOf("x".repeat(130))).toBe(`${"x".repeat(117)}...`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/main/notifications/producers.test.ts`
Expected: FAIL with `Failed to resolve import "./producers"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/notifications/producers.ts`:

```ts
import type { EmployeeProblem, EmployeeRuntimeStatus } from "../../bridge/types";
import { KIND_MESSAGE } from "../../shared/team/kinds";
import { type NostrEvent, normalizePubkey, singleTag, tagValues } from "../../shared/team/nostr";
import { type TeamComputerRecord, parseAskHead, parseBriefHead, parseTeamComputerHead } from "../../shared/team/records";
import type { NotifyEvent } from "./types";

/** Employees by lowercase pubkey, from the latest team status. */
export type EmployeeDirectory = ReadonlyMap<string, { name: string; isScout: boolean }>;

const LABEL_CHARS = 40;
const SNIPPET_CHARS = 120;

/** A few words for a grouped notification, cut at a word boundary. */
export function shortLabel(title: string): string {
  const trimmed = title.trim().replace(/[.?!]+$/, "");
  if (trimmed.length <= LABEL_CHARS) return trimmed;
  const cut = trimmed.slice(0, LABEL_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > LABEL_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** The first non-empty line of a message, at most 120 characters. */
export function snippetOf(content: string): string {
  const line = content
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  return line.length <= SNIPPET_CHARS ? line : `${line.slice(0, SNIPPET_CHARS - 3).trimEnd()}...`;
}

/** A decision for this person, or a handled decision, from an ask head. */
export function eventFromAskHead(event: NostrEvent, viewerPubkey: string): NotifyEvent | null {
  const ask = parseAskHead(event);
  if (!ask) return null;
  if (ask.status !== "open") return { type: "decision_handled", askId: ask.askId };
  if (!ask.people.includes(viewerPubkey)) return null;
  if (ask.addresseePubkey !== null && ask.addresseePubkey !== viewerPubkey) return null;
  return {
    type: "decision",
    key: `decision:${ask.askId}`,
    askId: ask.askId,
    channelId: ask.channelId,
    label: shortLabel(ask.title),
    body: ask.title,
    ownerOnly: ask.ownerOnly,
    createdAt: ask.createdAt,
  };
}

/** A morning brief or Friday wrap. */
export function eventFromBriefHead(event: NostrEvent): NotifyEvent | null {
  const brief = parseBriefHead(event);
  if (!brief) return null;
  return { type: "brief", key: brief.dTag, briefType: brief.type, doneCount: brief.doneCount, createdAt: brief.writtenAt };
}

/** A reply from Scout or an employee that names this person. */
export function eventFromMessage(event: NostrEvent, viewerPubkey: string, employees: EmployeeDirectory): NotifyEvent | null {
  if (event.kind !== KIND_MESSAGE) return null;
  const author = employees.get(event.pubkey.toLowerCase());
  const channelId = singleTag(event, "h");
  if (!author || channelId === null) return null;
  if (!tagValues(event, "p").some((value) => normalizePubkey(value) === viewerPubkey)) return null;
  return {
    type: "reply_to_you",
    key: `reply:${event.id}`,
    channelId,
    messageId: event.id,
    authorName: author.name,
    authorIsScout: author.isScout,
    snippet: snippetOf(event.content),
    createdAt: event.created_at,
  };
}

/** Tracks the team computer record and reports when the team leaves this computer. */
export function eventFromTeamComputerHead(
  event: NostrEvent,
  previous: TeamComputerRecord | null,
  thisComputerId: string,
): { record: TeamComputerRecord | null; notify: NotifyEvent | null } {
  const record = parseTeamComputerHead(event);
  if (!record) return { record: previous, notify: null };
  const movedAway = previous !== null && previous.computerId === thisComputerId && record.computerId !== thisComputerId;
  return {
    record,
    notify: movedAway
      ? {
          type: "team_moved_away",
          key: `moved:${record.computerId}:${record.claimedAt}`,
          newComputerName: record.computerName,
          createdAt: record.claimedAt,
        }
      : null,
  };
}

/** Employee problems, credits running out and the engine stopping, from `team://problem` (part E). */
export function eventFromHostProblem(problem: EmployeeProblem, employees: EmployeeDirectory, nowSec: number): NotifyEvent | null {
  if (problem.agentPubkey === null) return teamStoppedEvent(nowSec);
  const pubkey = problem.agentPubkey.toLowerCase();
  const employee = employees.get(pubkey);
  switch (problem.kind) {
    case "start_failed":
    case "crash_loop":
      return {
        type: "employee_problem",
        key: `problem:${pubkey}:${problem.kind}:${nowSec}`,
        agentPubkey: pubkey,
        employeeName: employee?.name ?? "An employee",
        isScout: employee?.isScout ?? false,
        problem: problem.kind,
        createdAt: nowSec,
      };
    case "credits_out":
      return {
        type: "team_paused",
        key: `paused:credits_out:${nowSec}`,
        reason: "credits_out",
        planName: "",
        untilSec: null,
        createdAt: nowSec,
      };
    case "crashed":
      return null;
  }
}

/** A running employee means a paused team has resumed. */
export function resumedFromStatus(status: EmployeeRuntimeStatus): NotifyEvent | null {
  return status.state === "running" ? { type: "team_resumed" } : null;
}

/** A pause the host reports for credits or a plan limit pauses the team (part I's `pauseReason`). */
export function pausedFromStatus(status: EmployeeRuntimeStatus, nowSec: number): NotifyEvent | null {
  if (status.state !== "paused") return null;
  if (status.pauseReason === "credits") {
    return { type: "team_paused", key: `paused:credits_out:${nowSec}`, reason: "credits_out", planName: "", untilSec: null, createdAt: nowSec };
  }
  if (status.pauseReason === "plan_limit") {
    return { type: "team_paused", key: `paused:plan_limit:${nowSec}`, reason: "plan_limit", planName: "", untilSec: null, createdAt: nowSec };
  }
  return null;
}

/** The whole engine stopped: the team stopped (X-10). */
export function teamStoppedEvent(nowSec: number): NotifyEvent {
  return { type: "team_stopped", key: `team-stopped:${nowSec}`, createdAt: nowSec };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/main/notifications/producers.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/notifications/producers.ts app/src/main/notifications/producers.test.ts
git commit -s -m "feat(app): turn relay records and host events into notification events"
```

---

### Task 8.9: Notification store and service

**Files:**
- Create: `app/src/main/notifications/store.ts`, `app/src/main/notifications/service.ts`
- Test: `app/src/main/notifications/store.test.ts`, `app/src/main/notifications/service.test.ts`

**Interfaces:**
- Consumes: `decideNotification` (Task 8.7); `NotificationPreferences`, `DEFAULT_NOTIFICATION_PREFERENCES`, `isNotificationPreferences`, `FocusReport`, `NO_FOCUS` (Task 8.7); `AppNotification` (part E's `app/src/bridge/types.ts`).
- Produces:
  - `store.ts`: `MAX_DELIVERED_KEYS = 2000`, `DELIVERED_MAX_AGE_SECONDS = 1_209_600`, `type DeliveredEntry = { key: string; atSec: number }`, `type StoredNotificationState = { version: 1; watermarkSec: number | null; delivered: DeliveredEntry[]; preferences: Record<string, NotificationPreferences> }`, `emptyNotificationState()`, `interface NotificationStore { load(); save(state) }`, `pruneDelivered(entries, nowSec)`, `parseStoredState(raw)`, `createFileNotificationStore(filePath)`
  - `service.ts`: `WATERMARK_TICK_MS = 60_000`, `MAX_TRACKED_SHOWING = 200`, `type NotificationDisplay = { show(notification: AppNotification, silent: boolean): void; close(id: string): void }`, `type NotificationSession`, `type NotificationServiceDeps`, `type NotificationService = { start(); stop(); ingest(event); reportFocus(focus); getPreferences(); setPreferences(preferences); sendTest() }`, `createNotificationService(deps)`

How "no repeats" works: on start, the service reads the last time Colony ran here (`watermarkSec`) and treats anything created before it as history for this whole run; every minute and on stop it records the current time for the next run. Every shown or suppressed key is stored, so a restart never shows the same thing twice. A first run with no stored state treats everything that already exists as history. All work runs one event at a time, in arrival order.

The service shows and closes notifications by id through part E's notifier (`createNotifier` in `app/electron/notifications.mjs`), which replaces a notification with the same id and opens its target when the person clicks it.

- [ ] **Step 1: Write the failing tests**

Create `app/src/main/notifications/store.test.ts`:

```ts
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notifications/preferences";
import { KAGISO, LERATO } from "../../shared/team/testEvents";
import {
  DELIVERED_MAX_AGE_SECONDS,
  MAX_DELIVERED_KEYS,
  createFileNotificationStore,
  emptyNotificationState,
  parseStoredState,
  pruneDelivered,
} from "./store";

describe("pruneDelivered", () => {
  it("drops keys older than 14 days and keeps the newest 2,000", () => {
    const now = 2_000_000_000;
    const old = { key: "old", atSec: now - DELIVERED_MAX_AGE_SECONDS - 1 };
    const many = Array.from({ length: MAX_DELIVERED_KEYS + 5 }, (_, index) => ({ key: `k${index}`, atSec: now - index }));
    const pruned = pruneDelivered([old, ...many], now);
    expect(pruned).toHaveLength(MAX_DELIVERED_KEYS);
    expect(pruned[0]?.key).toBe("k0");
    expect(pruned.some((entry) => entry.key === "old")).toBe(false);
  });
});

describe("parseStoredState", () => {
  it("falls back to an empty state for anything malformed", () => {
    for (const raw of ["not json", "null", "[]", "{\"version\":2}"]) {
      expect(parseStoredState(raw)).toEqual(emptyNotificationState());
    }
  });

  it("keeps valid entries and preferences and drops invalid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      watermarkSec: 5,
      delivered: [{ key: "a", atSec: 4 }, { key: 3 }],
      preferences: { [LERATO]: DEFAULT_NOTIFICATION_PREFERENCES, [KAGISO]: { sound: "yes" } },
    });
    expect(parseStoredState(raw)).toEqual({
      version: 1,
      watermarkSec: 5,
      delivered: [{ key: "a", atSec: 4 }],
      preferences: { [LERATO]: DEFAULT_NOTIFICATION_PREFERENCES },
    });
  });
});

describe("createFileNotificationStore", () => {
  it("returns an empty state before the first save, then reads back what it wrote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "colony-notifications-"));
    const store = createFileNotificationStore(join(dir, "nested", "state.json"));
    await expect(store.load()).resolves.toEqual(emptyNotificationState());
    const state = { version: 1 as const, watermarkSec: 10, delivered: [{ key: "a", atSec: 9 }], preferences: {} };
    await store.save(state);
    await expect(store.load()).resolves.toEqual(state);
    await expect(readdir(join(dir, "nested"))).resolves.toEqual(["state.json"]);
  });
});
```

Create `app/src/main/notifications/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { NavTarget } from "../../bridge/types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notifications/preferences";
import { LERATO, manualTimers } from "../../shared/team/testEvents";
import {
  type NotificationDisplay,
  type NotificationSession,
  WATERMARK_TICK_MS,
  createNotificationService,
} from "./service";
import { type NotificationStore, type StoredNotificationState, emptyNotificationState } from "./store";
import type { DecisionEvent, NotifyEvent } from "./types";

const NOW = 1_760_340_000;
const OWNER: NotificationSession = { viewer: { pubkey: LERATO, firstName: "Lerato", role: "owner" }, ownerFirstName: "Lerato" };
const RAN_TEN_MINUTES_AGO: StoredNotificationState = { ...emptyNotificationState(), watermarkSec: NOW - 600 };

type Shown = { id: string; title: string; body: string; target: NavTarget; silent: boolean; closed: boolean };

function harness(options: { stored?: StoredNotificationState; session?: NotificationSession | null } = {}) {
  let state = structuredClone(options.stored ?? emptyNotificationState());
  const store: NotificationStore = {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next);
    },
  };
  const shown: Shown[] = [];
  const close = (id: string): void => {
    for (const entry of shown) if (entry.id === id) entry.closed = true;
  };
  // Behaves like part E's notifier: showing an id that is on screen replaces it.
  const display: NotificationDisplay = {
    show: (notification, silent) => {
      close(notification.id);
      shown.push({ ...notification, silent, closed: false });
    },
    close,
  };
  const timers = manualTimers();
  const clock = { now: NOW, minutes: 10 * 60 };
  const service = createNotificationService({
    store,
    display,
    permission: () => "granted",
    isWindowFocused: () => false,
    nowSec: () => clock.now,
    localMinutes: () => clock.minutes,
    localTimeZone: () => "Africa/Johannesburg",
    session: () => (options.session === undefined ? OWNER : options.session),
    openDecisionCount: () => 1,
    setTimer: timers.setTimer,
    log: () => {},
  });
  return { service, shown, timers, clock, stored: () => state };
}

function decision(askId: string, createdAt: number): DecisionEvent {
  return {
    type: "decision",
    key: `decision:${askId}`,
    askId,
    channelId: "conv-1",
    label: `the ${askId} card`,
    body: `Naledi's ${askId} is ready for your OK.`,
    ownerOnly: false,
    createdAt,
  };
}

const handled = (askId: string): NotifyEvent => ({ type: "decision_handled", askId });

describe("createNotificationService", () => {
  it("shows nothing for decisions that existed before the very first run", async () => {
    const { service, shown, stored } = harness();
    await service.start();
    await service.ingest(decision("a1", NOW - 10));
    expect(shown).toHaveLength(0);
    expect(stored().delivered.map((entry) => entry.key)).toEqual(["decision:a1"]);
  });

  it("after a restart, shows a decision created while Colony was closed exactly once", async () => {
    const first = harness({ stored: RAN_TEN_MINUTES_AGO });
    await first.service.start();
    await first.service.ingest(decision("a1", NOW - 300));
    await first.service.ingest(decision("a1", NOW - 300));
    expect(first.shown.map((entry) => [entry.id, entry.body, entry.target])).toEqual([
      ["decision:a1", "Naledi's a1 is ready for your OK.", { screen: "T-05", id: "a1" }],
    ]);
    await first.service.stop();
    const second = harness({ stored: first.stored() });
    await second.service.start();
    await second.service.ingest(decision("a1", NOW - 300));
    expect(second.shown).toHaveLength(0);
  });

  it("never shows a quiet-hours decision later", async () => {
    const { service, shown, clock } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    clock.minutes = 22 * 60;
    await service.ingest(decision("a1", NOW));
    clock.minutes = 10 * 60;
    await service.ingest(decision("a1", NOW));
    expect(shown).toHaveLength(0);
  });

  it("replaces a single decision with a quiet group and withdraws it when all are handled", async () => {
    const { service, shown, clock } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    await service.ingest(decision("a1", NOW));
    clock.now = NOW + 10;
    await service.ingest(decision("a2", NOW + 10));
    expect(shown.map((entry) => [entry.id, entry.body, entry.silent, entry.closed])).toEqual([
      ["decision:a1", "Naledi's a1 is ready for your OK.", false, true],
      [`decisions:${NOW}`, "2 things need you: the a1 card and the a2 card.", true, false],
    ]);
    await service.ingest(handled("a1"));
    expect(shown[1]?.closed).toBe(false);
    await service.ingest(handled("a2"));
    expect(shown[1]?.closed).toBe(true);
  });

  it("shows notifications without sound when sound is off", async () => {
    const { service, shown } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    await service.setPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, sound: false });
    await service.ingest(decision("a1", NOW));
    expect(shown.map((entry) => [entry.id, entry.silent])).toEqual([["decision:a1", true]]);
  });

  it("shows nothing while signed out", async () => {
    const { service, shown } = harness({ session: null, stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    await service.ingest(decision("a1", NOW));
    expect(shown).toHaveLength(0);
  });

  it("keeps preferences per person and applies them", async () => {
    const { service, shown, stored } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    await service.setPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, morningBrief: false });
    expect(service.getPreferences().morningBrief).toBe(false);
    expect(stored().preferences[LERATO]?.morningBrief).toBe(false);
    await service.ingest({ type: "brief", key: "brief:2026-10-13:morning", briefType: "morning", doneCount: null, createdAt: NOW });
    expect(shown).toHaveLength(0);
  });

  it("processes events in arrival order even when not awaited", async () => {
    const { service, shown } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    await Promise.all([service.ingest(decision("a1", NOW)), service.ingest(decision("a2", NOW))]);
    expect(shown.map((entry) => entry.body)).toEqual([
      "Naledi's a1 is ready for your OK.",
      "2 things need you: the a1 card and the a2 card.",
    ]);
  });

  it("records the last run time every minute and on stop, and closes what it showed", async () => {
    const { service, shown, timers, clock, stored } = harness({ stored: RAN_TEN_MINUTES_AGO });
    await service.start();
    expect(stored().watermarkSec).toBe(NOW);
    await service.ingest(decision("a1", NOW));
    clock.now = NOW + 60;
    timers.fire(WATERMARK_TICK_MS);
    await service.ingest(handled("unknown"));
    expect(stored().watermarkSec).toBe(NOW + 60);
    clock.now = NOW + 90;
    await service.stop();
    expect(stored().watermarkSec).toBe(NOW + 90);
    expect(shown[0]?.closed).toBe(true);
    expect(timers.count()).toBe(0);
  });

  it("sends a test notification on request", async () => {
    const { service, shown } = harness();
    await service.start();
    await service.sendTest();
    expect(shown.map((entry) => [entry.id, entry.title, entry.body, entry.target])).toEqual([
      ["test", "Colony", "This is a test. Notifications are working.", { screen: "S-06" }],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C app exec vitest run src/main/notifications/store.test.ts src/main/notifications/service.test.ts`
Expected: FAIL with `Failed to resolve import "./store"` and `Failed to resolve import "./service"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/notifications/store.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { type NotificationPreferences, isNotificationPreferences } from "../../shared/notifications/preferences";

export const MAX_DELIVERED_KEYS = 2000;
export const DELIVERED_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export type DeliveredEntry = { key: string; atSec: number };

/** What the notification service keeps on this computer. */
export type StoredNotificationState = {
  version: 1;
  /** The last time Colony was running here; null before the first run. */
  watermarkSec: number | null;
  delivered: DeliveredEntry[];
  /** Preferences per person, by pubkey (S-06 is per person). */
  preferences: Record<string, NotificationPreferences>;
};

export interface NotificationStore {
  load(): Promise<StoredNotificationState>;
  save(state: StoredNotificationState): Promise<void>;
}

/** A fresh state: first-run behaviour, nothing delivered, default preferences. */
export function emptyNotificationState(): StoredNotificationState {
  return { version: 1, watermarkSec: null, delivered: [], preferences: {} };
}

/** Keeps the newest keys: at most 2,000 and none older than 14 days. */
export function pruneDelivered(entries: readonly DeliveredEntry[], nowSec: number): DeliveredEntry[] {
  return entries
    .filter((entry) => nowSec - entry.atSec <= DELIVERED_MAX_AGE_SECONDS)
    .sort((left, right) => right.atSec - left.atSec)
    .slice(0, MAX_DELIVERED_KEYS);
}

function isDeliveredEntry(value: unknown): value is DeliveredEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.key === "string" && typeof entry.atSec === "number" && Number.isFinite(entry.atSec);
}

/** Reads stored state; anything malformed becomes an empty state (no backlog is shown). */
export function parseStoredState(raw: string): StoredNotificationState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyNotificationState();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyNotificationState();
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return emptyNotificationState();
  const watermarkSec =
    typeof record.watermarkSec === "number" && Number.isFinite(record.watermarkSec) ? record.watermarkSec : null;
  const delivered = Array.isArray(record.delivered) ? record.delivered.filter(isDeliveredEntry) : [];
  const preferences: Record<string, NotificationPreferences> = {};
  if (typeof record.preferences === "object" && record.preferences !== null) {
    for (const [pubkey, candidate] of Object.entries(record.preferences as Record<string, unknown>)) {
      if (isNotificationPreferences(candidate)) preferences[pubkey] = candidate;
    }
  }
  return { version: 1, watermarkSec, delivered, preferences };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

/** A store in one JSON file, written atomically (temporary file, then rename). */
export function createFileNotificationStore(filePath: string): NotificationStore {
  return {
    async load() {
      try {
        return parseStoredState(await readFile(filePath, "utf8"));
      } catch (error) {
        if (isMissingFile(error)) return emptyNotificationState();
        throw error;
      }
    },
    async save(state) {
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(state), "utf8");
      await rename(temporary, filePath);
    },
  };
}
```

Create `app/src/main/notifications/service.ts`:

```ts
import type { AppNotification } from "../../bridge/types";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type FocusReport,
  NO_FOCUS,
  type NotificationPreferences,
} from "../../shared/notifications/preferences";
import { decideNotification } from "./rules";
import { type NotificationStore, type StoredNotificationState, pruneDelivered } from "./store";
import { INITIAL_RULES_STATE, type NotifyContext, type NotifyEvent, type RulesState, type ViewerRole } from "./types";

/** How often the service records "Colony was running here" for the next run. */
export const WATERMARK_TICK_MS = 60_000;
/** How many shown notification ids the service remembers, so stop can close them. */
export const MAX_TRACKED_SHOWING = 200;

/**
 * Shows and closes computer notifications by id. In the app this is part E's
 * notifier (`app/electron/notifications.mjs`): the same id replaces an older
 * notification, and a click opens the notification's target.
 */
export type NotificationDisplay = {
  show(notification: AppNotification, silent: boolean): void;
  close(id: string): void;
};

/** The person notifications are for. */
export type NotificationSession = {
  viewer: { pubkey: string; firstName: string; role: ViewerRole };
  ownerFirstName: string;
};

export type NotificationServiceDeps = {
  store: NotificationStore;
  display: NotificationDisplay;
  permission(): "granted" | "denied" | "unknown";
  isWindowFocused(): boolean;
  nowSec(): number;
  localMinutes(): number;
  localTimeZone(): string;
  /** The signed-in person; null when signed out (no notifications). */
  session(): NotificationSession | null;
  openDecisionCount(): number;
  setTimer(callback: () => void, ms: number): () => void;
  log(message: string): void;
};

export type NotificationService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  ingest(event: NotifyEvent): Promise<void>;
  reportFocus(focus: FocusReport): void;
  getPreferences(): NotificationPreferences;
  setPreferences(preferences: NotificationPreferences): Promise<void>;
  sendTest(): Promise<void>;
};

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  let stored: StoredNotificationState | null = null;
  let historyBeforeSec = 0;
  let rules: RulesState = INITIAL_RULES_STATE;
  let focus: FocusReport = NO_FOCUS;
  let cancelTick: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();
  const showing = new Set<string>();

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queue.then(task);
    queue = run.catch((error: unknown) => deps.log(`notification task failed: ${String(error)}`));
    return run;
  }

  function close(id: string): void {
    showing.delete(id);
    deps.display.close(id);
  }

  function show(notification: AppNotification, silent: boolean, replaces: string[]): void {
    for (const id of replaces) close(id);
    deps.display.show(notification, silent);
    showing.delete(notification.id);
    showing.add(notification.id);
    for (const id of showing) {
      if (showing.size <= MAX_TRACKED_SHOWING) break;
      showing.delete(id);
    }
  }

  function remember(state: StoredNotificationState, key: string, nowSec: number): StoredNotificationState {
    if (state.delivered.some((entry) => entry.key === key)) return state;
    return { ...state, delivered: pruneDelivered([...state.delivered, { key, atSec: nowSec }], nowSec) };
  }

  function preferencesFor(state: StoredNotificationState | null, pubkey: string | null): NotificationPreferences {
    if (state === null || pubkey === null) return DEFAULT_NOTIFICATION_PREFERENCES;
    return state.preferences[pubkey] ?? DEFAULT_NOTIFICATION_PREFERENCES;
  }

  function tick(): void {
    void enqueue(async () => {
      const current = stored;
      if (current === null) return;
      stored = { ...current, watermarkSec: deps.nowSec() };
      await deps.store.save(stored);
    });
    cancelTick = deps.setTimer(tick, WATERMARK_TICK_MS);
  }

  return {
    start() {
      return enqueue(async () => {
        const loaded = await deps.store.load();
        const now = deps.nowSec();
        historyBeforeSec = loaded.watermarkSec ?? now;
        stored = { ...loaded, watermarkSec: now, delivered: pruneDelivered(loaded.delivered, now) };
        await deps.store.save(stored);
        cancelTick?.();
        cancelTick = deps.setTimer(tick, WATERMARK_TICK_MS);
      });
    },

    stop() {
      cancelTick?.();
      cancelTick = null;
      return enqueue(async () => {
        for (const id of [...showing]) close(id);
        rules = INITIAL_RULES_STATE;
        focus = NO_FOCUS;
        const current = stored;
        stored = null;
        if (current !== null) await deps.store.save({ ...current, watermarkSec: deps.nowSec() });
      });
    },

    ingest(event) {
      return enqueue(async () => {
        const session = deps.session();
        const current = stored;
        if (current === null || session === null) return;
        const nowSec = deps.nowSec();
        const ctx: NotifyContext = {
          nowSec,
          localMinutes: deps.localMinutes(),
          localTimeZone: deps.localTimeZone(),
          viewer: session.viewer,
          ownerFirstName: session.ownerFirstName,
          openDecisionCount: deps.openDecisionCount(),
          windowFocused: deps.isWindowFocused(),
          focus,
          preferences: preferencesFor(current, session.viewer.pubkey),
          permission: deps.permission(),
          historyBeforeSec,
          delivered: new Set(current.delivered.map((entry) => entry.key)),
        };
        const result = decideNotification(event, ctx, rules);
        rules = result.state;
        let next = current;
        for (const decision of result.decisions) {
          if (decision.action === "show") {
            show(decision.notification, decision.silent, decision.replaces);
            next = remember(next, decision.key, nowSec);
          } else if (decision.action === "withdraw") {
            for (const id of decision.notificationIds) close(id);
          } else {
            next = remember(next, decision.key, nowSec);
          }
        }
        if (next !== current) {
          stored = next;
          await deps.store.save(next);
        }
      });
    },

    reportFocus(next) {
      focus = next;
    },

    getPreferences() {
      return preferencesFor(stored, deps.session()?.viewer.pubkey ?? null);
    },

    setPreferences(preferences) {
      return enqueue(async () => {
        const current = stored;
        const session = deps.session();
        if (current === null || session === null) throw new Error("notifications are not running");
        stored = { ...current, preferences: { ...current.preferences, [session.viewer.pubkey]: preferences } };
        await deps.store.save(stored);
      });
    },

    sendTest() {
      return enqueue(async () => {
        if (stored === null) throw new Error("notifications are not running");
        const silent = !preferencesFor(stored, deps.session()?.viewer.pubkey ?? null).sound;
        show(
          { id: "test", title: "Colony", body: "This is a test. Notifications are working.", target: { screen: "S-06" } },
          silent,
          [],
        );
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C app exec vitest run src/main/notifications/store.test.ts src/main/notifications/service.test.ts`
Expected: PASS (store: 4 tests; service: 10 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/notifications/store.ts app/src/main/notifications/store.test.ts app/src/main/notifications/service.ts app/src/main/notifications/service.test.ts
git commit -s -m "feat(app): show, group and withdraw notifications without repeats"
```

---

### Task 8.10: Checked host payloads

**Files:**
- Create: `app/src/main/team/hostPayloads.ts`
- Test: `app/src/main/team/hostPayloads.test.ts`

**Interfaces:**
- Consumes: `EmployeeRuntimeStatus` (with part I's `pauseReason`, exported by part E), `EmployeeProblem` (part E: `agentPubkey: string | null`, null when the whole engine stopped), `TeamComputerStatus` (`app/src/bridge/types.ts`).
- Produces: `toRuntimeStatus(value: unknown): EmployeeRuntimeStatus | null`, `toRuntimeStatusList(value: unknown): EmployeeRuntimeStatus[]` (throws on any bad entry), `toEmployeeProblem(value: unknown): EmployeeProblem | null`, `toTeamComputerStatus(value: unknown): TeamComputerStatus` (throws on a bad answer).

Host data crosses a process boundary, and part E's main forwards `team://problem` payloads unchecked, so this part checks every host answer and event before using it. A malformed event is dropped; a malformed answer fails the read that asked for it.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/team/hostPayloads.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { NALEDI } from "../../shared/team/testEvents";
import { toEmployeeProblem, toRuntimeStatus, toRuntimeStatusList, toTeamComputerStatus } from "./hostPayloads";

const running = { agentPubkey: NALEDI, name: "Naledi", state: "running", since: 1, restartsInWindow: 0 };

describe("host payloads", () => {
  it("accepts a runtime status and keeps only a known pause reason", () => {
    expect(toRuntimeStatus({ ...running, state: "paused", pauseReason: "credits" })).toEqual({
      ...running,
      state: "paused",
      pauseReason: "credits",
    });
    expect(toRuntimeStatus({ ...running, pauseReason: null })).toEqual(running);
    expect(toRuntimeStatus({ ...running, pauseReason: "nap" })).toEqual(running);
    expect(toRuntimeStatus({ ...running, state: "dancing" })).toBeNull();
    expect(toRuntimeStatus({ agent_pubkey: NALEDI })).toBeNull();
  });

  it("fails a whole status list that has one bad entry", () => {
    expect(toRuntimeStatusList([running])).toEqual([running]);
    expect(() => toRuntimeStatusList([running, { agentPubkey: NALEDI }])).toThrow("unexpected shape");
    expect(() => toRuntimeStatusList({ statuses: [] })).toThrow("unexpected shape");
  });

  it("accepts a stopped engine as a problem with no employee", () => {
    expect(toEmployeeProblem({ agentPubkey: null, kind: "crashed", detail: "Colony's engine stopped." })).toEqual({
      agentPubkey: null,
      kind: "crashed",
      detail: "Colony's engine stopped.",
    });
    expect(toEmployeeProblem({ agentPubkey: NALEDI, kind: "crash_loop", detail: "Stopped five times." })).toMatchObject({
      kind: "crash_loop",
    });
    expect(toEmployeeProblem({ agentPubkey: NALEDI, kind: "exploded", detail: "" })).toBeNull();
    expect(toEmployeeProblem({ agentPubkey: 7, kind: "crashed", detail: "" })).toBeNull();
  });

  it("checks the team computer answer", () => {
    expect(toTeamComputerStatus({ thisComputerId: "this", holder: null, isThisComputer: false })).toEqual({
      thisComputerId: "this",
      holder: null,
      isThisComputer: false,
    });
    const holder = { computerId: "other", computerName: "Kagiso's laptop", lastSeenAt: 5 };
    expect(toTeamComputerStatus({ thisComputerId: "this", holder, isThisComputer: false }).holder).toEqual(holder);
    expect(() =>
      toTeamComputerStatus({ thisComputerId: "this", holder: { computerId: 1 }, isThisComputer: false }),
    ).toThrow("unexpected shape");
    expect(() => toTeamComputerStatus([])).toThrow("unexpected shape");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/main/team/hostPayloads.test.ts`
Expected: FAIL with `Failed to resolve import "./hostPayloads"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/team/hostPayloads.ts`:

```ts
import type { EmployeeProblem, EmployeeRuntimeStatus, TeamComputerStatus } from "../../bridge/types";

const RUNTIME_STATES: readonly string[] = ["starting", "running", "paused", "stopped", "failing", "away"];
const PAUSE_REASONS: readonly string[] = ["person", "credits", "plan_limit"];
const PROBLEM_KINDS: readonly string[] = ["start_failed", "crashed", "crash_loop", "credits_out"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A checked runtime status (`team_status`, `team://status`); an unknown or null pause reason is left out. */
export function toRuntimeStatus(value: unknown): EmployeeRuntimeStatus | null {
  if (!isRecord(value)) return null;
  const { agentPubkey, name, state, since, restartsInWindow, pauseReason } = value;
  if (
    typeof agentPubkey !== "string" ||
    typeof name !== "string" ||
    typeof state !== "string" ||
    !RUNTIME_STATES.includes(state) ||
    typeof since !== "number" ||
    typeof restartsInWindow !== "number"
  ) {
    return null;
  }
  const status: EmployeeRuntimeStatus = {
    agentPubkey,
    name,
    state: state as EmployeeRuntimeStatus["state"],
    since,
    restartsInWindow,
  };
  if (typeof pauseReason === "string" && PAUSE_REASONS.includes(pauseReason)) {
    status.pauseReason = pauseReason as NonNullable<EmployeeRuntimeStatus["pauseReason"]>;
  }
  return status;
}

/** Every status from `team_status`; one entry with an unexpected shape fails the whole answer. */
export function toRuntimeStatusList(value: unknown): EmployeeRuntimeStatus[] {
  if (!Array.isArray(value)) throw new Error("team_status returned an unexpected shape");
  const statuses: EmployeeRuntimeStatus[] = [];
  for (const item of value) {
    const status = toRuntimeStatus(item);
    if (status === null) throw new Error("team_status returned an unexpected shape");
    statuses.push(status);
  }
  return statuses;
}

/** A checked `team://problem`; `agentPubkey` null means the whole engine stopped (part E). */
export function toEmployeeProblem(value: unknown): EmployeeProblem | null {
  if (!isRecord(value)) return null;
  const { agentPubkey, kind, detail } = value;
  if (agentPubkey !== null && typeof agentPubkey !== "string") return null;
  if (typeof kind !== "string" || !PROBLEM_KINDS.includes(kind) || typeof detail !== "string") return null;
  return { agentPubkey, kind: kind as EmployeeProblem["kind"], detail };
}

/** A checked answer from `team_claim_status`. */
export function toTeamComputerStatus(value: unknown): TeamComputerStatus {
  const unexpected = (): Error => new Error("team_claim_status returned an unexpected shape");
  if (!isRecord(value)) throw unexpected();
  const { thisComputerId, isThisComputer, holder } = value;
  if (typeof thisComputerId !== "string" || typeof isThisComputer !== "boolean") throw unexpected();
  if (holder === null) return { thisComputerId, holder: null, isThisComputer };
  if (!isRecord(holder)) throw unexpected();
  const { computerId, computerName, lastSeenAt } = holder;
  if (typeof computerId !== "string" || typeof computerName !== "string" || typeof lastSeenAt !== "number") {
    throw unexpected();
  }
  return { thisComputerId, holder: { computerId, computerName, lastSeenAt }, isThisComputer };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/main/team/hostPayloads.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/team/hostPayloads.ts app/src/main/team/hostPayloads.test.ts
git commit -s -m "feat(app): check host team answers and events before use"
```

---

### Task 8.11: A relay feed for the main process

**Files:**
- Create: `app/src/main/team/mainRelayFeed.ts`
- Test: `app/src/main/team/mainRelayFeed.test.ts`

**Interfaces:**
- Consumes: `RelayFeed`, `Unsubscribe` (Task 8.6); the shape of part E's `RelayConnection` (`app/src/relay/relayConnection.ts`: `connect()`, `subscribe(filters, { onEvent, onEose?, onClosed? }) => () => void`, `close()`; a dropped socket ends every subscription with `onClosed("connection closed")`, and a later `connect()` opens a new socket).
- Produces: `QUERY_TIMEOUT_MS = 15_000`, `MAX_QUERY_EVENTS = 10_000`, `RESUBSCRIBE_FIRST_MS = 2_000`, `RESUBSCRIBE_MAX_MS = 60_000`, `RECONNECT_NOTICE_MS = 1_000`, `type SubscriptionHandlers`, `type RelayConnectionLike`, `type MainRelayFeed = RelayFeed & { onReconnect(relayUrl, listener): Unsubscribe; close(): void }`, `createMainRelayFeed({ open, setTimer, log }): MainRelayFeed`.

Part E keeps the renderer's relay socket in the renderer. Main needs its own reads for team status and notifications, so it keeps one more socket per company, built from part E's `RelayConnection` class (Task 8.14 bundles it into main) and signed in through the host. This adapter turns that class into the `RelayFeed` of Task 8.6: a query is a subscription that ends at "end of stored events" or after 15 seconds; a live view comes back after a drop with a growing wait (2 s doubling to 60 s), and reconnect listeners hear about it once.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/team/mainRelayFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { NostrEvent, NostrFilter } from "../../shared/team/nostr";
import { makeEvent, manualTimers } from "../../shared/team/testEvents";
import {
  QUERY_TIMEOUT_MS,
  RECONNECT_NOTICE_MS,
  RESUBSCRIBE_FIRST_MS,
  type RelayConnectionLike,
  type SubscriptionHandlers,
  createMainRelayFeed,
} from "./mainRelayFeed";

const settle = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Behaves like part E's RelayConnection: a dropped socket ends every subscription. */
class FakeConnection implements RelayConnectionLike {
  connects = 0;
  readonly subscriptions = new Map<number, { filters: NostrFilter[]; handlers: SubscriptionHandlers }>();
  private next = 0;

  async connect(): Promise<void> {
    this.connects += 1;
  }

  subscribe(filters: NostrFilter[], handlers: SubscriptionHandlers): () => void {
    this.next += 1;
    const id = this.next;
    this.subscriptions.set(id, { filters, handlers });
    return () => {
      this.subscriptions.delete(id);
    };
  }

  close(): void {
    this.end("closed by Colony");
  }

  end(reason: string): void {
    const entries = [...this.subscriptions.values()];
    this.subscriptions.clear();
    for (const entry of entries) entry.handlers.onClosed?.(reason);
  }

  deliver(event: NostrEvent): void {
    for (const entry of [...this.subscriptions.values()]) entry.handlers.onEvent(event);
  }

  endOfStored(): void {
    for (const entry of [...this.subscriptions.values()]) entry.handlers.onEose?.();
  }
}

function harness() {
  const connection = new FakeConnection();
  const timers = manualTimers();
  const feed = createMainRelayFeed({ open: () => connection, setTimer: timers.setTimer, log: () => {} });
  return { connection, timers, feed };
}

describe("createMainRelayFeed", () => {
  it("answers a query with the stored events and ends the request", async () => {
    const { connection, timers, feed } = harness();
    const answer = feed.query("wss://a", [{ kinds: [9] }]);
    await settle();
    connection.deliver(makeEvent(9, "hello"));
    connection.endOfStored();
    await expect(answer).resolves.toHaveLength(1);
    expect(connection.subscriptions.size).toBe(0);
    expect(timers.count()).toBe(0);
  });

  it("fails a query that gets no answer in time or that the relay refuses", async () => {
    const { connection, timers, feed } = harness();
    const slow = feed.query("wss://a", [{ kinds: [9] }]);
    await settle();
    timers.fire(QUERY_TIMEOUT_MS);
    await expect(slow).rejects.toThrow("did not answer in time");
    expect(connection.subscriptions.size).toBe(0);
    const refused = feed.query("wss://a", [{ kinds: [9] }]);
    await settle();
    connection.end("restricted: not a member");
    await expect(refused).rejects.toThrow("restricted: not a member");
  });

  it("brings a live view back after the connection drops and tells reconnect listeners once", async () => {
    const { connection, timers, feed } = harness();
    const received: string[] = [];
    let reconnects = 0;
    feed.onReconnect("wss://a", () => {
      reconnects += 1;
    });
    const stop = feed.subscribe("wss://a", [{ kinds: [9] }], (event) => received.push(event.content));
    await settle();
    connection.deliver(makeEvent(9, "one"));
    connection.end("connection closed");
    timers.fire(RESUBSCRIBE_FIRST_MS);
    await settle();
    expect(connection.connects).toBe(2);
    expect(connection.subscriptions.size).toBe(1);
    timers.fire(RECONNECT_NOTICE_MS);
    expect(reconnects).toBe(1);
    connection.deliver(makeEvent(9, "two"));
    expect(received).toEqual(["one", "two"]);
    stop();
    expect(connection.subscriptions.size).toBe(0);
  });

  it("stops retrying a view that was closed, and refuses work once the feed is closed", async () => {
    const { connection, timers, feed } = harness();
    const stop = feed.subscribe("wss://a", [{ kinds: [9] }], () => {});
    await settle();
    connection.end("connection closed");
    stop();
    timers.fire(RESUBSCRIBE_FIRST_MS);
    await settle();
    expect(connection.subscriptions.size).toBe(0);
    feed.subscribe("wss://a", [{ kinds: [9] }], () => {});
    await settle();
    feed.close();
    await settle();
    expect(connection.subscriptions.size).toBe(0);
    expect(timers.count()).toBe(0);
    expect(() => feed.subscribe("wss://a", [{ kinds: [9] }], () => {})).toThrow("closed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/main/team/mainRelayFeed.test.ts`
Expected: FAIL with `Failed to resolve import "./mainRelayFeed"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/team/mainRelayFeed.ts`:

```ts
import type { NostrEvent, NostrFilter } from "../../shared/team/nostr";
import type { RelayFeed, Unsubscribe } from "./relayFeed";

/** A query that gets no "end of stored events" within this time fails. */
export const QUERY_TIMEOUT_MS = 15_000;
/** At most this many events are kept for one query. */
export const MAX_QUERY_EVENTS = 10_000;
/** First wait before a closed live view is opened again; it doubles up to the maximum. */
export const RESUBSCRIBE_FIRST_MS = 2_000;
export const RESUBSCRIBE_MAX_MS = 60_000;
/** Reconnect listeners run once, this long after live views come back. */
export const RECONNECT_NOTICE_MS = 1_000;

export type SubscriptionHandlers = {
  onEvent: (event: NostrEvent) => void;
  onEose?: () => void;
  onClosed?: (reason: string) => void;
};

/** What this feed uses of part E's `RelayConnection` (`app/src/relay/relayConnection.ts`). */
export type RelayConnectionLike = {
  connect(): Promise<void>;
  subscribe(filters: NostrFilter[], handlers: SubscriptionHandlers): () => void;
  close(): void;
};

/** The relay access of Task 8.6, plus reconnect news and shutdown. */
export type MainRelayFeed = RelayFeed & {
  /** Runs `listener` once after live views on this relay came back from a drop. */
  onReconnect(relayUrl: string, listener: () => void): Unsubscribe;
  /** Closes every connection; the feed refuses work afterwards. */
  close(): void;
};

export type MainRelayFeedDeps = {
  open(relayUrl: string): RelayConnectionLike;
  setTimer(callback: () => void, ms: number): () => void;
  log(message: string): void;
};

type Link = {
  connection: RelayConnectionLike;
  ready: Promise<void> | null;
  listeners: Set<() => void>;
  cancelNotice: (() => void) | null;
};

/** One connection per relay address, opened on first use and kept for the life of the feed. */
export function createMainRelayFeed(deps: MainRelayFeedDeps): MainRelayFeed {
  const links = new Map<string, Link>();
  let closed = false;

  function linkFor(relayUrl: string): Link {
    if (closed) throw new Error("the relay feed is closed");
    let link = links.get(relayUrl);
    if (!link) {
      link = { connection: deps.open(relayUrl), ready: null, listeners: new Set(), cancelNotice: null };
      links.set(relayUrl, link);
    }
    return link;
  }

  /** Connects, or confirms the socket is open; after a drop, `connect()` opens a new socket. */
  function ready(link: Link): Promise<void> {
    if (link.ready) return link.ready;
    const attempt = link.connection.connect();
    link.ready = attempt;
    attempt.catch(() => {
      if (link.ready === attempt) link.ready = null;
    });
    return attempt;
  }

  function noticeReconnect(link: Link): void {
    if (link.cancelNotice) return;
    link.cancelNotice = deps.setTimer(() => {
      link.cancelNotice = null;
      for (const listener of [...link.listeners]) listener();
    }, RECONNECT_NOTICE_MS);
  }

  return {
    async query(relayUrl, filters) {
      const link = linkFor(relayUrl);
      await ready(link);
      return new Promise<NostrEvent[]>((resolve, reject) => {
        const events: NostrEvent[] = [];
        let done = false;
        let stop: (() => void) | null = null;
        let cancelTimeout: (() => void) | null = null;
        const finish = (error: Error | null): void => {
          if (done) return;
          done = true;
          cancelTimeout?.();
          stop?.();
          if (error) reject(error);
          else resolve(events);
        };
        stop = link.connection.subscribe(filters, {
          onEvent: (event) => {
            if (events.length < MAX_QUERY_EVENTS) events.push(event);
          },
          onEose: () => finish(null),
          onClosed: (reason) => {
            stop = null;
            link.ready = null;
            finish(new Error(`the relay ended the request: ${reason}`));
          },
        });
        if (!done) cancelTimeout = deps.setTimer(() => finish(new Error("the relay did not answer in time")), QUERY_TIMEOUT_MS);
      });
    },

    subscribe(relayUrl, filters, onEvent) {
      const link = linkFor(relayUrl);
      let active = true;
      let stop: (() => void) | null = null;
      let cancelRetry: (() => void) | null = null;
      let retryMs = RESUBSCRIBE_FIRST_MS;
      let cameBack = false;

      const retry = (): void => {
        if (!active || closed || cancelRetry) return;
        const delay = retryMs;
        retryMs = Math.min(retryMs * 2, RESUBSCRIBE_MAX_MS);
        cancelRetry = deps.setTimer(() => {
          cancelRetry = null;
          start();
        }, delay);
      };

      const start = (): void => {
        if (!active || closed) return;
        ready(link).then(
          () => {
            if (!active || closed) return;
            try {
              stop = link.connection.subscribe(filters, {
                onEvent,
                onEose: () => {
                  retryMs = RESUBSCRIBE_FIRST_MS;
                },
                onClosed: (reason) => {
                  stop = null;
                  link.ready = null;
                  if (!active) return;
                  deps.log(`a live view on ${relayUrl} closed: ${reason}`);
                  cameBack = true;
                  retry();
                },
              });
            } catch (error) {
              deps.log(`a live view on ${relayUrl} could not start: ${String(error)}`);
              retry();
              return;
            }
            if (cameBack) {
              cameBack = false;
              noticeReconnect(link);
            }
          },
          (error: unknown) => {
            deps.log(`connecting to ${relayUrl} failed: ${String(error)}`);
            cameBack = true;
            retry();
          },
        );
      };

      start();
      return () => {
        active = false;
        cancelRetry?.();
        cancelRetry = null;
        stop?.();
        stop = null;
      };
    },

    onReconnect(relayUrl, listener) {
      const link = linkFor(relayUrl);
      link.listeners.add(listener);
      return () => {
        link.listeners.delete(listener);
      };
    },

    close() {
      closed = true;
      for (const link of links.values()) {
        link.cancelNotice?.();
        link.cancelNotice = null;
        link.connection.close();
      }
      links.clear();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/main/team/mainRelayFeed.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/team/mainRelayFeed.ts app/src/main/team/mainRelayFeed.test.ts
git commit -s -m "feat(app): main-process relay feed with queries, live views and reconnect"
```

---

### Task 8.12: Bridge handlers and the notification context

**Files:**
- Create: `app/src/shared/notifications/context.ts`, `app/src/main/notifications/bridgeHandlers.ts`
- Test: `app/src/main/notifications/bridgeHandlers.test.ts`

**Interfaces:**
- Consumes: `isNotificationPreferences`, `isFocusReport`, `NotificationPreferences`, `FocusReport` (Task 8.7); `EmployeeStatusView` (Task 8.5); part E's router rule that every bridge method has exactly one handler (`createBridgeRouter` in `app/electron/bridge-router.mjs`) and that a thrown `BridgeError(code, message)` reaches the renderer as `{ code, message }`.
- Produces:
  - `context.ts`: `type NotificationContext = { relayUrl: string; viewerFirstName: string; role: "owner" | "partner"; ownerFirstName: string }`, `isRelayUrl(value): value is string`, `isNotificationContext(value): value is NotificationContext`
  - `bridgeHandlers.ts`: `TEAM_AND_NOTIFICATION_METHODS` (6 method names), `type TeamAndNotificationMethod`, `type TeamAndNotificationsApi`, `type BridgeErrorFactory = (code: string, message: string) => Error`, `createTeamAndNotificationHandlers(api, bridgeError): Record<TeamAndNotificationMethod, (...args: unknown[]) => Promise<unknown>>`

The renderer reports who is using Colony and for which company (`notifications.setContext`), because only the renderer knows the company in front and the first names. Main adds the signed-in pubkey from part E's session service itself, so the renderer cannot choose whose decisions it hears about.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/notifications/bridgeHandlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notifications/preferences";
import { TEAM_AND_NOTIFICATION_METHODS, createTeamAndNotificationHandlers } from "./bridgeHandlers";

const CONTEXT = {
  relayUrl: "wss://lerato.colony.global",
  viewerFirstName: "Lerato",
  role: "owner",
  ownerFirstName: "Lerato",
};
const bridgeError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

function fakeApi(running = true) {
  return {
    overview: vi.fn(async () => []),
    setContext: vi.fn(async () => {}),
    isRunning: vi.fn(() => running),
    getPreferences: vi.fn(() => DEFAULT_NOTIFICATION_PREFERENCES),
    setPreferences: vi.fn(async () => {}),
    reportFocus: vi.fn(),
    sendTest: vi.fn(async () => {}),
  };
}

describe("createTeamAndNotificationHandlers", () => {
  it("passes valid calls on", async () => {
    const api = fakeApi();
    const handlers = createTeamAndNotificationHandlers(api, bridgeError);
    await expect(handlers["team.overview"]("wss://lerato.colony.global")).resolves.toEqual([]);
    await handlers["notifications.setContext"](CONTEXT);
    await handlers["notifications.setContext"](null);
    await expect(handlers["notifications.getPreferences"]()).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    await handlers["notifications.setPreferences"](DEFAULT_NOTIFICATION_PREFERENCES);
    await handlers["notifications.reportFocus"]({ screen: "T-03", itemId: null, conversationId: "conv-1" });
    await handlers["notifications.sendTest"]();
    expect(api.overview).toHaveBeenCalledWith("wss://lerato.colony.global");
    expect(api.setContext.mock.calls).toEqual([[CONTEXT], [null]]);
    expect(api.setPreferences).toHaveBeenCalledWith(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(api.reportFocus).toHaveBeenCalledWith({ screen: "T-03", itemId: null, conversationId: "conv-1" });
    expect(api.sendTest).toHaveBeenCalled();
  });

  it("refuses malformed input with plain words", async () => {
    const handlers = createTeamAndNotificationHandlers(fakeApi(), bridgeError);
    const refused = { code: "invalid_input" };
    await expect(handlers["team.overview"]("https://lerato.colony.global")).rejects.toThrow("That request was not valid.");
    await expect(handlers["team.overview"]("ws://example.com")).rejects.toMatchObject(refused);
    await expect(handlers["team.overview"]("wss://lerato.colony.global/path")).rejects.toMatchObject(refused);
    await expect(handlers["notifications.setContext"]({ ...CONTEXT, role: "admin" })).rejects.toMatchObject(refused);
    await expect(handlers["notifications.setContext"]({ ...CONTEXT, viewerFirstName: " " })).rejects.toMatchObject(refused);
    await expect(handlers["notifications.setContext"]({ ...CONTEXT, extra: 1 })).rejects.toMatchObject(refused);
    await expect(handlers["notifications.setPreferences"]({ sound: "loud" })).rejects.toMatchObject(refused);
    await expect(handlers["notifications.reportFocus"]({ screen: 1 })).rejects.toMatchObject(refused);
  });

  it("says when notifications are not ready, and lists exactly its methods", async () => {
    const handlers = createTeamAndNotificationHandlers(fakeApi(false), bridgeError);
    const notReady = { code: "notifications_not_ready" };
    await expect(handlers["notifications.setPreferences"](DEFAULT_NOTIFICATION_PREFERENCES)).rejects.toMatchObject(notReady);
    await expect(handlers["notifications.sendTest"]()).rejects.toThrow("Notifications aren't ready yet. Try again in a moment.");
    expect(Object.keys(handlers)).toEqual([...TEAM_AND_NOTIFICATION_METHODS]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/main/notifications/bridgeHandlers.test.ts`
Expected: FAIL with `Failed to resolve import "./bridgeHandlers"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/shared/notifications/context.ts`:

```ts
/** Who is using Colony on this computer and for which company; the renderer reports it. */
export type NotificationContext = {
  relayUrl: string;
  viewerFirstName: string;
  role: "owner" | "partner";
  ownerFirstName: string;
};

const CONTEXT_KEYS = ["ownerFirstName", "relayUrl", "role", "viewerFirstName"];
const MAX_NAME_CHARS = 80;
const MAX_RELAY_URL_CHARS = 300;
/** A company address: wss anywhere, plain ws only on this computer, no path (part E's `assertRelayUrl` rule). */
const RELAY_URL = /^(wss:\/\/[A-Za-z0-9.-]+(:\d{1,5})?|ws:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFirstName(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_CHARS;
}

/** True for `wss://host[:port]`, or `ws://` on this computer. */
export function isRelayUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_RELAY_URL_CHARS && RELAY_URL.test(value);
}

/** True for a complete context with no extra keys. */
export function isNotificationContext(value: unknown): value is NotificationContext {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== CONTEXT_KEYS.length || keys.some((key, index) => key !== CONTEXT_KEYS[index])) return false;
  return (
    isRelayUrl(value.relayUrl) &&
    isFirstName(value.viewerFirstName) &&
    isFirstName(value.ownerFirstName) &&
    (value.role === "owner" || value.role === "partner")
  );
}
```

Create `app/src/main/notifications/bridgeHandlers.ts`:

```ts
import { type NotificationContext, isNotificationContext, isRelayUrl } from "../../shared/notifications/context";
import {
  type FocusReport,
  type NotificationPreferences,
  isFocusReport,
  isNotificationPreferences,
} from "../../shared/notifications/preferences";
import type { EmployeeStatusView } from "../../shared/team/teamStatus";

/** The bridge methods this part adds. `app/electron/bridge-contract.mjs` lists the same names (Task 8.15). */
export const TEAM_AND_NOTIFICATION_METHODS = [
  "team.overview",
  "notifications.setContext",
  "notifications.getPreferences",
  "notifications.setPreferences",
  "notifications.reportFocus",
  "notifications.sendTest",
] as const;

export type TeamAndNotificationMethod = (typeof TEAM_AND_NOTIFICATION_METHODS)[number];

/** What the handlers call; the engine of Task 8.13 provides it. */
export type TeamAndNotificationsApi = {
  overview(relayUrl: string): Promise<EmployeeStatusView[]>;
  setContext(context: NotificationContext | null): Promise<void>;
  isRunning(): boolean;
  getPreferences(): NotificationPreferences;
  setPreferences(preferences: NotificationPreferences): Promise<void>;
  reportFocus(focus: FocusReport): void;
  sendTest(): Promise<void>;
};

/** Builds part E's `BridgeError(code, message)`, so the renderer gets plain words. */
export type BridgeErrorFactory = (code: string, message: string) => Error;

/** Handlers for part E's bridge router; every argument is checked before it is used. */
export function createTeamAndNotificationHandlers(
  api: TeamAndNotificationsApi,
  bridgeError: BridgeErrorFactory,
): Record<TeamAndNotificationMethod, (...args: unknown[]) => Promise<unknown>> {
  const invalid = (): Error => bridgeError("invalid_input", "That request was not valid.");
  const notReady = (): Error =>
    bridgeError("notifications_not_ready", "Notifications aren't ready yet. Try again in a moment.");
  return {
    "team.overview": async (relayUrl) => {
      if (!isRelayUrl(relayUrl)) throw invalid();
      return api.overview(relayUrl);
    },
    "notifications.setContext": async (context) => {
      if (context !== null && !isNotificationContext(context)) throw invalid();
      await api.setContext(context);
    },
    "notifications.getPreferences": async () => api.getPreferences(),
    "notifications.setPreferences": async (preferences) => {
      if (!isNotificationPreferences(preferences)) throw invalid();
      if (!api.isRunning()) throw notReady();
      await api.setPreferences(preferences);
    },
    "notifications.reportFocus": async (focus) => {
      if (!isFocusReport(focus)) throw invalid();
      api.reportFocus(focus);
    },
    "notifications.sendTest": async () => {
      if (!api.isRunning()) throw notReady();
      await api.sendTest();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/main/notifications/bridgeHandlers.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/shared/notifications/context.ts app/src/main/notifications/bridgeHandlers.ts app/src/main/notifications/bridgeHandlers.test.ts
git commit -s -m "feat(app): bridge handlers for team status and notification settings"
```

---

### Task 8.13: The team status and notification engine

**Files:**
- Create: `app/src/main/teamAndNotifications.ts`
- Test: `app/src/main/teamAndNotifications.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 8.3 to 8.12; `EmployeeProblem`, `EmployeeRuntimeStatus` (`app/src/bridge/types.ts`).
- Produces:
  - `TEAM_OVERVIEW_TOPIC = "team.overview"` (payload `{ relayUrl, views }`), `NOTIFICATION_BACKLOG_SECONDS = 259_200`, `INBOX_POLL_MS = 60_000`, `LIVE_OVERLAP_SECONDS = 120`, `RETRY_FIRST_MS = 30_000`, `RETRY_MAX_MS = 300_000`
  - `type TeamAndNotificationsDeps` (below)
  - `type TeamAndNotifications = TeamAndNotificationsApi & { hostStatus(status: unknown): void; hostProblem(problem: unknown): void; stop(): Promise<void> }`
  - `createTeamAndNotifications(deps): TeamAndNotifications`

Where decisions come from (agreed with part F): Needs you is part F's decision inbox, exactly `{ kinds: [30643], authors: [<relay>], "#p": [<me>] }` (Task 6.4 recognizes only that shape, plus a limit), served to owners and admins with no live push. The engine reads it when a company is set, on every relay reconnect and every 60 seconds. Decisions and replies in conversations this person belongs to arrive live; the conversations come from the kind 39002 membership lists, which the relay signs with its own key (`crates/buzz-relay/src/nip11.rs:151`) and which `colony channels` already reads with `#p` (`crates/buzz-cli/src/commands/channels.rs:38-42`); the live view starts 120 seconds before the read that opened it, so nothing falls between the two (AGENTS.md rule 2), and the delivered keys of Task 8.9 absorb the overlap. Briefs and the team computer record have their own live view. Host status and problems arrive from part E's main as pushes (`hostStatus`, `hostProblem`), checked by Task 8.10.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/teamAndNotifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { NotificationContext } from "../shared/notifications/context";
import {
  KIND_ASK_HEAD,
  KIND_BRIEF_HEAD,
  KIND_CHANNEL_MEMBERS,
  KIND_MESSAGE,
  KIND_TEAM_COMPUTER_HEAD,
} from "../shared/team/kinds";
import type { NostrEvent, NostrFilter } from "../shared/team/nostr";
import { LERATO, NALEDI, RELAY, SCOUT, makeEvent, manualTimers } from "../shared/team/testEvents";
import type { NotificationDisplay } from "./notifications/service";
import { type NotificationStore, emptyNotificationState } from "./notifications/store";
import type { RelayFeed } from "./team/relayFeed";
import { REFRESH_DEBOUNCE_MS } from "./team/teamStatusService";
import {
  INBOX_POLL_MS,
  LIVE_OVERLAP_SECONDS,
  RETRY_FIRST_MS,
  TEAM_OVERVIEW_TOPIC,
  type TeamAndNotificationsDeps,
  createTeamAndNotifications,
} from "./teamAndNotifications";

const NOW = 1_760_340_000;
const DAY = 24 * 60 * 60;
const CONTEXT: NotificationContext = {
  relayUrl: "wss://lerato.colony.global",
  viewerFirstName: "Lerato",
  role: "owner",
  ownerFirstName: "Lerato",
};
const ENGINE_STOPPED = { agentPubkey: null, kind: "crashed", detail: "Colony's engine stopped." };

const settle = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function askHead(askId: string, status: string): NostrEvent {
  return makeEvent(
    KIND_ASK_HEAD,
    {
      schemaVersion: 1,
      askId,
      status,
      askerPubkey: SCOUT,
      createdAt: new Date(NOW * 1000).toISOString(),
      ask: { schemaVersion: 1, askId, type: "approval", category: "general", title: `Decision ${askId} needs your OK.` },
      sourceActionEventId: "c".repeat(64),
    },
    [["h", "conv-1"], ["d", `channel:conv-1:ask:${askId}`], ["p", LERATO]],
    NOW,
  );
}

function harness(options: { relaySelfFailures?: number; viewer?: string | null } = {}) {
  const auth = { viewer: options.viewer === undefined ? LERATO : options.viewer };
  const subscriptions: Array<{ filters: NostrFilter[]; onEvent: (event: NostrEvent) => void; active: boolean }> = [];
  const queries: NostrFilter[][] = [];
  const inbox: NostrEvent[] = [];
  const relay: RelayFeed = {
    query: async (_url, filters) => {
      queries.push(filters);
      if (filters.some((filter) => filter.kinds.includes(KIND_CHANNEL_MEMBERS))) {
        return [makeEvent(KIND_CHANNEL_MEMBERS, "", [["d", "conv-1"], ["p", LERATO]])];
      }
      if (filters.some((filter) => filter["#p"]?.includes(LERATO))) return [...inbox];
      return [];
    },
    subscribe: (_url, filters, onEvent) => {
      const entry = { filters, onEvent, active: true };
      subscriptions.push(entry);
      return () => {
        entry.active = false;
      };
    },
  };
  const emit = (event: NostrEvent): void => {
    for (const entry of subscriptions) {
      if (entry.active && entry.filters.some((filter) => filter.kinds.includes(event.kind))) entry.onEvent(event);
    }
  };
  const shown: Array<{ id: string; body: string; closed: boolean }> = [];
  const display: NotificationDisplay = {
    show: (notification) => {
      for (const entry of shown) if (entry.id === notification.id) entry.closed = true;
      shown.push({ id: notification.id, body: notification.body, closed: false });
    },
    close: (id) => {
      for (const entry of shown) if (entry.id === id) entry.closed = true;
    },
  };
  const pushed: Array<[string, unknown]> = [];
  const reconnectListeners: Array<() => void> = [];
  let state = emptyNotificationState();
  const store: NotificationStore = {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next);
    },
  };
  const timers = manualTimers();
  const logs: string[] = [];
  let relaySelfFailures = options.relaySelfFailures ?? 0;
  const deps: TeamAndNotificationsDeps = {
    relay,
    onRelayReconnect: (_url, listener) => {
      reconnectListeners.push(listener);
      return () => {};
    },
    readTeamStatus: async () => [],
    readClaimStatus: async () => ({
      thisComputerId: "this",
      holder: { computerId: "this", computerName: "Lerato's MacBook Air", lastSeenAt: NOW - 30 },
      isThisComputer: true,
    }),
    viewerPubkey: async () => auth.viewer,
    display,
    permission: () => "granted",
    isWindowFocused: () => false,
    sendEvent: (topic, payload) => {
      pushed.push([topic, payload]);
    },
    userDataDir: "/not-used",
    log: (message) => {
      logs.push(message);
    },
    relaySelf: async () => {
      if (relaySelfFailures > 0) {
        relaySelfFailures -= 1;
        throw new Error("relay info failed");
      }
      return RELAY;
    },
    store,
    nowMs: () => NOW * 1000,
    localMinutes: () => 10 * 60,
    localTimeZone: () => "Africa/Johannesburg",
    setTimer: timers.setTimer,
  };
  const engine = createTeamAndNotifications(deps);
  return { engine, auth, subscriptions, queries, inbox, emit, shown, pushed, reconnectListeners, timers, logs };
}

async function started() {
  const h = harness();
  await h.engine.setContext(CONTEXT);
  await settle();
  return h;
}

describe("createTeamAndNotifications", () => {
  it("reads Needs you with part F's inbox filter and goes live in this person's conversations", async () => {
    const h = await started();
    expect(h.subscriptions[0]?.filters).toEqual([
      { kinds: [KIND_BRIEF_HEAD], since: NOW - 3 * DAY },
      { kinds: [KIND_TEAM_COMPUTER_HEAD], authors: [RELAY] },
    ]);
    expect(h.queries).toContainEqual([{ kinds: [KIND_ASK_HEAD], authors: [RELAY], "#p": [LERATO], limit: 500 }]);
    expect(h.subscriptions[1]?.filters).toEqual([
      { kinds: [KIND_ASK_HEAD, KIND_MESSAGE], "#h": ["conv-1"], since: NOW - LIVE_OVERLAP_SECONDS },
    ]);
    expect(h.engine.isRunning()).toBe(true);
  });

  it("shows a live decision and withdraws it when it is handled", async () => {
    const h = await started();
    h.emit(askHead("a1", "open"));
    await settle();
    expect(h.shown.map((entry) => [entry.id, entry.body])).toEqual([["decision:a1", "Decision a1 needs your OK."]]);
    h.emit(askHead("a1", "resolved"));
    await settle();
    expect(h.shown[0]?.closed).toBe(true);
  });

  it("reads Needs you again every minute and after a reconnect", async () => {
    const h = await started();
    h.inbox.push(askHead("a2", "open"));
    h.timers.fire(INBOX_POLL_MS);
    await settle();
    expect(h.shown.map((entry) => entry.body)).toEqual(["Decision a2 needs your OK."]);
    h.inbox.push(askHead("a3", "open"));
    for (const listener of h.reconnectListeners) listener();
    await settle();
    expect(h.shown.map((entry) => entry.body)).toEqual([
      "Decision a2 needs your OK.",
      "2 things need you: Decision a2 needs your OK and Decision a3 needs your OK.",
    ]);
  });

  it("notifies host problems, a credits pause and a stopped engine, and withdraws the pause on resume", async () => {
    const h = await started();
    h.engine.hostProblem({ agentPubkey: NALEDI, kind: "crash_loop", detail: "Stopped five times." });
    h.engine.hostProblem({ agentPubkey: NALEDI, kind: "exploded", detail: "" });
    h.engine.hostStatus({ agentPubkey: NALEDI, name: "Naledi", state: "paused", since: NOW, restartsInWindow: 0, pauseReason: "credits" });
    h.engine.hostProblem(ENGINE_STOPPED);
    await settle();
    expect(h.shown.map((entry) => entry.body)).toEqual([
      "An employee has stopped working. Want me to restart them?",
      "Your team is paused: credits ran out. Buy credits to carry on.",
      "Your team has stopped. Open Colony to restart it.",
    ]);
    h.engine.hostStatus({ agentPubkey: NALEDI, name: "Naledi", state: "running", since: NOW, restartsInWindow: 0 });
    await settle();
    expect(h.shown[1]?.closed).toBe(true);
  });

  it("pushes team status to the renderer", async () => {
    const h = await started();
    h.timers.fire(REFRESH_DEBOUNCE_MS);
    await settle();
    expect(h.pushed).toContainEqual([TEAM_OVERVIEW_TOPIC, { relayUrl: CONTEXT.relayUrl, views: [] }]);
  });

  it("stops subscriptions, reads and notifications when the context is cleared", async () => {
    const h = await started();
    await h.engine.setContext(null);
    await settle();
    expect(h.subscriptions.every((entry) => !entry.active)).toBe(true);
    h.inbox.push(askHead("a4", "open"));
    h.timers.fire(INBOX_POLL_MS);
    h.emit(askHead("a5", "open"));
    h.engine.hostProblem(ENGINE_STOPPED);
    await settle();
    expect(h.shown).toHaveLength(0);
    expect(h.engine.isRunning()).toBe(false);
  });

  it("starts only once someone is signed in", async () => {
    const h = harness({ viewer: null });
    await h.engine.setContext(CONTEXT);
    await settle();
    expect(h.subscriptions).toHaveLength(0);
    expect(h.engine.isRunning()).toBe(false);
    h.auth.viewer = LERATO;
    await h.engine.setContext(CONTEXT);
    await settle();
    expect(h.engine.isRunning()).toBe(true);
  });

  it("retries with a growing wait when it cannot start", async () => {
    const h = harness({ relaySelfFailures: 1 });
    await h.engine.setContext(CONTEXT);
    expect(h.logs.some((line) => line.includes("retrying"))).toBe(true);
    expect(h.subscriptions).toHaveLength(0);
    h.timers.fire(RETRY_FIRST_MS);
    await settle();
    expect(h.subscriptions.length).toBeGreaterThan(0);
    expect(h.engine.isRunning()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C app exec vitest run src/main/teamAndNotifications.test.ts`
Expected: FAIL with `Failed to resolve import "./teamAndNotifications"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/teamAndNotifications.ts`:

```ts
import { join } from "node:path";

import type { EmployeeProblem, EmployeeRuntimeStatus } from "../bridge/types";
import type { NotificationContext } from "../shared/notifications/context";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../shared/notifications/preferences";
import {
  KIND_ASK_HEAD,
  KIND_BRIEF_HEAD,
  KIND_CHANNEL_MEMBERS,
  KIND_MESSAGE,
  KIND_TEAM_COMPUTER_HEAD,
} from "../shared/team/kinds";
import type { NostrEvent } from "../shared/team/nostr";
import { type TeamComputerRecord, parseAskHead, parseMemberChannelId } from "../shared/team/records";
import type { EmployeeStatusView, TeamPause } from "../shared/team/teamStatus";
import type { TeamAndNotificationsApi } from "./notifications/bridgeHandlers";
import {
  type EmployeeDirectory,
  eventFromAskHead,
  eventFromBriefHead,
  eventFromHostProblem,
  eventFromMessage,
  eventFromTeamComputerHead,
  pausedFromStatus,
  resumedFromStatus,
} from "./notifications/producers";
import { type NotificationDisplay, type NotificationService, createNotificationService } from "./notifications/service";
import { type NotificationStore, createFileNotificationStore } from "./notifications/store";
import type { NotifyEvent } from "./notifications/types";
import { toEmployeeProblem, toRuntimeStatus, toRuntimeStatusList, toTeamComputerStatus } from "./team/hostPayloads";
import { type RelayFeed, type Unsubscribe, cachedRelaySelf } from "./team/relayFeed";
import { createTeamStatusService, latestHeads, queryInBatches } from "./team/teamStatusService";

/** Bridge topic for `team.onOverview`; the payload is `{ relayUrl, views }`. */
export const TEAM_OVERVIEW_TOPIC = "team.overview";
/** Briefs older than this are never read for notifications. */
export const NOTIFICATION_BACKLOG_SECONDS = 3 * 24 * 60 * 60;
/** Needs you has no live push (part F), so it is read again this often. */
export const INBOX_POLL_MS = 60_000;
/** A live view starts this long before the read that opened it. */
export const LIVE_OVERLAP_SECONDS = 120;
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 300_000;
const INBOX_QUERY_LIMIT = 500;
const CHANNEL_QUERY_LIMIT = 1000;
const CHANNELS_PER_FILTER = 100;
const SCOUT_TITLE = "Chief of Staff";

export type TeamAndNotificationsDeps = {
  relay: RelayFeed;
  /** Runs the listener after the relay connection came back (Task 8.11). */
  onRelayReconnect?: (relayUrl: string, listener: () => void) => Unsubscribe;
  /** Raw answers of the host's `team_status` and `team_claim_status` (part E's host commands). */
  readTeamStatus(relayUrl: string): Promise<unknown>;
  readClaimStatus(relayUrl: string): Promise<unknown>;
  /** The signed-in person's pubkey from part E's session service; null when signed out. */
  viewerPubkey(): Promise<string | null>;
  display: NotificationDisplay;
  permission(): "granted" | "denied" | "unknown";
  isWindowFocused(): boolean;
  /** Part E's `sendEvent(topic, payload)` to the renderer. */
  sendEvent(topic: string, payload: unknown): void;
  userDataDir: string;
  log(message: string): void;
  relaySelf?: (relayUrl: string) => Promise<string>;
  store?: NotificationStore;
  nowMs?: () => number;
  localMinutes?: () => number;
  localTimeZone?: () => string;
  setTimer?: (callback: () => void, ms: number) => () => void;
};

export type TeamAndNotifications = TeamAndNotificationsApi & {
  /** Part E's main calls this for every `team://status` from the host. */
  hostStatus(status: unknown): void;
  /** Part E's main calls this for every `team://problem`, and with `agentPubkey: null` when the engine stops. */
  hostProblem(problem: unknown): void;
  /** Stops everything and records the last run time; call before quitting. */
  stop(): Promise<void>;
};

type HostListeners = { status(status: EmployeeRuntimeStatus): void; problem(problem: EmployeeProblem): void };

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function contextKey(context: NotificationContext | null): string | null {
  return context === null
    ? null
    : [context.relayUrl, context.viewerFirstName, context.role, context.ownerFirstName].join("\n");
}

/** Team status and notifications for the company the renderer says is in use. */
export function createTeamAndNotifications(deps: TeamAndNotificationsDeps): TeamAndNotifications {
  const nowMs = deps.nowMs ?? ((): number => Date.now());
  const nowSec = (): number => Math.floor(nowMs() / 1000);
  const localMinutes =
    deps.localMinutes ??
    ((): number => {
      const date = new Date(nowMs());
      return date.getHours() * 60 + date.getMinutes();
    });
  const localTimeZone = deps.localTimeZone ?? ((): string => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, ms: number): (() => void) => {
      const handle = setTimeout(callback, ms);
      return () => clearTimeout(handle);
    });
  const relaySelf = deps.relaySelf ?? cachedRelaySelf();
  const store = deps.store ?? createFileNotificationStore(join(deps.userDataDir, "notifications", "state.json"));

  const latestViews = new Map<string, EmployeeStatusView[]>();
  const teamPauses = new Map<string, TeamPause>();
  const openDecisions = new Set<string>();
  let notifications: NotificationService | null = null;
  let hostListeners: HostListeners | null = null;
  let sessionStops: Unsubscribe[] = [];
  let latestContext: NotificationContext | null = null;
  let latestKey: string | null = null;

  const team = createTeamStatusService({
    relay: deps.relay,
    relaySelf,
    hostStatus: async (relayUrl) => toRuntimeStatusList(await deps.readTeamStatus(relayUrl)),
    claimStatus: async (relayUrl) => toTeamComputerStatus(await deps.readClaimStatus(relayUrl)),
    teamPause: (relayUrl) => teamPauses.get(relayUrl) ?? null,
    nowMs,
    localTimeZone,
    setTimer,
    onChange: (relayUrl, views) => {
      latestViews.set(relayUrl, views);
      deps.sendEvent(TEAM_OVERVIEW_TOPIC, { relayUrl, views });
    },
    onError: (relayUrl, error) => deps.log(`team status for ${relayUrl} failed: ${String(error)}`),
  });

  const directory = (relayUrl: string): EmployeeDirectory =>
    new Map<string, { name: string; isScout: boolean }>(
      (latestViews.get(relayUrl) ?? []).map((view) => [view.agentPubkey, { name: view.name, isScout: view.title === SCOUT_TITLE }]),
    );

  function trackOpenDecision(event: NostrEvent, viewer: string, role: NotificationContext["role"]): void {
    const ask = parseAskHead(event);
    if (!ask) return;
    const forViewer =
      ask.status === "open" &&
      ask.people.includes(viewer) &&
      (ask.addresseePubkey === null || ask.addresseePubkey === viewer) &&
      (!ask.ownerOnly || role === "owner");
    if (forViewer) openDecisions.add(ask.askId);
    else openDecisions.delete(ask.askId);
  }

  async function startSession(context: NotificationContext): Promise<void> {
    const viewer = (await deps.viewerPubkey())?.toLowerCase() ?? null;
    if (viewer === null) {
      // Nobody is signed in yet: the same context set again after sign-in starts everything.
      latestKey = null;
      return;
    }
    const relayUrl = context.relayUrl;
    const claim = toTeamComputerStatus(await deps.readClaimStatus(relayUrl));
    let active = true;
    sessionStops.push(() => {
      active = false;
    });
    const service = createNotificationService({
      store,
      display: deps.display,
      permission: () => deps.permission(),
      isWindowFocused: () => deps.isWindowFocused(),
      nowSec,
      localMinutes,
      localTimeZone,
      session: () => ({
        viewer: { pubkey: viewer, firstName: context.viewerFirstName, role: context.role },
        ownerFirstName: context.ownerFirstName,
      }),
      openDecisionCount: () => openDecisions.size,
      setTimer,
      log: deps.log,
    });
    notifications = service;
    await service.start();
    const self = (await relaySelf(relayUrl)).toLowerCase();
    const ingest = (event: NotifyEvent | null): void => {
      if (event && active) void service.ingest(event);
    };

    let teamComputer: TeamComputerRecord | null = null;
    sessionStops.push(
      deps.relay.subscribe(
        relayUrl,
        [
          { kinds: [KIND_BRIEF_HEAD], since: nowSec() - NOTIFICATION_BACKLOG_SECONDS },
          { kinds: [KIND_TEAM_COMPUTER_HEAD], authors: [self] },
        ],
        (event) => {
          if (event.kind === KIND_BRIEF_HEAD) {
            ingest(eventFromBriefHead(event));
          } else if (event.kind === KIND_TEAM_COMPUTER_HEAD) {
            const result = eventFromTeamComputerHead(event, teamComputer, claim.thisComputerId);
            teamComputer = result.record;
            ingest(result.notify);
          }
        },
      ),
    );

    const onConversationEvent = (event: NostrEvent): void => {
      if (event.kind === KIND_ASK_HEAD) {
        if (event.pubkey.toLowerCase() !== self) return;
        trackOpenDecision(event, viewer, context.role);
        ingest(eventFromAskHead(event, viewer));
      } else if (event.kind === KIND_MESSAGE) {
        ingest(eventFromMessage(event, viewer, directory(relayUrl)));
      }
    };
    let liveKey: string | null = null;
    let stopLive: Unsubscribe | null = null;
    sessionStops.push(() => stopLive?.());
    const readInbox = async (): Promise<void> => {
      const startedSec = nowSec();
      // Part F's decision inbox (Task 6.4): exactly this shape, so partners outside the conversation see it.
      const inbox = await queryInBatches(deps.relay, relayUrl, [
        { kinds: [KIND_ASK_HEAD], authors: [self], "#p": [viewer], limit: INBOX_QUERY_LIMIT },
      ]);
      if (!active) return;
      for (const event of latestHeads(inbox)) onConversationEvent(event);
      const memberships = await queryInBatches(deps.relay, relayUrl, [
        { kinds: [KIND_CHANNEL_MEMBERS], authors: [self], "#p": [viewer], limit: CHANNEL_QUERY_LIMIT },
      ]);
      const channels = [...new Set(memberships.map((event) => parseMemberChannelId(event)).filter(isPresent))].sort();
      const key = channels.join(",");
      if (!active || key === liveKey) return;
      stopLive?.();
      stopLive = null;
      liveKey = key;
      if (channels.length === 0) return;
      stopLive = deps.relay.subscribe(
        relayUrl,
        chunks(channels, CHANNELS_PER_FILTER).map((ids) => ({
          kinds: [KIND_ASK_HEAD, KIND_MESSAGE],
          "#h": ids,
          since: startedSec - LIVE_OVERLAP_SECONDS,
        })),
        onConversationEvent,
      );
    };
    await readInbox();
    let cancelPoll: (() => void) | null = null;
    const schedulePoll = (): void => {
      if (!active) return;
      cancelPoll = setTimer(() => {
        readInbox().then(schedulePoll, (error: unknown) => {
          deps.log(`reading Needs you failed: ${String(error)}`);
          schedulePoll();
        });
      }, INBOX_POLL_MS);
    };
    schedulePoll();
    sessionStops.push(() => cancelPoll?.());
    if (deps.onRelayReconnect) {
      sessionStops.push(
        deps.onRelayReconnect(relayUrl, () => {
          if (!active) return;
          readInbox().catch((error: unknown) => deps.log(`reading Needs you failed: ${String(error)}`));
        }),
      );
    }

    sessionStops.push(team.watch(relayUrl));
    hostListeners = {
      status: (status) => {
        team.hostStatusChanged(relayUrl);
        const paused = pausedFromStatus(status, nowSec());
        if (paused) {
          teamPauses.set(
            relayUrl,
            status.pauseReason === "credits" ? { reason: "credits_out" } : { reason: "plan_limit", planName: "", untilSec: null },
          );
          ingest(paused);
        } else if (status.state === "running" && teamPauses.has(relayUrl)) {
          teamPauses.delete(relayUrl);
          ingest(resumedFromStatus(status));
        }
      },
      problem: (problem) => {
        if (problem.kind === "credits_out") teamPauses.set(relayUrl, { reason: "credits_out" });
        team.hostStatusChanged(relayUrl);
        ingest(eventFromHostProblem(problem, directory(relayUrl), nowSec()));
      },
    };
    sessionStops.push(() => {
      hostListeners = null;
    });
  }

  async function stopSession(): Promise<void> {
    const stops = sessionStops;
    sessionStops = [];
    for (const stop of stops) stop();
    openDecisions.clear();
    const service = notifications;
    notifications = null;
    if (service) await service.stop();
  }

  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let cancelRetry: (() => void) | null = null;
  let retryDelayMs = RETRY_FIRST_MS;

  function switchTo(context: NotificationContext | null): Promise<void> {
    chain = chain
      .then(async () => {
        cancelRetry?.();
        cancelRetry = null;
        await stopSession();
        if (context === null || stopped) return;
        try {
          await startSession(context);
          retryDelayMs = RETRY_FIRST_MS;
        } catch (error) {
          deps.log(`notifications could not start, retrying: ${String(error)}`);
          await stopSession();
          const delay = retryDelayMs;
          retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
          cancelRetry = setTimer(() => {
            cancelRetry = null;
            void switchTo(latestContext);
          }, delay);
        }
      })
      .catch((error: unknown) => deps.log(`notifications could not switch: ${String(error)}`));
    return chain;
  }

  return {
    overview: (relayUrl) => team.overview(relayUrl),

    setContext(context) {
      const key = contextKey(context);
      if (key === latestKey) return chain;
      latestKey = key;
      latestContext = context;
      retryDelayMs = RETRY_FIRST_MS;
      return switchTo(context);
    },

    isRunning: () => notifications !== null,

    getPreferences: () => notifications?.getPreferences() ?? DEFAULT_NOTIFICATION_PREFERENCES,

    async setPreferences(preferences) {
      const service = notifications;
      if (!service) throw new Error("notifications are not running");
      await service.setPreferences(preferences);
    },

    reportFocus(focus) {
      notifications?.reportFocus(focus);
    },

    async sendTest() {
      const service = notifications;
      if (!service) throw new Error("notifications are not running");
      await service.sendTest();
    },

    hostStatus(raw) {
      const status = toRuntimeStatus(raw);
      if (status) hostListeners?.status(status);
    },

    hostProblem(raw) {
      const problem = toEmployeeProblem(raw);
      if (problem) hostListeners?.problem(problem);
    },

    async stop() {
      stopped = true;
      latestContext = null;
      latestKey = null;
      await switchTo(null);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C app exec vitest run src/main/teamAndNotifications.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/teamAndNotifications.ts app/src/main/teamAndNotifications.test.ts
git commit -s -m "feat(app): run team status and notifications for the company in use"
```

---

### Task 8.14: Bundle for main, quiet notifications and message targets

**Files:**
- Create: `app/src/main/entry.ts`, `app/scripts/build-main.mjs`
- Test: `app/src/main/entry.test.ts`
- Modify (part E): `app/package.json` (`build` and `start` scripts), `app/.gitignore`, `app/electron/notifications.mjs` and `app/electron/notifications.test.mjs` (`silent`), `app/electron/navigation.mjs` and `app/electron/navigation.test.mjs` (`subId`)

**Interfaces:**
- Consumes: part E's `RelayConnection`, `AuthSigner`, `SocketLike` (`app/src/relay/relayConnection.ts`); `createMainRelayFeed` (Task 8.11); `createTeamAndNotificationHandlers` (Task 8.12); `createTeamAndNotifications`, `TEAM_OVERVIEW_TOPIC` (Task 8.13); esbuild 0.28.2 (already a dev dependency of `app/`).
- Produces:
  - `app/electron/team-and-notifications.mjs` (generated, not committed) exporting `createCompanyRelayFeed({ signAuth, log, openSocket? }): MainRelayFeed`, `createTeamAndNotifications`, `createTeamAndNotificationHandlers`, `TEAM_OVERVIEW_TOPIC`
  - part E's notifier: `notify(notification, { silent }?)`
  - part E's `validNavTarget` keeps an optional `subId`

Part E's main process is plain ES modules (`app/electron/*.mjs`) run directly by Electron, so this part's main-side TypeScript is bundled by esbuild into one generated module, the same way part E bundles `updater-runtime.cjs`. The app stays bootable after this task: nothing imports the bundle until Task 8.15.

- [ ] **Step 1: Write the failing test**

Create `app/src/main/entry.test.ts`. It drives part E's real `RelayConnection` through the bundle entry with a fake socket: sign-in through the host signer, then one query.

```ts
import { describe, expect, it, vi } from "vitest";

import type { SocketLike } from "../relay/relayConnection";
import { LERATO, makeEvent } from "../shared/team/testEvents";
import { createCompanyRelayFeed } from "./entry";

const RELAY_URL = "wss://lerato.colony.global";

const settle = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[][] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown[]);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(message: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("createCompanyRelayFeed", () => {
  it("signs in through the host and answers a query over part E's relay connection", async () => {
    const socket = new FakeSocket();
    const authEvent = makeEvent(22242, "", [["relay", RELAY_URL], ["challenge", "challenge-1"]], 1_760_340_000, LERATO);
    const signAuth = vi.fn(async () => authEvent);
    const feed = createCompanyRelayFeed({ signAuth, log: () => {}, openSocket: () => socket });
    const answer = feed.query(RELAY_URL, [{ kinds: [9], limit: 1 }]);
    socket.open();
    await settle();
    socket.push(["AUTH", "challenge-1"]);
    await settle();
    socket.push(["OK", authEvent.id, true, ""]);
    await settle();
    const request = socket.sent.find((message) => message[0] === "REQ");
    expect(request?.slice(2)).toEqual([{ kinds: [9], limit: 1 }]);
    const message = makeEvent(9, "Morning.");
    socket.push(["EVENT", request?.[1], message]);
    socket.push(["EOSE", request?.[1]]);
    await expect(answer).resolves.toEqual([message]);
    expect(signAuth).toHaveBeenCalledWith({ challenge: "challenge-1", relayUrl: RELAY_URL });
    feed.close();
  });
});
```

In `app/electron/notifications.test.mjs`, add inside `describe("notifications", ...)`:

```js
  it("can show a notification without sound", () => {
    const notifier = createNotifier({ Notification: FakeNotification, navigate: vi.fn() });
    notifier.notify(note(), { silent: true });
    expect(FakeNotification.created[0].options).toEqual({
      title: "Scout",
      body: "Naledi's posts for next week are ready for your OK.",
      silent: true,
    });
  });
```

In `app/electron/navigation.test.mjs`, add next to `it("checks targets from notifications", ...)`:

```js
  it("keeps the message inside a conversation", () => {
    const message = "e".repeat(64);
    expect(validNavTarget({ screen: "T-03", id: "conv-1", subId: message })).toEqual({
      screen: "T-03",
      id: "conv-1",
      subId: message,
    });
    expect(() => validNavTarget({ screen: "T-03", id: "conv-1", subId: "" })).toThrow(BridgeError);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C app exec vitest run src/main/entry.test.ts electron/notifications.test.mjs electron/navigation.test.mjs`
Expected: FAIL: `Failed to resolve import "./entry"`; the notification options lack `silent: true`; `validNavTarget` returns `{ screen: "T-03", id: "conv-1" }` without `subId`.

- [ ] **Step 3: Write the entry, the build script and the two part E changes**

Create `app/src/main/entry.ts`:

```ts
// Bundled by scripts/build-main.mjs into electron/team-and-notifications.mjs, which main.mjs imports.
import { type AuthSigner, RelayConnection, type SocketLike } from "../relay/relayConnection";
import { createTeamAndNotificationHandlers } from "./notifications/bridgeHandlers";
import { type MainRelayFeed, createMainRelayFeed } from "./team/mainRelayFeed";
import { TEAM_OVERVIEW_TOPIC, createTeamAndNotifications } from "./teamAndNotifications";

export { TEAM_OVERVIEW_TOPIC, createTeamAndNotificationHandlers, createTeamAndNotifications };

/** Main's own relay socket per company, built from part E's `RelayConnection` and signed in through the host. */
export function createCompanyRelayFeed(options: {
  signAuth: AuthSigner;
  log(message: string): void;
  openSocket?: (url: string) => SocketLike;
}): MainRelayFeed {
  return createMainRelayFeed({
    open: (relayUrl) => new RelayConnection(relayUrl, options.signAuth, options.openSocket),
    setTimer: (callback, ms) => {
      const handle = setTimeout(callback, ms);
      return () => clearTimeout(handle);
    },
    log: options.log,
  });
}
```

Create `app/scripts/build-main.mjs`:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles the main-process TypeScript for team status and notifications into
// one ES module that electron/main.mjs imports. Node built-ins and electron
// stay outside the bundle.
const appRoot = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [path.join(appRoot, "src", "main", "entry.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["electron"],
  outfile: path.join(appRoot, "electron", "team-and-notifications.mjs"),
  logLevel: "warning",
});
```

In `app/package.json`, change two scripts (packaging runs `pnpm build`, so installers carry the bundle; electron-builder already packs `electron/**/*`):

```json
    "build": "tsc --noEmit && node scripts/build-main.mjs && vite build",
    "start": "node scripts/build-main.mjs && electron electron/main.mjs",
```

In `app/.gitignore`, add:

```gitignore
electron/team-and-notifications.mjs
```

In `app/electron/notifications.mjs`, `notify` takes an optional second argument:

```js
    notify(value, options = {}) {
      const item = validNotification(value);
      if (!Notification.isSupported())
        throw new BridgeError(
          "notifications_unsupported",
          "Notifications aren't available on this computer.",
        );
      close(item.id);
      const notification = new Notification({
        title: item.title,
        body: item.body,
        ...(options.silent === true ? { silent: true } : {}),
      });
      notification.on("click", () => navigate(item.target));
      notification.on("close", () => {
        if (onScreen.get(item.id) === notification) onScreen.delete(item.id);
      });
      onScreen.set(item.id, notification);
      while (onScreen.size > MAX_ON_SCREEN) close(onScreen.keys().next().value);
      notification.show();
    },
```

In `app/electron/navigation.mjs`, `validNavTarget` keeps an optional `subId` (the message inside a conversation, for "Reply to you"):

```js
export function validNavTarget(value) {
  const screen = value?.screen;
  if (typeof screen !== "string" || !SCREEN_ID.test(screen)) throw nowhere();
  const id = value?.id;
  if (id === undefined || id === null) return { screen };
  if (typeof id !== "string" || !id || id.length > MAX_ID) throw nowhere();
  const subId = value?.subId;
  if (subId === undefined || subId === null) return { screen, id };
  if (typeof subId !== "string" || !subId || subId.length > MAX_ID) throw nowhere();
  return { screen, id, subId };
}
```

- [ ] **Step 4: Run the tests and build the bundle**

Run: `pnpm -C app exec vitest run src/main/entry.test.ts electron/notifications.test.mjs electron/navigation.test.mjs`
Expected: PASS (entry: 1 test; part E's two files gain 1 test each).

Run: `node app/scripts/build-main.mjs && node -e "import('./app/electron/team-and-notifications.mjs').then((m) => console.log(Object.keys(m).sort().join(',')))"`
Expected: `TEAM_OVERVIEW_TOPIC,createCompanyRelayFeed,createTeamAndNotificationHandlers,createTeamAndNotifications`

Run: `git status --short app/electron`
Expected: the generated `team-and-notifications.mjs` is not listed (ignored).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/entry.ts app/src/main/entry.test.ts app/scripts/build-main.mjs app/package.json app/.gitignore app/electron/notifications.mjs app/electron/notifications.test.mjs app/electron/navigation.mjs app/electron/navigation.test.mjs
git commit -s -m "feat(app): bundle team status and notifications for main, quiet notifications, message targets"
```

---

### Task 8.15: Connect to the app shell and prove it

**Files:**
- Create: `app/src/bridge/teamAndNotifications.contract.ts` (compile-time check)
- Modify (part E): `app/src/bridge/types.ts`, `app/electron/bridge-contract.mjs`, `app/electron/preload.cjs`, `app/electron/preload.test.mjs`, `app/electron/main.mjs`, `app/src/console/EngineConsole.tsx`

**Interfaces:**
- Consumes: the bundle of Task 8.14; from part E's `main.mjs`: `host()` (`createAuthEvent`, `teamStatus`, `teamClaimStatus`), `sessions.session()`, `notifier` (`notify`, `close`, `permission`), `sendEvent`, `mainWindow`, `onTeamStatus`, the `team.problem` subscription in `startEngine`, `onEngineDisconnected`, `bridgeHandlers()`, `quitNow()`, `stopForUpdate()`, `BridgeError`.
- Produces: `window.colony.team.overview(relayUrl)`, `window.colony.team.onOverview(callback)`, `window.colony.notifications.{setContext, getPreferences, setPreferences, reportFocus, sendTest}`; computer notifications for the person and company the renderer reports.

The renderer calls `notifications.setContext(...)` whenever it knows the signed-in company and the first names (and `null` when it has none), and `notifications.reportFocus(...)` whenever the screen in front changes. Until the product screens exist, the engine console does both.

- [ ] **Step 1: Write the failing compile-time check**

Create `app/src/bridge/teamAndNotifications.contract.ts`:

```ts
import type { NotificationContext } from "../shared/notifications/context";
import type { FocusReport, NotificationPreferences } from "../shared/notifications/preferences";
import type { EmployeeStatusView } from "../shared/team/teamStatus";
import type { ColonyBridge, Unsubscribe } from "./types";

/** This part's bridge additions (part H). */
type TeamAndNotificationsBridge = {
  team: {
    overview(relayUrl: string): Promise<EmployeeStatusView[]>;
    onOverview(callback: (update: { relayUrl: string; views: EmployeeStatusView[] }) => void): Unsubscribe;
  };
  notifications: {
    setContext(context: NotificationContext | null): Promise<void>;
    getPreferences(): Promise<NotificationPreferences>;
    setPreferences(preferences: NotificationPreferences): Promise<void>;
    reportFocus(focus: FocusReport): Promise<void>;
    sendTest(): Promise<void>;
  };
};

/** Compiles only while `ColonyBridge` carries this part's additions. */
export function teamAndNotificationsBridge(bridge: ColonyBridge): TeamAndNotificationsBridge {
  return bridge;
}
```

- [ ] **Step 2: Run the type check to verify it fails**

Run: `pnpm -C app exec tsc --noEmit -p .`
Expected: FAIL in `teamAndNotifications.contract.ts`: `ColonyBridge` is not assignable to `TeamAndNotificationsBridge` (`notifications` and `team.overview` do not exist yet).

- [ ] **Step 3: Add the renderer types**

In `app/src/bridge/types.ts`, add at the top:

```ts
import type { NotificationContext } from "../shared/notifications/context";
import type { FocusReport, NotificationPreferences } from "../shared/notifications/preferences";
import type { EmployeeStatusView } from "../shared/team/teamStatus";
```

In `ColonyBridge.team`, after `onProblem`:

```ts
    /** The G-07 status of every employee (part H). */
    overview(relayUrl: string): Promise<EmployeeStatusView[]>;
    onOverview(callback: (update: { relayUrl: string; views: EmployeeStatusView[] }) => void): Unsubscribe;
```

In `ColonyBridge`, after `system`:

```ts
  /** Computer notifications (G-03) and their settings (S-06), part H. */
  notifications: {
    /** Who uses Colony here and for which company; null stops notifications. */
    setContext(context: NotificationContext | null): Promise<void>;
    getPreferences(): Promise<NotificationPreferences>;
    setPreferences(preferences: NotificationPreferences): Promise<void>;
    /** What is in front of the person, so Colony does not notify about it. */
    reportFocus(focus: FocusReport): Promise<void>;
    sendTest(): Promise<void>;
  };
```

Run: `pnpm -C app exec tsc --noEmit -p .`
Expected: PASS, no errors.

- [ ] **Step 4: Add the methods to part E's contract and preload**

In `app/electron/bridge-contract.mjs`, `BRIDGE_METHODS` gains `"team.overview"` after `"team.status"`, and these after `"system.update.restartToInstall"`:

```js
  "notifications.setContext",
  "notifications.getPreferences",
  "notifications.setPreferences",
  "notifications.reportFocus",
  "notifications.sendTest",
```

and `BRIDGE_EVENTS` gains `"team.overview"` after `"team.problem"`.

In `app/electron/preload.cjs`, the `team` object gains `overview: method("team.overview")` after `status`, and `onOverview: on("team.overview")` after `onProblem`; after the `system` object, add:

```js
  notifications: {
    setContext: method("notifications.setContext"),
    getPreferences: method("notifications.getPreferences"),
    setPreferences: method("notifications.setPreferences"),
    reportFocus: method("notifications.reportFocus"),
    sendTest: method("notifications.sendTest"),
  },
```

In `app/electron/preload.test.mjs`, `EVENT_FUNCTIONS` gains:

```js
  "team.overview": ["team", "onOverview"],
```

Run: `pnpm -C app exec vitest run electron/preload.test.mjs electron/bridge-router.test.mjs`
Expected: PASS (the preload exposes one function per method, including the six new ones, and routes the new topic).

- [ ] **Step 5: Wire the engine into `app/electron/main.mjs`**

With the other imports:

```js
import {
  createCompanyRelayFeed,
  createTeamAndNotificationHandlers,
  createTeamAndNotifications,
} from "./team-and-notifications.mjs";
```

After `const companies = createCompanyService({ ... });`:

```js
const relayFeed = createCompanyRelayFeed({
  signAuth: (input) => host().createAuthEvent(input),
  log: (message) => console.warn(`Colony relay: ${String(message).slice(0, 200)}`),
});
const teamAndNotifications = createTeamAndNotifications({
  relay: relayFeed,
  onRelayReconnect: relayFeed.onReconnect,
  readTeamStatus: (relayUrl) => host().teamStatus(relayUrl),
  readClaimStatus: (relayUrl) => host().teamClaimStatus(relayUrl),
  viewerPubkey: async () => (await sessions.session())?.pubkey ?? null,
  display: {
    show: (notification, silent) => notifier.notify(notification, { silent }),
    close: (id) => notifier.close(id),
  },
  permission: () => notifier.permission(),
  isWindowFocused: () =>
    Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()),
  sendEvent,
  userDataDir: app.getPath("userData"),
  log: (message) => console.warn(`Colony notifications: ${String(message).slice(0, 200)}`),
});

/** Every team problem goes to the renderer and to notifications. */
function reportProblem(problem) {
  sendEvent("team.problem", problem);
  teamAndNotifications.hostProblem(problem);
}
```

In `startEngine`, the problem subscription becomes:

```js
  await subscribeHostEvent(native, HOST_EVENTS.teamProblem, reportProblem);
```

In `onEngineDisconnected`, the `sendEvent("team.problem", ...)` line becomes:

```js
  reportProblem({ agentPubkey: null, kind: "crashed", detail: ENGINE_STOPPED });
```

In `onTeamStatus`, after `sendEvent("team.status", status);`:

```js
  teamAndNotifications.hostStatus(status);
```

In `bridgeHandlers()`, add as the last entry of the returned object:

```js
    ...createTeamAndNotificationHandlers(teamAndNotifications, (code, message) => new BridgeError(code, message)),
```

In `quitNow()` and in `stopForUpdate()`, before `await stopEngine();`:

```js
  await teamAndNotifications.stop();
  relayFeed.close();
```

- [ ] **Step 6: Give the engine console one control per new method**

In `app/src/console/EngineConsole.tsx`, next to the other `useState` calls in `EngineConsole`:

```tsx
  const [notifyName, setNotifyName] = useState("");
```

and a new section after the team controls, in the same style as the others:

```tsx
      <section>
        <h2>Team status and notifications</h2>
        <label>
          Your first name <input value={notifyName} onChange={(event) => setNotifyName(event.target.value)} />
        </label>
        <button
          type="button"
          onClick={() =>
            run("Notify me here", () =>
              api().notifications.setContext({
                relayUrl: company(),
                viewerFirstName: notifyName.trim(),
                role: "owner",
                ownerFirstName: notifyName.trim(),
              }),
            )
          }
        >
          Notify me here
        </button>
        <button type="button" onClick={() => run("Stop notifying", () => api().notifications.setContext(null))}>Stop notifying</button>
        <button type="button" onClick={() => run("Team overview", () => api().team.overview(company()))}>Team overview</button>
        <button type="button" onClick={() => run("Notification settings", () => api().notifications.getPreferences())}>Notification settings</button>
        <button
          type="button"
          onClick={() =>
            run("Quiet hours now", async () => {
              const current = await api().notifications.getPreferences();
              return api().notifications.setPreferences({ ...current, quietHours: { enabled: true, start: "00:00", end: "23:59" } });
            })
          }
        >
          Quiet hours now
        </button>
        <button
          type="button"
          onClick={() =>
            run("Quiet hours back", async () => {
              const current = await api().notifications.getPreferences();
              return api().notifications.setPreferences({ ...current, quietHours: { enabled: true, start: "21:00", end: "07:00" } });
            })
          }
        >
          Quiet hours back to 21:00 to 07:00
        </button>
        <button
          type="button"
          onClick={() => run("Today in front", () => api().notifications.reportFocus({ screen: "T-01", itemId: null, conversationId: null }))}
        >
          Today is in front
        </button>
        <button type="button" onClick={() => run("Test notification", () => api().notifications.sendTest())}>Send a test notification</button>
      </section>
```

- [ ] **Step 7: Run every check of this part**

Run: `pnpm -C app exec tsc --noEmit -p .`
Expected: PASS.

Run: `pnpm -C app exec vitest run src/shared/team src/shared/notifications src/main electron/notifications.test.mjs electron/navigation.test.mjs electron/preload.test.mjs electron/bridge-router.test.mjs`
Expected: PASS (all tests from Tasks 8.3 to 8.14 and part E's four bridge files).

Run: `pnpm -C app test:e2e`
Expected: PASS (it builds first, bundle included); the engine console smoke test still loads against the fake native host (part E, task 5.16), which proves `main.mjs` imports the bundle and the router accepts the six new handlers.

Run: `cargo test -p buzz-core --test company_team_status && cargo test -p buzz-cli --lib commands::team`
Expected: PASS.

- [ ] **Step 8: Prove it on a real run (Mac, then Windows)**

Use part I's phase 1 gate setup: the app started the way part E documents, a clean data folder, a test company with Scout and the fixture employee, real AI, signed in as the owner. In the engine console:

1. Type the owner's first name, click "Notify me here", then "Team overview". Expected: Scout and the fixture employee, each with a G-07 word and a plain detail line. In the developer tools, run `window.colony.system.onNavigate((target) => console.log(target))` so later clicks show their targets.
2. Click another app so Colony is not in front. As the fixture employee (its key in `BUZZ_PRIVATE_KEY`), raise a decision in a conversation the owner belongs to: `colony asks create --channel <conversation id> --ask '<AskRecord JSON with askId, threadRootEventId and a title>'`. Expected: within 5 seconds, a notification titled "Scout" with the ask's title. Clicking it opens the window and the renderer receives `{ screen: "T-05", id: <askId> }` through `system.onNavigate`.
3. Raise a second decision and answer it as the owner with `colony asks respond` (or from a second computer). Expected: its notification disappears.
4. On a second computer, sign in as a partner who is not a member of that conversation, and in its developer tools run `await window.colony.notifications.setContext({ relayUrl: "<relay url>", viewerFirstName: "<partner's first name>", role: "partner", ownerFirstName: "<owner's first name>" })`. Raise another decision. Expected: the partner's notification arrives within 60 seconds (part F's inbox read), the owner's within 5 seconds.
5. Click "Quiet hours now" and raise another decision. Expected: no notification, now or later. Click "Quiet hours back to 21:00 to 07:00".
6. Quit Colony and open it again (click "Notify me here" again). Expected: no notification for any decision that existed before.
7. Make the fixture employee exit 5 times within 10 minutes (part D's crash loop). Expected: "<name> has stopped working. Want me to restart them?"; clicking it delivers `{ screen: "C-18", id: <pubkey> }`.
8. Run out of credits (part I's gate). Expected: "Your team is paused: credits ran out. Buy credits to carry on." on the team computer (the owner's). Buying a $5 pack and the team running again removes it. The partner's wording ("<owner> can top up") is proven by Task 8.7's tests, because host pauses reach only the computer that runs the team.
9. End the native host process from the operating system's task manager. Expected: "Your team has stopped. Open Colony to restart it."
10. As Scout, run `colony team status`. Expected: JSON listing the fixture employee with its current work and the open asks waiting on people.

Record screenshots of steps 1, 2, 7 and 8 for part I's phase 1 proof page, with what was not verified.

- [ ] **Step 9: Commit**

```bash
git add app/src/bridge/teamAndNotifications.contract.ts app/src/bridge/types.ts app/electron/bridge-contract.mjs app/electron/preload.cjs app/electron/preload.test.mjs app/electron/main.mjs app/src/console/EngineConsole.tsx
git commit -s -m "feat(app): team status and notifications in the app shell"
```

---

## Contract changes

1. **Where G-03 runs: the coordinator must pick one before parts E and H are built.** The brief puts the rules in `app/src/main/notifications/` and wires them into Electron main; this plan does that, with main keeping its own relay socket per company. Part E's contract change 11 instead says the renderer's subscriptions feed notifications through `system.notify`. With this plan, the renderer must not also raise G-03 notifications through `system.notify` (it stays for anything else). If the coordinator prefers the renderer: Tasks 8.3 to 8.9 move unchanged; Tasks 8.11 and 8.13 to 8.15 change (no bundle, no second socket, the store behind a bridge method).
2. **Part E's main process (Tasks 8.14, 8.15).** An esbuild step (`app/scripts/build-main.mjs`, run by `build` and `start`) produces the ignored `app/electron/team-and-notifications.mjs`. Main opens one more relay socket per company in use with part E's `RelayConnection`, signed in through `host().createAuthEvent`. `onTeamStatus` calls `hostStatus`; the `team.problem` subscription and the engine stop go through `reportProblem`; `quitNow()` and `stopForUpdate()` stop the engine of this part first.
3. **Bridge additions.** `team.overview(relayUrl)`; topic `team.overview` (`team.onOverview`, payload `{ relayUrl, views }`); `notifications.setContext`, `getPreferences`, `setPreferences`, `reportFocus`, `sendTest`. `NavTarget.subId` (part E's `validNavTarget` keeps it). Part E's notifier takes `{ silent }` for the S-06 sound switch. The product renderer must call `notifications.setContext` when it knows the company and first names, and `reportFocus` when the screen in front changes.
4. **Host types consumed.** Part I's `EmployeeRuntimeStatus.pauseReason` (part E's `PauseReason`): "credits" shows "Credits ran out" and notifies (owner: "Buy credits to carry on"; partner: "Lerato can top up"); "plan_limit" shows "Plan limit reached" ("Claude plan limit until 14:00" when the plan and reset time are known) and notifies; "person" shows "Paused" ("Paused by Kagiso" when known) and does not notify. Part E's `EmployeeProblem.agentPubkey: null` is the engine stopping (X-10). Host events carry no relay address, so on a computer that runs more than one company, a pause notifies for the company in use.
5. **Needs you and records from parts F and G.** Decisions come from part F's exact inbox filter `{ kinds: [30643], authors: [<relay>], "#p": [<me>] }` (plus a limit), read on start, on reconnect and every 60 seconds, with live asks only in the person's conversations; asks addressed to an employee notify nobody because part F names nobody on them. Still needed: billing asks (C-16: buy credits, auto top-up, website hosting payment) carry the tag `["colony:owner-only", "1"]` on the head (parts F and I), and the Friday wrap content gains an optional whole-number `doneCount` for "14 things done this week" (part F's `BriefRecord` rejects unknown fields today). Tool consent asks (part F contract change 2) carry no `p` tags and are not notified here.
6. **Pause visibility (parts D and I).** A pause is known only on the team computer: part I keeps the credits pause in the host (no balance event kind exists), and a person's pause is a host command. So partners get no "Lerato can top up" notification today, and other computers cannot show X-22's "Paused by Kagiso at 14:05". Proposal: the team computer record (kind 30658, part D) gains `pause: { reason: "person" | "credits" | "plan_limit", byPubkey: string | null, atSec: number, untilSec: number | null } | null`, written by the team computer's host when it pauses and resumes. This part already watches that record (Task 8.13), so turning it into `team_paused` and `team_resumed` on every other computer, and into the X-22 line, is a small follow-up once the field exists.

## Self-review

**1. Spec coverage**

| Requirement | Where |
|-|-|
| G-03 decision, several decisions within 1 minute, employee problem, Scout stopped, team stopped, team paused (owner and partner words), credits low (owner only), morning brief, Friday wrap, time to post, customer waiting, reply to you, team moved away | Rules and words: Task 8.7 (19 table cases); producers: Task 8.8; engine: Task 8.13 |
| G-03 rules: quiet hours, notifications off on the computer, handled elsewhere, in front, grouping, no repeats, Colony quit, signed out | Task 8.7 (quiet hours, permission, in front, grouping, history and duplicates), Task 8.9 (store, restart, signed out), Task 8.13 (withdraw on handled, context cleared, sign-in) |
| S-06 switches, decisions and urgent problems always on, quiet hours 21:00 to 07:00, let urgent problems through on, sound, send a test | Tasks 8.7, 8.9, 8.12, 8.14 (`silent`) |
| G-07 status words, precedence, extra lines (including part I's pause reasons), Away from other computers, Scout first | Tasks 8.4, 8.5 |
| E-13 read model through the bridge | Tasks 8.6, 8.12, 8.13, 8.15 |
| E-13 `colony team status` for Scout | Tasks 8.1, 8.2 |
| Needs you from part F's inbox on connect, reconnect and every 60 seconds; live in member conversations | Tasks 8.11, 8.13 |

Not covered here, by design: producers for time to post (needs E-24 content calendar records), customer waiting (needs E-22 customer inbox records) and credits low (needs E-15's low-balance signal); their event types, rules and tests exist, so each producer is a small addition when its record lands. The G-01 Needs you badge and the G-04m "notifications off" banner belong to part E. Preferences are kept per person on this computer; syncing them across a person's computers is later work. Tool consent asks are not notified (contract change 5). Partners are not told about a pause until the team computer record carries it (contract change 6).

**2. Placeholder scan:** no "TBD", "TODO" or "similar to Task N". Every reference to part E's code names a function or file that part E's plan defines (`RelayConnection`, `createNotifier`, `validNavTarget`, `createBridgeRouter`, `BRIDGE_METHODS`, `BRIDGE_EVENTS`, `preload.cjs`, `main.mjs` and its `host()`, `sessions`, `sendEvent`, `onTeamStatus`, `onEngineDisconnected`, `bridgeHandlers()`, `quitNow()`, `stopForUpdate()`).

**3. Type consistency:** `EmployeeStatusView`, `TeamPause`, `NotifyEvent`, `KeyedEvent`, `RulesState`, `NotificationPreferences`, `FocusReport`, `NotificationContext`, `NotificationDisplay`, `RelayFeed`, `RelayConnectionLike`, `TeamAndNotificationsApi` and `Unsubscribe` are each defined once and imported everywhere else; bridge method names live in `TEAM_AND_NOTIFICATION_METHODS` and, for part E's JavaScript, in `bridge-contract.mjs` (part E's preload test and router keep the two in step); record kinds come only from `kinds.ts`.

**4. Review Focus:** history and duplicates (Task 8.7 "history, repeats and permission", Task 8.9 restart test); quiet hours across midnight (Task 8.7 "quiet hours"); partner and billing (Task 8.7 owner-only and credits-low tests, partner COPY cases); Away from another computer (Task 8.5 "shows Away on another computer only after more than ten minutes of silence"); slow refresh (Task 8.6 "never lets a slow refresh overwrite a newer one").

**5. Alignment with parts E and F, checked against their plan files:** part E's main is `.mjs` with one allowlisted IPC channel, so this part adds handlers to part E's router instead of its own channels, and its TypeScript reaches main through the Task 8.14 bundle; part E's sandboxed preload cannot load modules, so the new methods are added to `preload.cjs` directly; part E's notifier already replaces by id and opens targets on click, so the service shows and closes through it; part F's inbox rule accepts only `authors [relay]` plus one `#p`, which Task 8.13 uses exactly.

**6. Dry run of the code in this file (11 October, scratch copy, not the repo):** the TypeScript of Tasks 8.3 to 8.15 was extracted from this file together with part E's `app/src/bridge/types.ts`, `app/src/relay/nostr.ts`, `app/src/relay/relayConnection.ts` and its bridge, navigation and notification modules as its plan stood that evening, with this part's edits applied. Results: `tsc` 6.0.3 strict with no errors; Vitest 4.1.11 with 157 tests passing in 15 files (every count above matches) and part E's 23 bridge tests passing with this part's edits; Biome 2.4.16 lint clean; `scripts/build-main.mjs` with esbuild 0.28.2 producing a module that exports exactly the four names Task 8.14 expects and imports only `node:fs/promises` and `node:path`. Not dry-run: the Rust of Tasks 8.1 and 8.2, part E's `main.mjs` and engine console edits, and anything against a real relay or host.
