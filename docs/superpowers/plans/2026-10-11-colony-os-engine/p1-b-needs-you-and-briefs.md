# Needs you index and briefs (phase 1, part F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-overview.md` in this folder first: its contract wins over anything here.

**Goal:** Let every owner and partner find the decisions that need them across all conversations (E-06), and give Scout a durable record for the morning brief and the Friday wrap (E-07) that Today, Scout's desk and the `colony` command can read.

**Architecture:** The relay names the people who may decide an ask with `p` tags on every relay-signed ask head (kind 30643) it writes, following the existing resolution rules. A narrow, global "decision inbox" filter (`kinds [30643]`, `authors [relay]`, `#p [self]`) is served only to owners and admins and lifts the conversation fence for them, mirroring the existing tool consent inbox, over WebSocket and the HTTP bridge. Briefs are a new employee-signed, community-wide parameterized replaceable kind (30659) validated in buzz-core and at relay ingest, written and read with `colony brief`. The new app gets pure TypeScript selectors for Needs you and briefs under `app/src/records/`.

**Tech Stack:** Rust (buzz-core, buzz-sdk, buzz-relay axum and sqlx, buzz-cli clap, buzz-test-client), Nostr (NIP-01 filters, NIP-29 `h` scoping, NIP-33 replaceable events, NIP-OA `auth` tags), TypeScript with Vitest in the new `app/` package.

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md`; screen pack `docs/superpowers/specs/2026-10-11-colony-os-screens/` (T-01 Today, T-05 Needs you, C-00 card basics, C-19 brief and Friday wrap, D-01 Scout's desk, X-09 Scout stopped; engine items E-06 and E-07 in `10-data-and-engine.md`); plan overview `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md`.


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 6 (this part's brief command is the only one) and 7 (optional `doneCount` in task 6.1 and `--done-count` in task 6.8). Where they differ from the tasks below, the amendments win.

## Global Constraints

- Every line of the overview's "Global constraints" applies to every task here (no em dashes anywhere, no new `unwrap()` or `expect()` in production paths, doc comments on new public API, never "Buzz", "Fizz" or "Honey" in user or employee visible text, AGENTS.md review-proven rules, `git commit -s`, PRs into `develop`, GitHub CI is the gate).
- Kind numbers: `KIND_ASK_HEAD = 30643` (existing), `KIND_BRIEF_HEAD = 30659` (new, per the overview table).
- Tool consent ask heads keep their exact four-tag shape (`h`, `d`, `e`, `t`): `crates/buzz-relay/src/handlers/req.rs:1229` and `crates/buzz-acp/src/tool_permissions.rs:430` both reject any other tag count.
- A relay test that needs Postgres lives in a module named `postgres_tests` and carries `#[ignore = "requires disposable Postgres and Redis"]`, so the PostgreSQL CI lane (`.config/nextest.toml`, profile `postgres-ci`) discovers it. A new infra-free relay test module must be added to `just test-unit` and `scripts/run-tests.sh unit`; no CI lane runs relay library tests by default.
- Local Postgres runs use `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E '<filter>'` (local Postgres and Redis from `just setup`).
- Brief content limits: text 1 to 1200 characters, at most 8 links (label 1 to 80 characters, target a screen pack ID with an optional id of 1 to 200 printable characters), credits in whole US cents with at most 32 rows, content at most 16 KB.

## Review Focus

1. **A partner who is not in the conversation where an owner-gated ask lives.** Expected: the ask still reaches the partner's Needs you. Pinned by the Postgres test in Task 6.5 and the WebSocket and HTTP end-to-end test in Task 6.7.
2. **An employee reads its own decision inbox, or an employee holds an admin role.** Expected: no decision is ever addressed to an employee, so its inbox stays empty, and agents are never named as deciders. Pinned in Tasks 6.3, 6.5 and 6.7.
3. **Tool consent asks after this change.** Expected: their heads keep exactly four tags and the existing tool consent inbox and the harness consent watcher still accept them. Pinned in Task 6.3.
4. **A person promoted to admin after an ask was written.** Expected: Needs you shows it through the client backfill rule, and the next write of that head names them. Pinned in Task 6.3 (recompute on cancel) and Task 6.9 (backfill selector).
5. **A brief from someone who is not an employee, a Friday wrap dated on a Monday, a brief with extra tags, a brief carrying the harness `auth` tag.** Expected: the first three are rejected with a plain reason and the last is accepted. Pinned in Tasks 6.1, 6.6 and 6.7.

---

### Task 6.1: Brief record type and validation in buzz-core

**Files:**
- Create: `crates/buzz-core/src/company_briefs.rs`
- Modify: `crates/buzz-core/src/lib.rs:9-27` (module list)
- Modify: `crates/buzz-core/src/kind.rs:796` (new constant after `KIND_LESSON_ACTION`), `crates/buzz-core/src/kind.rs:1165-1167` (`ALL_KINDS`), `crates/buzz-core/src/kind.rs:1388` onward (tests module)
- Test: `crates/buzz-core/src/company_briefs.rs` (`#[cfg(test)] mod tests`), `crates/buzz-core/src/kind.rs` (tests module)

**Interfaces:**
- Consumes: `buzz_core::company_records::CompanyRecordError` (`crates/buzz-core/src/company_records.rs:51-68`).
- Produces:
  - `buzz_core::kind::KIND_BRIEF_HEAD: u32 = 30659`
  - `buzz_core::company_briefs::{BRIEF_SCHEMA_VERSION: u8 = 1, MAX_BRIEF_TEXT_CHARS: usize = 1200, MAX_BRIEF_LINKS: usize = 8, MAX_BRIEF_LINK_LABEL_CHARS: usize = 80, MAX_BRIEF_TARGET_ID_CHARS: usize = 200, MAX_BRIEF_CREDIT_ROWS: usize = 32, MAX_BRIEF_CONTENT_BYTES: usize = 16384}`
  - `enum BriefType { Morning, Friday }` with `const fn as_str(self) -> &'static str`
  - `struct BriefTarget { screen: String, id: Option<String> }`, `struct BriefLink { label: String, target: BriefTarget }`, `struct BriefEmployeeCredits { pubkey: String, usd_cents: u64 }`, `struct BriefCredits { total_usd_cents: u64, per_employee: Vec<BriefEmployeeCredits> }`, `struct BriefRecord { schema_version: u8, brief_type: BriefType, text: String, links: Vec<BriefLink>, credits_used: Option<BriefCredits>, written_at: String }` (all camelCase JSON, `deny_unknown_fields`, `brief_type` serialized as `type`)
  - `fn brief_d_tag(date: chrono::NaiveDate, brief_type: BriefType) -> String`
  - `fn parse_brief_d_tag(d_tag: &str) -> Result<(NaiveDate, BriefType), CompanyRecordError>`
  - `fn validate_brief(record: &BriefRecord, date: NaiveDate) -> Result<(), CompanyRecordError>`
  - `fn parse_brief_content(d_tag: &str, content: &str) -> Result<(NaiveDate, BriefRecord), CompanyRecordError>`

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-core/src/company_briefs.rs` with only this test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const EMPLOYEE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn monday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 12).expect("valid date")
    }

    fn friday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 16).expect("valid date")
    }

    fn link(label: &str, screen: &str, id: Option<&str>) -> BriefLink {
        BriefLink {
            label: label.into(),
            target: BriefTarget {
                screen: screen.into(),
                id: id.map(str::to_owned),
            },
        }
    }

    fn record(brief_type: BriefType) -> BriefRecord {
        BriefRecord {
            schema_version: BRIEF_SCHEMA_VERSION,
            brief_type,
            text: "Naledi's posts for next week are ready, and Thabo is waiting on his order."
                .into(),
            links: vec![link("Needs you", "T-05", None)],
            credits_used: None,
            written_at: "2026-10-12T08:30:04+02:00".into(),
        }
    }

    #[test]
    fn d_tags_round_trip_and_reject_other_shapes() {
        let tag = brief_d_tag(monday(), BriefType::Morning);
        assert_eq!(tag, "brief:2026-10-12:morning");
        assert_eq!(
            parse_brief_d_tag(&tag).expect("own d-tag parses"),
            (monday(), BriefType::Morning)
        );
        assert_eq!(
            brief_d_tag(friday(), BriefType::Friday),
            "brief:2026-10-16:friday"
        );
        for bad in [
            "brief:2026-10-12",
            "brief:2026-10-12:evening",
            "brief:2026-13-01:morning",
            "brief:2026-1-5:morning",
            "notes:2026-10-12:morning",
            "brief:2026-10-12:morning:extra",
        ] {
            assert_eq!(
                parse_brief_d_tag(bad),
                Err(CompanyRecordError::DTagMismatch),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_valid_brief_passes_and_text_is_bounded() {
        validate_brief(&record(BriefType::Morning), monday()).expect("valid morning brief");
        let mut long = record(BriefType::Morning);
        long.text = "a".repeat(MAX_BRIEF_TEXT_CHARS);
        validate_brief(&long, monday()).expect("1200 characters is allowed");
        long.text.push('a');
        assert!(validate_brief(&long, monday()).is_err());
        let mut blank = record(BriefType::Morning);
        blank.text = "   ".into();
        assert!(validate_brief(&blank, monday()).is_err());
    }

    #[test]
    fn links_are_bounded_and_point_at_screen_ids() {
        let mut brief = record(BriefType::Morning);
        brief.links = vec![
            link("Spring posts", "D-03a", Some("post-42")),
            link("Card", "C-04", None),
        ];
        validate_brief(&brief, monday()).expect("sub-screen IDs and record ids are allowed");
        let long_label = "x".repeat(81);
        let long_id = "i".repeat(201);
        for bad in [
            link("", "T-05", None),
            link(&long_label, "T-05", None),
            link("Bad", "t-05", None),
            link("Bad", "T-5", None),
            link("Bad", "T-05aa", None),
            link("Bad", "T-05", Some("")),
            link("Bad", "T-05", Some(&long_id)),
            link("Bad", "T-05", Some("line\nbreak")),
        ] {
            brief.links = vec![bad];
            assert!(validate_brief(&brief, monday()).is_err());
        }
        brief.links = (0..=MAX_BRIEF_LINKS)
            .map(|_| link("Needs you", "T-05", None))
            .collect();
        assert!(validate_brief(&brief, monday()).is_err(), "nine links is too many");
    }

    #[test]
    fn credits_are_whole_cents_with_one_row_per_employee() {
        let mut wrap = record(BriefType::Friday);
        wrap.credits_used = Some(BriefCredits {
            total_usd_cents: 910,
            per_employee: vec![
                BriefEmployeeCredits {
                    pubkey: EMPLOYEE.into(),
                    usd_cents: 340,
                },
                BriefEmployeeCredits {
                    pubkey: OTHER.into(),
                    usd_cents: 210,
                },
            ],
        });
        validate_brief(&wrap, friday()).expect("valid Friday wrap with credits");

        let mut duplicate = wrap.clone();
        if let Some(credits) = duplicate.credits_used.as_mut() {
            credits.per_employee[1].pubkey = EMPLOYEE.into();
        }
        assert!(validate_brief(&duplicate, friday()).is_err());

        let mut above_total = wrap.clone();
        if let Some(credits) = above_total.credits_used.as_mut() {
            credits.per_employee[0].usd_cents = 911;
        }
        assert!(validate_brief(&above_total, friday()).is_err());

        let mut uppercase = wrap.clone();
        if let Some(credits) = uppercase.credits_used.as_mut() {
            credits.per_employee[0].pubkey = EMPLOYEE.to_uppercase();
        }
        assert!(validate_brief(&uppercase, friday()).is_err());

        let mut too_many = wrap;
        if let Some(credits) = too_many.credits_used.as_mut() {
            credits.per_employee = (0..=MAX_BRIEF_CREDIT_ROWS)
                .map(|index| BriefEmployeeCredits {
                    pubkey: format!("{index:064x}"),
                    usd_cents: 1,
                })
                .collect();
        }
        assert!(validate_brief(&too_many, friday()).is_err());
    }

    #[test]
    fn friday_wraps_are_for_fridays_and_written_at_is_a_timestamp() {
        validate_brief(&record(BriefType::Friday), friday()).expect("Friday wrap on a Friday");
        assert_eq!(
            validate_brief(&record(BriefType::Friday), monday()),
            Err(CompanyRecordError::Invalid("a Friday wrap must be for a Friday"))
        );
        let mut bad_time = record(BriefType::Morning);
        bad_time.written_at = "Monday morning".into();
        assert!(validate_brief(&bad_time, monday()).is_err());
    }

    #[test]
    fn content_must_match_its_d_tag_and_schema() {
        let content = serde_json::to_string(&record(BriefType::Morning)).expect("serialize brief");
        let (date, parsed) = parse_brief_content("brief:2026-10-12:morning", &content)
            .expect("matching content parses");
        assert_eq!(date, monday());
        assert_eq!(parsed, record(BriefType::Morning));
        assert_eq!(
            parse_brief_content("brief:2026-10-16:friday", &content),
            Err(CompanyRecordError::DTagMismatch)
        );
        let unknown = content.replacen('{', "{\"mood\":\"great\",", 1);
        assert_eq!(
            parse_brief_content("brief:2026-10-12:morning", &unknown),
            Err(CompanyRecordError::InvalidContent)
        );
        let oversized = " ".repeat(MAX_BRIEF_CONTENT_BYTES + 1);
        assert!(parse_brief_content("brief:2026-10-12:morning", &oversized).is_err());
        let mut future = record(BriefType::Morning);
        future.schema_version = 2;
        let future = serde_json::to_string(&future).expect("serialize brief");
        assert_eq!(
            parse_brief_content("brief:2026-10-12:morning", &future),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }
}
```

Register the module in `crates/buzz-core/src/lib.rs`, directly after the `company_records` entry:

```rust
/// Typed briefs and Friday wraps that Scout writes (kind 30659).
pub mod company_briefs;
```

Add this test to the `#[cfg(test)] mod tests` block at the end of `crates/buzz-core/src/kind.rs`:

```rust
    #[test]
    fn brief_kind_is_an_employee_signed_parameterized_record() {
        assert_eq!(KIND_BRIEF_HEAD, 30_659);
        assert!(ALL_KINDS.contains(&KIND_BRIEF_HEAD));
        assert!(is_parameterized_replaceable(KIND_BRIEF_HEAD));
        assert!(!is_relay_only_kind(KIND_BRIEF_HEAD));
        assert!(!COMPANY_RECORD_KINDS.contains(&KIND_BRIEF_HEAD));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-core --lib company_briefs`
Expected: FAIL to compile with errors such as "cannot find type `BriefRecord` in this scope" and "cannot find value `KIND_BRIEF_HEAD`".

- [ ] **Step 3: Write the implementation**

In `crates/buzz-core/src/kind.rs`, add after `pub const KIND_LESSON_ACTION: u32 = 47045;` (line 796):

```rust
/// Employee-signed brief or Friday wrap (community-wide, `d` = `brief:<YYYY-MM-DD>:<morning|friday>`).
pub const KIND_BRIEF_HEAD: u32 = 30659;
```

In `ALL_KINDS`, change the run

```rust
    KIND_DUTY_HEAD,
    KIND_LESSON_HEAD,
    KIND_FACTORY_RUN_ACTION,
```

to

```rust
    KIND_DUTY_HEAD,
    KIND_LESSON_HEAD,
    KIND_BRIEF_HEAD,
    KIND_FACTORY_RUN_ACTION,
```

(This run appears once, in `ALL_KINDS` at lines 1165 to 1167; `COMPANY_RECORD_KINDS` has `KIND_LESSON_HEAD` followed by `KIND_EMPLOYEE_AI_ALLOWANCE_HEAD` and stays unchanged, because briefs are not brokered.)

Put the implementation above the test module in `crates/buzz-core/src/company_briefs.rs`:

```rust
//! Typed briefs and Friday wraps that Scout writes (kind 30659).
//!
//! A brief is an employee-signed, community-wide parameterized replaceable
//! event. Its d-tag names the company calendar day it is for and its type
//! (`brief:<YYYY-MM-DD>:<morning|friday>`), so a corrected brief replaces the
//! earlier one for the same day.

use std::collections::BTreeSet;

use chrono::{DateTime, Datelike, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use crate::company_records::CompanyRecordError;

/// Schema version of brief content.
pub const BRIEF_SCHEMA_VERSION: u8 = 1;
/// Maximum brief text, in characters.
pub const MAX_BRIEF_TEXT_CHARS: usize = 1200;
/// Maximum links in one brief.
pub const MAX_BRIEF_LINKS: usize = 8;
/// Maximum link label, in characters.
pub const MAX_BRIEF_LINK_LABEL_CHARS: usize = 80;
/// Maximum link target record id, in characters.
pub const MAX_BRIEF_TARGET_ID_CHARS: usize = 200;
/// Maximum per-employee credit rows.
pub const MAX_BRIEF_CREDIT_ROWS: usize = 32;
/// Maximum serialized brief content, in bytes.
pub const MAX_BRIEF_CONTENT_BYTES: usize = 16 * 1024;

/// Which brief a record is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BriefType {
    /// The weekday morning brief.
    Morning,
    /// The Friday wrap.
    Friday,
}

impl BriefType {
    /// Spelling used in the d-tag and in content.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Friday => "friday",
        }
    }
}

/// Where a brief link goes: a screen pack ID and, optionally, the record it opens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefTarget {
    /// Screen pack ID such as `T-05`, `C-04` or `D-03a`.
    pub screen: String,
    /// Record the screen opens, for example a card or conversation id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// One link inside a brief.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefLink {
    /// Words people see, 1 to 80 characters.
    pub label: String,
    /// Where the link goes.
    pub target: BriefTarget,
}

/// Credits one employee used in the period the brief covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefEmployeeCredits {
    /// Employee public key, 64 lowercase hex characters.
    pub pubkey: String,
    /// Credits used, in whole US cents.
    pub usd_cents: u64,
}

/// Credits used in the period the brief covers, in whole US cents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefCredits {
    /// Total for the whole team.
    pub total_usd_cents: u64,
    /// One row per employee, at most 32.
    #[serde(default)]
    pub per_employee: Vec<BriefEmployeeCredits>,
}

/// Content of a brief or Friday wrap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefRecord {
    /// Schema version, [`BRIEF_SCHEMA_VERSION`].
    pub schema_version: u8,
    /// Morning brief or Friday wrap; must match the d-tag.
    #[serde(rename = "type")]
    pub brief_type: BriefType,
    /// What moved, what is stuck and what needs people, 1 to 1200 characters.
    pub text: String,
    /// At most 8 links.
    #[serde(default)]
    pub links: Vec<BriefLink>,
    /// Credits used, usually carried by the Friday wrap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_used: Option<BriefCredits>,
    /// When the brief was written (RFC 3339).
    pub written_at: String,
}

/// d-tag of the brief for `date` (the company calendar day) and `brief_type`.
pub fn brief_d_tag(date: NaiveDate, brief_type: BriefType) -> String {
    format!("brief:{}:{}", date.format("%Y-%m-%d"), brief_type.as_str())
}

/// Parse a `brief:<YYYY-MM-DD>:<morning|friday>` d-tag.
pub fn parse_brief_d_tag(d_tag: &str) -> Result<(NaiveDate, BriefType), CompanyRecordError> {
    let rest = d_tag
        .strip_prefix("brief:")
        .ok_or(CompanyRecordError::DTagMismatch)?;
    let (date, brief_type) = rest
        .split_once(':')
        .ok_or(CompanyRecordError::DTagMismatch)?;
    let brief_type = match brief_type {
        "morning" => BriefType::Morning,
        "friday" => BriefType::Friday,
        _ => return Err(CompanyRecordError::DTagMismatch),
    };
    if date.len() != 10 {
        return Err(CompanyRecordError::DTagMismatch);
    }
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| CompanyRecordError::DTagMismatch)?;
    Ok((date, brief_type))
}

/// Validate brief content for the company calendar day `date`.
pub fn validate_brief(record: &BriefRecord, date: NaiveDate) -> Result<(), CompanyRecordError> {
    if record.schema_version != BRIEF_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if record.text.trim().is_empty() || record.text.chars().count() > MAX_BRIEF_TEXT_CHARS {
        return Err(CompanyRecordError::Invalid(
            "text is required, 1200 characters at most",
        ));
    }
    if record.links.len() > MAX_BRIEF_LINKS {
        return Err(CompanyRecordError::Invalid("a brief has at most 8 links"));
    }
    for link in &record.links {
        if link.label.trim().is_empty() || link.label.chars().count() > MAX_BRIEF_LINK_LABEL_CHARS
        {
            return Err(CompanyRecordError::Invalid(
                "link label is required, 80 characters at most",
            ));
        }
        if !is_screen_id(&link.target.screen) {
            return Err(CompanyRecordError::Invalid(
                "link target screen must be a screen ID such as T-05",
            ));
        }
        if let Some(id) = &link.target.id {
            if id.is_empty()
                || id.chars().count() > MAX_BRIEF_TARGET_ID_CHARS
                || id.chars().any(char::is_control)
            {
                return Err(CompanyRecordError::Invalid(
                    "link target id must be 1 to 200 printable characters",
                ));
            }
        }
    }
    if let Some(credits) = &record.credits_used {
        if credits.per_employee.len() > MAX_BRIEF_CREDIT_ROWS {
            return Err(CompanyRecordError::Invalid(
                "credits list at most 32 employees",
            ));
        }
        let mut seen = BTreeSet::new();
        for row in &credits.per_employee {
            if !is_lower_hex_64(&row.pubkey) || !seen.insert(row.pubkey.as_str()) {
                return Err(CompanyRecordError::Invalid(
                    "each credits row names a different employee pubkey",
                ));
            }
            if row.usd_cents > credits.total_usd_cents {
                return Err(CompanyRecordError::Invalid(
                    "an employee cannot use more credits than the total",
                ));
            }
        }
    }
    if DateTime::parse_from_rfc3339(&record.written_at).is_err() {
        return Err(CompanyRecordError::Invalid(
            "writtenAt must be an RFC 3339 timestamp",
        ));
    }
    if record.brief_type == BriefType::Friday && date.weekday() != Weekday::Fri {
        return Err(CompanyRecordError::Invalid(
            "a Friday wrap must be for a Friday",
        ));
    }
    Ok(())
}

/// Parse and validate brief content against its d-tag.
pub fn parse_brief_content(
    d_tag: &str,
    content: &str,
) -> Result<(NaiveDate, BriefRecord), CompanyRecordError> {
    if content.len() > MAX_BRIEF_CONTENT_BYTES {
        return Err(CompanyRecordError::Invalid(
            "brief content is 16 KB at most",
        ));
    }
    let (date, brief_type) = parse_brief_d_tag(d_tag)?;
    let record: BriefRecord =
        serde_json::from_str(content).map_err(|_| CompanyRecordError::InvalidContent)?;
    if record.brief_type != brief_type {
        return Err(CompanyRecordError::DTagMismatch);
    }
    validate_brief(&record, date)?;
    Ok((date, record))
}

/// Screen pack IDs: one capital letter, a hyphen, two digits, an optional lowercase letter.
fn is_screen_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    matches!(bytes.len(), 4 | 5)
        && bytes[0].is_ascii_uppercase()
        && bytes[1] == b'-'
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && (bytes.len() == 4 || bytes[4].is_ascii_lowercase())
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-core --lib company_briefs && cargo test -p buzz-core --lib kind::tests`
Expected: PASS, including `brief_kind_is_an_employee_signed_parameterized_record` and `no_duplicate_kind_values`.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/company_briefs.rs crates/buzz-core/src/lib.rs crates/buzz-core/src/kind.rs
git commit -s -m "feat(core): typed brief and Friday wrap records (kind 30659)"
```

---

### Task 6.2: Brief event builder in buzz-sdk

**Files:**
- Create: `crates/buzz-sdk/src/company_briefs.rs`
- Modify: `crates/buzz-sdk/src/lib.rs:21-22` (module list, before `company_duties`)
- Test: `crates/buzz-sdk/src/company_briefs.rs`

**Interfaces:**
- Consumes: `buzz_core::company_briefs::{brief_d_tag, validate_brief, parse_brief_content, BriefRecord, BriefType, MAX_BRIEF_CONTENT_BYTES}` and `KIND_BRIEF_HEAD` from Task 6.1; `buzz_sdk::SdkError` (`crates/buzz-sdk/src/lib.rs:107-131`).
- Produces: `buzz_sdk::company_briefs::build_brief(record: &BriefRecord, date: chrono::NaiveDate) -> Result<nostr::EventBuilder, SdkError>`, plus re-exports of `BriefCredits`, `BriefEmployeeCredits`, `BriefLink`, `BriefRecord`, `BriefTarget`, `BriefType`, `BRIEF_SCHEMA_VERSION`.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-sdk/src/company_briefs.rs` with this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_briefs::parse_brief_content;
    use nostr::Keys;

    fn morning() -> BriefRecord {
        BriefRecord {
            schema_version: BRIEF_SCHEMA_VERSION,
            brief_type: BriefType::Morning,
            text: "Morning. Naledi's posts are ready and Sipho found 12 boutiques.".into(),
            links: vec![BriefLink {
                label: "Needs you".into(),
                target: BriefTarget {
                    screen: "T-05".into(),
                    id: None,
                },
            }],
            credits_used: None,
            written_at: "2026-10-12T08:30:04+02:00".into(),
        }
    }

    #[test]
    fn builds_a_brief_whose_content_matches_its_d_tag() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 12).expect("valid date");
        let event = build_brief(&morning(), date)
            .expect("build brief")
            .sign_with_keys(&Keys::generate())
            .expect("sign brief");
        assert_eq!(event.kind, Kind::Custom(KIND_BRIEF_HEAD as u16));
        assert_eq!(event.tags.len(), 1);
        let d_tag = event
            .tags
            .iter()
            .next()
            .and_then(|tag| tag.content())
            .expect("d tag value");
        assert_eq!(d_tag, "brief:2026-10-12:morning");
        let (parsed_date, parsed) =
            parse_brief_content(d_tag, &event.content).expect("content parses");
        assert_eq!(parsed_date, date);
        assert_eq!(parsed, morning());
    }

    #[test]
    fn refuses_an_invalid_brief() {
        let monday = NaiveDate::from_ymd_opt(2026, 10, 12).expect("valid date");
        let mut wrap = morning();
        wrap.brief_type = BriefType::Friday;
        let error = build_brief(&wrap, monday).expect_err("a Friday wrap dated Monday is refused");
        assert!(error.to_string().contains("a Friday wrap must be for a Friday"));
    }
}
```

Register the module in `crates/buzz-sdk/src/lib.rs` directly before the `company_duties` entry:

```rust
/// Typed event builder for briefs and Friday wraps.
pub mod company_briefs;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-sdk --lib company_briefs`
Expected: FAIL to compile with "cannot find function `build_brief`".

- [ ] **Step 3: Write the implementation**

Put above the test module in `crates/buzz-sdk/src/company_briefs.rs`:

```rust
//! Typed event builder for briefs and Friday wraps (kind 30659).
//!
//! Briefs are community-wide: they carry their `d` coordinate and no channel
//! `h` tag. The employee signs them with its own key.

use crate::SdkError;
use buzz_core::company_briefs::{brief_d_tag, validate_brief, MAX_BRIEF_CONTENT_BYTES};
pub use buzz_core::company_briefs::{
    BriefCredits, BriefEmployeeCredits, BriefLink, BriefRecord, BriefTarget, BriefType,
    BRIEF_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_BRIEF_HEAD;
use chrono::NaiveDate;
use nostr::{EventBuilder, Kind, Tag};

/// Build an employee-signed brief for `date` with its `brief:<date>:<type>` d-tag.
pub fn build_brief(record: &BriefRecord, date: NaiveDate) -> Result<EventBuilder, SdkError> {
    validate_brief(record, date)
        .map_err(|error| SdkError::InvalidInput(format!("brief is invalid: {error}")))?;
    let content = serde_json::to_string(record)
        .map_err(|error| SdkError::InvalidInput(format!("brief serialization failed: {error}")))?;
    if content.len() > MAX_BRIEF_CONTENT_BYTES {
        return Err(SdkError::ContentTooLarge {
            max: MAX_BRIEF_CONTENT_BYTES,
            got: content.len(),
        });
    }
    let d_tag = brief_d_tag(date, record.brief_type);
    let tag =
        Tag::parse(["d", d_tag.as_str()]).map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_BRIEF_HEAD as u16), content).tag(tag))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-sdk --lib company_briefs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-sdk/src/company_briefs.rs crates/buzz-sdk/src/lib.rs
git commit -s -m "feat(sdk): build brief and Friday wrap events"
```

---

### Task 6.3: The relay names deciders on ask heads

**Files:**
- Modify: `crates/buzz-relay/src/handlers/company_asks.rs:205-212` (create), `:257-262` (cancel), `:438-441` (response), `:1222-1257` (`relay_ask_head_event`), plus a new `ask_decider_pubkeys` above `relay_ask_head_event`
- Modify: `crates/buzz-relay/src/handlers/company_secrets.rs:186-216` (secret activation rebuilds the ask head)
- Test: `crates/buzz-relay/src/handlers/company_asks.rs` (`mod postgres_tests`, starts at line 1409)

**Interfaces:**
- Consumes: existing `is_managed_agent` (`company_asks.rs:949`), `internal` (`:1310`), `state.db.list_relay_members(CommunityId) -> Result<Vec<RelayMember>>` (`crates/buzz-db/src/store/relay_members.rs:714-718`; `RelayMember { pubkey: String, role: String, created_at: DateTime<Utc>, .. }`).
- Produces:
  - `pub(super) const MAX_ASK_DECIDER_TAGS: usize = 128;`
  - `pub(super) async fn ask_decider_pubkeys(state: &AppState, tenant: &TenantContext, ask: &AskRecord) -> Result<Vec<String>, IngestError>` (lowercase hex, owner first, then admins by join time, then a human addressee; never an employee)
  - `pub(super) fn relay_ask_head_event(head: &AskHead, channel_id: Uuid, d_tag: &str, previous: Option<&StoredEvent>, deciders: &[String], state: &AppState) -> Result<Event, IngestError>` (new `deciders` parameter; tool consent heads ignore it)

- [ ] **Step 1: Write the failing test**

Add inside `mod postgres_tests` in `crates/buzz-relay/src/handlers/company_asks.rs` (after the existing helpers, before the first `#[tokio::test]`):

```rust
    fn p_tags(head: &StoredEvent) -> Vec<String> {
        head.event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "p")
            .filter_map(|tag| tag.content().map(str::to_owned))
            .collect()
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn ask_heads_name_the_people_who_may_decide() {
        let fixture = fixture().await;
        let owner_hex = fixture.owner.public_key().to_hex();
        let admin = Keys::generate();
        let member = Keys::generate();
        let employee = Keys::generate();
        let agent_admin = Keys::generate();
        add_actor(&fixture, &admin, Some("admin"), false, false).await;
        add_actor(&fixture, &member, Some("member"), false, true).await;
        add_actor(&fixture, &employee, Some("member"), true, true).await;
        add_actor(&fixture, &agent_admin, Some("admin"), true, false).await;
        let admin_hex = admin.public_key().to_hex();
        let root = fixture.root.id.to_hex();

        // An authority ask names the owner first, then admins; never employees.
        let money = ask_record(Uuid::new_v4(), &root, AskType::Approval, AskCategory::Money);
        let money_id = money.ask_id;
        let (_, money_head) = create_ask(&fixture, &employee, money).await;
        assert_eq!(p_tags(&money_head), vec![owner_hex.clone(), admin_hex.clone()]);

        // An unaddressed general ask names the same people.
        let general = ask_record(Uuid::new_v4(), &root, AskType::Approval, AskCategory::General);
        let (_, general_head) = create_ask(&fixture, &employee, general).await;
        assert_eq!(p_tags(&general_head), vec![owner_hex.clone(), admin_hex.clone()]);

        // A general question for one person names only that person.
        let mut for_member =
            ask_record(Uuid::new_v4(), &root, AskType::Question, AskCategory::General);
        for_member.addressee_pubkey = Some(member.public_key().to_hex());
        let (_, member_head) = create_ask(&fixture, &employee, for_member).await;
        assert_eq!(p_tags(&member_head), vec![member.public_key().to_hex()]);

        // A question for an employee names nobody: the employee answers it.
        let mut for_employee =
            ask_record(Uuid::new_v4(), &root, AskType::Question, AskCategory::General);
        for_employee.addressee_pubkey = Some(employee.public_key().to_hex());
        let (_, employee_head) = create_ask(&fixture, &fixture.owner, for_employee).await;
        assert!(p_tags(&employee_head).is_empty());

        // Tool consent heads keep their exact four-tag inbox shape.
        let consent = ask_record(Uuid::new_v4(), &root, AskType::ToolConsent, AskCategory::Tool);
        let (_, consent_head) = create_ask(&fixture, &employee, consent).await;
        assert_eq!(consent_head.event.tags.len(), 4);
        assert!(crate::handlers::req::is_tool_consent_head_event(
            &consent_head.event,
            &fixture.state.relay_keypair.public_key()
        ));

        // Every later head write recomputes the deciders: a partner added after
        // the ask was created is named once the head changes.
        let late_admin = Keys::generate();
        add_actor(&fixture, &late_admin, Some("admin"), false, false).await;
        let cancel = sign_cancel(
            &fixture.owner,
            fixture.channel_id,
            money_id,
            &money_head.event.id.to_hex(),
        );
        company_records::handle(&fixture.tenant, &fixture.state, cancel, auth(&fixture.owner))
            .await
            .expect("the owner cancels the money ask");
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, money_id);
        let cancelled =
            current_ask_head(&fixture.state, &fixture.tenant, fixture.channel_id, &d_tag)
                .await
                .expect("load the cancelled head")
                .expect("the cancelled head exists");
        assert_eq!(
            p_tags(&cancelled),
            vec![owner_hex, admin_hex, late_admin.public_key().to_hex()]
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E 'test(/company_asks::postgres_tests::ask_heads_name_the_people_who_may_decide/)'`
Expected: FAIL at the first assertion with `left: []` and `right: [<owner hex>, <admin hex>]`.

- [ ] **Step 3: Write the implementation**

In `crates/buzz-relay/src/handlers/company_asks.rs`, add directly above `pub(super) fn relay_ask_head_event`:

```rust
/// Most people one ask head names as deciders; keeps the head's tag list bounded.
pub(super) const MAX_ASK_DECIDER_TAGS: usize = 128;

/// People who may decide `ask`, as lowercase hex, for the head's `p` tags.
///
/// Authority asks, member proposals and unaddressed general asks name the
/// owner and every admin (partners are admins); a human addressee is named
/// too. A general ask addressed to one person names that person. An ask
/// addressed to an employee names nobody, because the employee answers it.
/// Tool consent heads name nobody: they keep their exact four-tag shape and
/// are read through the tool consent inbox. Employees are never named, even
/// when they hold an admin role.
pub(super) async fn ask_decider_pubkeys(
    state: &AppState,
    tenant: &TenantContext,
    ask: &AskRecord,
) -> Result<Vec<String>, IngestError> {
    if ask.ask_type == AskType::ToolConsent {
        return Ok(Vec::new());
    }
    let needs_authority = ask.category.requires_authority() || ask.member_proposal.is_some();
    let addressee_is_agent = match ask.addressee_pubkey.as_deref() {
        Some(pubkey) => is_managed_agent(state, tenant, pubkey).await?,
        None => false,
    };
    let mut deciders: Vec<String> = Vec::new();
    if needs_authority || ask.addressee_pubkey.is_none() {
        let mut members = state
            .db
            .list_relay_members(tenant.community())
            .await
            .map_err(internal)?;
        members.retain(|member| matches!(member.role.as_str(), "owner" | "admin"));
        members.sort_by_key(|member| (member.role != "owner", member.created_at));
        for member in members {
            if deciders.len() == MAX_ASK_DECIDER_TAGS {
                break;
            }
            if is_managed_agent(state, tenant, &member.pubkey).await? {
                continue;
            }
            let pubkey = member.pubkey.to_ascii_lowercase();
            if !deciders.contains(&pubkey) {
                deciders.push(pubkey);
            }
        }
    }
    if let Some(addressee) = ask.addressee_pubkey.as_deref() {
        let addressee = addressee.to_ascii_lowercase();
        if !addressee_is_agent
            && deciders.len() < MAX_ASK_DECIDER_TAGS
            && !deciders.contains(&addressee)
        {
            deciders.push(addressee);
        }
    }
    Ok(deciders)
}
```

Change `relay_ask_head_event` to take the deciders and add them as `p` tags after the tool consent tag:

```rust
pub(super) fn relay_ask_head_event(
    head: &AskHead,
    channel_id: Uuid,
    d_tag: &str,
    previous: Option<&StoredEvent>,
    deciders: &[String],
    state: &AppState,
) -> Result<Event, IngestError> {
```

and, directly after the existing `if head.ask.ask_type == AskType::ToolConsent { tags.push(...) }` block:

```rust
    // Tool consent heads keep their exact four-tag shape; the tool consent
    // inbox (req.rs) and the harness consent watcher both check it.
    if head.ask.ask_type != AskType::ToolConsent {
        for decider in deciders.iter().take(MAX_ASK_DECIDER_TAGS) {
            tags.push(
                Tag::parse(["p", decider.as_str()])
                    .map_err(|error| internal(format!("ask decider tag: {error}")))?,
            );
        }
    }
```

Update the three call sites in `company_asks.rs`.

Create (line 211):

```rust
            let deciders = ask_decider_pubkeys(state, tenant, &head.ask).await?;
            let head_event =
                relay_ask_head_event(&head, channel_id, &d_tag, None, &deciders, state)?;
```

Cancel (lines 260 to 261):

```rust
            let deciders = ask_decider_pubkeys(state, tenant, &head.ask).await?;
            let head_event = relay_ask_head_event(
                &head,
                channel_id,
                &d_tag,
                Some(&current),
                &deciders,
                state,
            )?;
```

Response (line 441):

```rust
    let deciders = ask_decider_pubkeys(state, tenant, &head.ask).await?;
    let head_event = relay_ask_head_event(
        &head,
        channel_id,
        &d_tag,
        Some(&current),
        &deciders,
        state,
    )?;
```

In `crates/buzz-relay/src/handlers/company_secrets.rs`, inside `if let Some((channel_id, ask_d_tag, stored_ask)) = ask_current.as_ref() {`, add before `Some((`:

```rust
            let deciders =
                super::company_asks::ask_decider_pubkeys(state, tenant, &ask_head.ask).await?;
```

and pass `&deciders,` to `super::company_asks::relay_ask_head_event` between `Some(stored_ask),` and `state,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E 'test(/company_asks::postgres_tests::/) | test(/company_secrets::postgres_tests::/)'`
Expected: PASS for `ask_heads_name_the_people_who_may_decide` and for every existing ask and secret test (including `tool_consent_is_agent_created_and_resolved_only_by_owner_or_admin`).
Then run: `cargo test -p buzz-acp --lib tool_permissions`
Expected: PASS (the harness consent watcher still accepts four-tag heads).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_asks.rs crates/buzz-relay/src/handlers/company_secrets.rs
git commit -s -m "feat(relay): name the people who may decide on every ask head"
```

---

### Task 6.4: Decision inbox rules (pure module)

**Files:**
- Create: `crates/buzz-relay/src/handlers/decision_inbox.rs`
- Modify: `crates/buzz-relay/src/handlers/mod.rs:38-39` (register after `count`)
- Modify: `justfile` (the `cargo nextest run -p buzz-relay --lib -E '...'` expression in `test-unit`)
- Modify: `scripts/run-tests.sh:149-150` (unit steps)
- Test: `crates/buzz-relay/src/handlers/decision_inbox.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `buzz_core::kind::KIND_ASK_HEAD`, `buzz_db::{EventQuery, DEFAULT_MAX_PAGE_LIMIT}`.
- Produces (all `pub(crate)` in `crate::handlers::decision_inbox`):
  - `fn is_decision_inbox_filter(filter: &nostr::Filter, relay_pubkey: &nostr::PublicKey, reader_hex: &str) -> bool`
  - `fn can_read_decision_inbox(filter: &nostr::Filter, relay_pubkey: &nostr::PublicKey, reader_hex: &str, community_role: Option<&str>) -> bool`
  - `fn apply_decision_inbox_scope(query: &mut buzz_db::EventQuery, reader_hex: &str)`
  - `fn is_decision_head_for_reader(event: &nostr::Event, relay_pubkey: &nostr::PublicKey, reader_hex: &str) -> bool`

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-relay/src/handlers/decision_inbox.rs` with this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::kind::KIND_GOAL_HEAD;
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Keys, Tag};

    const COORDINATE: &str =
        "channel:9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50:ask:7245ba1a-e078-42ef-b896-00be34a94f11";

    fn inbox_filter(relay: PublicKey, reader: &str) -> Filter {
        Filter::new()
            .kind(Kind::Custom(KIND_ASK_HEAD as u16))
            .author(relay)
            .custom_tag(SingleLetterTag::lowercase(Alphabet::P), reader)
    }

    fn head(signer: &Keys, kind: u32, named: &str) -> nostr::Event {
        EventBuilder::new(Kind::Custom(kind as u16), "{}")
            .tags([Tag::parse(["p", named]).expect("p tag")])
            .sign_with_keys(signer)
            .expect("sign head")
    }

    #[test]
    fn only_the_exact_inbox_shape_is_recognized() {
        let relay = Keys::generate().public_key();
        let reader = Keys::generate().public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        let filter = inbox_filter(relay, &reader);
        assert!(is_decision_inbox_filter(&filter, &relay, &reader));
        assert!(is_decision_inbox_filter(
            &filter
                .clone()
                .custom_tag(SingleLetterTag::lowercase(Alphabet::D), COORDINATE),
            &relay,
            &reader
        ));

        let note = EventBuilder::new(Kind::TextNote, "x")
            .sign_with_keys(&Keys::generate())
            .expect("sign note");
        let not_inbox = [
            Filter::new()
                .kind(Kind::Custom(KIND_ASK_HEAD as u16))
                .custom_tag(SingleLetterTag::lowercase(Alphabet::P), reader.as_str()),
            inbox_filter(Keys::generate().public_key(), &reader),
            inbox_filter(relay, &other),
            filter.clone().kind(Kind::Custom(KIND_GOAL_HEAD as u16)),
            filter
                .clone()
                .custom_tags(SingleLetterTag::lowercase(Alphabet::P), [other.as_str()]),
            filter.clone().custom_tag(
                SingleLetterTag::lowercase(Alphabet::H),
                "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
            ),
            filter.clone().custom_tag(
                SingleLetterTag::lowercase(Alphabet::D),
                "channel:not-a-uuid:ask:also-not",
            ),
            filter.clone().search("decision"),
            filter.clone().id(note.id),
        ];
        for candidate in &not_inbox {
            assert!(
                !is_decision_inbox_filter(candidate, &relay, &reader),
                "{candidate:?}"
            );
        }
    }

    #[test]
    fn only_owners_and_admins_read_the_inbox() {
        let relay = Keys::generate().public_key();
        let reader = Keys::generate().public_key().to_hex();
        let filter = inbox_filter(relay, &reader);
        assert!(can_read_decision_inbox(&filter, &relay, &reader, Some("owner")));
        assert!(can_read_decision_inbox(&filter, &relay, &reader, Some("admin")));
        assert!(!can_read_decision_inbox(&filter, &relay, &reader, Some("member")));
        assert!(!can_read_decision_inbox(&filter, &relay, &reader, None));
    }

    #[test]
    fn inbox_scope_lifts_the_channel_fence_and_pushes_the_reader_tag() {
        let reader = Keys::generate().public_key().to_hex();
        let mut query = EventQuery::for_community(CommunityId::from_uuid(uuid::Uuid::new_v4()));
        query.channel_id = Some(uuid::Uuid::new_v4());
        query.channel_ids = Some(vec![uuid::Uuid::new_v4()]);
        query.limit = Some(i64::MAX);
        apply_decision_inbox_scope(&mut query, &reader);
        assert_eq!(query.channel_id, None);
        assert_eq!(query.channel_ids, None);
        assert!(!query.channel_ids_include_global);
        assert_eq!(query.p_tag_hex.as_deref(), Some(reader.as_str()));
        assert_eq!(query.kinds, Some(vec![KIND_ASK_HEAD as i32]));
        assert_eq!(query.limit, Some(buzz_db::DEFAULT_MAX_PAGE_LIMIT));
    }

    #[test]
    fn rows_must_be_relay_signed_ask_heads_that_name_the_reader() {
        let relay = Keys::generate();
        let relay_pubkey = relay.public_key();
        let reader = Keys::generate().public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        assert!(is_decision_head_for_reader(
            &head(&relay, KIND_ASK_HEAD, &reader),
            &relay_pubkey,
            &reader
        ));
        assert!(!is_decision_head_for_reader(
            &head(&Keys::generate(), KIND_ASK_HEAD, &reader),
            &relay_pubkey,
            &reader
        ));
        assert!(!is_decision_head_for_reader(
            &head(&relay, KIND_GOAL_HEAD, &reader),
            &relay_pubkey,
            &reader
        ));
        assert!(!is_decision_head_for_reader(
            &head(&relay, KIND_ASK_HEAD, &other),
            &relay_pubkey,
            &reader
        ));
    }
}
```

Register the module in `crates/buzz-relay/src/handlers/mod.rs`, directly after `pub mod count;`:

```rust
/// Needs you inbox: global reads of ask heads that name the reader as a decider.
pub mod decision_inbox;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-relay --lib handlers::decision_inbox::tests`
Expected: FAIL to compile with "cannot find function `is_decision_inbox_filter`".

- [ ] **Step 3: Write the implementation**

Put above the test module in `crates/buzz-relay/src/handlers/decision_inbox.rs`:

```rust
//! The Needs you decision inbox.
//!
//! Ask heads (kind 30643) are channel scoped, so an ordinary read only sees
//! heads in conversations the reader belongs to. Owners and admins may decide
//! authority asks without being in the conversation, so the relay serves them
//! one narrow global filter, checked here: relay-signed ask heads whose `p`
//! tags name the reader (the relay writes those tags, see
//! `company_asks::ask_decider_pubkeys`). Tool consent asks keep their own
//! inbox (`#t` = `tool_consent`) in `req.rs`.

use buzz_core::kind::KIND_ASK_HEAD;
use buzz_db::EventQuery;
use nostr::{Alphabet, Filter, Kind, PublicKey, SingleLetterTag};

/// Page size when an inbox read names no limit.
const DEFAULT_INBOX_LIMIT: i64 = 100;

/// Recognize the inbox filter: exactly `kinds [30643]`, `authors [relay]`,
/// one `#p` value equal to the reader, an optional single ask `#d`
/// coordinate, and nothing else.
pub(crate) fn is_decision_inbox_filter(
    filter: &Filter,
    relay_pubkey: &PublicKey,
    reader_hex: &str,
) -> bool {
    let expected_kind = Kind::Custom(KIND_ASK_HEAD as u16);
    let p_tag = SingleLetterTag::lowercase(Alphabet::P);
    let d_tag = SingleLetterTag::lowercase(Alphabet::D);
    let names_only_the_reader = filter
        .generic_tags
        .get(&p_tag)
        .is_some_and(|values| values.len() == 1 && values.contains(reader_hex));
    let coordinate_is_one_ask = match filter.generic_tags.get(&d_tag) {
        None => true,
        Some(values) if values.len() == 1 => values
            .iter()
            .next()
            .is_some_and(|value| is_ask_coordinate(value)),
        Some(_) => false,
    };
    filter
        .kinds
        .as_ref()
        .is_some_and(|kinds| kinds.len() == 1 && kinds.contains(&expected_kind))
        && filter
            .authors
            .as_ref()
            .is_some_and(|authors| authors.len() == 1 && authors.contains(relay_pubkey))
        && filter
            .generic_tags
            .keys()
            .all(|tag| tag == &p_tag || tag == &d_tag)
        && names_only_the_reader
        && coordinate_is_one_ask
        && filter.search.is_none()
        && filter.ids.is_none()
}

/// Community owners and admins (partners are admins) may read the inbox.
pub(crate) fn can_read_decision_inbox(
    filter: &Filter,
    relay_pubkey: &PublicKey,
    reader_hex: &str,
    community_role: Option<&str>,
) -> bool {
    matches!(community_role, Some("owner" | "admin"))
        && is_decision_inbox_filter(filter, relay_pubkey, reader_hex)
}

/// Lift the reader's conversation fence for an authorized inbox filter and
/// push the reader's `p` tag into SQL so the page holds only their heads.
pub(crate) fn apply_decision_inbox_scope(query: &mut EventQuery, reader_hex: &str) {
    query.channel_id = None;
    query.channel_ids = None;
    query.channel_ids_include_global = false;
    query.kinds = Some(vec![KIND_ASK_HEAD as i32]);
    query.p_tag_hex = Some(reader_hex.to_owned());
    query.limit = Some(
        query
            .limit
            .unwrap_or(DEFAULT_INBOX_LIMIT)
            .clamp(0, buzz_db::DEFAULT_MAX_PAGE_LIMIT),
    );
}

/// Post-check every inbox row: a relay-signed ask head whose `p` tags name the reader.
pub(crate) fn is_decision_head_for_reader(
    event: &nostr::Event,
    relay_pubkey: &PublicKey,
    reader_hex: &str,
) -> bool {
    event.pubkey == *relay_pubkey
        && event.kind == Kind::Custom(KIND_ASK_HEAD as u16)
        && event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() == "p" && tag.content() == Some(reader_hex))
}

fn is_ask_coordinate(value: &str) -> bool {
    value
        .strip_prefix("channel:")
        .and_then(|rest| rest.split_once(":ask:"))
        .is_some_and(|(channel, ask)| {
            uuid::Uuid::parse_str(channel).is_ok() && uuid::Uuid::parse_str(ask).is_ok()
        })
}
```

Register the module in the infra-free unit lanes. In `justfile`, in the `test-unit` recipe's `cargo nextest run -p buzz-relay --lib -E '...'` expression, change `+ test(/^handlers::side_effects::tests::/)` to:

```text
+ test(/^handlers::side_effects::tests::/) + test(/^handlers::decision_inbox::tests::/)
```

In `scripts/run-tests.sh`, after the "buzz-relay side-effects helper tests" step (lines 149 to 150), add:

```bash
  run_test_step "buzz-relay decision inbox tests" \
    cargo test -p buzz-relay --lib handlers::decision_inbox::tests:: -- --nocapture
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-relay --lib handlers::decision_inbox::tests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/decision_inbox.rs crates/buzz-relay/src/handlers/mod.rs justfile scripts/run-tests.sh
git commit -s -m "feat(relay): decision inbox filter rules for Needs you"
```

---

### Task 6.5: Serve the decision inbox over WebSocket and the HTTP bridge

**Files:**
- Modify: `crates/buzz-relay/src/handlers/req.rs:130-157` (role lookup and authorized filters), `:386-393` (query scope), `:483-492` (row post-check)
- Modify: `crates/buzz-relay/src/api/bridge.rs:1195-1216` (role lookup), `:1473-1493` (query scope), `:1551-1567` (row post-check)
- Modify: `docs/company-records.md:317-325` (Needs me section)
- Test: `crates/buzz-relay/src/handlers/company_asks.rs` (`mod postgres_tests`)

**Interfaces:**
- Consumes: Task 6.3 (`p` tags on heads), Task 6.4 (`decision_inbox::*`), `crate::handlers::req::build_event_query_from_filter(&Filter, &[u8], &AppState, CommunityId) -> EventQuery` (`req.rs:862`), `crate::handlers::req::apply_reader_channel_scope` (`req.rs:1146`), `state.db.get_accessible_channel_ids(CommunityId, &[u8])`, `state.db.query_events(&EventQuery)`.
- Produces: the wire contract the app uses (Task 6.9): an owner or admin who sends `{"kinds":[30643],"authors":[<relay self>],"#p":[<own hex>]}` (optionally with one `#d` ask coordinate) over WebSocket REQ or `POST /query` receives every relay-signed ask head that names them, in any conversation; every other caller gets ordinary channel-scoped results.

- [ ] **Step 1: Write the failing test**

Add inside `mod postgres_tests` in `crates/buzz-relay/src/handlers/company_asks.rs`:

```rust
    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn decision_inbox_serves_partners_outside_the_conversation_and_not_employees() {
        use crate::handlers::decision_inbox;
        use nostr::{Alphabet, Filter, SingleLetterTag};

        let fixture = fixture().await;
        let partner = Keys::generate();
        let employee = Keys::generate();
        add_actor(&fixture, &partner, Some("admin"), false, false).await;
        add_actor(&fixture, &employee, Some("member"), true, true).await;
        let relay = fixture.state.relay_keypair.public_key();
        let community = fixture.tenant.community();

        let money = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Approval,
            AskCategory::Money,
        );
        let (_, money_head) = create_ask(&fixture, &employee, money).await;

        let inbox_filter = |reader_hex: &str| {
            Filter::new()
                .kind(Kind::Custom(KIND_ASK_HEAD as u16))
                .author(relay)
                .custom_tag(SingleLetterTag::lowercase(Alphabet::P), reader_hex)
        };

        // The partner is not in the conversation: the ordinary read hides the head.
        let partner_hex = partner.public_key().to_hex();
        let partner_bytes = partner.public_key().to_bytes();
        let partner_filter = inbox_filter(&partner_hex);
        let accessible = fixture
            .state
            .db
            .get_accessible_channel_ids(community, &partner_bytes)
            .await
            .expect("partner conversations");
        assert!(!accessible.contains(&fixture.channel_id));
        let mut ordinary = crate::handlers::req::build_event_query_from_filter(
            &partner_filter,
            &partner_bytes,
            &fixture.state,
            community,
        )
        .await;
        crate::handlers::req::apply_reader_channel_scope(
            &mut ordinary,
            &partner_filter,
            None,
            &accessible,
            false,
        );
        let ordinary_rows = fixture
            .state
            .db
            .query_events(&ordinary)
            .await
            .expect("ordinary read");
        assert!(ordinary_rows
            .iter()
            .all(|row| row.event.id != money_head.event.id));

        // The inbox lifts the fence for partners and returns the head naming them.
        assert!(decision_inbox::can_read_decision_inbox(
            &partner_filter,
            &relay,
            &partner_hex,
            Some("admin")
        ));
        let mut inbox = crate::handlers::req::build_event_query_from_filter(
            &partner_filter,
            &partner_bytes,
            &fixture.state,
            community,
        )
        .await;
        decision_inbox::apply_decision_inbox_scope(&mut inbox, &partner_hex);
        let inbox_ids: Vec<_> = fixture
            .state
            .db
            .query_events(&inbox)
            .await
            .expect("inbox read")
            .into_iter()
            .filter(|row| decision_inbox::is_decision_head_for_reader(&row.event, &relay, &partner_hex))
            .map(|row| row.event.id)
            .collect();
        assert_eq!(inbox_ids, vec![money_head.event.id]);

        // An employee may not use the inbox, and no head names it.
        let employee_hex = employee.public_key().to_hex();
        let employee_bytes = employee.public_key().to_bytes();
        let employee_filter = inbox_filter(&employee_hex);
        assert!(!decision_inbox::can_read_decision_inbox(
            &employee_filter,
            &relay,
            &employee_hex,
            Some("member")
        ));
        let mut employee_query = crate::handlers::req::build_event_query_from_filter(
            &employee_filter,
            &employee_bytes,
            &fixture.state,
            community,
        )
        .await;
        decision_inbox::apply_decision_inbox_scope(&mut employee_query, &employee_hex);
        let employee_rows = fixture
            .state
            .db
            .query_events(&employee_query)
            .await
            .expect("employee read");
        assert!(employee_rows.iter().all(|row| !decision_inbox::is_decision_head_for_reader(
            &row.event,
            &relay,
            &employee_hex
        )));
    }
```

- [ ] **Step 2: Run the test to verify it passes on the helpers, then wire the transports**

Run: `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E 'test(/company_asks::postgres_tests::decision_inbox_serves/)'`
Expected: PASS. This test binds the shared helpers the transports call (query construction, scope, post-check) with real Postgres; it does not yet prove the transports call them. Task 6.7's end-to-end test fails until Step 3 lands, which is the failing test for the wiring below.

- [ ] **Step 3: Wire the inbox into WebSocket REQ (`req.rs`)**

Replace lines 130 to 134:

```rust
    let relay_pubkey = state.relay_keypair.public_key();
    let requested_tool_consent_inbox = filters
        .iter()
        .any(|filter| is_tool_consent_inbox_filter(filter, &relay_pubkey));
    let company_role = if requested_tool_consent_inbox && token_channel_ids.is_none() {
```

with:

```rust
    let relay_pubkey = state.relay_keypair.public_key();
    let reader_hex = hex::encode(&pubkey_bytes);
    let requested_tool_consent_inbox = filters
        .iter()
        .any(|filter| is_tool_consent_inbox_filter(filter, &relay_pubkey));
    let requested_decision_inbox = filters.iter().any(|filter| {
        super::decision_inbox::is_decision_inbox_filter(filter, &relay_pubkey, &reader_hex)
    });
    let company_role = if (requested_tool_consent_inbox || requested_decision_inbox)
        && token_channel_ids.is_none()
    {
```

Directly after the `tool_consent_inbox_filters` definition (ends at line 157), add:

```rust
    let decision_inbox_filters: HashSet<usize> = filters
        .iter()
        .enumerate()
        .filter_map(|(index, filter)| {
            super::decision_inbox::can_read_decision_inbox(
                filter,
                &relay_pubkey,
                &reader_hex,
                company_role.as_deref(),
            )
            .then_some(index)
        })
        .collect();
```

Replace the `apply_reader_channel_scope(...)` call at lines 388 to 394 with:

```rust
            if decision_inbox_filters.contains(&idx) {
                super::decision_inbox::apply_decision_inbox_scope(&mut params, &reader_hex);
            } else {
                apply_reader_channel_scope(
                    &mut params,
                    filter,
                    per_filter_channel,
                    &accessible_channels,
                    tool_consent_inbox_filters.contains(&idx),
                );
            }
```

Replace the row checks at lines 483 to 493:

```rust
            let is_company_tool_consent_inbox = tool_consent_inbox_filters.contains(&idx);
            if let Some(ch_id) = stored.channel_id {
                if !is_company_tool_consent_inbox && !accessible_channels.contains(&ch_id) {
                    continue;
                }
            }
            if is_company_tool_consent_inbox
                && !is_tool_consent_head_event(&stored.event, &relay_pubkey)
            {
                continue;
            }
```

with:

```rust
            let is_company_tool_consent_inbox = tool_consent_inbox_filters.contains(&idx);
            let is_decision_inbox = decision_inbox_filters.contains(&idx);
            if let Some(ch_id) = stored.channel_id {
                if !is_company_tool_consent_inbox
                    && !is_decision_inbox
                    && !accessible_channels.contains(&ch_id)
                {
                    continue;
                }
            }
            if is_company_tool_consent_inbox
                && !is_tool_consent_head_event(&stored.event, &relay_pubkey)
            {
                continue;
            }
            if is_decision_inbox
                && !super::decision_inbox::is_decision_head_for_reader(
                    &stored.event,
                    &relay_pubkey,
                    &reader_hex,
                )
            {
                continue;
            }
```

- [ ] **Step 4: Wire the inbox into the HTTP bridge (`bridge.rs`)**

Replace lines 1195 to 1216 (from `let relay_pubkey = ...` through the `tool_consent_inbox_authorized` statement) with:

```rust
    let relay_pubkey = state.relay_keypair.public_key();
    let requested_tool_consent_inbox = filters
        .iter()
        .any(|filter| crate::handlers::req::is_tool_consent_inbox_filter(filter, &relay_pubkey));
    let requested_decision_inbox = filters.iter().any(|filter| {
        crate::handlers::decision_inbox::is_decision_inbox_filter(
            filter,
            &relay_pubkey,
            &authed_pubkey_hex,
        )
    });
    let company_role = if requested_tool_consent_inbox || requested_decision_inbox {
        state
            .db
            .get_relay_member(tenant.community(), &authed_pubkey_hex)
            .await
            .map_err(|error| internal_error(&format!("company inbox role lookup: {error}")))?
            .map(|member| member.role)
    } else {
        None
    };
    let tool_consent_inbox_authorized = filters.iter().any(|filter| {
        crate::handlers::req::can_read_tool_consent_inbox(
            filter,
            &relay_pubkey,
            company_role.as_deref(),
        )
    });
    let decision_inbox_authorized = filters.iter().any(|filter| {
        crate::handlers::decision_inbox::can_read_decision_inbox(
            filter,
            &relay_pubkey,
            &authed_pubkey_hex,
            company_role.as_deref(),
        )
    });
```

Replace lines 1473 to 1493 (from `let is_company_tool_consent_inbox = ...` through the `buzz-channel` block) with:

```rust
        let is_company_tool_consent_inbox = tool_consent_inbox_authorized
            && crate::handlers::req::is_tool_consent_inbox_filter(filter, &relay_pubkey);
        let is_decision_inbox = decision_inbox_authorized
            && crate::handlers::decision_inbox::is_decision_inbox_filter(
                filter,
                &relay_pubkey,
                &authed_pubkey_hex,
            );
        let mut query = crate::handlers::req::build_event_query_from_filter(
            filter,
            &pubkey_bytes,
            state,
            tenant.community(),
        )
        .await;
        if is_decision_inbox {
            crate::handlers::decision_inbox::apply_decision_inbox_scope(
                &mut query,
                &authed_pubkey_hex,
            );
        } else {
            crate::handlers::req::apply_reader_channel_scope(
                &mut query,
                filter,
                extract_channel_from_filter(filter),
                &accessible_channels,
                is_company_tool_consent_inbox,
            );
        }
        if !is_company_tool_consent_inbox && !is_decision_inbox {
            if let Some(channel) = extract_buzz_channel(raw) {
                query.custom_tag = Some(("buzz-channel".into(), channel.into()));
            }
        }
```

Replace lines 1551 to 1567 (the per-row checks) with:

```rust
                    let is_company_tool_consent_inbox = tool_consent_inbox_authorized
                        && crate::handlers::req::is_tool_consent_inbox_filter(
                            filter,
                            &relay_pubkey,
                        );
                    let is_decision_inbox = decision_inbox_authorized
                        && crate::handlers::decision_inbox::is_decision_inbox_filter(
                            filter,
                            &relay_pubkey,
                            &authed_pubkey_hex,
                        );
                    if !is_company_tool_consent_inbox
                        && !is_decision_inbox
                        && !event_in_accessible_channel(&se, &accessible_channels)
                    {
                        continue;
                    }
                    if is_company_tool_consent_inbox
                        && !crate::handlers::req::is_tool_consent_head_event(
                            &se.event,
                            &relay_pubkey,
                        )
                    {
                        continue;
                    }
                    if is_decision_inbox
                        && !crate::handlers::decision_inbox::is_decision_head_for_reader(
                            &se.event,
                            &relay_pubkey,
                            &authed_pubkey_hex,
                        )
                    {
                        continue;
                    }
```

- [ ] **Step 5: Document the inbox**

In `docs/company-records.md`, directly after the "Needs me" paragraph that ends "link to the thread containing the exact action preview." (line 325), add:

```markdown
### Decision inbox

The relay writes one `["p", <hex>]` tag on every ask head for each person who
may decide the ask, and recomputes the list on every head write (create,
cancel, response, secret activation):

| Ask | People named |
| --- | --- |
| Category `money`, `hire`, `tool`, `secret` or `duty`, or a member proposal | The owner and every admin (partners are admins), plus a human addressee |
| Category `general` with no addressee | The owner and every admin |
| Category `general` addressed to a person | That person |
| Addressed to an employee | Nobody: the employee answers it |
| Type `tool_consent` | Nobody: the head keeps its exact four-tag shape and is read through the tool consent inbox (`#t` = `tool_consent`) |

Employees (managed agents) are never named, even with an admin role. A head
names at most 128 people: the owner first, then admins in the order they
joined.

Needs you reads decisions with one global filter,
`{"kinds":[30643],"authors":[<relay self>],"#p":[<own hex>]}`, optionally
narrowed to one ask with a single `#d` coordinate. The relay serves it over
WebSocket and the HTTP bridge only to community owners and admins, and lifts
the conversation fence for it, because owners and admins may decide authority
asks in conversations they are not part of. Every other caller gets ordinary
channel-scoped results.

The inbox is historical: a global subscription never receives channel-scoped
events live. Clients run the inbox query on connect, on reconnect and every
60 seconds while Needs you is on screen, and keep their ordinary channel
subscriptions for kind 30643 for live updates in conversations they belong to.

Client backfill rule: someone who became an owner or admin after an ask was
written is not named on that head until its next write. Clients therefore also
treat an open head from an ordinary channel read as needing the viewer when the
viewer is an owner or admin and the ask is an authority ask, a member proposal
or an unaddressed `general` ask, and always when the ask is addressed to the
viewer.
```

- [ ] **Step 6: Run the checks**

Run: `cargo test -p buzz-relay --lib handlers::decision_inbox::tests && cargo clippy -p buzz-relay --all-targets -- -D warnings`
Expected: PASS and no warnings. The end-to-end proof of the wiring is Task 6.7.

- [ ] **Step 7: Commit**

```bash
git add crates/buzz-relay/src/handlers/req.rs crates/buzz-relay/src/api/bridge.rs crates/buzz-relay/src/handlers/company_asks.rs docs/company-records.md
git commit -s -m "feat(relay): serve the Needs you decision inbox to owners and admins"
```

---

### Task 6.6: The relay accepts brief records

**Files:**
- Create: `crates/buzz-relay/src/handlers/company_briefs.rs`
- Modify: `crates/buzz-relay/src/handlers/mod.rs:15-16` (register after `company_asks`)
- Modify: `crates/buzz-relay/src/handlers/ingest.rs:453` (`required_scope_for_kind`), `:695` (`is_global_only_kind`), `:2841` (validation hook before `KIND_PROJECT`)
- Modify: `docs/company-records.md:27-58` (kind registry) and the end of the document (new "Briefs" section before "Proof boundaries", line 988)
- Test: `crates/buzz-relay/src/handlers/company_briefs.rs` (`mod postgres_tests`)

**Interfaces:**
- Consumes: Task 6.1 (`parse_brief_content`, `KIND_BRIEF_HEAD`); `super::company_member_records::is_registered_employee(&AppState, CommunityId, &str) -> Result<bool, IngestError>` (`company_member_records.rs:283`).
- Produces: `pub(crate) async fn validate_brief_write(tenant: &TenantContext, state: &AppState, event: &nostr::Event) -> Result<(), IngestError>`; the relay stores accepted briefs as community-wide parameterized replaceable events and fans them out to global subscriptions.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-relay/src/handlers/company_briefs.rs` with this test module:

```rust
#[cfg(test)]
mod postgres_tests {
    use super::*;
    use buzz_core::company_briefs::{BriefRecord, BriefType, BRIEF_SCHEMA_VERSION};
    use buzz_core::kind::KIND_BRIEF_HEAD;
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use std::sync::Arc;
    use std::time::Duration;
    use uuid::Uuid;

    struct Fixture {
        state: Arc<AppState>,
        tenant: TenantContext,
        owner: Keys,
        employee: Keys,
    }

    async fn fixture() -> Fixture {
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
        let host = format!("briefs-{}.test", community_uuid.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_uuid)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_uuid), host);
        let owner = Keys::generate();
        let employee = Keys::generate();
        for keys in [&owner, &employee] {
            state
                .db
                .ensure_user(tenant.community(), &keys.public_key().to_bytes())
                .await
                .expect("ensure identity");
        }
        state
            .db
            .add_relay_member(tenant.community(), &owner.public_key().to_hex(), "owner", None)
            .await
            .expect("add the owner");
        state
            .db
            .set_agent_owner(
                tenant.community(),
                &employee.public_key().to_bytes(),
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("bind the employee to its owner");
        Fixture {
            state,
            tenant,
            owner,
            employee,
        }
    }

    fn brief(keys: &Keys, d_tag: &str, brief_type: BriefType, extra: Vec<Tag>) -> nostr::Event {
        let record = BriefRecord {
            schema_version: BRIEF_SCHEMA_VERSION,
            brief_type,
            text: "Morning. Naledi's posts are ready.".into(),
            links: Vec::new(),
            credits_used: None,
            written_at: "2026-10-12T08:30:00+02:00".into(),
        };
        let mut tags = vec![Tag::parse(["d", d_tag]).expect("d tag")];
        tags.extend(extra);
        EventBuilder::new(
            Kind::Custom(KIND_BRIEF_HEAD as u16),
            serde_json::to_string(&record).expect("serialize brief"),
        )
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign brief")
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn only_employees_publish_briefs_with_their_d_tag_and_an_optional_auth_tag() {
        let fixture = fixture().await;
        let employee = &fixture.employee;

        let morning = brief(employee, "brief:2026-10-12:morning", BriefType::Morning, Vec::new());
        validate_brief_write(&fixture.tenant, &fixture.state, &morning)
            .await
            .expect("an employee may publish a brief");

        let signature = "f".repeat(128);
        let owner_hex = fixture.owner.public_key().to_hex();
        let auth = Tag::parse(["auth", owner_hex.as_str(), "", signature.as_str()])
            .expect("auth tag");
        let with_auth = brief(employee, "brief:2026-10-12:morning", BriefType::Morning, vec![auth]);
        validate_brief_write(&fixture.tenant, &fixture.state, &with_auth)
            .await
            .expect("the harness auth tag is allowed");

        let from_owner = brief(
            &fixture.owner,
            "brief:2026-10-12:morning",
            BriefType::Morning,
            Vec::new(),
        );
        assert!(matches!(
            validate_brief_write(&fixture.tenant, &fixture.state, &from_owner).await,
            Err(IngestError::AuthFailed(message)) if message.contains("only employees can publish briefs")
        ));

        let channel = Uuid::new_v4().to_string();
        let h_tag = Tag::parse(["h", channel.as_str()]).expect("h tag");
        let with_h = brief(employee, "brief:2026-10-12:morning", BriefType::Morning, vec![h_tag]);
        assert!(matches!(
            validate_brief_write(&fixture.tenant, &fixture.state, &with_h).await,
            Err(IngestError::Rejected(message)) if message.contains("exactly one d tag")
        ));

        let wrong_day = brief(employee, "brief:2026-10-12:friday", BriefType::Friday, Vec::new());
        assert!(matches!(
            validate_brief_write(&fixture.tenant, &fixture.state, &wrong_day).await,
            Err(IngestError::Rejected(message)) if message.contains("a Friday wrap must be for a Friday")
        ));

        let mismatch = brief(employee, "brief:2026-10-16:friday", BriefType::Morning, Vec::new());
        assert!(matches!(
            validate_brief_write(&fixture.tenant, &fixture.state, &mismatch).await,
            Err(IngestError::Rejected(message)) if message.contains("d-tag")
        ));
    }
}
```

Register the module in `crates/buzz-relay/src/handlers/mod.rs`, directly after `pub mod company_asks;`:

```rust
/// Ingest checks for Scout's briefs and Friday wraps (kind 30659).
pub mod company_briefs;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E 'test(/company_briefs::postgres_tests::/)'`
Expected: FAIL to compile with "cannot find function `validate_brief_write`".

- [ ] **Step 3: Write the implementation**

Put above the test module in `crates/buzz-relay/src/handlers/company_briefs.rs`:

```rust
//! Ingest checks for briefs and Friday wraps (kind 30659).
//!
//! Scout writes one brief per weekday morning and one Friday wrap. The relay
//! stores them as ordinary employee-signed, community-wide parameterized
//! replaceable events after these checks: the event carries exactly one `d`
//! tag (plus, optionally, the harness's NIP-OA `auth` tag), its content
//! matches the brief schema and its `d` coordinate, and the author is an
//! employee of this company.

use buzz_core::company_briefs::parse_brief_content;
use buzz_core::tenant::TenantContext;
use nostr::Event;

use super::ingest::IngestError;
use crate::state::AppState;

const TAG_RULE: &str = "invalid: a brief carries exactly one d tag and no other tags";

/// Validate a brief before the generic ingest path stores it.
pub(crate) async fn validate_brief_write(
    tenant: &TenantContext,
    state: &AppState,
    event: &Event,
) -> Result<(), IngestError> {
    let d_tag = brief_d_tag(event)?;
    parse_brief_content(&d_tag, &event.content)
        .map_err(|error| IngestError::Rejected(format!("invalid: brief: {error}")))?;
    let author = event.pubkey.to_hex();
    if !super::company_member_records::is_registered_employee(state, tenant.community(), &author)
        .await?
    {
        return Err(IngestError::AuthFailed(
            "forbidden: only employees can publish briefs".into(),
        ));
    }
    Ok(())
}

/// The single `d` value; one NIP-OA `auth` tag is the only other tag allowed.
fn brief_d_tag(event: &Event) -> Result<String, IngestError> {
    let mut d_value: Option<String> = None;
    let mut auth_seen = false;
    for tag in event.tags.iter() {
        let parts = tag.as_slice();
        match parts.first().map(String::as_str) {
            Some("d") if d_value.is_none() && parts.len() == 2 => {
                d_value = parts.get(1).cloned();
            }
            Some("auth") if !auth_seen && parts.len() == 4 => auth_seen = true,
            _ => return Err(IngestError::Rejected(TAG_RULE.into())),
        }
    }
    d_value.ok_or_else(|| IngestError::Rejected(TAG_RULE.into()))
}
```

Wire it into `crates/buzz-relay/src/handlers/ingest.rs`.

In `required_scope_for_kind`, directly after the line `k if buzz_core::kind::COMPANY_RECORD_KINDS.contains(&k) => Ok(Scope::MessagesWrite),` (line 453), add:

```rust
        // Briefs and Friday wraps: employee-signed company records (company_briefs.rs).
        buzz_core::kind::KIND_BRIEF_HEAD => Ok(Scope::MessagesWrite),
```

In `is_global_only_kind`, directly after `| KIND_LESSON_ACTION` (line 695), add:

```rust
            // Scout's briefs and Friday wraps are community-wide employee records.
            | buzz_core::kind::KIND_BRIEF_HEAD
```

Directly before `if kind_u32 == KIND_PROJECT {` (line 2841), add:

```rust
    if kind_u32 == buzz_core::kind::KIND_BRIEF_HEAD {
        super::company_briefs::validate_brief_write(tenant, state, &event).await?;
    }

```

Document the record in `docs/company-records.md`. In the kind registry table, after the `30656` row, add:

```markdown
| 30659 | Brief and Friday wrap | Employee signed, replaceable | Scout briefs (new app only; the 1.0.x desktop does not mirror it) |
```

and before `## Proof boundaries`, add:

```markdown
## Briefs

Scout writes a morning brief on weekdays and a Friday wrap on Fridays as kind
30659, a community-wide parameterized replaceable event signed by the employee
itself. The `d` tag is `brief:<YYYY-MM-DD>:<morning|friday>` for the company's
calendar day, so a corrected brief replaces the earlier one for that day.

Content:
`{ "schemaVersion": 1, "type": "friday", "text": "...", "links": [{ "label": "Needs you", "target": { "screen": "T-05" } }], "creditsUsed": { "totalUsdCents": 910, "perEmployee": [{ "pubkey": "<hex>", "usdCents": 340 }] }, "writtenAt": "2026-10-16T16:00:04+02:00" }`

Rules: text 1 to 1200 characters; at most 8 links, each label 1 to 80
characters and each target a screen pack ID (`T-05`, `D-03a`) with an optional
record id of 1 to 200 printable characters; `creditsUsed` in whole US cents,
at most 32 rows, one per employee, none above the total; `writtenAt` in RFC
3339; a Friday wrap's day is a Friday; content at most 16 KB; unknown fields
are rejected. The event carries exactly one `d` tag and, when the harness adds
one, one NIP-OA `auth` tag; nothing else. Only employees of the company
(managed agents with an owner) may publish. Readers take the newest brief by
day, then the Friday wrap before the morning brief on the same day, then the
newest `created_at`. `colony brief publish` and `colony brief latest` write and
read these records.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@localhost:5432/postgres ./scripts/postgres-test-run.sh -p buzz-relay --lib -E 'test(/company_briefs::postgres_tests::/)'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_briefs.rs crates/buzz-relay/src/handlers/mod.rs crates/buzz-relay/src/handlers/ingest.rs docs/company-records.md
git commit -s -m "feat(relay): accept Scout's briefs and Friday wraps from employees"
```

---

### Task 6.7: End-to-end proof over WebSocket and HTTP

**Files:**
- Create: `crates/buzz-test-client/tests/e2e_company_needs_you.rs`
- Modify: `.github/workflows/_ci-relay.yml:621-622` ("Relay E2E tests" step)
- Test: the new file itself

**Interfaces:**
- Consumes: Tasks 6.3 to 6.6 on a running relay; `buzz_test_client::BuzzTestClient::{connect, subscribe, collect_until_eose, disconnect}` (`crates/buzz-test-client/src/lib.rs:90-200`); `buzz_sdk::asks::build_ask_action`.
- Produces: CI proof that the decision inbox and briefs work through the production transports.

- [ ] **Step 1: Write the end-to-end tests**

Create `crates/buzz-test-client/tests/e2e_company_needs_you.rs`:

```rust
//! Relay integration tests for the Needs you decision inbox and Scout's briefs.
//!
//! These cases run against the isolated CI relay, Postgres, and Redis service.

use std::time::Duration;

use buzz_core::company_briefs::{BriefRecord, BriefType, BRIEF_SCHEMA_VERSION};
use buzz_core::company_records::{
    ask_d_tag, AskAction, AskActionKind, AskCategory, AskHead, AskRecord, AskType,
    COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_HEAD, KIND_BRIEF_HEAD};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, PublicKey, SingleLetterTag, Tag};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "Needs you E2E tests only send events to a local relay"
    );
    url
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn relay_authority() -> String {
    let url = url::Url::parse(&relay_http_url()).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_string()
}

fn test_database_url() -> String {
    std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(host)
    .execute(&pool)
    .await
    .expect("seed E2E community");
    sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(host)
        .fetch_one(&pool)
        .await
        .expect("read E2E community")
}

async fn seed_relay_member(keys: &Keys, role: &str) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, $3, NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET role = $3, updated_at = now()",
    )
    .bind(community_id)
    .bind(keys.public_key().to_hex())
    .bind(role)
    .execute(&pool)
    .await
    .expect("seed E2E relay member");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey) VALUES ($1, $2) \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community_id)
    .bind(keys.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed E2E user");
}

async fn register_employee(employee: &Keys, owner: &Keys) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET agent_owner_pubkey = EXCLUDED.agent_owner_pubkey",
    )
    .bind(community_id)
    .bind(employee.public_key().to_bytes().as_slice())
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed employee identity");
}

async fn post_event(keys: &Keys, event: &Event) -> Value {
    let response = reqwest::Client::new()
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(event).expect("serialize E2E event"))
        .send()
        .await
        .expect("submit E2E event");
    response.json().await.expect("parse E2E response")
}

fn assert_accepted(response: &Value) {
    assert!(
        response["accepted"].as_bool().unwrap_or(false),
        "event was rejected: {response}"
    );
}

fn assert_rejected(response: &Value, expected: &str) {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
    let message = response["message"]
        .as_str()
        .or_else(|| response["error"].as_str())
        .unwrap_or_default();
    assert!(
        message.contains(expected),
        "rejection should explain {expected}: {response}"
    );
}

async fn create_private_channel(owner: &Keys) -> Uuid {
    let channel_id = Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["name", &format!("needs-you-{channel_id}")]).expect("channel name"),
            Tag::parse(["channel_type", "stream"]).expect("channel type"),
            Tag::parse(["visibility", "private"]).expect("channel visibility"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel creation");
    assert_accepted(&post_event(owner, &event).await);
    channel_id
}

async fn add_channel_member(owner: &Keys, member: &Keys, channel_id: Uuid) {
    let mut client = BuzzTestClient::connect(&relay_url(), owner)
        .await
        .expect("connect to add a channel member");
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .allow_self_tagging()
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["p", member.public_key().to_hex().as_str()]).expect("member pubkey"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel invite");
    let response = client.send_event(event).await.expect("add channel member");
    assert!(response.accepted, "channel invite rejected: {}", response.message);
    client.disconnect().await.expect("disconnect after invite");
}

async fn send_message(keys: &Keys, channel_id: Uuid, content: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(9), content)
        .tags([Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id")])
        .sign_with_keys(keys)
        .expect("sign source message");
    let event_id = event.id.to_hex();
    assert_accepted(&post_event(keys, &event).await);
    event_id
}

async fn submit_ask_action(keys: &Keys, channel_id: Uuid, action: &AskAction) -> Value {
    let event = buzz_sdk::asks::build_ask_action(channel_id, action)
        .expect("build ask action")
        .sign_with_keys(keys)
        .expect("sign ask action");
    post_event(keys, &event).await
}

async fn relay_self_pubkey() -> PublicKey {
    let body: Value = reqwest::Client::new()
        .get(format!("{}/", relay_http_url()))
        .header("Accept", "application/nostr+json")
        .send()
        .await
        .expect("fetch relay info")
        .json()
        .await
        .expect("parse relay info");
    let hex = body["self"].as_str().expect("relay info names its self key");
    PublicKey::from_hex(hex).expect("relay self key is hex")
}

async fn req_events(keys: &Keys, filter: Filter) -> Vec<Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to the relay");
    let sub_id = format!("needs-you-{}", Uuid::new_v4());
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read until EOSE");
    client.disconnect().await.expect("disconnect");
    events
}

async fn query_http(keys: &Keys, filter: Filter) -> Vec<Value> {
    let response = reqwest::Client::new()
        .post(format!("{}/query", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .json(&vec![filter])
        .send()
        .await
        .expect("query over HTTP");
    assert!(
        response.status().is_success(),
        "query failed: {}",
        response.status()
    );
    response.json().await.expect("parse query response")
}

fn inbox_filter(relay: PublicKey, reader: &Keys) -> Filter {
    Filter::new()
        .kind(Kind::Custom(KIND_ASK_HEAD as u16))
        .author(relay)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::P), reader.public_key().to_hex())
}

fn d_tag_of(event: &Event) -> Option<&str> {
    event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content())
}

fn named(event: &Event) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "p")
        .filter_map(|tag| tag.content().map(str::to_owned))
        .collect()
}

fn money_ask(ask_id: Uuid, root: &str) -> AskRecord {
    AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Money,
        title: "Spend $20 on an Instagram ad this weekend?".into(),
        body: None,
        thread_root_event_id: Some(root.into()),
        thread_start: None,
        addressee_pubkey: None,
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: None,
        member_proposal: None,
        secret_request: None,
        hire_proposal: None,
        duty_proposal: None,
        spend_allowance_proposal: None,
    }
}

fn brief_event(keys: &Keys, d_tag: &str, brief_type: BriefType, extra: Vec<Tag>) -> Event {
    let record = BriefRecord {
        schema_version: BRIEF_SCHEMA_VERSION,
        brief_type,
        text: "Naledi's posts for next week are ready, and Thabo is waiting on his order.".into(),
        links: Vec::new(),
        credits_used: None,
        written_at: "2026-10-12T08:30:04+02:00".into(),
    };
    let mut tags = vec![Tag::parse(["d", d_tag]).expect("d tag")];
    tags.extend(extra);
    EventBuilder::new(
        Kind::Custom(KIND_BRIEF_HEAD as u16),
        serde_json::to_string(&record).expect("serialize brief"),
    )
    .tags(tags)
    .sign_with_keys(keys)
    .expect("sign brief")
}

#[tokio::test]
#[ignore]
async fn company_decision_inbox_reaches_owner_and_admins_but_not_employees() {
    let owner = Keys::generate();
    let partner = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&partner, "admin").await;
    register_employee(&employee, &owner).await;
    let relay = relay_self_pubkey().await;

    // A private conversation the partner is not part of.
    let channel_id = create_private_channel(&owner).await;
    add_channel_member(&owner, &employee, channel_id).await;
    let root = send_message(&employee, channel_id, "I need a decision on ad spend.").await;
    let ask_id = Uuid::new_v4();
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(money_ask(ask_id, &root)),
        reason: None,
    };
    assert_accepted(&submit_ask_action(&employee, channel_id, &action).await);
    let d_tag = ask_d_tag(channel_id, ask_id);

    // The ordinary read keeps the conversation fence: the partner sees nothing.
    let ordinary = req_events(
        &partner,
        Filter::new()
            .kind(Kind::Custom(KIND_ASK_HEAD as u16))
            .custom_tag(SingleLetterTag::lowercase(Alphabet::D), d_tag.clone()),
    )
    .await;
    assert!(ordinary.is_empty(), "the partner is not in this conversation");

    // The decision inbox reaches the partner and the owner over WebSocket.
    for reader in [&partner, &owner] {
        let events = req_events(reader, inbox_filter(relay, reader)).await;
        let head = events
            .iter()
            .find(|event| d_tag_of(event) == Some(d_tag.as_str()))
            .expect("the inbox returns the ask");
        let content: AskHead = serde_json::from_str(&head.content).expect("ask head content");
        assert_eq!(content.ask_id, ask_id);
        let people = named(head);
        assert!(people.contains(&owner.public_key().to_hex()));
        assert!(people.contains(&partner.public_key().to_hex()));
        assert!(!people.contains(&employee.public_key().to_hex()));
    }

    // The HTTP bridge serves the same inbox.
    let over_http = query_http(&partner, inbox_filter(relay, &partner)).await;
    assert!(over_http.iter().any(|event| event["tags"]
        .as_array()
        .is_some_and(|tags| tags.iter().any(|tag| tag[0] == "d" && tag[1] == d_tag.as_str()))));

    // The employee's own inbox stays empty: it is never named as a decider.
    let employee_inbox = req_events(&employee, inbox_filter(relay, &employee)).await;
    assert!(employee_inbox
        .iter()
        .all(|event| d_tag_of(event) != Some(d_tag.as_str())));
}

#[tokio::test]
#[ignore]
async fn company_briefs_accept_only_employee_authors_and_valid_coordinates() {
    let owner = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    register_employee(&employee, &owner).await;

    let morning = brief_event(&employee, "brief:2026-10-12:morning", BriefType::Morning, Vec::new());
    assert_accepted(&post_event(&employee, &morning).await);

    let from_owner =
        brief_event(&owner, "brief:2026-10-12:morning", BriefType::Morning, Vec::new());
    assert_rejected(
        &post_event(&owner, &from_owner).await,
        "only employees can publish briefs",
    );

    let wrong_day = brief_event(&employee, "brief:2026-10-12:friday", BriefType::Friday, Vec::new());
    assert_rejected(
        &post_event(&employee, &wrong_day).await,
        "a Friday wrap must be for a Friday",
    );

    let owner_hex = owner.public_key().to_hex();
    let extra_p = Tag::parse(["p", owner_hex.as_str()]).expect("p tag");
    let tagged = brief_event(&employee, "brief:2026-10-16:friday", BriefType::Friday, vec![extra_p]);
    assert_rejected(&post_event(&employee, &tagged).await, "exactly one d tag");

    let wrap = brief_event(&employee, "brief:2026-10-16:friday", BriefType::Friday, Vec::new());
    assert_accepted(&post_event(&employee, &wrap).await);

    let briefs = req_events(
        &owner,
        Filter::new()
            .kind(Kind::Custom(KIND_BRIEF_HEAD as u16))
            .author(employee.public_key()),
    )
    .await;
    let ids: Vec<_> = briefs.iter().map(|event| event.id).collect();
    assert!(ids.contains(&morning.id), "the owner reads the morning brief");
    assert!(ids.contains(&wrap.id), "the owner reads the Friday wrap");
}
```

In `.github/workflows/_ci-relay.yml`, in the "Relay E2E tests" step, add after the two `e2e_company_duties_lessons` lines (621 to 622):

```yaml
          cargo test -p buzz-test-client --test e2e_company_needs_you -- --ignored --nocapture
```

- [ ] **Step 2: Run against the code before Tasks 6.3 to 6.6 to see it fail**

On a branch without Tasks 6.3 to 6.6 (or by stashing their changes with `git stash push -u -m needs-you-e2e-check` and re-applying by SHA afterwards), run:
`./scripts/start-relay-for-tests.sh && RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_needs_you -- --ignored --nocapture`
Expected: FAIL: "the inbox returns the ask" panics for the partner, and the brief posts are rejected as an unknown kind.

- [ ] **Step 3: Run with Tasks 6.3 to 6.6 in place**

Run: `./scripts/start-relay-for-tests.sh && RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_needs_you -- --ignored --nocapture`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/buzz-test-client/tests/e2e_company_needs_you.rs .github/workflows/_ci-relay.yml
git commit -s -m "test(relay): end-to-end proof for the decision inbox and briefs"
```

---

### Task 6.8: `colony brief publish` and `colony brief latest`

**Files:**
- Create: `crates/buzz-cli/src/commands/brief.rs`
- Modify: `crates/buzz-cli/src/commands/mod.rs:2` (register after `asks`)
- Modify: `crates/buzz-cli/src/lib.rs:271-273` (`Cmd` enum), `:1443-1451` (after `LessonConfidenceArg`), `:3118-3119` (dispatch), `:3290-3326` (`command_inventory_is_stable`)
- Test: `crates/buzz-cli/src/commands/brief.rs`, `crates/buzz-cli/src/lib.rs` (tests module)

**Interfaces:**
- Consumes: Task 6.1 (`parse_brief_content`, types), Task 6.2 (`buzz_sdk::company_briefs::build_brief`), `BuzzClient::{sign_event, submit_event, query_paginated, keys}` (`crates/buzz-cli/src/client.rs:562-975`), `normalize_events`, `normalize_write_response`, `crate::validate::{validate_hex64, sdk_err}`.
- Produces (for part G, Scout's skill):
  - `colony brief publish --type morning|friday --date YYYY-MM-DD --text "<1 to 1200 characters>" [--link "Label|SCREEN" | --link "Label|SCREEN|ID"]... [--credits-total-cents N [--credit PUBKEY=CENTS]...]` prints `{event_id, accepted, message}`.
  - `colony brief latest [--author HEX] [--type morning|friday]` prints a normalized array with zero or one event: the newest valid brief by day, then Friday wrap before morning brief, then `created_at`. Without `--author` it reads the caller's own briefs.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-cli/src/commands/brief.rs` with this test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCOUT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const MAYA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn record(brief_type: BriefType) -> BriefRecord {
        build_record(
            brief_type,
            "Morning. Naledi's posts are ready.",
            &["Needs you|T-05".to_owned()],
            None,
            &[],
            "2026-10-12T08:30:00Z",
        )
        .expect("valid record")
    }

    fn event(author: &str, d_tag: &str, record: &BriefRecord, created_at: u64) -> Value {
        json!({
            "id": format!("{created_at:064x}"),
            "pubkey": author,
            "kind": KIND_BRIEF_HEAD,
            "created_at": created_at,
            "tags": [["d", d_tag]],
            "content": serde_json::to_string(record).expect("serialize brief"),
            "sig": "0".repeat(128),
        })
    }

    #[test]
    fn links_and_credits_parse_from_flags() {
        assert_eq!(
            parse_link("Needs you|T-05").expect("two parts"),
            BriefLink {
                label: "Needs you".into(),
                target: BriefTarget {
                    screen: "T-05".into(),
                    id: None,
                },
            }
        );
        assert_eq!(
            parse_link(" Spring posts | D-03a | post-42 ")
                .expect("three parts")
                .target
                .id
                .as_deref(),
            Some("post-42")
        );
        for bad in ["Needs you", "a|b|c|d"] {
            assert!(parse_link(bad).is_err(), "{bad}");
        }
        assert_eq!(
            parse_credit(&format!("{MAYA}=340")).expect("credit"),
            BriefEmployeeCredits {
                pubkey: MAYA.into(),
                usd_cents: 340,
            }
        );
        assert!(parse_credit("not-a-key=10").is_err());
        assert!(parse_credit(&format!("{MAYA}=ten")).is_err());
    }

    #[test]
    fn build_record_trims_text_and_carries_credits() {
        let wrap = build_record(
            BriefType::Friday,
            "  Wrap.  ",
            &[],
            Some(910),
            &[format!("{MAYA}=340")],
            "2026-10-16T16:00:00Z",
        )
        .expect("wrap");
        assert_eq!(wrap.text, "Wrap.");
        assert_eq!(wrap.schema_version, BRIEF_SCHEMA_VERSION);
        assert_eq!(
            wrap.credits_used,
            Some(BriefCredits {
                total_usd_cents: 910,
                per_employee: vec![BriefEmployeeCredits {
                    pubkey: MAYA.into(),
                    usd_cents: 340,
                }],
            })
        );
    }

    #[test]
    fn dates_must_be_calendar_days() {
        assert_eq!(
            parse_date("2026-10-12").expect("date"),
            NaiveDate::from_ymd_opt(2026, 10, 12).expect("valid date")
        );
        assert!(parse_date("12/10/2026").is_err());
    }

    #[test]
    fn latest_prefers_the_newest_day_then_the_friday_wrap() {
        let events = vec![
            event(SCOUT, "brief:2026-10-15:morning", &record(BriefType::Morning), 30),
            event(SCOUT, "brief:2026-10-16:morning", &record(BriefType::Morning), 20),
            event(SCOUT, "brief:2026-10-16:friday", &record(BriefType::Friday), 10),
            event(MAYA, "brief:2026-10-17:morning", &record(BriefType::Morning), 40),
            json!({
                "pubkey": SCOUT,
                "kind": KIND_BRIEF_HEAD,
                "created_at": 50,
                "tags": [["d", "brief:2026-10-18:morning"]],
                "content": "{}"
            }),
        ];
        let latest = select_latest(&events, SCOUT, None).expect("a latest brief");
        assert_eq!(latest["tags"][0][1], "brief:2026-10-16:friday");
        let morning =
            select_latest(&events, SCOUT, Some(BriefType::Morning)).expect("a morning brief");
        assert_eq!(morning["tags"][0][1], "brief:2026-10-16:morning");
        assert!(select_latest(&[], SCOUT, None).is_none());
    }
}
```

Register the module in `crates/buzz-cli/src/commands/mod.rs` after `pub mod asks;`:

```rust
pub mod brief;
```

In `crates/buzz-cli/src/lib.rs`, add `"brief",` after `"asks",` in `command_inventory_is_stable`, and add this test to the same tests module:

```rust
    #[test]
    fn brief_publish_needs_type_date_and_text() {
        assert!(Cli::try_parse_from([
            "colony",
            "brief",
            "publish",
            "--type",
            "morning",
            "--date",
            "2026-10-12",
            "--text",
            "Morning.",
            "--link",
            "Needs you|T-05",
        ])
        .is_ok());
        assert!(Cli::try_parse_from(["colony", "brief", "publish", "--type", "morning", "--text", "Morning."]).is_err());
        assert!(Cli::try_parse_from([
            "colony", "brief", "publish", "--type", "evening", "--date", "2026-10-12", "--text", "x",
        ])
        .is_err());
        let credit = format!("{}=120", "a".repeat(64));
        assert!(
            Cli::try_parse_from([
                "colony",
                "brief",
                "publish",
                "--type",
                "friday",
                "--date",
                "2026-10-16",
                "--text",
                "Wrap.",
                "--credit",
                credit.as_str(),
            ])
            .is_err(),
            "--credit needs --credits-total-cents"
        );
        assert!(Cli::try_parse_from(["colony", "brief", "latest"]).is_ok());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-cli --lib brief`
Expected: FAIL to compile with "cannot find function `parse_link`" and "cannot find type `BriefCmd`".

- [ ] **Step 3: Write the implementation**

In `crates/buzz-cli/src/lib.rs`, add to `enum Cmd` directly after the `Asks(AsksCmd),` variant:

```rust
    /// Publish and read morning briefs and Friday wraps
    #[command(subcommand)]
    Brief(BriefCmd),
```

Directly after `pub enum LessonConfidenceArg { ... }`, add:

```rust
#[derive(Subcommand)]
pub enum BriefCmd {
    /// Publish a morning brief or Friday wrap for one day
    Publish {
        /// morning or friday
        #[arg(long = "type", value_enum)]
        brief_type: BriefTypeArg,
        /// The day the brief is for, YYYY-MM-DD in the company time zone
        #[arg(long)]
        date: String,
        /// The brief, 1 to 1200 characters
        #[arg(long)]
        text: String,
        /// A link as "Label|SCREEN" or "Label|SCREEN|ID", for example "Needs you|T-05"; at most 8
        #[arg(long = "link")]
        links: Vec<String>,
        /// Credits the whole team used, in US cents (Friday wraps)
        #[arg(long)]
        credits_total_cents: Option<u64>,
        /// Credits one employee used as PUBKEY=CENTS; repeat per employee
        #[arg(long = "credit", requires = "credits_total_cents")]
        credits: Vec<String>,
    },
    /// Print the latest brief from an employee: newest day first, Friday wrap before morning brief
    Latest {
        /// Author public key in 64-character hex; defaults to you
        #[arg(long)]
        author: Option<String>,
        /// Only morning briefs or only Friday wraps
        #[arg(long = "type", value_enum)]
        brief_type: Option<BriefTypeArg>,
    },
}

#[derive(Clone, Copy, clap::ValueEnum)]
pub enum BriefTypeArg {
    #[value(name = "morning")]
    Morning,
    #[value(name = "friday")]
    Friday,
}
```

In the dispatch `match`, directly after `Cmd::Asks(sub) => commands::asks::dispatch(sub, &client).await,`, add:

```rust
        Cmd::Brief(sub) => commands::brief::dispatch(sub, &client).await,
```

Put the implementation above the test module in `crates/buzz-cli/src/commands/brief.rs`:

```rust
//! Publish and read briefs and Friday wraps (kind 30659).
//!
//! Scout runs `colony brief publish` from its morning brief and Friday wrap
//! routines; `colony brief latest` reads the newest one back.

use buzz_core::company_briefs::{
    parse_brief_content, BriefCredits, BriefEmployeeCredits, BriefLink, BriefRecord,
    BriefTarget, BriefType, BRIEF_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_BRIEF_HEAD;
use chrono::{NaiveDate, SecondsFormat, Utc};
use serde_json::Value;

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;
use crate::{BriefCmd, BriefTypeArg};

/// Newest brief events read when looking for the latest one.
const BRIEF_QUERY_BOUND: u32 = 500;

/// Run one `colony brief` subcommand.
pub async fn dispatch(cmd: BriefCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        BriefCmd::Publish {
            brief_type,
            date,
            text,
            links,
            credits_total_cents,
            credits,
        } => {
            let date = parse_date(&date)?;
            let written_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
            let record = build_record(
                brief_type_of(brief_type),
                &text,
                &links,
                credits_total_cents,
                &credits,
                &written_at,
            )?;
            let builder = buzz_sdk::company_briefs::build_brief(&record, date)
                .map_err(crate::validate::sdk_err)?;
            let event = client.sign_event(builder)?;
            let response = client.submit_event(event).await?;
            println!("{}", normalize_write_response(&response));
            Ok(())
        }
        BriefCmd::Latest { author, brief_type } => {
            let author = match author {
                Some(value) => normalize_pubkey(&value)?,
                None => client.keys().public_key().to_hex(),
            };
            let events = client
                .query_paginated(
                    serde_json::json!({ "kinds": [KIND_BRIEF_HEAD], "authors": [author] }),
                    BRIEF_QUERY_BOUND,
                )
                .await?;
            let latest: Vec<Value> = select_latest(&events, &author, brief_type.map(brief_type_of))
                .into_iter()
                .collect();
            println!("{}", normalize_events(&latest));
            Ok(())
        }
    }
}

fn brief_type_of(arg: BriefTypeArg) -> BriefType {
    match arg {
        BriefTypeArg::Morning => BriefType::Morning,
        BriefTypeArg::Friday => BriefType::Friday,
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, CliError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| CliError::Usage(format!("--date must be YYYY-MM-DD: {value}")))
}

fn parse_link(value: &str) -> Result<BriefLink, CliError> {
    let parts: Vec<&str> = value.split('|').map(str::trim).collect();
    let (label, screen, id) = match parts.as_slice() {
        [label, screen] => (*label, *screen, None),
        [label, screen, id] => (*label, *screen, Some((*id).to_owned())),
        _ => {
            return Err(CliError::Usage(format!(
                "--link must be \"Label|SCREEN\" or \"Label|SCREEN|ID\": {value}"
            )))
        }
    };
    Ok(BriefLink {
        label: label.to_owned(),
        target: BriefTarget {
            screen: screen.to_owned(),
            id,
        },
    })
}

fn parse_credit(value: &str) -> Result<BriefEmployeeCredits, CliError> {
    let (pubkey, cents) = value
        .split_once('=')
        .ok_or_else(|| CliError::Usage(format!("--credit must be PUBKEY=CENTS: {value}")))?;
    let pubkey = normalize_pubkey(pubkey)?;
    let usd_cents = cents
        .trim()
        .parse::<u64>()
        .map_err(|_| CliError::Usage(format!("--credit cents must be a whole number: {value}")))?;
    Ok(BriefEmployeeCredits { pubkey, usd_cents })
}

fn normalize_pubkey(value: &str) -> Result<String, CliError> {
    let value = value.trim();
    validate_hex64(value)?;
    Ok(value.to_ascii_lowercase())
}

fn build_record(
    brief_type: BriefType,
    text: &str,
    links: &[String],
    credits_total_cents: Option<u64>,
    credits: &[String],
    written_at: &str,
) -> Result<BriefRecord, CliError> {
    let links = links
        .iter()
        .map(|value| parse_link(value))
        .collect::<Result<Vec<_>, _>>()?;
    let credits_used = match credits_total_cents {
        Some(total_usd_cents) => Some(BriefCredits {
            total_usd_cents,
            per_employee: credits
                .iter()
                .map(|value| parse_credit(value))
                .collect::<Result<Vec<_>, _>>()?,
        }),
        None => None,
    };
    Ok(BriefRecord {
        schema_version: BRIEF_SCHEMA_VERSION,
        brief_type,
        text: text.trim().to_owned(),
        links,
        credits_used,
        written_at: written_at.to_owned(),
    })
}

fn type_rank(brief_type: BriefType) -> u8 {
    match brief_type {
        BriefType::Morning => 0,
        BriefType::Friday => 1,
    }
}

fn first_d_tag(event: &Value) -> Option<String> {
    event.get("tags")?.as_array()?.iter().find_map(|tag| {
        let tag = tag.as_array()?;
        if tag.first()?.as_str()? == "d" {
            tag.get(1)?.as_str().map(str::to_owned)
        } else {
            None
        }
    })
}

/// Newest valid brief from `author`: by day, then Friday wrap before morning brief, then `created_at`.
fn select_latest(events: &[Value], author: &str, only: Option<BriefType>) -> Option<Value> {
    let mut best: Option<((NaiveDate, u8, u64), &Value)> = None;
    for event in events {
        if event.get("pubkey").and_then(Value::as_str) != Some(author)
            || event.get("kind").and_then(Value::as_u64) != Some(u64::from(KIND_BRIEF_HEAD))
        {
            continue;
        }
        let (Some(d_tag), Some(content)) =
            (first_d_tag(event), event.get("content").and_then(Value::as_str))
        else {
            continue;
        };
        let Ok((date, record)) = parse_brief_content(&d_tag, content) else {
            continue;
        };
        if only.is_some_and(|wanted| wanted != record.brief_type) {
            continue;
        }
        let rank = (
            date,
            type_rank(record.brief_type),
            event.get("created_at").and_then(Value::as_u64).unwrap_or(0),
        );
        if best.as_ref().is_none_or(|(current, _)| rank > *current) {
            best = Some((rank, event));
        }
    }
    best.map(|(_, event)| event.clone())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-cli`
Expected: PASS, including `command_inventory_is_stable`, `brief_publish_needs_type_date_and_text`, the four `commands::brief::tests` and the brand guard tests.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-cli/src/commands/brief.rs crates/buzz-cli/src/commands/mod.rs crates/buzz-cli/src/lib.rs
git commit -s -m "feat(cli): colony brief publish and colony brief latest"
```

---

### Task 6.9: Needs you selector for the new app

**Files:**
- Create: `app/src/records/kinds.ts`, `app/src/records/nostrEvent.ts`, `app/src/records/needsYou.ts`
- Test: `app/src/records/needsYou.test.ts`

**Interfaces:**
- Consumes: the `app/` package from part E (TypeScript, Vitest; `pnpm vitest run` works inside `app/`). No other part E module is imported.
- Produces:
  - `kinds.ts`: `KIND_ASK_HEAD = 30643`, `KIND_BRIEF_HEAD = 30659`
  - `nostrEvent.ts`: `interface SignedEvent { id; pubkey; created_at; kind; tags: string[][]; content; sig }`, `firstTagValue(event, name): string | null`, `tagValues(event, name): string[]`
  - `needsYou.ts`: `type AskCategory`, `type AskType`, `type CompanyRole`, `interface NeedsYouViewer { pubkey: string; role: CompanyRole | null }`, `type NeedsYouSource = "named" | "backfill" | "tool_consent"`, `interface NeedsYouItem`, `MAX_NEEDS_YOU_HEADS = 2000`, `needsYouFilters(viewerPubkey, relayPubkey)`, `selectNeedsYou(heads, viewer, relayPubkey, now): NeedsYouItem[]`

- [ ] **Step 1: Write the failing tests**

Create `app/src/records/needsYou.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { type AskCategory, type AskType, needsYouFilters, selectNeedsYou } from "./needsYou";
import type { SignedEvent } from "./nostrEvent";

const RELAY = "f".repeat(64);
const OWNER = "a".repeat(64);
const PARTNER = "b".repeat(64);
const EMPLOYEE = "c".repeat(64);
const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const NOW = new Date("2026-10-12T09:00:00Z");

let sequence = 0;

interface HeadOptions {
  askId?: string;
  status?: string;
  type?: AskType;
  category?: AskCategory;
  addressee?: string;
  decideBy?: string;
  createdAt?: string;
  named?: string[];
  createdAtSeconds?: number;
  signer?: string;
}

function head(options: HeadOptions = {}): SignedEvent {
  sequence += 1;
  const askId = options.askId ?? `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const ask: Record<string, unknown> = {
    schemaVersion: 1,
    askId,
    type: options.type ?? "approval",
    category: options.category ?? "money",
    title: "Spend $20 on an Instagram ad this weekend?",
  };
  if (options.addressee !== undefined) ask.addresseePubkey = options.addressee;
  if (options.decideBy !== undefined) ask.decideBy = options.decideBy;
  return {
    id: sequence.toString(16).padStart(64, "0"),
    pubkey: options.signer ?? RELAY,
    created_at: options.createdAtSeconds ?? 1_760_250_000 + sequence,
    kind: 30643,
    tags: [
      ["h", CHANNEL],
      ["d", `channel:${CHANNEL}:ask:${askId}`],
      ["e", "e".repeat(64), "", "root"],
      ...(options.named ?? []).map((pubkey) => ["p", pubkey]),
    ],
    content: JSON.stringify({
      schemaVersion: 1,
      askId,
      status: options.status ?? "open",
      askerPubkey: EMPLOYEE,
      createdAt: options.createdAt ?? "2026-10-12T08:00:00Z",
      ask,
      sourceActionEventId: "d".repeat(64),
    }),
    sig: "0".repeat(128),
  };
}

describe("selectNeedsYou", () => {
  it("shows a partner the owner-gated decisions that name them", () => {
    const items = selectNeedsYou(
      [head({ named: [OWNER, PARTNER] })],
      { pubkey: PARTNER, role: "admin" },
      RELAY,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("named");
    expect(items[0]?.category).toBe("money");
  });

  it("never shows an employee a decision it was not named on", () => {
    expect(
      selectNeedsYou([head({ named: [OWNER, PARTNER] })], { pubkey: EMPLOYEE, role: "member" }, RELAY, NOW),
    ).toEqual([]);
  });

  it("backfills authority decisions for an admin promoted after the ask was written", () => {
    const older = head({ named: [OWNER] });
    const forEmployee = head({ category: "general", type: "question", addressee: EMPLOYEE });
    const items = selectNeedsYou([older, forEmployee], { pubkey: PARTNER, role: "admin" }, RELAY, NOW);
    expect(items.map((item) => item.source)).toEqual(["backfill"]);
    expect(items[0]?.headEventId).toBe(older.id);
  });

  it("uses only the newest revision of each ask", () => {
    const askId = "00000000-0000-4000-8000-00000000abcd";
    const open = head({ askId, named: [OWNER], createdAtSeconds: 1_760_250_100 });
    const resolved = head({ askId, named: [OWNER], status: "resolved", createdAtSeconds: 1_760_250_200 });
    const viewer = { pubkey: OWNER, role: "owner" } as const;
    expect(selectNeedsYou([open, resolved], viewer, RELAY, NOW)).toEqual([]);
    expect(selectNeedsYou([resolved, open], viewer, RELAY, NOW)).toEqual([]);
  });

  it("shows tool consent requests to owners and admins as urgent", () => {
    const consent = head({ type: "tool_consent", category: "tool" });
    const [item] = selectNeedsYou([consent], { pubkey: OWNER, role: "owner" }, RELAY, NOW);
    expect(item?.source).toBe("tool_consent");
    expect(item?.urgent).toBe(true);
    expect(selectNeedsYou([consent], { pubkey: EMPLOYEE, role: "member" }, RELAY, NOW)).toEqual([]);
  });

  it("puts urgent decisions first, then the ones waiting longest", () => {
    const waitingLongest = head({ named: [OWNER], createdAt: "2026-10-10T08:00:00Z" });
    const newer = head({ named: [OWNER], createdAt: "2026-10-12T07:00:00Z" });
    const dueToday = head({
      named: [OWNER],
      createdAt: "2026-10-12T08:30:00Z",
      decideBy: "2026-10-12T17:00:00Z",
    });
    const ids = selectNeedsYou([newer, dueToday, waitingLongest], { pubkey: OWNER, role: "owner" }, RELAY, NOW).map(
      (item) => item.headEventId,
    );
    expect(ids).toEqual([dueToday.id, waitingLongest.id, newer.id]);
  });

  it("ignores heads the relay did not sign", () => {
    expect(
      selectNeedsYou([head({ named: [OWNER], signer: OWNER })], { pubkey: OWNER, role: "owner" }, RELAY, NOW),
    ).toEqual([]);
  });
});

describe("needsYouFilters", () => {
  it("asks for the decision inbox and the tool consent inbox", () => {
    expect(needsYouFilters(OWNER, RELAY)).toEqual([
      { kinds: [30643], authors: [RELAY], "#p": [OWNER] },
      { kinds: [30643], authors: [RELAY], "#t": ["tool_consent"] },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && pnpm vitest run src/records/needsYou.test.ts`
Expected: FAIL with "Failed to resolve import "./needsYou"".

- [ ] **Step 3: Write the implementation**

Create `app/src/records/kinds.ts`:

```ts
/** Relay-signed ask head (buzz-core `KIND_ASK_HEAD`). */
export const KIND_ASK_HEAD = 30643;
/** Employee-signed brief or Friday wrap (buzz-core `KIND_BRIEF_HEAD`). */
export const KIND_BRIEF_HEAD = 30659;
```

Create `app/src/records/nostrEvent.ts`:

```ts
/** A signed Nostr event as the relay delivers it (NIP-01 JSON). */
export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Value of the first tag with this name, or null. */
export function firstTagValue(event: SignedEvent, name: string): string | null {
  for (const tag of event.tags) {
    const value = tag[1];
    if (tag[0] === name && typeof value === "string") return value;
  }
  return null;
}

/** Values of every tag with this name. */
export function tagValues(event: SignedEvent, name: string): string[] {
  const values: string[] = [];
  for (const tag of event.tags) {
    const value = tag[1];
    if (tag[0] === name && typeof value === "string") values.push(value);
  }
  return values;
}
```

Create `app/src/records/needsYou.ts`:

```ts
import { KIND_ASK_HEAD } from "./kinds";
import { firstTagValue, type SignedEvent, tagValues } from "./nostrEvent";

/** What an ask decides; mirrors `AskCategory` in buzz-core. */
export type AskCategory = "general" | "money" | "hire" | "tool" | "secret" | "duty";
/** Kind of answer an ask needs; mirrors `AskType` in buzz-core. */
export type AskType = "approval" | "tool_consent" | "question" | "choice" | "checklist" | "verdict";
/** The viewer's company role from their relay membership. */
export type CompanyRole = "owner" | "admin" | "member";

/** Who is looking at Needs you. */
export interface NeedsYouViewer {
  /** 64 lowercase hex characters. */
  pubkey: string;
  role: CompanyRole | null;
}

/** Why an item is in this person's Needs you. */
export type NeedsYouSource = "named" | "backfill" | "tool_consent";

/** One open decision the viewer can act on. */
export interface NeedsYouItem {
  askId: string;
  channelId: string;
  dTag: string;
  headEventId: string;
  title: string;
  askType: AskType;
  category: AskCategory;
  askerPubkey: string;
  addresseePubkey: string | null;
  createdAt: string;
  decideBy: string | null;
  urgent: boolean;
  source: NeedsYouSource;
}

/** Most ask heads one selection looks at; input beyond this is ignored. */
export const MAX_NEEDS_YOU_HEADS = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTHORITY_CATEGORIES: ReadonlySet<string> = new Set(["money", "hire", "tool", "secret", "duty"]);
const CATEGORIES: ReadonlySet<string> = new Set(["general", "money", "hire", "tool", "secret", "duty"]);
const TYPES: ReadonlySet<string> = new Set(["approval", "tool_consent", "question", "choice", "checklist", "verdict"]);

interface ParsedHead {
  askId: string;
  status: string;
  askerPubkey: string;
  createdAt: string;
  type: AskType;
  category: AskCategory;
  title: string;
  addresseePubkey: string | null;
  decideBy: string | null;
  hasMemberProposal: boolean;
}

/**
 * REQ filters behind Needs you: the decision inbox (owners and admins) and the
 * tool consent inbox. See docs/company-records.md, "Decision inbox". Run them on
 * connect, on reconnect and every 60 seconds while Needs you is on screen, and
 * add ordinary channel reads of kind 30643 for live updates and the backfill rule.
 */
export function needsYouFilters(viewerPubkey: string, relayPubkey: string): Array<Record<string, unknown>> {
  return [
    { kinds: [KIND_ASK_HEAD], authors: [relayPubkey], "#p": [viewerPubkey] },
    { kinds: [KIND_ASK_HEAD], authors: [relayPubkey], "#t": ["tool_consent"] },
  ];
}

/** Open decisions the viewer can act on: urgent first, then the ones waiting longest. */
export function selectNeedsYou(
  heads: readonly SignedEvent[],
  viewer: NeedsYouViewer,
  relayPubkey: string,
  now: Date,
): NeedsYouItem[] {
  const newest = new Map<string, SignedEvent>();
  for (const event of heads.slice(0, MAX_NEEDS_YOU_HEADS)) {
    if (event.kind !== KIND_ASK_HEAD || event.pubkey !== relayPubkey) continue;
    const dTag = firstTagValue(event, "d");
    if (dTag === null) continue;
    const current = newest.get(dTag);
    if (
      current === undefined ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id > current.id)
    ) {
      newest.set(dTag, event);
    }
  }

  const items: NeedsYouItem[] = [];
  for (const [dTag, event] of newest) {
    const head = parseHead(event.content);
    if (head === null || head.status !== "open") continue;
    const channelId = firstTagValue(event, "h");
    if (channelId === null) continue;
    const source = sourceFor(event, head, viewer);
    if (source === null) continue;
    items.push({
      askId: head.askId,
      channelId,
      dTag,
      headEventId: event.id,
      title: head.title,
      askType: head.type,
      category: head.category,
      askerPubkey: head.askerPubkey,
      addresseePubkey: head.addresseePubkey,
      createdAt: head.createdAt,
      decideBy: head.decideBy,
      urgent: isUrgent(head, now),
      source,
    });
  }

  return items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    const byAge = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (Number.isFinite(byAge) && byAge !== 0) return byAge;
    if (a.askId === b.askId) return 0;
    return a.askId < b.askId ? -1 : 1;
  });
}

function sourceFor(event: SignedEvent, head: ParsedHead, viewer: NeedsYouViewer): NeedsYouSource | null {
  const hasAuthority = viewer.role === "owner" || viewer.role === "admin";
  if (head.type === "tool_consent") return hasAuthority ? "tool_consent" : null;
  if (tagValues(event, "p").includes(viewer.pubkey)) return "named";
  if (head.addresseePubkey === viewer.pubkey) return "named";
  const decidableByRole =
    AUTHORITY_CATEGORIES.has(head.category) ||
    head.hasMemberProposal ||
    (head.category === "general" && head.addresseePubkey === null);
  if (hasAuthority && decidableByRole) return "backfill";
  return null;
}

function isUrgent(head: ParsedHead, now: Date): boolean {
  if (head.type === "tool_consent") return true;
  if (head.decideBy === null) return false;
  const deadline = Date.parse(head.decideBy);
  return Number.isFinite(deadline) && deadline - now.getTime() <= DAY_MS;
}

function parseHead(content: string): ParsedHead | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const ask = value.ask;
  if (!isRecord(ask)) return null;
  const { askId, status, askerPubkey, createdAt } = value;
  const { type, category, title, addresseePubkey, decideBy, memberProposal } = ask;
  if (
    typeof askId !== "string" ||
    typeof status !== "string" ||
    typeof askerPubkey !== "string" ||
    typeof createdAt !== "string" ||
    typeof type !== "string" ||
    !TYPES.has(type) ||
    typeof category !== "string" ||
    !CATEGORIES.has(category) ||
    typeof title !== "string"
  ) {
    return null;
  }
  return {
    askId,
    status,
    askerPubkey,
    createdAt,
    type: type as AskType,
    category: category as AskCategory,
    title,
    addresseePubkey: typeof addresseePubkey === "string" ? addresseePubkey : null,
    decideBy: typeof decideBy === "string" ? decideBy : null,
    hasMemberProposal: memberProposal !== undefined && memberProposal !== null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && pnpm vitest run src/records/needsYou.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/records/kinds.ts app/src/records/nostrEvent.ts app/src/records/needsYou.ts app/src/records/needsYou.test.ts
git commit -s -m "feat(app): Needs you selector over ask heads"
```

---

### Task 6.10: Brief parser for the new app

**Files:**
- Create: `app/src/records/briefs.ts`
- Test: `app/src/records/briefs.test.ts`

**Interfaces:**
- Consumes: Task 6.9 (`kinds.ts`, `nostrEvent.ts`).
- Produces: `type BriefType = "morning" | "friday"`, `interface BriefTarget { screen: string; id?: string }` (same shape as the bridge's `NavTarget` in the overview, so a brief link can be passed straight to navigation), `interface BriefLink`, `interface BriefCredits`, `interface Brief { eventId; authorPubkey; date; type; text; links; creditsUsed: BriefCredits | null; writtenAt; createdAt }`, `MAX_BRIEF_TEXT_CHARS = 1200`, `MAX_BRIEF_LINKS = 8`, `parseBriefEvent(event): Brief | null`, `pickLatestBrief(events, authorPubkey, only?): Brief | null`, `briefFilter(authorPubkey)`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/records/briefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { briefFilter, parseBriefEvent, pickLatestBrief } from "./briefs";
import type { SignedEvent } from "./nostrEvent";

const SCOUT = "a".repeat(64);
const OTHER = "b".repeat(64);
let sequence = 0;

function briefEvent(
  dTag: string,
  content: Record<string, unknown>,
  options: { author?: string; createdAt?: number } = {},
): SignedEvent {
  sequence += 1;
  return {
    id: sequence.toString(16).padStart(64, "0"),
    pubkey: options.author ?? SCOUT,
    created_at: options.createdAt ?? 1_760_250_000 + sequence,
    kind: 30659,
    tags: [["d", dTag]],
    content: JSON.stringify(content),
    sig: "0".repeat(128),
  };
}

function content(type: "morning" | "friday", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type,
    text: "Naledi's posts for next week are ready, and Thabo is waiting on his order.",
    links: [{ label: "Needs you", target: { screen: "T-05" } }],
    writtenAt: "2026-10-12T08:30:04+02:00",
    ...overrides,
  };
}

describe("parseBriefEvent", () => {
  it("reads a morning brief with its day and links", () => {
    const brief = parseBriefEvent(briefEvent("brief:2026-10-12:morning", content("morning")));
    expect(brief?.date).toBe("2026-10-12");
    expect(brief?.type).toBe("morning");
    expect(brief?.links).toEqual([{ label: "Needs you", target: { screen: "T-05" } }]);
    expect(brief?.creditsUsed).toBeNull();
  });

  it("reads a Friday wrap with credits in whole cents", () => {
    const credits = { totalUsdCents: 910, perEmployee: [{ pubkey: OTHER, usdCents: 340 }] };
    const wrap = parseBriefEvent(briefEvent("brief:2026-10-16:friday", content("friday", { creditsUsed: credits })));
    expect(wrap?.creditsUsed).toEqual(credits);
  });

  it("accepts exactly 1200 characters of text", () => {
    expect(
      parseBriefEvent(briefEvent("brief:2026-10-12:morning", content("morning", { text: "a".repeat(1200) }))),
    ).not.toBeNull();
  });

  it.each([
    ["the type does not match the d tag", "brief:2026-10-12:morning", content("friday")],
    ["a Friday wrap is dated on a Monday", "brief:2026-10-12:friday", content("friday")],
    ["the day is not on the calendar", "brief:2026-02-30:morning", content("morning")],
    ["the text is too long", "brief:2026-10-12:morning", content("morning", { text: "a".repeat(1201) })],
    ["the text is empty", "brief:2026-10-12:morning", content("morning", { text: "   " })],
    [
      "there are too many links",
      "brief:2026-10-12:morning",
      content("morning", {
        links: Array.from({ length: 9 }, () => ({ label: "Needs you", target: { screen: "T-05" } })),
      }),
    ],
    [
      "a link target is not a screen ID",
      "brief:2026-10-12:morning",
      content("morning", { links: [{ label: "Needs you", target: { screen: "needs-you" } }] }),
    ],
    ["there is an unknown field", "brief:2026-10-12:morning", content("morning", { mood: "great" })],
    [
      "a credits row is above the total",
      "brief:2026-10-16:friday",
      content("friday", { creditsUsed: { totalUsdCents: 100, perEmployee: [{ pubkey: OTHER, usdCents: 101 }] } }),
    ],
    ["the schema is from the future", "brief:2026-10-12:morning", content("morning", { schemaVersion: 2 })],
  ])("rejects a brief when %s", (_reason, dTag, body) => {
    expect(parseBriefEvent(briefEvent(dTag as string, body as Record<string, unknown>))).toBeNull();
  });
});

describe("pickLatestBrief", () => {
  it("prefers the newest day, then the Friday wrap over the morning brief", () => {
    const thursday = briefEvent("brief:2026-10-15:morning", content("morning"));
    const fridayMorning = briefEvent("brief:2026-10-16:morning", content("morning"));
    const fridayWrap = briefEvent("brief:2026-10-16:friday", content("friday"), { createdAt: 1_760_000_000 });
    expect(pickLatestBrief([thursday, fridayWrap, fridayMorning], SCOUT)?.eventId).toBe(fridayWrap.id);
    expect(pickLatestBrief([thursday, fridayWrap, fridayMorning], SCOUT, "morning")?.eventId).toBe(fridayMorning.id);
  });

  it("ignores other authors and broken records", () => {
    const other = briefEvent("brief:2026-10-16:friday", content("friday"), { author: OTHER });
    const broken = briefEvent("brief:2026-10-16:friday", { text: "no schema" });
    expect(pickLatestBrief([other, broken], SCOUT)).toBeNull();
  });
});

describe("briefFilter", () => {
  it("reads one author's recent briefs", () => {
    expect(briefFilter(SCOUT)).toEqual({ kinds: [30659], authors: [SCOUT], limit: 20 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && pnpm vitest run src/records/briefs.test.ts`
Expected: FAIL with "Failed to resolve import "./briefs"".

- [ ] **Step 3: Write the implementation**

Create `app/src/records/briefs.ts`:

```ts
import { KIND_BRIEF_HEAD } from "./kinds";
import { firstTagValue, type SignedEvent } from "./nostrEvent";

/** Morning brief or Friday wrap. */
export type BriefType = "morning" | "friday";

/** Where a brief link goes; the same shape as the bridge's `NavTarget`. */
export interface BriefTarget {
  screen: string;
  id?: string;
}

/** One link inside a brief. */
export interface BriefLink {
  label: string;
  target: BriefTarget;
}

/** Credits used, in whole US cents. */
export interface BriefCredits {
  totalUsdCents: number;
  perEmployee: Array<{ pubkey: string; usdCents: number }>;
}

/** A parsed brief or Friday wrap. */
export interface Brief {
  eventId: string;
  authorPubkey: string;
  /** Company calendar day, YYYY-MM-DD. */
  date: string;
  type: BriefType;
  text: string;
  links: BriefLink[];
  creditsUsed: BriefCredits | null;
  writtenAt: string;
  createdAt: number;
}

export const MAX_BRIEF_TEXT_CHARS = 1200;
export const MAX_BRIEF_LINKS = 8;

const MAX_LABEL_CHARS = 80;
const MAX_TARGET_ID_CHARS = 200;
const MAX_CREDIT_ROWS = 32;
const MAX_CONTENT_BYTES = 16 * 1024;
const D_TAG = /^brief:(\d{4}-\d{2}-\d{2}):(morning|friday)$/;
const SCREEN_ID = /^[A-Z]-\d{2}[a-z]?$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const BRIEF_KEYS = ["schemaVersion", "type", "text", "links", "creditsUsed", "writtenAt"];
const TYPE_RANK: Record<BriefType, number> = { morning: 0, friday: 1 };

type Parsed<T> = { ok: true; value: T } | { ok: false };

/** One author's recent briefs. */
export function briefFilter(authorPubkey: string): Record<string, unknown> {
  return { kinds: [KIND_BRIEF_HEAD], authors: [authorPubkey], limit: 20 };
}

/** Parse a kind 30659 event, or null when it breaks the brief rules (docs/company-records.md, Briefs). */
export function parseBriefEvent(event: SignedEvent): Brief | null {
  if (event.kind !== KIND_BRIEF_HEAD) return null;
  if (new TextEncoder().encode(event.content).length > MAX_CONTENT_BYTES) return null;
  const dTag = firstTagValue(event, "d");
  const match = dTag === null ? null : D_TAG.exec(dTag);
  const date = match?.[1];
  const type = match?.[2] as BriefType | undefined;
  if (date === undefined || type === undefined || !isCalendarDay(date)) return null;
  if (type === "friday" && new Date(`${date}T00:00:00Z`).getUTCDay() !== 5) return null;

  let value: unknown;
  try {
    value = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, BRIEF_KEYS)) return null;
  if (value.schemaVersion !== 1 || value.type !== type) return null;
  const text = value.text;
  if (typeof text !== "string" || text.trim().length === 0 || charCount(text) > MAX_BRIEF_TEXT_CHARS) return null;
  const links = parseLinks(value.links);
  if (!links.ok) return null;
  const credits = parseCredits(value.creditsUsed);
  if (!credits.ok) return null;
  const writtenAt = value.writtenAt;
  if (typeof writtenAt !== "string" || !Number.isFinite(Date.parse(writtenAt))) return null;

  return {
    eventId: event.id,
    authorPubkey: event.pubkey,
    date,
    type,
    text,
    links: links.value,
    creditsUsed: credits.value,
    writtenAt,
    createdAt: event.created_at,
  };
}

/** Newest valid brief from one author: by day, then Friday wrap before morning brief, then created_at. */
export function pickLatestBrief(
  events: readonly SignedEvent[],
  authorPubkey: string,
  only?: BriefType,
): Brief | null {
  let best: Brief | null = null;
  for (const event of events) {
    if (event.pubkey !== authorPubkey) continue;
    const brief = parseBriefEvent(event);
    if (brief === null || (only !== undefined && brief.type !== only)) continue;
    if (best === null || compareBriefs(brief, best) > 0) best = brief;
  }
  return best;
}

function compareBriefs(a: Brief, b: Brief): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.type !== b.type) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  return a.createdAt - b.createdAt;
}

function parseLinks(value: unknown): Parsed<BriefLink[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_BRIEF_LINKS) return { ok: false };
  const links: BriefLink[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["label", "target"])) return { ok: false };
    const label = entry.label;
    const target = entry.target;
    if (typeof label !== "string" || label.trim().length === 0 || charCount(label) > MAX_LABEL_CHARS) {
      return { ok: false };
    }
    if (!isRecord(target) || !hasOnlyKeys(target, ["screen", "id"])) return { ok: false };
    const screen = target.screen;
    const id = target.id;
    if (typeof screen !== "string" || !SCREEN_ID.test(screen)) return { ok: false };
    if (id !== undefined) {
      if (typeof id !== "string" || id.length === 0 || charCount(id) > MAX_TARGET_ID_CHARS || hasControl(id)) {
        return { ok: false };
      }
      links.push({ label, target: { screen, id } });
    } else {
      links.push({ label, target: { screen } });
    }
  }
  return { ok: true, value: links };
}

function parseCredits(value: unknown): Parsed<BriefCredits | null> {
  if (value === undefined) return { ok: true, value: null };
  if (!isRecord(value) || !hasOnlyKeys(value, ["totalUsdCents", "perEmployee"])) return { ok: false };
  const total = value.totalUsdCents;
  if (!isWholeNumber(total)) return { ok: false };
  const rows = value.perEmployee ?? [];
  if (!Array.isArray(rows) || rows.length > MAX_CREDIT_ROWS) return { ok: false };
  const seen = new Set<string>();
  const perEmployee: Array<{ pubkey: string; usdCents: number }> = [];
  for (const row of rows) {
    if (!isRecord(row) || !hasOnlyKeys(row, ["pubkey", "usdCents"])) return { ok: false };
    const pubkey = row.pubkey;
    const usdCents = row.usdCents;
    if (typeof pubkey !== "string" || !HEX_64.test(pubkey) || seen.has(pubkey)) return { ok: false };
    if (!isWholeNumber(usdCents) || usdCents > total) return { ok: false };
    seen.add(pubkey);
    perEmployee.push({ pubkey, usdCents });
  }
  return { ok: true, value: { totalUsdCents: total, perEmployee } };
}

function isCalendarDay(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function charCount(value: string): number {
  return Array.from(value).length;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && pnpm vitest run src/records/briefs.test.ts src/records/needsYou.test.ts`
Expected: PASS (all brief and Needs you tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/records/briefs.ts app/src/records/briefs.test.ts
git commit -s -m "feat(app): brief and Friday wrap parser"
```

---

## Contract changes

1. **Who is named on an ask head (refines the overview's "the owner and every admin").** The relay names the people who may decide under the existing resolution rules: authority asks, member proposals and unaddressed general asks name the owner and every admin plus a human addressee; a general ask addressed to one person names that person; an ask addressed to an employee names nobody; employees are never named; at most 128 people, owner first. Reason: naming owners and admins on asks addressed to employees would put employee-to-Scout questions into people's Needs you.
2. **Tool consent heads get no `p` tags.** They keep their exact four-tag shape because `req.rs:1229` (`is_tool_consent_head_event`) and `crates/buzz-acp/src/tool_permissions.rs:430` require it. Needs you reads them through the existing tool consent inbox filter (`#t` = `tool_consent`), which `needsYouFilters` includes.
3. **Needs you is a dedicated global inbox filter, not a plain `#p` query.** `{"kinds":[30643],"authors":[<relay self>],"#p":[<own hex>]}` (optionally one `#d` ask coordinate) is served only to owners and admins and lifts the conversation fence; any other filter keeps the ordinary channel scope. The inbox is historical only (global subscriptions never receive channel-scoped events live), so clients refresh it on connect, on reconnect and every 60 seconds, and keep channel subscriptions for live updates.
4. **Brief content shape.** Adds `schemaVersion: 1`; the day lives only in the `d` tag; a link target is `{ screen, id? }` (the bridge's `NavTarget` shape); `creditsUsed` is `{ totalUsdCents, perEmployee: [{ pubkey, usdCents }] }` in whole US cents; `writtenAt` is RFC 3339. The relay accepts one NIP-OA `auth` tag beside the `d` tag, because the harness adds it to employee-signed events.

## Self-review

- **Spec coverage.** E-06: decider tags (Task 6.3), inbox rules (6.4), both transports and the documented client refresh and backfill rules (6.5), partner outside the conversation sees it and an employee does not (6.5 Postgres, 6.7 end to end), app selector (6.9). E-07: record type and validation (6.1), builder (6.2), relay acceptance with the employee rule (6.6), `colony brief publish` and `colony brief latest` (6.8), app parser for T-01, C-19 and D-01 (6.10). X-09 ("decisions go straight to Needs you while Scout is stopped") is served by the same named tags, because the relay, not Scout, writes them.
- **Placeholder scan.** No "TBD", "TODO", "similar to" or step without code. Every command names its expected outcome.
- **Type consistency.** `ask_decider_pubkeys`, `MAX_ASK_DECIDER_TAGS` and the six-argument `relay_ask_head_event` match across Tasks 6.3 and 6.5; the four `decision_inbox` functions match across 6.4, 6.5 and the end-to-end test; `validate_brief_write`, `build_brief`, `parse_brief_content`, `BriefTypeArg` and `BriefCmd` match across 6.1, 6.2, 6.6 and 6.8; the TypeScript names in 6.9 and 6.10 match their tests.
- **Review focus.** Each of the five lines has a test in its owning task (6.3, 6.5, 6.6, 6.7, 6.9).
- **Known limits.** The inbox has no live push for conversations the reader is not in (refresh interval up to 60 seconds); a later change could add a fan-out index for relay-signed ask heads keyed by `p`. In the shared end-to-end community, many seeded owners and admins could in principle reach the 128-name bound; CI seeds far fewer.
