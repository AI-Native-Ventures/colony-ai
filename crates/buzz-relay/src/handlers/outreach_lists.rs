//! Outreach lists (kind 47075, head 30684) and shared Discovery campaigns (kind 47076, head
//! 30685) for the business broker.
//!
//! These are small records next to leads: same private business channel, same `h` and `d` tag
//! rules, same replay protection and atomic head write (all inherited from
//! `business_records::handle`, which calls the planners below and persists what they return).
//! Every field rule and state transition lives in `buzz_core::outreach_lists`; this file only
//! resolves who the caller is, reads the current head, checks that added leads really exist and
//! signs the next head. Contract: `docs/outreach-lists-contract.md`.

use std::collections::HashSet;
use std::sync::Arc;

use nostr::Event;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use buzz_core::business_records::prospect_d_tag;
use buzz_core::kind::{KIND_DISCOVERY_CAMPAIGN_HEAD, KIND_OUTREACH_LIST_HEAD, KIND_PROSPECT_HEAD};
use buzz_core::outreach_lists::{
    apply_campaign_action, apply_list_action, list_leads_to_verify, validate_campaign_action,
    validate_list_action, DiscoveryCampaignAction, DiscoveryCampaignHead, ListActor, OutreachError,
    OutreachListAction, OutreachListHead,
};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::EventQuery;

use super::business_records::{
    conflict, current_head, forbidden, internal, invalid, relay_head_event,
};
use super::ingest::IngestError;
use crate::state::AppState;

/// Most lead coordinates checked in one query.
const LEAD_CHECK_CHUNK: usize = 100;

/// The relay-signed head a planner wants written, with the head it replaces.
pub(super) struct PlannedHead {
    pub(super) event: Event,
    pub(super) d_tag: String,
    pub(super) expected_event_id: Option<Vec<u8>>,
}

/// Roles that may change outreach lists and campaigns: everyone with Sales access, agents
/// included. Guests and non-members may not.
pub(super) fn require_outreach_actor(role: &str) -> Result<(), IngestError> {
    if matches!(role, "owner" | "admin" | "member" | "bot") {
        Ok(())
    } else {
        Err(forbidden(
            "Sales access is required to change outreach lists and campaigns",
        ))
    }
}

fn map_error(error: OutreachError) -> IngestError {
    match error {
        OutreachError::Invalid(message) => invalid(message),
        OutreachError::Conflict(message) => conflict(&message),
        OutreachError::Forbidden(message) => forbidden(&message),
    }
}

fn parse_head<T: DeserializeOwned>(stored: &StoredEvent) -> Result<T, IngestError> {
    serde_json::from_str(&stored.event.content)
        .map_err(|_| IngestError::Internal("error: stored outreach record is invalid".into()))
}

fn check_expected_head(
    expected: Option<&str>,
    current: Option<&StoredEvent>,
) -> Result<(), IngestError> {
    match (expected, current) {
        (None, _) => Ok(()),
        (Some(expected), Some(current)) if expected == current.event.id.to_hex() => Ok(()),
        (Some(_), _) => Err(conflict("expected head does not match the current record")),
    }
}

fn d_tag_value(event: &Event) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let parts = tag.as_slice();
        if parts.len() == 2 && parts[0] == "d" {
            Some(parts[1].clone())
        } else {
            None
        }
    })
}

/// Fail unless every id is a lead (prospect head) in `channel_id`.
async fn verify_leads(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Uuid,
    lead_ids: &[Uuid],
) -> Result<(), IngestError> {
    let community_uuid = *tenant.community().as_uuid();
    for chunk in lead_ids.chunks(LEAD_CHECK_CHUNK) {
        let tags: Vec<String> = chunk
            .iter()
            .map(|lead_id| prospect_d_tag(community_uuid, *lead_id))
            .collect();
        let mut query = EventQuery::for_community(tenant.community());
        query.kinds = Some(vec![KIND_PROSPECT_HEAD as i32]);
        query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
        query.channel_id = Some(channel_id);
        query.d_tags = Some(tags.clone());
        query.limit = Some(chunk.len() as i64 + 1);
        let rows = state
            .db
            .query_events_for_event_write(&query)
            .await
            .map_err(internal)?;
        let found: HashSet<String> = rows
            .iter()
            .filter_map(|stored| d_tag_value(&stored.event))
            .collect();
        for (lead_id, tag) in chunk.iter().zip(&tags) {
            if !found.contains(tag) {
                return Err(invalid(format!("unknown lead {lead_id}")));
            }
        }
    }
    Ok(())
}

/// Plan the head write for one outreach list action.
pub(super) async fn plan_list_action(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
    role: &str,
    channel_id: Uuid,
    d_tag: String,
    action: OutreachListAction,
) -> Result<PlannedHead, IngestError> {
    require_outreach_actor(role)?;
    if action.op.people_only() && role == "bot" {
        return Err(forbidden("only people can archive or restore a list"));
    }
    validate_list_action(&action).map_err(map_error)?;
    let current = current_head::<OutreachListHead>(
        state,
        tenant.community(),
        KIND_OUTREACH_LIST_HEAD,
        &d_tag,
    )
    .await?;
    if current
        .as_ref()
        .is_some_and(|stored| stored.channel_id != Some(channel_id))
    {
        return Err(conflict("list belongs to another business channel"));
    }
    check_expected_head(action.expected_head_event_id.as_deref(), current.as_ref())?;
    let previous = current
        .as_ref()
        .map(parse_head::<OutreachListHead>)
        .transpose()?;
    let to_verify = list_leads_to_verify(previous.as_ref(), &action);
    verify_leads(state, tenant, channel_id, &to_verify).await?;
    let actor = ListActor {
        pubkey: event.pubkey.to_hex(),
        is_agent: role == "bot",
    };
    let head = apply_list_action(
        previous.as_ref(),
        &action,
        &actor,
        event.created_at.as_secs() as i64,
        &event.id.to_hex(),
    )
    .map_err(map_error)?;
    let head_event = relay_head_event(
        KIND_OUTREACH_LIST_HEAD,
        channel_id,
        &d_tag,
        &head,
        current.as_ref(),
        state,
    )?;
    Ok(PlannedHead {
        event: head_event,
        d_tag,
        expected_event_id: current.map(|stored| stored.event.id.to_bytes().to_vec()),
    })
}

/// Plan the head write for one Discovery campaign action.
pub(super) async fn plan_campaign_action(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
    role: &str,
    channel_id: Uuid,
    d_tag: String,
    action: DiscoveryCampaignAction,
) -> Result<PlannedHead, IngestError> {
    require_outreach_actor(role)?;
    validate_campaign_action(&action).map_err(map_error)?;
    let current = current_head::<DiscoveryCampaignHead>(
        state,
        tenant.community(),
        KIND_DISCOVERY_CAMPAIGN_HEAD,
        &d_tag,
    )
    .await?;
    if current
        .as_ref()
        .is_some_and(|stored| stored.channel_id != Some(channel_id))
    {
        return Err(conflict("campaign belongs to another business channel"));
    }
    check_expected_head(action.expected_head_event_id.as_deref(), current.as_ref())?;
    let previous = current
        .as_ref()
        .map(parse_head::<DiscoveryCampaignHead>)
        .transpose()?;
    let actor = ListActor {
        pubkey: event.pubkey.to_hex(),
        is_agent: role == "bot",
    };
    let head = apply_campaign_action(
        previous.as_ref(),
        &action,
        &actor,
        event.created_at.as_secs() as i64,
        &event.id.to_hex(),
    )
    .map_err(map_error)?;
    let head_event = relay_head_event(
        KIND_DISCOVERY_CAMPAIGN_HEAD,
        channel_id,
        &d_tag,
        &head,
        current.as_ref(),
        state,
    )?;
    Ok(PlannedHead {
        event: head_event,
        d_tag,
        expected_event_id: current.map(|stored| stored.event.id.to_bytes().to_vec()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sales_roles_may_change_lists_and_guests_may_not() {
        for role in ["owner", "admin", "member", "bot"] {
            assert!(require_outreach_actor(role).is_ok(), "{role}");
        }
        for role in ["guest", "", "viewer"] {
            assert!(require_outreach_actor(role).is_err(), "{role}");
        }
    }

    #[test]
    fn core_errors_map_to_the_relay_prefixes() {
        let message = |error: IngestError| match error {
            IngestError::Rejected(m) | IngestError::AuthFailed(m) => m,
            other => format!("{other:?}"),
        };
        assert!(message(map_error(OutreachError::Invalid("x".into()))).starts_with("invalid:"));
        assert!(message(map_error(OutreachError::Conflict("x".into()))).starts_with("conflict:"));
        assert!(message(map_error(OutreachError::Forbidden("x".into()))).starts_with("forbidden:"));
    }
}
