//! Reads the facts a scorecard counts from the company's own records.
//!
//! [`gather_inputs`] loads timestamped records (leads, proposals, payments,
//! invoices, clients, worker runs, plans and the WhatsApp outreach tables) and
//! hands them to [`inputs_from_records`], the pure step that decides what each
//! record counts as. Nothing here comes from an agent's say-so, so a scorecard
//! or a weekly review states only what the records support.
//!
//! What a record counts as:
//! - a lead: the first accepted `create` of a prospect, at that action's time;
//! - a quote: the first version (revision 1) of a proposal;
//! - a win: the first acceptance of a proposal;
//! - cash in: a payment evidence record, at the time it says the money arrived
//!   (refunds and credit notes are not netted off);
//! - invoiced and owed: issued invoices only; drafts and voided invoices count
//!   for nothing.
//!
//! Money is stated in one currency, the one most of the company's payments and
//! invoices use; facts in another currency are left out and counted.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use buzz_core::business_records::{
    ClientHead, InvoiceHead, InvoiceStatus, PaymentEvidence, ProposalAcceptance, ProposalVersion,
    ProspectAction, RecordAction,
};
use buzz_core::company_numbers::{
    MoneyFact, NumbersInputs, WorkerFact, WorkerOutcome, WEEK_SECS,
};
use buzz_core::company_plans::{PlanApprovalScope, PlanDecision, PlanHead};
use buzz_core::company_workers::{worker_effective_status, WorkerRunHead, WorkerStatus};
use buzz_core::kind::{
    KIND_CLIENT_HEAD, KIND_INVOICE_HEAD, KIND_PAYMENT, KIND_PLAN_HEAD, KIND_PROPOSAL_ACCEPTANCE,
    KIND_PROPOSAL_VERSION, KIND_PROSPECT_ACTION, KIND_WORKER_RUN_HEAD,
};
use buzz_core::tenant::CommunityId;
use buzz_db::EventQuery;

use crate::state::AppState;

/// Most records one read returns. A company that outgrows it needs paging.
const MAX_RECORDS: i64 = 50_000;
/// Currency used when the company has no money record yet.
const DEFAULT_CURRENCY: &str = "ZAR";

/// Decoded records, before they are turned into facts.
#[derive(Debug, Default)]
pub struct RawRecords {
    /// `(prospect id, action time)` of every accepted prospect `create`.
    pub prospect_creates: Vec<(Uuid, i64)>,
    /// `(proposal id, revision, event time)` of every proposal version.
    pub proposal_versions: Vec<(Uuid, u32, i64)>,
    /// `(proposal id, event time)` of every proposal acceptance.
    pub acceptances: Vec<(Uuid, i64)>,
    /// Payment evidence records.
    pub payments: Vec<PaymentEvidence>,
    /// Current invoice heads.
    pub invoices: Vec<InvoiceHead>,
    /// Current client heads.
    pub clients: Vec<ClientHead>,
    /// Current worker run heads.
    pub worker_runs: Vec<WorkerRunHead>,
    /// Current plan heads.
    pub plans: Vec<PlanHead>,
    /// Send times of the first message of each new WhatsApp chat.
    pub chats_started: Vec<i64>,
    /// Times of each contact's first reply to outreach.
    pub first_replies: Vec<i64>,
}

/// First time per id, in ascending order of that time.
fn first_per_id(rows: impl Iterator<Item = (Uuid, i64)>) -> Vec<i64> {
    let mut first: HashMap<Uuid, i64> = HashMap::new();
    for (id, at) in rows {
        first
            .entry(id)
            .and_modify(|seen| *seen = (*seen).min(at))
            .or_insert(at);
    }
    let mut times = first.into_values().collect::<Vec<_>>();
    times.sort_unstable();
    times
}

/// The currency most of the money records use; ties go to the alphabetically
/// first code, so the answer never depends on read order.
fn dominant_currency(payments: &[PaymentEvidence], invoices: &[&InvoiceHead]) -> String {
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for payment in payments {
        *counts.entry(payment.currency.as_str()).or_default() += 1;
    }
    for invoice in invoices {
        *counts.entry(invoice.currency.as_str()).or_default() += 1;
    }
    let mut best: Option<(&str, u32)> = None;
    for (currency, count) in counts {
        if best.is_none_or(|(_, top)| count > top) {
            best = Some((currency, count));
        }
    }
    best.map_or_else(|| DEFAULT_CURRENCY.to_owned(), |(code, _)| code.to_owned())
}

fn worker_fact(head: &WorkerRunHead, now: i64) -> WorkerFact {
    let run = &head.run;
    let (outcome, ended_at) = match worker_effective_status(run, now) {
        WorkerStatus::Running => (WorkerOutcome::Running, None),
        WorkerStatus::Done => (
            WorkerOutcome::Done,
            Some(run.finished_at.unwrap_or(head.updated_at)),
        ),
        // A run still marked running past its deadline ended at its deadline.
        WorkerStatus::Failed => (
            WorkerOutcome::Failed,
            Some(run.finished_at.unwrap_or(run.deadline_at)),
        ),
        WorkerStatus::Cancelled => (
            WorkerOutcome::Cancelled,
            Some(run.finished_at.unwrap_or(head.updated_at)),
        ),
    };
    let cost_usd_cents = run
        .cost_usd
        .filter(|cost| cost.is_finite() && *cost > 0.0)
        .map_or(0, |cost| (cost * 100.0).round() as i64);
    WorkerFact {
        started_at: run.started_at,
        ended_at,
        outcome,
        cost_usd_cents,
    }
}

/// Turn decoded records into the facts a scorecard counts. `now` decides
/// whether a run still marked running has timed out.
pub fn inputs_from_records(raw: &RawRecords, now: i64) -> NumbersInputs {
    let issued = raw
        .invoices
        .iter()
        .filter(|invoice| invoice.status == InvoiceStatus::Issued)
        .collect::<Vec<_>>();
    let currency = dominant_currency(&raw.payments, &issued);

    // One payment evidence record counts once, whatever number of copies exist.
    let mut seen_payments = HashMap::new();
    for payment in &raw.payments {
        seen_payments.entry(payment.payment_id).or_insert(payment);
    }
    let mut other_currency_facts = 0_u32;
    let mut payments = Vec::new();
    for payment in seen_payments.into_values() {
        if payment.currency == currency {
            payments.push(MoneyFact {
                at: payment.occurred_at,
                amount_minor: payment.amount_minor,
            });
        } else {
            other_currency_facts += 1;
        }
    }
    payments.sort_by_key(|fact| (fact.at, fact.amount_minor));

    let mut invoices_issued = Vec::new();
    let mut owed_minor = 0_i64;
    for invoice in issued {
        if invoice.currency != currency {
            other_currency_facts += 1;
            continue;
        }
        if let Some(at) = invoice.issued_at {
            invoices_issued.push(MoneyFact {
                at,
                amount_minor: invoice.total_minor,
            });
        }
        owed_minor += invoice.outstanding_minor.max(0);
    }
    invoices_issued.sort_by_key(|fact| (fact.at, fact.amount_minor));

    let mut quote_rows = Vec::new();
    for (proposal_id, revision, at) in &raw.proposal_versions {
        if *revision == 1 {
            quote_rows.push((*proposal_id, *at));
        }
    }

    NumbersInputs {
        currency,
        leads_created: first_per_id(raw.prospect_creates.iter().copied()),
        contacts_started: sorted(&raw.chats_started),
        first_replies: sorted(&raw.first_replies),
        quotes_sent: first_per_id(quote_rows.into_iter()),
        proposals_accepted: first_per_id(raw.acceptances.iter().copied()),
        worker_runs: raw
            .worker_runs
            .iter()
            .map(|head| worker_fact(head, now))
            .collect(),
        plan_approvals: {
            let mut approvals = raw
                .plans
                .iter()
                .flat_map(|plan| plan.approvals.iter())
                .filter(|record| {
                    record.scope == PlanApprovalScope::Plan
                        && record.decision == PlanDecision::Approved
                })
                .map(|record| record.at)
                .collect::<Vec<_>>();
            approvals.sort_unstable();
            approvals
        },
        payments,
        invoices_issued,
        owed_minor,
        active_clients: raw
            .clients
            .iter()
            .filter(|client| client.status == "active")
            .count() as u32,
        other_currency_facts,
    }
}

fn sorted(times: &[i64]) -> Vec<i64> {
    let mut times = times.to_vec();
    times.sort_unstable();
    times
}

async fn read_events(
    state: &Arc<AppState>,
    community_id: CommunityId,
    kind: u32,
    relay_signed: bool,
    since: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
) -> Result<Vec<buzz_core::StoredEvent>, String> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![kind as i32]);
    if relay_signed {
        query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    }
    query.since = since;
    query.until = until;
    query.limit = Some(MAX_RECORDS);
    query.max_limit = Some(MAX_RECORDS);
    state
        .db
        .query_events_for_maintenance(&query)
        .await
        .map_err(|error| format!("could not read kind {kind}: {error}"))
}

/// Decoded content of every event of a kind; one that does not decode is
/// skipped, because a record this relay cannot read counts for nothing.
fn decode<T: serde::de::DeserializeOwned>(events: &[buzz_core::StoredEvent]) -> Vec<(i64, T)> {
    events
        .iter()
        .filter_map(|stored| {
            serde_json::from_str::<T>(&stored.event.content)
                .ok()
                .map(|value| (stored.event.created_at.as_secs() as i64, value))
        })
        .collect()
}

/// Read every record a scorecard counts and turn them into facts. Looks back
/// two windows from `as_of`; `now` only decides whether a run has timed out.
pub async fn gather_inputs(
    state: &Arc<AppState>,
    community_id: CommunityId,
    as_of: i64,
    now: i64,
) -> Result<NumbersInputs, String> {
    let since_secs = as_of - 2 * WEEK_SECS;
    let since = DateTime::from_timestamp(since_secs, 0).ok_or("scorecard window is out of range")?;
    let until = DateTime::from_timestamp(as_of, 0).ok_or("scorecard end is out of range")?;
    let mut raw = RawRecords::default();

    let prospects = read_events(
        state,
        community_id,
        KIND_PROSPECT_ACTION,
        false,
        Some(since),
        Some(until),
    )
    .await?;
    raw.prospect_creates = decode::<ProspectAction>(&prospects)
        .into_iter()
        .filter(|(_, action)| action.action == RecordAction::Create)
        .map(|(at, action)| (action.prospect_id, at))
        .collect();

    let versions = read_events(
        state,
        community_id,
        KIND_PROPOSAL_VERSION,
        false,
        Some(since),
        Some(until),
    )
    .await?;
    raw.proposal_versions = decode::<ProposalVersion>(&versions)
        .into_iter()
        .map(|(at, version)| (version.proposal_id, version.revision, at))
        .collect();

    let acceptances = read_events(
        state,
        community_id,
        KIND_PROPOSAL_ACCEPTANCE,
        false,
        Some(since),
        Some(until),
    )
    .await?;
    raw.acceptances = decode::<ProposalAcceptance>(&acceptances)
        .into_iter()
        .map(|(at, acceptance)| (acceptance.proposal_id, at))
        .collect();

    // A payment may be recorded after it arrived, so it is read by what it
    // says, not by when it was written.
    let payments = read_events(state, community_id, KIND_PAYMENT, false, None, None).await?;
    raw.payments = decode::<PaymentEvidence>(&payments)
        .into_iter()
        .map(|(_, payment)| payment)
        .collect();

    let invoices = read_events(state, community_id, KIND_INVOICE_HEAD, true, None, None).await?;
    raw.invoices = decode::<InvoiceHead>(&invoices)
        .into_iter()
        .map(|(_, invoice)| invoice)
        .collect();

    let clients = read_events(state, community_id, KIND_CLIENT_HEAD, true, None, None).await?;
    raw.clients = decode::<ClientHead>(&clients)
        .into_iter()
        .map(|(_, client)| client)
        .collect();

    let runs = read_events(state, community_id, KIND_WORKER_RUN_HEAD, true, None, None).await?;
    raw.worker_runs = decode::<WorkerRunHead>(&runs)
        .into_iter()
        .map(|(_, run)| run)
        .collect();

    let plans = read_events(state, community_id, KIND_PLAN_HEAD, true, None, None).await?;
    raw.plans = decode::<PlanHead>(&plans)
        .into_iter()
        .map(|(_, plan)| plan)
        .collect();

    raw.chats_started = state
        .db
        .whatsapp_numbers_chats_started(community_id, since)
        .await
        .map_err(|error| format!("could not read WhatsApp chats: {error}"))?
        .into_iter()
        .filter(|at| at.timestamp() < as_of)
        .map(|at| at.timestamp())
        .collect();
    raw.first_replies = state
        .db
        .whatsapp_numbers_first_replies(community_id, since)
        .await
        .map_err(|error| format!("could not read WhatsApp replies: {error}"))?
        .into_iter()
        .filter(|at| at.timestamp() < as_of)
        .map(|at| at.timestamp())
        .collect();

    Ok(inputs_from_records(&raw, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn payment(n: u128, amount: i64, currency: &str, at: i64) -> PaymentEvidence {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "clientId": id(1),
            "invoiceId": id(2),
            "paymentId": id(n),
            "provider": "manual",
            "providerReference": null,
            "amountMinor": amount,
            "currency": currency,
            "occurredAt": at,
            "evidenceRef": "bank",
            "expectedInvoiceHeadEventId": HEX,
        }))
        .expect("payment evidence")
    }

    fn invoice(n: u128, status: &str, currency: &str, total: i64, outstanding: i64) -> InvoiceHead {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "clientId": id(1),
            "invoiceId": id(n),
            "proposalId": id(3),
            "proposalVersionEventId": HEX,
            "currency": currency,
            "lines": [],
            "totalMinor": total,
            "creditedMinor": 0,
            "writtenOffMinor": 0,
            "collectedMinor": total - outstanding,
            "outstandingMinor": outstanding,
            "paymentEvidenceCount": 0,
            "version": 1,
            "currentVersionEventId": HEX,
            "status": status,
            "dueAt": null,
            "issuedAt": 5_000,
            "sourceEventId": HEX,
        }))
        .expect("invoice head")
    }

    #[test]
    fn a_lead_a_quote_and_a_win_count_once_at_their_first_time() {
        let raw = RawRecords {
            // The same prospect created twice is one lead, at the earlier time.
            prospect_creates: vec![(id(1), 300), (id(1), 100), (id(2), 200)],
            // Only revision 1 is a quote; a revision is not a new quote.
            proposal_versions: vec![(id(9), 2, 150), (id(9), 1, 120), (id(8), 1, 400)],
            acceptances: vec![(id(9), 500), (id(9), 450)],
            chats_started: vec![30, 10, 20],
            first_replies: vec![60, 50],
            ..RawRecords::default()
        };
        let inputs = inputs_from_records(&raw, 1_000);
        assert_eq!(inputs.leads_created, vec![100, 200]);
        assert_eq!(inputs.quotes_sent, vec![120, 400]);
        assert_eq!(inputs.proposals_accepted, vec![450]);
        assert_eq!(inputs.contacts_started, vec![10, 20, 30]);
        assert_eq!(inputs.first_replies, vec![50, 60]);
    }

    #[test]
    fn money_is_stated_in_the_dominant_currency_and_the_rest_is_counted_out() {
        let raw = RawRecords {
            payments: vec![
                payment(1, 100_000, "ZAR", 100),
                payment(2, 50_000, "ZAR", 200),
                payment(3, 9_900, "USD", 300),
                // The same evidence stored twice counts once.
                payment(2, 50_000, "ZAR", 200),
            ],
            invoices: vec![
                invoice(10, "issued", "ZAR", 300_000, 200_000),
                invoice(11, "issued", "USD", 7_000, 7_000),
                invoice(12, "draft", "ZAR", 999_999, 999_999),
                invoice(13, "void", "ZAR", 888_888, 888_888),
            ],
            ..RawRecords::default()
        };
        let inputs = inputs_from_records(&raw, 1_000);
        assert_eq!(inputs.currency, "ZAR");
        assert_eq!(
            inputs.payments,
            vec![
                MoneyFact { at: 100, amount_minor: 100_000 },
                MoneyFact { at: 200, amount_minor: 50_000 },
            ]
        );
        // Drafts and voided invoices count for nothing.
        assert_eq!(
            inputs.invoices_issued,
            vec![MoneyFact { at: 5_000, amount_minor: 300_000 }]
        );
        assert_eq!(inputs.owed_minor, 200_000);
        // One USD payment and one USD invoice were left out.
        assert_eq!(inputs.other_currency_facts, 2);
    }

    #[test]
    fn a_company_with_no_money_records_reads_in_rand() {
        let inputs = inputs_from_records(&RawRecords::default(), 1_000);
        assert_eq!(inputs.currency, "ZAR");
        assert_eq!(inputs.owed_minor, 0);
    }

    fn run_head(status: &str, started: i64, deadline: i64, finished: Option<i64>, cost: Option<f64>) -> WorkerRunHead {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "run": {
                "workerId": id(7).to_string(),
                "parentPubkey": HEX,
                "label": "Research",
                "model": "cheap",
                "status": status,
                "startedAt": started,
                "deadlineAt": deadline,
                "finishedAt": finished,
                "inputTokens": 1,
                "outputTokens": 1,
                "costUsd": cost,
            },
            "updatedByPubkey": HEX,
            "updatedAt": 777,
            "sourceActionEventId": HEX,
        }))
        .expect("worker run head")
    }

    #[test]
    fn a_run_past_its_deadline_failed_at_its_deadline() {
        let raw = RawRecords {
            worker_runs: vec![
                run_head("running", 100, 500, None, None),
                run_head("running", 100, 5_000, None, None),
                run_head("done", 100, 500, Some(300), Some(0.1)),
                run_head("done", 100, 500, Some(300), Some(0.35)),
            ],
            ..RawRecords::default()
        };
        let facts = inputs_from_records(&raw, 1_000).worker_runs;
        assert_eq!(
            (facts[0].outcome, facts[0].ended_at),
            (WorkerOutcome::Failed, Some(500)),
            "timed out at its deadline"
        );
        assert_eq!(
            (facts[1].outcome, facts[1].ended_at),
            (WorkerOutcome::Running, None)
        );
        // Cost is reported in dollars and counted in whole cents.
        assert_eq!(facts[2].cost_usd_cents, 10);
        assert_eq!(facts[3].cost_usd_cents, 35);
    }

    #[test]
    fn only_a_whole_plan_approval_counts_as_a_plan_approved() {
        let plan: PlanHead = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "planId": id(5).to_string(),
            "status": "approved",
            "revision": 1,
            "plan": {
                "title": "November",
                "currency": "ZAR",
                "steps": [{
                    "stepId": "a",
                    "title": "Find",
                    "owner": {"kind": "owner"},
                    "costLabel": "Free",
                    "whenLabel": "Now",
                }],
            },
            "proposedByPubkey": HEX,
            "proposedAt": 1,
            "updatedByPubkey": HEX,
            "updatedAt": 2,
            "approvals": [
                {"scope": "plan", "decision": "approved", "actorPubkey": HEX, "at": 40, "revision": 1, "actionEventId": HEX},
                {"scope": "step", "stepId": "a", "decision": "approved", "actorPubkey": HEX, "at": 50, "revision": 1, "actionEventId": HEX},
                {"scope": "plan", "decision": "rejected", "actorPubkey": HEX, "at": 60, "revision": 1, "actionEventId": HEX},
            ],
            "sourceActionEventId": HEX,
        }))
        .expect("plan head");
        let inputs = inputs_from_records(
            &RawRecords {
                plans: vec![plan],
                ..RawRecords::default()
            },
            1_000,
        );
        assert_eq!(inputs.plan_approvals, vec![40]);
    }
}
