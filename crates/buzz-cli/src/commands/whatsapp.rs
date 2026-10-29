//! WhatsApp outreach for agents and owners.
//!
//! The relay is the only thing that talks to WhatsApp. These commands read what the relay
//! keeps (`/api/whatsapp/query`) and publish signed commands (batch, decision, send,
//! settings). A refusal comes back as the relay's plain reason.
//!
//! Rules every agent follows:
//! * Templates first. A new chat can only start with an approved template, and only through
//!   a batch that the owner approves.
//! * Free text only inside the 24 hour window after the contact's last message to us.
//! * Short, human replies. Never more than one message in a row without a reply.
//! * "stop", "unsubscribe", "no thanks", "not interested" mean the contact is opted out and
//!   every later send is refused. Never try to get around it.

use std::collections::HashSet;
use std::path::Path;

use buzz_core::kind::{
    KIND_WHATSAPP_BATCH, KIND_WHATSAPP_BATCH_DECISION, KIND_WHATSAPP_SEND_REQUEST,
    KIND_WHATSAPP_SETTINGS,
};
use nostr::{EventBuilder, Kind};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::leads::load_leads;
use crate::error::CliError;
use crate::links::parse_lead_reference;

const QUERY_PATH: &str = "/api/whatsapp/query";
const MAX_BATCH_ROWS: usize = 500;
const MAX_PARAMS_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub async fn dispatch(cmd: crate::WhatsappCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::WhatsappCmd;
    match cmd {
        WhatsappCmd::Status => query(client, json!({ "what": "status" })).await,
        WhatsappCmd::Templates { refresh } => {
            let raw = client
                .post_json_authed(
                    QUERY_PATH,
                    &json!({ "what": "templates", "refresh": refresh }),
                )
                .await?;
            println!("{}", render_templates(&raw)?);
            Ok(())
        }
        WhatsappCmd::TemplateTitle {
            template,
            language,
            title,
            propose,
        } => {
            publish(
                client,
                KIND_WHATSAPP_SETTINGS,
                template_title_content(&template, &language, &title, propose)?,
            )
            .await
        }
        WhatsappCmd::Batch(sub) => dispatch_batch(sub, client).await,
        WhatsappCmd::Send {
            contact,
            thread,
            text,
            template,
            language,
            param,
            request_id,
        } => {
            let content = send_content(
                contact.as_deref(),
                thread.as_deref(),
                text.as_deref(),
                template.as_deref(),
                &language,
                &param,
                request_id.as_deref(),
            )?;
            publish(client, KIND_WHATSAPP_SEND_REQUEST, content).await
        }
        WhatsappCmd::Drafts { limit } => {
            query(client, json!({ "what": "drafts", "limit": limit })).await
        }
        WhatsappCmd::Draft(sub) => {
            let content = match sub {
                crate::WhatsappDraftCmd::Approve { draft, text, param } => {
                    draft_decision_content(&draft, "approve", text.as_deref(), &param)?
                }
                crate::WhatsappDraftCmd::Reject { draft } => {
                    draft_decision_content(&draft, "reject", None, &[])?
                }
            };
            publish(client, KIND_WHATSAPP_BATCH_DECISION, content).await
        }
        WhatsappCmd::Contacts { limit } => {
            query(client, json!({ "what": "contacts", "limit": limit })).await
        }
        WhatsappCmd::Inbox { limit } => {
            query(client, json!({ "what": "inbox", "limit": limit })).await
        }
        WhatsappCmd::Thread { contact, limit } => {
            query(
                client,
                json!({ "what": "thread", "waId": contact, "limit": limit }),
            )
            .await
        }
        WhatsappCmd::Cap { value } => match value {
            None => cap_from_status(client).await,
            Some(cap) => {
                if !(0..=1000).contains(&cap) {
                    return Err(CliError::Usage("cap must be 0 through 1000".into()));
                }
                publish(
                    client,
                    KIND_WHATSAPP_SETTINGS,
                    json!({ "v": 1, "dailyNewChatCap": cap }),
                )
                .await
            }
        },
    }
}

async fn dispatch_batch(cmd: crate::WhatsappBatchCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::WhatsappBatchCmd;
    match cmd {
        WhatsappBatchCmd::Create {
            template,
            language,
            lead,
            stage,
            params_file,
            param,
            material,
            note,
            campaign,
            batch_id,
        } => {
            let rows = batch_rows(
                client,
                &lead,
                stage.as_deref(),
                params_file.as_deref(),
                &param,
            )
            .await?;
            let content = batch_content(
                &template,
                &language,
                rows,
                &material,
                note.as_deref(),
                campaign.as_deref(),
                batch_id.as_deref(),
            )?;
            publish(client, KIND_WHATSAPP_BATCH, content).await
        }
        WhatsappBatchCmd::List { state } => {
            query(client, json!({ "what": "batches", "state": state })).await
        }
        WhatsappBatchCmd::Show { batch } => {
            query(client, json!({ "what": "batch", "batchId": batch })).await
        }
        WhatsappBatchCmd::Approve {
            batch,
            drop,
            edit_file,
        } => {
            let edits = match edit_file {
                Some(path) => read_edits(&path)?,
                None => Vec::new(),
            };
            publish(
                client,
                KIND_WHATSAPP_BATCH_DECISION,
                decision_content(&batch, "approve", &drop, edits)?,
            )
            .await
        }
        WhatsappBatchCmd::Reject { batch } => {
            publish(
                client,
                KIND_WHATSAPP_BATCH_DECISION,
                decision_content(&batch, "reject", &[], Vec::new())?,
            )
            .await
        }
    }
}

async fn query(client: &BuzzClient, body: Value) -> Result<(), CliError> {
    let response = client.post_json_authed(QUERY_PATH, &body).await?;
    println!("{response}");
    Ok(())
}

async fn publish(client: &BuzzClient, kind: u32, content: Value) -> Result<(), CliError> {
    let builder = EventBuilder::new(Kind::Custom(kind as u16), content.to_string());
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

async fn cap_from_status(client: &BuzzClient) -> Result<(), CliError> {
    let raw = client
        .post_json_authed(QUERY_PATH, &json!({ "what": "status" }))
        .await?;
    let status: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("status was not JSON: {error}")))?;
    println!(
        "{}",
        json!({
            "dailyNewChatCap": status.get("dailyNewChatCap"),
            "newChatsSentToday": status.get("newChatsSentToday"),
        })
    );
    Ok(())
}

/// One row of a batch before it is sent to the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Row {
    pub to: String,
    pub lead_id: Option<String>,
    pub params: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileRow {
    #[serde(default)]
    lead: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    params: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct EditFileRow {
    idx: i32,
    params: Vec<String>,
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T, CliError> {
    let meta = std::fs::metadata(Path::new(path))
        .map_err(|error| CliError::Usage(format!("cannot read {path}: {error}")))?;
    if meta.len() > MAX_PARAMS_FILE_BYTES {
        return Err(CliError::Usage(format!("{path} is larger than 2 MiB")));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|error| CliError::Usage(format!("cannot read {path}: {error}")))?;
    serde_json::from_str(&text)
        .map_err(|error| CliError::Usage(format!("{path} is not the expected JSON: {error}")))
}

fn read_edits(path: &str) -> Result<Vec<Value>, CliError> {
    let rows: Vec<EditFileRow> = read_json_file(path)?;
    Ok(rows
        .into_iter()
        .map(|row| json!({ "idx": row.idx, "params": row.params }))
        .collect())
}

/// Collect the batch rows from leads and/or a params file.
async fn batch_rows(
    client: &BuzzClient,
    leads: &[String],
    stage: Option<&str>,
    params_file: Option<&str>,
    shared_params: &[String],
) -> Result<Vec<Row>, CliError> {
    let file_rows: Vec<FileRow> = match params_file {
        Some(path) => read_json_file(path)?,
        None => Vec::new(),
    };
    let needs_leads =
        !leads.is_empty() || stage.is_some() || file_rows.iter().any(|row| row.lead.is_some());
    let lead_phones = if needs_leads {
        let wanted_stage = stage.map(str::trim);
        let mut phones = std::collections::HashMap::new();
        for lead in load_leads(client).await? {
            if lead.head.status != "active" {
                continue;
            }
            if let Some(stage) = wanted_stage {
                let lead_stage = serde_json::to_value(lead.head.prospect.stage)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default();
                if lead_stage != stage.replace('-', "_") {
                    continue;
                }
            }
            phones.insert(lead.head.prospect_id, lead.head.prospect.phone.clone());
        }
        phones
    } else {
        std::collections::HashMap::new()
    };

    let mut rows: Vec<Row> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    let mut seen_leads: HashSet<Uuid> = HashSet::new();

    let mut add_lead =
        |lead_ref: &str, params: Vec<String>, rows: &mut Vec<Row>, problems: &mut Vec<String>| {
            let lead_id = match parse_lead_reference(lead_ref) {
                Ok(id) => id,
                Err(_) => {
                    problems.push(format!("{lead_ref}: not a lead id or link"));
                    return;
                }
            };
            if !seen_leads.insert(lead_id) {
                problems.push(format!("{lead_id}: listed twice"));
                return;
            }
            match lead_phones.get(&lead_id) {
                Some(Some(phone)) if !phone.trim().is_empty() => rows.push(Row {
                    to: phone.trim().to_string(),
                    lead_id: Some(lead_id.to_string()),
                    params,
                }),
                Some(_) => problems.push(format!("{lead_id}: the lead has no phone number")),
                None => problems.push(format!("{lead_id}: lead not found (or not at that stage)")),
            }
        };

    for row in &file_rows {
        match (&row.lead, &row.to) {
            (Some(lead), None) => add_lead(lead, row.params.clone(), &mut rows, &mut problems),
            (None, Some(to)) => rows.push(Row {
                to: to.trim().to_string(),
                lead_id: None,
                params: row.params.clone(),
            }),
            _ => problems.push("each params row needs exactly one of lead or to".to_string()),
        }
    }
    if params_file.is_none() {
        for lead in leads {
            add_lead(lead, shared_params.to_vec(), &mut rows, &mut problems);
        }
        if leads.is_empty() && stage.is_some() {
            let mut ids: Vec<Uuid> = lead_phones.keys().copied().collect();
            ids.sort();
            for id in ids {
                add_lead(
                    &id.to_string(),
                    shared_params.to_vec(),
                    &mut rows,
                    &mut problems,
                );
            }
        }
    }
    if !problems.is_empty() {
        let shown = problems
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ");
        return Err(CliError::Usage(format!("batch rows not usable: {shown}")));
    }
    if rows.is_empty() {
        return Err(CliError::Usage(
            "no rows: give --lead, --stage, or --params-file".into(),
        ));
    }
    if rows.len() > MAX_BATCH_ROWS {
        return Err(CliError::Usage(format!(
            "a batch has at most {MAX_BATCH_ROWS} rows"
        )));
    }
    Ok(rows)
}

fn valid_uuid_or_new(value: Option<&str>, field: &str) -> Result<Uuid, CliError> {
    match value {
        Some(value) => Uuid::parse_str(value.trim())
            .map_err(|_| CliError::Usage(format!("{field} must be a UUID"))),
        None => Ok(Uuid::new_v4()),
    }
}

/// The `47046` command content.
pub(crate) fn batch_content(
    template: &str,
    language: &str,
    rows: Vec<Row>,
    material: &[String],
    note: Option<&str>,
    campaign: Option<&str>,
    batch_id: Option<&str>,
) -> Result<Value, CliError> {
    if template.trim().is_empty() {
        return Err(CliError::Usage("--template is required".into()));
    }
    let batch_id = valid_uuid_or_new(batch_id, "--batch-id")?;
    let note = match (
        note.map(str::trim).filter(|n| !n.is_empty()),
        campaign.map(str::trim).filter(|c| !c.is_empty()),
    ) {
        (Some(note), Some(campaign)) => format!("Campaign {campaign}. {note}"),
        (Some(note), None) => note.to_string(),
        (None, Some(campaign)) => format!("Campaign {campaign}."),
        (None, None) => String::new(),
    };
    Ok(json!({
        "v": 1,
        "batchId": batch_id.to_string(),
        "template": template.trim(),
        "language": language.trim(),
        "rows": rows.iter().map(|row| json!({
            "to": row.to,
            "leadId": row.lead_id,
            "params": row.params,
        })).collect::<Vec<_>>(),
        "materialLinks": material,
        "note": note,
    }))
}

/// The `47047` command content.
pub(crate) fn decision_content(
    batch: &str,
    decision: &str,
    drop_rows: &[i32],
    edits: Vec<Value>,
) -> Result<Value, CliError> {
    let batch_id = Uuid::parse_str(batch.trim())
        .map_err(|_| CliError::Usage("--batch must be a UUID".into()))?;
    Ok(json!({
        "v": 1,
        "batchId": batch_id.to_string(),
        "decision": decision,
        "dropRows": drop_rows,
        "editRows": edits,
    }))
}

/// The `47047` content that decides one agent draft.
pub(crate) fn draft_decision_content(
    draft: &str,
    decision: &str,
    text: Option<&str>,
    params: &[String],
) -> Result<Value, CliError> {
    let draft_id = Uuid::parse_str(draft.trim())
        .map_err(|_| CliError::Usage("--draft must be a draft message id".into()))?;
    if text.is_some() && !params.is_empty() {
        return Err(CliError::Usage(
            "edit either --text (text draft) or --param (template draft), not both".into(),
        ));
    }
    let mut content = json!({ "v": 1, "draftId": draft_id.to_string(), "decision": decision });
    if let Some(text) = text {
        if text.trim().is_empty() {
            return Err(CliError::Usage("--text is empty".into()));
        }
        content["text"] = json!(text);
    }
    if !params.is_empty() {
        content["params"] = json!(params);
    }
    Ok(content)
}

/// The `47048` command content. Exactly one recipient and one body.
pub(crate) fn send_content(
    contact: Option<&str>,
    thread: Option<&str>,
    text: Option<&str>,
    template: Option<&str>,
    language: &str,
    params: &[String],
    request_id: Option<&str>,
) -> Result<Value, CliError> {
    if contact.is_some() == thread.is_some() {
        return Err(CliError::Usage(
            "give exactly one of --contact or --thread".into(),
        ));
    }
    if text.is_some() == template.is_some() {
        return Err(CliError::Usage(
            "give exactly one of --text or --template".into(),
        ));
    }
    let request_id = valid_uuid_or_new(request_id, "--request-id")?;
    let mut content = json!({ "v": 1, "requestId": request_id.to_string() });
    if let Some(contact) = contact {
        content["to"] = json!(contact.trim());
    }
    if let Some(thread) = thread {
        content["threadRoot"] = json!(thread.trim());
    }
    if let Some(text) = text {
        if text.trim().is_empty() {
            return Err(CliError::Usage("--text is empty".into()));
        }
        content["text"] = json!(text);
    }
    if let Some(template) = template {
        content["template"] = json!({
            "name": template.trim(),
            "language": language.trim(),
            "params": params,
        });
    }
    Ok(content)
}

/// Templates for people: the Colony title first, the Meta name second (it is the send key
/// and only needed in details). The key order is fixed by hand because JSON maps sort keys.
pub(crate) fn render_templates(raw: &str) -> Result<String, CliError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|error| CliError::Other(format!("templates response was not JSON: {error}")))?;
    let list = value
        .get("templates")
        .and_then(Value::as_array)
        .ok_or_else(|| CliError::Other("templates response has no template list".into()))?;
    let field = |template: &Value, key: &str| template.get(key).cloned().unwrap_or(Value::Null);
    let items: Vec<String> = list
        .iter()
        .map(|template| {
            format!(
                "{{\"title\":{},\"name\":{},\"language\":{},\"category\":{},\"status\":{},\"body\":{},\"slots\":{},\"buttons\":{},\"proposedTitle\":{}}}",
                field(template, "title"),
                field(template, "name"),
                field(template, "language"),
                field(template, "category"),
                field(template, "status"),
                field(template, "body"),
                field(template, "slots"),
                field(template, "buttons"),
                field(template, "proposedTitle"),
            )
        })
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

/// The `47049` content that renames a template or proposes a title.
pub(crate) fn template_title_content(
    template: &str,
    language: &str,
    title: &str,
    propose: bool,
) -> Result<Value, CliError> {
    if template.trim().is_empty() {
        return Err(CliError::Usage("--template is required".into()));
    }
    if title.trim().is_empty() {
        return Err(CliError::Usage("--title is empty".into()));
    }
    Ok(json!({
        "v": 1,
        "templateTitle": {
            "template": template.trim(),
            "language": language.trim(),
            "title": title.trim(),
            "propose": propose,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_show_the_title_before_the_meta_name() {
        let raw = r#"{"templates":[{"name":"hl_vb","title":"Voice note offer","language":"en","category":"MARKETING","status":"APPROVED","body":"Hi {{1}}","slots":1,"buttons":[{"type":"QUICK_REPLY","text":"Not interested"}],"proposedTitle":null}]}"#;
        let out = render_templates(raw).expect("rendered");
        assert!(
            out.starts_with(r#"[{"title":"Voice note offer","name":"hl_vb","#),
            "{out}"
        );
        assert!(
            out.contains(r#""buttons":[{"text":"Not interested","type":"QUICK_REPLY"}]"#),
            "{out}"
        );
        assert!(serde_json::from_str::<Value>(&out).is_ok());
        assert!(render_templates("{}").is_err());
    }

    #[test]
    fn title_command_matches_the_contract() {
        let rename =
            template_title_content(" hl_vb ", "en", " Voice note offer ", false).expect("rename");
        assert_eq!(rename["templateTitle"]["template"], "hl_vb");
        assert_eq!(rename["templateTitle"]["title"], "Voice note offer");
        assert_eq!(rename["templateTitle"]["propose"], false);
        assert_eq!(
            template_title_content("t", "en", "x", true).expect("p")["templateTitle"]["propose"],
            true
        );
        assert!(template_title_content("", "en", "x", false).is_err());
        assert!(template_title_content("t", "en", "  ", false).is_err());
    }

    #[test]
    fn draft_decisions_match_the_contract() {
        let id = Uuid::new_v4().to_string();
        let approve =
            draft_decision_content(&id, "approve", Some(" Shorter reply "), &[]).expect("approve");
        assert_eq!(approve["draftId"], id.as_str());
        assert_eq!(approve["decision"], "approve");
        assert_eq!(approve["text"], " Shorter reply ");
        let template =
            draft_decision_content(&id, "approve", None, &["Naledi".to_string()]).expect("t");
        assert_eq!(template["params"][0], "Naledi");
        let reject = draft_decision_content(&id, "reject", None, &[]).expect("reject");
        assert!(reject.get("text").is_none() && reject.get("params").is_none());
        assert!(draft_decision_content("nope", "approve", None, &[]).is_err());
        assert!(draft_decision_content(&id, "approve", Some("x"), &["y".to_string()]).is_err());
        assert!(draft_decision_content(&id, "approve", Some("  "), &[]).is_err());
    }

    #[test]
    fn send_needs_exactly_one_recipient_and_one_body() {
        assert!(send_content(None, None, Some("hi"), None, "en", &[], None).is_err());
        assert!(send_content(Some("+27"), Some("ab"), Some("hi"), None, "en", &[], None).is_err());
        assert!(send_content(Some("+27821234567"), None, None, None, "en", &[], None).is_err());
        assert!(send_content(
            Some("+27821234567"),
            None,
            Some("hi"),
            Some("t"),
            "en",
            &[],
            None
        )
        .is_err());
        assert!(send_content(
            Some("+27821234567"),
            None,
            Some("  "),
            None,
            "en",
            &[],
            None
        )
        .is_err());
        assert!(send_content(
            Some("+27821234567"),
            None,
            Some("hi"),
            None,
            "en",
            &[],
            Some("nope")
        )
        .is_err());
    }

    #[test]
    fn send_content_matches_the_contract() {
        let id = Uuid::new_v4().to_string();
        let text = send_content(
            Some(" +27821234567 "),
            None,
            Some("hello"),
            None,
            "en",
            &[],
            Some(&id),
        )
        .expect("text");
        assert_eq!(text["v"], 1);
        assert_eq!(text["requestId"], id.as_str());
        assert_eq!(text["to"], "+27821234567");
        assert_eq!(text["text"], "hello");
        let template = send_content(
            None,
            Some("abcd"),
            None,
            Some("intro"),
            "en",
            &["Thabo".to_string()],
            None,
        )
        .expect("template");
        assert_eq!(template["threadRoot"], "abcd");
        assert_eq!(template["template"]["name"], "intro");
        assert_eq!(template["template"]["params"][0], "Thabo");
        assert!(template.get("to").is_none());
    }

    #[test]
    fn batch_content_matches_the_contract() {
        let rows = vec![Row {
            to: "+27821234567".into(),
            lead_id: Some("lead-1".into()),
            params: vec!["Thabo".into()],
        }];
        let content = batch_content(
            "intro",
            "en",
            rows,
            &["https://x.example/a.pdf".to_string()],
            Some("Warm leads"),
            Some("Oct push"),
            None,
        )
        .expect("batch");
        assert_eq!(content["v"], 1);
        assert_eq!(content["template"], "intro");
        assert_eq!(content["rows"][0]["leadId"], "lead-1");
        assert_eq!(content["materialLinks"][0], "https://x.example/a.pdf");
        assert_eq!(content["note"], "Campaign Oct push. Warm leads");
        assert!(Uuid::parse_str(content["batchId"].as_str().expect("id")).is_ok());
        assert!(batch_content(" ", "en", vec![], &[], None, None, None).is_err());
        assert!(batch_content("intro", "en", vec![], &[], None, None, Some("bad")).is_err());
    }

    #[test]
    fn decision_content_matches_the_contract() {
        let id = Uuid::new_v4().to_string();
        let content = decision_content(
            &id,
            "approve",
            &[3, 7],
            vec![json!({"idx": 2, "params": ["N"]})],
        )
        .expect("decision");
        assert_eq!(content["decision"], "approve");
        assert_eq!(content["dropRows"], json!([3, 7]));
        assert_eq!(content["editRows"][0]["idx"], 2);
        assert!(decision_content("nope", "approve", &[], vec![]).is_err());
    }
}
