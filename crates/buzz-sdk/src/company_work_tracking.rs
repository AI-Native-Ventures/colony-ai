//! Typed builders for persisted company work suggestions and watchdog settings.

use buzz_core::company_work_tracking::{
    company_work_suggestion_d_tag, company_work_watchdog_d_tag,
    validate_company_work_tracking_action, CompanyWorkTrackingAction,
    CompanyWorkTrackingActionKind,
};
use buzz_core::kind::KIND_COMPANY_WORK_TRACKING_ACTION;
use nostr::{EventBuilder, Kind, Tag};
use uuid::Uuid;

use crate::SdkError;

pub use buzz_core::company_work_tracking::{
    CompanyWorkCheckWhen, CompanyWorkSuggestionHead, CompanyWorkSuggestionInput,
    CompanyWorkSuggestionStatus, CompanyWorkTrackingHead, CompanyWorkWatchdogConfig,
    CompanyWorkWatchdogHead,
};

/// Build a member-signed action for an explicit suggestion or watchdog record.
///
/// The caller signs the returned event with the member's own key. The relay
/// derives the community from the host and applies channel authority.
pub fn build_company_work_tracking_action(
    channel_id: Uuid,
    action: &CompanyWorkTrackingAction,
) -> Result<EventBuilder, SdkError> {
    validate_company_work_tracking_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("company work tracking action is invalid: {error}"))
    })?;
    let d_tag = match action.action {
        CompanyWorkTrackingActionKind::Propose
        | CompanyWorkTrackingActionKind::Accept
        | CompanyWorkTrackingActionKind::Dismiss
        | CompanyWorkTrackingActionKind::Expire => company_work_suggestion_d_tag(action.record_id),
        CompanyWorkTrackingActionKind::Configure | CompanyWorkTrackingActionKind::Disable => {
            company_work_watchdog_d_tag(action.record_id)
        }
    };
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "company work tracking serialization failed: {error}"
        ))
    })?;
    let tags = vec![
        Tag::parse(["h", channel_id.to_string().as_str()])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?,
        Tag::parse(["d", d_tag.as_str()])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?,
    ];
    Ok(EventBuilder::new(
        Kind::Custom(KIND_COMPANY_WORK_TRACKING_ACTION as u16),
        content,
    )
    .tags(tags))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::business_records::BUSINESS_RECORD_SCHEMA_VERSION;

    #[test]
    fn propose_builder_uses_tracking_kind_and_source_channel_coordinate() {
        let suggestion_id = Uuid::from_u128(9);
        let channel_id = Uuid::from_u128(7);
        let action = CompanyWorkTrackingAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            action: CompanyWorkTrackingActionKind::Propose,
            record_id: suggestion_id,
            expected_head_event_id: None,
            suggestion: Some(CompanyWorkSuggestionInput {
                source_event_id: "ab".repeat(32),
                expires_at: None,
                work_item: buzz_core::business_records::CompanyWorkItemInput {
                    schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                    work_item_id: Uuid::from_u128(10),
                    title: "Prepare the launch brief".into(),
                    status: buzz_core::business_records::CompanyWorkStatus::Active,
                    assigned_pubkeys: vec!["cd".repeat(32)],
                    approver_pubkeys: Vec::new(),
                    deliverables: Vec::new(),
                    requester_pubkey: "ef".repeat(32),
                    done_condition: "The approved brief is in the thread.".into(),
                    goal_id: None,
                    source_event_id: None,
                    thread_root_event_id: None,
                    evidence: None,
                    due_at: None,
                },
            }),
            accepted_work_item_id: None,
            config: None,
        };
        let event = build_company_work_tracking_action(channel_id, &action)
            .expect("valid proposal builder")
            .sign_with_keys(&nostr::Keys::generate())
            .expect("sign proposal");
        assert_eq!(
            event.kind,
            Kind::Custom(KIND_COMPANY_WORK_TRACKING_ACTION as u16)
        );
        let tags = event.tags.iter().collect::<Vec<_>>();
        assert_eq!(tags[0].kind().to_string(), "h");
        assert_eq!(tags[0].content(), Some(channel_id.to_string().as_str()));
        assert_eq!(
            tags[1].content(),
            Some(company_work_suggestion_d_tag(suggestion_id).as_str())
        );
    }

    #[test]
    fn watchdog_builder_rejects_missing_explicit_interval() {
        let action = CompanyWorkTrackingAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            action: CompanyWorkTrackingActionKind::Configure,
            record_id: Uuid::from_u128(8),
            expected_head_event_id: None,
            suggestion: None,
            accepted_work_item_id: None,
            config: Some(CompanyWorkWatchdogConfig {
                check_when: CompanyWorkCheckWhen::DueDatePasses,
                check_interval_seconds: 0,
                ask_first_pubkey: None,
                escalate_to_pubkey: None,
                escalation_interval_seconds: None,
            }),
        };
        assert!(build_company_work_tracking_action(Uuid::from_u128(7), &action).is_err());
    }
}
