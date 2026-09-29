//! Typed company work suggestions and watchdog configuration records.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::business_records::{
    validate_hex_reference, validate_utc_rfc3339, BusinessRecordError, CompanyWorkItemInput,
    BUSINESS_RECORD_SCHEMA_VERSION,
};

/// D-tag for a persisted commitment suggestion.
pub fn company_work_suggestion_d_tag(suggestion_id: Uuid) -> String {
    format!("company:work-suggestion:{suggestion_id}")
}

/// D-tag for a watchdog configuration belonging to a work item.
pub fn company_work_watchdog_d_tag(work_item_id: Uuid) -> String {
    format!("company:work-watchdog:{work_item_id}")
}

/// Validate a work tracking head coordinate.
pub fn validate_company_work_tracking_d_tag(
    value: &str,
    record_id: Uuid,
    record_type: CompanyWorkTrackingRecordType,
) -> Result<(), BusinessRecordError> {
    let expected = match record_type {
        CompanyWorkTrackingRecordType::CommitmentSuggestion => {
            company_work_suggestion_d_tag(record_id)
        }
        CompanyWorkTrackingRecordType::WatchdogConfiguration => {
            company_work_watchdog_d_tag(record_id)
        }
    };
    if value == expected {
        Ok(())
    } else {
        Err(BusinessRecordError::Invalid(
            "company work tracking d tag does not match its record id",
        ))
    }
}

/// Discriminator for the shared company work tracking head kind.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyWorkTrackingRecordType {
    /// A persisted proposal sourced from a channel message.
    CommitmentSuggestion,
    /// Per-work watchdog settings.
    WatchdogConfiguration,
}

/// Replaceable relay-signed head for either company work tracking record.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "recordType", rename_all = "snake_case")]
pub enum CompanyWorkTrackingHead {
    /// Persisted commitment proposal and its lifecycle state.
    CommitmentSuggestion(Box<CompanyWorkSuggestionHead>),
    /// Business-scoped check-in settings for one work item.
    WatchdogConfiguration(CompanyWorkWatchdogHead),
}

/// State stored for an explicit commitment suggestion.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWorkSuggestionHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable suggestion UUID.
    pub suggestion_id: Uuid,
    /// Source message event id.
    pub source_event_id: String,
    /// Channel that contains the source message.
    pub source_channel_id: Uuid,
    /// Proposing member or managed agent.
    pub proposed_by_pubkey: String,
    /// Explicit expiry, if one was supplied by the proposer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Proposed company work fields.
    pub work_item: CompanyWorkItemInput,
    /// Current lifecycle state.
    pub status: CompanyWorkSuggestionStatus,
    /// Work item created by acceptance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_work_item_id: Option<Uuid>,
    /// Member action that produced this head.
    pub source_action_event_id: String,
}

/// Lifecycle state of a commitment suggestion.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyWorkSuggestionStatus {
    /// Waiting for a person to accept or dismiss it.
    Pending,
    /// Accepted and converted into a company work item.
    Accepted,
    /// Explicitly dismissed by a person.
    Dismissed,
    /// Explicitly expired after its expiry time.
    Expired,
}

/// User-supplied content when creating a commitment suggestion.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWorkSuggestionInput {
    /// Source message event id.
    pub source_event_id: String,
    /// Explicit expiry, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Proposed work fields. The relay supplies source provenance.
    pub work_item: CompanyWorkItemInput,
}

/// Explicit watchdog condition selected by a member.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyWorkCheckWhen {
    /// Check after a chosen quiet interval.
    NoUpdate,
    /// Check after the saved due date passes.
    DueDatePasses,
    /// Check after an explicit worker failure report.
    WorkerReportsFailure,
}

/// Saved watchdog schedule and recipients.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWorkWatchdogConfig {
    /// The explicitly selected check condition.
    pub check_when: CompanyWorkCheckWhen,
    /// Explicit positive check-in interval in seconds. Never defaulted.
    pub check_interval_seconds: u32,
    /// Optional member to ask first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_first_pubkey: Option<String>,
    /// Optional escalation recipient.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalate_to_pubkey: Option<String>,
    /// Explicit optional escalation interval in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalation_interval_seconds: Option<u32>,
}

/// Relay-signed watchdog head. A missing head means OFF.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWorkWatchdogHead {
    /// Schema version.
    pub schema_version: u8,
    /// Work item UUID.
    pub work_item_id: Uuid,
    /// Whether the saved watchdog is enabled.
    pub enabled: bool,
    /// Explicitly saved settings. Absent when the watchdog is disabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<CompanyWorkWatchdogConfig>,
    /// Member action that produced this head.
    pub source_action_event_id: String,
}

/// Supported company work tracking state changes.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyWorkTrackingActionKind {
    /// Persist a new source-backed suggestion.
    Propose,
    /// Accept a pending suggestion and create work.
    Accept,
    /// Dismiss a pending suggestion.
    Dismiss,
    /// Expire a pending suggestion after expiresAt.
    Expire,
    /// Save an enabled watchdog configuration.
    Configure,
    /// Turn a saved watchdog off.
    Disable,
}

/// Member-signed command for a company work tracking record.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWorkTrackingAction {
    /// Schema version.
    pub schema_version: u8,
    /// Operation.
    pub action: CompanyWorkTrackingActionKind,
    /// Suggestion UUID for suggestion operations, work-item UUID otherwise.
    pub record_id: Uuid,
    /// Current kind 30652 head id for mutations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Proposal fields on propose.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<CompanyWorkSuggestionInput>,
    /// New work-item UUID on accept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_work_item_id: Option<Uuid>,
    /// Explicit settings on configure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<CompanyWorkWatchdogConfig>,
}

/// Validate a tracking command payload and its exact-head precondition.
pub fn validate_company_work_tracking_action(
    action: &CompanyWorkTrackingAction,
) -> Result<(), BusinessRecordError> {
    if action.schema_version != BUSINESS_RECORD_SCHEMA_VERSION || action.record_id.is_nil() {
        return Err(BusinessRecordError::Invalid(
            "company work tracking schemaVersion and recordId are invalid",
        ));
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        validate_hex_reference(expected)?;
    }
    let empty_payload = action.suggestion.is_none()
        && action.accepted_work_item_id.is_none()
        && action.config.is_none();
    match action.action {
        CompanyWorkTrackingActionKind::Propose => {
            if action.expected_head_event_id.is_some()
                || action.accepted_work_item_id.is_some()
                || action.config.is_some()
            {
                return Err(BusinessRecordError::Invalid(
                    "propose must contain only a suggestion and omit expectedHeadEventId",
                ));
            }
            let suggestion = action
                .suggestion
                .as_ref()
                .ok_or(BusinessRecordError::Invalid("suggestion is required"))?;
            validate_hex_reference(&suggestion.source_event_id)?;
            if let Some(expires_at) = suggestion.expires_at.as_deref() {
                validate_utc_rfc3339(expires_at)?;
            }
            let work_action = crate::business_records::CompanyWorkItemAction {
                schema_version: action.schema_version,
                work_item_id: suggestion.work_item.work_item_id,
                action: crate::business_records::CompanyWorkItemActionKind::Create,
                expected_head_event_id: None,
                head: Some(suggestion.work_item.clone()),
                status: None,
                reason: None,
                verification: None,
                due_at: None,
            };
            crate::business_records::validate_company_work_item_action(&work_action)?;
        }
        CompanyWorkTrackingActionKind::Accept => {
            require_expected_head(action)?;
            if action.suggestion.is_some()
                || action.config.is_some()
                || action
                    .accepted_work_item_id
                    .is_none_or(|work_item_id| work_item_id.is_nil())
            {
                return Err(BusinessRecordError::Invalid(
                    "accept must contain only a valid acceptedWorkItemId and expectedHeadEventId",
                ));
            }
        }
        CompanyWorkTrackingActionKind::Dismiss | CompanyWorkTrackingActionKind::Expire => {
            require_expected_head(action)?;
            if !empty_payload {
                return Err(BusinessRecordError::Invalid(
                    "dismiss and expire cannot contain payloads",
                ));
            }
        }
        CompanyWorkTrackingActionKind::Configure => {
            if action.suggestion.is_some() || action.accepted_work_item_id.is_some() {
                return Err(BusinessRecordError::Invalid(
                    "configure must contain only a watchdog config",
                ));
            }
            validate_watchdog_config(
                action
                    .config
                    .as_ref()
                    .ok_or(BusinessRecordError::Invalid("watchdog config is required"))?,
            )?;
        }
        CompanyWorkTrackingActionKind::Disable => {
            require_expected_head(action)?;
            if !empty_payload {
                return Err(BusinessRecordError::Invalid(
                    "disable cannot contain payloads",
                ));
            }
        }
    }
    Ok(())
}

fn validate_watchdog_config(config: &CompanyWorkWatchdogConfig) -> Result<(), BusinessRecordError> {
    if config.check_interval_seconds == 0 {
        return Err(BusinessRecordError::Invalid(
            "watchdog checkIntervalSeconds must be explicitly positive",
        ));
    }
    if config
        .escalation_interval_seconds
        .is_some_and(|seconds| seconds == 0)
    {
        return Err(BusinessRecordError::Invalid(
            "watchdog escalationIntervalSeconds must be positive when supplied",
        ));
    }
    if let Some(pubkey) = config.ask_first_pubkey.as_deref() {
        validate_hex_reference(pubkey)?;
    }
    if let Some(pubkey) = config.escalate_to_pubkey.as_deref() {
        validate_hex_reference(pubkey)?;
    }
    Ok(())
}

fn require_expected_head(action: &CompanyWorkTrackingAction) -> Result<(), BusinessRecordError> {
    if action.expected_head_event_id.is_some() {
        Ok(())
    } else {
        Err(BusinessRecordError::Invalid(
            "expectedHeadEventId is required for this tracking action",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watchdog_enable_requires_an_explicit_positive_interval() {
        let action = CompanyWorkTrackingAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            action: CompanyWorkTrackingActionKind::Configure,
            record_id: Uuid::from_u128(7),
            expected_head_event_id: Some("ab".repeat(32)),
            suggestion: None,
            accepted_work_item_id: None,
            config: Some(CompanyWorkWatchdogConfig {
                check_when: CompanyWorkCheckWhen::NoUpdate,
                check_interval_seconds: 0,
                ask_first_pubkey: None,
                escalate_to_pubkey: None,
                escalation_interval_seconds: None,
            }),
        };
        assert!(validate_company_work_tracking_action(&action).is_err());
        let mut explicit = action;
        explicit
            .config
            .as_mut()
            .expect("config")
            .check_interval_seconds = 86_400;
        assert_eq!(validate_company_work_tracking_action(&explicit), Ok(()));
    }

    #[test]
    fn tracking_coordinates_are_type_scoped() {
        let id = Uuid::from_u128(11);
        assert_eq!(
            validate_company_work_tracking_d_tag(
                &company_work_suggestion_d_tag(id),
                id,
                CompanyWorkTrackingRecordType::CommitmentSuggestion,
            ),
            Ok(())
        );
        assert!(validate_company_work_tracking_d_tag(
            &company_work_watchdog_d_tag(id),
            id,
            CompanyWorkTrackingRecordType::CommitmentSuggestion,
        )
        .is_err());
    }
}
