//! Typed event builders for Colony company member positions.
//!
//! Member-position actions are community-wide Nostr events. They carry the
//! member coordinate and omit a channel h-tag.

use crate::SdkError;
use buzz_core::company_members::{member_d_tag, validate_member_position_action};
pub use buzz_core::company_members::{
    MemberKind, MemberPositionAction, MemberPositionActionKind, MemberPositionHead, MemberStatus,
};
use buzz_core::kind::KIND_MEMBER_POSITION_ACTION;
use nostr::{EventBuilder, Kind, Tag};

/// Build a member-signed position action with its community-wide d-tag.
pub fn build_member_position_action(
    action: &MemberPositionAction,
) -> Result<EventBuilder, SdkError> {
    validate_member_position_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("member position action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "member position action serialization failed: {error}"
        ))
    })?;
    let d_tag = member_d_tag(&action.pubkey)
        .map_err(|error| SdkError::InvalidInput(format!("member pubkey is invalid: {error}")))?;
    let tag = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_MEMBER_POSITION_ACTION as u16), content).tag(tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    const PUBKEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn member_action_builder_uses_global_coordinate_without_channel_tag() {
        let action = MemberPositionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            pubkey: PUBKEY.into(),
            action: MemberPositionActionKind::SetTitle,
            expected_head_event_id: None,
            title: Some("Operations lead".into()),
            manager_pubkey: None,
            reason: None,
        };
        let event = build_member_position_action(&action)
            .expect("builder")
            .sign_with_keys(&Keys::generate())
            .expect("signed event");
        let tags = event.tags.iter().collect::<Vec<_>>();
        assert_eq!(event.kind, Kind::Custom(KIND_MEMBER_POSITION_ACTION as u16));
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].kind().to_string(), "d");
        assert_eq!(
            tags[0].content(),
            Some(format!("company:member:{PUBKEY}").as_str())
        );
        let parsed: MemberPositionAction = serde_json::from_str(&event.content).expect("content");
        assert_eq!(parsed, action);
    }

    #[test]
    fn member_action_builder_rejects_invalid_coordinates_and_payloads() {
        let action = MemberPositionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            pubkey: "bad".into(),
            action: MemberPositionActionKind::SetTitle,
            expected_head_event_id: None,
            title: Some("Operations lead".into()),
            manager_pubkey: None,
            reason: None,
        };
        assert!(build_member_position_action(&action).is_err());
    }
}
