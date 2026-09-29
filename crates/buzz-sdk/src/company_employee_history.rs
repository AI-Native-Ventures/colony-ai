//! Typed Nostr event builder for employee configuration history.
//!
//! Employee revisions use a community-wide d-tag and an employee p-tag.

use crate::SdkError;
use buzz_core::company_employee_history::{
    employee_history_d_tag, validate_employee_revision_action,
};
pub use buzz_core::company_employee_history::{
    EmployeeConfigSnapshot, EmployeeRevisionAction, EmployeeRevisionActionKind,
    EmployeeRevisionHead,
};
use buzz_core::kind::KIND_EMPLOYEE_REVISION_ACTION;
use nostr::{EventBuilder, Kind, Tag};

/// Build a member-signed employee configuration revision action.
pub fn build_employee_revision_action(
    action: &EmployeeRevisionAction,
) -> Result<EventBuilder, SdkError> {
    validate_employee_revision_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("employee revision action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "employee revision action serialization failed: {error}"
        ))
    })?;
    let d_tag = employee_history_d_tag(&action.employee_pubkey)
        .map_err(|error| SdkError::InvalidInput(format!("employee pubkey is invalid: {error}")))?;
    let d = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let p = Tag::parse(["p", action.employee_pubkey.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_EMPLOYEE_REVISION_ACTION as u16), content).tags([d, p]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    const EMPLOYEE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn employee_revision_builder_signs_the_global_employee_coordinate() {
        let action = EmployeeRevisionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            employee_pubkey: EMPLOYEE.into(),
            action: EmployeeRevisionActionKind::Record,
            expected_head_event_id: None,
            previous_revision_event_id: None,
            before: EmployeeConfigSnapshot::default(),
            after: EmployeeConfigSnapshot {
                instructions: Some("Be accurate".into()),
                provider: Some("provider-key".into()),
                model: Some("model-key".into()),
                runtime: Some("runtime-key".into()),
            },
            undo_of_event_id: None,
        };
        let event = build_employee_revision_action(&action)
            .expect("builder")
            .sign_with_keys(&Keys::generate())
            .expect("event");
        assert_eq!(
            event.kind,
            Kind::Custom(KIND_EMPLOYEE_REVISION_ACTION as u16)
        );
        assert_eq!(event.tags.len(), 2);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content()
                    == Some("company:employee-history:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        }));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.kind().to_string() == "p" && tag.content() == Some(EMPLOYEE) }));
    }
}
