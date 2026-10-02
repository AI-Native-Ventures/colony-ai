//! Typed event builder for employee duty mutations.

use buzz_core::company_duties::{duty_d_tag, validate_duty_action, DutyAction};
use buzz_core::kind::KIND_DUTY_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed community-wide duty action with its exact d and p tags.
pub fn build_duty_action(
    action: &DutyAction,
    employee_pubkey: &str,
) -> Result<EventBuilder, SdkError> {
    validate_duty_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("duty action is invalid: {error}")))?;
    let employee = nostr::PublicKey::from_hex(employee_pubkey)
        .map_err(|error| SdkError::InvalidInput(format!("invalid employee pubkey: {error}")))?;
    let employee_pubkey = employee.to_hex();
    if action
        .proposal
        .as_ref()
        .is_some_and(|proposal| proposal.employee_pubkey != employee_pubkey)
    {
        return Err(SdkError::InvalidInput(
            "duty proposal employee does not match the p tag".into(),
        ));
    }
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("duty action serialization failed: {error}"))
    })?;
    let d_tag = duty_d_tag(action.duty_id);
    let d_tag = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let p_tag = Tag::parse(["p", employee_pubkey.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    // The assigned employee may sign its own duty commands; keep the `p` tag the
    // relay requires instead of letting nostr scrub a same-pubkey tag.
    Ok(
        EventBuilder::new(Kind::Custom(KIND_DUTY_ACTION as u16), content)
            .tags([d_tag, p_tag])
            .allow_self_tagging(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_duties::DutyActionKind;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;
    use uuid::Uuid;

    #[test]
    fn duty_action_builder_uses_d_and_employee_p_tags_without_h() {
        let employee = Keys::generate();
        let duty_id = Uuid::from_u128(7);
        let action = DutyAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            duty_id,
            action: DutyActionKind::Pause,
            expected_head_event_id: "ab".repeat(32),
            proposal: None,
            reason: None,
        };
        let event = build_duty_action(&action, &employee.public_key().to_hex())
            .expect("build duty action")
            .sign_with_keys(&Keys::generate())
            .expect("sign duty action");
        assert_eq!(event.kind, Kind::Custom(KIND_DUTY_ACTION as u16));
        assert!(event.tags.iter().any(
            |tag| tag.as_slice() == ["d", "company:duty:00000000-0000-0000-0000-000000000007"]
        ));
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(employee.public_key().to_hex().as_str())
        }));
        assert!(!event.tags.iter().any(|tag| tag.kind().to_string() == "h"));
    }

    #[test]
    fn duty_action_keeps_the_employee_p_tag_when_the_employee_signs() {
        let employee = Keys::generate();
        let action = DutyAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            duty_id: Uuid::from_u128(7),
            action: DutyActionKind::Pause,
            expected_head_event_id: "ab".repeat(32),
            proposal: None,
            reason: None,
        };
        let event = build_duty_action(&action, &employee.public_key().to_hex())
            .expect("build duty action")
            .sign_with_keys(&employee)
            .expect("sign duty action");
        assert_eq!(event.tags.len(), 2);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(employee.public_key().to_hex().as_str())
        }));
    }
}
