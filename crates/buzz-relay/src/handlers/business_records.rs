//! Nostr-first broker for the first Colony business-record workflows.
//!
//! Member requests are validated and persisted with their relay-authored heads
//! in one database transaction. Client records always live in private groups.

use std::sync::Arc;

use nostr::{Event, EventBuilder, Kind, Tag};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use buzz_core::business_records::{
    approval_matches_current_version, business_d_tag, client_d_tag, parse_business_command,
    proposal_version_d_tag, validate_business_command_scope, validate_hex_reference,
    BusinessCommand, ClientAction, ClientHead, DeliverablePointer, DeliverableVersion,
    DraftInvoiceHead, PartyAction, PartyHead, ProposalAcceptance, ProposalHead, ProposalVersion,
    RecordAction, WorkItemAction, WorkItemHead, BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::*;
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::{DbError, EventQuery};

use crate::state::AppState;

use super::ingest::{IngestAuth, IngestError, IngestResult};

struct HeadWrite {
    event: Event,
    channel_id: Uuid,
    d_tag: String,
    expected_event_id: Option<Vec<u8>>,
}

struct ExpectedHead {
    kind: u32,
    d_tag: String,
    event_id: Vec<u8>,
}

struct ConversionClaim {
    conversion_id: Uuid,
    proposal_id: Uuid,
    business_channel_id: Uuid,
    version_event_id: Vec<u8>,
    version_digest: Vec<u8>,
    acceptance_event_id: Vec<u8>,
    receipt_event_id: Vec<u8>,
    accepted_by_pubkey: Vec<u8>,
    client_id: Uuid,
    work_item_id: Uuid,
    draft_invoice_id: Uuid,
}

#[derive(Clone)]
struct ClientChannelProvision {
    channel_id: Uuid,
    name: String,
}

struct PersistBatch {
    command: Event,
    channel_id: Uuid,
    heads: Vec<HeadWrite>,
    appended: Vec<(Event, Uuid)>,
    expected_heads: Vec<ExpectedHead>,
    conversion_claim: Option<ConversionClaim>,
    client_channel_to_create: Option<ClientChannelProvision>,
}

#[datastore_span(name = "business_record_command", system = "postgresql")]
/// Validate and persist one member-signed business-record command.
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let (channel_id, d_tag) = command_coordinates(&event)?;
    let kind = event.kind.as_u16() as u32;
    let command = parse_business_command(kind, &event.content)
        .map_err(|error| invalid(format!("business command: {error}")))?;
    validate_business_command_scope(*tenant.community().as_uuid(), channel_id, &d_tag, &command)
        .map_err(|error| invalid(format!("business command scope: {error}")))?;

    if auth
        .channel_ids()
        .is_some_and(|channel_ids| !channel_ids.contains(&channel_id))
    {
        return Err(IngestError::AuthFailed(
            "restricted: token is not scoped to this channel".into(),
        ));
    }

    let _channel = get_private_stream_channel(state, tenant.community(), channel_id).await?;
    let actor = auth.pubkey().to_bytes().to_vec();
    let role = state
        .db
        .get_member_role(tenant.community(), channel_id, &actor)
        .await
        .map_err(internal)?
        .ok_or_else(|| forbidden("actor is not a member of the private business channel"))?;

    let mut heads = Vec::new();
    let mut appended = Vec::new();
    let mut expected_heads = Vec::new();
    let mut conversion_claim = None;
    let mut client_channel_to_create = None;
    let mut client_channel_to_sync = None;

    match command {
        BusinessCommand::PartyAction(action) => {
            require_member_or_admin(&role)?;
            if action.party.party_id != action.party_id {
                return Err(invalid("party id does not match party record"));
            }
            validate_party(&action)?;
            let d_tag = business_d_tag(*tenant.community().as_uuid(), "party", action.party_id);
            let current =
                current_head::<PartyHead>(state, tenant.community(), KIND_PARTY_HEAD, &d_tag)
                    .await?;
            if current
                .as_ref()
                .is_some_and(|stored| stored.channel_id != Some(channel_id))
            {
                return Err(conflict("party record belongs to another business channel"));
            }
            check_expected(
                action.action,
                action.expected_head_event_id.as_deref(),
                current.as_ref(),
            )?;
            let previous = current
                .as_ref()
                .map(|stored| parse_content::<PartyHead>(&stored.event))
                .transpose()?;
            let status = resolve_lifecycle_status(
                action.action,
                previous.as_ref().map(|head| head.status.as_str()),
                None,
                "active",
            )?;
            let head = PartyHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                party_id: action.party_id,
                status,
                party: action.party,
                source_action_event_id: event.id.to_hex(),
            };
            heads.push(HeadWrite {
                event: relay_event(KIND_PARTY_HEAD, channel_id, &d_tag, &head, state)?,
                channel_id,
                d_tag,
                expected_event_id: current.map(|stored| stored.event.id.to_bytes().to_vec()),
            });
        }
        BusinessCommand::ClientAction(action) => {
            require_admin(&role)?;
            validate_client_action(channel_id, &action)?;
            let party_d =
                business_d_tag(*tenant.community().as_uuid(), "party", action.head.party_id);
            let party_event =
                current_head::<PartyHead>(state, tenant.community(), KIND_PARTY_HEAD, &party_d)
                    .await?
                    .ok_or_else(|| conflict("client party does not exist"))?;
            let party: PartyHead = parse_content(&party_event.event)?;
            if party.party_id != action.head.party_id || party.status == "archived" {
                return Err(conflict(
                    "client party is archived or its coordinate does not match its content",
                ));
            }
            let d_tag = client_d_tag(action.client_id, "client", action.client_id);
            let current =
                current_head::<ClientHead>(state, tenant.community(), KIND_CLIENT_HEAD, &d_tag)
                    .await?;
            if current
                .as_ref()
                .is_some_and(|stored| stored.channel_id != Some(channel_id))
            {
                return Err(conflict("client record belongs to another client channel"));
            }
            check_expected(
                action.action,
                action.expected_head_event_id.as_deref(),
                current.as_ref(),
            )?;
            let previous = current
                .as_ref()
                .map(|stored| parse_content::<ClientHead>(&stored.event))
                .transpose()?;
            let status = resolve_lifecycle_status(
                action.action,
                previous.as_ref().map(|head| head.status.as_str()),
                Some(&action.head.status),
                "active",
            )?;
            let head = ClientHead {
                schema_version: action.head.schema_version,
                client_id: action.head.client_id,
                party_id: action.head.party_id,
                display_name: action.head.display_name,
                approver_pubkeys: action.head.approver_pubkeys,
                status,
                source_action_event_id: event.id.to_hex(),
            };
            heads.push(HeadWrite {
                event: relay_event(KIND_CLIENT_HEAD, channel_id, &d_tag, &head, state)?,
                channel_id,
                d_tag,
                expected_event_id: current.map(|stored| stored.event.id.to_bytes().to_vec()),
            });
        }
        BusinessCommand::WorkItemAction(action) => {
            validate_work_item_action(&role, &action)?;
            let d_tag = client_d_tag(action.client_id, "work", action.work_item_id);
            let current = current_head::<WorkItemHead>(
                state,
                tenant.community(),
                KIND_WORK_ITEM_HEAD,
                &d_tag,
            )
            .await?;
            if current
                .as_ref()
                .is_some_and(|stored| stored.channel_id != Some(channel_id))
            {
                return Err(conflict("work item belongs to another client channel"));
            }
            check_expected(
                action.action,
                action.expected_head_event_id.as_deref(),
                current.as_ref(),
            )?;
            let previous = current
                .as_ref()
                .map(|stored| parse_content::<WorkItemHead>(&stored.event))
                .transpose()?;
            if let Some(previous) = previous.as_ref() {
                if action.head.deliverables != previous.deliverables {
                    return Err(invalid(
                        "work-item actions cannot change deliverable version pointers",
                    ));
                }
                if !is_admin(&role)
                    && !previous
                        .assigned_pubkeys
                        .iter()
                        .any(|pubkey| pubkey == &auth.pubkey().to_hex())
                {
                    return Err(forbidden("actor is not assigned to this work item"));
                }
                if !is_admin(&role)
                    && (action.head.title != previous.title
                        || action.head.assigned_pubkeys != previous.assigned_pubkeys
                        || action.head.approver_pubkeys != previous.approver_pubkeys)
                {
                    return Err(forbidden(
                        "only an owner or admin can change work-item assignments or title",
                    ));
                }
            } else {
                if !is_admin(&role) {
                    return Err(forbidden("only an owner or admin can create a work item"));
                }
                if !action.head.deliverables.is_empty() {
                    return Err(invalid(
                        "work-item creation cannot supply unverified deliverable pointers",
                    ));
                }
            }
            let status = resolve_lifecycle_status(
                action.action,
                previous.as_ref().map(|head| head.status.as_str()),
                Some(&action.head.status),
                "open",
            )?;
            let head = WorkItemHead {
                schema_version: action.head.schema_version,
                client_id: action.head.client_id,
                work_item_id: action.head.work_item_id,
                title: action.head.title,
                status,
                assigned_pubkeys: action.head.assigned_pubkeys,
                approver_pubkeys: action.head.approver_pubkeys,
                deliverables: action.head.deliverables,
                source_event_id: event.id.to_hex(),
            };
            heads.push(HeadWrite {
                event: relay_event(KIND_WORK_ITEM_HEAD, channel_id, &d_tag, &head, state)?,
                channel_id,
                d_tag,
                expected_event_id: current.map(|stored| stored.event.id.to_bytes().to_vec()),
            });
        }
        BusinessCommand::ProposalVersion(version) => {
            require_member_or_admin(&role)?;
            validate_proposal_version(&version)?;
            let proposal_head_d = business_d_tag(
                *tenant.community().as_uuid(),
                "proposal",
                version.proposal_id,
            );
            let current = current_head::<ProposalHead>(
                state,
                tenant.community(),
                KIND_PROPOSAL_HEAD,
                &proposal_head_d,
            )
            .await?;
            if current
                .as_ref()
                .is_some_and(|stored| stored.channel_id != Some(channel_id))
            {
                return Err(conflict("proposal belongs to another business channel"));
            }
            if version.revision == 1 {
                if current.is_some() || version.previous_version_event_id.is_some() {
                    return Err(conflict("proposal already has a current version"));
                }
            } else {
                let Some(current) = current.as_ref() else {
                    return Err(conflict("proposal prior version is missing"));
                };
                let prior: ProposalHead = parse_content(&current.event)?;
                if prior.revision.checked_add(1) != Some(version.revision)
                    || version.previous_version_event_id.as_deref()
                        != Some(current.event.id.to_hex().as_str())
                {
                    return Err(conflict("proposal version changed since it was loaded"));
                }
            }
            let version_event = event.clone();
            let version_digest = digest_hex(version_event.content.as_bytes());
            let head = ProposalHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                proposal_id: version.proposal_id,
                current_version_event_id: version_event.id.to_hex(),
                current_version_digest: version_digest,
                revision: version.revision,
                source_event_id: version_event.id.to_hex(),
            };
            let expected_event_id = current.map(|stored| stored.event.id.to_bytes().to_vec());
            if let Some(event_id) = expected_event_id.as_ref() {
                expected_heads.push(ExpectedHead {
                    kind: KIND_PROPOSAL_HEAD,
                    d_tag: proposal_head_d.clone(),
                    event_id: event_id.clone(),
                });
            }
            heads.push(HeadWrite {
                event: relay_event(
                    KIND_PROPOSAL_HEAD,
                    channel_id,
                    &proposal_head_d,
                    &head,
                    state,
                )?,
                channel_id,
                d_tag: proposal_head_d,
                expected_event_id,
            });
        }
        BusinessCommand::ProposalAcceptance(acceptance) => {
            require_acceptor_channel_role(&role)?;
            if let Some(replay) = existing_proposal_conversion_replay(
                tenant,
                state,
                &auth,
                channel_id,
                &event,
                &acceptance,
            )
            .await?
            {
                ensure_client_group_discovery(tenant, state, &auth, acceptance.client_id).await?;
                return Ok(replay);
            }
            let result =
                prepare_proposal_acceptance(tenant, state, &auth, channel_id, &event, acceptance)
                    .await?;
            heads.extend(result.heads);
            appended.extend(result.appended);
            expected_heads.push(result.current_proposal_head);
            conversion_claim = Some(result.claim);
            client_channel_to_create = result.client_channel_to_create;
            client_channel_to_sync = Some(result.client_channel_id);
        }
        BusinessCommand::DeliverableVersion(version) => {
            let current = current_work_item(
                state,
                tenant.community(),
                channel_id,
                version.client_id,
                version.work_item_id,
            )
            .await?;
            let (head_event, mut head) = current;
            authorize_work_assignee_or_admin(&role, &auth, &head)?;
            let pointer = validate_deliverable_version(&version, &event, &head)?;
            let current_pointer = head
                .deliverables
                .iter_mut()
                .find(|current| current.deliverable_id == version.deliverable_id);
            match current_pointer {
                Some(current) => {
                    let previous_event = load_version_event(
                        state,
                        tenant.community(),
                        &current.version_event_id,
                        KIND_DELIVERABLE_VERSION,
                    )
                    .await?;
                    let previous: DeliverableVersion = parse_content(&previous_event.event)?;
                    if previous.version.checked_add(1) != Some(version.version)
                        || version.previous_version_event_id.as_deref()
                            != Some(current.version_event_id.as_str())
                    {
                        return Err(conflict("deliverable version changed since it was loaded"));
                    }
                    *current = pointer;
                }
                None if version.version == 1 && version.previous_version_event_id.is_none() => {
                    head.deliverables.push(pointer);
                    head.deliverables.sort_by_key(|item| item.deliverable_id);
                }
                None => return Err(conflict("deliverable prior version is missing")),
            }
            head.source_event_id = event.id.to_hex();
            let d_tag = client_d_tag(version.client_id, "work", version.work_item_id);
            let expected_id = head_event.event.id.to_bytes().to_vec();
            heads.push(HeadWrite {
                event: relay_event(KIND_WORK_ITEM_HEAD, channel_id, &d_tag, &head, state)?,
                channel_id,
                d_tag,
                expected_event_id: Some(expected_id),
            });
        }
        BusinessCommand::DeliverableApproval(approval) => {
            let (head_event, head) = current_work_item(
                state,
                tenant.community(),
                channel_id,
                approval.client_id,
                approval.work_item_id,
            )
            .await?;
            if !head
                .approver_pubkeys
                .iter()
                .any(|pubkey| pubkey == &auth.pubkey().to_hex())
            {
                return Err(forbidden("actor is not an approver for this work item"));
            }
            let current = head
                .deliverables
                .iter()
                .find(|pointer| pointer.deliverable_id == approval.deliverable_id);
            if !approval_matches_current_version(&approval, current) {
                return Err(conflict(
                    "approval must target the current deliverable version",
                ));
            }
            let version_event = load_version_event(
                state,
                tenant.community(),
                &approval.version_event_id,
                KIND_DELIVERABLE_VERSION,
            )
            .await?;
            let version: DeliverableVersion = parse_content(&version_event.event)?;
            if version.client_id != approval.client_id
                || version.work_item_id != approval.work_item_id
                || version.deliverable_id != approval.deliverable_id
                || version.content_digest != approval.content_digest
            {
                return Err(conflict(
                    "approval does not match the stored deliverable version",
                ));
            }
            validate_hex_reference(&approval.media_digest)
                .map_err(|error| invalid(error.to_string()))?;
            expected_heads.push(ExpectedHead {
                kind: KIND_WORK_ITEM_HEAD,
                d_tag: client_d_tag(approval.client_id, "work", approval.work_item_id),
                event_id: head_event.event.id.to_bytes().to_vec(),
            });
        }
    }

    let result = persist(
        tenant,
        state,
        PersistBatch {
            command: event,
            channel_id,
            heads,
            appended,
            expected_heads,
            conversion_claim,
            client_channel_to_create,
        },
    )
    .await?;
    if let Some(client_channel_id) = client_channel_to_sync {
        ensure_client_group_discovery(tenant, state, &auth, client_channel_id).await?;
    }
    Ok(result)
}

struct AcceptancePlan {
    heads: Vec<HeadWrite>,
    appended: Vec<(Event, Uuid)>,
    current_proposal_head: ExpectedHead,
    claim: ConversionClaim,
    client_channel_id: Uuid,
    client_channel_to_create: Option<ClientChannelProvision>,
}

async fn existing_proposal_conversion_replay(
    tenant: &TenantContext,
    state: &AppState,
    auth: &IngestAuth,
    business_channel_id: Uuid,
    acceptance_event: &Event,
    acceptance: &ProposalAcceptance,
) -> Result<Option<IngestResult>, IngestError> {
    validate_acceptance_ids(acceptance)?;
    let version_event_id = decode_hash(&acceptance.proposal_version_event_id)?;
    let version_digest = decode_hash(&acceptance.proposal_version_digest)?;
    let accepted_by_pubkey = auth.pubkey().to_bytes();
    let existing = state
        .db
        .find_proposal_conversion_claim(
            tenant.community(),
            business_channel_id,
            acceptance.conversion_id,
            acceptance.proposal_id,
            &version_event_id,
            &version_digest,
            &accepted_by_pubkey,
            acceptance.client_id,
            acceptance.work_item_id,
            acceptance.draft_invoice_id,
        )
        .await
        .map_err(|error| match error {
            DbError::InvalidData(_) => {
                conflict("proposal conversion id was already claimed with different values")
            }
            other => internal(other),
        })?;
    Ok(existing.map(|claim| IngestResult {
        event_id: acceptance_event.id.to_hex(),
        accepted: true,
        message: format!(
            "duplicate: conversion already claimed; receipt={}",
            hex::encode(claim.receipt_event_id)
        ),
    }))
}

async fn prepare_proposal_acceptance(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    auth: &IngestAuth,
    business_channel_id: Uuid,
    acceptance_event: &Event,
    acceptance: ProposalAcceptance,
) -> Result<AcceptancePlan, IngestError> {
    validate_acceptance_ids(&acceptance)?;
    let version_id = decode_hash(&acceptance.proposal_version_event_id)?;
    let stored_version = state
        .db
        .get_event_by_id_for_event_write(tenant.community(), &version_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| conflict("proposal version does not exist"))?;
    if stored_version.event.kind.as_u16() as u32 != KIND_PROPOSAL_VERSION {
        return Err(conflict("referenced event is not a proposal version"));
    }
    let version: ProposalVersion = parse_content(&stored_version.event)?;
    if version.proposal_id != acceptance.proposal_id
        || digest_hex(stored_version.event.content.as_bytes()) != acceptance.proposal_version_digest
    {
        return Err(conflict("proposal version id or digest does not match"));
    }
    if version
        .expires_at
        .is_some_and(|expires| expires <= chrono::Utc::now().timestamp())
    {
        return Err(conflict("proposal version has expired"));
    }
    if version.named_acceptor_pubkey != auth.pubkey().to_hex() {
        return Err(forbidden(
            "only the named proposal acceptor can sign acceptance",
        ));
    }
    let proposal_head_d = business_d_tag(
        *tenant.community().as_uuid(),
        "proposal",
        acceptance.proposal_id,
    );
    let proposal_head = current_head::<ProposalHead>(
        state,
        tenant.community(),
        KIND_PROPOSAL_HEAD,
        &proposal_head_d,
    )
    .await?
    .ok_or_else(|| conflict("proposal has no current version"))?;
    let current_proposal: ProposalHead = parse_content(&proposal_head.event)?;
    if proposal_head.channel_id != Some(business_channel_id)
        || current_proposal.current_version_event_id != acceptance.proposal_version_event_id
        || current_proposal.current_version_digest != acceptance.proposal_version_digest
    {
        return Err(conflict(
            "acceptance must target the current proposal version",
        ));
    }
    let version_d = proposal_version_d_tag(
        *tenant.community().as_uuid(),
        acceptance.proposal_id,
        version.revision,
    );
    if buzz_db::event::extract_d_tag(&stored_version.event).as_deref() != Some(version_d.as_str())
        || stored_version.channel_id != Some(business_channel_id)
    {
        return Err(conflict(
            "proposal version is outside the active business channel",
        ));
    }

    let party_d = business_d_tag(
        *tenant.community().as_uuid(),
        "party",
        version.prospect_party_id,
    );
    let party_stored =
        current_head::<PartyHead>(state, tenant.community(), KIND_PARTY_HEAD, &party_d)
            .await?
            .ok_or_else(|| conflict("proposal prospect party does not exist"))?;
    let party: PartyHead = parse_content(&party_stored.event)?;
    if party.party_id != version.prospect_party_id
        || party.status == "archived"
        || party_stored.channel_id != Some(business_channel_id)
    {
        return Err(conflict(
            "proposal prospect party is archived or outside the business channel",
        ));
    }

    let client_channel_to_create = match state
        .db
        .get_channel_for_event_write(tenant.community(), acceptance.client_id)
        .await
    {
        Ok(channel) => {
            if channel.visibility != "private"
                || channel.channel_type != "stream"
                || channel.archived_at.is_some()
            {
                return Err(forbidden(
                    "business records require a private stream client channel",
                ));
            }
            let acceptor_role = state
                .db
                .get_member_role(tenant.community(), channel.id, &auth.pubkey().to_bytes())
                .await
                .map_err(internal)?
                .ok_or_else(|| forbidden("named acceptor is not a member of the client channel"))?;
            require_acceptor_channel_role(&acceptor_role)?;
            None
        }
        Err(DbError::ChannelNotFound(_)) => {
            let name = buzz_core::channel::canonical_channel_name(&party.party.display_name);
            if name.is_empty() {
                return Err(invalid("client channel name is required"));
            }
            Some(ClientChannelProvision {
                channel_id: acceptance.client_id,
                name: name.to_owned(),
            })
        }
        Err(error) => return Err(internal(error)),
    };

    let client_d = client_d_tag(acceptance.client_id, "client", acceptance.client_id);
    let work_d = client_d_tag(acceptance.client_id, "work", acceptance.work_item_id);
    let invoice_d = client_d_tag(acceptance.client_id, "invoice", acceptance.draft_invoice_id);

    let named_acceptor = auth.pubkey().to_hex();
    let client_head = ClientHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: acceptance.client_id,
        party_id: party.party_id,
        display_name: party.party.display_name.clone(),
        approver_pubkeys: vec![named_acceptor.clone()],
        status: "active".into(),
        source_action_event_id: acceptance_event.id.to_hex(),
    };
    let work_item = WorkItemHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: acceptance.client_id,
        work_item_id: acceptance.work_item_id,
        title: format!("Proposal {}", acceptance.proposal_id),
        status: "open".into(),
        assigned_pubkeys: Vec::new(),
        approver_pubkeys: vec![named_acceptor],
        deliverables: Vec::new(),
        source_event_id: acceptance_event.id.to_hex(),
    };
    let total_minor = version.lines.iter().try_fold(0_i64, |total, line| {
        let line_total = i64::from(line.quantity_hundredths)
            .checked_mul(line.unit_amount_minor)?
            .checked_div(100)?;
        total.checked_add(line_total)
    });
    let total_minor = total_minor.ok_or_else(|| invalid("proposal total overflows minor units"))?;
    let invoice = DraftInvoiceHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: acceptance.client_id,
        invoice_id: acceptance.draft_invoice_id,
        proposal_id: acceptance.proposal_id,
        proposal_version_event_id: acceptance.proposal_version_event_id.clone(),
        currency: version.currency.clone(),
        lines: version.lines.clone(),
        total_minor,
        status: "draft".into(),
        source_event_id: acceptance_event.id.to_hex(),
    };
    let receipt_content = buzz_core::business_records::ProposalConversionReceipt {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        conversion_id: acceptance.conversion_id,
        proposal_id: acceptance.proposal_id,
        proposal_version_event_id: acceptance.proposal_version_event_id.clone(),
        client_id: acceptance.client_id,
        work_item_id: acceptance.work_item_id,
        draft_invoice_id: acceptance.draft_invoice_id,
        acceptance_event_id: acceptance_event.id.to_hex(),
    };
    let receipt_d = business_d_tag(
        *tenant.community().as_uuid(),
        "conversion",
        acceptance.conversion_id,
    );
    let receipt = relay_event(
        KIND_PROPOSAL_CONVERSION_RECEIPT,
        business_channel_id,
        &receipt_d,
        &receipt_content,
        state,
    )?;
    let claim = ConversionClaim {
        conversion_id: acceptance.conversion_id,
        proposal_id: acceptance.proposal_id,
        business_channel_id,
        version_event_id: version_id,
        version_digest: decode_hash(&acceptance.proposal_version_digest)?,
        acceptance_event_id: acceptance_event.id.to_bytes().to_vec(),
        receipt_event_id: receipt.id.to_bytes().to_vec(),
        accepted_by_pubkey: auth.pubkey().to_bytes().to_vec(),
        client_id: acceptance.client_id,
        work_item_id: acceptance.work_item_id,
        draft_invoice_id: acceptance.draft_invoice_id,
    };
    let expected_proposal_head = ExpectedHead {
        kind: KIND_PROPOSAL_HEAD,
        d_tag: proposal_head_d,
        event_id: proposal_head.event.id.to_bytes().to_vec(),
    };
    Ok(AcceptancePlan {
        heads: vec![
            HeadWrite {
                event: relay_event(
                    KIND_CLIENT_HEAD,
                    acceptance.client_id,
                    &client_d,
                    &client_head,
                    state,
                )?,
                channel_id: acceptance.client_id,
                d_tag: client_d,
                expected_event_id: None,
            },
            HeadWrite {
                event: relay_event(
                    KIND_WORK_ITEM_HEAD,
                    acceptance.client_id,
                    &work_d,
                    &work_item,
                    state,
                )?,
                channel_id: acceptance.client_id,
                d_tag: work_d,
                expected_event_id: None,
            },
            HeadWrite {
                event: relay_event(
                    KIND_INVOICE_HEAD,
                    acceptance.client_id,
                    &invoice_d,
                    &invoice,
                    state,
                )?,
                channel_id: acceptance.client_id,
                d_tag: invoice_d,
                expected_event_id: None,
            },
        ],
        appended: vec![(receipt, business_channel_id)],
        current_proposal_head: expected_proposal_head,
        claim,
        client_channel_id: acceptance.client_id,
        client_channel_to_create,
    })
}

fn validate_acceptance_ids(acceptance: &ProposalAcceptance) -> Result<(), IngestError> {
    if acceptance.proposal_id.is_nil()
        || acceptance.conversion_id.is_nil()
        || acceptance.client_id.is_nil()
        || acceptance.work_item_id.is_nil()
        || acceptance.draft_invoice_id.is_nil()
    {
        return Err(invalid("proposal acceptance identifiers must not be nil"));
    }
    validate_hex_reference(&acceptance.proposal_version_event_id)
        .map_err(|error| invalid(error.to_string()))?;
    validate_hex_reference(&acceptance.proposal_version_digest)
        .map_err(|error| invalid(error.to_string()))?;
    Ok(())
}

async fn persist(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    batch: PersistBatch,
) -> Result<IngestResult, IngestError> {
    let PersistBatch {
        command,
        channel_id,
        heads,
        appended,
        expected_heads,
        conversion_claim,
        client_channel_to_create,
    } = batch;
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, tenant.community())
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;

    for expected in expected_heads {
        let actual = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
            &mut tx,
            tenant.community(),
            expected.kind,
            &state.relay_keypair.public_key().to_bytes(),
            &expected.d_tag,
        )
        .await
        .map_err(internal)?;
        if actual.as_deref() != Some(expected.event_id.as_slice()) {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                "business record changed before the command committed",
            ));
        }
    }

    if let Some(claim) = conversion_claim {
        let result = buzz_db::business_records::claim_proposal_conversion(
            &mut tx,
            tenant.community(),
            claim.business_channel_id,
            claim.conversion_id,
            claim.proposal_id,
            &claim.version_event_id,
            &claim.version_digest,
            &claim.acceptance_event_id,
            &claim.receipt_event_id,
            &claim.accepted_by_pubkey,
            claim.client_id,
            claim.work_item_id,
            claim.draft_invoice_id,
        )
        .await
        .map_err(|error| match error {
            DbError::InvalidData(_) => {
                conflict("proposal conversion identifiers were claimed with different values")
            }
            other => internal(other),
        })?;
        if result.disposition == buzz_db::business_records::ConversionClaimDisposition::Existing {
            tx.rollback().await.map_err(internal)?;
            return Ok(IngestResult {
                event_id: command.id.to_hex(),
                accepted: true,
                message: format!(
                    "duplicate: conversion already claimed; receipt={}",
                    hex::encode(result.receipt_event_id)
                ),
            });
        }
    }

    if let Some(client_channel) = client_channel_to_create {
        let created = buzz_db::channel::create_client_channel_in_transaction(
            &mut tx,
            tenant.community(),
            client_channel.channel_id,
            &client_channel.name,
            &command.pubkey.to_bytes(),
        )
        .await
        .map_err(internal)?;
        if !created {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                "client channel was created concurrently; retry proposal acceptance",
            ));
        }
    }

    let (stored_command, inserted) = buzz_db::event::insert_event_in_transaction(
        &mut tx,
        tenant.community(),
        &command,
        Some(channel_id),
    )
    .await
    .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(IngestResult {
            event_id: command.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    let actor_hex = command.pubkey.to_hex();
    let mut stored_events = vec![(stored_command, actor_hex)];
    for (appended_event, appended_channel_id) in appended {
        let (stored, was_inserted) = buzz_db::event::insert_event_in_transaction(
            &mut tx,
            tenant.community(),
            &appended_event,
            Some(appended_channel_id),
        )
        .await
        .map_err(internal)?;
        if was_inserted {
            stored_events.push((stored, appended_event.pubkey.to_hex()));
        }
    }

    for head in heads {
        let precondition = head.expected_event_id.as_deref().map_or(
            ParameterizedReplacePrecondition::CreateOnly,
            ParameterizedReplacePrecondition::ExpectedRevision,
        );
        let replaced = state
            .db
            .replace_parameterized_event_in_transaction(
                &mut tx,
                tenant.community(),
                &head.event,
                &head.d_tag,
                Some(head.channel_id),
                precondition,
            )
            .await
            .map_err(internal)?;
        match replaced.status {
            ParameterizedReplaceStatus::Inserted => {
                stored_events.push((replaced.event, head.event.pubkey.to_hex()));
            }
            ParameterizedReplaceStatus::Duplicate => {}
            ParameterizedReplaceStatus::RevisionMismatch
            | ParameterizedReplaceStatus::RevisionMissing
            | ParameterizedReplaceStatus::Superseded
            | ParameterizedReplaceStatus::ReplayOnlyMiss => {
                tx.rollback().await.map_err(internal)?;
                return Err(conflict(
                    "business record changed before the command committed",
                ));
            }
        }
    }
    tx.commit().await.map_err(internal)?;

    for (stored, actor) in stored_events {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored,
            stored.event.kind.as_u16() as u32,
            &actor,
            None,
        )
        .await;
    }

    Ok(IngestResult {
        event_id: command.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

async fn ensure_client_group_discovery(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    auth: &IngestAuth,
    client_channel_id: Uuid,
) -> Result<(), IngestError> {
    let channel = get_private_stream_channel(state, tenant.community(), client_channel_id).await?;
    let actor = auth.pubkey().to_bytes();
    let role = state
        .db
        .get_member_role(tenant.community(), client_channel_id, &actor)
        .await
        .map_err(internal)?
        .ok_or_else(|| forbidden("named acceptor is not a member of the client channel"))?;
    require_acceptor_channel_role(&role)?;
    state.invalidate_membership(tenant, client_channel_id, &actor);
    crate::handlers::side_effects::emit_group_discovery_events(tenant, state, channel.id)
        .await
        .map_err(internal)
}

async fn get_private_stream_channel(
    state: &AppState,
    community_id: CommunityId,
    channel_id: Uuid,
) -> Result<buzz_db::channel::ChannelRecord, IngestError> {
    let channel = match state
        .db
        .get_channel_for_event_write(community_id, channel_id)
        .await
    {
        Ok(channel) => channel,
        Err(DbError::ChannelNotFound(_)) => return Err(invalid("business channel does not exist")),
        Err(error) => return Err(internal(error)),
    };
    if channel.visibility != "private"
        || channel.channel_type != "stream"
        || channel.archived_at.is_some()
    {
        return Err(forbidden(
            "business records require a private stream channel",
        ));
    }
    Ok(channel)
}

fn command_coordinates(event: &Event) -> Result<(Uuid, String), IngestError> {
    let h_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .collect::<Vec<_>>();
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if h_tags.len() != 1 || d_tags.len() != 1 {
        return Err(invalid(
            "business command requires exactly one h tag and one d tag",
        ));
    }
    let h_parts = h_tags[0].as_slice();
    let d_parts = d_tags[0].as_slice();
    if h_parts.len() != 2 || d_parts.len() != 2 {
        return Err(invalid(
            "business h and d tags must each have exactly two values",
        ));
    }
    let channel_id = Uuid::parse_str(h_parts[1].as_str())
        .map_err(|_| invalid("business h tag must contain a channel UUID"))?;
    Ok((channel_id, d_parts[1].to_string()))
}

async fn current_head<T: DeserializeOwned>(
    state: &AppState,
    community_id: CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![kind as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_string());
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(IngestError::Internal(
            "error: duplicate business head coordinate".into(),
        ));
    }
    let event = rows.pop();
    if let Some(event) = event.as_ref() {
        let _: T = parse_content(&event.event)?;
    }
    Ok(event)
}

async fn current_work_item(
    state: &AppState,
    community_id: CommunityId,
    channel_id: Uuid,
    client_id: Uuid,
    work_item_id: Uuid,
) -> Result<(StoredEvent, WorkItemHead), IngestError> {
    let d_tag = client_d_tag(client_id, "work", work_item_id);
    let event = current_head::<WorkItemHead>(state, community_id, KIND_WORK_ITEM_HEAD, &d_tag)
        .await?
        .ok_or_else(|| conflict("work item does not exist"))?;
    if event.channel_id != Some(channel_id) {
        return Err(conflict("work item is outside the client channel"));
    }
    let head: WorkItemHead = parse_content(&event.event)?;
    if head.client_id != client_id || head.work_item_id != work_item_id {
        return Err(conflict(
            "work-item head coordinate does not match its content",
        ));
    }
    Ok((event, head))
}

async fn load_version_event(
    state: &AppState,
    community_id: CommunityId,
    event_id_hex: &str,
    expected_kind: u32,
) -> Result<StoredEvent, IngestError> {
    validate_hex_reference(event_id_hex).map_err(|error| invalid(error.to_string()))?;
    let event_id = decode_hash(event_id_hex)?;
    let stored = state
        .db
        .get_event_by_id_for_event_write(community_id, &event_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| conflict("referenced version event does not exist"))?;
    if stored.event.kind.as_u16() as u32 != expected_kind {
        return Err(conflict("referenced event has the wrong kind"));
    }
    Ok(stored)
}

fn relay_event<T: Serialize>(
    kind: u32,
    channel_id: Uuid,
    d_tag: &str,
    content: &T,
    state: &AppState,
) -> Result<Event, IngestError> {
    let content = serde_json::to_string(content).map_err(internal)?;
    let h_tag = Tag::parse(["h", channel_id.to_string().as_str()])
        .map_err(|error| internal(format!("business h tag: {error}")))?;
    let d_tag =
        Tag::parse(["d", d_tag]).map_err(|error| internal(format!("business d tag: {error}")))?;
    EventBuilder::new(Kind::Custom(kind as u16), content)
        .tags([h_tag, d_tag])
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn parse_content<T: DeserializeOwned>(event: &Event) -> Result<T, IngestError> {
    serde_json::from_str(&event.content).map_err(|_| {
        IngestError::Internal("error: stored business record content is invalid".into())
    })
}

fn validate_party(action: &PartyAction) -> Result<(), IngestError> {
    if action.party_id.is_nil()
        || action.party.party_id.is_nil()
        || action.party.party_type != "person" && action.party.party_type != "organization"
    {
        return Err(invalid("partyType must be person or organization"));
    }
    if action.party.display_name.trim().is_empty() {
        return Err(invalid("party displayName is required"));
    }
    Ok(())
}

fn validate_client_action(channel_id: Uuid, action: &ClientAction) -> Result<(), IngestError> {
    if action.head.schema_version != BUSINESS_RECORD_SCHEMA_VERSION
        || action.client_id.is_nil()
        || action.head.party_id.is_nil()
        || action.client_id != channel_id
        || action.head.client_id != channel_id
        || action.head.status.trim().is_empty()
        || action.head.display_name.trim().is_empty()
    {
        return Err(invalid(
            "client action content does not match its client channel",
        ));
    }
    for pubkey in &action.head.approver_pubkeys {
        parse_pubkey_hex(pubkey)?;
    }
    Ok(())
}

fn validate_work_item_action(role: &str, action: &WorkItemAction) -> Result<(), IngestError> {
    if action.head.schema_version != BUSINESS_RECORD_SCHEMA_VERSION
        || action.client_id.is_nil()
        || action.work_item_id.is_nil()
        || action.head.client_id != action.client_id
        || action.head.work_item_id != action.work_item_id
        || action.head.title.trim().is_empty()
        || action.head.status.trim().is_empty()
    {
        return Err(invalid(
            "work-item action content does not match its coordinate",
        ));
    }
    if role == "guest" || role == "bot" {
        return Err(forbidden("guest or bot roles cannot mutate work items"));
    }
    for pubkey in action
        .head
        .assigned_pubkeys
        .iter()
        .chain(action.head.approver_pubkeys.iter())
    {
        parse_pubkey_hex(pubkey)?;
    }
    for pointer in &action.head.deliverables {
        validate_hex_reference(&pointer.version_event_id)
            .map_err(|error| invalid(error.to_string()))?;
        validate_hex_reference(&pointer.content_digest)
            .map_err(|error| invalid(error.to_string()))?;
        validate_hex_reference(&pointer.media_digest)
            .map_err(|error| invalid(error.to_string()))?;
        validate_hex_reference(&pointer.version_digest)
            .map_err(|error| invalid(error.to_string()))?;
    }
    Ok(())
}

fn validate_proposal_version(version: &ProposalVersion) -> Result<(), IngestError> {
    if version.proposal_id.is_nil()
        || version.prospect_party_id.is_nil()
        || version.revision == 0
        || version.lines.is_empty()
        || version.currency.len() != 3
        || !version
            .currency
            .bytes()
            .all(|byte| byte.is_ascii_uppercase())
        || version.terms.trim().is_empty()
    {
        return Err(invalid(
            "proposal version requires revision, currency, lines, and terms",
        ));
    }
    parse_pubkey_hex(&version.named_acceptor_pubkey)?;
    validate_optional_event_id(version.previous_version_event_id.as_deref())?;
    for line in &version.lines {
        if line.description.trim().is_empty()
            || line.quantity_hundredths == 0
            || line.unit_amount_minor < 0
        {
            return Err(invalid(
                "proposal lines require positive quantity and non-negative amount",
            ));
        }
    }
    let _ = version
        .lines
        .iter()
        .try_fold(0_i64, |total, line| {
            let line_total = i64::from(line.quantity_hundredths)
                .checked_mul(line.unit_amount_minor)?
                .checked_div(100)?;
            total.checked_add(line_total)
        })
        .ok_or_else(|| invalid("proposal total overflows minor units"))?;
    Ok(())
}

fn validate_deliverable_version(
    version: &DeliverableVersion,
    event: &Event,
    work_item: &WorkItemHead,
) -> Result<DeliverablePointer, IngestError> {
    if version.schema_version != BUSINESS_RECORD_SCHEMA_VERSION
        || version.client_id.is_nil()
        || version.work_item_id.is_nil()
        || version.deliverable_id.is_nil()
        || version.client_id != work_item.client_id
        || version.work_item_id != work_item.work_item_id
        || version.version == 0
    {
        return Err(invalid("deliverable version does not match its work item"));
    }
    validate_optional_event_id(version.previous_version_event_id.as_deref())?;
    validate_hex_reference(&version.content_digest).map_err(|error| invalid(error.to_string()))?;
    if version
        .media_digests
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
    {
        return Err(invalid("media digests must be unique and sorted"));
    }
    for digest in &version.media_digests {
        validate_hex_reference(digest).map_err(|error| invalid(error.to_string()))?;
    }
    let body_digest = digest_hex(&serde_json::to_vec(&version.body).map_err(internal)?);
    if body_digest != version.content_digest {
        return Err(invalid("contentDigest does not match the canonical body"));
    }
    let media_digest = digest_hex(&serde_json::to_vec(&version.media_digests).map_err(internal)?);
    let mut version_digest_bytes = decode_hash(&version.content_digest)?;
    version_digest_bytes.extend_from_slice(&decode_hash(&media_digest)?);
    let version_digest = digest_hex(&version_digest_bytes);
    Ok(DeliverablePointer {
        deliverable_id: version.deliverable_id,
        version_event_id: event.id.to_hex(),
        content_digest: version.content_digest.clone(),
        media_digest,
        version_digest,
    })
}

fn authorize_work_assignee_or_admin(
    role: &str,
    auth: &IngestAuth,
    work_item: &WorkItemHead,
) -> Result<(), IngestError> {
    let assigned = work_item
        .assigned_pubkeys
        .iter()
        .any(|pubkey| pubkey == &auth.pubkey().to_hex());
    if !assigned && !is_admin(role) {
        return Err(forbidden("actor is not assigned to this work item"));
    }
    Ok(())
}

fn check_expected(
    action: RecordAction,
    expected: Option<&str>,
    current: Option<&StoredEvent>,
) -> Result<(), IngestError> {
    match (action, expected, current) {
        (RecordAction::Create, None, None) => Ok(()),
        (RecordAction::Create, _, _) => {
            Err(conflict("record already exists or create has a prior head"))
        }
        (
            RecordAction::Update | RecordAction::Archive | RecordAction::Restore,
            Some(expected),
            Some(current),
        ) if expected == current.event.id.to_hex() => Ok(()),
        (RecordAction::Update | RecordAction::Archive | RecordAction::Restore, _, _) => {
            Err(conflict("expected head does not match the current record"))
        }
    }
}

fn resolve_lifecycle_status(
    action: RecordAction,
    current_status: Option<&str>,
    requested_status: Option<&str>,
    restored_status: &str,
) -> Result<String, IngestError> {
    match (action, current_status) {
        (RecordAction::Create, None) if requested_status == Some("archived") => {
            Err(invalid("create cannot start in archived state"))
        }
        (RecordAction::Create, None) => Ok(requested_status.unwrap_or(restored_status).to_owned()),
        (RecordAction::Create, Some(_)) => Err(conflict("record already exists")),
        (RecordAction::Update, Some("archived")) => {
            Err(conflict("archived records must be restored before update"))
        }
        (RecordAction::Update, Some(_)) if requested_status == Some("archived") => {
            Err(invalid("use the archive action to archive a record"))
        }
        (RecordAction::Update, Some(status)) => Ok(requested_status.unwrap_or(status).to_owned()),
        (RecordAction::Update, None) => Err(conflict("record does not exist")),
        (RecordAction::Archive, Some("archived")) => Err(conflict("record is already archived")),
        (RecordAction::Archive, Some(_)) => Ok("archived".to_owned()),
        (RecordAction::Archive, None) => Err(conflict("record does not exist")),
        (RecordAction::Restore, Some("archived")) => Ok(restored_status.to_owned()),
        (RecordAction::Restore, Some(_)) => Err(conflict("record is not archived")),
        (RecordAction::Restore, None) => Err(conflict("record does not exist")),
    }
}

fn validate_optional_event_id(value: Option<&str>) -> Result<(), IngestError> {
    if let Some(value) = value {
        validate_hex_reference(value).map_err(|error| invalid(error.to_string()))?;
    }
    Ok(())
}

fn parse_pubkey_hex(value: &str) -> Result<nostr::PublicKey, IngestError> {
    validate_hex_reference(value).map_err(|_| invalid("pubkey must be 32 lowercase hex bytes"))?;
    nostr::PublicKey::from_hex(value).map_err(|_| invalid("pubkey must be 32 lowercase hex bytes"))
}

fn decode_hash(value: &str) -> Result<Vec<u8>, IngestError> {
    validate_hex_reference(value).map_err(|error| invalid(error.to_string()))?;
    hex::decode(value).map_err(|_| invalid("event id or digest must be lowercase hex"))
}

fn digest_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn is_admin(role: &str) -> bool {
    role == "owner" || role == "admin"
}

fn require_admin(role: &str) -> Result<(), IngestError> {
    if is_admin(role) {
        Ok(())
    } else {
        Err(forbidden("owner or admin role is required"))
    }
}

fn require_member_or_admin(role: &str) -> Result<(), IngestError> {
    if matches!(role, "owner" | "admin" | "member") {
        Ok(())
    } else {
        Err(forbidden("member, admin, or owner role is required"))
    }
}

fn require_acceptor_channel_role(role: &str) -> Result<(), IngestError> {
    if matches!(role, "owner" | "admin" | "member" | "guest") {
        Ok(())
    } else {
        Err(forbidden(
            "a named acceptor with private-channel membership is required",
        ))
    }
}

fn conflict(message: &str) -> IngestError {
    IngestError::Rejected(format!("conflict: {message}"))
}

fn forbidden(message: &str) -> IngestError {
    IngestError::AuthFailed(format!("forbidden: {message}"))
}

fn invalid(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("invalid: {}", message.into()))
}

fn internal(error: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_with_tags(tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(KIND_CLIENT_ACTION as u16), "{}")
            .tags(tags)
            .sign_with_keys(&nostr::Keys::generate())
            .expect("signed command")
    }

    #[test]
    fn command_coordinates_accept_one_exact_h_and_d_tag() {
        let channel_id = Uuid::from_u128(1);
        let d_tag = client_d_tag(channel_id, "client", channel_id);
        let event = event_with_tags(vec![
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag"),
            Tag::parse(["d", d_tag.as_str()]).expect("d tag"),
        ]);

        assert_eq!(
            command_coordinates(&event).expect("coordinates"),
            (channel_id, d_tag)
        );
    }

    #[test]
    fn command_coordinates_reject_missing_or_duplicate_scope_tags() {
        let channel_id = Uuid::from_u128(1);
        let h = Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag");
        let d = Tag::parse(["d", "client:1:client:1"]).expect("d tag");
        let missing_h = event_with_tags(vec![d.clone()]);
        let duplicate_h = event_with_tags(vec![h.clone(), h, d]);

        assert!(matches!(
            command_coordinates(&missing_h),
            Err(IngestError::Rejected(message)) if message.contains("exactly one h tag")
        ));
        assert!(matches!(
            command_coordinates(&duplicate_h),
            Err(IngestError::Rejected(message)) if message.contains("exactly one h tag")
        ));
    }

    #[test]
    fn command_coordinates_rejects_extended_tag_shapes() {
        let channel_id = Uuid::from_u128(1);
        let event = event_with_tags(vec![
            Tag::parse(["h", channel_id.to_string().as_str(), "extra"]).expect("h tag"),
            Tag::parse(["d", "client:1:client:1"]).expect("d tag"),
        ]);

        assert!(matches!(
            command_coordinates(&event),
            Err(IngestError::Rejected(message)) if message.contains("exactly two values")
        ));
    }

    #[test]
    fn lifecycle_actions_archive_and_restore_canonical_status() {
        assert!(
            resolve_lifecycle_status(RecordAction::Create, None, Some("archived"), "active")
                .is_err()
        );
        assert!(resolve_lifecycle_status(
            RecordAction::Update,
            Some("active"),
            Some("archived"),
            "active"
        )
        .is_err());
        assert_eq!(
            resolve_lifecycle_status(RecordAction::Archive, Some("active"), None, "active")
                .expect("archive"),
            "archived"
        );
        assert_eq!(
            resolve_lifecycle_status(RecordAction::Restore, Some("archived"), None, "open")
                .expect("restore"),
            "open"
        );
        assert!(resolve_lifecycle_status(
            RecordAction::Update,
            Some("archived"),
            Some("active"),
            "active"
        )
        .is_err());
        assert!(
            resolve_lifecycle_status(RecordAction::Restore, Some("active"), None, "active")
                .is_err()
        );
    }
}
