//! Typed, secret-free history records for employee configuration changes.
//!
//! The member-authored action is append-only (kind 47040). The relay derives a
//! replaceable current head (kind 30651) after checking authority and the
//! expected head. See `docs/company-records.md` for the wire contract.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Maximum length of a system instruction snapshot, in Unicode characters.
pub const MAX_EMPLOYEE_INSTRUCTIONS_CHARS: usize = 20_000;
/// Maximum length of provider, model, and runtime identifiers.
pub const MAX_EMPLOYEE_RUNTIME_ID_CHARS: usize = 256;

/// A secret-free allowlist of employee configuration values suitable for history.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmployeeConfigSnapshot {
    /// The effective system instructions, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// The configured provider key, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// The configured model key, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The configured runtime identifier, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
}

/// Employee revision command kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeRevisionActionKind {
    /// Record a configuration change.
    Record,
    /// Append a new revision that restores a prior revision's before snapshot.
    Undo,
}

/// Member-signed employee configuration revision command (kind 47040).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmployeeRevisionAction {
    /// Company record schema version.
    pub schema_version: u8,
    /// Employee whose configuration changed.
    pub employee_pubkey: String,
    /// Revision operation.
    pub action: EmployeeRevisionActionKind,
    /// Exact current relay head for update and undo; omitted only for first record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Prior immutable revision event id, when this is not the first revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_revision_event_id: Option<String>,
    /// Configuration before the change.
    pub before: EmployeeConfigSnapshot,
    /// Configuration after the change.
    pub after: EmployeeConfigSnapshot,
    /// Earlier revision event being undone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of_event_id: Option<String>,
}

/// Relay-signed replaceable head containing the current employee configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmployeeRevisionHead {
    /// Company record schema version.
    pub schema_version: u8,
    /// Employee whose configuration is versioned.
    pub employee_pubkey: String,
    /// Latest immutable revision action event id.
    pub revision_event_id: String,
    /// Prior revision event id, if one existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_revision_event_id: Option<String>,
    /// Current secret-free configuration snapshot.
    pub snapshot: EmployeeConfigSnapshot,
    /// Member who made the latest revision.
    pub actor_pubkey: String,
    /// Relay acceptance time in RFC 3339 UTC.
    pub updated_at: String,
    /// Latest immutable action event id.
    pub source_action_event_id: String,
}

/// Returns the canonical community-wide history coordinate for an employee.
pub fn employee_history_d_tag(employee_pubkey: &str) -> Result<String, CompanyRecordError> {
    if !is_hex_id(employee_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "employeePubkey must be 64 lowercase hexadecimal characters",
        ));
    }
    Ok(format!("company:employee-history:{employee_pubkey}"))
}

/// Validates an employee revision command's exact fields and transition shape.
pub fn validate_employee_revision_action(
    action: &EmployeeRevisionAction,
) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let _ = employee_history_d_tag(&action.employee_pubkey)?;
    validate_snapshot(&action.before)?;
    validate_snapshot(&action.after)?;
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character lowercase event id",
            ));
        }
    }
    if action
        .previous_revision_event_id
        .as_deref()
        .is_some_and(|event_id| !is_hex_id(event_id))
    {
        return Err(CompanyRecordError::Invalid(
            "previousRevisionEventId must be a 64-character lowercase event id",
        ));
    }
    if action.expected_head_event_id.is_some() != action.previous_revision_event_id.is_some() {
        return Err(CompanyRecordError::Invalid(
            "expectedHeadEventId and previousRevisionEventId must be provided together",
        ));
    }
    match action.action {
        EmployeeRevisionActionKind::Record => {
            if action.undo_of_event_id.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "record must omit undoOfEventId",
                ));
            }
        }
        EmployeeRevisionActionKind::Undo => {
            if action.expected_head_event_id.is_none()
                || action.previous_revision_event_id.is_none()
                || !action.undo_of_event_id.as_deref().is_some_and(is_hex_id)
            {
                return Err(CompanyRecordError::Invalid(
                    "undo needs the current head and a prior revision event id",
                ));
            }
        }
    }
    Ok(())
}

/// Validates a persisted employee revision head.
pub fn validate_employee_revision_head(
    head: &EmployeeRevisionHead,
) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&head.employee_pubkey)
        || !is_hex_id(&head.revision_event_id)
        || !is_hex_id(&head.actor_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || head
            .previous_revision_event_id
            .as_deref()
            .is_some_and(|event_id| !is_hex_id(event_id))
    {
        return Err(CompanyRecordError::Invalid(
            "employee revision head contains an invalid event id or pubkey",
        ));
    }
    if chrono::DateTime::parse_from_rfc3339(&head.updated_at).is_err() {
        return Err(CompanyRecordError::Invalid(
            "updatedAt must be an RFC 3339 timestamp",
        ));
    }
    validate_snapshot(&head.snapshot)
}

fn validate_snapshot(snapshot: &EmployeeConfigSnapshot) -> Result<(), CompanyRecordError> {
    if snapshot
        .instructions
        .as_deref()
        .is_some_and(|value| value.chars().count() > MAX_EMPLOYEE_INSTRUCTIONS_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "instructions exceed the supported character limit",
        ));
    }
    for (name, value) in [
        ("provider", snapshot.provider.as_deref()),
        ("model", snapshot.model.as_deref()),
        ("runtime", snapshot.runtime.as_deref()),
    ] {
        if value.is_some_and(|value| {
            value.trim().is_empty() || value.chars().count() > MAX_EMPLOYEE_RUNTIME_ID_CHARS
        }) {
            return Err(CompanyRecordError::Invalid(match name {
                "provider" => "provider must be a non-empty identifier of at most 256 characters",
                "model" => "model must be a non-empty identifier of at most 256 characters",
                _ => "runtime must be a non-empty identifier of at most 256 characters",
            }));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPLOYEE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const EVENT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn action(action: EmployeeRevisionActionKind) -> EmployeeRevisionAction {
        EmployeeRevisionAction {
            schema_version: 1,
            employee_pubkey: EMPLOYEE.into(),
            action,
            expected_head_event_id: None,
            previous_revision_event_id: None,
            before: EmployeeConfigSnapshot::default(),
            after: EmployeeConfigSnapshot {
                instructions: Some("Write carefully".into()),
                provider: Some("provider-from-runtime-catalog".into()),
                model: Some("model-from-runtime-catalog".into()),
                runtime: Some("runtime-from-catalog".into()),
            },
            undo_of_event_id: None,
        }
    }

    #[test]
    fn record_action_accepts_only_secret_free_bounded_snapshots() {
        assert!(
            validate_employee_revision_action(&action(EmployeeRevisionActionKind::Record)).is_ok()
        );

        let mut unknown = action(EmployeeRevisionActionKind::Record);
        let json = serde_json::to_value(&unknown).expect("serialize action");
        let mut json = json;
        json["after"]["privateKey"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<EmployeeRevisionAction>(json).is_err());

        unknown.after.instructions = Some("x".repeat(MAX_EMPLOYEE_INSTRUCTIONS_CHARS + 1));
        assert!(validate_employee_revision_action(&unknown).is_err());
    }

    #[test]
    fn undo_requires_exact_head_and_prior_revision() {
        let mut undo = action(EmployeeRevisionActionKind::Undo);
        undo.expected_head_event_id = Some(EVENT.into());
        undo.previous_revision_event_id = Some(EVENT.into());
        undo.undo_of_event_id = Some(EVENT.into());
        assert!(validate_employee_revision_action(&undo).is_ok());

        undo.expected_head_event_id = None;
        undo.previous_revision_event_id = None;
        assert!(validate_employee_revision_action(&undo).is_err());
        undo.expected_head_event_id = Some(EVENT.into());
        undo.previous_revision_event_id = Some(EVENT.into());
        undo.undo_of_event_id = Some("ABC".into());
        assert!(validate_employee_revision_action(&undo).is_err());
    }

    #[test]
    fn head_rejects_invalid_ids_and_timestamps() {
        let head = EmployeeRevisionHead {
            schema_version: 1,
            employee_pubkey: EMPLOYEE.into(),
            revision_event_id: EVENT.into(),
            previous_revision_event_id: None,
            snapshot: EmployeeConfigSnapshot::default(),
            actor_pubkey: EMPLOYEE.into(),
            updated_at: "2026-09-29T10:00:00Z".into(),
            source_action_event_id: EVENT.into(),
        };
        assert!(validate_employee_revision_head(&head).is_ok());

        let mut invalid = head;
        invalid.updated_at = "not-a-time".into();
        assert!(validate_employee_revision_head(&invalid).is_err());
    }
}
