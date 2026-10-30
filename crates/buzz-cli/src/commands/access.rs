//! Agent-first commands for the company access list and capability gaps.
//!
//! `colony access list` shows every tool and account Scout and agents can use.
//! Colony-run tools (WhatsApp, Discovery, credits) are always listed; they are
//! active until the owner revokes them. New access never comes from an agent
//! directly: Scout records a capability gap with `colony access gap propose`,
//! the owner approves its cost and does the one human step, then Scout
//! finishes the setup with `colony access gap complete`.

use buzz_core::company_access::{
    access_d_tag, builtin_access_entry, gap_d_tag, parse_access_d_tag, slot_hire_d_tag,
    validate_access_head, validate_capability_gap, validate_capability_gap_head, AccessAction,
    AccessCategory, AccessEntry, AccessHead, AccessOp, AccessRecordRef, AccessState, CapabilityGap,
    CapabilityGapHead,
};
use buzz_core::company_functions::CompanyFunction;
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_COMPANY_ACCESS_HEAD;
use nostr::Event;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::cofounder::{head_d_tag, map_write_error, query_company_heads, relay_self};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::{read_or_stdin, sdk_err};
use crate::{AccessCmd, GapCmd};

/// Upper bound on access family heads one list may return.
const ACCESS_HEAD_QUERY_BOUND: u32 = 500;

pub async fn dispatch(command: AccessCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        AccessCmd::List => {
            let heads = load_all_heads(client).await?;
            println!("{}", Value::Array(access_rows(&heads.access)));
            Ok(())
        }
        AccessCmd::Grant {
            id,
            name,
            category,
            used_for,
            cost,
            agents,
        } => {
            let category = parse_category(&category)?;
            let agents = agents
                .iter()
                .map(|agent| parse_pubkey(agent))
                .collect::<Result<Vec<_>, _>>()?;
            let entry = AccessEntry {
                name,
                category,
                used_for,
                agents,
                cost,
            };
            let expected = head_event_id(client, &access_d_tag(&id)).await?;
            write(
                client,
                AccessAction {
                    entry: Some(entry),
                    access_id: Some(id),
                    expected_head_event_id: expected,
                    ..blank(AccessOp::Grant)
                },
                "access entry changed before it was saved",
            )
            .await
        }
        AccessCmd::Revoke { id, reason } => {
            let expected = head_event_id(client, &access_d_tag(&id)).await?;
            write(
                client,
                AccessAction {
                    access_id: Some(id),
                    reason,
                    expected_head_event_id: expected,
                    ..blank(AccessOp::Revoke)
                },
                "access entry changed before it was revoked",
            )
            .await
        }
        AccessCmd::Gap(gap) => dispatch_gap(gap, client).await,
    }
}

async fn dispatch_gap(command: GapCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        GapCmd::Propose { gap } => {
            let input = read_or_stdin(&gap)?;
            let gap: CapabilityGap = serde_json::from_str(&input).map_err(|error| {
                CliError::Usage(format!("invalid capability gap JSON: {error}"))
            })?;
            validate_capability_gap(&gap)
                .map_err(|error| CliError::Usage(format!("capability gap is invalid: {error}")))?;
            let gap_id = Uuid::new_v4();
            let action = AccessAction {
                gap_id: Some(gap_id),
                gap: Some(gap),
                ..blank(AccessOp::GapPropose)
            };
            let response = submit(client, &action, "capability gap was rejected").await?;
            println!(
                "{}",
                crate::client::create_response_with_id_if_accepted(
                    &response,
                    "gap_id",
                    &gap_id.to_string(),
                )
            );
            Ok(())
        }
        GapCmd::List => {
            let heads = load_all_heads(client).await?;
            println!("{}", Value::Array(gap_rows(&heads.gaps)));
            Ok(())
        }
        GapCmd::Show { gap_id } => {
            let id = parse_gap_id(&gap_id)?;
            let heads = load_gap_heads(client, &[id]).await?;
            match heads.first() {
                Some((event, head)) => println!("{}", gap_row(event, head)),
                None => return Err(CliError::Usage(format!("no capability gap {id}"))),
            }
            Ok(())
        }
        GapCmd::Approve { gap_id } => gap_step(client, &gap_id, AccessOp::GapApprove, None).await,
        GapCmd::Decline { gap_id, reason } => {
            gap_step(client, &gap_id, AccessOp::GapDecline, reason).await
        }
        GapCmd::Done { gap_id } => gap_step(client, &gap_id, AccessOp::GapDone, None).await,
        GapCmd::Complete { gap_id } => gap_step(client, &gap_id, AccessOp::GapComplete, None).await,
    }
}

/// Reads the gap's current head and writes one step against it, so a
/// concurrent change is a write conflict.
async fn gap_step(
    client: &BuzzClient,
    gap_id: &str,
    op: AccessOp,
    reason: Option<String>,
) -> Result<(), CliError> {
    let id = parse_gap_id(gap_id)?;
    let heads = load_gap_heads(client, &[id]).await?;
    let (event, _) = heads
        .first()
        .ok_or_else(|| CliError::Usage(format!("no capability gap {id}")))?;
    write(
        client,
        AccessAction {
            gap_id: Some(id),
            reason,
            expected_head_event_id: Some(event.id.to_hex()),
            ..blank(op)
        },
        "capability gap changed before the step was saved",
    )
    .await
}

/// Records which function slot a hire proposal is for. Retry this when the
/// slot could not be recorded with the proposal.
pub(crate) async fn set_slot_hire(
    client: &BuzzClient,
    hire_id: Uuid,
    function: CompanyFunction,
) -> Result<(), CliError> {
    let expected = head_event_id(client, &slot_hire_d_tag(hire_id)).await?;
    write(
        client,
        AccessAction {
            hire_id: Some(hire_id),
            function: Some(function),
            expected_head_event_id: expected,
            ..blank(AccessOp::SlotHireSet)
        },
        "hire slot changed before it was saved",
    )
    .await
}

fn blank(op: AccessOp) -> AccessAction {
    AccessAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        op,
        access_id: None,
        gap_id: None,
        hire_id: None,
        entry: None,
        gap: None,
        function: None,
        reason: None,
        expected_head_event_id: None,
    }
}

async fn write(
    client: &BuzzClient,
    action: AccessAction,
    conflict_message: &str,
) -> Result<(), CliError> {
    let response = submit(client, &action, conflict_message).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

async fn submit(
    client: &BuzzClient,
    action: &AccessAction,
    message: &str,
) -> Result<String, CliError> {
    let builder = buzz_sdk::company_records::build_access_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, message)?;
    Ok(response)
}

async fn head_event_id(client: &BuzzClient, d_tag: &str) -> Result<Option<String>, CliError> {
    let events = query_company_heads(client, KIND_COMPANY_ACCESS_HEAD, &[d_tag.to_owned()]).await?;
    Ok(events.first().map(|event| event.id.to_hex()))
}

fn parse_category(value: &str) -> Result<AccessCategory, CliError> {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    serde_json::from_value(Value::String(normalized)).map_err(|_| {
        CliError::Usage(format!(
            "unknown category '{value}'; use whatsapp, discovery, credits, browser_login, \
             connected_account, calendar, esign, payment_link or other"
        ))
    })
}

fn parse_gap_id(value: &str) -> Result<Uuid, CliError> {
    Uuid::parse_str(value.trim()).map_err(|_| CliError::Usage("gap id must be a UUID".to_owned()))
}

fn parse_pubkey(value: &str) -> Result<String, CliError> {
    nostr::PublicKey::parse(value.trim())
        .map(|pubkey| pubkey.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid agent public key: {error}")))
}

/// Access family heads grouped by record type.
struct Heads {
    access: Vec<(Event, AccessHead)>,
    gaps: Vec<(Event, CapabilityGapHead)>,
}

async fn load_all_heads(client: &BuzzClient) -> Result<Heads, CliError> {
    let relay = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [KIND_COMPANY_ACCESS_HEAD], "authors": [relay]}),
            ACCESS_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut heads = Heads {
        access: Vec::new(),
        gaps: Vec::new(),
    };
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("access head is malformed: {error}")))?;
        verify_head(&event, &relay)?;
        match parse_access_d_tag(&head_d_tag(&event))
            .map_err(|error| CliError::Other(format!("access head d-tag is invalid: {error}")))?
        {
            AccessRecordRef::Access(_) => heads.access.push(parse_access_head(event)?),
            AccessRecordRef::Gap(_) => heads.gaps.push(parse_gap_head(event)?),
            // Slot hire intents are read with their hire, not listed here.
            AccessRecordRef::SlotHire(_) => {}
        }
    }
    Ok(heads)
}

async fn load_gap_heads(
    client: &BuzzClient,
    ids: &[Uuid],
) -> Result<Vec<(Event, CapabilityGapHead)>, CliError> {
    let d_tags = ids.iter().map(|id| gap_d_tag(*id)).collect::<Vec<_>>();
    let events = query_company_heads(client, KIND_COMPANY_ACCESS_HEAD, &d_tags).await?;
    events.into_iter().map(parse_gap_head).collect()
}

fn verify_head(event: &Event, relay: &str) -> Result<(), CliError> {
    if u32::from(event.kind.as_u16()) != KIND_COMPANY_ACCESS_HEAD || event.pubkey.to_hex() != relay
    {
        return Err(CliError::Other(
            "access head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("access head signature is invalid: {error}")))?;
    let d_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .count();
    if event.tags.len() != 1 || d_count != 1 {
        return Err(CliError::Other(
            "access head tags do not match its d-tag".into(),
        ));
    }
    Ok(())
}

fn parse_access_head(event: Event) -> Result<(Event, AccessHead), CliError> {
    let head = serde_json::from_str::<AccessHead>(&event.content)
        .map_err(|error| CliError::Other(format!("access head content is invalid: {error}")))?;
    validate_access_head(&head)
        .map_err(|error| CliError::Other(format!("access head is invalid: {error}")))?;
    if access_d_tag(&head.access_id) != head_d_tag(&event) {
        return Err(CliError::Other(
            "access head does not match its d-tag".into(),
        ));
    }
    Ok((event, head))
}

fn parse_gap_head(event: Event) -> Result<(Event, CapabilityGapHead), CliError> {
    let head = serde_json::from_str::<CapabilityGapHead>(&event.content).map_err(|error| {
        CliError::Other(format!("capability gap head content is invalid: {error}"))
    })?;
    validate_capability_gap_head(&head)
        .map_err(|error| CliError::Other(format!("capability gap head is invalid: {error}")))?;
    if gap_d_tag(head.gap_id) != head_d_tag(&event) {
        return Err(CliError::Other(
            "capability gap head does not match its d-tag".into(),
        ));
    }
    Ok((event, head))
}

/// One JSON row per access entry. WhatsApp, Discovery and credits are always
/// listed: active unless a head says revoked. The rest are listed from their
/// heads, in the order of their access ids.
pub(crate) fn access_rows(heads: &[(Event, AccessHead)]) -> Vec<Value> {
    let mut rows: Vec<Value> = Vec::new();
    for id in ["whatsapp", "discovery", "credits"] {
        let found = heads.iter().find(|(_, head)| head.access_id == id);
        match (found, builtin_access_entry(id)) {
            (Some((event, head)), _) => rows.push(access_row(Some(event), head)),
            (None, Some(entry)) => rows.push(json!({
                "accessId": id,
                "name": entry.name,
                "category": entry.category,
                "usedFor": entry.used_for,
                "agents": entry.agents,
                "cost": entry.cost,
                "state": AccessState::Active,
                "builtin": true,
                "headEventId": null,
            })),
            (None, None) => {}
        }
    }
    let mut others: Vec<&(Event, AccessHead)> = heads
        .iter()
        .filter(|(_, head)| builtin_access_entry(&head.access_id).is_none())
        .collect();
    others.sort_by(|a, b| a.1.access_id.cmp(&b.1.access_id));
    for (event, head) in others {
        rows.push(access_row(Some(event), head));
    }
    rows
}

fn access_row(event: Option<&Event>, head: &AccessHead) -> Value {
    json!({
        "accessId": head.access_id,
        "name": head.entry.name,
        "category": head.entry.category,
        "usedFor": head.entry.used_for,
        "agents": head.entry.agents,
        "cost": head.entry.cost,
        "state": head.state,
        "builtin": builtin_access_entry(&head.access_id).is_some(),
        "headEventId": event.map(|event| event.id.to_hex()),
        "grantedByPubkey": head.granted_by_pubkey,
        "viaGapId": head.via_gap_id,
        "revokedByPubkey": head.revoked_by_pubkey,
        "revokeReason": head.revoke_reason,
    })
}

/// One JSON row per capability gap, newest first.
pub(crate) fn gap_rows(heads: &[(Event, CapabilityGapHead)]) -> Vec<Value> {
    let mut ordered: Vec<&(Event, CapabilityGapHead)> = heads.iter().collect();
    ordered.sort_by_key(|entry| std::cmp::Reverse(entry.1.proposed_at));
    ordered
        .into_iter()
        .map(|(event, head)| gap_row(event, head))
        .collect()
}

fn gap_row(event: &Event, head: &CapabilityGapHead) -> Value {
    json!({
        "gapId": head.gap_id,
        "state": head.state,
        "title": head.gap.title,
        "need": head.gap.need,
        "chosen": head.gap.chosen_option(),
        "options": head.gap.options,
        "humanStep": head.gap.human_step,
        "pageUrl": head.gap.page_url,
        "accessId": head.gap.access_id,
        "proposedByPubkey": head.proposed_by_pubkey,
        "approvedCostCents": head.approved_cost_cents,
        "headEventId": event.id.to_hex(),
    })
}

#[cfg(test)]
mod tests {
    use buzz_core::company_access::GapOption;
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn head(id: &str, category: AccessCategory, state: AccessState) -> (Event, AccessHead) {
        let revoked = state == AccessState::Revoked;
        let head = AccessHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            access_id: id.to_owned(),
            entry: AccessEntry {
                name: format!("Entry {id}"),
                category,
                used_for: "Testing".into(),
                agents: vec![],
                cost: "Free".into(),
            },
            state,
            granted_by_pubkey: "a".repeat(64),
            granted_at: 1_700_000_000,
            via_gap_id: None,
            revoked_by_pubkey: revoked.then(|| "b".repeat(64)),
            revoked_at: revoked.then_some(1_700_000_100),
            revoke_reason: None,
            updated_at: 1_700_000_100,
        };
        let event = EventBuilder::new(
            Kind::Custom(KIND_COMPANY_ACCESS_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tag(Tag::parse(["d", access_d_tag(id).as_str()]).expect("d tag"))
        .sign_with_keys(&Keys::generate())
        .expect("sign head");
        (event, head)
    }

    #[test]
    fn access_list_always_shows_the_colony_run_tools() {
        let rows = access_rows(&[]);
        let ids: Vec<&str> = rows
            .iter()
            .map(|row| row["accessId"].as_str().expect("access id"))
            .collect();
        assert_eq!(ids, ["whatsapp", "discovery", "credits"]);
        assert!(rows.iter().all(|row| row["state"] == json!("active")));
        assert!(rows.iter().all(|row| row["builtin"] == json!(true)));
    }

    #[test]
    fn access_list_shows_a_revoked_builtin_and_other_entries_in_order() {
        let heads = vec![
            head(
                "pinterest",
                AccessCategory::BrowserLogin,
                AccessState::Active,
            ),
            head("discovery", AccessCategory::Discovery, AccessState::Revoked),
            head("gmail", AccessCategory::BrowserLogin, AccessState::Active),
        ];
        let rows = access_rows(&heads);
        let ids: Vec<&str> = rows
            .iter()
            .map(|row| row["accessId"].as_str().expect("access id"))
            .collect();
        assert_eq!(
            ids,
            ["whatsapp", "discovery", "credits", "gmail", "pinterest"]
        );
        assert_eq!(rows[1]["state"], json!("revoked"));
        assert_eq!(rows[0]["state"], json!("active"));
        assert_eq!(rows[3]["builtin"], json!(false));
    }

    #[test]
    fn category_accepts_dash_and_rejects_unknown() {
        assert_eq!(
            parse_category("browser-login").expect("category"),
            AccessCategory::BrowserLogin
        );
        assert!(parse_category("telepathy").is_err());
    }

    #[test]
    fn gap_commands_parse() {
        let id = Uuid::new_v4().to_string();
        assert!(parse(&["access", "list"]).is_ok());
        assert!(parse(&["access", "gap", "list"]).is_ok());
        assert!(parse(&["access", "gap", "show", id.as_str()]).is_ok());
        assert!(parse(&["access", "gap", "approve", id.as_str()]).is_ok());
        assert!(parse(&["access", "gap", "done", id.as_str()]).is_ok());
        assert!(parse(&["access", "gap", "complete", id.as_str()]).is_ok());
        assert!(parse(&["access", "gap", "propose"]).is_err());
        assert!(parse_gap_id("nope").is_err());
        assert!(parse_gap_id(&id).is_ok());
    }

    #[test]
    fn revoke_needs_an_id_and_grant_needs_its_fields() {
        assert!(parse(&["access", "revoke"]).is_err());
        let ok = parse(&["access", "revoke", "whatsapp", "--reason", "paused"]).expect("parse");
        assert!(matches!(
            ok.command,
            Cmd::Access(AccessCmd::Revoke { ref id, .. }) if id == "whatsapp"
        ));
        assert!(parse(&["access", "grant", "--id", "gmail"]).is_err());
        assert!(parse(&[
            "access",
            "grant",
            "--id",
            "gmail",
            "--name",
            "Gmail",
            "--category",
            "browser-login",
            "--used-for",
            "Reading client emails",
            "--cost",
            "Free",
        ])
        .is_ok());
    }

    #[test]
    fn gap_rows_come_newest_first_and_show_the_chosen_option() {
        let gap = CapabilityGap {
            title: "Sign up".into(),
            need: "Agreements".into(),
            options: vec![GapOption {
                name: "Free sign".into(),
                cost_text: "Free".into(),
                cost_cents: 0,
                recurring: false,
                works: true,
                note: None,
            }],
            chosen: 0,
            chosen_reason: None,
            human_step: "Choose a password".into(),
            page_url: None,
            access_id: "esign".into(),
            access: AccessEntry {
                name: "E-sign".into(),
                category: AccessCategory::Esign,
                used_for: "Agreements".into(),
                agents: vec![],
                cost: "Free".into(),
            },
        };
        let make = |proposed_at: i64| {
            let head = CapabilityGapHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                gap_id: Uuid::new_v4(),
                gap: gap.clone(),
                state: buzz_core::company_access::GapState::Proposed,
                proposed_by_pubkey: "c".repeat(64),
                proposed_at,
                approved_by_pubkey: None,
                approved_at: None,
                approved_cost_cents: None,
                human_done_at: None,
                completed_at: None,
                declined_reason: None,
                updated_at: proposed_at,
            };
            let event = EventBuilder::new(
                Kind::Custom(KIND_COMPANY_ACCESS_HEAD as u16),
                serde_json::to_string(&head).expect("serialize"),
            )
            .tag(Tag::parse(["d", gap_d_tag(head.gap_id).as_str()]).expect("d tag"))
            .sign_with_keys(&Keys::generate())
            .expect("sign");
            (event, head)
        };
        let older = make(10);
        let newer = make(20);
        let newer_id = newer.1.gap_id;
        let rows = gap_rows(&[older, newer]);
        assert_eq!(rows[0]["gapId"], json!(newer_id));
        assert_eq!(rows[0]["chosen"]["name"], json!("Free sign"));
        assert_eq!(rows[0]["state"], json!("proposed"));
    }
}
