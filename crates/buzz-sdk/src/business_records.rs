//! Typed builders for Colony Phase 2 business-record commands.
//!
//! Kind constants are re-exported through [`crate::kind`], which is the same
//! authoritative registry used by `buzz-core` and the relay.

use buzz_core::business_records::{
    business_d_tag, client_d_tag, deliverable_approval_d_tag, deliverable_version_d_tag,
    proposal_version_d_tag,
};
pub use buzz_core::business_records::{
    ApprovalDecision, ClientAction, ClientHead, ClientHeadInput, DeliverableApproval,
    DeliverablePointer, DeliverableVersion, DraftInvoiceHead, PartyAction, ProposalAcceptance,
    ProposalConversionReceipt, ProposalHead, ProposalLine, ProposalVersion, RecordAction,
    WorkItemAction, WorkItemHead, WorkItemHeadInput,
};
use buzz_core::kind::*;
use nostr::{EventBuilder, Kind, Tag};
use serde::Serialize;
use uuid::Uuid;

use crate::SdkError;

fn build<T: Serialize>(
    kind: u32,
    channel_id: Uuid,
    d_tag: String,
    content: &T,
) -> Result<EventBuilder, SdkError> {
    let content = serde_json::to_string(content).map_err(|error| {
        SdkError::InvalidInput(format!("business record serialization failed: {error}"))
    })?;
    let tags = vec![
        Tag::parse(["h", channel_id.to_string().as_str()])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?,
        Tag::parse(["d", d_tag.as_str()])
            .map_err(|error| SdkError::InvalidTag(error.to_string()))?,
    ];
    Ok(EventBuilder::new(Kind::Custom(kind as u16), content).tags(tags))
}

/// Build a member-signed party action in the internal business channel.
pub fn build_party_action(
    community_id: Uuid,
    business_channel_id: Uuid,
    action: &PartyAction,
) -> Result<EventBuilder, SdkError> {
    build(
        KIND_PARTY_ACTION,
        business_channel_id,
        business_d_tag(community_id, "party", action.party_id),
        action,
    )
}

/// Build a member-signed client action in the matching client channel.
pub fn build_client_action(action: &ClientAction) -> Result<EventBuilder, SdkError> {
    build(
        KIND_CLIENT_ACTION,
        action.client_id,
        client_d_tag(action.client_id, "client", action.client_id),
        action,
    )
}

/// Build a member-signed work-item action in its client channel.
pub fn build_work_item_action(action: &WorkItemAction) -> Result<EventBuilder, SdkError> {
    build(
        KIND_WORK_ITEM_ACTION,
        action.client_id,
        client_d_tag(action.client_id, "work", action.work_item_id),
        action,
    )
}

/// Build a member-signed immutable proposal revision in the business channel.
pub fn build_proposal_version(
    community_id: Uuid,
    business_channel_id: Uuid,
    version: &ProposalVersion,
) -> Result<EventBuilder, SdkError> {
    let d_tag = proposal_version_d_tag(community_id, version.proposal_id, version.revision);
    build(KIND_PROPOSAL_VERSION, business_channel_id, d_tag, version)
}

/// Build a member-signed exact-version proposal acceptance and conversion request.
pub fn build_proposal_acceptance(
    community_id: Uuid,
    business_channel_id: Uuid,
    acceptance: &ProposalAcceptance,
) -> Result<EventBuilder, SdkError> {
    build(
        KIND_PROPOSAL_ACCEPTANCE,
        business_channel_id,
        business_d_tag(community_id, "conversion", acceptance.conversion_id),
        acceptance,
    )
}

/// Build a member-signed immutable deliverable version in its client channel.
pub fn build_deliverable_version(version: &DeliverableVersion) -> Result<EventBuilder, SdkError> {
    let d_tag =
        deliverable_version_d_tag(version.client_id, version.deliverable_id, version.version);
    build(KIND_DELIVERABLE_VERSION, version.client_id, d_tag, version)
}

/// Build a member-signed approval decision for an exact deliverable version.
pub fn build_deliverable_approval(
    approval: &DeliverableApproval,
) -> Result<EventBuilder, SdkError> {
    let d_tag = deliverable_approval_d_tag(approval.client_id, &approval.version_event_id);
    build(
        KIND_DELIVERABLE_APPROVAL,
        approval.client_id,
        d_tag,
        approval,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::business_records::BUSINESS_RECORD_SCHEMA_VERSION;

    #[test]
    fn client_action_builder_binds_h_and_namespaced_d_tags() {
        let id = Uuid::from_u128(1);
        let action = ClientAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id: id,
            action: buzz_core::business_records::RecordAction::Create,
            expected_head_event_id: None,
            head: buzz_core::business_records::ClientHeadInput {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                client_id: id,
                party_id: Uuid::from_u128(2),
                display_name: "Example Client".into(),
                approver_pubkeys: Vec::new(),
                status: "active".into(),
            },
        };
        let event = build_client_action(&action)
            .expect("builder")
            .sign_with_keys(&nostr::Keys::generate())
            .expect("signed event");
        assert_eq!(event.kind, Kind::Custom(KIND_CLIENT_ACTION as u16));
        assert_eq!(event.tags.len(), 2);
        let tags = event.tags.iter().collect::<Vec<_>>();
        assert_eq!(tags[0].kind().to_string(), "h");
        let expected_channel = id.to_string();
        assert_eq!(tags[0].content(), Some(expected_channel.as_str()));
        assert_eq!(tags[1].kind().to_string(), "d");
        let expected_d_tag = client_d_tag(id, "client", id);
        assert_eq!(tags[1].content(), Some(expected_d_tag.as_str()));
    }
}
