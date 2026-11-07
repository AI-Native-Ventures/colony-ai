//! Qualification observation planner for the business-record broker.
//!
//! Website fetching runs in the desktop main process. This module only checks
//! the signed observation payload, verifies the referenced prospect, and
//! atomically plans a relay-authored latest head.

use std::sync::Arc;

use nostr::Event;
use uuid::Uuid;

use buzz_core::kind::KIND_QUALIFY_OBSERVATION_HEAD;
use buzz_core::qualify::{
    qualify_observation_head_from_action, validate_qualify_observation_action,
    QualifyObservationAction, QualifyObservationHead,
};
use buzz_core::tenant::TenantContext;

use crate::state::AppState;

use super::business_records::{conflict, current_head, invalid, relay_head_event};
use super::ingest::IngestError;
use super::outreach_lists::{require_outreach_actor, verify_leads, PlannedHead};

/// Plan one qualification head write from a member's complete lead snapshot.
pub(super) async fn plan_qualify_observation_action(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
    role: &str,
    channel_id: Uuid,
    d_tag: String,
    action: QualifyObservationAction,
) -> Result<PlannedHead, IngestError> {
    require_outreach_actor(role)?;
    validate_qualify_observation_action(&action).map_err(|error| invalid(error.to_string()))?;
    verify_leads(state, tenant, channel_id, &[action.lead_id]).await?;

    let current = current_head::<QualifyObservationHead>(
        state,
        tenant.community(),
        KIND_QUALIFY_OBSERVATION_HEAD,
        &d_tag,
    )
    .await?;
    if current
        .as_ref()
        .is_some_and(|stored| stored.channel_id != Some(channel_id))
    {
        return Err(conflict(
            "qualification belongs to another business channel",
        ));
    }
    check_expected_head(action.expected_head_event_id.as_deref(), current.as_ref())?;

    let head = qualify_observation_head_from_action(
        &action,
        event.created_at.as_secs() as i64,
        event.id.to_hex(),
    )
    .map_err(|error| invalid(error.to_string()))?;
    let head_event = relay_head_event(
        KIND_QUALIFY_OBSERVATION_HEAD,
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

fn check_expected_head(
    expected: Option<&str>,
    current: Option<&buzz_core::StoredEvent>,
) -> Result<(), IngestError> {
    match (expected, current) {
        (None, None) => Ok(()),
        (None, Some(_)) => Err(conflict(
            "qualification write needs the current head event id",
        )),
        (Some(expected), Some(current)) if expected == current.event.id.to_hex() => Ok(()),
        (Some(_), _) => Err(conflict(
            "qualification expected head does not match the current record",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_qualification_may_omit_a_head_fence() {
        assert!(check_expected_head(None, None).is_ok());
    }

    #[test]
    fn an_existing_qualification_requires_a_head_fence() {
        let keys = nostr::Keys::generate();
        let event = nostr::EventBuilder::new(nostr::Kind::Custom(1), "test")
            .sign_with_keys(&keys)
            .expect("signed test event");
        let stored =
            buzz_core::StoredEvent::with_received_at(event, chrono::Utc::now(), None, true);
        assert!(check_expected_head(None, Some(&stored)).is_err());
    }
}
