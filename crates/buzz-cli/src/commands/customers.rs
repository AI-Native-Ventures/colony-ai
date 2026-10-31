//! Agent-first commands for the co-founder customer record: one record per
//! business across its life, from the lead found in Discovery to the client,
//! the project and the money.
//!
//! The relay builds the record from the company's own records, so an agent
//! never writes a number or a timeline line of those kinds. What an agent
//! writes is a milestone (a call booked, an agreement signed), an email it
//! copied from Gmail in the built-in browser, or a file reference. Converting a
//! lead to a client is for the owner, an admin or the Sales lead; the relay
//! refuses it from anyone else.

use buzz_core::company_customers::{
    customer_d_tag, parse_customer_d_tag, validate_customer_head, CustomerAction, CustomerOp,
    CustomerRecordHead, CustomerStage, MilestoneKind, MAX_EMAIL_SUMMARY_BYTES,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_CUSTOMER_HEAD;
use chrono::DateTime;
use nostr::Event;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::client::BuzzClient;
use crate::commands::cofounder::{map_write_error, query_company_heads, relay_self};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::CustomersCmd;

/// Upper bound on customer heads one query may return.
const CUSTOMER_HEAD_QUERY_BOUND: u32 = 5_000;

pub async fn dispatch(command: CustomersCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        CustomersCmd::List { stage } => {
            let stage = stage
                .as_deref()
                .map(|value| parse_name::<CustomerStage>(value, "stage"))
                .transpose()?;
            let records = load_all(client).await?;
            println!("{}", Value::Array(customer_rows(&records, stage)));
            Ok(())
        }
        CustomersCmd::Show {
            party_id,
            no_refresh,
        } => {
            if !no_refresh {
                // The relay recomputes at most once a minute. If it refuses
                // (co-founder mode off), the last stored record still reads.
                if let Err(error) = submit(client, &base(&party_id, CustomerOp::Refresh)).await {
                    eprintln!("could not refresh the record, showing the last one: {error}");
                }
            }
            let (event, head) = load_one(client, &party_id)
                .await?
                .ok_or_else(|| not_found(&party_id))?;
            println!("{}", customer_output(&event, &head));
            Ok(())
        }
        CustomersCmd::Convert { party_id, note } => {
            let action = CustomerAction {
                note,
                ..base(&party_id, CustomerOp::ConvertToClient)
            };
            write(client, action).await
        }
        CustomersCmd::Milestone {
            party_id,
            kind,
            at,
            title,
            note,
            file,
        } => {
            let action = CustomerAction {
                milestone_kind: Some(parse_name::<MilestoneKind>(&kind, "milestone kind")?),
                at: Some(parse_time(&at)?),
                title,
                note,
                file_ref: file,
                ..base(&party_id, CustomerOp::RecordMilestone)
            };
            write(client, action).await
        }
        CustomersCmd::AttachEmail {
            party_id,
            from,
            subject,
            date,
            summary,
            files,
        } => {
            let action = email_action(&party_id, from, subject, &date, summary, files)?;
            write(client, action).await
        }
        CustomersCmd::AttachFile {
            party_id,
            label,
            file,
        } => {
            let action = CustomerAction {
                label: Some(label),
                file_ref: Some(file),
                ..base(&party_id, CustomerOp::AttachFile)
            };
            write(client, action).await
        }
        CustomersCmd::RemoveAttachment {
            party_id,
            attachment_id,
        } => {
            let action = CustomerAction {
                attachment_id: Some(attachment_id),
                ..base(&party_id, CustomerOp::RemoveAttachment)
            };
            write(client, action).await
        }
    }
}

fn base(party_id: &str, op: CustomerOp) -> CustomerAction {
    CustomerAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        party_id: party_id.to_owned(),
        op,
        milestone_kind: None,
        at: None,
        title: None,
        note: None,
        file_ref: None,
        from: None,
        subject: None,
        date: None,
        summary: None,
        file_refs: None,
        label: None,
        attachment_id: None,
        expected_head_event_id: None,
    }
}

/// An `attach_email` action. A summary over 4 KB is refused before anything is
/// sent: the record keeps a short summary, never the whole email.
fn email_action(
    party_id: &str,
    from: String,
    subject: String,
    date: &str,
    summary: String,
    files: Vec<String>,
) -> Result<CustomerAction, CliError> {
    if summary.len() > MAX_EMAIL_SUMMARY_BYTES {
        return Err(CliError::Usage(format!(
            "the summary is {} bytes; keep it a short summary of at most {MAX_EMAIL_SUMMARY_BYTES} bytes (4 KB), not the whole email",
            summary.len()
        )));
    }
    Ok(CustomerAction {
        from: Some(from),
        subject: Some(subject),
        date: Some(parse_time(date)?),
        summary: Some(summary),
        file_refs: (!files.is_empty()).then_some(files),
        ..base(party_id, CustomerOp::AttachEmail)
    })
}

/// Read a snake_case name (`call_booked`, `client`) into its enum. A dash is
/// accepted for an underscore.
fn parse_name<T: DeserializeOwned>(value: &str, what: &str) -> Result<T, CliError> {
    let name = value.trim().to_ascii_lowercase().replace('-', "_");
    serde_json::from_value::<T>(Value::String(name))
        .map_err(|_| CliError::Usage(format!("{value:?} is not a valid {what}")))
}

/// A time as Unix seconds or an RFC 3339 timestamp such as `2026-10-29T10:00:00+02:00`.
fn parse_time(value: &str) -> Result<i64, CliError> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<i64>() {
        return Ok(seconds);
    }
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.timestamp())
        .map_err(|_| {
            CliError::Usage(format!(
                "{value:?} is not a time; use Unix seconds or RFC 3339 such as 2026-10-29T10:00:00+02:00"
            ))
        })
}

fn not_found(party_id: &str) -> CliError {
    CliError::NotFound(format!(
        "no customer record for {party_id}; it exists once the business has a prospect or a client record and co-founder mode is on"
    ))
}

/// Names the head the caller saw (when one exists) and sends the action.
async fn write(client: &BuzzClient, mut action: CustomerAction) -> Result<(), CliError> {
    if let Some((event, _)) = load_one(client, &action.party_id).await? {
        action.expected_head_event_id = Some(event.id.to_hex());
    }
    println!("{}", submit(client, &action).await?);
    Ok(())
}

async fn submit(client: &BuzzClient, action: &CustomerAction) -> Result<String, CliError> {
    let builder = buzz_sdk::company_customers::build_customer_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "the customer record changed before it was saved")
}

fn verify_customer_head(event: Event, relay_self: &str) -> Result<Event, CliError> {
    if u32::from(event.kind.as_u16()) != KIND_CUSTOMER_HEAD || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "customer head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("customer head signature is invalid: {error}")))?;
    Ok(event)
}

fn decode_head(event: &Event) -> Result<CustomerRecordHead, CliError> {
    let head = serde_json::from_str::<CustomerRecordHead>(&event.content)
        .map_err(|error| CliError::Other(format!("customer head content is invalid: {error}")))?;
    validate_customer_head(&head)
        .map_err(|error| CliError::Other(format!("customer head is invalid: {error}")))?;
    Ok(head)
}

async fn load_all(client: &BuzzClient) -> Result<Vec<(Event, CustomerRecordHead)>, CliError> {
    let relay_self = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [KIND_CUSTOMER_HEAD], "authors": [relay_self]}),
            CUSTOMER_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut records = Vec::with_capacity(raw.len());
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("customer head is malformed: {error}")))?;
        // A head this client cannot read is skipped, so a newer relay never
        // breaks an older agent.
        if let Ok(event) = verify_customer_head(event, &relay_self) {
            if let Ok(head) = decode_head(&event) {
                records.push((event, head));
            }
        }
    }
    Ok(records)
}

async fn load_one(
    client: &BuzzClient,
    party_id: &str,
) -> Result<Option<(Event, CustomerRecordHead)>, CliError> {
    let d_tag = customer_d_tag(party_id).map_err(|error| CliError::Usage(error.to_string()))?;
    let events =
        query_company_heads(client, KIND_CUSTOMER_HEAD, std::slice::from_ref(&d_tag)).await?;
    let relay_self = relay_self(client).await?;
    let Some(event) = events.into_iter().next() else {
        return Ok(None);
    };
    let event = verify_customer_head(event, &relay_self)?;
    let head = decode_head(&event)?;
    let d_tag = crate::commands::cofounder::head_d_tag(&event);
    if parse_customer_d_tag(&d_tag).ok().as_deref() != Some(party_id) {
        return Err(CliError::Other(
            "customer head does not match its d-tag".into(),
        ));
    }
    Ok(Some((event, head)))
}

/// The "step N of M" line of the project, when there is a current step.
fn project_label(head: &CustomerRecordHead) -> Option<String> {
    let project = head.project.as_ref()?;
    match (project.step_number, project.current_step_title.as_deref()) {
        (Some(number), Some(title)) => {
            Some(format!("step {number} of {}: {title}", project.step_count))
        }
        _ => None,
    }
}

/// One compact row per business, most recently active first, optionally in one stage.
pub(crate) fn customer_rows(
    records: &[(Event, CustomerRecordHead)],
    stage: Option<CustomerStage>,
) -> Vec<Value> {
    let mut rows = records
        .iter()
        .filter(|(_, head)| stage.is_none_or(|stage| head.stage == stage))
        .collect::<Vec<_>>();
    let last_at = |head: &CustomerRecordHead| head.timeline.last().map_or(0, |entry| entry.at);
    rows.sort_by(|(_, first), (_, second)| {
        last_at(second)
            .cmp(&last_at(first))
            .then_with(|| first.party_id.cmp(&second.party_id))
    });
    rows.into_iter()
        .map(|(event, head)| {
            json!({
                "partyId": head.party_id,
                "displayName": head.display_name,
                "stage": head.stage,
                "leadId": head.lead_id,
                "clientId": head.client_id,
                "money": head.money,
                "project": project_label(head),
                "entries": head.timeline.len(),
                "lastAt": head.timeline.last().map(|entry| entry.at),
                "headEventId": event.id.to_hex(),
            })
        })
        .collect()
}

/// The full record plus the head event id a write must name.
pub(crate) fn customer_output(event: &Event, head: &CustomerRecordHead) -> Value {
    let mut output = serde_json::to_value(head).unwrap_or_else(|_| json!({}));
    if let Some(object) = output.as_object_mut() {
        object.insert("headEventId".into(), json!(event.id.to_hex()));
        object.insert("projectStep".into(), json!(project_label(head)));
    }
    output
}

#[cfg(test)]
mod tests {
    use buzz_core::company_customers::{
        compute_customer_record, CustomerFacts, ManualState, SourceClient,
    };
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    const PARTY: &str = "00000000-0000-0000-0000-000000000064";
    const OTHER: &str = "00000000-0000-0000-0000-000000000065";
    const ATTACHMENT: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const AYA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn signed(kind: u32, d_tag: &str, content: String) -> Event {
        EventBuilder::new(Kind::Custom(kind as u16), content)
            .tag(Tag::parse(["d", d_tag]).expect("d tag"))
            .sign_with_keys(&Keys::generate())
            .expect("sign head")
    }

    fn client_head(party: &str, name: &str, at: i64) -> CustomerRecordHead {
        let client = serde_json::from_value(json!({
            "schemaVersion": 1,
            "clientId": "00000000-0000-0000-0000-0000000000c8",
            "partyId": party,
            "displayName": name,
            "approverPubkeys": [],
            "status": "active",
            "sourceActionEventId": AYA,
        }))
        .expect("client head");
        let facts = CustomerFacts {
            clients: vec![SourceClient { head: client, at }],
            ..CustomerFacts::default()
        };
        let source = facts.source_for(party).expect("source");
        compute_customer_record(&source, &ManualState::default(), at + 10, AYA, None)
    }

    #[test]
    fn customers_commands_parse() {
        assert!(matches!(
            parse(&["customers", "list"]).expect("list").command,
            Cmd::Customers(CustomersCmd::List { .. })
        ));
        assert!(parse(&["customers", "list", "--stage", "client"]).is_ok());
        assert!(parse(&["customers", "show", PARTY]).is_ok());
        assert!(parse(&["customers", "show", PARTY, "--no-refresh"]).is_ok());
        assert!(
            parse(&["customers", "show"]).is_err(),
            "a party id is required"
        );
        assert!(parse(&["customers", "convert", PARTY, "--note", "signed offline"]).is_ok());
        assert!(parse(&[
            "customers",
            "milestone",
            PARTY,
            "--kind",
            "call_booked",
            "--at",
            "2026-10-29T10:00:00+02:00",
            "--note",
            "Google Calendar, Fri 30 Oct 14:00",
        ])
        .is_ok());
        assert!(
            parse(&["customers", "milestone", PARTY, "--kind", "other"]).is_err(),
            "--at is required"
        );
        assert!(parse(&[
            "customers",
            "attach-email",
            PARTY,
            "--from",
            "Thandeka <t@planetree.example>",
            "--subject",
            "Logo and photos",
            "--date",
            "1793000000",
            "--summary",
            "Sent the logo and 14 photos.",
            "--file",
            "blossom-a",
            "--file",
            "blossom-b",
        ])
        .is_ok());
        assert!(parse(&[
            "customers",
            "attach-file",
            PARTY,
            "--label",
            "Agreement, signed",
            "--file",
            "blossom-c",
        ])
        .is_ok());
        assert!(parse(&["customers", "attach-file", PARTY, "--label", "x"]).is_err());
        assert!(parse(&["customers", "remove-attachment", PARTY, ATTACHMENT]).is_ok());
    }

    #[test]
    fn names_and_times_are_read_leniently_and_wrong_ones_are_usage_errors() {
        assert_eq!(
            parse_name::<MilestoneKind>("agreement-signed", "kind").unwrap(),
            MilestoneKind::AgreementSigned
        );
        assert_eq!(
            parse_name::<CustomerStage>("Client", "stage").unwrap(),
            CustomerStage::Client
        );
        assert!(matches!(
            parse_name::<MilestoneKind>("lunch", "kind"),
            Err(CliError::Usage(_))
        ));
        assert_eq!(parse_time("1793000000").unwrap(), 1_793_000_000);
        assert_eq!(
            parse_time("2026-10-29T10:00:00+02:00").unwrap(),
            parse_time("2026-10-29T08:00:00Z").unwrap()
        );
        assert!(matches!(parse_time("yesterday"), Err(CliError::Usage(_))));
    }

    #[test]
    fn an_email_over_4_kb_is_refused_before_anything_is_sent() {
        let long = "x".repeat(MAX_EMAIL_SUMMARY_BYTES + 1);
        let error = email_action(
            PARTY,
            "a".into(),
            "s".into(),
            "1793000000",
            long,
            Vec::new(),
        )
        .expect_err("over 4 KB");
        assert!(matches!(&error, CliError::Usage(message) if message.contains("4 KB")));
        let action = email_action(
            PARTY,
            "Thandeka".into(),
            "Logo".into(),
            "1793000000",
            "x".repeat(MAX_EMAIL_SUMMARY_BYTES),
            vec!["blossom-a".into()],
        )
        .expect("exactly 4 KB is fine");
        assert_eq!(action.op, CustomerOp::AttachEmail);
        assert_eq!(action.date, Some(1_793_000_000));
        assert_eq!(action.file_refs, Some(vec!["blossom-a".to_owned()]));
        buzz_core::company_customers::validate_customer_action(&action).expect("valid action");
        let bare = email_action(PARTY, "a".into(), "s".into(), "1", "ok".into(), Vec::new())
            .expect("no files");
        assert_eq!(bare.file_refs, None);
    }

    #[test]
    fn every_built_action_passes_the_contract_and_the_sdk_builder() {
        let milestone = CustomerAction {
            milestone_kind: Some(MilestoneKind::CallBooked),
            at: Some(1_793_000_000),
            note: Some("Fri 30 Oct 14:00".into()),
            ..base(PARTY, CustomerOp::RecordMilestone)
        };
        let file = CustomerAction {
            label: Some("Brief and assets".into()),
            file_ref: Some("blossom-c".into()),
            ..base(PARTY, CustomerOp::AttachFile)
        };
        let remove = CustomerAction {
            attachment_id: Some(ATTACHMENT.into()),
            ..base(PARTY, CustomerOp::RemoveAttachment)
        };
        for action in [
            base(PARTY, CustomerOp::Refresh),
            base(PARTY, CustomerOp::ConvertToClient),
            milestone,
            file,
            remove,
        ] {
            buzz_sdk::company_customers::build_customer_action(&action)
                .unwrap_or_else(|error| panic!("{:?} did not build: {error:?}", action.op));
        }
    }

    #[test]
    fn rows_are_newest_first_filtered_by_stage_and_name_the_head_to_write_against() {
        let older = client_head(PARTY, "Plane Tree Guesthouse", 1_000);
        let newer = client_head(OTHER, "Karoo Lodge", 2_000);
        let wrap = |head: CustomerRecordHead| {
            let event = signed(
                KIND_CUSTOMER_HEAD,
                &customer_d_tag(&head.party_id).unwrap(),
                serde_json::to_string(&head).unwrap(),
            );
            (event, head)
        };
        let records = vec![wrap(older), wrap(newer)];
        let rows = customer_rows(&records, None);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["displayName"], "Karoo Lodge");
        assert_eq!(rows[0]["stage"], "client");
        assert_eq!(rows[0]["headEventId"], records[1].0.id.to_hex());
        assert_eq!(rows[0]["money"]["quoteTotalMinor"], Value::Null);
        assert!(customer_rows(&records, Some(CustomerStage::Lead)).is_empty());
        assert_eq!(
            customer_rows(&records, Some(CustomerStage::Client)).len(),
            2
        );
    }

    #[test]
    fn show_prints_the_whole_record_and_its_head_event_id() {
        let head = client_head(PARTY, "Plane Tree Guesthouse", 1_000);
        let event = signed(
            KIND_CUSTOMER_HEAD,
            &customer_d_tag(PARTY).unwrap(),
            serde_json::to_string(&head).unwrap(),
        );
        let output = customer_output(&event, &head);
        assert_eq!(output["headEventId"], event.id.to_hex());
        assert_eq!(output["partyId"], PARTY);
        assert_eq!(output["timeline"].as_array().unwrap().len(), 1);
        assert_eq!(output["projectStep"], Value::Null);
        assert_eq!(decode_head(&event).expect("decodes"), head);
    }

    #[test]
    fn a_foreign_head_is_refused() {
        let relay = Keys::generate();
        let head = signed(
            KIND_CUSTOMER_HEAD,
            &customer_d_tag(PARTY).unwrap(),
            "{}".into(),
        );
        // Signed by somebody other than the relay.
        assert!(verify_customer_head(head, &relay.public_key().to_hex()).is_err());
    }
}
