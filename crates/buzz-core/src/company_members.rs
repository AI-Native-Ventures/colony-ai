//! Shared typed content and validation for company member positions.
//!
//! Member positions are community-wide relay records. The relay supplies
//! membership, authority, exact-head, transaction, and runtime checks.

use serde::{Deserialize, Serialize};

use crate::company_records::{CompanyRecordError, MAX_REASON_CHARS, MAX_TITLE_CHARS};

/// Maximum number of reporting links walked before rejecting an org chain.
pub const MAX_ORG_DEPTH: usize = 128;

/// Whether a community member is a human or an AI employee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberKind {
    /// A human community member.
    Human,
    /// A managed AI employee. Short-lived workers are not employees.
    Employee,
}

/// Lifecycle status of a member position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberStatus {
    /// The member may work normally.
    Active,
    /// An employee whose runtime is stopped until resumed.
    Paused,
    /// An employee retained for possible reviewed rehire.
    Terminated,
}

/// Member-position mutation handled by the company broker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberPositionActionKind {
    /// Set only the title.
    SetTitle,
    /// Set or clear only the manager.
    SetManager,
    /// Save title and manager together as one user action.
    SetPosition,
    /// Pause an employee with a reason.
    Pause,
    /// Terminate an employee with a reason while retaining its definition.
    Terminate,
    /// Restore a terminated employee after review.
    Rehire,
}

/// Member-signed request to change one member position (kind 47035).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MemberPositionAction {
    /// Schema version.
    pub schema_version: u8,
    /// Community member whose position is changing.
    pub pubkey: String,
    /// Requested mutation.
    pub action: MemberPositionActionKind,
    /// Exact current member head. Omitted only for first `set_title` or
    /// `set_position` when no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// New title for `set_title` or `set_position`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// For `set_manager` or `set_position`, `None` means omitted and
    /// `Some(None)` means clear the manager.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager_pubkey: Option<Option<String>>,
    /// Required pause or termination reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Relay-signed current member position (kind 30645).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MemberPositionHead {
    /// Schema version.
    pub schema_version: u8,
    /// Community member this position describes.
    pub pubkey: String,
    /// Human-readable title.
    pub title: String,
    /// Direct manager, or `None` for the community owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager_pubkey: Option<String>,
    /// Human or managed AI employee.
    pub kind: MemberKind,
    /// Current lifecycle state.
    pub status: MemberStatus,
    /// Required for paused or terminated employees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Event id of the action that produced this head.
    pub source_action_event_id: String,
    /// RFC 3339 UTC time at which the relay produced this head.
    pub updated_at: String,
}

/// d-tag for a company member position.
pub fn member_d_tag(pubkey: &str) -> Result<String, CompanyRecordError> {
    validate_pubkey(pubkey)?;
    Ok(format!("company:member:{pubkey}"))
}

/// Checks a member-position d-tag against its target pubkey.
pub fn validate_member_d_tag(d_tag: &str, pubkey: &str) -> Result<(), CompanyRecordError> {
    if d_tag == member_d_tag(pubkey)? {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Validates the payload and head-lock shape for a member action.
pub fn validate_member_position_action(
    action: &MemberPositionAction,
) -> Result<(), CompanyRecordError> {
    if action.schema_version != crate::company_records::COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_pubkey(&action.pubkey)?;

    let create_only = matches!(
        action.action,
        MemberPositionActionKind::SetTitle | MemberPositionActionKind::SetPosition
    );
    if let Some(expected) = &action.expected_head_event_id {
        validate_hex_id(expected, "expectedHeadEventId must be a lowercase event id")?;
    } else if !create_only {
        return Err(CompanyRecordError::Invalid(
            "expectedHeadEventId is required for this member action",
        ));
    }
    if action.expected_head_event_id.is_none()
        && action.action == MemberPositionActionKind::SetPosition
        && action.title.is_none()
    {
        return Err(CompanyRecordError::Invalid(
            "initial member positions need a title",
        ));
    }

    let title_is_valid =
        |title: &str| !title.trim().is_empty() && title.chars().count() <= MAX_TITLE_CHARS;
    let reason_is_valid =
        |reason: &str| !reason.trim().is_empty() && reason.chars().count() <= MAX_REASON_CHARS;

    match action.action {
        MemberPositionActionKind::SetTitle => {
            if !action.title.as_deref().is_some_and(title_is_valid)
                || action.manager_pubkey.is_some()
                || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "set_title needs only a non-empty title of 180 characters at most",
                ));
            }
        }
        MemberPositionActionKind::SetManager => {
            if action.title.is_some() || action.manager_pubkey.is_none() || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "set_manager needs only managerPubkey, which may be null",
                ));
            }
        }
        MemberPositionActionKind::SetPosition => {
            if action.title.is_none() && action.manager_pubkey.is_none() {
                return Err(CompanyRecordError::Invalid(
                    "set_position needs a title or manager change",
                ));
            }
            if action
                .title
                .as_deref()
                .is_some_and(|title| !title_is_valid(title))
            {
                return Err(CompanyRecordError::Invalid(
                    "title must not be empty and must be 180 characters at most",
                ));
            }
            if action.reason.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "set_position does not take a reason",
                ));
            }
        }
        MemberPositionActionKind::Pause | MemberPositionActionKind::Terminate => {
            if action.title.is_some()
                || action.manager_pubkey.is_some()
                || !action.reason.as_deref().is_some_and(reason_is_valid)
            {
                return Err(CompanyRecordError::Invalid(
                    "pause and terminate need only a non-empty reason of 1000 characters at most",
                ));
            }
        }
        MemberPositionActionKind::Rehire => {
            if action.title.is_some() || action.manager_pubkey.is_some() || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "rehire does not take a title, manager, or reason",
                ));
            }
        }
    }

    if let Some(Some(manager_pubkey)) = &action.manager_pubkey {
        validate_pubkey(manager_pubkey)?;
        if manager_pubkey == &action.pubkey {
            return Err(CompanyRecordError::Invalid(
                "a member cannot report to themself",
            ));
        }
    }
    Ok(())
}

/// Validates a complete member head before it is serialized or trusted.
pub fn validate_member_position_head(head: &MemberPositionHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != crate::company_records::COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_pubkey(&head.pubkey)?;
    if head.title.trim().is_empty() || head.title.chars().count() > MAX_TITLE_CHARS {
        return Err(CompanyRecordError::Invalid(
            "title must not be empty and must be 180 characters at most",
        ));
    }
    if let Some(manager_pubkey) = &head.manager_pubkey {
        validate_pubkey(manager_pubkey)?;
        if manager_pubkey == &head.pubkey {
            return Err(CompanyRecordError::Invalid(
                "a member cannot report to themself",
            ));
        }
    }
    match (head.kind, head.status, head.reason.as_deref()) {
        (MemberKind::Employee, MemberStatus::Paused | MemberStatus::Terminated, Some(reason))
            if !reason.trim().is_empty() && reason.chars().count() <= MAX_REASON_CHARS => {}
        (MemberKind::Employee, MemberStatus::Paused | MemberStatus::Terminated, _) => {
            return Err(CompanyRecordError::Invalid(
                "paused and terminated employees need a reason of 1000 characters at most",
            ));
        }
        (_, MemberStatus::Active, None) => {}
        (MemberKind::Human, _, _) => {
            return Err(CompanyRecordError::Invalid(
                "human member positions must remain active and have no reason",
            ));
        }
        (_, MemberStatus::Active, Some(_)) => {
            return Err(CompanyRecordError::Invalid(
                "active member positions cannot have a reason",
            ));
        }
    }
    Ok(())
}

/// Returns whether assigning `new_manager` to `pubkey` would make a cycle or
/// exceed the supported reporting depth.
pub fn member_manager_creates_cycle(
    pubkey: &str,
    new_manager: &str,
    manager_of: impl Fn(&str) -> Option<String>,
) -> bool {
    let mut cursor = Some(new_manager.to_owned());
    for _ in 0..MAX_ORG_DEPTH {
        match cursor {
            None => return false,
            Some(ref manager) if manager == pubkey => return true,
            Some(manager) => cursor = manager_of(&manager),
        }
    }
    true
}

/// Applies a validated action to a current head, producing the next snapshot.
pub fn apply_member_position_action(
    current: Option<&MemberPositionHead>,
    action: &MemberPositionAction,
    kind: MemberKind,
    source_action_event_id: String,
    updated_at: String,
) -> Result<MemberPositionHead, CompanyRecordError> {
    validate_member_position_action(action)?;
    let mut head = match current {
        Some(current) => current.clone(),
        None => MemberPositionHead {
            schema_version: crate::company_records::COMPANY_RECORD_SCHEMA_VERSION,
            pubkey: action.pubkey.clone(),
            title: action.title.clone().ok_or(CompanyRecordError::Invalid(
                "initial member position needs a title",
            ))?,
            manager_pubkey: action.manager_pubkey.clone().flatten(),
            kind,
            status: MemberStatus::Active,
            reason: None,
            source_action_event_id: source_action_event_id.clone(),
            updated_at: updated_at.clone(),
        },
    };

    if head.pubkey != action.pubkey {
        return Err(CompanyRecordError::Invalid(
            "member action pubkey does not match the current head",
        ));
    }
    if current.is_some() && head.kind != kind {
        return Err(CompanyRecordError::Invalid(
            "member kind does not match the current head",
        ));
    }

    match action.action {
        MemberPositionActionKind::SetTitle => {
            head.title = action
                .title
                .clone()
                .ok_or(CompanyRecordError::Invalid("set_title needs a title"))?;
        }
        MemberPositionActionKind::SetManager => {
            head.manager_pubkey = action.manager_pubkey.clone().flatten();
        }
        MemberPositionActionKind::SetPosition => {
            if let Some(title) = &action.title {
                head.title = title.clone();
            }
            if let Some(manager_pubkey) = &action.manager_pubkey {
                head.manager_pubkey = manager_pubkey.clone();
            }
        }
        MemberPositionActionKind::Pause => {
            if head.kind != MemberKind::Employee || head.status == MemberStatus::Terminated {
                return Err(CompanyRecordError::Invalid(
                    "only an active employee can be paused",
                ));
            }
            head.status = MemberStatus::Paused;
            head.reason = action.reason.clone();
        }
        MemberPositionActionKind::Terminate => {
            if head.kind != MemberKind::Employee || head.status == MemberStatus::Terminated {
                return Err(CompanyRecordError::Invalid(
                    "only an active or paused employee can be terminated",
                ));
            }
            head.status = MemberStatus::Terminated;
            head.reason = action.reason.clone();
        }
        MemberPositionActionKind::Rehire => {
            if head.kind != MemberKind::Employee || head.status != MemberStatus::Terminated {
                return Err(CompanyRecordError::Invalid(
                    "only a terminated employee can be rehired",
                ));
            }
            head.status = MemberStatus::Active;
            head.reason = None;
        }
    }

    head.source_action_event_id = source_action_event_id;
    head.updated_at = updated_at;
    validate_member_position_head(&head)?;
    Ok(head)
}

fn validate_pubkey(pubkey: &str) -> Result<(), CompanyRecordError> {
    validate_hex_id(pubkey, "pubkey must be 64 lowercase hex characters")
}

fn validate_hex_id(value: &str, error: &'static str) -> Result<(), CompanyRecordError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(CompanyRecordError::Invalid(error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPLOYEE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const MANAGER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const EVENT: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn action(action: MemberPositionActionKind) -> MemberPositionAction {
        MemberPositionAction {
            schema_version: 1,
            pubkey: EMPLOYEE.into(),
            action,
            expected_head_event_id: Some(EVENT.into()),
            title: None,
            manager_pubkey: None,
            reason: None,
        }
    }

    fn head(status: MemberStatus, reason: Option<&str>) -> MemberPositionHead {
        MemberPositionHead {
            schema_version: 1,
            pubkey: EMPLOYEE.into(),
            title: "Operations lead".into(),
            manager_pubkey: Some(MANAGER.into()),
            kind: MemberKind::Employee,
            status,
            reason: reason.map(str::to_owned),
            source_action_event_id: EVENT.into(),
            updated_at: "2026-09-28T00:00:00Z".into(),
        }
    }

    #[test]
    fn d_tag_is_scoped_by_member_pubkey() {
        assert_eq!(
            member_d_tag(EMPLOYEE).unwrap(),
            format!("company:member:{EMPLOYEE}")
        );
        assert!(validate_member_d_tag(&member_d_tag(EMPLOYEE).unwrap(), EMPLOYEE).is_ok());
        assert!(validate_member_d_tag("company:member:bad", EMPLOYEE).is_err());
    }

    #[test]
    fn validates_status_reasons_and_rejects_human_lifecycle_changes() {
        assert!(validate_member_position_head(&head(MemberStatus::Active, None)).is_ok());
        assert!(validate_member_position_head(&head(MemberStatus::Paused, None)).is_err());
        assert!(validate_member_position_head(&head(MemberStatus::Paused, Some("Budget"))).is_ok());

        let human = MemberPositionHead {
            kind: MemberKind::Human,
            status: MemberStatus::Terminated,
            reason: Some("Review".into()),
            ..head(MemberStatus::Active, None)
        };
        assert!(validate_member_position_head(&human).is_err());
    }

    #[test]
    fn exact_head_is_required_except_for_initial_title_or_position() {
        let mut missing_head = action(MemberPositionActionKind::Pause);
        missing_head.expected_head_event_id = None;
        missing_head.reason = Some("Coverage needed".into());
        assert!(validate_member_position_action(&missing_head).is_err());

        let mut first_title = action(MemberPositionActionKind::SetTitle);
        first_title.expected_head_event_id = None;
        first_title.title = Some("Operations lead".into());
        assert!(validate_member_position_action(&first_title).is_ok());
    }

    #[test]
    fn manager_clear_is_explicit_and_cannot_self_report() {
        let mut clear = action(MemberPositionActionKind::SetManager);
        clear.manager_pubkey = Some(None);
        assert!(validate_member_position_action(&clear).is_ok());

        let mut self_report = action(MemberPositionActionKind::SetManager);
        self_report.manager_pubkey = Some(Some(EMPLOYEE.into()));
        assert!(validate_member_position_action(&self_report).is_err());
    }

    #[test]
    fn detects_direct_indirect_and_over_depth_cycles() {
        assert!(member_manager_creates_cycle(EMPLOYEE, EMPLOYEE, |_| None));
        assert!(member_manager_creates_cycle(EMPLOYEE, MANAGER, |pubkey| {
            (pubkey == MANAGER).then(|| EMPLOYEE.into())
        }));
        assert!(!member_manager_creates_cycle(EMPLOYEE, MANAGER, |_| None));
        assert!(member_manager_creates_cycle(EMPLOYEE, MANAGER, |pubkey| {
            Some(if pubkey == MANAGER { EMPLOYEE } else { MANAGER }.into())
        }));
    }

    #[test]
    fn pause_terminate_and_rehire_keep_the_position_and_reason_rules() {
        let mut pause = action(MemberPositionActionKind::Pause);
        pause.reason = Some("Owner review".into());
        let paused = apply_member_position_action(
            Some(&head(MemberStatus::Active, None)),
            &pause,
            MemberKind::Employee,
            EVENT.into(),
            "2026-09-28T00:00:00Z".into(),
        )
        .unwrap();
        assert_eq!(paused.status, MemberStatus::Paused);
        assert_eq!(paused.reason.as_deref(), Some("Owner review"));

        let mut terminate = action(MemberPositionActionKind::Terminate);
        terminate.reason = Some("Role closed".into());
        let terminated = apply_member_position_action(
            Some(&paused),
            &terminate,
            MemberKind::Employee,
            EVENT.into(),
            "2026-09-28T00:00:00Z".into(),
        )
        .unwrap();
        let rehire = action(MemberPositionActionKind::Rehire);
        let rehired = apply_member_position_action(
            Some(&terminated),
            &rehire,
            MemberKind::Employee,
            EVENT.into(),
            "2026-09-28T00:00:00Z".into(),
        )
        .unwrap();
        assert_eq!(rehired.title, terminated.title);
        assert_eq!(rehired.manager_pubkey, terminated.manager_pubkey);
        assert_eq!(rehired.status, MemberStatus::Active);
        assert_eq!(rehired.reason, None);
    }

    #[test]
    fn one_set_position_action_saves_title_and_manager_together() {
        let mut update = action(MemberPositionActionKind::SetPosition);
        update.title = Some("Director".into());
        update.manager_pubkey = Some(None);
        let changed = apply_member_position_action(
            Some(&head(MemberStatus::Active, None)),
            &update,
            MemberKind::Employee,
            EVENT.into(),
            "2026-09-28T00:00:00Z".into(),
        )
        .unwrap();
        assert_eq!(changed.title, "Director");
        assert_eq!(changed.manager_pubkey, None);
    }
}
