//! WhatsApp outreach member commands: batches, owner decisions, sends and settings.
//!
//! These run after the ingest pipeline has verified the signature, timestamp, identity and
//! `MessagesWrite` scope. This module owns the role checks: only the owner or an admin can
//! decide a batch or change settings; owner, admins and members of the private Outreach
//! channel can prepare batches and send inside an open window.
//!
//! Commands are recorded in the relay's own tables (batch, message and contact rows), not as
//! stored events: the event is the request, the tables are the durable state, and every
//! command carries its own idempotency key (`batchId`, `requestId`).

use std::collections::HashSet;
use std::sync::Arc;

use chrono::Utc;
use nostr::Event;
use serde::Deserialize;
use uuid::Uuid;

use buzz_core::kind::{
    KIND_WHATSAPP_BATCH, KIND_WHATSAPP_BATCH_DECISION, KIND_WHATSAPP_SEND_REQUEST,
    KIND_WHATSAPP_SETTINGS,
};
use buzz_core::TenantContext;
use buzz_db::whatsapp::{
    BatchDecisionOutcome, DraftDecisionOutcome, NewOutboundMessage, RowEdit, WhatsappBatch,
    MAX_DAILY_NEW_CHAT_CAP,
};

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;
use crate::whatsapp::connect::sync_templates;
use crate::whatsapp::policy::{
    clean_title, e164, normalize_wa_id, render_template, template_slot_count, window_open,
};
use crate::whatsapp::sender::{
    check_send, enqueue_send, Enqueued, SendCommand, SendContext, TemplateRef,
};
use crate::whatsapp::{access_for, channel, parse_uuid, Access};

const MAX_BATCH_ROWS: usize = 500;
const MAX_MATERIAL_LINKS: usize = 10;
const MAX_NOTE_CHARS: usize = 1000;
const MAX_ROW_REFUSALS_SHOWN: usize = 5;
const MAX_TEXT_CHARS: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchRow {
    to: String,
    #[serde(default)]
    lead_id: Option<String>,
    /// Optional name for the contact, used only when WhatsApp has not reported one.
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    params: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchCommand {
    v: u8,
    batch_id: String,
    template: String,
    #[serde(default = "default_language")]
    language: String,
    rows: Vec<BatchRow>,
    #[serde(default)]
    material_links: Vec<String>,
    #[serde(default)]
    note: String,
}

fn default_language() -> String {
    "en".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RowEditCommand {
    idx: i32,
    params: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionCommand {
    v: u8,
    /// Decide a batch ...
    #[serde(default)]
    batch_id: Option<String>,
    /// ... or one agent draft.
    #[serde(default)]
    draft_id: Option<String>,
    decision: String,
    #[serde(default)]
    drop_rows: Vec<i32>,
    #[serde(default)]
    edit_rows: Vec<RowEditCommand>,
    /// Edited text for a text draft.
    #[serde(default)]
    text: Option<String>,
    /// Edited parameters for a template draft.
    #[serde(default)]
    params: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendTemplate {
    name: String,
    #[serde(default = "default_language")]
    language: String,
    #[serde(default)]
    params: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequestCommand {
    v: u8,
    request_id: String,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    thread_root: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    template: Option<SendTemplate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsCommand {
    v: u8,
    #[serde(default)]
    daily_new_chat_cap: Option<i32>,
    #[serde(default)]
    sync_templates: Option<bool>,
    #[serde(default)]
    template_title: Option<TemplateTitleCommand>,
}

/// Rename a template (owner or admin) or propose a better title (any Outreach member).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateTitleCommand {
    /// Meta template name or the current title.
    template: String,
    #[serde(default = "default_language")]
    language: String,
    title: String,
    #[serde(default)]
    propose: bool,
}

fn restricted(reason: impl std::fmt::Display) -> IngestError {
    IngestError::Rejected(format!("restricted: {reason}"))
}

fn invalid(reason: impl std::fmt::Display) -> IngestError {
    IngestError::Rejected(format!("invalid: {reason}"))
}

fn internal(reason: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {reason}"))
}

fn parse<'a, T: Deserialize<'a>>(event: &'a Event) -> Result<T, IngestError> {
    serde_json::from_str(&event.content)
        .map_err(|error| invalid(format!("command content: {error}")))
}

fn ok(event: &Event, message: impl Into<String>) -> IngestResult {
    IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: message.into(),
    }
}

fn check_version(v: u8) -> Result<(), IngestError> {
    if v == 1 {
        Ok(())
    } else {
        Err(invalid("v must be 1"))
    }
}

/// Route one WhatsApp command.
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let access = access_for(state, tenant, auth.pubkey())
        .await
        .map_err(internal)?;
    let kind = u32::from(event.kind.as_u16());
    match kind {
        KIND_WHATSAPP_BATCH => handle_batch(tenant, state, &event, access).await,
        KIND_WHATSAPP_BATCH_DECISION => handle_decision(tenant, state, &event, access).await,
        KIND_WHATSAPP_SEND_REQUEST => handle_send(tenant, state, &event, access).await,
        KIND_WHATSAPP_SETTINGS => handle_settings(tenant, state, &event, access).await,
        _ => Err(invalid(format!("unknown WhatsApp command kind {kind}"))),
    }
}

/// Refusal text for one batch row, or `None` when the row can be sent.
pub fn row_refusal(contact: Option<&buzz_db::whatsapp::WhatsappContact>) -> Option<String> {
    let contact = contact?;
    if let Some(at) = contact.opted_out_at {
        return Some(format!("contact opted out on {}", at.format("%Y-%m-%d")));
    }
    if contact.paused_at.is_some() {
        return Some(format!(
            "contact is paused: {}",
            contact.pause_reason.as_deref().unwrap_or("blocked by Meta")
        ));
    }
    if contact.outbound_since_inbound >= 1 {
        return Some("already messaged with no reply yet".to_string());
    }
    None
}

fn valid_link(link: &str) -> bool {
    link.len() <= 2048
        && url::Url::parse(link)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

async fn handle_batch(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    access: Access,
) -> Result<IngestResult, IngestError> {
    if !access.can_send() {
        return Err(restricted(
            "only the owner, admins, their agents and Outreach members can prepare batches",
        ));
    }
    let command: BatchCommand = parse(event)?;
    check_version(command.v)?;
    let community = tenant.community();
    let batch_id = parse_uuid(&command.batch_id, "batchId").map_err(invalid)?;
    // GUARD: a retry of a batch the relay already holds is answered before any row check.
    // Rows of a batch that has since been sent fail the one-message-in-a-row rule, so
    // without this early answer a CLI retry would see an error for work that succeeded.
    if state
        .db
        .whatsapp_get_batch(community, batch_id)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Ok(ok(event, "duplicate: this batch was already received"));
    }
    if command.rows.is_empty() || command.rows.len() > MAX_BATCH_ROWS {
        return Err(invalid(format!(
            "a batch has 1 through {MAX_BATCH_ROWS} rows"
        )));
    }
    if command.material_links.len() > MAX_MATERIAL_LINKS
        || command.material_links.iter().any(|link| !valid_link(link))
    {
        return Err(invalid(format!(
            "materialLinks: up to {MAX_MATERIAL_LINKS} http(s) links"
        )));
    }
    if command.note.chars().count() > MAX_NOTE_CHARS {
        return Err(invalid(format!(
            "note is longer than {MAX_NOTE_CHARS} characters"
        )));
    }
    if state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(internal)?
        .is_none()
    {
        return Err(restricted("no WhatsApp number is connected"));
    }
    let template = state
        .db
        .whatsapp_find_template(community, command.template.trim(), command.language.trim())
        .await
        .map_err(internal)?
        .ok_or_else(|| {
            invalid(format!(
                "template {} ({}) is not approved; run `colony whatsapp templates`",
                command.template, command.language
            ))
        })?;
    let slots = template_slot_count(&template.body);

    let now = Utc::now();
    let sender = event.pubkey.to_bytes().to_vec();
    let mut refusals: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut rows: Vec<NewOutboundMessage> = Vec::with_capacity(command.rows.len());
    let mut leads: Vec<(String, String)> = Vec::new();
    let mut names: Vec<(String, String)> = Vec::new();
    for (index, row) in command.rows.iter().enumerate() {
        let label = format!("row {index} ({})", row.to.trim());
        let Some(wa_id) = normalize_wa_id(&row.to) else {
            refusals.push(format!("{label}: not a phone number"));
            continue;
        };
        if !seen.insert(wa_id.clone()) {
            refusals.push(format!("{label}: number appears twice in this batch"));
            continue;
        }
        if row.params.len() != slots {
            refusals.push(format!(
                "{label}: template needs {slots} parameter(s), got {}",
                row.params.len()
            ));
            continue;
        }
        let body = match render_template(&template.body, &row.params) {
            Ok(body) => body,
            Err(reason) => {
                refusals.push(format!("{label}: {reason}"));
                continue;
            }
        };
        let contact = state
            .db
            .whatsapp_get_contact(community, &wa_id)
            .await
            .map_err(internal)?;
        if let Some(reason) = row_refusal(contact.as_ref()) {
            refusals.push(format!("{label}: {reason}"));
            continue;
        }
        let new_chat = !window_open(contact.as_ref().and_then(|c| c.last_inbound_at), now);
        if let Some(lead) = row.lead_id.as_ref().filter(|lead| !lead.trim().is_empty()) {
            leads.push((wa_id.clone(), lead.trim().to_string()));
        }
        if let Some(name) = row.name.as_ref().filter(|name| !name.trim().is_empty()) {
            names.push((wa_id.clone(), name.trim().to_string()));
        }
        rows.push(NewOutboundMessage {
            id: Uuid::new_v4(),
            wa_id,
            kind: "template".to_string(),
            body,
            template_name: Some(template.name.clone()),
            template_language: Some(template.language.clone()),
            params: serde_json::json!(row.params),
            state: "held".to_string(),
            idempotency_key: format!("batch:{batch_id}:{index}"),
            batch_id: Some(batch_id),
            batch_idx: Some(index as i32),
            new_chat,
            sender_pubkey: sender.clone(),
        });
    }
    if !refusals.is_empty() {
        let shown = refusals
            .iter()
            .take(MAX_ROW_REFUSALS_SHOWN)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ");
        let more = refusals.len().saturating_sub(MAX_ROW_REFUSALS_SHOWN);
        return Err(invalid(format!(
            "{} row(s) refused, nothing was saved: {shown}{}",
            refusals.len(),
            if more > 0 {
                format!("; and {more} more")
            } else {
                String::new()
            }
        )));
    }

    for row in &rows {
        state
            .db
            .whatsapp_ensure_contact(community, &row.wa_id, None)
            .await
            .map_err(internal)?;
        state
            .db
            .whatsapp_set_owner_if_unowned(community, &row.wa_id, &sender)
            .await
            .map_err(internal)?;
    }
    for (wa_id, name) in &names {
        state
            .db
            .whatsapp_set_name_if_blank(community, wa_id, name)
            .await
            .map_err(internal)?;
    }
    for (wa_id, lead) in &leads {
        state
            .db
            .whatsapp_set_lead(community, wa_id, lead)
            .await
            .map_err(internal)?;
    }
    let batch = WhatsappBatch {
        id: batch_id,
        created_by: sender.clone(),
        template_name: template.name.clone(),
        language: template.language.clone(),
        status: "pending".to_string(),
        note: command.note.trim().to_string(),
        material_links: serde_json::json!(command.material_links),
        decided_by: None,
        decided_at: None,
        created_at: now,
    };
    let inserted = state
        .db
        .whatsapp_insert_batch(community, &batch, event.id.as_bytes(), &rows)
        .await
        .map_err(internal)?;
    if !inserted {
        return Ok(ok(event, "duplicate: this batch was already received"));
    }
    channel::post_notice(
        state,
        tenant,
        "batch_pending",
        &format!(
            "Batch {} is waiting for approval: {} message(s), template {}. Nothing is sent until the owner or an admin approves it.",
            &batch_id.simple().to_string()[..8],
            rows.len(),
            template.name
        ),
    )
    .await;
    Ok(ok(
        event,
        format!("pending approval: {} row(s)", rows.len()),
    ))
}

async fn handle_decision(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    access: Access,
) -> Result<IngestResult, IngestError> {
    if !access.is_owner_admin() {
        return Err(restricted(
            "only the owner or an admin can decide a batch or a draft",
        ));
    }
    let command: DecisionCommand = parse(event)?;
    check_version(command.v)?;
    if command.draft_id.is_some() {
        return handle_draft_decision(tenant, state, event, command).await;
    }
    let community = tenant.community();
    let batch_id =
        parse_uuid(command.batch_id.as_deref().unwrap_or(""), "batchId").map_err(invalid)?;
    let approve = match command.decision.as_str() {
        "approve" => true,
        "reject" => false,
        _ => return Err(invalid("decision must be approve or reject")),
    };
    let batch = state
        .db
        .whatsapp_get_batch(community, batch_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| invalid("no such batch"))?;
    let _ = ensure_batch_template;
    let mut edits = Vec::with_capacity(command.edit_rows.len());
    if !command.edit_rows.is_empty() {
        let template = state
            .db
            .whatsapp_get_template(community, &batch.template_name, &batch.language)
            .await
            .map_err(internal)?
            .ok_or_else(|| invalid("the batch template is no longer approved"))?;
        for edit in &command.edit_rows {
            let body = render_template(&template.body, &edit.params)
                .map_err(|reason| invalid(format!("row {}: {reason}", edit.idx)))?;
            edits.push(RowEdit {
                idx: edit.idx,
                params: serde_json::json!(edit.params),
                body,
            });
        }
    }
    let outcome = state
        .db
        .whatsapp_decide_batch(
            community,
            batch_id,
            &event.pubkey.to_bytes(),
            approve,
            &command.drop_rows,
            &edits,
            Utc::now(),
        )
        .await
        .map_err(internal)?;
    let short = batch_id.simple().to_string()[..8].to_string();
    match outcome {
        BatchDecisionOutcome::NotFound => Err(invalid("no such batch")),
        BatchDecisionOutcome::NotPending => Err(IngestError::Rejected(
            "duplicate: this batch was already decided".into(),
        )),
        BatchDecisionOutcome::UnknownRow(idx) => Err(invalid(format!(
            "row {idx} is not a pending row of this batch"
        ))),
        BatchDecisionOutcome::Approved(ready) => {
            channel::post_notice(
                state,
                tenant,
                "batch_approved",
                &format!(
                    "Batch {short} approved: {ready} message(s) will go out between 08:00 and 18:00 (Johannesburg), a few minutes apart, within the daily cap."
                ),
            )
            .await;
            Ok(ok(event, format!("approved: {ready} row(s) ready")))
        }
        BatchDecisionOutcome::Rejected => {
            channel::post_notice(
                state,
                tenant,
                "batch_rejected",
                &format!("Batch {short} was rejected. Nothing was sent."),
            )
            .await;
            Ok(ok(event, "rejected"))
        }
    }
}

/// Approving a batch sends real messages, so its template must still be approved on Meta.
/// The list is refreshed first (a failure falls back to the last sync); a template that is
/// gone or no longer approved leaves the batch pending and says so, instead of sending blind.
async fn ensure_batch_template(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    batch: &WhatsappBatch,
) -> Result<(), IngestError> {
    if let Err(error) = sync_templates(state, tenant).await {
        tracing::warn!("template refresh before batch approval failed: {error}");
    }
    let template = state
        .db
        .whatsapp_get_template(tenant.community(), &batch.template_name, &batch.language)
        .await
        .map_err(internal)?;
    if template
        .as_ref()
        .is_some_and(|template| template.status.eq_ignore_ascii_case("APPROVED"))
    {
        return Ok(());
    }
    let short = batch.id.simple().to_string()[..8].to_string();
    channel::post_notice(
        state,
        tenant,
        "template_missing",
        &format!(
            "Batch {short} was not approved: template {} ({}) is no longer approved on Meta.",
            batch.template_name, batch.language
        ),
    )
    .await;
    Err(invalid(format!(
        "template_missing: template {} ({}) is no longer approved on Meta; the batch stays pending, reject it and prepare a new one",
        batch.template_name, batch.language
    )))
}

/// Decide one agent draft: approve (optionally with edited text or parameters) or reject.
/// Approval re-checks every send rule, because the world may have changed since the draft.
async fn handle_draft_decision(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    command: DecisionCommand,
) -> Result<IngestResult, IngestError> {
    let community = tenant.community();
    let draft_id =
        parse_uuid(command.draft_id.as_deref().unwrap_or(""), "draftId").map_err(invalid)?;
    if command.batch_id.is_some() || !command.drop_rows.is_empty() || !command.edit_rows.is_empty()
    {
        return Err(invalid(
            "a draft decision takes draftId, decision, and optionally text or params",
        ));
    }
    let approve = match command.decision.as_str() {
        "approve" => true,
        "reject" => false,
        _ => return Err(invalid("decision must be approve or reject")),
    };
    let message = state
        .db
        .whatsapp_get_message(community, draft_id)
        .await
        .map_err(internal)?
        .filter(|message| message.direction == "out")
        .ok_or_else(|| invalid("no such draft"))?;
    if message.state != "draft" {
        return Err(IngestError::Rejected(
            "duplicate: this draft was already decided".into(),
        ));
    }

    let mut edit: Option<(String, serde_json::Value)> = None;
    if approve {
        let settings = state
            .db
            .whatsapp_ensure_settings(community)
            .await
            .map_err(internal)?;
        let contact = state
            .db
            .whatsapp_get_contact(community, &message.wa_id)
            .await
            .map_err(internal)?;
        // The draft itself is counted as pending; every other pending message still is.
        let pending = state
            .db
            .whatsapp_count_pending_outbound(community, &message.wa_id)
            .await
            .map_err(internal)?
            .saturating_sub(1);
        let plan = check_send(&SendContext {
            contact: contact.as_ref(),
            send_paused: settings.send_paused,
            pause_reason: settings.pause_reason.as_deref(),
            pending_outbound: pending,
            now: Utc::now(),
            is_owner_admin: true,
            is_template: message.kind == "template",
        })
        .map_err(restricted)?;
        if plan.new_chat {
            return Err(restricted(
                "the 24 hour window closed; a new chat needs an approved batch",
            ));
        }
        match message.kind.as_str() {
            "text" => {
                if command.params.is_some() {
                    return Err(invalid("params only edit a template draft"));
                }
                if let Some(text) = command.text.as_deref() {
                    let text = text.trim();
                    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
                        return Err(invalid(format!(
                            "text must be 1 through {MAX_TEXT_CHARS} characters"
                        )));
                    }
                    edit = Some((text.to_string(), message.params.clone()));
                }
            }
            _ => {
                if command.text.is_some() {
                    return Err(invalid("text only edits a text draft"));
                }
                if let Some(params) = command.params.as_ref() {
                    let (Some(name), Some(language)) = (
                        message.template_name.as_deref(),
                        message.template_language.as_deref(),
                    ) else {
                        return Err(invalid("the draft has no template"));
                    };
                    let template = state
                        .db
                        .whatsapp_get_template(community, name, language)
                        .await
                        .map_err(internal)?
                        .ok_or_else(|| invalid("the draft template is no longer approved"))?;
                    let body = render_template(&template.body, params).map_err(invalid)?;
                    edit = Some((body, serde_json::json!(params)));
                }
            }
        }
    }

    let outcome = state
        .db
        .whatsapp_decide_draft(
            community,
            draft_id,
            approve,
            edit.as_ref().map(|(body, params)| (body.as_str(), params)),
        )
        .await
        .map_err(internal)?;
    match outcome {
        DraftDecisionOutcome::NotFound => Err(invalid("no such draft")),
        DraftDecisionOutcome::NotDraft => Err(IngestError::Rejected(
            "duplicate: this draft was already decided".into(),
        )),
        DraftDecisionOutcome::Approved => {
            channel::post_notice(
                state,
                tenant,
                "draft_approved",
                &format!("Draft to {} approved and queued.", e164(&message.wa_id)),
            )
            .await;
            Ok(ok(event, "approved: queued"))
        }
        DraftDecisionOutcome::Rejected => {
            channel::post_notice(
                state,
                tenant,
                "draft_rejected",
                &format!(
                    "Draft to {} rejected. It will not be sent.",
                    e164(&message.wa_id)
                ),
            )
            .await;
            Ok(ok(event, "rejected"))
        }
    }
}

async fn handle_send(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    access: Access,
) -> Result<IngestResult, IngestError> {
    if !access.can_send() {
        return Err(restricted(
            "only the owner, admins, their agents and Outreach members can send",
        ));
    }
    let command: SendRequestCommand = parse(event)?;
    check_version(command.v)?;
    let request_id = parse_uuid(&command.request_id, "requestId").map_err(invalid)?;
    let send = SendCommand {
        request_id,
        to: command.to,
        thread_root: command.thread_root,
        text: command.text,
        template: command.template.map(|template| TemplateRef {
            name: template.name,
            language: template.language,
            params: template.params,
        }),
    };
    match enqueue_send(state, tenant, access, &event.pubkey.to_bytes(), &send)
        .await
        .map_err(restricted)?
    {
        Enqueued::Queued(id) => Ok(ok(event, format!("queued: {id}"))),
        Enqueued::Draft(id) => Ok(ok(
            event,
            format!("draft pending approval: {id}. An owner or admin must approve it before it is sent."),
        )),
        Enqueued::Duplicate => Ok(ok(event, "duplicate: this request was already queued")),
    }
}

async fn handle_settings(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    access: Access,
) -> Result<IngestResult, IngestError> {
    let command: SettingsCommand = parse(event)?;
    check_version(command.v)?;
    let community = tenant.community();
    let proposing_only = command.daily_new_chat_cap.is_none()
        && command.sync_templates != Some(true)
        && command.template_title.as_ref().is_some_and(|t| t.propose);
    // GUARD: only the owner or an admin changes settings or renames; any member who can send
    // may only PROPOSE a template title.
    if proposing_only {
        if !access.can_send() {
            return Err(restricted(
                "only the owner, admins, their agents and Outreach members can propose a title",
            ));
        }
    } else if !access.is_owner_admin() {
        return Err(restricted(
            "only the owner or an admin can change WhatsApp settings",
        ));
    }
    if command.daily_new_chat_cap.is_none()
        && command.sync_templates != Some(true)
        && command.template_title.is_none()
    {
        return Err(invalid(
            "nothing to change: set dailyNewChatCap, syncTemplates or templateTitle",
        ));
    }
    let mut changes = Vec::new();
    if let Some(cap) = command.daily_new_chat_cap {
        if !(0..=MAX_DAILY_NEW_CHAT_CAP).contains(&cap) {
            return Err(invalid(format!(
                "dailyNewChatCap must be 0 through {MAX_DAILY_NEW_CHAT_CAP}"
            )));
        }
        state
            .db
            .whatsapp_set_daily_cap(community, cap)
            .await
            .map_err(internal)?;
        channel::post_notice(
            state,
            tenant,
            "cap_changed",
            &format!("Daily cap on new chats is now {cap}."),
        )
        .await;
        changes.push(format!("cap {cap}"));
    }
    if command.sync_templates == Some(true) {
        let count = sync_templates(state, tenant).await.map_err(restricted)?;
        changes.push(format!("{count} template(s) synced"));
    }
    if let Some(rename) = command.template_title.as_ref() {
        let title = clean_title(&rename.title).ok_or_else(|| invalid("title is empty"))?;
        let template = state
            .db
            .whatsapp_find_template(community, rename.template.trim(), rename.language.trim())
            .await
            .map_err(internal)?
            .ok_or_else(|| invalid("no such template (use its title or Meta name)"))?;
        if rename.propose {
            state
                .db
                .whatsapp_propose_template_title(
                    community,
                    &template.name,
                    &template.language,
                    &title,
                    &event.pubkey.to_bytes(),
                )
                .await
                .map_err(internal)?;
            channel::post_notice(
                state,
                tenant,
                "template_title_proposed",
                &format!(
                    "Proposed title for \"{}\": \"{title}\". The owner or an admin can accept it.",
                    template.title
                ),
            )
            .await;
            changes.push(format!("proposed title \"{title}\""));
        } else {
            state
                .db
                .whatsapp_set_template_title(community, &template.name, &template.language, &title)
                .await
                .map_err(internal)?;
            changes.push(format!("title \"{title}\""));
        }
    }
    Ok(ok(event, changes.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_db::whatsapp::WhatsappContact;
    use chrono::TimeZone;

    fn contact() -> WhatsappContact {
        WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: String::new(),
            lead_id: None,
            owner_pubkey: None,
            thread_root_event_id: None,
            last_inbound_at: None,
            last_outbound_at: None,
            outbound_since_inbound: 0,
            opted_out_at: None,
            opt_out_reason: None,
            paused_at: None,
            pause_reason: None,
            created_at: Utc
                .with_ymd_and_hms(2026, 10, 1, 8, 0, 0)
                .single()
                .expect("time"),
        }
    }

    #[test]
    fn rows_to_blocked_contacts_are_refused_with_a_reason() {
        assert_eq!(row_refusal(None), None);
        assert_eq!(row_refusal(Some(&contact())), None);
        let mut opted = contact();
        opted.opted_out_at = Some(
            Utc.with_ymd_and_hms(2026, 10, 20, 8, 0, 0)
                .single()
                .expect("time"),
        );
        assert_eq!(
            row_refusal(Some(&opted)).as_deref(),
            Some("contact opted out on 2026-10-20")
        );
        let mut paused = contact();
        paused.paused_at = Some(Utc::now());
        assert!(row_refusal(Some(&paused))
            .expect("refusal")
            .starts_with("contact is paused"));
        let mut waiting = contact();
        waiting.outbound_since_inbound = 1;
        assert_eq!(
            row_refusal(Some(&waiting)).as_deref(),
            Some("already messaged with no reply yet")
        );
    }

    #[test]
    fn material_links_must_be_http_urls() {
        assert!(valid_link("https://horizon.example/brochure.pdf"));
        assert!(valid_link("http://example.com/a"));
        assert!(!valid_link("javascript:alert(1)"));
        assert!(!valid_link("ftp://example.com/a"));
        assert!(!valid_link("not a url"));
        assert!(!valid_link(&format!(
            "https://example.com/{}",
            "a".repeat(3000)
        )));
    }

    #[test]
    fn commands_parse_the_documented_shapes() {
        let batch: BatchCommand = serde_json::from_str(
            r#"{"v":1,"batchId":"6f1f4f7a-3c3a-4e0e-9b55-0b6c3f6f9a11","template":"intro","rows":[{"to":"+27821234567","leadId":"x","params":["Thabo"]}]}"#,
        )
        .expect("batch");
        assert_eq!(batch.language, "en");
        assert_eq!(batch.rows[0].params, vec!["Thabo".to_string()]);
        let decision: DecisionCommand = serde_json::from_str(
            r#"{"v":1,"batchId":"6f1f4f7a-3c3a-4e0e-9b55-0b6c3f6f9a11","decision":"approve","dropRows":[3],"editRows":[{"idx":2,"params":["N"]}]}"#,
        )
        .expect("decision");
        assert_eq!(decision.drop_rows, vec![3]);
        assert_eq!(decision.edit_rows[0].idx, 2);
        let send: SendRequestCommand = serde_json::from_str(
            r#"{"v":1,"requestId":"6f1f4f7a-3c3a-4e0e-9b55-0b6c3f6f9a11","threadRoot":"ab","text":"hi"}"#,
        )
        .expect("send");
        assert_eq!(send.thread_root.as_deref(), Some("ab"));
        let settings: SettingsCommand =
            serde_json::from_str(r#"{"v":1,"dailyNewChatCap":45}"#).expect("settings");
        assert_eq!(settings.daily_new_chat_cap, Some(45));
        assert_eq!(e164("27821234567"), "+27821234567");
    }
}
