//! Outreach desk read model: the stage, label and business facts the contact and thread views
//! add. The rules live in [`buzz_core::whatsapp_stage`]; this module gathers their inputs.
//!
//! Cost: a fixed number of queries whatever the number of contacts (desk facts, prospect heads,
//! customer heads, co-founder settings), never one per contact and never a full customer
//! gather.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use buzz_core::business_records::{prospect_d_tag, ProspectHead, ProspectStage};
use buzz_core::company_customers::{
    customer_d_tag, CustomerRecordHead, CustomerStage, TimelineEntry, TimelineKind,
};
use buzz_core::kind::{KIND_CUSTOMER_HEAD, KIND_PROSPECT_HEAD};
use buzz_core::tenant::CommunityId;
use buzz_core::whatsapp_stage::{
    derive_stage, is_not_on_whatsapp_code, Fact, ManualStage, OptOutKind, StageInputs,
    WhatsappStage,
};
use buzz_db::whatsapp::{DeskFacts, WhatsappContact};
use buzz_db::EventQuery;

use super::policy::contact_label;
use crate::state::AppState;

/// What a linked Discovery lead says about a contact.
#[derive(Clone, Debug)]
pub struct LeadFacts {
    /// Business name.
    pub business_name: String,
    /// Website, when known.
    pub website: Option<String>,
    /// Pipeline stage of the lead.
    pub stage: ProspectStage,
    /// When the lead head was written.
    pub at: DateTime<Utc>,
    /// Party id the customer record is keyed by.
    pub party_id: Uuid,
}

/// What a stored customer record says, as stage facts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecordFacts {
    /// The record is a client.
    pub client: Option<Fact>,
    /// A quote was drafted or accepted.
    pub quote_sent: Option<Fact>,
    /// A call was booked.
    pub call_booked: Option<Fact>,
}

/// Everything gathered for a set of contacts.
#[derive(Default)]
pub struct DeskData {
    /// Per contact desk facts.
    pub facts: HashMap<String, DeskFacts>,
    /// Linked leads by lead id.
    pub leads: HashMap<String, LeadFacts>,
    /// Customer record facts by lead id.
    pub records: HashMap<String, RecordFacts>,
}

fn from_secs(secs: i64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(secs, 0)
}

/// Stage facts of a stored customer record.
pub fn record_facts(head: &CustomerRecordHead) -> RecordFacts {
    facts_from_timeline(
        head.stage == CustomerStage::Client,
        head.conversion.as_ref().map(|conversion| conversion.at),
        head.updated_at,
        &head.timeline,
    )
}

/// The same facts from the parts of a record: whether it is a client, when it converted, when it
/// was last written, and its timeline.
pub fn facts_from_timeline(
    is_client: bool,
    converted_at: Option<i64>,
    updated_at: i64,
    timeline: &[TimelineEntry],
) -> RecordFacts {
    let latest = |kinds: &[TimelineKind]| {
        timeline
            .iter()
            .filter(|entry| kinds.contains(&entry.kind))
            .map(|entry| entry.at)
            .max()
            .and_then(from_secs)
            .map(Fact::at)
    };
    let client = is_client.then(|| {
        latest(&[TimelineKind::Converted])
            .or_else(|| converted_at.and_then(from_secs).map(Fact::at))
            .unwrap_or(Fact {
                at: from_secs(updated_at),
            })
    });
    RecordFacts {
        client,
        quote_sent: latest(&[TimelineKind::QuoteDrafted, TimelineKind::QuoteAccepted]),
        call_booked: latest(&[TimelineKind::CallBooked]),
    }
}

async fn relay_heads(
    state: &Arc<AppState>,
    community: CommunityId,
    kind: u32,
    d_tags: Vec<String>,
) -> Result<Vec<buzz_core::StoredEvent>, String> {
    if d_tags.is_empty() {
        return Ok(Vec::new());
    }
    let max = (d_tags.len() as i64).saturating_mul(2).max(2);
    let mut query = EventQuery::for_community(community);
    query.kinds = Some(vec![kind as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tags = Some(d_tags);
    query.global_only = true;
    query.limit = Some(max);
    query.max_limit = Some(max);
    state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(|error| format!("could not read the business records: {error}"))
}

fn d_tag_of(stored: &buzz_core::StoredEvent) -> Option<String> {
    stored
        .event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content())
        .map(str::to_owned)
}

/// Gather the desk inputs for `contacts`.
pub async fn load(
    state: &Arc<AppState>,
    community: CommunityId,
    contacts: &[WhatsappContact],
) -> Result<DeskData, String> {
    let ids: Vec<String> = contacts.iter().map(|c| c.wa_id.clone()).collect();
    let facts = state
        .db
        .whatsapp_desk_facts(community, &ids)
        .await
        .map_err(|error| format!("whatsapp query: {error}"))?;

    // Linked leads, one query for all of them.
    let mut lead_ids: Vec<(String, Uuid)> = contacts
        .iter()
        .filter_map(|c| c.lead_id.as_deref())
        .filter_map(|id| Uuid::parse_str(id).ok().map(|uuid| (id.to_owned(), uuid)))
        .collect();
    lead_ids.sort();
    lead_ids.dedup();
    let by_d_tag: HashMap<String, String> = lead_ids
        .iter()
        .map(|(raw, uuid)| (prospect_d_tag(*community.as_uuid(), *uuid), raw.clone()))
        .collect();
    let mut leads = HashMap::new();
    for stored in relay_heads(
        state,
        community,
        KIND_PROSPECT_HEAD,
        by_d_tag.keys().cloned().collect(),
    )
    .await?
    {
        let (Some(d_tag), Ok(head)) = (
            d_tag_of(&stored),
            serde_json::from_str::<ProspectHead>(&stored.event.content),
        ) else {
            continue;
        };
        let Some(raw) = by_d_tag.get(&d_tag) else {
            continue;
        };
        if head.status == "archived" {
            continue;
        }
        let at = from_secs(stored.event.created_at.as_secs() as i64).unwrap_or_else(Utc::now);
        leads.insert(
            raw.clone(),
            LeadFacts {
                business_name: head.prospect.party.display_name.clone(),
                website: head
                    .prospect
                    .website
                    .clone()
                    .filter(|w| !w.trim().is_empty()),
                stage: head.prospect.stage,
                at,
                party_id: head.prospect.party.party_id,
            },
        );
    }

    // Customer records, only while co-founder mode is on.
    let mut records = HashMap::new();
    if !leads.is_empty() {
        let enabled = crate::handlers::company_initiative::cofounder_settings(state, community)
            .await
            .map_err(|error| format!("could not read the co-founder settings: {error:?}"))?
            .enabled;
        if enabled {
            let by_record: HashMap<String, String> = leads
                .iter()
                .filter_map(|(raw, lead)| {
                    customer_d_tag(&lead.party_id.hyphenated().to_string())
                        .ok()
                        .map(|d_tag| (d_tag, raw.clone()))
                })
                .collect();
            for stored in relay_heads(
                state,
                community,
                KIND_CUSTOMER_HEAD,
                by_record.keys().cloned().collect(),
            )
            .await?
            {
                let (Some(d_tag), Ok(head)) = (
                    d_tag_of(&stored),
                    serde_json::from_str::<CustomerRecordHead>(&stored.event.content),
                ) else {
                    continue;
                };
                if let Some(raw) = by_record.get(&d_tag) {
                    records.insert(raw.clone(), record_facts(&head));
                }
            }
        }
    }
    Ok(DeskData {
        facts,
        leads,
        records,
    })
}

/// The stage inputs of one contact.
pub fn stage_inputs(
    contact: &WhatsappContact,
    facts: &DeskFacts,
    lead: Option<&LeadFacts>,
    record: Option<&RecordFacts>,
) -> StageInputs {
    let record = record.copied().unwrap_or_default();
    let lead_fact = lead.map(|lead| Fact::at(lead.at));
    let won = lead
        .is_some_and(|lead| lead.stage == ProspectStage::Won)
        .then_some(lead_fact)
        .flatten();
    let lost = lead
        .is_some_and(|lead| lead.stage == ProspectStage::Lost)
        .then_some(lead_fact)
        .flatten();
    let manual = facts
        .manual_stage
        .as_deref()
        .and_then(WhatsappStage::parse_manual)
        .zip(facts.manual_stage_by.as_ref())
        .zip(facts.manual_stage_at)
        .map(|((stage, by), at)| ManualStage {
            stage,
            set_by: hex::encode(by),
            at,
        });
    StageInputs {
        opt_out: contact.opted_out_at.map(|at| {
            (
                OptOutKind::from_reason(contact.opt_out_reason.as_deref()),
                at,
            )
        }),
        not_on_whatsapp: (facts.last_outcome_state.as_deref() == Some("failed")
            && facts
                .last_outcome_code
                .as_deref()
                .is_some_and(is_not_on_whatsapp_code))
        .then_some(Fact {
            at: facts.last_outcome_at,
        }),
        manual,
        client: record.client.or(won),
        quote_sent: record.quote_sent,
        call_booked: record.call_booked,
        lost,
        wants_call: facts.wants_call_at.map(Fact::at),
        replied: contact.last_inbound_at.map(Fact::at),
        contacted: facts.last_contacted_at.map(Fact::at),
    }
}

fn rfc3339(at: Option<DateTime<Utc>>) -> Value {
    at.map_or(Value::Null, |at| json!(at.to_rfc3339()))
}

/// The additive fields of the contact and thread views.
///
/// `stage`, `stageSetBy` (`auto` or the hex pubkey), `stageChangedAt`, `lastContactedAt`,
/// `lastReplyAt`, `label`, `profileName`, `lastOutboundState`, and, when the contact is linked
/// to a lead, `businessName` and `website`. `displayName` becomes the label when one is set.
pub fn desk_fields(
    contact: &WhatsappContact,
    facts: &DeskFacts,
    lead: Option<&LeadFacts>,
    record: Option<&RecordFacts>,
) -> Map<String, Value> {
    let result = derive_stage(&stage_inputs(contact, facts, lead, record));
    let profile = contact.display_name.trim();
    let has_profile = profile.chars().any(char::is_alphanumeric);
    let mut fields = Map::new();
    fields.insert("stage".into(), json!(result.stage.as_str()));
    fields.insert("stageSetBy".into(), json!(result.set_by.as_wire()));
    fields.insert("stageChangedAt".into(), rfc3339(result.changed_at));
    fields.insert("lastContactedAt".into(), rfc3339(facts.last_contacted_at));
    fields.insert("lastReplyAt".into(), rfc3339(contact.last_inbound_at));
    fields.insert("label".into(), json!(facts.label));
    fields.insert(
        "profileName".into(),
        if has_profile {
            json!(profile)
        } else {
            Value::Null
        },
    );
    fields.insert("lastOutboundState".into(), json!(facts.last_outcome_state));
    if let Some(lead) = lead {
        fields.insert("businessName".into(), json!(lead.business_name));
        fields.insert("website".into(), json!(lead.website));
    }
    if let Some(label) = facts.label.as_deref().filter(|l| !l.trim().is_empty()) {
        fields.insert("displayName".into(), json!(label));
    } else {
        fields.insert(
            "displayName".into(),
            json!(contact_label(&contact.display_name, &contact.wa_id)),
        );
    }
    fields
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::whatsapp_stage::StageSetBy;
    use chrono::TimeZone;

    fn t(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 9, 0, 0)
            .single()
            .expect("time")
    }

    fn contact() -> WhatsappContact {
        WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: "Thabo".into(),
            lead_id: None,
            owner_pubkey: None,
            thread_root_event_id: None,
            last_inbound_at: None,
            last_outbound_at: None,
            outbound_since_inbound: 0,
            opted_out_at: None,
            opt_out_reason: None,
            paused_at: None,
            pause_reason: None,
            created_at: t(1),
        }
    }

    #[test]
    fn a_failed_latest_send_with_the_meta_code_is_not_on_whatsapp() {
        let mut facts = DeskFacts {
            last_contacted_at: Some(t(2)),
            last_outcome_state: Some("failed".into()),
            last_outcome_code: Some("131026".into()),
            last_outcome_at: Some(t(3)),
            ..Default::default()
        };
        let fields = desk_fields(&contact(), &facts, None, None);
        assert_eq!(fields["stage"], "not_on_whatsapp");
        // Another failure code, or a later success, is not.
        facts.last_outcome_code = Some("131049".into());
        assert_eq!(
            desk_fields(&contact(), &facts, None, None)["stage"],
            "contacted"
        );
        facts.last_outcome_code = Some("131026".into());
        facts.last_outcome_state = Some("delivered".into());
        assert_eq!(
            desk_fields(&contact(), &facts, None, None)["stage"],
            "contacted"
        );
    }

    #[test]
    fn label_replaces_the_display_name_and_clearing_it_falls_back() {
        let mut facts = DeskFacts {
            label: Some("Plane Tree Hotel".into()),
            ..Default::default()
        };
        let fields = desk_fields(&contact(), &facts, None, None);
        assert_eq!(fields["displayName"], "Plane Tree Hotel");
        assert_eq!(fields["profileName"], "Thabo");
        facts.label = None;
        let fields = desk_fields(&contact(), &facts, None, None);
        assert_eq!(fields["displayName"], "Thabo");
        let mut dot = contact();
        dot.display_name = ".".into();
        let fields = desk_fields(&dot, &facts, None, None);
        assert_eq!(fields["displayName"], "+27821234567");
        assert_eq!(fields["profileName"], Value::Null);
    }

    #[test]
    fn linked_lead_adds_business_fields_and_won_reads_as_client() {
        let lead = LeadFacts {
            business_name: "Plane Tree Hotel".into(),
            website: Some("https://planetree.example".into()),
            stage: ProspectStage::Won,
            at: t(5),
            party_id: Uuid::new_v4(),
        };
        let fields = desk_fields(&contact(), &DeskFacts::default(), Some(&lead), None);
        assert_eq!(fields["businessName"], "Plane Tree Hotel");
        assert_eq!(fields["website"], "https://planetree.example");
        assert_eq!(fields["stage"], "client");
        let lost = LeadFacts {
            stage: ProspectStage::Lost,
            ..lead
        };
        let fields = desk_fields(&contact(), &DeskFacts::default(), Some(&lost), None);
        assert_eq!(fields["stage"], "no_thanks");
        let unlinked = desk_fields(&contact(), &DeskFacts::default(), None, None);
        assert!(unlinked.get("businessName").is_none());
    }

    #[test]
    fn manual_stage_is_reported_with_who_set_it() {
        let facts = DeskFacts {
            manual_stage: Some("call_booked".into()),
            manual_stage_by: Some(vec![0xab; 32]),
            manual_stage_at: Some(t(4)),
            ..Default::default()
        };
        let inputs = stage_inputs(&contact(), &facts, None, None);
        let result = derive_stage(&inputs);
        assert_eq!(result.stage, WhatsappStage::CallBooked);
        assert_eq!(result.set_by, StageSetBy::Manual("ab".repeat(32)));
        let fields = desk_fields(&contact(), &facts, None, None);
        assert_eq!(fields["stageSetBy"], "ab".repeat(32));
        assert_eq!(fields["stageChangedAt"], t(4).to_rfc3339());
    }

    #[test]
    fn a_stored_customer_record_reads_as_stage_facts() {
        use buzz_core::company_customers::SourceRef;
        let entry = |kind, at| TimelineEntry {
            entry_id: format!("e:{at}"),
            kind,
            title: "x".into(),
            detail: None,
            at,
            actor_pubkey: None,
            source: SourceRef {
                kind: "prospect".into(),
                id: "x".into(),
            },
        };
        let timeline = vec![
            entry(TimelineKind::CallBooked, 1_790_000_100),
            entry(TimelineKind::QuoteDrafted, 1_790_000_200),
            entry(TimelineKind::QuoteAccepted, 1_790_000_300),
        ];
        let facts = facts_from_timeline(false, None, 1_790_000_999, &timeline);
        let secs = |fact: Option<Fact>| fact.and_then(|f| f.at).map(|at| at.timestamp());
        assert_eq!(secs(facts.call_booked), Some(1_790_000_100));
        assert_eq!(secs(facts.quote_sent), Some(1_790_000_300));
        assert_eq!(facts.client, None);
        let client = facts_from_timeline(true, Some(1_790_000_400), 1_790_000_999, &timeline);
        assert_eq!(secs(client.client), Some(1_790_000_400));
        let no_conversion = facts_from_timeline(true, None, 1_790_000_999, &[]);
        assert_eq!(secs(no_conversion.client), Some(1_790_000_999));
    }
}
