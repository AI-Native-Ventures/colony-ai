//! Client-scoped invoice, payment evidence, adjustment, and follow-up commands.

use chrono::Utc;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use uuid::Uuid;

use buzz_core::business_records::{
    invoice_head_d_tag, is_iso_currency_code, money_follow_up_d_tag, InvoiceHead, InvoiceStatus,
    InvoiceVersion, InvoiceVersionAction, MoneyAdjustment, MoneyFollowUpAction,
    MoneyFollowUpActionKind, MoneyFollowUpHead, MoneyFollowUpStatus, PaymentEvidence,
    BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::*;
use buzz_sdk::business_records::{
    build_invoice_version, build_money_adjustment, build_money_follow_up, build_payment_evidence,
};

use crate::client::BuzzClient;
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::parse_uuid;
use crate::{
    MoneyAdjustmentArg, MoneyAdjustmentsCmd, MoneyCmd, MoneyFollowUpsCmd, MoneyInvoicesCmd,
    MoneyPaymentsCmd,
};

const MAX_MONEY_RECORDS: u32 = 5_000;

struct InvoiceSnapshot {
    event: Value,
    event_id: String,
    head: InvoiceHead,
}

struct PaymentInput {
    channel: String,
    invoice: String,
    amount_minor: i64,
    provider: String,
    provider_reference: Option<String>,
    currency: Option<String>,
    occurred_at: Option<i64>,
    evidence_ref: String,
}

struct AdjustmentInput {
    channel: String,
    invoice: String,
    adjustment_type: MoneyAdjustmentArg,
    amount_minor: i64,
    occurred_at: Option<i64>,
    reason: String,
    evidence_ref: String,
}

/// Route a `buzz money` command.
pub async fn dispatch(command: MoneyCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        MoneyCmd::Invoices(command) => dispatch_invoices(command, client).await,
        MoneyCmd::Payments(MoneyPaymentsCmd::Record {
            channel,
            invoice,
            amount_minor,
            provider,
            provider_reference,
            currency,
            occurred_at,
            evidence_ref,
        }) => {
            record_payment(
                client,
                PaymentInput {
                    channel,
                    invoice,
                    amount_minor,
                    provider,
                    provider_reference,
                    currency,
                    occurred_at,
                    evidence_ref,
                },
            )
            .await
        }
        MoneyCmd::Adjustments(MoneyAdjustmentsCmd::Create {
            channel,
            invoice,
            adjustment_type,
            amount_minor,
            occurred_at,
            reason,
            evidence_ref,
        }) => {
            create_adjustment(
                client,
                AdjustmentInput {
                    channel,
                    invoice,
                    adjustment_type,
                    amount_minor,
                    occurred_at,
                    reason,
                    evidence_ref,
                },
            )
            .await
        }
        MoneyCmd::FollowUps(command) => dispatch_follow_ups(command, client).await,
    }
}

async fn dispatch_invoices(command: MoneyInvoicesCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        MoneyInvoicesCmd::List { channel } => list_invoices(client, &channel).await,
        MoneyInvoicesCmd::Show { channel, invoice } => {
            show_invoice(client, &channel, &invoice).await
        }
        MoneyInvoicesCmd::Issue { channel, invoice } => {
            transition_invoice(
                client,
                &channel,
                &invoice,
                InvoiceVersionAction::Issue,
                None,
            )
            .await
        }
        MoneyInvoicesCmd::Void {
            channel,
            invoice,
            reason,
        } => {
            transition_invoice(
                client,
                &channel,
                &invoice,
                InvoiceVersionAction::Void,
                Some(reason),
            )
            .await
        }
    }
}

async fn dispatch_follow_ups(
    command: MoneyFollowUpsCmd,
    client: &BuzzClient,
) -> Result<(), CliError> {
    match command {
        MoneyFollowUpsCmd::Draft {
            channel,
            invoice,
            content,
            due_at,
            follow_up,
        } => draft_follow_up(client, &channel, &invoice, content, due_at, follow_up).await,
        MoneyFollowUpsCmd::Review {
            channel,
            invoice,
            follow_up,
        } => {
            transition_follow_up(
                client,
                &channel,
                &invoice,
                &follow_up,
                MoneyFollowUpActionKind::Review,
            )
            .await
        }
        MoneyFollowUpsCmd::Approve {
            channel,
            invoice,
            follow_up,
        } => {
            transition_follow_up(
                client,
                &channel,
                &invoice,
                &follow_up,
                MoneyFollowUpActionKind::Approve,
            )
            .await
        }
    }
}

async fn list_invoices(client: &BuzzClient, channel: &str) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let filter = json!({
        "kinds": [KIND_INVOICE_HEAD],
        "#h": [channel_id.to_string()]
    });
    let records = client.query_all_bounded(filter, MAX_MONEY_RECORDS).await?;
    print_json(&Value::Array(records))
}

async fn show_invoice(client: &BuzzClient, channel: &str, invoice: &str) -> Result<(), CliError> {
    let snapshot = fetch_invoice(client, channel, invoice).await?;
    let channel_id = snapshot.head.client_id;
    let invoice_id = snapshot.head.invoice_id;
    let channel_tag = channel_id.to_string();

    let versions = query_records(
        client,
        json!({"kinds": [KIND_INVOICE_VERSION], "#h": [channel_tag]}),
        invoice_id,
    )
    .await?;
    let payments = query_records(
        client,
        json!({"kinds": [KIND_PAYMENT], "#h": [channel_id.to_string()]}),
        invoice_id,
    )
    .await?;
    let adjustments = query_records(
        client,
        json!({"kinds": [KIND_MONEY_ADJUSTMENT], "#h": [channel_id.to_string()]}),
        invoice_id,
    )
    .await?;

    print_json(&json!({
        "invoice": snapshot.event,
        "versions": versions,
        "payments": payments,
        "adjustments": adjustments
    }))
}

async fn query_records(
    client: &BuzzClient,
    filter: Value,
    invoice_id: Uuid,
) -> Result<Vec<Value>, CliError> {
    let events = client.query_all_bounded(filter, MAX_MONEY_RECORDS).await?;
    let invoice_id_text = invoice_id.to_string();
    let mut records = Vec::new();
    for event in events {
        let record: Value = parse_content(&event, "money event")?;
        let record_invoice = record
            .get("invoiceId")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::Other("money event has no invoiceId".into()))?;
        if record_invoice == invoice_id_text {
            records.push((event_created_at(&event)?, event));
        }
    }
    records.sort_by_key(|(created_at, _)| *created_at);
    Ok(records.into_iter().map(|(_, event)| event).collect())
}

async fn transition_invoice(
    client: &BuzzClient,
    channel: &str,
    invoice: &str,
    action: InvoiceVersionAction,
    void_reason: Option<String>,
) -> Result<(), CliError> {
    let snapshot = fetch_invoice(client, channel, invoice).await?;
    let required_status = match action {
        InvoiceVersionAction::Issue => InvoiceStatus::Draft,
        InvoiceVersionAction::Void => {
            if !matches!(
                snapshot.head.status,
                InvoiceStatus::Draft | InvoiceStatus::Issued
            ) {
                return Err(CliError::Usage(
                    "only a draft or issued invoice can be voided".into(),
                ));
            }
            if snapshot.head.payment_evidence_count > 0 {
                return Err(CliError::Usage(
                    "an invoice with payment evidence cannot be voided".into(),
                ));
            }
            snapshot.head.status
        }
        _ => {
            return Err(CliError::Usage(
                "this command supports issuing or voiding an invoice".into(),
            ));
        }
    };
    if action == InvoiceVersionAction::Issue && snapshot.head.status != required_status {
        return Err(CliError::Usage("only a draft invoice can be issued".into()));
    }
    if action == InvoiceVersionAction::Void
        && void_reason
            .as_deref()
            .is_none_or(|reason| reason.trim().is_empty() || reason.len() > 1_000)
    {
        return Err(CliError::Usage(
            "void reason must contain 1 to 1000 characters".into(),
        ));
    }

    let version_number = snapshot
        .head
        .version
        .checked_add(1)
        .ok_or_else(|| CliError::Usage("invoice version is exhausted".into()))?;
    let version = InvoiceVersion {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: snapshot.head.client_id,
        invoice_id: snapshot.head.invoice_id,
        version: version_number,
        previous_version_event_id: Some(snapshot.head.current_version_event_id.clone()),
        proposal_version_event_id: Some(snapshot.head.proposal_version_event_id.clone()),
        expected_head_event_id: Some(snapshot.event_id),
        action,
        currency: snapshot.head.currency.clone(),
        lines: snapshot.head.lines.clone(),
        total_minor: snapshot.head.total_minor,
        status: match action {
            InvoiceVersionAction::Issue => InvoiceStatus::Issued,
            InvoiceVersionAction::Void => InvoiceStatus::Void,
            _ => snapshot.head.status,
        },
        due_at: snapshot.head.due_at,
        void_reason,
    };
    let builder = build_invoice_version(&version).map_err(sdk_error)?;
    publish(
        client,
        builder,
        "invoice changed before the transition was recorded",
    )
    .await
}

async fn record_payment(client: &BuzzClient, input: PaymentInput) -> Result<(), CliError> {
    let PaymentInput {
        channel,
        invoice,
        amount_minor,
        provider,
        provider_reference,
        currency,
        occurred_at,
        evidence_ref,
    } = input;
    validate_positive_amount(amount_minor)?;
    if evidence_ref.trim().is_empty() || evidence_ref.len() > 2_000 {
        return Err(CliError::Usage(
            "evidence reference must contain 1 to 2000 characters".into(),
        ));
    }
    if provider.trim().is_empty()
        || provider.trim() != provider
        || provider.len() > 120
        || (provider != "manual" && provider_reference.is_none())
        || provider_reference
            .as_deref()
            .is_some_and(|value| value.trim().is_empty() || value.len() > 240)
    {
        return Err(CliError::Usage(
            "provider must be manual or a named provider with a valid reference".into(),
        ));
    }

    let snapshot = fetch_invoice(client, &channel, &invoice).await?;
    if snapshot.head.status != InvoiceStatus::Issued {
        return Err(CliError::Usage(
            "payment evidence requires an issued invoice".into(),
        ));
    }
    if amount_minor > snapshot.head.outstanding_minor {
        return Err(CliError::Usage(
            "payment amount exceeds the outstanding balance".into(),
        ));
    }
    let payment_currency = currency.unwrap_or_else(|| snapshot.head.currency.clone());
    if !is_iso_currency_code(&payment_currency) || payment_currency != snapshot.head.currency {
        return Err(CliError::Usage(
            "payment currency must match the invoice currency".into(),
        ));
    }
    let payment = PaymentEvidence {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: snapshot.head.client_id,
        invoice_id: snapshot.head.invoice_id,
        payment_id: Uuid::new_v4(),
        provider,
        provider_reference,
        amount_minor,
        currency: payment_currency,
        occurred_at: occurred_at.unwrap_or_else(|| Utc::now().timestamp()),
        evidence_ref,
        expected_invoice_head_event_id: snapshot.event_id,
    };
    let builder = build_payment_evidence(&payment).map_err(sdk_error)?;
    publish(
        client,
        builder,
        "invoice changed before payment evidence was recorded",
    )
    .await
}

async fn create_adjustment(client: &BuzzClient, input: AdjustmentInput) -> Result<(), CliError> {
    let AdjustmentInput {
        channel,
        invoice,
        adjustment_type,
        amount_minor,
        occurred_at,
        reason,
        evidence_ref,
    } = input;
    validate_positive_amount(amount_minor)?;
    let occurred_at = occurred_at.unwrap_or_else(|| Utc::now().timestamp());
    if occurred_at <= 0 {
        return Err(CliError::Usage(
            "occurred-at must be a positive Unix timestamp".into(),
        ));
    }
    if reason.trim().is_empty() || reason.len() > 1_000 {
        return Err(CliError::Usage(
            "reason must contain 1 to 1000 characters".into(),
        ));
    }
    if evidence_ref.trim().is_empty() || evidence_ref.len() > 2_000 {
        return Err(CliError::Usage(
            "evidence reference must contain 1 to 2000 characters".into(),
        ));
    }

    let snapshot = fetch_invoice(client, &channel, &invoice).await?;
    if snapshot.head.status != InvoiceStatus::Issued {
        return Err(CliError::Usage(
            "adjustments require an issued invoice".into(),
        ));
    }
    validate_adjustment_amount(&snapshot.head, adjustment_type, amount_minor)?;
    let adjustment = MoneyAdjustment {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: snapshot.head.client_id,
        invoice_id: snapshot.head.invoice_id,
        adjustment_id: Uuid::new_v4(),
        adjustment_type: adjustment_type.to_wire(),
        amount_minor,
        currency: snapshot.head.currency.clone(),
        occurred_at,
        reason,
        evidence_ref,
        expected_invoice_head_event_id: snapshot.event_id,
    };
    let builder = build_money_adjustment(&adjustment).map_err(sdk_error)?;
    publish(
        client,
        builder,
        "invoice changed before the adjustment was recorded",
    )
    .await
}

async fn draft_follow_up(
    client: &BuzzClient,
    channel: &str,
    invoice: &str,
    content: String,
    due_at: Option<i64>,
    follow_up: Option<String>,
) -> Result<(), CliError> {
    validate_follow_up_content(&content)?;
    let snapshot = fetch_invoice(client, channel, invoice).await?;
    ensure_overdue_invoice(&snapshot.head)?;
    let follow_up_id = follow_up
        .map(|value| parse_uuid(&value))
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);
    let action = MoneyFollowUpAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: snapshot.head.client_id,
        invoice_id: snapshot.head.invoice_id,
        follow_up_id,
        action: MoneyFollowUpActionKind::Draft,
        expected_head_event_id: None,
        expected_invoice_head_event_id: snapshot.event_id,
        due_at,
        draft_content: content,
    };
    let builder = build_money_follow_up(&action).map_err(sdk_error)?;
    let result = publish_result(
        client,
        builder,
        "invoice changed before the follow-up was recorded",
    )
    .await?;
    print_json(&json!({"followUpId": follow_up_id, "write": result}))
}

async fn transition_follow_up(
    client: &BuzzClient,
    channel: &str,
    invoice: &str,
    follow_up: &str,
    action_kind: MoneyFollowUpActionKind,
) -> Result<(), CliError> {
    let snapshot = fetch_invoice(client, channel, invoice).await?;
    ensure_overdue_invoice(&snapshot.head)?;
    let follow_up_id = parse_uuid(follow_up)?;
    let (head_event, head): (Value, MoneyFollowUpHead) = fetch_follow_up(
        client,
        snapshot.head.client_id,
        snapshot.head.invoice_id,
        follow_up_id,
    )
    .await?;
    match action_kind {
        MoneyFollowUpActionKind::Review if head.status != MoneyFollowUpStatus::Draft => {
            return Err(CliError::Usage(
                "only a draft follow-up can move into review".into(),
            ));
        }
        MoneyFollowUpActionKind::Approve if head.status != MoneyFollowUpStatus::InReview => {
            return Err(CliError::Usage(
                "only a follow-up in review can be approved".into(),
            ));
        }
        _ => {}
    }
    let action = MoneyFollowUpAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        client_id: snapshot.head.client_id,
        invoice_id: snapshot.head.invoice_id,
        follow_up_id,
        action: action_kind,
        expected_head_event_id: Some(event_id(&head_event)?.to_owned()),
        expected_invoice_head_event_id: snapshot.event_id,
        due_at: head.due_at,
        draft_content: head.draft_content,
    };
    let builder = build_money_follow_up(&action).map_err(sdk_error)?;
    publish(
        client,
        builder,
        "follow-up changed before the transition was recorded",
    )
    .await
}

async fn fetch_invoice(
    client: &BuzzClient,
    channel: &str,
    invoice: &str,
) -> Result<InvoiceSnapshot, CliError> {
    let channel_id = parse_uuid(channel)?;
    let invoice_id = parse_uuid(invoice)?;
    let d_tag = invoice_head_d_tag(channel_id, invoice_id);
    let filter = json!({
        "kinds": [KIND_INVOICE_HEAD],
        "#h": [channel_id.to_string()],
        "#d": [d_tag]
    });
    let mut events = client.query_all_bounded(filter, 2).await?;
    match events.len() {
        0 => {
            return Err(CliError::Usage(
                "invoice was not found in this client channel".into(),
            ));
        }
        1 => {}
        _ => {
            return Err(CliError::Other(
                "invoice coordinate returned multiple heads".into(),
            ));
        }
    }
    let event = events
        .pop()
        .ok_or_else(|| CliError::Other("invoice query returned no head".into()))?;
    let head: InvoiceHead = parse_content(&event, "invoice head")?;
    if head.client_id != channel_id || head.invoice_id != invoice_id {
        return Err(CliError::Other(
            "invoice head does not match the requested client scope".into(),
        ));
    }
    Ok(InvoiceSnapshot {
        event_id: event_id(&event)?.to_owned(),
        event,
        head,
    })
}

async fn fetch_follow_up(
    client: &BuzzClient,
    client_id: Uuid,
    invoice_id: Uuid,
    follow_up_id: Uuid,
) -> Result<(Value, MoneyFollowUpHead), CliError> {
    let d_tag = money_follow_up_d_tag(client_id, follow_up_id);
    let filter = json!({
        "kinds": [KIND_MONEY_FOLLOW_UP_HEAD],
        "#h": [client_id.to_string()],
        "#d": [d_tag]
    });
    let mut events = client.query_all_bounded(filter, 2).await?;
    match events.len() {
        0 => {
            return Err(CliError::Usage(
                "follow-up does not exist in this client channel".into(),
            ));
        }
        1 => {}
        _ => {
            return Err(CliError::Other(
                "follow-up coordinate returned multiple heads".into(),
            ));
        }
    }
    let event = events
        .pop()
        .ok_or_else(|| CliError::Other("follow-up query returned no head".into()))?;
    let head: MoneyFollowUpHead = parse_content(&event, "follow-up head")?;
    if head.client_id != client_id
        || head.invoice_id != invoice_id
        || head.follow_up_id != follow_up_id
    {
        return Err(CliError::Other(
            "follow-up head does not match the requested invoice".into(),
        ));
    }
    Ok((event, head))
}

fn ensure_overdue_invoice(head: &InvoiceHead) -> Result<(), CliError> {
    let now = Utc::now().timestamp();
    if head.status != InvoiceStatus::Issued
        || head.outstanding_minor <= 0
        || head.due_at.is_none_or(|due_at| due_at >= now)
    {
        return Err(CliError::Usage(
            "follow-ups require an issued overdue invoice balance".into(),
        ));
    }
    Ok(())
}

fn validate_adjustment_amount(
    head: &InvoiceHead,
    adjustment_type: MoneyAdjustmentArg,
    amount_minor: i64,
) -> Result<(), CliError> {
    let available = match adjustment_type.to_wire() {
        buzz_core::business_records::MoneyAdjustmentType::CreditNote => {
            i128::from(head.total_minor) - i128::from(head.credited_minor)
        }
        buzz_core::business_records::MoneyAdjustmentType::Refund => {
            let obligation = i128::from(head.total_minor)
                - i128::from(head.credited_minor)
                - i128::from(head.written_off_minor);
            (i128::from(head.collected_minor) - obligation).max(0)
        }
        buzz_core::business_records::MoneyAdjustmentType::WriteOff => {
            i128::from(head.outstanding_minor)
        }
    };
    if i128::from(amount_minor) > available {
        return Err(CliError::Usage(
            "adjustment amount exceeds the available invoice balance or client credit".into(),
        ));
    }
    Ok(())
}

fn validate_positive_amount(amount_minor: i64) -> Result<(), CliError> {
    if amount_minor <= 0 {
        return Err(CliError::Usage(
            "amount must be a positive integer in minor currency units".into(),
        ));
    }
    Ok(())
}

fn validate_follow_up_content(content: &str) -> Result<(), CliError> {
    if content.trim().is_empty() || content.len() > 5_000 {
        return Err(CliError::Usage(
            "follow-up content must contain 1 to 5000 characters".into(),
        ));
    }
    Ok(())
}

fn parse_content<T: DeserializeOwned>(event: &Value, label: &str) -> Result<T, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other(format!("{label} event has no content")))?;
    serde_json::from_str(content)
        .map_err(|error| CliError::Other(format!("{label} content is invalid: {error}")))
}

fn event_id(event: &Value) -> Result<&str, CliError> {
    event
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| CliError::Other("money record event has an invalid id".into()))
}

fn event_created_at(event: &Value) -> Result<u64, CliError> {
    event
        .get("created_at")
        .and_then(Value::as_u64)
        .ok_or_else(|| CliError::Other("money record event has no created_at".into()))
}

fn sdk_error(error: impl std::fmt::Display) -> CliError {
    CliError::Usage(format!("invalid money record: {error}"))
}

async fn publish(
    client: &BuzzClient,
    builder: nostr::EventBuilder,
    conflict_message: &str,
) -> Result<(), CliError> {
    let result = publish_result(client, builder, conflict_message).await?;
    println!("{result}");
    Ok(())
}

async fn publish_result(
    client: &BuzzClient,
    builder: nostr::EventBuilder,
    conflict_message: &str,
) -> Result<String, CliError> {
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, conflict_message)
}

fn print_json(value: &Value) -> Result<(), CliError> {
    let rendered = serde_json::to_string_pretty(value)
        .map_err(|error| CliError::Other(format!("money result serialization failed: {error}")))?;
    println!("{rendered}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amount_validation_rejects_zero_and_negative_values() {
        assert!(validate_positive_amount(1).is_ok());
        assert!(validate_positive_amount(0).is_err());
        assert!(validate_positive_amount(-1).is_err());
    }

    #[test]
    fn adjustment_limits_use_integer_minor_units() {
        let head = InvoiceHead {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id: Uuid::from_u128(1),
            invoice_id: Uuid::from_u128(2),
            proposal_id: Uuid::from_u128(3),
            proposal_version_event_id: "a".repeat(64),
            currency: "ZAR".into(),
            lines: Vec::new(),
            total_minor: 10_000,
            credited_minor: 2_000,
            written_off_minor: 1_000,
            collected_minor: 8_000,
            outstanding_minor: 0,
            payment_evidence_count: 1,
            version: 1,
            current_version_event_id: "b".repeat(64),
            status: InvoiceStatus::Issued,
            due_at: None,
            issued_at: Some(1_800_000_000),
            source_event_id: "c".repeat(64),
        };
        assert!(validate_adjustment_amount(&head, MoneyAdjustmentArg::CreditNote, 8_000).is_ok());
        assert!(validate_adjustment_amount(&head, MoneyAdjustmentArg::CreditNote, 8_001).is_err());
        assert!(validate_adjustment_amount(&head, MoneyAdjustmentArg::Refund, 1_000).is_ok());
        assert!(validate_adjustment_amount(&head, MoneyAdjustmentArg::Refund, 1_001).is_err());
        assert!(validate_adjustment_amount(&head, MoneyAdjustmentArg::WriteOff, 1).is_err());
    }
}
