//! Company function slots: Sales, Operations, Customer Success, Finance, Brand.
//!
//! Each function has its own relay-signed head (`company:function:<id>`) that
//! says who covers it. A missing head reads as an empty slot. These are new
//! kinds, so a desktop that predates them keeps loading its existing lists.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored function slot head (community-wide).
pub const KIND_COMPANY_FUNCTION_HEAD: u32 = crate::kind::KIND_COMPANY_FUNCTION_HEAD;
/// Member function slot mutation, brokered and community-wide.
pub const KIND_COMPANY_FUNCTION_ACTION: u32 = crate::kind::KIND_COMPANY_FUNCTION_ACTION;

const FUNCTION_D_TAG_PREFIX: &str = "company:function:";

/// One of the five company functions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyFunction {
    /// Finding and winning customers.
    Sales,
    /// Delivering the work.
    Operations,
    /// Keeping customers happy and renewing.
    CustomerSuccess,
    /// Money in, money out.
    Finance,
    /// How the company looks and sounds.
    Brand,
}

impl CompanyFunction {
    /// Every function, in the fixed display order.
    pub const ALL: [CompanyFunction; 5] = [
        CompanyFunction::Sales,
        CompanyFunction::Operations,
        CompanyFunction::CustomerSuccess,
        CompanyFunction::Finance,
        CompanyFunction::Brand,
    ];

    /// Stable lower snake case id used in d-tags and JSON.
    pub const fn id(&self) -> &'static str {
        match self {
            CompanyFunction::Sales => "sales",
            CompanyFunction::Operations => "operations",
            CompanyFunction::CustomerSuccess => "customer_success",
            CompanyFunction::Finance => "finance",
            CompanyFunction::Brand => "brand",
        }
    }

    /// Name shown to people.
    pub const fn display_name(&self) -> &'static str {
        match self {
            CompanyFunction::Sales => "Sales",
            CompanyFunction::Operations => "Operations",
            CompanyFunction::CustomerSuccess => "Customer Success",
            CompanyFunction::Finance => "Finance",
            CompanyFunction::Brand => "Brand",
        }
    }
}

/// Build the community-wide d-tag of one function slot.
pub fn function_d_tag(function: CompanyFunction) -> String {
    format!("{FUNCTION_D_TAG_PREFIX}{}", function.id())
}

/// Parse a function slot d-tag back into its function.
pub fn validate_function_d_tag(tag: &str) -> Result<CompanyFunction, CompanyRecordError> {
    let id = tag
        .strip_prefix(FUNCTION_D_TAG_PREFIX)
        .ok_or(CompanyRecordError::DTagMismatch)?;
    CompanyFunction::ALL
        .into_iter()
        .find(|function| function.id() == id)
        .ok_or(CompanyRecordError::DTagMismatch)
}

/// Who covers a function slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotState {
    /// Nobody covers the function yet.
    Empty,
    /// Scout covers the function itself.
    CoveredByScout,
    /// A lead employee covers the function.
    Filled,
}

/// Supported function slot operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FunctionActionKind {
    /// Put a member or agent in charge of the function.
    AssignLead,
    /// Scout covers the function and no lead is set.
    CoverByScout,
    /// Empty the slot.
    Clear,
}

/// Member-signed function slot change (kind 47061).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FunctionAction {
    /// Schema version.
    pub schema_version: u8,
    /// The function whose slot changes.
    pub function: CompanyFunction,
    /// Requested change.
    pub kind: FunctionActionKind,
    /// Lead pubkey in 64-character hex, required for `assign_lead` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_pubkey: Option<String>,
    /// Exact current head event id, omitted only while no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Relay-authored canonical function slot head (kind 30671).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FunctionHead {
    /// Schema version.
    pub schema_version: u8,
    /// The function this head describes.
    pub function: CompanyFunction,
    /// Who covers it.
    pub state: SlotState,
    /// Lead pubkey, present only when the slot is filled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_pubkey: Option<String>,
    /// Owner or admin who made the last change.
    pub updated_by_pubkey: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

/// Validate a function slot action.
///
/// `AssignLead` needs a 64-character hex lead; `CoverByScout` and `Clear`
/// must not carry one.
pub fn validate_function_action(action: &FunctionAction) -> Result<(), CompanyRecordError> {
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
    match (action.kind, action.lead_pubkey.as_deref()) {
        (FunctionActionKind::AssignLead, _) => Ok(()),
        (FunctionActionKind::CoverByScout | FunctionActionKind::Clear, _) => Ok(()),
    }
}

/// Validate a relay-authored function slot head.
pub fn validate_function_head(head: &FunctionHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&head.updated_by_pubkey) || head.updated_at < 0 {
        return Err(CompanyRecordError::Invalid(
            "function head needs a valid updater and time",
        ));
    }
    match (head.state, head.lead_pubkey.as_deref()) {
        (SlotState::Filled, Some(lead)) if is_hex_id(lead) => Ok(()),
        (SlotState::Filled, _) => Err(CompanyRecordError::Invalid(
            "a filled function slot needs a 64-character leadPubkey",
        )),
        (SlotState::Empty | SlotState::CoveredByScout, None) => Ok(()),
        (SlotState::Empty | SlotState::CoveredByScout, Some(_)) => Err(
            CompanyRecordError::Invalid("an empty or Scout-covered slot has no leadPubkey"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::company_records::parse_company_command;

    fn action(kind: FunctionActionKind, lead: Option<&str>) -> FunctionAction {
        FunctionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            function: CompanyFunction::Sales,
            kind,
            lead_pubkey: lead.map(str::to_owned),
            expected_head_event_id: None,
        }
    }

    #[test]
    fn function_d_tags_round_trip_for_all_five() {
        for function in CompanyFunction::ALL {
            let tag = function_d_tag(function);
            assert_eq!(tag, format!("company:function:{}", function.id()));
            assert_eq!(validate_function_d_tag(&tag), Ok(function));
        }
        assert_eq!(
            validate_function_d_tag("company:function:legal"),
            Err(CompanyRecordError::DTagMismatch)
        );
        assert_eq!(
            validate_function_d_tag("company:cofounder"),
            Err(CompanyRecordError::DTagMismatch)
        );
    }

    #[test]
    fn assign_without_lead_is_invalid() {
        assert!(validate_function_action(&action(FunctionActionKind::AssignLead, None)).is_err());
        assert!(validate_function_action(&action(
            FunctionActionKind::AssignLead,
            Some("not-a-pubkey")
        ))
        .is_err());
        assert!(validate_function_action(&action(
            FunctionActionKind::AssignLead,
            Some(&"b".repeat(64))
        ))
        .is_ok());
    }

    #[test]
    fn cover_with_lead_is_invalid() {
        let lead = "b".repeat(64);
        assert!(
            validate_function_action(&action(FunctionActionKind::CoverByScout, Some(&lead)))
                .is_err()
        );
        assert!(validate_function_action(&action(FunctionActionKind::Clear, Some(&lead))).is_err());
        assert!(validate_function_action(&action(FunctionActionKind::CoverByScout, None)).is_ok());
        assert!(validate_function_action(&action(FunctionActionKind::Clear, None)).is_ok());
    }

    #[test]
    fn function_order_is_sales_operations_customer_success_finance_brand() {
        let ids: Vec<&str> = CompanyFunction::ALL
            .iter()
            .map(CompanyFunction::id)
            .collect();
        assert_eq!(
            ids,
            [
                "sales",
                "operations",
                "customer_success",
                "finance",
                "brand"
            ]
        );
        let names: Vec<&str> = CompanyFunction::ALL
            .iter()
            .map(CompanyFunction::display_name)
            .collect();
        assert_eq!(
            names,
            [
                "Sales",
                "Operations",
                "Customer Success",
                "Finance",
                "Brand"
            ]
        );
    }

    #[test]
    fn function_action_rejects_unknown_fields_and_wrong_version() {
        let json = r#"{"schemaVersion":1,"function":"sales","kind":"clear","extra":true}"#;
        assert!(serde_json::from_str::<FunctionAction>(json).is_err());
        let mut wrong = action(FunctionActionKind::Clear, None);
        wrong.schema_version = 2;
        assert_eq!(
            validate_function_action(&wrong),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn function_action_parses_through_the_company_command_parser() {
        let content =
            serde_json::to_string(&action(FunctionActionKind::CoverByScout, None)).unwrap();
        assert!(parse_company_command(KIND_COMPANY_FUNCTION_ACTION, &content).is_ok());
    }

    #[test]
    fn function_head_state_matches_lead() {
        let head = |state, lead: Option<&str>| FunctionHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            function: CompanyFunction::Finance,
            state,
            lead_pubkey: lead.map(str::to_owned),
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1,
        };
        let lead = "c".repeat(64);
        assert!(validate_function_head(&head(SlotState::Filled, Some(&lead))).is_ok());
        assert!(validate_function_head(&head(SlotState::Filled, None)).is_err());
        assert!(validate_function_head(&head(SlotState::Empty, Some(&lead))).is_err());
        assert!(validate_function_head(&head(SlotState::CoveredByScout, None)).is_ok());
    }
}
