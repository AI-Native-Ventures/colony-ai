//! Writes payment evidence (kind 47027) for a verified payment link payment.
//!
//! The relay builds a relay-signed 47027 command and runs it through the existing business
//! record handler as the owner or admin who approved the card, the same way the Outreach desk
//! records a booked call. The handler still enforces everything: an issued invoice, the same
//! currency, an amount within the outstanding balance, the exact invoice head. Revenue totals,
//! scorecards and the weekly review therefore stay right with no second source of truth.

use std::sync::Arc;

use nostr::{EventBuilder, Kind, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use buzz_core::business_records::{payment_d_tag, PaymentEvidence, BUSINESS_RECORD_SCHEMA_VERSION};
use buzz_core::kind::KIND_PAYMENT;
use buzz_core::money_rails::link::{LinkHead, PaymentSource};
use buzz_core::tenant::TenantContext;
use buzz_db::EventQuery;

use super::{derived_uuid, read_invoice};
use crate::handlers::ingest::{HttpAuthMethod, IngestAuth, IngestError};
use crate::state::AppState;

/// The input of an evidence job, stored with the job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePayload {
    /// Pubkey (hex) of the owner or admin whose authority backs the write.
    pub actor: String,
    /// How the payment was verified.
    pub source: PaymentSource,
    /// Provider reference.
    #[serde(default)]
    pub reference: Option<String>,
    /// Amount in minor units (the card amount).
    pub amount_minor: i64,
    /// Currency (the card currency).
    pub currency: String,
    /// When the payment happened.
    pub at: i64,
    /// The notice behind it.
    #[serde(default)]
    pub notice_id: Option<Uuid>,
}

/// What the write came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvidenceResult {
    /// The evidence exists now (written now or found from an earlier try).
    Recorded {
        /// Stable evidence id.
        payment_id: Uuid,
        /// The evidence event.
        event_id: String,
    },
    /// It could not be written yet; the reason is plain words for the owner.
    Failed {
        /// Why.
        reason: String,
        /// Whether trying again can help.
        retryable: bool,
    },
}

fn failed(reason: impl Into<String>, retryable: bool) -> EvidenceResult {
    EvidenceResult::Failed {
        reason: reason.into(),
        retryable,
    }
}

/// Writes (or finds) the payment evidence for a card. Idempotent per card.
pub async fn record_payment(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    head: &LinkHead,
    payload: &EvidencePayload,
) -> EvidenceResult {
    let community = tenant.community();
    let payment_id = derived_uuid("payment", head.link_id);
    let payment_d = payment_d_tag(head.client_id, payment_id);

    // An earlier try may have written it before the card could be marked Paid.
    let mut query = EventQuery::for_community(community);
    query.channel_id = Some(head.client_id);
    query.kinds = Some(vec![KIND_PAYMENT as i32]);
    query.d_tag = Some(payment_d.clone());
    query.limit = Some(1);
    match state.db.query_events_for_event_write(&query).await {
        Ok(rows) => {
            if let Some(existing) = rows.first() {
                return EvidenceResult::Recorded {
                    payment_id,
                    event_id: existing.event.id.to_hex(),
                };
            }
        }
        Err(error) => {
            return failed(
                format!("could not look for earlier evidence: {error}"),
                true,
            )
        }
    }

    let invoice = match read_invoice(state, community, head.invoice_id).await {
        Ok(Some(invoice)) => invoice,
        Ok(None) => return failed("The invoice for this card could not be found.", true),
        Err(error) => return failed(format!("could not read the invoice: {error}"), true),
    };
    let named = payload
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|reference| !reference.is_empty() && reference.len() <= 240);
    let provider = match named {
        Some(_) => head
            .provider_label
            .trim()
            .chars()
            .take(120)
            .collect::<String>(),
        None => "manual".to_owned(),
    };
    let evidence = PaymentEvidence {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: head.client_id,
        invoice_id: head.invoice_id,
        payment_id,
        provider,
        provider_reference: named.map(str::to_owned),
        amount_minor: head.amount_minor,
        currency: head.currency.clone(),
        occurred_at: payload.at.max(1),
        evidence_ref: format!("paylink:{}", head.link_id),
        expected_invoice_head_event_id: invoice.event.event.id.to_hex(),
    };
    let content = match serde_json::to_string(&evidence) {
        Ok(content) => content,
        Err(error) => return failed(format!("could not build the evidence: {error}"), false),
    };
    let tags = match (
        Tag::parse(["h", head.client_id.to_string().as_str()]),
        Tag::parse(["d", payment_d.as_str()]),
    ) {
        (Ok(h), Ok(d)) => [h, d],
        _ => return failed("could not build the evidence tags", false),
    };
    let event = match EventBuilder::new(Kind::Custom(KIND_PAYMENT as u16), content)
        .tags(tags)
        .custom_created_at(Timestamp::from_secs(
            u64::try_from(payload.at.max(1)).unwrap_or(1),
        ))
        .sign_with_keys(&state.relay_keypair)
    {
        Ok(event) => event,
        Err(error) => return failed(format!("could not sign the evidence: {error}"), false),
    };
    let Ok(actor) = nostr::PublicKey::from_hex(&payload.actor) else {
        return failed("The approver of this card is not a valid member.", false);
    };
    let auth = IngestAuth::Http {
        pubkey: actor,
        scopes: vec![buzz_auth::Scope::MessagesWrite],
        auth_method: HttpAuthMethod::Nip98,
    };
    match crate::handlers::business_records::handle(tenant, state, event.clone(), auth).await {
        Ok(_) => EvidenceResult::Recorded {
            payment_id,
            event_id: event.id.to_hex(),
        },
        Err(IngestError::Rejected(reason)) => {
            // A conflict (the invoice head moved) is worth another look; a refusal of the
            // amount or of the approver's role is for the owner to resolve.
            let retryable = reason.starts_with("conflict:");
            failed(
                format!("The invoice did not accept the payment: {reason}"),
                retryable,
            )
        }
        Err(IngestError::AuthFailed(reason)) => failed(
            format!("The approver may not record payments: {reason}"),
            false,
        ),
        Err(IngestError::Internal(reason)) => failed(
            format!("The payment could not be recorded yet: {reason}"),
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_evidence_payload_round_trips_with_camel_case_names() {
        let payload = EvidencePayload {
            actor: "ab".repeat(32),
            source: PaymentSource::Hmac,
            reference: Some("plink_1".to_owned()),
            amount_minor: 375_000,
            currency: "ZAR".to_owned(),
            at: 1_793_000_500,
            notice_id: None,
        };
        let json = serde_json::to_value(&payload).expect("json");
        assert_eq!(json["amountMinor"], 375_000);
        assert_eq!(json["source"], "hmac");
        let back: EvidencePayload = serde_json::from_value(json).expect("back");
        assert_eq!(back.reference.as_deref(), Some("plink_1"));
    }
}
