//! Payment links for agents: `colony pay`.
//!
//! Scout can only ask for money. These commands draft a card the owner approves, propose the
//! recipes the owner approves, run an approved recipe, record what the browser route created,
//! and report a payment. There is no approve, confirm, refund, payout or transfer command: the
//! relay refuses all of those for an agent, and refuses a recipe that tries them.
//! Contract: `docs/money-rails-pay-contract.md`.

use std::path::Path;

use nostr::{EventBuilder, Kind, Tag};
use serde_json::{json, Value};
use uuid::Uuid;

use buzz_core::kind::{KIND_MONEY_CONNECTION_ACTION, KIND_PAYMENT_LINK_ACTION};
use buzz_core::money_rails::connection::{ConnectionAction, ConnectionOp};
use buzz_core::money_rails::link::{LinkAction, LinkOp, RecipientInput, ReportSource};
use buzz_core::money_rails::notice::NoticeMap;
use buzz_core::money_rails::recipe::Recipe;
use buzz_core::money_rails::{
    connection_d_tag, link_d_tag, RecipientChannel, MONEY_RAILS_SCHEMA_VERSION,
};

use crate::client::{normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::parse_uuid;
use crate::{PayCmd, PayReportSource};

const QUERY_PATH: &str = "/api/money-rails/query";
const RUN_PATH: &str = "/api/money-rails/run";
const STEP_PATH: &str = "/api/money-rails/browser-step";
const MAX_JSON_FILE_BYTES: u64 = 256 * 1024;

pub async fn dispatch(cmd: PayCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        PayCmd::Connections => query(client, json!({ "what": "connections" })).await,
        PayCmd::Cards {
            state,
            party,
            invoice,
            limit,
        } => {
            let invoice = invoice.as_deref().map(parse_uuid).transpose()?;
            query(
                client,
                json!({
                    "what": "links",
                    "state": state,
                    "partyId": party,
                    "invoiceId": invoice,
                    "limit": limit,
                }),
            )
            .await
        }
        PayCmd::Card { card } => {
            let link_id = parse_uuid(&card)?;
            let (head_event_id, link) = fetch_card(client, link_id).await?;
            println!("{}", json!({ "headEventId": head_event_id, "link": link }));
            Ok(())
        }
        PayCmd::Draft {
            party,
            invoice,
            amount,
            currency,
            purpose,
            to_whatsapp,
            to_email,
            name,
            message,
            connection,
            expires_days,
            card_id,
        } => {
            let recipient = recipient(to_whatsapp, to_email, Some(name))?
                .ok_or_else(|| CliError::Usage("name --to-whatsapp or --to-email".into()))?;
            let link_id = match card_id {
                Some(id) => parse_uuid(&id)?,
                None => Uuid::new_v4(),
            };
            let mut action = blank(LinkOp::Draft, link_id, None);
            action.party_id = Some(party);
            action.invoice_id = Some(parse_uuid(&invoice)?);
            action.amount_minor = Some(amount);
            action.currency = Some(currency.to_ascii_uppercase());
            action.purpose = Some(purpose);
            action.connection_id = connection.as_deref().map(parse_uuid).transpose()?;
            action.recipient = Some(recipient);
            action.message = Some(message);
            action.expires_in_days = expires_days;
            publish_link(client, &action).await?;
            eprintln!("card id: {link_id}");
            Ok(())
        }
        PayCmd::Edit {
            card,
            amount,
            purpose,
            message,
            to_whatsapp,
            to_email,
            name,
            expires_days,
            expected,
        } => {
            let link_id = parse_uuid(&card)?;
            let expected = expected_head(client, link_id, expected).await?;
            let mut action = blank(LinkOp::Edit, link_id, Some(expected));
            action.amount_minor = amount;
            action.purpose = purpose;
            action.message = message;
            action.recipient = recipient(to_whatsapp, to_email, name)?;
            action.expires_in_days = expires_days;
            publish_link(client, &action).await
        }
        PayCmd::Submit { card, expected } => {
            let link_id = parse_uuid(&card)?;
            let expected = expected_head(client, link_id, expected).await?;
            publish_link(client, &blank(LinkOp::Submit, link_id, Some(expected))).await
        }
        PayCmd::Cancel {
            card,
            reason,
            expected,
        } => {
            let link_id = parse_uuid(&card)?;
            let expected = expected_head(client, link_id, expected).await?;
            let mut action = blank(LinkOp::Cancel, link_id, Some(expected));
            action.reason = reason;
            publish_link(client, &action).await
        }
        PayCmd::RecipePropose { connection, file } => {
            let connection_id = parse_uuid(&connection)?;
            let recipe: Recipe = read_json_file(&file)?;
            let mut action = connection_action(ConnectionOp::ProposeRecipe, connection_id);
            action.expected_head_event_id = Some(connection_head(client, connection_id).await?);
            action.recipe = Some(recipe);
            publish_connection(client, &action).await
        }
        PayCmd::NoticeMapPropose { connection, file } => {
            let connection_id = parse_uuid(&connection)?;
            let map: NoticeMap = read_json_file(&file)?;
            let mut action = connection_action(ConnectionOp::ProposeNoticeMap, connection_id);
            action.expected_head_event_id = Some(connection_head(client, connection_id).await?);
            action.notice_map = Some(map);
            publish_connection(client, &action).await
        }
        PayCmd::Run {
            card,
            recipe,
            reference,
        } => {
            let raw = client
                .post_json_authed(
                    RUN_PATH,
                    &json!({
                        "linkId": parse_uuid(&card)?,
                        "recipeId": recipe,
                        "providerReference": reference,
                    }),
                )
                .await?;
            println!("{raw}");
            Ok(())
        }
        PayCmd::Created {
            card,
            url,
            reference,
            shown_amount,
            shown_currency,
            expected,
        } => {
            let link_id = parse_uuid(&card)?;
            let expected = expected_head(client, link_id, expected).await?;
            let mut action = blank(LinkOp::RecordCreated, link_id, Some(expected));
            action.url = Some(url);
            action.provider_reference = reference;
            action.shown_amount_minor = Some(shown_amount);
            action.shown_currency = Some(shown_currency.to_ascii_uppercase());
            publish_link(client, &action).await
        }
        PayCmd::Report {
            card,
            source,
            reference,
            amount,
            currency,
            note,
            expected,
        } => {
            let link_id = parse_uuid(&card)?;
            let expected = expected_head(client, link_id, expected).await?;
            let mut action = blank(LinkOp::ReportPayment, link_id, Some(expected));
            action.source = Some(match source {
                PayReportSource::Dashboard => ReportSource::Dashboard,
                PayReportSource::Gmail => ReportSource::Gmail,
                PayReportSource::ClientMessage => ReportSource::ClientMessage,
            });
            action.provider_reference = reference;
            action.amount_minor = amount;
            action.currency = currency.map(|code| code.to_ascii_uppercase());
            action.note = Some(note);
            publish_link(client, &action).await
        }
        PayCmd::StepCheck {
            card,
            host,
            url,
            label,
            kind,
        } => {
            let raw = client
                .post_json_authed(
                    STEP_PATH,
                    &json!({
                        "linkId": parse_uuid(&card)?,
                        "host": host,
                        "url": url,
                        "label": label,
                        "kind": kind,
                    }),
                )
                .await?;
            println!("{raw}");
            Ok(())
        }
    }
}

async fn query(client: &BuzzClient, body: Value) -> Result<(), CliError> {
    let raw = client.post_json_authed(QUERY_PATH, &body).await?;
    println!("{raw}");
    Ok(())
}

fn blank(op: LinkOp, link_id: Uuid, expected: Option<String>) -> LinkAction {
    LinkAction {
        schema_version: MONEY_RAILS_SCHEMA_VERSION,
        op,
        link_id,
        expected_head_event_id: expected,
        party_id: None,
        invoice_id: None,
        amount_minor: None,
        currency: None,
        purpose: None,
        connection_id: None,
        recipient: None,
        message: None,
        expires_in_days: None,
        facts: None,
        reason: None,
        note: None,
        url: None,
        provider_reference: None,
        shown_amount_minor: None,
        shown_currency: None,
        source: None,
    }
}

fn connection_action(op: ConnectionOp, connection_id: Uuid) -> ConnectionAction {
    ConnectionAction {
        schema_version: MONEY_RAILS_SCHEMA_VERSION,
        op,
        connection_id,
        expected_head_event_id: None,
        provider: None,
        label: None,
        browser_hosts: None,
        recipe: None,
        recipe_id: None,
        recipe_hash: None,
        notice_map: None,
        map_hash: None,
    }
}

fn recipient(
    whatsapp: Option<String>,
    email: Option<String>,
    name: Option<String>,
) -> Result<Option<RecipientInput>, CliError> {
    let (channel, address) = match (whatsapp, email) {
        (Some(number), None) => (RecipientChannel::Whatsapp, number),
        (None, Some(address)) => (RecipientChannel::Email, address),
        (None, None) => return Ok(None),
        (Some(_), Some(_)) => {
            return Err(CliError::Usage(
                "name either --to-whatsapp or --to-email, not both".into(),
            ))
        }
    };
    let name = name.ok_or_else(|| CliError::Usage("name the recipient with --name".into()))?;
    Ok(Some(RecipientInput {
        channel,
        address,
        name,
    }))
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, CliError> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| CliError::Usage(format!("cannot read {}: {error}", path.display())))?;
    if metadata.len() > MAX_JSON_FILE_BYTES {
        return Err(CliError::Usage(format!(
            "{} is larger than {MAX_JSON_FILE_BYTES} bytes",
            path.display()
        )));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|error| CliError::Usage(format!("cannot read {}: {error}", path.display())))?;
    serde_json::from_str(&text)
        .map_err(|error| CliError::Usage(format!("{} is not valid: {error}", path.display())))
}

/// The head event id and content of one card, read through the relay's role filtered query.
async fn fetch_card(client: &BuzzClient, link_id: Uuid) -> Result<(String, Value), CliError> {
    let raw = client
        .post_json_authed(QUERY_PATH, &json!({ "what": "links", "linkId": link_id }))
        .await?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("the relay answer was not JSON: {error}")))?;
    let first = value
        .get("links")
        .and_then(Value::as_array)
        .and_then(|links| links.first())
        .ok_or_else(|| CliError::Usage(format!("there is no card {link_id}")))?;
    let head_event_id = first
        .get("headEventId")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("the relay did not name the card head".into()))?
        .to_owned();
    Ok((
        head_event_id,
        first.get("link").cloned().unwrap_or(Value::Null),
    ))
}

async fn expected_head(
    client: &BuzzClient,
    link_id: Uuid,
    given: Option<String>,
) -> Result<String, CliError> {
    match given {
        Some(expected) => Ok(expected),
        None => Ok(fetch_card(client, link_id).await?.0),
    }
}

async fn connection_head(client: &BuzzClient, connection_id: Uuid) -> Result<String, CliError> {
    let raw = client
        .post_json_authed(QUERY_PATH, &json!({ "what": "connections" }))
        .await?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("the relay answer was not JSON: {error}")))?;
    value
        .get("connections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|entry| {
            entry
                .pointer("/connection/connectionId")
                .and_then(Value::as_str)
                == Some(connection_id.to_string().as_str())
        })
        .and_then(|entry| entry.get("headEventId").and_then(Value::as_str))
        .map(str::to_owned)
        .ok_or_else(|| CliError::Usage(format!("there is no connection {connection_id}")))
}

async fn publish_link(client: &BuzzClient, action: &LinkAction) -> Result<(), CliError> {
    let content = serde_json::to_string(action)
        .map_err(|error| CliError::Other(format!("could not build the command: {error}")))?;
    let builder = EventBuilder::new(Kind::Custom(KIND_PAYMENT_LINK_ACTION as u16), content)
        .tags([Tag::parse(["d", link_d_tag(action.link_id).as_str()])
            .map_err(|error| CliError::Other(format!("bad d tag: {error}")))?]);
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

async fn publish_connection(
    client: &BuzzClient,
    action: &ConnectionAction,
) -> Result<(), CliError> {
    let content = serde_json::to_string(action)
        .map_err(|error| CliError::Other(format!("could not build the command: {error}")))?;
    let builder = EventBuilder::new(Kind::Custom(KIND_MONEY_CONNECTION_ACTION as u16), content)
        .tags([
            Tag::parse(["d", connection_d_tag(action.connection_id).as_str()])
                .map_err(|error| CliError::Other(format!("bad d tag: {error}")))?,
        ]);
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recipient_needs_exactly_one_address_and_a_name() {
        assert!(recipient(None, None, None).expect("none").is_none());
        let both = recipient(
            Some("+27821234567".into()),
            Some("a@b.co".into()),
            Some("T".into()),
        );
        assert!(both.is_err());
        assert!(recipient(Some("+27821234567".into()), None, None).is_err());
        let ok = recipient(Some("+27821234567".into()), None, Some("Thandi".into()))
            .expect("ok")
            .expect("some");
        assert_eq!(ok.channel, RecipientChannel::Whatsapp);
    }

    #[test]
    fn commands_carry_the_head_and_the_card_d_tag() {
        let id = Uuid::from_u128(9);
        let action = blank(LinkOp::Submit, id, Some("a".repeat(64)));
        assert_eq!(action.d_tag(), link_d_tag(id));
        assert!(action.validate().is_ok());
        let draft = blank(LinkOp::Draft, id, None);
        assert!(draft.validate().is_ok());
        assert!(blank(LinkOp::Edit, id, None).validate().is_err());
    }

    #[test]
    fn there_is_no_command_that_approves_or_moves_money_out() {
        use clap::CommandFactory;
        let cmd = crate::Cli::command();
        let pay = cmd
            .get_subcommands()
            .find(|sub| sub.get_name() == "pay")
            .expect("pay group");
        for sub in pay.get_subcommands() {
            let name = sub.get_name();
            for forbidden in [
                "approve", "confirm", "refund", "payout", "transfer", "withdraw",
            ] {
                assert!(!name.contains(forbidden), "{name}");
            }
        }
    }
}
