//! Typed employee AI allowances and company AI spend records.
//!
//! Amounts are stored as integer minor units. This module owns wire
//! validation and pure period math; relay authorization and persistence live
//! in `buzz-relay`.

use chrono::{DateTime, Datelike, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Maximum text length for a provider or plan label.
pub const MAX_SPEND_LABEL_CHARS: usize = 160;
/// Maximum number of entries in a saved funding order.
pub const MAX_FUNDING_ORDER_ITEMS: usize = 12;

/// Allowance period used for the employee's AI spend budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AllowancePeriod {
    /// Calendar day in UTC.
    Day,
    /// Calendar week beginning Monday in UTC.
    Week,
    /// Calendar month in UTC.
    Month,
}

/// A positive AI allowance amount and its explicitly selected period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AllowanceValue {
    /// Allowance in integer USD cents encoded as a canonical decimal string.
    pub amount_cents: String,
    /// Period selected for this allowance.
    pub period: AllowancePeriod,
}

/// Temporary allowance override. Its expiry is derived at read time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TemporaryAllowance {
    /// Temporary allowance amount and period.
    pub allowance: AllowanceValue,
    /// End timestamp in RFC 3339 with an explicit UTC offset.
    pub expires_at: String,
}

/// Member-signed change to an employee allowance (kind 47042).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EmployeeAllowanceAction {
    /// Company record schema version.
    pub schema_version: u8,
    /// Employee whose allowance is changed.
    pub employee_pubkey: String,
    /// Exact current allowance head event id; omitted only on first write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Permanent allowance, with no implicit configured value.
    pub allowance: AllowanceValue,
    /// Temporary raise, if currently configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporary_allowance: Option<TemporaryAllowance>,
    /// Explicit ordered funding source identifiers. An empty list means no
    /// source order has been configured.
    #[serde(default)]
    pub funding_order: Vec<String>,
}

/// Relay-signed current employee allowance (kind 30653).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EmployeeAllowanceHead {
    /// Company record schema version.
    pub schema_version: u8,
    /// Employee whose allowance is stored.
    pub employee_pubkey: String,
    /// Permanent allowance.
    pub allowance: AllowanceValue,
    /// Temporary allowance override, if one is active or awaiting expiry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporary_allowance: Option<TemporaryAllowance>,
    /// Explicitly selected funding order.
    #[serde(default)]
    pub funding_order: Vec<String>,
    /// Member who last changed the record.
    pub actor_pubkey: String,
    /// Relay acceptance time in RFC 3339 UTC.
    pub updated_at: String,
    /// Latest member-signed action event id.
    pub source_action_event_id: String,
}

/// Classified provider or Colony source attached to one reported turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceOfFunds {
    /// Runtime evidence confirms this turn used Colony credits.
    ColonyCredits,
    /// Runtime evidence identifies a provider subscription.
    ProviderSubscription,
    /// Runtime evidence identifies provider API-key billing.
    ProviderApiKey,
    /// Runtime did not provide source evidence.
    Unknown,
}

/// External cash cost category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalCostType {
    /// Existing provider subscription charge entered as evidence.
    Subscription,
    /// Existing provider credit top-up entered as evidence.
    CreditTopUp,
}

/// Stored type of an AI spend record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "recordType", rename_all = "snake_case", deny_unknown_fields)]
pub enum AiSpendRecord {
    /// Per-turn estimate linked to a private kind 44200 usage report.
    AgentTurn {
        /// Managed employee that ran the turn.
        employee_pubkey: String,
        /// Model reported by the decrypted harness usage record, if present.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Source kind 44200 event id.
        source_usage_event_id: String,
        /// Estimated amount in integer nano-USD, or absent when unreported.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        estimated_amount_nano_usd: Option<String>,
        /// This value is always true for kind 44200 derived cost.
        is_estimate: bool,
        /// Funding source identified by runtime evidence.
        source_of_funds: SourceOfFunds,
        /// Reported timestamp in RFC 3339 with an explicit UTC offset.
        reported_at: String,
    },
    /// Existing subscription or top-up entered by an owner or admin.
    ExternalCost {
        /// Provider label.
        provider: String,
        /// Plan or cost description.
        description: String,
        /// Subscription or provider top-up.
        cost_type: ExternalCostType,
        /// Actual cash amount in integer USD cents.
        actual_cash_cost_cents: String,
        /// Renewal or purchase date in YYYY-MM-DD.
        recorded_date: String,
    },
}

/// Requested mutation to one AI spend record (kind 47043).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AiSpendRecordAction {
    /// Company record schema version.
    pub schema_version: u8,
    /// Stable record id. Usage ids use `usage:<event-id>`; manual costs use
    /// `cost:<uuid>`.
    pub record_id: String,
    /// Create, edit, or remove the record.
    pub action: SpendRecordActionKind,
    /// Exact current record head event id; omitted only on initial record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Record contents for create and edit; remove preserves the prior value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<AiSpendRecord>,
}

/// Spend record action type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpendRecordActionKind {
    /// Create or update a record.
    Record,
    /// Mark an existing record removed without reversing any provider action.
    Remove,
}

/// Lifecycle status of a spend record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpendRecordStatus {
    /// Included in spend projections.
    Active,
    /// Hidden from active totals, retained as evidence.
    Removed,
}

/// Relay-signed current spend record (kind 30654).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AiSpendRecordHead {
    /// Company record schema version.
    pub schema_version: u8,
    /// Stable record id.
    pub record_id: String,
    /// Whether this is turn usage or an external cost.
    pub record: AiSpendRecord,
    /// Current record state.
    pub status: SpendRecordStatus,
    /// Member who last changed the record.
    pub actor_pubkey: String,
    /// Relay acceptance time in RFC 3339 UTC.
    pub updated_at: String,
    /// Latest member-signed action event id.
    pub source_action_event_id: String,
}

/// Read-time effective allowance derived from a head and injected timestamp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveAllowance {
    /// Effective amount and period.
    pub allowance: AllowanceValue,
    /// Whether the temporary override was effective at the supplied instant.
    pub temporary: bool,
}

/// Return the community-wide allowance coordinate for an employee.
pub fn employee_allowance_d_tag(employee_pubkey: &str) -> Result<String, CompanyRecordError> {
    if !is_hex_id(employee_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "employeePubkey must be a 64-character lowercase hex key",
        ));
    }
    Ok(format!("company:employee-allowance:{employee_pubkey}"))
}

/// Return the community-wide AI spend coordinate for a record id.
pub fn ai_spend_record_d_tag(record_id: &str) -> Result<String, CompanyRecordError> {
    if record_id.is_empty()
        || record_id.len() > 96
        || !record_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-'))
    {
        return Err(CompanyRecordError::Invalid("recordId is invalid"));
    }
    Ok(format!("company:ai-spend:{record_id}"))
}

/// Validate an employee allowance action.
pub fn validate_employee_allowance_action(
    action: &EmployeeAllowanceAction,
) -> Result<(), CompanyRecordError> {
    validate_employee_allowance_action_at(action, Utc::now())
}

fn validate_employee_allowance_action_at(
    action: &EmployeeAllowanceAction,
    now: DateTime<Utc>,
) -> Result<(), CompanyRecordError> {
    let expires_at = validate_employee_allowance_action_shape(action)?;
    if expires_at.is_some_and(|expires_at| expires_at <= now) {
        return Err(CompanyRecordError::Invalid(
            "temporary allowance expiry must be in the future",
        ));
    }
    Ok(())
}

fn validate_employee_allowance_action_shape(
    action: &EmployeeAllowanceAction,
) -> Result<Option<DateTime<Utc>>, CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let _ = employee_allowance_d_tag(&action.employee_pubkey)?;
    validate_event_id_option(action.expected_head_event_id.as_deref())?;
    validate_allowance_value(&action.allowance)?;
    let temporary_expires_at = if let Some(temporary) = &action.temporary_allowance {
        validate_allowance_value(&temporary.allowance)?;
        if temporary.allowance.period != action.allowance.period
            || parse_minor_unit(&temporary.allowance.amount_cents)
                < parse_minor_unit(&action.allowance.amount_cents)
        {
            return Err(CompanyRecordError::Invalid(
                "temporary allowance must be a raise for the permanent period",
            ));
        }
        Some(parse_timestamp(&temporary.expires_at)?)
    } else {
        None
    };
    if action.funding_order.len() > MAX_FUNDING_ORDER_ITEMS {
        return Err(CompanyRecordError::Invalid(
            "fundingOrder exceeds its item limit",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for source in &action.funding_order {
        let normalized = source.to_lowercase();
        if source.trim() != source
            || source.is_empty()
            || source.chars().count() > 64
            || source.contains('→')
            || source.chars().any(char::is_control)
            || !seen.insert(normalized)
        {
            return Err(CompanyRecordError::Invalid(
                "fundingOrder contains an invalid or duplicate source label",
            ));
        }
    }
    Ok(temporary_expires_at)
}

/// Validate a persisted employee allowance head.
pub fn validate_employee_allowance_head(
    head: &EmployeeAllowanceHead,
) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let _ = employee_allowance_d_tag(&head.employee_pubkey)?;
    let _ = employee_allowance_d_tag(&head.actor_pubkey)?;
    validate_event_id_option(Some(&head.source_action_event_id))?;
    validate_allowance_value(&head.allowance)?;
    if let Some(temporary) = &head.temporary_allowance {
        validate_allowance_value(&temporary.allowance)?;
        if temporary.allowance.period != head.allowance.period
            || parse_minor_unit(&temporary.allowance.amount_cents)
                < parse_minor_unit(&head.allowance.amount_cents)
        {
            return Err(CompanyRecordError::Invalid(
                "temporary allowance must be a raise for the permanent period",
            ));
        }
        parse_timestamp(&temporary.expires_at)?;
    }
    let action = EmployeeAllowanceAction {
        schema_version: head.schema_version,
        employee_pubkey: head.employee_pubkey.clone(),
        expected_head_event_id: None,
        allowance: head.allowance.clone(),
        temporary_allowance: head.temporary_allowance.clone(),
        funding_order: head.funding_order.clone(),
    };
    validate_employee_allowance_action_shape(&action).map(|_| ())
}

/// Validate an AI spend record action.
pub fn validate_ai_spend_record_action(
    action: &AiSpendRecordAction,
) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let _ = ai_spend_record_d_tag(&action.record_id)?;
    validate_event_id_option(action.expected_head_event_id.as_deref())?;
    match action.action {
        SpendRecordActionKind::Record => {
            let record = action
                .record
                .as_ref()
                .ok_or(CompanyRecordError::Invalid("record action requires record"))?;
            validate_spend_record(&action.record_id, record)?;
            match (action.expected_head_event_id.is_some(), record) {
                (false, AiSpendRecord::AgentTurn { .. })
                | (false, AiSpendRecord::ExternalCost { .. })
                | (true, AiSpendRecord::AgentTurn { .. })
                | (true, AiSpendRecord::ExternalCost { .. }) => {}
            }
        }
        SpendRecordActionKind::Remove => {
            if action.expected_head_event_id.is_none() || action.record.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "remove requires an exact head and omits record",
                ));
            }
        }
    }
    Ok(())
}

/// Validate a persisted AI spend record head.
pub fn validate_ai_spend_record_head(head: &AiSpendRecordHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let _ = ai_spend_record_d_tag(&head.record_id)?;
    let _ = employee_allowance_d_tag(&head.actor_pubkey)?;
    validate_event_id_option(Some(&head.source_action_event_id))?;
    validate_spend_record(&head.record_id, &head.record)
}

/// Derive an allowance effective at `now`, without a scheduled database write.
pub fn effective_allowance_at(
    head: &EmployeeAllowanceHead,
    now: DateTime<Utc>,
) -> EffectiveAllowance {
    if let Some(temporary) = head.temporary_allowance.as_ref() {
        if DateTime::parse_from_rfc3339(&temporary.expires_at)
            .ok()
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) > now)
        {
            return EffectiveAllowance {
                allowance: temporary.allowance.clone(),
                temporary: true,
            };
        }
    }
    EffectiveAllowance {
        allowance: head.allowance.clone(),
        temporary: false,
    }
}

/// Start of the allowance period containing `at`, using UTC calendar dates.
pub fn allowance_period_start(at: DateTime<Utc>, period: AllowancePeriod) -> DateTime<Utc> {
    let date = at.date_naive();
    let start = match period {
        AllowancePeriod::Day => date,
        AllowancePeriod::Week => {
            date - chrono::Duration::days(i64::from(date.weekday().num_days_from_monday()))
        }
        AllowancePeriod::Month => date.with_day(1).unwrap_or(date),
    };
    Utc.from_utc_datetime(&start.and_hms_opt(0, 0, 0).unwrap_or_else(|| at.naive_utc()))
}

/// Convert a finite nonnegative estimated USD cost to integer nano-USD.
pub fn estimated_usd_to_nano_usd(amount_usd: f64) -> Option<u64> {
    if !amount_usd.is_finite() || amount_usd < 0.0 {
        return None;
    }
    let scaled = (amount_usd * 1_000_000_000.0).round();
    if !scaled.is_finite() || scaled >= u64::MAX as f64 {
        return None;
    }
    Some(scaled as u64)
}

/// Convert USD cents to integer nano-USD with overflow checking.
pub fn cents_to_nano_usd(amount_cents: u64) -> Option<u64> {
    amount_cents.checked_mul(10_000_000)
}

/// Parse a canonical nonnegative integer minor-unit string.
pub fn parse_minor_unit(value: &str) -> Option<u64> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}

fn validate_spend_record(
    record_id: &str,
    record: &AiSpendRecord,
) -> Result<(), CompanyRecordError> {
    match record {
        AiSpendRecord::AgentTurn {
            employee_pubkey,
            model,
            source_usage_event_id,
            estimated_amount_nano_usd,
            is_estimate,
            reported_at,
            ..
        } => {
            let _ = employee_allowance_d_tag(employee_pubkey)?;
            if !is_estimate {
                return Err(CompanyRecordError::Invalid(
                    "agent turn cost must be labelled as an estimate",
                ));
            }
            if model
                .as_deref()
                .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 160)
            {
                return Err(CompanyRecordError::Invalid(
                    "model must be nonempty and within the length limit",
                ));
            }
            if estimated_amount_nano_usd
                .as_deref()
                .is_some_and(|amount| parse_minor_unit(amount).is_none())
            {
                return Err(CompanyRecordError::Invalid(
                    "estimatedAmountNanoUsd must be an integer decimal string",
                ));
            }
            if !is_hex_id(source_usage_event_id)
                || record_id != format!("usage:{source_usage_event_id}")
            {
                return Err(CompanyRecordError::Invalid(
                    "agent turn record id must match its source event",
                ));
            }
            parse_timestamp(reported_at)?;
        }
        AiSpendRecord::ExternalCost {
            provider,
            description,
            actual_cash_cost_cents,
            recorded_date,
            ..
        } => {
            let cost_id = record_id
                .strip_prefix("cost:")
                .and_then(|id| uuid::Uuid::parse_str(id).ok());
            if !record_id.starts_with("cost:")
                || record_id.len() != 41
                || cost_id.is_none_or(|id| id.to_string() != record_id[5..])
            {
                return Err(CompanyRecordError::Invalid(
                    "external cost record id must be cost:<uuid>",
                ));
            }
            for value in [provider, description] {
                if value.trim().is_empty() || value.chars().count() > MAX_SPEND_LABEL_CHARS {
                    return Err(CompanyRecordError::Invalid(
                        "external cost labels must be nonempty and within the length limit",
                    ));
                }
            }
            if parse_minor_unit(actual_cash_cost_cents).is_none() {
                return Err(CompanyRecordError::Invalid(
                    "actualCashCostCents must be an integer decimal string",
                ));
            }
            let date = chrono::NaiveDate::parse_from_str(recorded_date, "%Y-%m-%d")
                .map_err(|_| CompanyRecordError::Invalid("recordedDate must be YYYY-MM-DD"))?;
            if date.format("%Y-%m-%d").to_string() != recorded_date.as_str() {
                return Err(CompanyRecordError::Invalid(
                    "recordedDate must be YYYY-MM-DD",
                ));
            }
        }
    }
    Ok(())
}

fn validate_allowance_value(value: &AllowanceValue) -> Result<(), CompanyRecordError> {
    if parse_minor_unit(&value.amount_cents)
        .and_then(cents_to_nano_usd)
        .is_none()
    {
        return Err(CompanyRecordError::Invalid(
            "allowance amount exceeds integer accounting range",
        ));
    }
    Ok(())
}

fn validate_event_id_option(value: Option<&str>) -> Result<(), CompanyRecordError> {
    if value.is_some_and(|event_id| !is_hex_id(event_id)) {
        return Err(CompanyRecordError::Invalid(
            "event id must be 64 lowercase hexadecimal characters",
        ));
    }
    Ok(())
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, CompanyRecordError> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|_| CompanyRecordError::Invalid("timestamp must be RFC 3339 with an offset"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn allowance_head() -> EmployeeAllowanceHead {
        EmployeeAllowanceHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            employee_pubkey: "aa".repeat(32),
            allowance: AllowanceValue {
                amount_cents: "5000".into(),
                period: AllowancePeriod::Week,
            },
            temporary_allowance: Some(TemporaryAllowance {
                allowance: AllowanceValue {
                    amount_cents: "7500".into(),
                    period: AllowancePeriod::Week,
                },
                expires_at: "2026-10-01T00:00:00Z".into(),
            }),
            funding_order: vec![],
            actor_pubkey: "bb".repeat(32),
            updated_at: "2026-09-30T00:00:00Z".into(),
            source_action_event_id: "cc".repeat(32),
        }
    }

    fn allowance_action(expires_at: &str) -> EmployeeAllowanceAction {
        EmployeeAllowanceAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            employee_pubkey: "aa".repeat(32),
            expected_head_event_id: None,
            allowance: AllowanceValue {
                amount_cents: "100".into(),
                period: AllowancePeriod::Week,
            },
            temporary_allowance: Some(TemporaryAllowance {
                allowance: AllowanceValue {
                    amount_cents: "200".into(),
                    period: AllowancePeriod::Week,
                },
                expires_at: expires_at.into(),
            }),
            funding_order: vec![],
        }
    }

    #[test]
    fn temporary_allowance_reverts_by_injected_clock() {
        let head = allowance_head();
        let before = Utc.with_ymd_and_hms(2026, 9, 30, 23, 59, 59).unwrap();
        let after = Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap();
        assert!(effective_allowance_at(&head, before).temporary);
        assert_eq!(
            effective_allowance_at(&head, after).allowance.amount_cents,
            "5000"
        );
    }

    #[test]
    fn period_start_uses_utc_calendar_boundaries() {
        let at = Utc.with_ymd_and_hms(2026, 9, 30, 12, 30, 0).unwrap();
        assert_eq!(
            allowance_period_start(at, AllowancePeriod::Week),
            Utc.with_ymd_and_hms(2026, 9, 28, 0, 0, 0).unwrap()
        );
        assert_eq!(
            allowance_period_start(at, AllowancePeriod::Month),
            Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn money_conversion_uses_integer_nanodollars_and_checks_range() {
        assert_eq!(cents_to_nano_usd(1), Some(10_000_000));
        assert_eq!(estimated_usd_to_nano_usd(0.000_000_001), Some(1));
        assert_eq!(estimated_usd_to_nano_usd(f64::INFINITY), None);
        assert_eq!(cents_to_nano_usd(u64::MAX), None);
    }

    #[test]
    fn turn_record_requires_estimate_and_source_id_identity() {
        let action = AiSpendRecordAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            record_id: format!("usage:{}", "dd".repeat(32)),
            action: SpendRecordActionKind::Record,
            expected_head_event_id: None,
            record: Some(AiSpendRecord::AgentTurn {
                employee_pubkey: "aa".repeat(32),
                model: Some("model-a".into()),
                source_usage_event_id: "dd".repeat(32),
                estimated_amount_nano_usd: Some("10".into()),
                is_estimate: true,
                source_of_funds: SourceOfFunds::Unknown,
                reported_at: "2026-09-30T00:00:00Z".into(),
            }),
        };
        assert!(validate_ai_spend_record_action(&action).is_ok());
        let mut unlabelled = action.clone();
        if let Some(AiSpendRecord::AgentTurn { is_estimate, .. }) = unlabelled.record.as_mut() {
            *is_estimate = false;
        }
        assert!(validate_ai_spend_record_action(&unlabelled).is_err());
    }

    #[test]
    fn funding_order_accepts_explicit_labels_and_rejects_duplicates() {
        let mut action = EmployeeAllowanceAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            employee_pubkey: "aa".repeat(32),
            expected_head_event_id: None,
            allowance: AllowanceValue {
                amount_cents: "100".into(),
                period: AllowancePeriod::Week,
            },
            temporary_allowance: None,
            funding_order: vec!["Provider subscription".into(), "Colony credits".into()],
        };
        assert!(validate_employee_allowance_action(&action).is_ok());
        action.funding_order.push("provider subscription".into());
        assert!(validate_employee_allowance_action(&action).is_err());
    }

    #[test]
    fn expired_temporary_allowance_is_rejected_by_production_validator() {
        let action = allowance_action("2020-01-01T00:00:00Z");
        assert!(validate_employee_allowance_action(&action).is_err());
    }

    #[test]
    fn temporary_allowance_expiry_must_be_after_injected_validation_time() {
        let expiry = || Utc.with_ymd_and_hms(2026, 10, 2, 2, 0, 0).unwrap();
        let action = allowance_action(&expiry().to_rfc3339());
        let before = expiry() - chrono::Duration::seconds(1);
        let at_expiry = expiry();
        let after = expiry() + chrono::Duration::seconds(1);

        assert!(validate_employee_allowance_action_at(&action, before).is_ok());
        assert!(validate_employee_allowance_action_at(&action, at_expiry).is_err());
        assert!(validate_employee_allowance_action_at(&action, after).is_err());
    }

    #[test]
    fn expired_temporary_allowance_head_remains_readable_after_reversion() {
        let mut head = allowance_head();
        head.temporary_allowance.as_mut().unwrap().expires_at = "2000-01-01T00:00:00Z".into();

        assert!(validate_employee_allowance_head(&head).is_ok());
    }
}
