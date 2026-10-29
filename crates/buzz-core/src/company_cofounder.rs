//! Per-company co-founder mode settings.
//!
//! One relay-signed head per company (`company:cofounder`) holds the switch,
//! the money preference and the approval switches. It is a separate record from
//! every older company record, so a desktop that predates it still loads its
//! existing lists.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored co-founder settings head (community-wide).
pub const KIND_COFOUNDER_HEAD: u32 = crate::kind::KIND_COFOUNDER_HEAD;
/// Member co-founder settings mutation, brokered and community-wide.
pub const KIND_COFOUNDER_ACTION: u32 = crate::kind::KIND_COFOUNDER_ACTION;
/// The single d-tag of the co-founder settings record.
pub const COFOUNDER_D_TAG: &str = "company:cofounder";

/// How the co-founder weighs price against quality when it picks a provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoneyPreference {
    /// Prefer the cheapest option that does the job.
    CheapestFirst,
    /// Prefer the best option, whatever it costs within approved limits.
    BestOption,
}

/// Switches that make the co-founder ask before it acts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalSwitches {
    /// Ask before every hire, not only hires that spend.
    pub approve_every_hire: bool,
    /// Ask before any playbook changes.
    pub approve_playbook_changes: bool,
    /// Ask before every Discovery campaign.
    pub approve_every_discovery_campaign: bool,
}

/// The settings a company chooses for co-founder mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CofounderSettings {
    /// Whether co-founder mode is on for this company.
    pub enabled: bool,
    /// Price versus quality preference.
    pub money_preference: MoneyPreference,
    /// Ask-before-acting switches.
    pub approval_switches: ApprovalSwitches,
}

impl Default for CofounderSettings {
    /// Off, cheapest first, no extra approvals.
    fn default() -> Self {
        Self {
            enabled: false,
            money_preference: MoneyPreference::CheapestFirst,
            approval_switches: ApprovalSwitches::default(),
        }
    }
}

/// Member-signed co-founder settings change (kind 47060).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CofounderAction {
    /// Schema version.
    pub schema_version: u8,
    /// The full settings to store. Every change replaces the whole record.
    pub settings: CofounderSettings,
    /// Exact current head event id, omitted only while no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Relay-authored canonical co-founder settings head (kind 30670).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CofounderHead {
    /// Schema version.
    pub schema_version: u8,
    /// Current settings.
    pub settings: CofounderSettings,
    /// Owner or admin who made the last change.
    pub updated_by_pubkey: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

/// Validate a co-founder settings action.
pub fn validate_cofounder_action(action: &CofounderAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    Ok(())
}

/// Validate a relay-authored co-founder settings head.
pub fn validate_cofounder_head(head: &CofounderHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&head.updated_by_pubkey) || head.updated_at < 0 {
        return Err(CompanyRecordError::Invalid(
            "co-founder head needs a valid updater and time",
        ));
    }
    Ok(())
}

/// Check that a d-tag is the co-founder settings coordinate.
pub fn validate_cofounder_d_tag(tag: &str) -> Result<(), CompanyRecordError> {
    if tag == COFOUNDER_D_TAG {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::company_records::parse_company_command;

    fn action(version: u8) -> CofounderAction {
        CofounderAction {
            schema_version: version,
            settings: CofounderSettings::default(),
            expected_head_event_id: None,
        }
    }

    #[test]
    fn cofounder_defaults_are_off_and_cheapest_first() {
        let settings = CofounderSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.money_preference, MoneyPreference::CheapestFirst);
        assert_eq!(settings.approval_switches, ApprovalSwitches::default());
        assert!(!settings.approval_switches.approve_every_hire);
        assert!(!settings.approval_switches.approve_playbook_changes);
        assert!(!settings.approval_switches.approve_every_discovery_campaign);
    }

    #[test]
    fn cofounder_action_rejects_unknown_fields() {
        let json = r#"{"schemaVersion":1,"settings":{"enabled":true,"moneyPreference":"best_option","approvalSwitches":{"approveEveryHire":false,"approvePlaybookChanges":false,"approveEveryDiscoveryCampaign":false}},"surprise":1}"#;
        assert!(serde_json::from_str::<CofounderAction>(json).is_err());
        let nested = r#"{"schemaVersion":1,"settings":{"enabled":true,"moneyPreference":"best_option","approvalSwitches":{"approveEveryHire":false,"approvePlaybookChanges":false,"approveEveryDiscoveryCampaign":false,"surprise":true}}}"#;
        assert!(serde_json::from_str::<CofounderAction>(nested).is_err());
        // The same shape without the extra key parses.
        let ok = r#"{"schemaVersion":1,"settings":{"enabled":true,"moneyPreference":"best_option","approvalSwitches":{"approveEveryHire":false,"approvePlaybookChanges":false,"approveEveryDiscoveryCampaign":false}}}"#;
        assert!(serde_json::from_str::<CofounderAction>(ok).is_ok());
    }

    #[test]
    fn cofounder_action_rejects_wrong_schema_version() {
        assert!(validate_cofounder_action(&action(COMPANY_RECORD_SCHEMA_VERSION)).is_ok());
        assert_eq!(
            validate_cofounder_action(&action(2)),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn cofounder_action_parses_through_the_company_command_parser() {
        let content = serde_json::to_string(&action(COMPANY_RECORD_SCHEMA_VERSION)).unwrap();
        assert!(parse_company_command(KIND_COFOUNDER_ACTION, &content).is_ok());
        let wrong = serde_json::to_string(&action(2)).unwrap();
        assert_eq!(
            parse_company_command(KIND_COFOUNDER_ACTION, &wrong),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn cofounder_action_rejects_a_malformed_expected_head() {
        let mut bad = action(COMPANY_RECORD_SCHEMA_VERSION);
        bad.expected_head_event_id = Some("not-an-event-id".into());
        assert!(validate_cofounder_action(&bad).is_err());
        bad.expected_head_event_id = Some("a".repeat(64));
        assert!(validate_cofounder_action(&bad).is_ok());
    }

    #[test]
    fn cofounder_d_tag_is_a_single_coordinate() {
        assert!(validate_cofounder_d_tag(COFOUNDER_D_TAG).is_ok());
        assert_eq!(
            validate_cofounder_d_tag("company:cofounder:x"),
            Err(CompanyRecordError::DTagMismatch)
        );
    }
}
