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

/// The legacy payment-record wire shape emitted by the relay.
///
/// `KIND_PAYMENT` predates money rails and is read by already-installed desktops. Keep this
/// serializer and its scope coordinates separate from the new money-rails record kinds: adding
/// a field here would make a 3.0.37 or 3.0.38 desktop reject the whole money-record response.
struct PaymentEvidenceWire {
    content: String,
    client_id: Uuid,
    d_tag: String,
}

fn payment_evidence_wire(
    evidence: &PaymentEvidence,
) -> Result<PaymentEvidenceWire, serde_json::Error> {
    Ok(PaymentEvidenceWire {
        content: serde_json::to_string(evidence)?,
        client_id: evidence.client_id,
        d_tag: payment_d_tag(evidence.client_id, evidence.payment_id),
    })
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
            );
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
    let wire = match payment_evidence_wire(&evidence) {
        Ok(wire) => wire,
        Err(error) => return failed(format!("could not build the evidence: {error}"), false),
    };
    let tags = match (
        Tag::parse(["h", wire.client_id.to_string().as_str()]),
        Tag::parse(["d", wire.d_tag.as_str()]),
    ) {
        (Ok(h), Ok(d)) => [h, d],
        _ => return failed("could not build the evidence tags", false),
    };
    let event = match EventBuilder::new(Kind::Custom(KIND_PAYMENT as u16), wire.content)
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
    use serde_json::{Map, Value};

    const PAYMENT_FIELDS: [&str; 11] = [
        "schemaVersion",
        "clientId",
        "invoiceId",
        "paymentId",
        "provider",
        "providerReference",
        "amountMinor",
        "currency",
        "occurredAt",
        "evidenceRef",
        "expectedInvoiceHeadEventId",
    ];

    /// Minimal `RelayEvent` copy used by the frozen desktop parsers below.
    ///
    /// The two desktop releases parse a response event, rather than a Rust business record, so
    /// this deliberately keeps the relay-facing fields (`kind`, `created_at`, `content`, tags).
    struct LegacyRelayEvent {
        kind: u32,
        created_at: i64,
        content: String,
        tags: Vec<Vec<String>>,
    }

    fn strict_legacy_payment_parser(event: &LegacyRelayEvent) -> Result<(), String> {
        // This is the strict `parsePayment` path shared by 3.0.37 and 3.0.38:
        // desktop/src/features/money/lib/moneyRecords.ts at f98626ba and 06cd5402.
        if event.kind != KIND_PAYMENT
            || !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&event.created_at)
        {
            return Err("money record event metadata is invalid".to_owned());
        }
        let value = serde_json::from_str::<Value>(&event.content)
            .map_err(|_| "money record content is invalid JSON".to_owned())?;
        let object = value
            .as_object()
            .ok_or_else(|| "money record content must be an object".to_owned())?;
        if object.len() != PAYMENT_FIELDS.len()
            || PAYMENT_FIELDS.iter().any(|key| !object.contains_key(*key))
        {
            return Err("money record fields are invalid".to_owned());
        }

        let client_id = legacy_uuid(object, "clientId")?;
        let payment_id = legacy_uuid(object, "paymentId")?;
        let expected_d_tag = payment_d_tag(client_id, payment_id);
        let h_tags = event
            .tags
            .iter()
            .filter(|tag| tag.first().is_some_and(|kind| kind == "h"))
            .collect::<Vec<_>>();
        let d_tags = event
            .tags
            .iter()
            .filter(|tag| tag.first().is_some_and(|kind| kind == "d"))
            .collect::<Vec<_>>();
        if event.tags.len() != 2
            || h_tags.len() != 1
            || h_tags[0].len() != 2
            || d_tags.len() != 1
            || d_tags[0].len() != 2
            || !h_tags[0][1].eq_ignore_ascii_case(&client_id.to_string())
            || d_tags[0][1] != expected_d_tag
        {
            return Err("money record scope tags are invalid".to_owned());
        }

        legacy_integer(object, "schemaVersion", 1)?;
        legacy_uuid(object, "invoiceId")?;
        legacy_string(object, "provider")?;
        match object.get("providerReference") {
            Some(Value::Null) => {}
            Some(Value::String(_)) => {}
            _ => return Err("money record providerReference must be nullable string".to_owned()),
        }
        legacy_integer(object, "amountMinor", 1)?;
        let currency = legacy_string(object, "currency")?;
        if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
            return Err("money record currency is not an ISO currency code".to_owned());
        }
        legacy_integer(object, "occurredAt", 1)?;
        if legacy_string(object, "evidenceRef")?.trim().is_empty() {
            return Err("money record evidenceRef is empty".to_owned());
        }
        let expected_head = legacy_string(object, "expectedInvoiceHeadEventId")?;
        if expected_head.len() != 64
            || !expected_head
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err("money record expectedInvoiceHeadEventId is invalid".to_owned());
        }
        Ok(())
    }

    fn legacy_uuid(object: &Map<String, Value>, key: &str) -> Result<Uuid, String> {
        let value = legacy_string(object, key)?;
        let bytes = value.as_bytes();
        // Match the frozen desktop `UUID_RE`, rather than accepting every spelling that the
        // Rust UUID parser happens to permit. In particular, UUID version zero is parseable in
        // Rust but rejected by both installed desktop parsers.
        let canonical_shape = bytes.len() == 36
            && [8, 13, 18, 23]
                .into_iter()
                .all(|index| bytes[index] == b'-')
            && bytes
                .iter()
                .enumerate()
                .filter(|(index, _)| ![8, 13, 18, 23].contains(index))
                .all(|(_, byte)| byte.is_ascii_hexdigit())
            && matches!(bytes[14].to_ascii_lowercase(), b'1'..=b'8')
            && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b');
        if !canonical_shape {
            return Err(format!("money record {key} is not a UUID"));
        }
        Uuid::parse_str(value).map_err(|_| format!("money record {key} is not a UUID"))
    }

    fn legacy_string<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str, String> {
        object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("money record {key} must be a string"))
    }

    fn legacy_integer(object: &Map<String, Value>, key: &str, minimum: i64) -> Result<i64, String> {
        let value = object
            .get(key)
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("money record {key} is not a safe integer"))?;
        if value < minimum || value > 9_007_199_254_740_991 {
            return Err(format!("money record {key} is not a safe integer"));
        }
        Ok(value)
    }

    fn parse_payment_as_desktop_3_0_37(event: &LegacyRelayEvent) -> Result<(), String> {
        // Frozen from f98626baea744e5e97478df417248b47ec9aa87a.
        strict_legacy_payment_parser(event)
    }

    fn parse_payment_as_desktop_3_0_38(event: &LegacyRelayEvent) -> Result<(), String> {
        // Frozen from 06cd5402da72f25202f8eea404973045d4d99065.
        strict_legacy_payment_parser(event)
    }

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

    #[test]
    fn new_relay_payment_evidence_parses_in_the_strict_3_0_37_and_3_0_38_desktops() {
        // This uses the production serializer and scope coordinates. The older clients reject
        // unknown fields, so this fails if the relay expands the pre-existing 47027 shape rather
        // than using an optional field on a new money-rails record kind.
        // These are canonical RFC 4122 version-four UUIDs. The frozen desktop parser rejects
        // the version-zero UUIDs that `Uuid::from_u128` would otherwise make convenient here.
        let client_id =
            Uuid::parse_str("11111111-1111-4111-8111-111111111111").expect("fixture client id");
        let payment_id =
            Uuid::parse_str("22222222-2222-4222-8222-222222222222").expect("fixture payment id");
        let wire = payment_evidence_wire(&PaymentEvidence {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id,
            invoice_id: Uuid::parse_str("33333333-3333-4333-8333-333333333333")
                .expect("fixture invoice id"),
            payment_id,
            provider: "examplepay".to_owned(),
            provider_reference: Some("plink_1".to_owned()),
            amount_minor: 375_000,
            currency: "ZAR".to_owned(),
            occurred_at: 1_793_000_500,
            evidence_ref: "paylink:00000000-0000-0000-0000-000000000002".to_owned(),
            expected_invoice_head_event_id: "a".repeat(64),
        })
        .expect("serialize the production payment evidence");
        let event = LegacyRelayEvent {
            kind: KIND_PAYMENT,
            created_at: 1_793_000_500,
            content: wire.content,
            tags: vec![
                vec!["h".to_owned(), wire.client_id.to_string()],
                vec!["d".to_owned(), wire.d_tag],
            ],
        };

        parse_payment_as_desktop_3_0_37(&event).expect("3.0.37 accepts new relay evidence");
        parse_payment_as_desktop_3_0_38(&event).expect("3.0.38 accepts new relay evidence");
    }
}
