//! Qualification actions through the production business-record handler.
//!
//! These tests need the disposable PostgreSQL and Redis fixture used by the
//! relay integration lane.

use super::postgres_tests::{auth, business_stream, fixture, signed_command, Fixture};
use super::*;
use buzz_core::business_records::{
    prospect_d_tag, PartyRecord, ProspectAction, ProspectQualification, ProspectRecordInput,
    ProspectStage, RecordAction, BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_PROSPECT_ACTION, KIND_QUALIFY_OBSERVATION_ACTION, KIND_QUALIFY_OBSERVATION_HEAD,
};
use buzz_core::qualify::{
    qualify_observation_d_tag, QualifyObservation, QualifyObservationAction,
    QualifyObservationHead, QualifyObservationState, QualifySignal,
};
use nostr::Keys;
use serde_json::Value;

fn community(fixture: &Fixture) -> Uuid {
    *fixture.tenant.community().as_uuid()
}

fn lead_action(prospect_id: Uuid) -> ProspectAction {
    ProspectAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        prospect_id,
        action: RecordAction::Create,
        expected_head_event_id: None,
        prospect: ProspectRecordInput {
            prospect_id,
            party: PartyRecord {
                party_id: prospect_id,
                party_type: "organization".into(),
                display_name: "Qualification fixture".into(),
                external_ids: Vec::new(),
            },
            industry: "Professional services".into(),
            vertical: "Marketing agencies".into(),
            fit_score: None,
            origin: None,
            discovery_tags: Vec::new(),
            maps: None,
            potential_monthly_value_minor: None,
            website: Some("https://example.test".into()),
            contact_name: None,
            location: Some("Cape Town".into()),
            email: None,
            phone: None,
            whatsapp_phone: None,
            evidence: Vec::new(),
            last_verified_at: None,
            qualification: ProspectQualification::Unreviewed,
            saved: false,
            stage: ProspectStage::Qualified,
            lost_reason: None,
        },
        activity: None,
    }
}

async fn create_lead(fixture: &Fixture, owner: &Keys, channel_id: Uuid) -> Uuid {
    let lead_id = Uuid::new_v4();
    let event = signed_command(
        owner,
        KIND_PROSPECT_ACTION,
        channel_id,
        &prospect_d_tag(community(fixture), lead_id),
        &lead_action(lead_id),
    );
    let result = handle(&fixture.tenant, &fixture.state, event, auth(owner))
        .await
        .expect("create lead through production handler");
    assert!(result.accepted);
    lead_id
}

fn qualification_action(lead_id: Uuid) -> QualifyObservationAction {
    let run_id = Uuid::new_v4();
    QualifyObservationAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        lead_id,
        run_id,
        expected_head_event_id: None,
        checked_signals: vec![QualifySignal::HasWhatsappLink],
        observations: vec![QualifyObservation {
            signal: QualifySignal::HasWhatsappLink,
            state: QualifyObservationState::Observed,
            value: Some(Value::String("https://wa.me/27115550100".into())),
            confidence: 0.95,
            evidence_urls: vec!["https://example.test/contact".into()],
            observed_at: 1_762_000_000,
            run_id,
            not_checked_reason: None,
            personal_data: false,
        }],
    }
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn qualification_action_writes_a_relay_authored_head_for_an_existing_lead() {
    let fixture = fixture().await;
    let owner = Keys::generate();
    let channel_id = business_stream(&fixture, &owner).await;
    let lead_id = create_lead(&fixture, &owner, channel_id).await;
    let action = qualification_action(lead_id);
    let event = signed_command(
        &owner,
        KIND_QUALIFY_OBSERVATION_ACTION,
        channel_id,
        &qualify_observation_d_tag(community(&fixture), lead_id),
        &action,
    );

    let result = handle(&fixture.tenant, &fixture.state, event.clone(), auth(&owner))
        .await
        .expect("store qualification through production handler");
    assert!(result.accepted);

    let stored = current_head::<QualifyObservationHead>(
        &fixture.state,
        fixture.tenant.community(),
        KIND_QUALIFY_OBSERVATION_HEAD,
        &qualify_observation_d_tag(community(&fixture), lead_id),
    )
    .await
    .expect("read qualification head")
    .expect("qualification head exists");
    let head: QualifyObservationHead =
        serde_json::from_str(&stored.event.content).expect("qualification head content");
    assert_eq!(
        stored.event.kind.as_u16() as u32,
        KIND_QUALIFY_OBSERVATION_HEAD
    );
    assert_eq!(
        stored.event.pubkey,
        fixture.state.relay_keypair.public_key()
    );
    assert_eq!(stored.channel_id, Some(channel_id));
    assert_eq!(head.lead_id, lead_id);
    assert_eq!(head.checked_signals, action.checked_signals);
    assert_eq!(head.observations, action.observations);
    assert_eq!(head.source_action_event_id, event.id.to_hex());
}
