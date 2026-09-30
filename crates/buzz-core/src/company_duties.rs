//! Typed duty records and pure schedule contract validation.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_records::{CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Maximum length of a duty title, in characters.
pub const MAX_DUTY_TITLE_CHARS: usize = 180;
/// Maximum length of a readable duty schedule, in characters.
pub const MAX_DUTY_SCHEDULE_CHARS: usize = 180;
/// Maximum length of duty instructions, in characters.
pub const MAX_DUTY_INSTRUCTIONS_CHARS: usize = 4000;

/// Canonical duty definition carried by a proposal or update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DutyProposal {
    /// Schema version.
    pub schema_version: u8,
    /// Stable duty UUID.
    pub duty_id: Uuid,
    /// The single employee assigned to this duty.
    pub employee_pubkey: String,
    /// Human-readable duty title.
    pub title: String,
    /// Readable recurrence shown to people.
    pub schedule_text: String,
    /// Canonical five-field cron schedule generated from scheduleText.
    pub schedule_cron: String,
    /// IANA timezone used by the schedule engine.
    pub time_zone: String,
    /// Channel where the duty workflow runs.
    pub channel_id: Uuid,
    /// Instructions supplied to the assigned employee on each run.
    pub instructions: String,
}

/// Supported lifecycle operations for a duty after its proposal is approved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DutyActionKind {
    /// Replace the definition while retaining its identity.
    Update,
    /// Stop future schedule runs.
    Pause,
    /// Re-enable future schedule runs.
    Resume,
    /// Tombstone the duty and disable its workflow.
    Delete,
}

/// Member-signed duty mutation (kind 47044).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DutyAction {
    /// Schema version.
    pub schema_version: u8,
    /// Duty being changed.
    pub duty_id: Uuid,
    /// Requested transition.
    pub action: DutyActionKind,
    /// Exact current duty head event id.
    pub expected_head_event_id: String,
    /// Full replacement proposal for update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<DutyProposal>,
    /// Optional operator explanation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Current state of an approved duty.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DutyStatus {
    /// Schedule may start workflow runs.
    Active,
    /// Schedule is temporarily disabled.
    Paused,
    /// Deleted from the profile while history is retained.
    Deleted,
}

/// Relay-authored canonical duty head (kind 30655).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DutyHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable duty UUID.
    pub duty_id: Uuid,
    /// Current duty definition.
    pub proposal: DutyProposal,
    /// Current duty lifecycle state.
    pub status: DutyStatus,
    /// Member or managed employee who proposed the duty.
    pub proposed_by_pubkey: String,
    /// Owner or admin who approved the duty proposal.
    pub approved_by_pubkey: String,
    /// Approval timestamp in RFC 3339 format.
    pub approved_at: String,
    /// Ask that created this duty.
    pub source_ask_id: Uuid,
    /// Channel containing the proposal ask.
    pub source_ask_channel_id: Uuid,
    /// Hash of the active workflow definition.
    pub workflow_definition_hash: String,
    /// Creation timestamp in RFC 3339 format.
    pub created_at: String,
    /// Last record update timestamp in RFC 3339 format.
    pub updated_at: String,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// Build the canonical community-wide duty d-tag.
pub fn duty_d_tag(duty_id: Uuid) -> String {
    format!("company:duty:{duty_id}")
}

/// Validate a duty definition and confirm its displayed schedule matches its cron.
pub fn validate_duty_proposal(proposal: &DutyProposal) -> Result<(), CompanyRecordError> {
    if proposal.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    require_text(
        &proposal.title,
        MAX_DUTY_TITLE_CHARS,
        "title is required, 180 characters at most",
    )?;
    if !is_hex_id(&proposal.employee_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "employeePubkey must be a lowercase public key",
        ));
    }
    if proposal.duty_id.is_nil() || proposal.channel_id.is_nil() {
        return Err(CompanyRecordError::Invalid(
            "dutyId and channelId must be non-nil UUIDs",
        ));
    }
    if proposal.schedule_text.chars().count() > MAX_DUTY_SCHEDULE_CHARS {
        return Err(CompanyRecordError::Invalid(
            "scheduleText is 180 characters at most",
        ));
    }
    let parsed_cron = parse_readable_schedule(&proposal.schedule_text).ok_or(
        CompanyRecordError::Invalid("scheduleText is not a supported recurring schedule"),
    )?;
    if parsed_cron != proposal.schedule_cron {
        return Err(CompanyRecordError::Invalid(
            "scheduleCron must match the parsed scheduleText",
        ));
    }
    if !is_timezone_label(&proposal.time_zone) {
        return Err(CompanyRecordError::Invalid(
            "timeZone must be an IANA timezone name",
        ));
    }
    require_text(
        &proposal.instructions,
        MAX_DUTY_INSTRUCTIONS_CHARS,
        "instructions are required, 4000 characters at most",
    )?;
    Ok(())
}

/// Validate relay-authored duty identity, approval provenance and timestamps.
pub fn validate_duty_head(head: &DutyHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.duty_id.is_nil()
        || head.proposal.duty_id != head.duty_id
        || head.source_ask_id.is_nil()
        || head.source_ask_channel_id.is_nil()
        || !is_hex_id(&head.proposed_by_pubkey)
        || !is_hex_id(&head.approved_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || !is_hex_id(&head.workflow_definition_hash)
        || !is_rfc3339(&head.approved_at)
        || !is_rfc3339(&head.created_at)
        || !is_rfc3339(&head.updated_at)
    {
        return Err(CompanyRecordError::Invalid(
            "duty head identity, approval and timestamps must be valid",
        ));
    }
    validate_duty_proposal(&head.proposal)?;
    Ok(())
}

/// Validate a member-signed duty lifecycle action.
pub fn validate_duty_action(action: &DutyAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if action.duty_id.is_nil() || !is_hex_id(&action.expected_head_event_id) {
        return Err(CompanyRecordError::Invalid(
            "dutyId and expectedHeadEventId are required",
        ));
    }
    if action
        .reason
        .as_ref()
        .is_some_and(|reason| reason.chars().count() > 1000)
    {
        return Err(CompanyRecordError::Invalid(
            "reason is 1000 characters at most",
        ));
    }
    match (action.action, action.proposal.as_ref()) {
        (DutyActionKind::Update, Some(proposal)) => {
            validate_duty_proposal(proposal)?;
            if proposal.duty_id != action.duty_id {
                return Err(CompanyRecordError::Invalid(
                    "update proposal dutyId must match action dutyId",
                ));
            }
        }
        (DutyActionKind::Update, None) => {
            return Err(CompanyRecordError::Invalid("update needs a proposal"));
        }
        (_, Some(_)) => {
            return Err(CompanyRecordError::Invalid(
                "only update carries a proposal",
            ));
        }
        (_, None) => {}
    }
    Ok(())
}

/// Check a duty d-tag against its stable UUID.
pub fn validate_duty_d_tag(d_tag: &str, duty_id: Uuid) -> Result<(), CompanyRecordError> {
    if d_tag == duty_d_tag(duty_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Convert a supported readable recurrence to the canonical five-field cron form.
pub fn parse_readable_schedule(schedule: &str) -> Option<String> {
    let words = schedule.split_whitespace().collect::<Vec<_>>();
    if words.first()?.eq_ignore_ascii_case("every") == false {
        return None;
    }
    let (hour, minute, day_of_month, day_of_week) = match words.as_slice() {
        [_, day, at, time] if at.eq_ignore_ascii_case("at") => {
            let (hour, minute) = parse_time(time)?;
            if day.eq_ignore_ascii_case("day") {
                (hour, minute, "*".to_owned(), "*".to_owned())
            } else if day.eq_ignore_ascii_case("weekday") {
                (hour, minute, "*".to_owned(), "1-5".to_owned())
            } else if let Some(weekday) = weekday_number(day) {
                (hour, minute, "*".to_owned(), weekday.to_string())
            } else {
                return None;
            }
        }
        [_, day, time] => {
            let (hour, minute) = parse_time(time)?;
            let weekday = weekday_number(day)?;
            (hour, minute, "*".to_owned(), weekday.to_string())
        }
        [_, month, on, day, number, at, time]
            if month.eq_ignore_ascii_case("month")
                && on.eq_ignore_ascii_case("on")
                && day.eq_ignore_ascii_case("day")
                && at.eq_ignore_ascii_case("at") =>
        {
            let (hour, minute) = parse_time(time)?;
            let day_of_month = number.parse::<u8>().ok()?;
            if !(1..=31).contains(&day_of_month) {
                return None;
            }
            (hour, minute, day_of_month.to_string(), "*".to_owned())
        }
        _ => return None,
    };
    Some(format!("{minute} {hour} {day_of_month} * {day_of_week}"))
}

fn parse_time(value: &str) -> Option<(u8, u8)> {
    let (hour, minute) = value.split_once(':')?;
    if hour.len() != 2 || minute.len() != 2 {
        return None;
    }
    let hour = hour.parse::<u8>().ok()?;
    let minute = minute.parse::<u8>().ok()?;
    (hour <= 23 && minute <= 59).then_some((hour, minute))
}

fn weekday_number(value: &str) -> Option<u8> {
    match value.to_ascii_lowercase().as_str() {
        "sunday" => Some(0),
        "monday" => Some(1),
        "tuesday" => Some(2),
        "wednesday" => Some(3),
        "thursday" => Some(4),
        "friday" => Some(5),
        "saturday" => Some(6),
        _ => None,
    }
}

fn is_timezone_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'-' | b'+'))
}

fn is_hex_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_rfc3339(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

fn require_text(value: &str, max: usize, rule: &'static str) -> Result<(), CompanyRecordError> {
    if value.trim().is_empty() || value.chars().count() > max {
        Err(CompanyRecordError::Invalid(rule))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_schedules_convert_without_using_fixture_defaults() {
        assert_eq!(
            parse_readable_schedule("Every Monday at 08:00").as_deref(),
            Some("0 8 * * 1")
        );
        assert_eq!(
            parse_readable_schedule("Every weekday at 17:30").as_deref(),
            Some("30 17 * * 1-5")
        );
        assert_eq!(
            parse_readable_schedule("Every month on day 15 at 09:00").as_deref(),
            Some("0 9 15 * *")
        );
        assert!(parse_readable_schedule("Every Monday at 08:00").is_some());
    }

    #[test]
    fn readable_schedules_reject_invalid_time_and_unknown_recurrence() {
        assert!(parse_readable_schedule("Every day at 24:00").is_none());
        assert!(parse_readable_schedule("Tomorrow at 08:00").is_none());
    }

    #[test]
    fn duty_d_tag_is_stable_and_namespaced() {
        let id = Uuid::parse_str("d14e1a58-a238-4a61-b0c7-9907cf8e659c").unwrap();
        assert_eq!(
            duty_d_tag(id),
            "company:duty:d14e1a58-a238-4a61-b0c7-9907cf8e659c"
        );
        assert!(validate_duty_d_tag(&duty_d_tag(id), id).is_ok());
    }
}
