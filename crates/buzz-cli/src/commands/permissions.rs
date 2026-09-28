use buzz_core::company_records::{
    tool_permission_d_tag, ToolPermissionAction, ToolPermissionCommandKind, ToolPermissionHead,
    ToolPermissionRecord, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_TOOL_PERMISSION_HEAD;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::client::{create_response_with_id_if_accepted, normalize_events, BuzzClient};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::{parse_event_id, parse_uuid, read_or_stdin};
use crate::PermissionsCmd;

const PERMISSION_QUERY_BOUND: u32 = 10_000;

/// Query and mutate community-wide standing tool permissions.
pub async fn dispatch(command: PermissionsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        PermissionsCmd::List { agent } => list(client, agent.as_deref()).await,
        PermissionsCmd::Grant { record } => grant(client, &record).await,
        PermissionsCmd::Revoke {
            permission,
            expected_head_event_id,
            reason,
        } => revoke(client, &permission, &expected_head_event_id, &reason).await,
    }
}

async fn list(client: &BuzzClient, agent: Option<&str>) -> Result<(), CliError> {
    let events = query_permission_events(client, agent).await?;
    println!("{}", normalize_events(&events));
    Ok(())
}

async fn grant(client: &BuzzClient, record_input: &str) -> Result<(), CliError> {
    let record: ToolPermissionRecord = read_json(record_input, "tool permission record")?;
    let permission_id = record.permission_id;
    let action = ToolPermissionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        permission_id,
        action: ToolPermissionCommandKind::Grant,
        expected_head_event_id: None,
        permission: Some(record),
        reason: None,
    };
    let builder = buzz_sdk::company_records::build_tool_permission_action(&action)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, "permission already exists")?;
    println!(
        "{}",
        create_response_with_id_if_accepted(&response, "permission_id", &permission_id.to_string(),)
    );
    Ok(())
}

async fn revoke(
    client: &BuzzClient,
    permission: &str,
    expected_head_event_id: &str,
    reason: &str,
) -> Result<(), CliError> {
    let permission_id = parse_uuid(permission)?;
    let expected_head_event_id = parse_event_id(expected_head_event_id)?.to_hex();
    let reason = read_or_stdin(reason)?;
    let action = ToolPermissionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        permission_id,
        action: ToolPermissionCommandKind::Revoke,
        expected_head_event_id: Some(expected_head_event_id),
        permission: None,
        reason: Some(reason),
    };
    let builder = buzz_sdk::company_records::build_tool_permission_action(&action)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    let normalized =
        parse_write_response(&response, "permission changed before it could be revoked")?;
    println!("{normalized}");
    Ok(())
}

async fn query_permission_events(
    client: &BuzzClient,
    agent: Option<&str>,
) -> Result<Vec<Value>, CliError> {
    let relay_self = relay_self(client).await?;
    let mut filter = json!({
        "kinds": [KIND_TOOL_PERMISSION_HEAD],
        "authors": [relay_self],
    });
    if let Some(agent) = agent {
        let agent = nostr::PublicKey::from_hex(agent)
            .map_err(|_| CliError::Usage("--agent must be a 64-character public key".into()))?
            .to_hex();
        filter["#p"] = json!([agent]);
    }
    let events = client
        .query_all_bounded(filter, PERMISSION_QUERY_BOUND)
        .await?;
    for event in &events {
        verify_permission_head_event(event, &relay_self)?;
    }
    Ok(events)
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let nip11_raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&nip11_raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let self_hex = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    nostr::PublicKey::from_hex(self_hex)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|_| CliError::Other("relay 'self' field is not a valid public key".into()))
}

fn verify_permission_head_event(event: &Value, relay_self: &str) -> Result<(), CliError> {
    let signed_event: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("permission head event is malformed: {error}")))?;
    if signed_event.kind != nostr::Kind::Custom(KIND_TOOL_PERMISSION_HEAD as u16) {
        return Err(CliError::Other(
            "permission head event has the wrong kind".into(),
        ));
    }
    if signed_event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "permission head author does not match the relay self key".into(),
        ));
    }
    signed_event.verify().map_err(|error| {
        CliError::Other(format!("permission head signature is invalid: {error}"))
    })?;

    let d_tags = tag_values(&signed_event, "d");
    let p_tags = tag_values(&signed_event, "p");
    if d_tags.len() != 1 || p_tags.len() != 1 || signed_event.tags.len() != 2 {
        return Err(CliError::Other(
            "permission head must have exactly one d tag and one p tag".into(),
        ));
    }
    let head: ToolPermissionHead = serde_json::from_str(&signed_event.content)
        .map_err(|error| CliError::Other(format!("permission head content is invalid: {error}")))?;
    if d_tags[0] != tool_permission_d_tag(head.permission_id)
        || p_tags[0] != head.permission.agent_pubkey
        || head.permission.permission_id != head.permission_id
    {
        return Err(CliError::Other(
            "permission head tags do not match its content".into(),
        ));
    }
    Ok(())
}

fn tag_values(event: &nostr::Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == name)
        .filter_map(|tag| tag.content().map(str::to_owned))
        .collect()
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let json = read_or_stdin(input)?;
    serde_json::from_str(&json)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::{
        ToolPermissionScope, ToolPermissionScopeKind, ToolPermissionVerb,
    };
    use clap::Parser;
    use nostr::{EventBuilder, Kind, Tag};
    use uuid::Uuid;

    #[test]
    fn verifies_relay_signature_and_permission_coordinates() {
        let relay = nostr::Keys::generate();
        let agent = nostr::Keys::generate();
        let permission_id = Uuid::new_v4();
        let head = ToolPermissionHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            status: buzz_core::company_records::ToolPermissionStatus::Active,
            permission: ToolPermissionRecord {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                permission_id,
                agent_pubkey: agent.public_key().to_hex(),
                action: ToolPermissionVerb::DeleteData.permission_key().into(),
                scope: ToolPermissionScope {
                    kind: ToolPermissionScopeKind::Thread,
                    id: "ab".repeat(32),
                },
                expires_at: "2026-10-01T12:00:00Z".into(),
            },
            granted_by_pubkey: relay.public_key().to_hex(),
            changed_by_pubkey: relay.public_key().to_hex(),
            updated_at: "2026-09-28T12:00:00Z".into(),
            source_action_event_id: "cd".repeat(32),
        };
        let event = EventBuilder::new(
            Kind::Custom(KIND_TOOL_PERMISSION_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tags([
            Tag::parse(["d", tool_permission_d_tag(permission_id).as_str()]).expect("d tag"),
            Tag::parse(["p", agent.public_key().to_hex().as_str()]).expect("p tag"),
        ])
        .sign_with_keys(&relay)
        .expect("sign head");
        let value = serde_json::to_value(&event).expect("event JSON");

        assert!(verify_permission_head_event(&value, &relay.public_key().to_hex()).is_ok());

        let other_relay = nostr::Keys::generate();
        assert!(verify_permission_head_event(&value, &other_relay.public_key().to_hex()).is_err());
    }

    #[test]
    fn permission_cli_parses_list_grant_and_revoke() {
        assert!(crate::Cli::try_parse_from(["buzz", "permissions", "list"]).is_ok());
        assert!(
            crate::Cli::try_parse_from(["buzz", "permissions", "grant", "--record", "-"]).is_ok()
        );
        let expected_head = "a".repeat(64);
        assert!(crate::Cli::try_parse_from([
            "buzz",
            "permissions",
            "revoke",
            "--permission",
            "00000000-0000-0000-0000-000000000001",
            "--expected-head-event-id",
            expected_head.as_str(),
            "--reason",
            "No longer needed",
        ])
        .is_ok());
    }
}
