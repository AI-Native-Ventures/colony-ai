//! Outreach desk read model: the stage, label and business facts the contact and thread views
//! add. The rules live in [`buzz_core::whatsapp_stage`]; this module gathers their inputs.
//!
//! Cost: a fixed number of queries whatever the number of contacts (desk facts, prospect heads,
//! customer heads, co-founder settings), never one per contact and never a full customer
//! gather.

use std::collections::{BTreeMap, HashMap};
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
use buzz_db::whatsapp::{DeskFacts, WhatsappContact, WhatsappContactCursor};
use buzz_db::EventQuery;

use super::policy::{contact_label, failure_summary_for_code, is_contact_engagement_limit};
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
        queued: facts.queued_at.map(Fact::at),
    }
}

fn rfc3339(at: Option<DateTime<Utc>>) -> Value {
    at.map_or(Value::Null, |at| json!(at.to_rfc3339()))
}

/// The additive fields of the contact and thread views.
///
/// `stage`, `stageSetBy` (`auto` or the hex pubkey), `stageChangedAt`, `lastContactedAt`,
/// `lastReplyAt`, `queuedFrom`, `label`, `profileName`, `lastOutboundState`, and, when the
/// contact is linked to a lead, `businessName` and `website`. `displayName` becomes the label
/// when one is set.
pub fn desk_fields(
    contact: &WhatsappContact,
    facts: &DeskFacts,
    lead: Option<&LeadFacts>,
    record: Option<&RecordFacts>,
) -> Map<String, Value> {
    desk_fields_for_capability(contact, facts, lead, record, false)
}

/// The same desk projection for a desktop that explicitly understands the `queued` stage.
/// The legacy default deliberately writes `none` for queued work: desktop-v3.0.37 validates
/// this enum strictly and would reject the entire contact response if it saw `queued`.
///
/// This match is intentionally exhaustive. Adding a stage in `buzz-core` makes the compiler
/// require a deliberate legacy projection instead of accidentally leaking a new enum value to
/// an installed desktop that cannot parse it.
const fn legacy_stage_wire_value(stage: WhatsappStage) -> &'static str {
    match stage {
        WhatsappStage::None | WhatsappStage::Queued => "none",
        WhatsappStage::Contacted => "contacted",
        WhatsappStage::Replied => "replied",
        WhatsappStage::WantsCall => "wants_call",
        WhatsappStage::CallBooked => "call_booked",
        WhatsappStage::QuoteSent => "quote_sent",
        WhatsappStage::Client => "client",
        WhatsappStage::NoThanks => "no_thanks",
        WhatsappStage::Stopped => "stopped",
        WhatsappStage::NotOnWhatsapp => "not_on_whatsapp",
    }
}

/// The `stage` string a caller sees: the real stage for a caller that advertised `queued`
/// support, the legacy-safe projection otherwise. The list and the counts both go through
/// here, so a count always equals what a full list would show.
fn project_stage(stage: WhatsappStage, supports_queued_stage: bool) -> &'static str {
    if supports_queued_stage {
        stage.as_str()
    } else {
        legacy_stage_wire_value(stage)
    }
}

impl DeskData {
    /// The facts, linked lead and record of `contact`, as the list view looks them up.
    fn parts_of<'a>(
        &'a self,
        contact: &WhatsappContact,
        default_facts: &'a DeskFacts,
    ) -> (
        &'a DeskFacts,
        Option<&'a LeadFacts>,
        Option<&'a RecordFacts>,
    ) {
        let lead_id = contact.lead_id.as_deref();
        (
            self.facts.get(&contact.wa_id).unwrap_or(default_facts),
            lead_id.and_then(|id| self.leads.get(id)),
            lead_id.and_then(|id| self.records.get(id)),
        )
    }
}

/// Build the desk projection for a caller that has explicitly advertised whether it can parse
/// the `queued` stage. New wire fields remain additive; only the existing `stage` enum is
/// projected for compatibility.
pub fn desk_fields_for_capability(
    contact: &WhatsappContact,
    facts: &DeskFacts,
    lead: Option<&LeadFacts>,
    record: Option<&RecordFacts>,
    supports_queued_stage: bool,
) -> Map<String, Value> {
    let result = derive_stage(&stage_inputs(contact, facts, lead, record));
    let wire_stage = project_stage(result.stage, supports_queued_stage);
    let profile = contact.display_name.trim();
    let has_profile = profile.chars().any(char::is_alphanumeric);
    let mut fields = Map::new();
    fields.insert("stage".into(), json!(wire_stage));
    fields.insert("stageSetBy".into(), json!(result.set_by.as_wire()));
    fields.insert("stageChangedAt".into(), rfc3339(result.changed_at));
    fields.insert("lastContactedAt".into(), rfc3339(facts.last_contacted_at));
    fields.insert("lastReplyAt".into(), rfc3339(contact.last_inbound_at));
    fields.insert(
        "queuedFrom".into(),
        if wire_stage == "queued" {
            json!(facts.queued_from)
        } else {
            Value::Null
        },
    );
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
    let last_failure_summary = (facts.last_outcome_state.as_deref() == Some("failed"))
        .then(|| failure_summary_for_code(facts.last_outcome_code.as_deref()))
        .flatten();
    fields.insert("lastFailureSummary".into(), json!(last_failure_summary));
    let engagement_limited = facts.last_outcome_state.as_deref() == Some("failed")
        && is_contact_engagement_limit(facts.last_outcome_code.as_deref());
    fields.insert(
        "deliveryFailure".into(),
        if engagement_limited {
            json!({
                "code": facts.last_outcome_code,
                "summary": last_failure_summary,
                "retryAfter": contact.retry_after.map(|at| at.to_rfc3339()),
                "canRetryLater": contact.retry_after.is_none(),
            })
        } else {
            Value::Null
        },
    );
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

/// Contacts read per round trip while counting stages.
const COUNT_CHUNK: u64 = 1_000;
/// Most contacts one count covers. A community with more is counted up to this many and the
/// answer says so (`countsTruncated`), so the work and the memory of one request stay bounded.
pub const COUNT_CONTACT_CAP: u64 = 50_000;

/// Contacts per stage, over a whole community.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StageCounts {
    /// Contacts per stage string. A stage with no contacts is absent.
    pub by_stage: BTreeMap<String, u64>,
    /// Contacts whose stage is `none` and whose latest outbound message failed.
    pub failed_not_contacted: u64,
    /// Contacts counted.
    pub total: u64,
    /// More contacts exist than the cap allowed to count, so every number is a floor.
    pub truncated: bool,
}

impl StageCounts {
    /// Count one contact by its `stage` string and the state of its latest outbound message.
    pub fn add(&mut self, stage: &str, last_outcome_state: Option<&str>) {
        *self.by_stage.entry(stage.to_owned()).or_insert(0) += 1;
        if stage == "none" && last_outcome_state == Some("failed") {
            self.failed_not_contacted += 1;
        }
        self.total += 1;
    }

    /// The fields the `contacts` answer carries when counts were asked for.
    pub fn fields(&self) -> Map<String, Value> {
        let mut fields = Map::new();
        fields.insert("stageCounts".into(), json!(self.by_stage));
        fields.insert(
            "failedNotContacted".into(),
            json!(self.failed_not_contacted),
        );
        fields.insert("totalContacts".into(), json!(self.total));
        fields.insert("countsTruncated".into(), json!(self.truncated));
        fields
    }
}

/// Count every contact of the community by the stage the list view shows for it.
///
/// Contacts are read in keyset chunks and each chunk goes through [`load`] and the same stage
/// projection as the list, so no second stage rule exists. Stops at [`COUNT_CONTACT_CAP`]
/// contacts and sets `truncated`. Any failure fails the whole count: partial numbers are never
/// returned as if complete.
pub async fn stage_counts(
    state: &Arc<AppState>,
    community: CommunityId,
    supports_queued_stage: bool,
) -> Result<StageCounts, String> {
    stage_counts_bounded(
        state,
        community,
        supports_queued_stage,
        COUNT_CONTACT_CAP,
        COUNT_CHUNK,
    )
    .await
}

/// [`stage_counts`] with its bounds as arguments, so a test can cross a chunk edge and the cap
/// without thousands of contacts. `chunk` is at most 1,000.
pub(crate) async fn stage_counts_bounded(
    state: &Arc<AppState>,
    community: CommunityId,
    supports_queued_stage: bool,
    cap: u64,
    chunk: u64,
) -> Result<StageCounts, String> {
    let chunk = chunk.clamp(1, COUNT_CHUNK);
    let mut counts = StageCounts::default();
    let mut cursor: Option<WhatsappContactCursor> = None;
    let default_facts = DeskFacts::default();
    // Each pass adds at least one contact, so the loop ends within `cap` passes.
    while counts.total < cap {
        let want = (cap - counts.total).min(chunk);
        let mut page = state
            .db
            .whatsapp_list_contacts_page(community, want as i64 + 1, cursor.as_ref())
            .await
            .map_err(|error| format!("whatsapp query: {error}"))?;
        let more = page.len() as u64 > want;
        page.truncate(want as usize);
        if page.is_empty() {
            return Ok(counts);
        }
        let data = load(state, community, &page).await?;
        for contact in &page {
            let (facts, lead, record) = data.parts_of(contact, &default_facts);
            let stage = project_stage(
                derive_stage(&stage_inputs(contact, facts, lead, record)).stage,
                supports_queued_stage,
            );
            counts.add(stage, facts.last_outcome_state.as_deref());
        }
        if !more {
            return Ok(counts);
        }
        cursor = page.last().map(WhatsappContact::cursor);
    }
    // The cap is reached and the last chunk reported another row after it.
    counts.truncated = true;
    Ok(counts)
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
            retry_after: None,
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
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
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
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
        assert_eq!(fields["displayName"], "Plane Tree Hotel");
        assert_eq!(fields["profileName"], "Thabo");
        facts.label = None;
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
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
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
        assert_eq!(fields["stageSetBy"], "ab".repeat(32));
        assert_eq!(fields["stageChangedAt"], t(4).to_rfc3339());
    }

    #[test]
    fn queued_stage_reports_its_batch_source_until_an_outbound_send_exists() {
        let mut facts = DeskFacts {
            queued_at: Some(t(2)),
            queued_from: Some("Batch: Melville guesthouses".into()),
            ..Default::default()
        };
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
        assert_eq!(fields["stage"], "queued");
        assert_eq!(fields["queuedFrom"], "Batch: Melville guesthouses");

        facts.last_contacted_at = Some(t(3));
        let fields = desk_fields_for_capability(&contact(), &facts, None, None, true);
        assert_eq!(fields["stage"], "contacted");
        assert_eq!(fields["queuedFrom"], Value::Null);
    }

    #[test]
    fn legacy_projection_never_emits_the_new_queued_stage() {
        // GUARD: desktop-v3.0.37 throws for an unfamiliar `contact.stage`. The default
        // projection is therefore the safe legacy form until a client advertises support.
        let facts = DeskFacts {
            queued_at: Some(t(2)),
            queued_from: Some("Batch: legacy-safe".into()),
            ..Default::default()
        };
        assert_eq!(desk_fields(&contact(), &facts, None, None)["stage"], "none");
    }

    #[test]
    fn stage_counts_tally_every_stage_and_failed_openers_that_never_reached() {
        let mut counts = StageCounts::default();
        counts.add("contacted", Some("delivered"));
        counts.add("contacted", None);
        counts.add("replied", None);
        counts.add("none", Some("failed"));
        counts.add("none", Some("failed"));
        counts.add("none", None);
        // A failed latest send only counts while the stage is `none`.
        counts.add("not_on_whatsapp", Some("failed"));
        assert_eq!(counts.total, 7);
        assert_eq!(counts.failed_not_contacted, 2);
        assert!(!counts.truncated);
        assert_eq!(counts.by_stage["contacted"], 2);
        assert_eq!(counts.by_stage["none"], 3);
        assert_eq!(counts.by_stage["replied"], 1);
        assert_eq!(counts.by_stage["not_on_whatsapp"], 1);
        assert_eq!(counts.by_stage.values().sum::<u64>(), counts.total);

        counts.truncated = true;
        let fields = counts.fields();
        assert_eq!(fields["stageCounts"]["contacted"], 2);
        assert_eq!(fields["failedNotContacted"], 2);
        assert_eq!(fields["totalContacts"], 7);
        assert_eq!(fields["countsTruncated"], true);
    }

    #[test]
    fn the_count_projection_is_the_list_projection() {
        // A queued contact reads `none` to a legacy caller and `queued` to a current one, in
        // the list and in the counts alike.
        assert_eq!(project_stage(WhatsappStage::Queued, false), "none");
        assert_eq!(project_stage(WhatsappStage::Queued, true), "queued");
        let facts = DeskFacts {
            queued_at: Some(t(2)),
            ..Default::default()
        };
        for supports in [false, true] {
            let listed = desk_fields_for_capability(&contact(), &facts, None, None, supports);
            let counted = project_stage(
                derive_stage(&stage_inputs(&contact(), &facts, None, None)).stage,
                supports,
            );
            assert_eq!(listed["stage"], counted);
        }
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
