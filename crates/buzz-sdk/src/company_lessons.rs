//! Typed event builder for structured employee lessons.

use buzz_core::company_lessons::{lesson_d_tag, validate_lesson_action, LessonAction};
use buzz_core::kind::KIND_LESSON_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed community-wide lesson action with exact d and p tags.
pub fn build_lesson_action(
    action: &LessonAction,
    employee_pubkey: &str,
) -> Result<EventBuilder, SdkError> {
    validate_lesson_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("lesson action is invalid: {error}")))?;
    let employee = nostr::PublicKey::from_hex(employee_pubkey)
        .map_err(|error| SdkError::InvalidInput(format!("invalid employee pubkey: {error}")))?;
    let employee_pubkey = employee.to_hex();
    if action
        .snapshot
        .as_ref()
        .is_some_and(|snapshot| snapshot.employee_pubkey != employee_pubkey)
    {
        return Err(SdkError::InvalidInput(
            "lesson snapshot employee does not match the p tag".into(),
        ));
    }
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("lesson action serialization failed: {error}"))
    })?;
    let d_tag = lesson_d_tag(action.lesson_id);
    let d_tag = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let p_tag = Tag::parse(["p", employee_pubkey.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    // An employee proposing or editing its own lesson signs as the employee, and
    // nostr would otherwise scrub the same-pubkey `p` tag the relay requires.
    Ok(
        EventBuilder::new(Kind::Custom(KIND_LESSON_ACTION as u16), content)
            .tags([d_tag, p_tag])
            .allow_self_tagging(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_lessons::{LessonActionKind, LessonConfidence};
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;
    use uuid::Uuid;

    #[test]
    fn lesson_action_builder_binds_the_employee_coordinate() {
        let employee = Keys::generate();
        let action = LessonAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            lesson_id: Uuid::from_u128(9),
            action: LessonActionKind::Approve,
            expected_head_event_id: Some("ab".repeat(32)),
            snapshot: None,
            confidence: Some(LessonConfidence::High),
        };
        let event = build_lesson_action(&action, &employee.public_key().to_hex())
            .expect("build lesson action")
            .sign_with_keys(&Keys::generate())
            .expect("sign lesson action");
        assert_eq!(event.kind, Kind::Custom(KIND_LESSON_ACTION as u16));
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some("company:lesson:00000000-0000-0000-0000-000000000009")
        }));
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(employee.public_key().to_hex().as_str())
        }));
        assert!(!event.tags.iter().any(|tag| tag.kind().to_string() == "h"));
    }

    #[test]
    fn lesson_action_keeps_the_employee_p_tag_when_the_employee_signs() {
        let employee = Keys::generate();
        let action = LessonAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            lesson_id: Uuid::from_u128(9),
            action: LessonActionKind::Approve,
            expected_head_event_id: Some("ab".repeat(32)),
            snapshot: None,
            confidence: Some(LessonConfidence::High),
        };
        let event = build_lesson_action(&action, &employee.public_key().to_hex())
            .expect("build lesson action")
            .sign_with_keys(&employee)
            .expect("sign lesson action");
        assert_eq!(event.tags.len(), 2);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(employee.public_key().to_hex().as_str())
        }));
    }
}
