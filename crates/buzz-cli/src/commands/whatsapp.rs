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
    KIND_WHATSAPP_BATCH, KIND_WHATSAPP_BATCH_DECISION, KIND_WHATSAPP_CONTACT_UPDATE,
    KIND_WHATSAPP_SEND_REQUEST, KIND_WHATSAPP_SETTINGS,
};
use buzz_core::whatsapp_stage::WhatsappStage;
use nostr::{EventBuilder, Kind};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::leads::load_leads;
use crate::commands::lists::{find_list, load_lists, load_whatsapp_by_lead, WhatsappInfo};
use crate::error::CliError;
use crate::links::{
    list_link, parse_lead_reference, parse_list_reference, parse_template_reference, template_link,
    TemplateReference,
};

const QUERY_PATH: &str = "/api/whatsapp/query";
/// The same path, for the lists commands that read WhatsApp contacts.
pub(crate) const WHATSAPP_QUERY_PATH: &str = QUERY_PATH;
const MAX_BATCH_ROWS: usize = 500;
const MAX_PARAMS_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub async fn dispatch(cmd: crate::WhatsappCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::WhatsappCmd;
    match cmd {
        WhatsappCmd::Status => query(client, json!({ "what": "status" })).await,
        WhatsappCmd::Templates {
            cmd: Some(crate::WhatsappTemplatesCmd::Get { template }),
            ..
        } => {
            let reference = parse_template_reference(&template)?;
            let templates = fetch_templates(client).await?;
            let found = resolve_template(&templates, &reference)?;
            println!("{}", template_detail(&found));
            Ok(())
        }
        WhatsappCmd::Templates { refresh, cmd: None } => {
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
        WhatsappCmd::Stage { wa_id, stage } => {
            publish(
                client,
                KIND_WHATSAPP_CONTACT_UPDATE,
                contact_stage_content(&wa_id, &stage)?,
            )
            .await
        }
        WhatsappCmd::Rename {
            wa_id,
            label,
            clear,
        } => {
            publish(
                client,
                KIND_WHATSAPP_CONTACT_UPDATE,
                contact_rename_content(&wa_id, label.as_deref(), clear)?,
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
            list: Some(list),
            param,
            material,
            note,
            campaign,
            batch_id,
            ..
        } => {
            let list_id = parse_list_reference(&list)?;
            let lists = load_lists(client).await?;
            let stored = find_list(&lists, list_id)?;
            let leads = load_leads(client).await?;
            let contacts = load_whatsapp_by_lead(client).await;
            let plan = plan_list_rows(&stored.head, &leads, &contacts, &param);
            if plan.rows.is_empty() {
                return Err(CliError::Usage(format!(
                    "no one in list \"{}\" can be messaged: {}",
                    stored.head.name,
                    skipped_summary(&plan.skipped)
                )));
            }
            if plan.rows.len() > MAX_BATCH_ROWS {
                return Err(CliError::Usage(format!(
                    "a batch has at most {MAX_BATCH_ROWS} rows"
                )));
            }
            let list_note = match note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
                Some(note) => format!("List \"{}\". {note}", stored.head.name),
                None => format!("List \"{}\".", stored.head.name),
            };
            let content = batch_content(
                &template,
                &language,
                plan.rows.clone(),
                &material,
                Some(list_note.as_str()),
                campaign.as_deref(),
                batch_id.as_deref(),
            )?;
            let response = publish_raw(client, KIND_WHATSAPP_BATCH, content).await?;
            println!(
                "{}",
                list_batch_output(&response, list_id, &plan.skipped, plan.rows.len())
            );
            Ok(())
        }
        WhatsappBatchCmd::Create {
            template,
            language,
            lead,
            stage,
            list: None,
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

/// `47052` content that sets a contact's stage.
fn contact_stage_content(wa_id: &str, stage: &str) -> Result<Value, CliError> {
    let wa_id = wa_id.trim();
    if wa_id.is_empty() {
        return Err(CliError::Usage("give the contact's phone number".into()));
    }
    let Some(stage) = WhatsappStage::parse_manual(stage) else {
        return Err(CliError::Usage(
            "stage must be contacted, replied, wants_call, call_booked, quote_sent, client or no_thanks".into(),
        ));
    };
    Ok(json!({ "v": 1, "waId": wa_id, "stage": stage.as_str() }))
}

/// `47052` content that sets or clears a contact's name.
fn contact_rename_content(
    wa_id: &str,
    label: Option<&str>,
    clear: bool,
) -> Result<Value, CliError> {
    let wa_id = wa_id.trim();
    if wa_id.is_empty() {
        return Err(CliError::Usage("give the contact's phone number".into()));
    }
    match (label.map(str::trim), clear) {
        (Some(text), false) if !text.is_empty() => {
            Ok(json!({ "v": 1, "waId": wa_id, "label": text }))
        }
        (None, true) => Ok(json!({ "v": 1, "waId": wa_id, "label": Value::Null })),
        _ => Err(CliError::Usage(
            "give a name, or --clear to remove it".into(),
        )),
    }
}

async fn publish(client: &BuzzClient, kind: u32, content: Value) -> Result<(), CliError> {
    let response = publish_raw(client, kind, content).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

/// Sign and send one command, returning the relay's answer.
async fn publish_raw(client: &BuzzClient, kind: u32, content: Value) -> Result<String, CliError> {
    let builder = EventBuilder::new(Kind::Custom(kind as u16), content.to_string());
    let event = client.sign_event(builder)?;
    client.submit_event(event).await
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
    /// Optional contact name, used by the relay only when WhatsApp reported none.
    pub name: Option<String>,
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
    name: Option<String>,
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
                    name: None,
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
                name: row.name.clone(),
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

/// The `47048` command content.
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
            "name": row.name,
            "params": row.params,
        })).collect::<Vec<_>>(),
        "materialLinks": material,
        "note": note,
    }))
}

/// The `47049` command content.
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

/// The `47049` content that decides one agent draft.
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

/// The `47050` command content. Exactly one recipient and one body.
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

/// Every approved template the relay keeps.
pub(crate) async fn fetch_templates(client: &BuzzClient) -> Result<Vec<Value>, CliError> {
    let raw = client
        .post_json_authed(
            QUERY_PATH,
            &json!({ "what": "templates", "refresh": false }),
        )
        .await?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("templates response was not JSON: {error}")))?;
    value
        .get("templates")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| CliError::Other("templates response has no template list".into()))
}

fn template_text<'a>(template: &'a Value, key: &str) -> Option<&'a str> {
    template.get(key).and_then(Value::as_str)
}

/// Find the one template a reference points at. A reference is the Meta name or the Colony
/// title in any case (a link carries the Meta name and may carry a language). It never reads a
/// number: templates are named, not numbered.
pub(crate) fn resolve_template(
    templates: &[Value],
    reference: &TemplateReference,
) -> Result<Value, CliError> {
    let needle = reference.name.trim().to_lowercase();
    let language = reference.language.as_deref().map(str::to_lowercase);
    let matches: Vec<&Value> = templates
        .iter()
        .filter(|template| {
            let named = template_text(template, "name").map(str::to_lowercase);
            let titled = template_text(template, "title").map(str::to_lowercase);
            named.as_deref() == Some(needle.as_str()) || titled.as_deref() == Some(needle.as_str())
        })
        .filter(|template| match language.as_deref() {
            Some(language) => {
                template_text(template, "language")
                    .map(str::to_lowercase)
                    .as_deref()
                    == Some(language)
            }
            None => true,
        })
        .collect();
    match matches.as_slice() {
        [one] => Ok((*one).clone()),
        [] => {
            let available: Vec<&str> = templates
                .iter()
                .filter_map(|template| {
                    template_text(template, "title").or_else(|| template_text(template, "name"))
                })
                .take(10)
                .collect();
            Err(CliError::NotFound(format!(
                "no approved template is called \"{}\". Available: {}",
                reference.name.trim(),
                if available.is_empty() {
                    "none yet".to_owned()
                } else {
                    available.join(", ")
                }
            )))
        }
        many => {
            let options: Vec<String> = many
                .iter()
                .map(|template| {
                    format!(
                        "{} ({})",
                        template_text(template, "name").unwrap_or("?"),
                        template_text(template, "language").unwrap_or("?")
                    )
                })
                .collect();
            Err(CliError::Usage(format!(
                "\"{}\" matches more than one template: {}. Use the template name with its language (colony://template/<name>?lang=<code>)",
                reference.name.trim(),
                options.join(", ")
            )))
        }
    }
}

/// The `templates get` answer for one template.
fn template_detail(template: &Value) -> Value {
    let field = |key: &str| template.get(key).cloned().unwrap_or(Value::Null);
    let reference = match (
        template_text(template, "name"),
        template_text(template, "language"),
    ) {
        (Some(name), Some(language)) => template_link(name, language),
        _ => None,
    };
    json!({
        "name": field("name"),
        "title": field("title"),
        "language": field("language"),
        "category": field("category"),
        "status": field("status"),
        "body": field("body"),
        "slots": field("slots"),
        "buttons": field("buttons"),
        "reference": reference,
    })
}

/// A list member that cannot be messaged, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkippedMember {
    pub lead_id: Uuid,
    pub name: Option<String>,
    pub reason: &'static str,
}

/// The batch rows a list yields, and the members left out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ListRows {
    pub rows: Vec<Row>,
    pub skipped: Vec<SkippedMember>,
}

/// Turn a list's members into batch rows. A member is skipped, with a reason, when its lead no
/// longer exists, is archived, has no phone number, or is known to have opted out.
pub(crate) fn plan_list_rows(
    list: &buzz_core::outreach_lists::OutreachListHead,
    leads: &[crate::commands::leads::CurrentLead],
    contacts: &std::collections::HashMap<Uuid, WhatsappInfo>,
    shared_params: &[String],
) -> ListRows {
    let by_id: std::collections::HashMap<Uuid, &crate::commands::leads::CurrentLead> = leads
        .iter()
        .map(|lead| (lead.head.prospect_id, lead))
        .collect();
    let mut rows = Vec::new();
    let mut skipped = Vec::new();
    for member in &list.members {
        let Some(lead) = by_id.get(&member.lead_id) else {
            skipped.push(SkippedMember {
                lead_id: member.lead_id,
                name: None,
                reason: "the lead no longer exists",
            });
            continue;
        };
        let name = Some(lead.head.prospect.party.display_name.clone());
        if lead.head.status != "active" {
            skipped.push(SkippedMember {
                lead_id: member.lead_id,
                name,
                reason: "the lead is archived",
            });
            continue;
        }
        if contacts
            .get(&member.lead_id)
            .is_some_and(|info| info.opted_out)
        {
            skipped.push(SkippedMember {
                lead_id: member.lead_id,
                name,
                reason: "opted out of WhatsApp",
            });
            continue;
        }
        match lead
            .head
            .prospect
            .phone
            .as_deref()
            .map(str::trim)
            .filter(|phone| !phone.is_empty())
        {
            Some(phone) => rows.push(Row {
                to: phone.to_owned(),
                lead_id: Some(member.lead_id.to_string()),
                name: None,
                params: shared_params.to_vec(),
            }),
            None => skipped.push(SkippedMember {
                lead_id: member.lead_id,
                name,
                reason: "no phone number",
            }),
        }
    }
    ListRows { rows, skipped }
}

fn skipped_summary(skipped: &[SkippedMember]) -> String {
    if skipped.is_empty() {
        return "the list is empty".to_owned();
    }
    let shown: Vec<String> = skipped
        .iter()
        .take(8)
        .map(|member| {
            format!(
                "{}: {}",
                member.name.as_deref().unwrap_or("a lead"),
                member.reason
            )
        })
        .collect();
    let more = skipped.len().saturating_sub(shown.len());
    if more > 0 {
        format!("{} (and {more} more)", shown.join("; "))
    } else {
        shown.join("; ")
    }
}

/// The normal write answer plus the list, the number of rows and the members left out.
fn list_batch_output(
    response: &str,
    list_id: Uuid,
    skipped: &[SkippedMember],
    rows: usize,
) -> String {
    let normalized = normalize_write_response(response);
    let mut output = match serde_json::from_str::<Value>(&normalized) {
        Ok(Value::Object(object)) => object,
        _ => return normalized,
    };
    output.insert("list".into(), json!(list_link(list_id)));
    output.insert("rows".into(), json!(rows));
    output.insert(
        "skipped".into(),
        Value::Array(
            skipped
                .iter()
                .map(|member| {
                    json!({
                        "leadId": member.lead_id.to_string(),
                        "reference": crate::links::lead_link(member.lead_id),
                        "name": member.name,
                        "reason": member.reason,
                    })
                })
                .collect(),
        ),
    );
    Value::Object(output).to_string()
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

/// The `47051` content that renames a template or proposes a title.
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
    fn stage_and_rename_commands_match_the_contract() {
        let stage = contact_stage_content(" +27821234567 ", "call_booked").expect("stage");
        assert_eq!(
            stage,
            json!({"v": 1, "waId": "+27821234567", "stage": "call_booked"})
        );
        // Facts cannot be set, and neither can a word that is not a stage.
        for bad in ["stopped", "not_on_whatsapp", "won", ""] {
            assert!(contact_stage_content("+27821234567", bad).is_err(), "{bad}");
        }
        assert!(contact_stage_content("  ", "client").is_err());
        let rename =
            contact_rename_content("+27821234567", Some(" Plane Tree "), false).expect("n");
        assert_eq!(
            rename,
            json!({"v": 1, "waId": "+27821234567", "label": "Plane Tree"})
        );
        let clear = contact_rename_content("+27821234567", None, true).expect("clear");
        assert_eq!(clear["label"], Value::Null);
        assert!(clear.as_object().expect("object").contains_key("label"));
        assert!(contact_rename_content("+27821234567", None, false).is_err());
        assert!(contact_rename_content("+27821234567", Some("  "), false).is_err());
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
            name: Some("Thabo".into()),
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
        assert_eq!(content["rows"][0]["name"], "Thabo");
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

    fn template_fixture() -> Vec<Value> {
        vec![
            json!({"name":"built_a_site","title":"Built a site for you","language":"en","category":"MARKETING","status":"APPROVED","body":"Hi {{1}}, we built you a site.","slots":1,"buttons":[{"type":"QUICK_REPLY","text":"Not interested"}]}),
            json!({"name":"built_a_site","title":"Built a site for you","language":"af","category":"MARKETING","status":"APPROVED","body":"Hallo {{1}}","slots":1,"buttons":[]}),
            json!({"name":"hl_vb","title":"Voice note offer","language":"en","category":"MARKETING","status":"APPROVED","body":"Hi","slots":0,"buttons":[]}),
            json!({"name":"plain_name","title":null,"language":"en","category":"UTILITY","status":"APPROVED","body":"Hello","slots":0,"buttons":[]}),
        ]
    }

    fn reference(name: &str, language: Option<&str>) -> TemplateReference {
        TemplateReference {
            name: name.into(),
            language: language.map(str::to_owned),
        }
    }

    #[test]
    fn a_template_resolves_by_title_or_meta_name_in_any_case() {
        let templates = template_fixture();
        let by_title = resolve_template(&templates, &reference("voice NOTE offer", None)).unwrap();
        assert_eq!(by_title["name"], "hl_vb");
        let by_name = resolve_template(&templates, &reference("HL_VB", None)).unwrap();
        assert_eq!(by_name["title"], "Voice note offer");
        let untitled = resolve_template(&templates, &reference("plain_name", None)).unwrap();
        assert_eq!(untitled["category"], "UTILITY");
    }

    #[test]
    fn a_template_with_two_languages_needs_the_language() {
        let templates = template_fixture();
        let error = resolve_template(&templates, &reference("built_a_site", None)).unwrap_err();
        assert!(matches!(error, CliError::Usage(_)), "{error}");
        assert!(error.to_string().contains("built_a_site (af)"), "{error}");
        let afrikaans =
            resolve_template(&templates, &reference("built_a_site", Some("AF"))).unwrap();
        assert_eq!(afrikaans["language"], "af");
    }

    #[test]
    fn an_unknown_template_or_a_number_is_not_found_and_lists_what_exists() {
        let templates = template_fixture();
        for wrong in ["1", "template 1", "no such template"] {
            let error = resolve_template(&templates, &reference(wrong, None)).unwrap_err();
            assert!(matches!(error, CliError::NotFound(_)), "{wrong}: {error}");
            assert!(error.to_string().contains("Voice note offer"), "{error}");
        }
        let error = resolve_template(&[], &reference("x", None)).unwrap_err();
        assert!(error.to_string().contains("none yet"), "{error}");
    }

    #[test]
    fn template_detail_carries_the_body_buttons_and_a_name_link() {
        let templates = template_fixture();
        let found = resolve_template(&templates, &reference("built_a_site", Some("en"))).unwrap();
        let detail = template_detail(&found);
        assert_eq!(detail["body"], "Hi {{1}}, we built you a site.");
        assert_eq!(detail["slots"], 1);
        assert_eq!(detail["buttons"][0]["text"], "Not interested");
        assert_eq!(detail["status"], "APPROVED");
        assert_eq!(detail["reference"], "buzz://template/built_a_site?lang=en");
    }

    fn list_lead(
        n: u128,
        name: &str,
        phone: Option<&str>,
        status: &str,
    ) -> crate::commands::leads::CurrentLead {
        use buzz_core::business_records::{
            PartyRecord, ProspectHead, ProspectQualification, ProspectRecordInput, ProspectStage,
            BUSINESS_RECORD_SCHEMA_VERSION,
        };
        let prospect_id = Uuid::from_u128(n);
        crate::commands::leads::CurrentLead {
            event_id: format!("{n:064x}"),
            channel_id: Uuid::from_u128(2),
            community_id: Uuid::from_u128(1),
            created_at: 1_800_000_000,
            head: ProspectHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                prospect_id,
                status: status.into(),
                prospect: ProspectRecordInput {
                    prospect_id,
                    party: PartyRecord {
                        party_id: prospect_id,
                        party_type: "organization".into(),
                        display_name: name.into(),
                        external_ids: Vec::new(),
                    },
                    industry: "Tourism".into(),
                    vertical: "Guesthouses".into(),
                    fit_score: None,
                    origin: None,
                    discovery_tags: Vec::new(),
                    potential_monthly_value_minor: None,
                    website: None,
                    contact_name: None,
                    location: None,
                    email: None,
                    phone: phone.map(str::to_owned),
                    whatsapp_phone: None,
                    evidence: Vec::new(),
                    last_verified_at: None,
                    qualification: ProspectQualification::Unreviewed,
                    saved: false,
                    stage: ProspectStage::Qualified,
                    lost_reason: None,
                },
                activities: Vec::new(),
                source_action_event_id: "0".repeat(64),
            },
        }
    }

    fn list_with(members: &[u128]) -> buzz_core::outreach_lists::OutreachListHead {
        use buzz_core::outreach_lists::{
            apply_list_action, ListActor, ListOp, ListSource, ListSourceKind, OutreachListAction,
        };
        let action = OutreachListAction {
            schema_version: 1,
            list_id: Uuid::from_u128(900),
            op: ListOp::Create,
            expected_head_event_id: None,
            name: Some("Melville guesthouses, Nov".into()),
            note: None,
            lead_ids: members.iter().map(|n| Uuid::from_u128(*n)).collect(),
            source: Some(ListSource {
                kind: ListSourceKind::Manual,
                campaign_id: None,
            }),
            default_template: None,
        };
        apply_list_action(
            None,
            &action,
            &ListActor {
                pubkey: "aa".repeat(32),
                is_agent: false,
            },
            1_800_000_100,
            &"0".repeat(64),
        )
        .expect("list head")
    }

    #[test]
    fn a_list_yields_rows_for_members_with_a_number_and_explains_every_skip() {
        let list = list_with(&[1, 2, 3, 4, 5, 6]);
        let leads = vec![
            list_lead(
                1,
                "Rosebank Guest House",
                Some(" +27 82 000 0000 "),
                "active",
            ),
            list_lead(2, "Parkview Lodge", None, "active"),
            list_lead(3, "Opted Out Inn", Some("+27 83 000 0000"), "active"),
            list_lead(4, "Old Place", Some("+27 84 000 0000"), "archived"),
            list_lead(5, "Blank Phone", Some("   "), "active"),
        ];
        let mut contacts = std::collections::HashMap::new();
        contacts.insert(
            Uuid::from_u128(3),
            WhatsappInfo {
                status: "opted_out".into(),
                opted_out: true,
            },
        );
        let plan = plan_list_rows(&list, &leads, &contacts, &["Thabo".to_owned()]);
        assert_eq!(plan.rows.len(), 1);
        assert_eq!(plan.rows[0].to, "+27 82 000 0000");
        assert_eq!(
            plan.rows[0].lead_id.as_deref(),
            Some(Uuid::from_u128(1).to_string().as_str())
        );
        assert_eq!(plan.rows[0].params, vec!["Thabo".to_owned()]);
        let reasons: Vec<(u128, &str)> = plan
            .skipped
            .iter()
            .map(|member| (member.lead_id.as_u128(), member.reason))
            .collect();
        assert_eq!(
            reasons,
            vec![
                (2, "no phone number"),
                (3, "opted out of WhatsApp"),
                (4, "the lead is archived"),
                (5, "no phone number"),
                (6, "the lead no longer exists"),
            ]
        );
        assert!(skipped_summary(&plan.skipped).contains("Opted Out Inn: opted out of WhatsApp"));
    }

    #[test]
    fn a_list_batch_answer_names_the_list_the_rows_and_the_skipped_members() {
        let list = list_with(&[1, 2]);
        let leads = vec![list_lead(1, "Rosebank", Some("+27 82 000 0000"), "active")];
        let plan = plan_list_rows(&list, &leads, &std::collections::HashMap::new(), &[]);
        let out: Value = serde_json::from_str(&list_batch_output(
            r#"{"event_id":"ab","accepted":true,"message":""}"#,
            Uuid::from_u128(900),
            &plan.skipped,
            plan.rows.len(),
        ))
        .unwrap();
        assert_eq!(out["accepted"], true);
        assert_eq!(out["rows"], 1);
        assert_eq!(out["list"], list_link(Uuid::from_u128(900)));
        assert_eq!(out["skipped"][0]["reason"], "the lead no longer exists");
        assert_eq!(
            out["skipped"][0]["reference"],
            crate::links::lead_link(Uuid::from_u128(2))
        );
    }

    #[test]
    fn an_empty_or_unreachable_list_explains_itself() {
        assert_eq!(skipped_summary(&[]), "the list is empty");
        let list = list_with(&[1]);
        let plan = plan_list_rows(&list, &[], &std::collections::HashMap::new(), &[]);
        assert!(plan.rows.is_empty());
        assert!(skipped_summary(&plan.skipped).contains("no longer exists"));
    }
}
