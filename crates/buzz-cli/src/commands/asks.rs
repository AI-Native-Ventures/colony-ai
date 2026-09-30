use buzz_core::company_records::{
    ask_d_tag, AskAction, AskActionKind, AskCategory, AskHead, AskOutcome, AskRecord, AskResponse,
    AskSubject, AskSubjectKind, AskType, HireProposal, COMPANY_RECORD_SCHEMA_VERSION,
};
use serde_json::{json, Value};

use crate::client::BuzzClient;
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::{parse_event_id, parse_uuid, read_or_stdin};
use crate::AsksCmd;
use uuid::Uuid;

/// Query and mutate channel-scoped company asks.
pub async fn dispatch(command: AsksCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        AsksCmd::List { channel } => list(client, &channel).await,
        AsksCmd::Create { channel, ask } => create(client, &channel, &ask).await,
        AsksCmd::ProposeHire {
            channel,
            thread_root,
            proposal,
        } => propose_hire(client, &channel, &thread_root, &proposal).await,
        AsksCmd::Cancel {
            channel,
            ask,
            expected_head_event_id,
            reason,
        } => cancel(client, &channel, &ask, &expected_head_event_id, &reason).await,
        AsksCmd::Respond {
            channel,
            ask,
            expected_head_event_id,
            outcome,
            reason,
            answer,
            option_id,
            checked_item_ids,
        } => {
            respond(
                client,
                &channel,
                &ask,
                &expected_head_event_id,
                &outcome,
                reason.as_deref(),
                answer.as_deref(),
                option_id.as_deref(),
                checked_item_ids.as_deref(),
            )
            .await
        }
    }
}

async fn propose_hire(
    client: &BuzzClient,
    channel: &str,
    thread_root: &str,
    proposal_json: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let thread_root = parse_event_id(thread_root)?.to_hex();
    let input = read_or_stdin(proposal_json)?;
    let proposal: HireProposal = serde_json::from_str(&input)
        .map_err(|error| CliError::Usage(format!("invalid hire proposal JSON: {error}")))?;
    let ask_id = Uuid::new_v4();
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Hire,
        title: format!("Hire {}", proposal.role_pack.title),
        body: None,
        thread_root_event_id: thread_root,
        addressee_pubkey: None,
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: Some(AskSubject {
            kind: AskSubjectKind::Hire,
            id: proposal.hire_id.to_string(),
        }),
        member_proposal: None,
        secret_request: None,
        hire_proposal: Some(proposal.clone()),
        duty_proposal: None,
    };
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    let builder =
        buzz_sdk::asks::build_ask_action(channel_id, &action).map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, "hire proposal ask was rejected")?;
    println!(
        "{}",
        crate::client::create_response_with_id_if_accepted(
            &response,
            "ask_id",
            &ask_id.to_string(),
        )
    );
    Ok(())
}

async fn list(client: &BuzzClient, channel: &str) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let filter = json!({
        "kinds": [buzz_core::kind::KIND_ASK_HEAD],
        "#h": [channel_id.to_string()],
        "limit": 500
    });
    let response = client.query(&filter).await?;
    let events: Vec<Value> = serde_json::from_str(&response)
        .map_err(|error| CliError::Other(format!("invalid ask query response: {error}")))?;

    let mut asks = Vec::with_capacity(events.len());
    for event in events {
        let event_id = event
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::Other("ask head is missing its event id".into()))?;
        let content = event
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::Other("ask head is missing its content".into()))?;
        let head: AskHead = serde_json::from_str(content)
            .map_err(|error| CliError::Other(format!("invalid ask head content: {error}")))?;
        let expected_d = ask_d_tag(channel_id, head.ask_id);
        let expected_h = channel_id.to_string();
        let h_tags = tag_values(&event, "h");
        let d_tags = tag_values(&event, "d");
        if h_tags.as_slice() != [expected_h.as_str()] || d_tags.as_slice() != [expected_d.as_str()]
        {
            return Err(CliError::Other(format!(
                "ask head {event_id} has mismatched channel coordinates"
            )));
        }
        asks.push(json!({
            "event_id": event_id,
            "channel_id": channel_id,
            "ask_id": head.ask_id,
            "head": head,
        }));
    }
    println!("{}", Value::Array(asks));
    Ok(())
}

async fn create(client: &BuzzClient, channel: &str, ask_json: &str) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let input = read_or_stdin(ask_json)?;
    let ask: AskRecord = serde_json::from_str(&input)
        .map_err(|error| CliError::Usage(format!("invalid ask JSON: {error}")))?;
    let ask_id = ask.ask_id;
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    let builder =
        buzz_sdk::asks::build_ask_action(channel_id, &action).map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, "ask create was rejected")?;
    println!(
        "{}",
        crate::client::create_response_with_id_if_accepted(
            &response,
            "ask_id",
            &ask_id.to_string(),
        )
    );
    Ok(())
}

async fn cancel(
    client: &BuzzClient,
    channel: &str,
    ask: &str,
    expected_head_event_id: &str,
    reason: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let ask_id = parse_uuid(ask)?;
    let expected_head = parse_event_id(expected_head_event_id)?.to_hex();
    let reason = read_or_stdin(reason)?;
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Cancel,
        expected_head_event_id: Some(expected_head),
        ask: None,
        reason: Some(reason),
    };
    let builder =
        buzz_sdk::asks::build_ask_action(channel_id, &action).map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    let normalized = parse_write_response(&response, "ask changed before it could be cancelled")?;
    println!("{normalized}");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn respond(
    client: &BuzzClient,
    channel: &str,
    ask: &str,
    expected_head_event_id: &str,
    outcome: &str,
    reason: Option<&str>,
    answer: Option<&str>,
    option_id: Option<&str>,
    checked_item_ids: Option<&str>,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let ask_id = parse_uuid(ask)?;
    let expected_head = parse_event_id(expected_head_event_id)?.to_hex();
    let outcome: AskOutcome = serde_json::from_value(Value::String(outcome.to_owned()))
        .map_err(|_| CliError::Usage(format!("unsupported ask outcome: {outcome}")))?;
    let reason = reason.map(read_or_stdin).transpose()?;
    let answer = answer.map(read_or_stdin).transpose()?;
    let checked_item_ids = checked_item_ids
        .map(|input| {
            let input = read_or_stdin(input)?;
            serde_json::from_str::<Vec<String>>(&input).map_err(|error| {
                CliError::Usage(format!("invalid checklist item ids JSON: {error}"))
            })
        })
        .transpose()?;

    let response = AskResponse {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        expected_head_event_id: expected_head,
        outcome,
        reason,
        answer,
        option_id: option_id.map(str::to_owned),
        checked_item_ids,
        secret_binding_id: None,
    };
    let builder = buzz_sdk::asks::build_ask_response(channel_id, &response)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let raw_response = client.submit_event(event).await?;
    let normalized =
        parse_write_response(&raw_response, "ask changed before it could be resolved")?;
    println!("{normalized}");
    Ok(())
}

fn tag_values<'a>(event: &'a Value, name: &str) -> Vec<&'a str> {
    event
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .filter(|tag| tag.first().and_then(Value::as_str) == Some(name))
        .filter_map(|tag| tag.get(1).and_then(Value::as_str))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_coordinate_values_from_event_tags() {
        let event = json!({
            "tags": [["h", "channel"], ["d", "ask"], ["h", "other"]]
        });
        assert_eq!(tag_values(&event, "h"), ["channel", "other"]);
        assert_eq!(tag_values(&event, "d"), ["ask"]);
    }
}
