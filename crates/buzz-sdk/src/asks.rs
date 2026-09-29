//! Typed builders for channel-scoped company asks.

use buzz_core::company_records::{
    ask_d_tag, validate_ask_action, AskAction, AskActionKind, AskResponse,
    COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_ACTION, KIND_ASK_RESPONSE};
use nostr::{EventBuilder, EventId, Kind, Tag};
use uuid::Uuid;

use crate::SdkError;

pub use buzz_core::company_records::{
    AskCategory, AskHead, AskOption, AskOutcome, AskRecord, AskResolution, AskStatus, AskSubject,
    AskSubjectKind, AskType,
};

fn build(
    channel_id: Uuid,
    kind: u32,
    ask_id: Uuid,
    content: String,
) -> Result<EventBuilder, SdkError> {
    let h_tag = Tag::parse(["h", channel_id.to_string().as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let d_value = ask_d_tag(channel_id, ask_id);
    let d_tag = Tag::parse(["d", d_value.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(kind as u16), content).tags([h_tag, d_tag]))
}

/// Build a channel-scoped ask create or cancel command (kind 47032).
///
/// Create commands include the NIP-10 root and reply markers so the relay can
/// store the action as a reply in the same transaction that advances the ask head.
pub fn build_ask_action(channel_id: Uuid, action: &AskAction) -> Result<EventBuilder, SdkError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(SdkError::InvalidInput(
            "unsupported company record schema version".into(),
        ));
    }
    validate_ask_action(action, false)
        .map_err(|error| SdkError::InvalidInput(error.to_string()))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("ask action serialization failed: {error}"))
    })?;
    let mut builder = build(channel_id, KIND_ASK_ACTION, action.ask_id, content)?;

    if action.action == AskActionKind::Create {
        let root_id = action
            .ask
            .as_ref()
            .map(|ask| ask.thread_root_event_id.as_str())
            .ok_or_else(|| SdkError::InvalidInput("create needs the ask".into()))?;
        let root_id = EventId::parse(root_id).map_err(|error| {
            SdkError::InvalidInput(format!("invalid thread root event id: {error}"))
        })?;
        let root_hex = root_id.to_hex();
        let root_tag = Tag::parse(["e", root_hex.as_str(), "", "root"])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
        let reply_tag = Tag::parse(["e", root_hex.as_str(), "", "reply"])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
        builder = builder.tag(root_tag).tag(reply_tag);
    }

    Ok(builder)
}

/// Build a channel-scoped ask response (kind 47033).
pub fn build_ask_response(
    channel_id: Uuid,
    response: &AskResponse,
) -> Result<EventBuilder, SdkError> {
    if response.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(SdkError::InvalidInput(
            "unsupported company record schema version".into(),
        ));
    }
    EventId::parse(&response.expected_head_event_id).map_err(|error| {
        SdkError::InvalidInput(format!("invalid expected head event id: {error}"))
    })?;
    let content = serde_json::to_string(response).map_err(|error| {
        SdkError::InvalidInput(format!("ask response serialization failed: {error}"))
    })?;
    build(channel_id, KIND_ASK_RESPONSE, response.ask_id, content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::{AskActionKind, AskCategory, AskType};
    use nostr::{Keys, Kind};

    fn ask(id: Uuid, thread_root_event_id: String) -> AskRecord {
        AskRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id: id,
            ask_type: AskType::Question,
            category: AskCategory::General,
            title: "What should we do?".into(),
            body: None,
            thread_root_event_id,
            addressee_pubkey: None,
            decide_by: None,
            options: None,
            items: None,
            tool_consent: None,
            subject: None,
            member_proposal: None,
        }
    }

    #[test]
    fn create_builder_binds_channel_coordinate_and_thread_root() {
        let channel_id = Uuid::from_u128(1);
        let ask_id = Uuid::from_u128(2);
        let root_id = EventId::all_zeros();
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id,
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(ask(ask_id, root_id.to_hex())),
            reason: None,
        };

        let event = build_ask_action(channel_id, &action)
            .expect("build")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert_eq!(event.kind, Kind::Custom(KIND_ASK_ACTION as u16));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["h", channel_id.to_string().as_str()] }));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["d", ask_d_tag(channel_id, ask_id).as_str()] }));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["e", root_id.to_hex().as_str(), "", "root"] }));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["e", root_id.to_hex().as_str(), "", "reply"] }));
    }

    #[test]
    fn cancel_builder_has_no_thread_metadata_tag() {
        let channel_id = Uuid::from_u128(1);
        let ask_id = Uuid::from_u128(2);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id,
            action: AskActionKind::Cancel,
            expected_head_event_id: Some("00".repeat(32)),
            ask: None,
            reason: Some("No longer needed".into()),
        };
        let event = build_ask_action(channel_id, &action)
            .expect("build")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert_eq!(event.kind, Kind::Custom(KIND_ASK_ACTION as u16));
        assert!(!event.tags.iter().any(|tag| tag.kind().to_string() == "e"));
    }

    #[test]
    fn response_builder_binds_channel_coordinate() {
        let channel_id = Uuid::from_u128(1);
        let ask_id = Uuid::from_u128(2);
        let response = AskResponse {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id,
            expected_head_event_id: "00".repeat(32),
            outcome: AskOutcome::Answered,
            reason: None,
            answer: Some("Proceed".into()),
            option_id: None,
            checked_item_ids: None,
        };
        let event = build_ask_response(channel_id, &response)
            .expect("build")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert_eq!(event.kind, Kind::Custom(KIND_ASK_RESPONSE as u16));
        assert!(event
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["d", ask_d_tag(channel_id, ask_id).as_str()] }));
    }
}
