//! Typed event builders for Colony employee allowances and AI spend records.
//!
//! Allowance and spend mutations are company-wide member actions. Builders
//! include a `d` coordinate and omit the channel `h` tag.

use crate::SdkError;
use buzz_core::company_spend::{
    ai_spend_record_d_tag, employee_allowance_d_tag, validate_ai_spend_record_action,
    validate_employee_allowance_action, AiSpendRecord, AiSpendRecordAction,
    EmployeeAllowanceAction,
};
use buzz_core::kind::{KIND_AI_SPEND_RECORD_ACTION, KIND_EMPLOYEE_AI_ALLOWANCE_ACTION};
use nostr::{EventBuilder, Kind, Tag};

/// Build a member-signed employee allowance action.
pub fn build_employee_allowance_action(
    action: &EmployeeAllowanceAction,
) -> Result<EventBuilder, SdkError> {
    validate_employee_allowance_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("employee allowance action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "employee allowance action serialization failed: {error}"
        ))
    })?;
    let d_tag = employee_allowance_d_tag(&action.employee_pubkey)
        .map_err(|error| SdkError::InvalidInput(error.to_string()))?;
    let d = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let employee = Tag::parse(["p", action.employee_pubkey.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    // An employee setting its own allowance signs as the employee; keep
    // the `p` tag the relay requires instead of letting nostr scrub it.
    Ok(EventBuilder::new(
        Kind::Custom(KIND_EMPLOYEE_AI_ALLOWANCE_ACTION as u16),
        content,
    )
    .tags([d, employee])
    .allow_self_tagging())
}

/// Build a member-signed AI spend record action.
pub fn build_ai_spend_record_action(
    action: &AiSpendRecordAction,
) -> Result<EventBuilder, SdkError> {
    validate_ai_spend_record_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("AI spend record action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "AI spend record action serialization failed: {error}"
        ))
    })?;
    let d_tag = ai_spend_record_d_tag(&action.record_id)
        .map_err(|error| SdkError::InvalidInput(error.to_string()))?;
    let d = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let builder =
        EventBuilder::new(Kind::Custom(KIND_AI_SPEND_RECORD_ACTION as u16), content).tag(d);
    match action.record.as_ref() {
        Some(AiSpendRecord::AgentTurn {
            employee_pubkey, ..
        }) => {
            let employee = Tag::parse(["p", employee_pubkey.as_str()])
                .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
            Ok(builder.tag(employee).allow_self_tagging())
        }
        _ => Ok(builder),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use buzz_core::company_spend::{AllowancePeriod, AllowanceValue};
    use nostr::Keys;

    #[test]
    fn allowance_action_keeps_the_employee_p_tag_when_the_employee_signs() {
        let employee = Keys::generate();
        let employee_hex = employee.public_key().to_hex();
        let action = EmployeeAllowanceAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            employee_pubkey: employee_hex.clone(),
            expected_head_event_id: None,
            allowance: AllowanceValue {
                amount_cents: "5000".into(),
                period: AllowancePeriod::Month,
            },
            temporary_allowance: None,
            funding_order: Vec::new(),
        };
        let event = build_employee_allowance_action(&action)
            .expect("build allowance action")
            .sign_with_keys(&employee)
            .expect("sign allowance action");
        assert_eq!(event.tags.len(), 2);
        assert!(event.tags.iter().any(
            |tag| tag.kind().to_string() == "p" && tag.content() == Some(employee_hex.as_str())
        ));
    }
}
