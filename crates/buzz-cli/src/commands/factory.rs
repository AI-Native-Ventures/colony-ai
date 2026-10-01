//! Agent-first operations for Software Factory run records.

use buzz_core::factory_run_records::{
    factory_run_d_tag, validate_factory_run_head, FactoryPreviewState, FactoryPullRequest,
    FactoryRunAction, FactoryRunActionKind, FactoryRunHead, FACTORY_RUN_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_FACTORY_RUN_HEAD;
use nostr::Event;
use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, sdk_err};

const FACTORY_RUN_QUERY_BOUND: u32 = 10_000;

struct FactoryHeadEvent {
    event: Value,
    id: String,
}

/// Dispatch a Software Factory record command.
pub async fn dispatch(command: crate::FactoryCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::{FactoryCmd, FactoryPreviewCmd, FactoryPullRequestCmd};
    match command {
        FactoryCmd::List => cmd_list(client).await,
        FactoryCmd::Get { run } => cmd_get(client, &run).await,
        FactoryCmd::Preview(command) => match command {
            FactoryPreviewCmd::Configure {
                run,
                command,
                url,
                owner_pubkey,
            } => cmd_configure_preview(client, &run, &command, &url, owner_pubkey.as_deref()).await,
            FactoryPreviewCmd::Report { run, record } => {
                cmd_report_preview(client, &run, &record).await
            }
        },
        FactoryCmd::PullRequest(command) => match command {
            FactoryPullRequestCmd::Link {
                run,
                record,
                owner_pubkey,
            } => cmd_link_pull_request(client, &run, &record, owner_pubkey.as_deref()).await,
            FactoryPullRequestCmd::Update { run, record } => {
                cmd_update_pull_request(client, &run, &record).await
            }
            FactoryPullRequestCmd::Unlink { run } => cmd_unlink_pull_request(client, &run).await,
        },
    }
}

async fn cmd_list(client: &BuzzClient) -> Result<(), CliError> {
    let records = query_factory_heads(client, None).await?;
    let events = records
        .into_iter()
        .map(|record| record.event)
        .collect::<Vec<_>>();
    println!("{}", normalize_events(&events));
    Ok(())
}

async fn cmd_get(client: &BuzzClient, run: &str) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let Some(record) = current_factory_head(client, run_id).await? else {
        println!("[]");
        return Ok(());
    };
    println!("{}", normalize_events(std::slice::from_ref(&record.event)));
    Ok(())
}

async fn cmd_configure_preview(
    client: &BuzzClient,
    run: &str,
    command: &str,
    url: &str,
    owner_pubkey: Option<&str>,
) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let current = current_factory_head(client, run_id).await?;
    let action = action_base(
        client,
        run_id,
        FactoryRunActionKind::ConfigurePreview,
        current.as_ref(),
        owner_pubkey,
    )?;
    submit_action(
        client,
        FactoryRunAction {
            command: Some(command.to_owned()),
            local_url: Some(url.to_owned()),
            ..action
        },
    )
    .await
}

async fn cmd_report_preview(
    client: &BuzzClient,
    run: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let current = current_factory_head(client, run_id).await?;
    if current.is_none() {
        return Err(CliError::NotFound(format!(
            "Factory run record {run_id} not found"
        )));
    }
    let preview: FactoryPreviewState = read_json(record_input, "Factory preview state")?;
    let action = action_base(
        client,
        run_id,
        FactoryRunActionKind::ReportPreviewState,
        current.as_ref(),
        None,
    )?;
    submit_action(
        client,
        FactoryRunAction {
            preview: Some(preview),
            ..action
        },
    )
    .await
}

async fn cmd_link_pull_request(
    client: &BuzzClient,
    run: &str,
    record_input: &str,
    owner_pubkey: Option<&str>,
) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let current = current_factory_head(client, run_id).await?;
    let pull_request: FactoryPullRequest = read_json(record_input, "Factory pull request")?;
    let action = action_base(
        client,
        run_id,
        FactoryRunActionKind::LinkPullRequest,
        current.as_ref(),
        owner_pubkey,
    )?;
    submit_action(
        client,
        FactoryRunAction {
            pull_request: Some(pull_request),
            ..action
        },
    )
    .await
}

async fn cmd_update_pull_request(
    client: &BuzzClient,
    run: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let current = current_factory_head(client, run_id)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("Factory run record {run_id} not found")))?;
    let pull_request: FactoryPullRequest = read_json(record_input, "Factory pull request")?;
    let action = action_base(
        client,
        run_id,
        FactoryRunActionKind::LinkPullRequest,
        Some(&current),
        None,
    )?;
    submit_action(
        client,
        FactoryRunAction {
            pull_request: Some(pull_request),
            ..action
        },
    )
    .await
}

async fn cmd_unlink_pull_request(client: &BuzzClient, run: &str) -> Result<(), CliError> {
    let run_id = parse_run_id(run)?;
    let current = current_factory_head(client, run_id)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("Factory run record {run_id} not found")))?;
    submit_action(
        client,
        action_base(
            client,
            run_id,
            FactoryRunActionKind::UnlinkPullRequest,
            Some(&current),
            None,
        )?,
    )
    .await
}

fn action_base(
    client: &BuzzClient,
    run_id: Uuid,
    action: FactoryRunActionKind,
    current: Option<&FactoryHeadEvent>,
    owner_pubkey: Option<&str>,
) -> Result<FactoryRunAction, CliError> {
    let run_owner_pubkey = match current {
        Some(_) if owner_pubkey.is_some() => {
            return Err(CliError::Usage(
                "--owner-pubkey is only accepted when creating a Factory run record".into(),
            ));
        }
        Some(_) => None,
        None => Some(match owner_pubkey {
            Some(pubkey) => normalize_pubkey(pubkey, client)?,
            None => client.keys().public_key().to_hex(),
        }),
    };
    Ok(FactoryRunAction {
        schema_version: FACTORY_RUN_RECORD_SCHEMA_VERSION,
        run_id,
        run_owner_pubkey,
        expected_head_event_id: current.map(|record| record.id.clone()),
        action,
        command: None,
        local_url: None,
        port: None,
        readiness: None,
        preview: None,
        pull_request: None,
    })
}

fn normalize_pubkey(value: &str, client: &BuzzClient) -> Result<String, CliError> {
    let pubkey = if value.is_empty() {
        client.keys().public_key().to_hex()
    } else {
        value.to_owned()
    };
    if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CliError::Usage(
            "--owner-pubkey must be a 64-character hex key".into(),
        ));
    }
    Ok(pubkey.to_ascii_lowercase())
}

fn parse_run_id(value: &str) -> Result<Uuid, CliError> {
    let run_id = parse_uuid(value)?;
    if run_id.is_nil() {
        return Err(CliError::Usage("Factory run UUID must not be nil".into()));
    }
    Ok(run_id)
}

async fn submit_action(client: &BuzzClient, action: FactoryRunAction) -> Result<(), CliError> {
    let builder = buzz_sdk::company_records::build_factory_run_action(&action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

async fn current_factory_head(
    client: &BuzzClient,
    run_id: Uuid,
) -> Result<Option<FactoryHeadEvent>, CliError> {
    let mut records = query_factory_heads(client, Some(run_id)).await?;
    if records.len() > 1 {
        return Err(CliError::Other(
            "relay returned duplicate Factory run heads".into(),
        ));
    }
    Ok(records.pop())
}

async fn query_factory_heads(
    client: &BuzzClient,
    run_id: Option<Uuid>,
) -> Result<Vec<FactoryHeadEvent>, CliError> {
    let relay_self = relay_self(client).await?;
    let mut filter = serde_json::json!({
        "kinds": [KIND_FACTORY_RUN_HEAD],
        "authors": [relay_self],
    });
    if let Some(run_id) = run_id {
        filter["#d"] = serde_json::json!([factory_run_d_tag(run_id)]);
    }
    let events = client
        .query_all_bounded(filter, FACTORY_RUN_QUERY_BOUND)
        .await?;
    events
        .into_iter()
        .map(|event| parse_head_event(event, &relay_self, run_id))
        .collect()
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
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
    if relay_self.len() != 64 || !relay_self.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CliError::Other(
            "relay 'self' field is not a valid 64-hex pubkey".into(),
        ));
    }
    Ok(relay_self.to_ascii_lowercase())
}

fn parse_head_event(
    event: Value,
    relay_self: &str,
    expected_run_id: Option<Uuid>,
) -> Result<FactoryHeadEvent, CliError> {
    let signed_event = serde_json::from_value::<Event>(event.clone()).map_err(|error| {
        CliError::Other(format!("Factory run head event is malformed: {error}"))
    })?;
    if signed_event.kind.as_u16() as u32 != KIND_FACTORY_RUN_HEAD
        || signed_event.pubkey.to_hex() != relay_self
        || signed_event.verify().is_err()
    {
        return Err(CliError::Other(
            "relay returned an invalid signed Factory run head".into(),
        ));
    }
    let head = serde_json::from_str::<FactoryRunHead>(&signed_event.content).map_err(|error| {
        CliError::Other(format!("Factory run head content is invalid: {error}"))
    })?;
    validate_factory_run_head(&head)
        .map_err(|error| CliError::Other(format!("Factory run head is invalid: {error}")))?;
    if expected_run_id.is_some_and(|run_id| run_id != head.run_id) {
        return Err(CliError::Other(
            "relay returned a Factory run head for a different run".into(),
        ));
    }
    let expected_d_tag = factory_run_d_tag(head.run_id);
    let d_tags = signed_event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if signed_event.tags.len() != 1
        || d_tags.len() != 1
        || d_tags[0].content() != Some(expected_d_tag.as_str())
    {
        return Err(CliError::Other(
            "relay returned a Factory run head with an invalid d-tag".into(),
        ));
    }
    Ok(FactoryHeadEvent {
        id: signed_event.id.to_hex(),
        event,
    })
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let json = read_or_stdin(input)?;
    serde_json::from_str(&json)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}
