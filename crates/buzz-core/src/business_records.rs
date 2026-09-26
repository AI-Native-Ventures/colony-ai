//! Shared typed content and namespace rules for Colony business records.
//!
//! Business records remain ordinary signed Nostr events. A community is the
//! outer tenant, client groups are private NIP-29 channels, and every d-tag is
//! namespaced so NIP-33 coordinates cannot collide across clients.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

/// Current business-record JSON schema version.
pub const BUSINESS_RECORD_SCHEMA_VERSION: u8 = 1;

/// Errors returned while parsing or binding a business-record event.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BusinessRecordError {
    /// The event kind does not have a member-authored business command schema.
    #[error("unsupported business command kind")]
    UnsupportedKind,
    /// The JSON content does not match the kind's typed schema.
    #[error("invalid business record content")]
    InvalidContent,
    /// The record uses a schema version the relay does not understand.
    #[error("unsupported business record schema version")]
    UnsupportedSchemaVersion,
    /// The client UUID does not match the NIP-29 channel UUID.
    #[error("client id does not match channel scope")]
    ClientChannelMismatch,
    /// The d-tag is not in the expected namespace for this record.
    #[error("business record d-tag does not match its namespace")]
    DTagMismatch,
    /// A version or digest is not a 32-byte lowercase hexadecimal value.
    #[error("invalid event id or SHA-256 digest")]
    InvalidHexReference,
}

/// Member-authored business command content parsed by the relay broker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "record", rename_all = "snake_case")]
pub enum BusinessCommand {
    /// Party identity mutation.
    PartyAction(PartyAction),
    /// Client relationship mutation.
    ClientAction(ClientAction),
    /// Work-item mutation.
    WorkItemAction(WorkItemAction),
    /// Immutable proposal revision.
    ProposalVersion(ProposalVersion),
    /// Exact-version proposal acceptance and conversion request.
    ProposalAcceptance(ProposalAcceptance),
    /// Immutable deliverable revision.
    DeliverableVersion(DeliverableVersion),
    /// Exact-version deliverable approval decision.
    DeliverableApproval(DeliverableApproval),
}

/// A business or client record action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordAction {
    /// Create a record that has no current head.
    Create,
    /// Replace a record using an exact expected head event id.
    Update,
    /// Mark a record as archived while retaining its history.
    Archive,
    /// Restore a previously archived record.
    Restore,
}

/// Approval outcome attached to one immutable version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    /// The exact version is accepted.
    Approved,
    /// The exact version needs changes.
    ChangesRequested,
    /// The exact version is rejected.
    Rejected,
}

/// Party identity shared by a prospect and a client relationship.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyRecord {
    /// Stable party UUID.
    pub party_id: Uuid,
    /// `person` or `organization`.
    pub party_type: String,
    /// Display name from the source record.
    pub display_name: String,
    /// Source-linked external identifiers, never secret credentials.
    pub external_ids: Vec<String>,
}

/// Relay-authored canonical party head content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyHead {
    /// Schema version.
    pub schema_version: u8,
    /// The stable party UUID.
    pub party_id: Uuid,
    /// Whether this party identity is active or archived.
    pub status: String,
    /// Current party identity data.
    pub party: PartyRecord,
    /// Event id of the member action that produced this head.
    pub source_action_event_id: String,
}

/// Member request to create or update a party identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable party UUID.
    pub party_id: Uuid,
    /// Requested mutation.
    pub action: RecordAction,
    /// Expected current party head id, absent only for creation.
    pub expected_head_event_id: Option<String>,
    /// Replacement party identity data.
    pub party: PartyRecord,
}

/// Relay-authored canonical client relationship head content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID, equal to the private NIP-29 client channel UUID.
    pub client_id: Uuid,
    /// Canonical person or organization identity.
    pub party_id: Uuid,
    /// Client-facing display name.
    pub display_name: String,
    /// Pubkeys authorized to approve client-facing work.
    pub approver_pubkeys: Vec<String>,
    /// Current relationship state.
    pub status: String,
    /// Event id of the member action that produced this head.
    pub source_action_event_id: String,
}

/// Member-supplied client head fields. The relay fills the source event id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientHeadInput {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID, equal to the private channel UUID.
    pub client_id: Uuid,
    /// Canonical person or organization identity.
    pub party_id: Uuid,
    /// Client-facing display name.
    pub display_name: String,
    /// Pubkeys authorized to approve client-facing work.
    pub approver_pubkeys: Vec<String>,
    /// Current relationship state.
    pub status: String,
}

/// Member request to create or update a client relationship.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and required `h` channel UUID.
    pub client_id: Uuid,
    /// Requested mutation.
    pub action: RecordAction,
    /// Expected current client head id, absent only for creation.
    pub expected_head_event_id: Option<String>,
    /// Canonical client record to write.
    pub head: ClientHeadInput,
}

/// Current deliverable version pointer in a work-item head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeliverablePointer {
    /// Stable deliverable UUID.
    pub deliverable_id: Uuid,
    /// Exact current immutable version event id.
    pub version_event_id: String,
    /// SHA-256 digest of the canonical JSON body, excluding the version envelope.
    pub content_digest: String,
    /// SHA-256 digest of the ordered media digest list.
    pub media_digest: String,
    /// SHA-256 digest combining the content and media digests.
    pub version_digest: String,
}

/// Relay-authored canonical client work-item head content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkItemHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and required `h` channel UUID.
    pub client_id: Uuid,
    /// Stable work-item UUID.
    pub work_item_id: Uuid,
    /// Short work title.
    pub title: String,
    /// Current work state.
    pub status: String,
    /// Pubkeys allowed to submit work output.
    pub assigned_pubkeys: Vec<String>,
    /// Pubkeys authorized to accept client-facing output.
    pub approver_pubkeys: Vec<String>,
    /// Current version of each deliverable in this work item.
    pub deliverables: Vec<DeliverablePointer>,
    /// Event id of the member action or version event that produced this head.
    pub source_event_id: String,
}

/// Member-supplied work-item fields. The relay fills the source event id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkItemHeadInput {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and private channel UUID.
    pub client_id: Uuid,
    /// Stable work-item UUID.
    pub work_item_id: Uuid,
    /// Short work title.
    pub title: String,
    /// Current work state.
    pub status: String,
    /// Pubkeys allowed to submit work output.
    pub assigned_pubkeys: Vec<String>,
    /// Pubkeys authorized to accept client-facing output.
    pub approver_pubkeys: Vec<String>,
    /// Current version of each deliverable in this work item.
    pub deliverables: Vec<DeliverablePointer>,
}

/// Member request to create or update a client work item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkItemAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and required `h` channel UUID.
    pub client_id: Uuid,
    /// Stable work-item UUID.
    pub work_item_id: Uuid,
    /// Requested mutation.
    pub action: RecordAction,
    /// Expected current work-item head id, absent only for creation.
    pub expected_head_event_id: Option<String>,
    /// Replacement work-item head content.
    pub head: WorkItemHeadInput,
}

/// Immutable client deliverable version content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeliverableVersion {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and required `h` channel UUID.
    pub client_id: Uuid,
    /// Parent work-item UUID.
    pub work_item_id: Uuid,
    /// Stable deliverable UUID.
    pub deliverable_id: Uuid,
    /// Monotonically increasing version number for this deliverable.
    pub version: u32,
    /// Expected prior version event id, absent only for the first version.
    pub previous_version_event_id: Option<String>,
    /// SHA-256 digest of the canonical JSON body, excluding the version envelope.
    pub content_digest: String,
    /// SHA-256 digests for attached media, unique and sorted lexicographically.
    pub media_digests: Vec<String>,
    /// Versioned deliverable body, which may include structured text and references.
    pub body: Value,
}

/// Append-only decision on one exact deliverable version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeliverableApproval {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and required `h` channel UUID.
    pub client_id: Uuid,
    /// Parent work-item UUID.
    pub work_item_id: Uuid,
    /// Stable deliverable UUID.
    pub deliverable_id: Uuid,
    /// Exact immutable version event id being reviewed.
    pub version_event_id: String,
    /// Exact content digest from that version.
    pub content_digest: String,
    /// Digest of the exact ordered media digest list from that version.
    pub media_digest: String,
    /// Decision on the named version.
    pub decision: ApprovalDecision,
    /// Optional review note.
    pub note: Option<String>,
}

/// Immutable proposal revision authored in the internal business channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposalVersion {
    /// Schema version.
    pub schema_version: u8,
    /// Stable proposal UUID.
    pub proposal_id: Uuid,
    /// Stable prospective party UUID.
    pub prospect_party_id: Uuid,
    /// Pubkey allowed to accept this proposal revision.
    pub named_acceptor_pubkey: String,
    /// Monotonically increasing proposal revision.
    pub revision: u32,
    /// Expected prior proposal version event id, absent only for the first version.
    pub previous_version_event_id: Option<String>,
    /// Optional expiry time in Unix seconds.
    pub expires_at: Option<i64>,
    /// ISO 4217 currency code.
    pub currency: String,
    /// Scope, quantity, and amount in minor currency units.
    pub lines: Vec<ProposalLine>,
    /// Terms the named acceptor is accepting.
    pub terms: String,
}

/// Relay-authored current pointer for a prospect proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposalHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable proposal UUID.
    pub proposal_id: Uuid,
    /// Current immutable version event id.
    pub current_version_event_id: String,
    /// SHA-256 digest of the exact current version event content.
    pub current_version_digest: String,
    /// Current revision number.
    pub revision: u32,
    /// Event that produced this head.
    pub source_event_id: String,
}

/// Priced line in a proposal revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposalLine {
    /// Stable service UUID, when linked to a service catalog record.
    pub service_id: Option<Uuid>,
    /// Work scope description.
    pub description: String,
    /// Quantity in hundredths, avoiding floating-point money arithmetic.
    pub quantity_hundredths: u32,
    /// Unit amount in minor currency units.
    pub unit_amount_minor: i64,
}

/// Acceptance of one exact proposal version and its idempotent conversion ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposalAcceptance {
    /// Schema version.
    pub schema_version: u8,
    /// Stable proposal UUID.
    pub proposal_id: Uuid,
    /// Exact proposal version event id accepted by the named signer.
    pub proposal_version_event_id: String,
    /// SHA-256 digest of that version event's content.
    pub proposal_version_digest: String,
    /// Stable retry key for the conversion.
    pub conversion_id: Uuid,
    /// Client UUID and target private NIP-29 channel UUID.
    pub client_id: Uuid,
    /// Stable work-item UUID to create or link during conversion.
    pub work_item_id: Uuid,
    /// Stable draft-invoice UUID to create or link during conversion.
    pub draft_invoice_id: Uuid,
}

/// Relay-authored receipt for a completed proposal conversion claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposalConversionReceipt {
    /// Schema version.
    pub schema_version: u8,
    /// Stable retry key.
    pub conversion_id: Uuid,
    /// Accepted proposal UUID and exact version event id.
    pub proposal_id: Uuid,
    /// Accepted proposal version event id.
    pub proposal_version_event_id: String,
    /// Stable client UUID and target client channel UUID.
    pub client_id: Uuid,
    /// Stable work-item UUID.
    pub work_item_id: Uuid,
    /// Stable draft-invoice UUID.
    pub draft_invoice_id: Uuid,
    /// Signed source acceptance event id.
    pub acceptance_event_id: String,
}

/// A draft invoice created from one accepted proposal revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftInvoiceHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable client UUID and private client channel UUID.
    pub client_id: Uuid,
    /// Stable invoice UUID.
    pub invoice_id: Uuid,
    /// Source proposal and exact accepted version.
    pub proposal_id: Uuid,
    /// Exact accepted proposal version event id.
    pub proposal_version_event_id: String,
    /// Currency inherited from the proposal.
    pub currency: String,
    /// Proposed invoice lines, still in draft state.
    pub lines: Vec<ProposalLine>,
    /// Sum of line totals in minor currency units, rounded down from hundredths.
    pub total_minor: i64,
    /// Draft lifecycle state.
    pub status: String,
    /// Event that produced this head.
    pub source_event_id: String,
}

/// Validate that a client UUID is exactly the private channel UUID in its `h` tag.
pub fn validate_client_channel(
    client_id: Uuid,
    channel_id: Uuid,
) -> Result<(), BusinessRecordError> {
    if client_id == channel_id {
        Ok(())
    } else {
        Err(BusinessRecordError::ClientChannelMismatch)
    }
}

/// Build a d-tag for one client-scoped record coordinate.
pub fn client_d_tag(client_id: Uuid, record_type: &str, record_id: Uuid) -> String {
    format!("client:{client_id}:{record_type}:{record_id}")
}

/// Build a d-tag for a prospect or business-level record before client conversion.
pub fn business_d_tag(community_id: Uuid, record_type: &str, record_id: Uuid) -> String {
    format!("business:{community_id}:{record_type}:{record_id}")
}

/// Build the immutable d-tag for one proposal revision.
pub fn proposal_version_d_tag(community_id: Uuid, proposal_id: Uuid, revision: u32) -> String {
    format!(
        "{}:version:{revision}",
        business_d_tag(community_id, "proposal", proposal_id)
    )
}

/// Build the immutable d-tag for one client deliverable revision.
pub fn deliverable_version_d_tag(client_id: Uuid, deliverable_id: Uuid, revision: u32) -> String {
    format!(
        "{}:version:{revision}",
        client_d_tag(client_id, "deliverable", deliverable_id)
    )
}

/// Build the append-only d-tag for a decision on one exact deliverable version.
pub fn deliverable_approval_d_tag(client_id: Uuid, version_event_id: &str) -> String {
    format!("client:{client_id}:deliverable-approval:{version_event_id}")
}

/// Check a supplied d-tag against the exact client-scoped coordinate.
pub fn validate_client_d_tag(
    actual: &str,
    client_id: Uuid,
    record_type: &str,
    record_id: Uuid,
) -> Result<(), BusinessRecordError> {
    if actual == client_d_tag(client_id, record_type, record_id) {
        Ok(())
    } else {
        Err(BusinessRecordError::DTagMismatch)
    }
}

/// Check a supplied d-tag against the exact business-scoped coordinate.
pub fn validate_business_d_tag(
    actual: &str,
    community_id: Uuid,
    record_type: &str,
    record_id: Uuid,
) -> Result<(), BusinessRecordError> {
    if actual == business_d_tag(community_id, record_type, record_id) {
        Ok(())
    } else {
        Err(BusinessRecordError::DTagMismatch)
    }
}

/// Validate the h and d coordinates against a parsed business command.
pub fn validate_business_command_scope(
    community_id: Uuid,
    channel_id: Uuid,
    d_tag: &str,
    command: &BusinessCommand,
) -> Result<(), BusinessRecordError> {
    match command {
        BusinessCommand::PartyAction(value) => {
            validate_business_d_tag(d_tag, community_id, "party", value.party_id)
        }
        BusinessCommand::ClientAction(value) => {
            validate_client_channel(value.client_id, channel_id)?;
            if value.head.client_id != value.client_id
                || value.head.schema_version != value.schema_version
            {
                return Err(BusinessRecordError::InvalidContent);
            }
            validate_client_d_tag(d_tag, value.client_id, "client", value.client_id)
        }
        BusinessCommand::WorkItemAction(value) => {
            validate_client_channel(value.client_id, channel_id)?;
            if value.head.schema_version != value.schema_version
                || value.head.client_id != value.client_id
                || value.head.work_item_id != value.work_item_id
            {
                return Err(BusinessRecordError::InvalidContent);
            }
            validate_client_d_tag(d_tag, value.client_id, "work", value.work_item_id)
        }
        BusinessCommand::ProposalVersion(value) => {
            if d_tag == proposal_version_d_tag(community_id, value.proposal_id, value.revision) {
                Ok(())
            } else {
                Err(BusinessRecordError::DTagMismatch)
            }
        }
        BusinessCommand::ProposalAcceptance(value) => {
            validate_business_d_tag(d_tag, community_id, "conversion", value.conversion_id)
        }
        BusinessCommand::DeliverableVersion(value) => {
            validate_client_channel(value.client_id, channel_id)?;
            if d_tag
                == deliverable_version_d_tag(value.client_id, value.deliverable_id, value.version)
            {
                Ok(())
            } else {
                Err(BusinessRecordError::DTagMismatch)
            }
        }
        BusinessCommand::DeliverableApproval(value) => {
            validate_client_channel(value.client_id, channel_id)?;
            if d_tag == deliverable_approval_d_tag(value.client_id, &value.version_event_id) {
                Ok(())
            } else {
                Err(BusinessRecordError::DTagMismatch)
            }
        }
    }
}

/// Validate an event id or SHA-256 digest as exactly 32 lowercase hex bytes.
pub fn validate_hex_reference(value: &str) -> Result<(), BusinessRecordError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(BusinessRecordError::InvalidHexReference)
    }
}

/// Return whether an approval still targets the current deliverable version.
///
/// A later version changes the work head's current event id, so all earlier
/// approvals immediately cease to represent current approval state.
pub fn approval_matches_current_version(
    approval: &DeliverableApproval,
    current: Option<&DeliverablePointer>,
) -> bool {
    let Some(current) = current else {
        return false;
    };
    approval.version_event_id == current.version_event_id
        && approval.content_digest == current.content_digest
        && approval.media_digest == current.media_digest
}

/// Parse a member-authored business command according to its Nostr kind.
pub fn parse_business_command(
    kind: u32,
    content: &str,
) -> Result<BusinessCommand, BusinessRecordError> {
    macro_rules! parse {
        ($type:ty, $variant:ident) => {
            serde_json::from_str::<$type>(content)
                .map(BusinessCommand::$variant)
                .map_err(|_| BusinessRecordError::InvalidContent)
        };
    }

    let command = match kind {
        crate::kind::KIND_PARTY_ACTION => parse!(PartyAction, PartyAction)?,
        crate::kind::KIND_CLIENT_ACTION => parse!(ClientAction, ClientAction)?,
        crate::kind::KIND_WORK_ITEM_ACTION => parse!(WorkItemAction, WorkItemAction)?,
        crate::kind::KIND_PROPOSAL_VERSION => parse!(ProposalVersion, ProposalVersion)?,
        crate::kind::KIND_PROPOSAL_ACCEPTANCE => parse!(ProposalAcceptance, ProposalAcceptance)?,
        crate::kind::KIND_DELIVERABLE_VERSION => parse!(DeliverableVersion, DeliverableVersion)?,
        crate::kind::KIND_DELIVERABLE_APPROVAL => parse!(DeliverableApproval, DeliverableApproval)?,
        _ => return Err(BusinessRecordError::UnsupportedKind),
    };

    let schema_version = match &command {
        BusinessCommand::PartyAction(value) => value.schema_version,
        BusinessCommand::ClientAction(value) => value.schema_version,
        BusinessCommand::WorkItemAction(value) => value.schema_version,
        BusinessCommand::ProposalVersion(value) => value.schema_version,
        BusinessCommand::ProposalAcceptance(value) => value.schema_version,
        BusinessCommand::DeliverableVersion(value) => value.schema_version,
        BusinessCommand::DeliverableApproval(value) => value.schema_version,
    };
    if schema_version != BUSINESS_RECORD_SCHEMA_VERSION {
        return Err(BusinessRecordError::UnsupportedSchemaVersion);
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(event_id: &str, digest: &str) -> DeliverablePointer {
        DeliverablePointer {
            deliverable_id: Uuid::from_u128(3),
            version_event_id: event_id.to_owned(),
            content_digest: digest.to_owned(),
            media_digest: digest.to_owned(),
            version_digest: digest.to_owned(),
        }
    }

    fn approval(event_id: &str, digest: &str) -> DeliverableApproval {
        DeliverableApproval {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id: Uuid::from_u128(1),
            work_item_id: Uuid::from_u128(2),
            deliverable_id: Uuid::from_u128(3),
            version_event_id: event_id.to_owned(),
            content_digest: digest.to_owned(),
            media_digest: digest.to_owned(),
            decision: ApprovalDecision::Approved,
            note: None,
        }
    }

    #[test]
    fn namespaced_client_records_bind_to_the_channel_id() {
        let client_id = Uuid::from_u128(1);
        let other_client_id = Uuid::from_u128(2);
        assert_eq!(validate_client_channel(client_id, client_id), Ok(()));
        assert_eq!(
            validate_client_channel(other_client_id, client_id),
            Err(BusinessRecordError::ClientChannelMismatch)
        );
        assert_eq!(
            validate_client_d_tag(
                &client_d_tag(other_client_id, "work", Uuid::from_u128(3)),
                client_id,
                "work",
                Uuid::from_u128(3),
            ),
            Err(BusinessRecordError::DTagMismatch)
        );
    }

    #[test]
    fn business_command_scope_denies_cross_client_channel_binding() {
        let client_id = Uuid::from_u128(1);
        let other_channel_id = Uuid::from_u128(2);
        let action = ClientAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id,
            action: RecordAction::Create,
            expected_head_event_id: None,
            head: ClientHeadInput {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                client_id,
                party_id: Uuid::from_u128(3),
                display_name: "Example Client".into(),
                approver_pubkeys: Vec::new(),
                status: "active".into(),
            },
        };

        assert_eq!(
            validate_business_command_scope(
                Uuid::from_u128(4),
                other_channel_id,
                &client_d_tag(client_id, "client", client_id),
                &BusinessCommand::ClientAction(action),
            ),
            Err(BusinessRecordError::ClientChannelMismatch)
        );
    }

    #[test]
    fn exact_version_approval_is_invalidated_by_a_new_version() {
        let first = version("a".repeat(64).as_str(), "b".repeat(64).as_str());
        let second = version("c".repeat(64).as_str(), "d".repeat(64).as_str());
        let prior_approval = approval(&first.version_event_id, &first.version_digest);

        assert!(approval_matches_current_version(
            &prior_approval,
            Some(&first)
        ));
        assert!(!approval_matches_current_version(
            &prior_approval,
            Some(&second)
        ));
        assert!(!approval_matches_current_version(&prior_approval, None));
    }

    #[test]
    fn client_and_business_d_tags_include_the_outer_identifier() {
        let id = Uuid::from_u128(9);
        let other = Uuid::from_u128(10);
        assert_eq!(
            client_d_tag(id, "work", other),
            format!("client:{id}:work:{other}")
        );
        assert_eq!(
            business_d_tag(id, "proposal", other),
            format!("business:{id}:proposal:{other}")
        );
    }
}
