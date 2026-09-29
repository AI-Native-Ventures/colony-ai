//! Read and update company member position records.

use buzz_core::company_members::{member_d_tag, MemberPositionHead};
use buzz_core::kind::KIND_MEMBER_POSITION_HEAD;
use serde_json::Value;

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;

const MEMBER_POSITION_QUERY_BOUND: u32 = 10_000;

pub async fn dispatch(cmd: crate::TeamCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::TeamCmd;
    match cmd {
        TeamCmd::List { limit } => cmd_list(client, limit).await,
        TeamCmd::Get { member } => cmd_get(client, &member).await,
        TeamCmd::SetPosition {
            member,
            title,
            manager,
            clear_manager,
        } => cmd_set_position(client, &member, title, manager, clear_manager).await,
        TeamCmd::SetTitle { member, title } => cmd_set_title(client, &member, &title).await,
        TeamCmd::SetManager {
            member,
            manager,
            clear_manager,
        } => cmd_set_manager(client, &member, manager, clear_manager).await,
    }
}

async fn cmd_list(client: &BuzzClient, limit: Option<u32>) -> Result<(), CliError> {
    let limit = limit.unwrap_or(MEMBER_POSITION_QUERY_BOUND);
    if limit > MEMBER_POSITION_QUERY_BOUND {
        return Err(CliError::Usage(format!(
            "limit must be at most {MEMBER_POSITION_QUERY_BOUND}"
        )));
    }
    let events = query_member_position_events(client).await?;
    println!(
        "{}",
        normalize_events(&events[..events.len().min(limit as usize)])
    );
    Ok(())
}

async fn cmd_get(client: &BuzzClient, member: &str) -> Result<(), CliError> {
    let member = normalize_member_pubkey(member)?;
    let event = current_member_position_event(client, &member).await?;
    println!("{}", normalize_events(std::slice::from_ref(&event)));
    Ok(())
}

async fn cmd_set_position(
    client: &BuzzClient,
    member: &str,
    title: Option<String>,
    manager: Option<String>,
    clear_manager: bool,
) -> Result<(), CliError> {
    let member = normalize_member_pubkey(member)?;
    let manager = parse_manager(manager, clear_manager)?;
    if title.is_none() && manager.is_none() {
        return Err(CliError::Usage(
            "set-position needs --title or --manager/--clear-manager".into(),
        ));
    }
    let current = current_member_position_event_optional(client, &member).await?;
    let action = buzz_core::company_members::MemberPositionAction {
        schema_version: buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: member,
        action: buzz_core::company_members::MemberPositionActionKind::SetPosition,
        expected_head_event_id: current.as_ref().map(event_id).transpose()?,
        title: title.map(|value| value.trim().to_owned()),
        manager_pubkey: manager,
        reason: None,
    };
    submit_member_action(client, &action).await
}

async fn cmd_set_title(client: &BuzzClient, member: &str, title: &str) -> Result<(), CliError> {
    let member = normalize_member_pubkey(member)?;
    let current = current_member_position_event(client, &member).await?;
    let action = buzz_core::company_members::MemberPositionAction {
        schema_version: buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: member,
        action: buzz_core::company_members::MemberPositionActionKind::SetTitle,
        expected_head_event_id: Some(event_id(&current)?),
        title: Some(title.trim().to_owned()),
        manager_pubkey: None,
        reason: None,
    };
    submit_member_action(client, &action).await
}

async fn cmd_set_manager(
    client: &BuzzClient,
    member: &str,
    manager: Option<String>,
    clear_manager: bool,
) -> Result<(), CliError> {
    let member = normalize_member_pubkey(member)?;
    let manager = parse_manager(manager, clear_manager)?
        .ok_or_else(|| CliError::Usage("set-manager needs --manager or --clear-manager".into()))?;
    let current = current_member_position_event(client, &member).await?;
    let action = buzz_core::company_members::MemberPositionAction {
        schema_version: buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: member,
        action: buzz_core::company_members::MemberPositionActionKind::SetManager,
        expected_head_event_id: Some(event_id(&current)?),
        title: None,
        manager_pubkey: Some(manager),
        reason: None,
    };
    submit_member_action(client, &action).await
}

fn parse_manager(
    manager: Option<String>,
    clear_manager: bool,
) -> Result<Option<Option<String>>, CliError> {
    if manager.is_some() && clear_manager {
        return Err(CliError::Usage(
            "--manager and --clear-manager cannot be used together".into(),
        ));
    }
    if let Some(manager) = manager {
        return Ok(Some(Some(normalize_member_pubkey(&manager)?)));
    }
    Ok(clear_manager.then_some(None))
}

async fn current_member_position_event(
    client: &BuzzClient,
    member: &str,
) -> Result<Value, CliError> {
    current_member_position_event_optional(client, member)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("member position for {member} not found")))
}

async fn current_member_position_event_optional(
    client: &BuzzClient,
    member: &str,
) -> Result<Option<Value>, CliError> {
    for event in query_member_position_events(client).await? {
        let head = parse_member_position_head(&event)?;
        if head.pubkey == member {
            return Ok(Some(event));
        }
    }
    Ok(None)
}

async fn query_member_position_events(client: &BuzzClient) -> Result<Vec<Value>, CliError> {
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
    let relay_self = normalize_member_pubkey(relay_self)?;
    let events = client
        .query_all_bounded(
            serde_json::json!({
                "kinds": [KIND_MEMBER_POSITION_HEAD],
                "authors": [relay_self]
            }),
            MEMBER_POSITION_QUERY_BOUND,
        )
        .await?;
    for event in &events {
        verify_member_position_head_event(event, &relay_self)?;
    }
    Ok(events)
}

fn parse_member_position_head(event: &Value) -> Result<MemberPositionHead, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("member position head has no string content".into()))?;
    let head: MemberPositionHead = serde_json::from_str(content).map_err(|error| {
        CliError::Other(format!("member position head content is invalid: {error}"))
    })?;
    buzz_core::company_members::validate_member_position_head(&head)
        .map_err(|error| CliError::Other(format!("member position head is invalid: {error}")))?;
    Ok(head)
}

fn verify_member_position_head_event(event: &Value, relay_self: &str) -> Result<(), CliError> {
    let signed_event: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("member position event is malformed: {error}")))?;
    if signed_event.kind != nostr::Kind::Custom(KIND_MEMBER_POSITION_HEAD as u16) {
        return Err(CliError::Other(
            "member position event has the wrong kind".into(),
        ));
    }
    if signed_event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "member position event author does not match the relay self key".into(),
        ));
    }
    signed_event.verify().map_err(|error| {
        CliError::Other(format!("member position signature is invalid: {error}"))
    })?;
    let d_tags = signed_event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if d_tags.len() != 1 || signed_event.tags.len() != 1 {
        return Err(CliError::Other(
            "member position head must have exactly one d tag".into(),
        ));
    }
    let head = parse_member_position_head(event)?;
    let expected_d_tag = member_d_tag(&head.pubkey)
        .map_err(|error| CliError::Other(format!("member pubkey is invalid: {error}")))?;
    if d_tags[0].content() != Some(expected_d_tag.as_str()) {
        return Err(CliError::Other(
            "member position d-tag does not match its content".into(),
        ));
    }
    Ok(())
}

fn normalize_member_pubkey(value: &str) -> Result<String, CliError> {
    let value = value.trim();
    validate_hex64(value)?;
    nostr::PublicKey::from_hex(value)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid member pubkey: {error}")))
}

fn event_id(event: &Value) -> Result<String, CliError> {
    event
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CliError::Other("member position event has no id".into()))
}

async fn submit_member_action(
    client: &BuzzClient,
    action: &buzz_core::company_members::MemberPositionAction,
) -> Result<(), CliError> {
    let builder = buzz_sdk::company_members::build_member_position_action(action)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_members::{MemberKind, MemberStatus};
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn signed_head_event(relay: &Keys, member: &Keys, d_tag: &str) -> nostr::Event {
        let head = MemberPositionHead {
            schema_version: 1,
            pubkey: member.public_key().to_hex(),
            title: "Operations lead".into(),
            manager_pubkey: None,
            kind: MemberKind::Human,
            status: MemberStatus::Active,
            reason: None,
            source_action_event_id: "b".repeat(64),
            updated_at: "2026-09-28T08:00:00Z".into(),
        };
        EventBuilder::new(
            Kind::Custom(KIND_MEMBER_POSITION_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tag(Tag::parse(["d", d_tag]).expect("valid d tag"))
        .sign_with_keys(relay)
        .expect("sign head")
    }

    #[test]
    fn member_head_verification_binds_relay_signature_and_coordinate() {
        let relay = Keys::generate();
        let member = Keys::generate();
        let d_tag = member_d_tag(&member.public_key().to_hex()).expect("member d-tag");
        let event = signed_head_event(&relay, &member, &d_tag);
        let value = serde_json::to_value(event).expect("event JSON");

        verify_member_position_head_event(&value, &relay.public_key().to_hex())
            .expect("valid member head");
        assert!(
            verify_member_position_head_event(&value, &Keys::generate().public_key().to_hex())
                .is_err()
        );

        let wrong_coordinate = signed_head_event(&relay, &member, "company:member:wrong");
        let wrong_coordinate = serde_json::to_value(wrong_coordinate).expect("event JSON");
        assert!(
            verify_member_position_head_event(&wrong_coordinate, &relay.public_key().to_hex())
                .is_err()
        );
    }

    #[test]
    fn member_pubkeys_and_manager_clear_are_normalized_and_checked() {
        let member = Keys::generate().public_key().to_hex();
        assert_eq!(
            normalize_member_pubkey(&member.to_uppercase()).unwrap(),
            member
        );
        assert!(normalize_member_pubkey("not-a-pubkey").is_err());
        assert_eq!(parse_manager(None, true).unwrap(), Some(None));
        assert!(parse_manager(Some(member), true).is_err());
    }
}
