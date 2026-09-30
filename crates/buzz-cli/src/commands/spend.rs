//! Agent-facing commands for company AI allowances and spend evidence.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use buzz_core::company_spend::{
    ai_spend_record_d_tag, employee_allowance_d_tag, validate_ai_spend_record_head,
    validate_employee_allowance_head, AiSpendRecordAction, AiSpendRecordHead,
    EmployeeAllowanceAction, EmployeeAllowanceHead,
};
use buzz_core::kind::{KIND_AI_SPEND_RECORD_HEAD, KIND_EMPLOYEE_AI_ALLOWANCE_HEAD};

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::{read_or_stdin, sdk_err};
use crate::{SpendAllowanceCmd, SpendCmd, SpendRecordsCmd};

const SPEND_QUERY_BOUND: u32 = 10_000;

/// Dispatch spend commands.
pub async fn dispatch(cmd: SpendCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        SpendCmd::Allowance(command) => dispatch_allowance(command, client).await,
        SpendCmd::Records(command) => dispatch_records(command, client).await,
    }
}

async fn dispatch_allowance(
    command: SpendAllowanceCmd,
    client: &BuzzClient,
) -> Result<(), CliError> {
    match command {
        SpendAllowanceCmd::List => {
            let events = query_verified_heads(client, KIND_EMPLOYEE_AI_ALLOWANCE_HEAD, |content| {
                let head: EmployeeAllowanceHead = serde_json::from_str(content)
                    .map_err(|error| format!("allowance head content is invalid: {error}"))?;
                validate_employee_allowance_head(&head)
                    .map_err(|error| format!("allowance head is invalid: {error}"))?;
                let expected = employee_allowance_d_tag(&head.employee_pubkey)
                    .map_err(|error| error.to_string())?;
                Ok(expected)
            })
            .await?;
            println!("{}", normalize_events(&events));
            Ok(())
        }
        SpendAllowanceCmd::Set { action } => {
            let action: EmployeeAllowanceAction = read_json(&action, "employee allowance action")?;
            let builder = buzz_sdk::company_spend::build_employee_allowance_action(&action)
                .map_err(sdk_err)?;
            submit(client, builder).await
        }
    }
}

async fn dispatch_records(command: SpendRecordsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        SpendRecordsCmd::List => {
            let events = query_verified_heads(client, KIND_AI_SPEND_RECORD_HEAD, |content| {
                let head: AiSpendRecordHead = serde_json::from_str(content)
                    .map_err(|error| format!("AI spend head content is invalid: {error}"))?;
                validate_ai_spend_record_head(&head)
                    .map_err(|error| format!("AI spend head is invalid: {error}"))?;
                ai_spend_record_d_tag(&head.record_id).map_err(|error| error.to_string())
            })
            .await?;
            println!("{}", normalize_events(&events));
            Ok(())
        }
        SpendRecordsCmd::Set { action } => {
            let action: AiSpendRecordAction = read_json(&action, "AI spend record action")?;
            let builder =
                buzz_sdk::company_spend::build_ai_spend_record_action(&action).map_err(sdk_err)?;
            submit(client, builder).await
        }
    }
}

async fn query_verified_heads(
    client: &BuzzClient,
    kind: u32,
    expected_d_tag: impl Fn(&str) -> Result<String, String>,
) -> Result<Vec<Value>, CliError> {
    let relay_self = relay_self(client).await?;
    let events = client
        .query_all_bounded(
            json!({"kinds": [kind], "authors": [relay_self]}),
            SPEND_QUERY_BOUND,
        )
        .await?;
    for event in &events {
        let signed: nostr::Event = serde_json::from_value(event.clone()).map_err(|error| {
            CliError::Other(format!("AI spend head event is malformed: {error}"))
        })?;
        if u32::from(signed.kind.as_u16()) != kind
            || signed.pubkey.to_hex() != relay_self
            || signed.verify().is_err()
        {
            return Err(CliError::Other(
                "relay returned an invalid signed AI spend head".into(),
            ));
        }
        let d_tags = signed
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .collect::<Vec<_>>();
        let content = signed.content.as_str();
        let expected = expected_d_tag(content).map_err(CliError::Other)?;
        if signed.tags.len() != 1
            || d_tags.len() != 1
            || d_tags[0].content() != Some(expected.as_str())
        {
            return Err(CliError::Other(
                "relay returned an AI spend head with mismatched d-tag".into(),
            ));
        }
    }
    Ok(events)
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&raw).map_err(|error| {
        CliError::Other(format!("relay info document is invalid JSON: {error}"))
    })?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    if relay_self.len() != 64
        || !relay_self
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CliError::Other("relay info self key is invalid".into()));
    }
    Ok(relay_self.to_owned())
}

async fn submit(client: &BuzzClient, builder: nostr::EventBuilder) -> Result<(), CliError> {
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let json = read_or_stdin(input)?;
    serde_json::from_str(&json)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}
