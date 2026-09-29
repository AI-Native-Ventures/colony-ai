use buzz_core::business_records::{
    company_work_d_tag, CompanyWorkItemAction, CompanyWorkItemActionKind, CompanyWorkItemHead,
    CompanyWorkItemInput, CompanyWorkStatus, CompanyWorkVerdict, CompanyWorkVerificationInput,
    BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_WORK_ITEM_HEAD;
use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::client::{
    normalize_events, normalize_write_response, print_create_response, BuzzClient,
};
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, sdk_err};

const COMPANY_WORK_QUERY_BOUND: u32 = 10_000;

struct WorkHeadEvent {
    event: Value,
    head: CompanyWorkItemHead,
    channel_id: Uuid,
}

pub async fn dispatch(cmd: crate::WorkCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::WorkCmd;
    match cmd {
        WorkCmd::Create { channel, record } => cmd_create(client, &channel, &record).await,
        WorkCmd::Update { work, record } => cmd_update(client, &work, &record).await,
        WorkCmd::Status {
            work,
            status,
            reason,
        } => cmd_status(client, &work, &status, &reason).await,
        WorkCmd::Verify {
            work,
            verdict,
            reason,
            evidence,
        } => cmd_verify(client, &work, &verdict, &reason, &evidence).await,
        WorkCmd::Archive { work } => cmd_archive(client, &work).await,
        WorkCmd::Restore { work } => cmd_restore(client, &work).await,
        WorkCmd::List { channel, limit } => cmd_list(client, channel.as_deref(), limit).await,
        WorkCmd::Get { work } => cmd_get(client, &work).await,
        WorkCmd::DueDate { work, date } => cmd_due_date(client, &work, &date).await,
        WorkCmd::ClearDueDate { work } => cmd_clear_due_date(client, &work).await,
    }
}

async fn cmd_create(
    client: &BuzzClient,
    channel: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let input: CompanyWorkItemInput = read_json(record_input, "company work item")?;
    let work_item_id = input.work_item_id;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(input),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    let event = client.sign_event(build_action(channel_id, &action)?)?;
    let response = client.submit_event(event).await?;
    print_create_response(&response, "work_item_id", &work_item_id.to_string());
    Ok(())
}

async fn cmd_update(
    client: &BuzzClient,
    work_item_id: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let input: CompanyWorkItemInput = read_json(record_input, "company work item")?;
    if input.work_item_id != work_item_id {
        return Err(CliError::Usage(
            "CompanyWorkItemInput.workItemId must match --work".into(),
        ));
    }
    let current = current_work_item(client, work_item_id).await?;
    if input.status != current.head.status {
        return Err(CliError::Usage(
            "status changes require `buzz work status`".into(),
        ));
    }
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Update,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: Some(input),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_status(
    client: &BuzzClient,
    work_item_id: &str,
    status: &str,
    reason: &str,
) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let status = parse_status(status)?;
    let current = current_work_item(client, work_item_id).await?;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::SetStatus,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: None,
        status: Some(status),
        reason: Some(reason.to_owned()),
        verification: None,
        due_at: None,
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_verify(
    client: &BuzzClient,
    work_item_id: &str,
    verdict: &str,
    reason: &str,
    evidence: &str,
) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let verdict = parse_verdict(verdict)?;
    let current = current_work_item(client, work_item_id).await?;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Verify,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: None,
        status: None,
        reason: None,
        verification: Some(CompanyWorkVerificationInput {
            verdict,
            reason: reason.to_owned(),
            evidence: evidence.to_owned(),
        }),
        due_at: None,
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_archive(client: &BuzzClient, work_item_id: &str) -> Result<(), CliError> {
    cmd_simple_action(client, work_item_id, CompanyWorkItemActionKind::Archive).await
}

async fn cmd_restore(client: &BuzzClient, work_item_id: &str) -> Result<(), CliError> {
    cmd_simple_action(client, work_item_id, CompanyWorkItemActionKind::Restore).await
}

async fn cmd_simple_action(
    client: &BuzzClient,
    work_item_id: &str,
    action_kind: CompanyWorkItemActionKind,
) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let current = current_work_item(client, work_item_id).await?;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: action_kind,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: None,
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_due_date(
    client: &BuzzClient,
    work_item_id: &str,
    due_at: &str,
) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let current = current_work_item(client, work_item_id).await?;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::SetDueDate,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: None,
        status: None,
        reason: None,
        verification: None,
        due_at: Some(due_at.to_owned()),
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_clear_due_date(client: &BuzzClient, work_item_id: &str) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let current = current_work_item(client, work_item_id).await?;
    let action = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::ClearDueDate,
        expected_head_event_id: Some(event_id(&current.event)?),
        head: None,
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    submit_action(client, current.channel_id, &action).await
}

async fn cmd_list(
    client: &BuzzClient,
    channel: Option<&str>,
    limit: Option<u32>,
) -> Result<(), CliError> {
    let channel_id = channel.map(parse_uuid).transpose()?;
    let limit = limit
        .unwrap_or(COMPANY_WORK_QUERY_BOUND)
        .min(COMPANY_WORK_QUERY_BOUND) as usize;
    let mut heads = query_work_heads(client).await?;
    heads.retain(|head| channel_id.is_none_or(|channel_id| channel_id == head.channel_id));
    heads.truncate(limit);
    let events = heads.into_iter().map(|head| head.event).collect::<Vec<_>>();
    println!("{}", normalize_events(&events));
    Ok(())
}

async fn cmd_get(client: &BuzzClient, work_item_id: &str) -> Result<(), CliError> {
    let work_item_id = parse_uuid(work_item_id)?;
    let head = current_work_item(client, work_item_id).await?;
    println!("{}", normalize_events(std::slice::from_ref(&head.event)));
    Ok(())
}

async fn current_work_item(
    client: &BuzzClient,
    work_item_id: Uuid,
) -> Result<WorkHeadEvent, CliError> {
    query_work_heads(client)
        .await?
        .into_iter()
        .find(|head| head.head.work_item_id == work_item_id)
        .ok_or_else(|| CliError::NotFound(format!("company work item {work_item_id} not found")))
}

async fn query_work_heads(client: &BuzzClient) -> Result<Vec<WorkHeadEvent>, CliError> {
    let nip11_raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&nip11_raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    let relay_self = normalize_relay_self_hex(relay_self)?;
    let events = client
        .query_all_bounded(
            serde_json::json!({
                "kinds": [KIND_WORK_ITEM_HEAD],
                "authors": [relay_self]
            }),
            COMPANY_WORK_QUERY_BOUND,
        )
        .await?;
    let mut heads = Vec::new();
    for event in events {
        if let Some(head) = parse_work_head_event(event, &relay_self)? {
            heads.push(head);
        }
    }
    Ok(heads)
}

fn parse_work_head_event(
    event: Value,
    relay_self: &str,
) -> Result<Option<WorkHeadEvent>, CliError> {
    let signed_event: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("work head event is malformed: {error}")))?;
    if signed_event.kind != nostr::Kind::Custom(KIND_WORK_ITEM_HEAD as u16) {
        return Err(CliError::Other(format!(
            "work head event has wrong kind: {}",
            signed_event.kind.as_u16()
        )));
    }
    if signed_event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "work head author does not match the relay self key".into(),
        ));
    }
    signed_event
        .verify()
        .map_err(|error| CliError::Other(format!("work head signature is invalid: {error}")))?;

    let d_tags = signed_event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    let h_tags = signed_event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .collect::<Vec<_>>();
    if d_tags.len() != 1
        || h_tags.len() != 1
        || signed_event
            .tags
            .iter()
            .any(|tag| !matches!(tag.kind().to_string().as_str(), "d" | "h"))
    {
        return Err(CliError::Other(
            "work head must have exactly one h tag and one d tag".into(),
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| CliError::Other("work head d tag has no value".into()))?;
    if !d_tag.starts_with("company:work:") {
        return Ok(None);
    }

    let h_tag = h_tags[0]
        .content()
        .ok_or_else(|| CliError::Other("work head h tag has no channel UUID".into()))?;
    let channel_id = Uuid::parse_str(h_tag)
        .map_err(|_| CliError::Other("work head h tag is not a channel UUID".into()))?;
    let head = parse_work_head(&event)?;
    if head.schema_version != BUSINESS_RECORD_SCHEMA_VERSION
        || head.work_item_id.is_nil()
        || head.assigned_pubkeys.len() != 1
        || head.requester_pubkey.len() != 64
        || !head
            .requester_pubkey
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(CliError::Other(
            "work head content violates its schema".into(),
        ));
    }
    let expected_d_tag = company_work_d_tag(head.work_item_id);
    if d_tag != expected_d_tag {
        return Err(CliError::Other(
            "work head d-tag does not match its content".into(),
        ));
    }
    Ok(Some(WorkHeadEvent {
        event,
        head,
        channel_id,
    }))
}

fn parse_work_head_event_content(event: &Value) -> Result<CompanyWorkItemHead, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("work head event has no string content".into()))?;
    serde_json::from_str(content)
        .map_err(|error| CliError::Other(format!("work head content is invalid: {error}")))
}

fn parse_work_head(event: &Value) -> Result<CompanyWorkItemHead, CliError> {
    parse_work_head_event_content(event)
}

fn event_id(event: &Value) -> Result<String, CliError> {
    event
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CliError::Other("work head event has no id".into()))
}

fn normalize_relay_self_hex(self_hex: &str) -> Result<String, CliError> {
    if self_hex.len() != 64
        || !self_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(CliError::Other(
            "relay 'self' field is not a valid 64-hex pubkey".into(),
        ));
    }
    Ok(self_hex.to_ascii_lowercase())
}

fn build_action(
    channel_id: Uuid,
    action: &CompanyWorkItemAction,
) -> Result<nostr::EventBuilder, CliError> {
    buzz_sdk::business_records::build_company_work_item_action(channel_id, action).map_err(sdk_err)
}

async fn submit_action(
    client: &BuzzClient,
    channel_id: Uuid,
    action: &CompanyWorkItemAction,
) -> Result<(), CliError> {
    let event = client.sign_event(build_action(channel_id, action)?)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

fn parse_status(value: &str) -> Result<CompanyWorkStatus, CliError> {
    match value {
        "active" => Ok(CompanyWorkStatus::Active),
        "paused" => Ok(CompanyWorkStatus::Paused),
        "blocked" => Ok(CompanyWorkStatus::Blocked),
        "done_unverified" => Ok(CompanyWorkStatus::DoneUnverified),
        _ => Err(CliError::Usage(
            "status must be active, paused, blocked, or done_unverified".into(),
        )),
    }
}

fn parse_verdict(value: &str) -> Result<CompanyWorkVerdict, CliError> {
    match value {
        "pass" => Ok(CompanyWorkVerdict::Pass),
        "revision_requested" => Ok(CompanyWorkVerdict::RevisionRequested),
        _ => Err(CliError::Usage(
            "verdict must be pass or revision_requested".into(),
        )),
    }
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let json = read_or_stdin(input)?;
    serde_json::from_str(&json)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_accepts_only_owner_submittable_company_work_states() {
        assert_eq!(parse_status("active").unwrap(), CompanyWorkStatus::Active);
        assert_eq!(parse_status("paused").unwrap(), CompanyWorkStatus::Paused);
        assert_eq!(parse_status("blocked").unwrap(), CompanyWorkStatus::Blocked);
        assert_eq!(
            parse_status("done_unverified").unwrap(),
            CompanyWorkStatus::DoneUnverified
        );
        assert!(parse_status("done_verified").is_err());
        assert!(parse_status("archived").is_err());
    }

    #[test]
    fn verification_accepts_only_the_two_contract_verdicts() {
        assert_eq!(parse_verdict("pass").unwrap(), CompanyWorkVerdict::Pass);
        assert_eq!(
            parse_verdict("revision_requested").unwrap(),
            CompanyWorkVerdict::RevisionRequested
        );
        assert!(parse_verdict("approved").is_err());
    }

    #[test]
    fn company_work_coordinate_has_no_client_or_community_prefix() {
        assert_eq!(
            company_work_d_tag(Uuid::from_u128(9)),
            "company:work:00000000-0000-0000-0000-000000000009"
        );
    }
}
