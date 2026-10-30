//! Agent-first commands for company function slots.
//!
//! The five functions are Sales, Operations, Customer Success, Finance and
//! Brand, always listed in that order. A function with no saved head is an
//! empty slot.

use buzz_core::company_functions::{
    function_d_tag, validate_function_head, CompanyFunction, FunctionAction, FunctionActionKind,
    FunctionHead, SlotState,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_COMPANY_FUNCTION_HEAD;
use nostr::Event;
use serde_json::{json, Value};

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::cofounder::{head_d_tag, map_write_error, query_company_heads};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::FunctionsCmd;

pub async fn dispatch(command: FunctionsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        FunctionsCmd::List => {
            let heads = load_heads(client, &CompanyFunction::ALL).await?;
            println!("{}", Value::Array(function_rows(&heads)));
            Ok(())
        }
        FunctionsCmd::Get { function } => {
            let heads = load_heads(client, &[function]).await?;
            println!("{}", function_row(function, find_head(&heads, function)));
            Ok(())
        }
        FunctionsCmd::Assign { function, lead } => {
            let lead = parse_pubkey(&lead)?;
            change_slot(client, function, FunctionActionKind::AssignLead, Some(lead)).await
        }
        FunctionsCmd::Cover { function } => {
            change_slot(client, function, FunctionActionKind::CoverByScout, None).await
        }
        FunctionsCmd::Clear { function } => {
            change_slot(client, function, FunctionActionKind::Clear, None).await
        }
        FunctionsCmd::HireSlot { hire_id, function } => {
            let hire_id = crate::validate::parse_uuid(&hire_id)?;
            crate::commands::access::set_slot_hire(client, hire_id, function).await
        }
    }
}

/// Parses a function name given on the command line. Accepts `customer_success`
/// and `customer-success`, in any letter case.
pub(crate) fn parse_function(value: &str) -> Result<CompanyFunction, String> {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    CompanyFunction::ALL
        .into_iter()
        .find(|function| function.id() == normalized)
        .ok_or_else(|| {
            let names = CompanyFunction::ALL
                .map(|function| function.id())
                .join(", ");
            format!("unknown function '{value}'; use one of: {names}")
        })
}

async fn change_slot(
    client: &BuzzClient,
    function: CompanyFunction,
    kind: FunctionActionKind,
    lead_pubkey: Option<String>,
) -> Result<(), CliError> {
    let heads = load_heads(client, &[function]).await?;
    let expected = find_head(&heads, function).map(|(event, _)| event.id.to_hex());
    let action = FunctionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function,
        kind,
        lead_pubkey,
        expected_head_event_id: expected,
    };
    let builder = buzz_sdk::company_records::build_function_action(&action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "function slot changed before it was saved")?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

async fn load_heads(
    client: &BuzzClient,
    functions: &[CompanyFunction],
) -> Result<Vec<(Event, FunctionHead)>, CliError> {
    let d_tags = functions
        .iter()
        .map(|function| function_d_tag(*function))
        .collect::<Vec<_>>();
    let events = query_company_heads(client, KIND_COMPANY_FUNCTION_HEAD, &d_tags).await?;
    events
        .into_iter()
        .map(|event| {
            let head = serde_json::from_str::<FunctionHead>(&event.content).map_err(|error| {
                CliError::Other(format!("function head content is invalid: {error}"))
            })?;
            validate_function_head(&head)
                .map_err(|error| CliError::Other(format!("function head is invalid: {error}")))?;
            if function_d_tag(head.function) != head_d_tag(&event) {
                return Err(CliError::Other(
                    "function head does not match its d-tag".into(),
                ));
            }
            Ok((event, head))
        })
        .collect()
}

fn find_head(
    heads: &[(Event, FunctionHead)],
    function: CompanyFunction,
) -> Option<(&Event, &FunctionHead)> {
    heads
        .iter()
        .find(|(_, head)| head.function == function)
        .map(|(event, head)| (event, head))
}

/// One JSON row per function, always all five, in the fixed order. A function
/// with no head is `empty`.
pub(crate) fn function_rows(heads: &[(Event, FunctionHead)]) -> Vec<Value> {
    CompanyFunction::ALL
        .into_iter()
        .map(|function| function_row(function, find_head(heads, function)))
        .collect()
}

fn function_row(function: CompanyFunction, head: Option<(&Event, &FunctionHead)>) -> Value {
    match head {
        Some((event, head)) => json!({
            "function": function.id(),
            "name": function.display_name(),
            "state": head.state,
            "leadPubkey": head.lead_pubkey,
            "headEventId": event.id.to_hex(),
            "updatedByPubkey": head.updated_by_pubkey,
            "updatedAt": head.updated_at,
        }),
        None => json!({
            "function": function.id(),
            "name": function.display_name(),
            "state": SlotState::Empty,
            "leadPubkey": null,
            "headEventId": null,
        }),
    }
}

fn parse_pubkey(value: &str) -> Result<String, CliError> {
    nostr::PublicKey::parse(value.trim())
        .map(|pubkey| pubkey.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid lead public key: {error}")))
}

#[cfg(test)]
mod tests {
    use buzz_core::company_functions::FunctionHead;
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn head(
        function: CompanyFunction,
        state: SlotState,
        lead: Option<&str>,
    ) -> (Event, FunctionHead) {
        let head = FunctionHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            function,
            state,
            lead_pubkey: lead.map(str::to_owned),
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1_700_000_000,
        };
        let event = EventBuilder::new(
            Kind::Custom(KIND_COMPANY_FUNCTION_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tag(Tag::parse(["d", function_d_tag(function).as_str()]).expect("d tag"))
        .sign_with_keys(&Keys::generate())
        .expect("sign head");
        (event, head)
    }

    #[test]
    fn functions_list_shows_five_rows_in_order() {
        let lead = "c".repeat(64);
        // Heads arrive in any order and only for some functions.
        let heads = vec![
            head(CompanyFunction::Brand, SlotState::CoveredByScout, None),
            head(CompanyFunction::Sales, SlotState::Filled, Some(&lead)),
        ];
        let rows = function_rows(&heads);
        let ids: Vec<&str> = rows
            .iter()
            .map(|row| row["function"].as_str().expect("function id"))
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
        let states: Vec<&str> = rows
            .iter()
            .map(|row| row["state"].as_str().expect("state"))
            .collect();
        assert_eq!(
            states,
            ["filled", "empty", "empty", "empty", "covered_by_scout"]
        );
        assert_eq!(rows[0]["leadPubkey"], json!(lead));
        assert_eq!(rows[0]["name"], json!("Sales"));
        assert_eq!(rows[2]["name"], json!("Customer Success"));
        assert_eq!(rows[1]["headEventId"], Value::Null);
    }

    #[test]
    fn functions_assign_requires_lead() {
        assert!(parse(&["functions", "assign", "sales"]).is_err());
        let lead = "d".repeat(64);
        let ok = parse(&["functions", "assign", "sales", "--lead", lead.as_str()]).expect("parse");
        assert!(matches!(
            ok.command,
            Cmd::Functions(FunctionsCmd::Assign {
                function: CompanyFunction::Sales,
                ..
            })
        ));
        // A function name is required and must be one of the five.
        assert!(parse(&["functions", "assign", "--lead", lead.as_str()]).is_err());
        assert!(parse(&["functions", "assign", "legal", "--lead", lead.as_str()]).is_err());
    }

    #[test]
    fn function_names_accept_dash_and_underscore() {
        assert_eq!(
            parse_function("customer-success"),
            Ok(CompanyFunction::CustomerSuccess)
        );
        assert_eq!(
            parse_function("Customer_Success"),
            Ok(CompanyFunction::CustomerSuccess)
        );
        assert!(parse_function("legal").is_err());
        assert!(parse(&["functions", "cover", "operations"]).is_ok());
        assert!(parse(&["functions", "clear", "finance"]).is_ok());
        assert!(parse(&["functions", "get", "brand"]).is_ok());
    }

    #[test]
    fn lead_must_be_a_public_key() {
        assert!(parse_pubkey("not-a-key").is_err());
        let hex = Keys::generate().public_key().to_hex();
        assert_eq!(parse_pubkey(&hex).expect("valid key"), hex);
    }
}
