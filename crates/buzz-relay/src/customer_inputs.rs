//! Reads the records a customer record is built from.
//!
//! [`gather_facts`] loads the company's prospects, clients, proposals,
//! acceptances, payments, invoices, playbook running copies and the WhatsApp
//! tables once. [`CustomerReads::source_for`] then splits them by business and
//! `buzz_core::company_customers::compute_customer_record` turns them into the
//! record. Nothing here comes from an agent's say-so: a record states only what
//! the company's own records support.
//!
//! A WhatsApp chat belongs to a business when its contact was linked to the
//! prospect (`lead_id`), else when the contact's number is the prospect's phone.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use serde::de::DeserializeOwned;
use uuid::Uuid;

use buzz_core::business_records::{
    ClientHead, InvoiceHead, PaymentEvidence, ProposalAcceptance, ProposalVersion, ProspectAction,
    ProspectHead, RecordAction,
};
use buzz_core::company_customers::{
    CustomerFacts, CustomerSource, SourceAcceptance, SourceClient, SourcePayment,
    SourceProposalVersion, SourceProspect, SourceWhatsapp, WhatsappBatchFact, WhatsappRow,
};
use buzz_core::company_playbooks::PlaybookJobHead;
use buzz_core::kind::{
    KIND_CLIENT_HEAD, KIND_INVOICE_HEAD, KIND_PAYMENT, KIND_PLAYBOOK_HEAD,
    KIND_PROPOSAL_ACCEPTANCE, KIND_PROPOSAL_VERSION, KIND_PROSPECT_ACTION, KIND_PROSPECT_HEAD,
};
use buzz_core::tenant::CommunityId;
use buzz_core::StoredEvent;
use buzz_db::whatsapp::{WhatsappBatch, WhatsappContact, WhatsappMessage};

use crate::numbers_inputs::read_events;
use crate::state::AppState;
use crate::whatsapp::policy::normalize_wa_id;

/// Most WhatsApp rows one read returns. A company that outgrows it needs paging.
const MAX_WHATSAPP_ROWS: i64 = 200_000;
/// d-tag prefix of a playbook running copy.
const JOB_D_TAG_PREFIX: &str = "company:playbook-job:";

/// Everything one read of the company's records returned.
#[derive(Debug, Default)]
pub struct CustomerReads {
    /// The records split by kind.
    pub facts: CustomerFacts,
    /// WhatsApp contacts.
    pub contacts: Vec<WhatsappContact>,
    /// WhatsApp messages of chats.
    pub messages: Vec<WhatsappMessage>,
    /// WhatsApp batches.
    pub batches: Vec<WhatsappBatch>,
    /// Template titles by `(name, language)`.
    pub template_titles: HashMap<(String, String), String>,
}

fn d_tag_of(stored: &StoredEvent) -> Option<String> {
    stored
        .event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content())
        .map(str::to_owned)
}

/// Content of an event, kept with its id, time and signer; one that does not
/// decode is skipped, because a record this relay cannot read counts for nothing.
fn decode<T: DeserializeOwned>(events: &[StoredEvent]) -> Vec<(String, i64, String, T)> {
    events
        .iter()
        .filter_map(|stored| {
            serde_json::from_str::<T>(&stored.event.content)
                .ok()
                .map(|value| {
                    (
                        stored.event.id.to_hex(),
                        stored.event.created_at.as_secs() as i64,
                        stored.event.pubkey.to_hex(),
                        value,
                    )
                })
        })
        .collect()
}

/// Read every record a customer record is built from.
pub async fn gather_facts(
    state: &Arc<AppState>,
    community_id: CommunityId,
) -> Result<CustomerReads, String> {
    let mut reads = CustomerReads::default();

    let actions = read_events(state, community_id, KIND_PROSPECT_ACTION, false, None, None).await?;
    // The first accepted `create` of each prospect: when, and who.
    let mut created: HashMap<Uuid, (i64, String)> = HashMap::new();
    for (_, at, pubkey, action) in decode::<ProspectAction>(&actions) {
        if action.action != RecordAction::Create {
            continue;
        }
        created
            .entry(action.prospect_id)
            .and_modify(|first| {
                if at < first.0 {
                    *first = (at, pubkey.clone());
                }
            })
            .or_insert((at, pubkey));
    }
    let prospects = read_events(state, community_id, KIND_PROSPECT_HEAD, true, None, None).await?;
    for (_, head_at, _, head) in decode::<ProspectHead>(&prospects) {
        let (created_at, created_by_pubkey) = match created.get(&head.prospect_id) {
            Some((at, pubkey)) => (*at, Some(pubkey.clone())),
            None => (head_at, None),
        };
        reads.facts.prospects.push(SourceProspect {
            head,
            created_at,
            created_by_pubkey,
        });
    }

    let clients = read_events(state, community_id, KIND_CLIENT_HEAD, true, None, None).await?;
    reads.facts.clients = decode::<ClientHead>(&clients)
        .into_iter()
        .map(|(_, at, _, head)| SourceClient { head, at })
        .collect();

    let versions = read_events(
        state,
        community_id,
        KIND_PROPOSAL_VERSION,
        false,
        None,
        None,
    )
    .await?;
    reads.facts.proposals = decode::<ProposalVersion>(&versions)
        .into_iter()
        .map(
            |(event_id, at, author_pubkey, version)| SourceProposalVersion {
                event_id,
                at,
                author_pubkey,
                version,
            },
        )
        .collect();

    let acceptances = read_events(
        state,
        community_id,
        KIND_PROPOSAL_ACCEPTANCE,
        false,
        None,
        None,
    )
    .await?;
    reads.facts.acceptances = decode::<ProposalAcceptance>(&acceptances)
        .into_iter()
        .map(
            |(event_id, at, actor_pubkey, acceptance)| SourceAcceptance {
                event_id,
                at,
                actor_pubkey,
                acceptance,
            },
        )
        .collect();

    let payments = read_events(state, community_id, KIND_PAYMENT, false, None, None).await?;
    reads.facts.payments = decode::<PaymentEvidence>(&payments)
        .into_iter()
        .map(|(event_id, _, recorded_by_pubkey, payment)| SourcePayment {
            event_id,
            recorded_by_pubkey,
            payment,
        })
        .collect();

    let invoices = read_events(state, community_id, KIND_INVOICE_HEAD, true, None, None).await?;
    reads.facts.invoices = decode::<InvoiceHead>(&invoices)
        .into_iter()
        .map(|(_, _, _, head)| head)
        .collect();

    let playbooks = read_events(state, community_id, KIND_PLAYBOOK_HEAD, true, None, None).await?;
    let jobs = playbooks
        .into_iter()
        .filter(|stored| d_tag_of(stored).is_some_and(|d_tag| d_tag.starts_with(JOB_D_TAG_PREFIX)))
        .collect::<Vec<_>>();
    reads.facts.jobs = decode::<PlaybookJobHead>(&jobs)
        .into_iter()
        .map(|(_, _, _, job)| job)
        .collect();

    reads.contacts = state
        .db
        .whatsapp_contacts_bulk(community_id, MAX_WHATSAPP_ROWS)
        .await
        .map_err(|error| format!("could not read WhatsApp contacts: {error}"))?;
    reads.messages = state
        .db
        .whatsapp_messages_bulk(community_id, MAX_WHATSAPP_ROWS)
        .await
        .map_err(|error| format!("could not read WhatsApp messages: {error}"))?;
    reads.batches = state
        .db
        .whatsapp_batches_bulk(community_id, MAX_WHATSAPP_ROWS)
        .await
        .map_err(|error| format!("could not read WhatsApp batches: {error}"))?;
    let templates = state
        .db
        .whatsapp_list_templates(community_id)
        .await
        .map_err(|error| format!("could not read WhatsApp templates: {error}"))?;
    reads.template_titles = templates
        .into_iter()
        .map(|template| ((template.name, template.language), template.title))
        .collect();
    Ok(reads)
}

fn whatsapp_row(
    message: &WhatsappMessage,
    batches: &BTreeMap<Uuid, &WhatsappBatch>,
    titles: &HashMap<(String, String), String>,
) -> WhatsappRow {
    let outbound = message.direction == "out";
    let at = if outbound {
        message.sent_at.unwrap_or(message.created_at)
    } else {
        message.created_at
    };
    let template_title = match (&message.template_name, &message.template_language) {
        (Some(name), Some(language)) => titles
            .get(&(name.clone(), language.clone()))
            .filter(|title| !title.trim().is_empty())
            .cloned(),
        _ => None,
    };
    let batch = message
        .batch_id
        .and_then(|id| batches.get(&id).map(|batch| (id, *batch)))
        .map(|(id, batch)| WhatsappBatchFact {
            id: id.hyphenated().to_string(),
            approved: matches!(batch.status.as_str(), "approved" | "completed"),
            decided_at: batch.decided_at.map(|at| at.timestamp()),
            decided_by_pubkey: batch.decided_by.as_ref().map(hex::encode),
        });
    WhatsappRow {
        id: message.id.hyphenated().to_string(),
        outbound,
        state: message.state.clone(),
        body: message.body.clone(),
        template_name: message.template_name.clone(),
        template_title,
        new_chat: message.new_chat,
        at: at.timestamp(),
        sender_pubkey: message.sender_pubkey.as_ref().map(hex::encode),
        batch,
    }
}

impl CustomerReads {
    /// Every party that has a customer record, in id order.
    pub fn party_ids(&self) -> Vec<String> {
        self.facts.party_ids()
    }

    /// What the records say about one business, with its WhatsApp chat, or `None`
    /// when the party has neither a prospect nor a client record.
    pub fn source_for(&self, party_id: &str) -> Option<CustomerSource> {
        let mut source = self.facts.source_for(party_id)?;
        let prospect = source.prospect.as_ref()?;
        let lead_id = prospect.head.prospect_id.hyphenated().to_string();
        let phone_wa_id = prospect
            .head
            .prospect
            .phone
            .as_deref()
            .and_then(normalize_wa_id);
        // A contact linked to the lead wins over one that only has its number.
        let contact = self
            .contacts
            .iter()
            .find(|contact| contact.lead_id.as_deref() == Some(lead_id.as_str()))
            .or_else(|| {
                phone_wa_id
                    .as_deref()
                    .and_then(|wa_id| self.contacts.iter().find(|contact| contact.wa_id == wa_id))
            })?;
        let batches = self
            .batches
            .iter()
            .map(|batch| (batch.id, batch))
            .collect::<BTreeMap<_, _>>();
        let rows = self
            .messages
            .iter()
            .filter(|message| message.wa_id == contact.wa_id)
            .map(|message| whatsapp_row(message, &batches, &self.template_titles))
            .collect::<Vec<_>>();
        source.whatsapp = Some(SourceWhatsapp {
            wa_id: contact.wa_id.clone(),
            opted_out: contact.opted_out_at.is_some(),
            rows,
        });
        Some(source)
    }
}
