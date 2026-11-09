//! Turn a Meta webhook payload into Colony messages, opt-outs and delivery states.
//!
//! The HTTP layer has already checked the signature. Everything here is bound to one
//! company's connection: a payload for another phone number id is ignored.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::Value;

use buzz_core::business_records::{ProspectActivityKind, ProspectHead};
use buzz_core::kind::KIND_PROSPECT_HEAD;
use buzz_core::TenantContext;
use buzz_db::whatsapp::{WhatsappConnection, WhatsappStatusHealthUpdate};
use buzz_db::EventQuery;

use super::channel;
use super::connect::{refresh_phone_info, sync_templates};
use super::policy::{
    account_retry_error_codes, classify_failure_code, contact_label, e164,
    has_complaint_or_legal_signal, is_wants_call_tap, match_opt_out, normalize_wa_id, FailureKind,
};
use super::sender::handle_failure;
use crate::state::AppState;
use buzz_core::whatsapp_stage::OptOutKind;

const MAX_LEADS_SCANNED: i64 = 2000;

/// Result of looking up one WhatsApp number in the active prospect heads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeadPhoneMatch {
    /// No active prospect head names this number through the bounded resolver.
    None,
    /// Exactly one active prospect head uses this number.
    Unique(String),
    /// More than one active prospect head uses this number, so linking would be unsafe.
    Ambiguous,
}

/// One bounded snapshot of active prospect phone and Scout-note candidates for a company.
///
/// The sender shares this snapshot across its bounded row batch, while inbound and direct
/// sends can load it for their one lookup. Keeping the matching rules here prevents the paths
/// from drifting apart.
#[derive(Debug, Default)]
pub struct LeadPhoneLookup {
    phone_matches: HashMap<String, LeadPhoneMatch>,
    activity_note_matches: HashMap<String, LeadPhoneMatch>,
}

impl LeadPhoneLookup {
    /// Resolve one normalized WhatsApp id against this authoritative snapshot.
    ///
    /// An exact `prospect.phone` match is always authoritative. Only when no prospect phone
    /// names the number do we use the narrower Scout-note fallback.
    pub fn find_lead_by_phone(&self, wa_id: &str) -> LeadPhoneMatch {
        match self
            .phone_matches
            .get(wa_id)
            .cloned()
            .unwrap_or(LeadPhoneMatch::None)
        {
            LeadPhoneMatch::None => self
                .activity_note_matches
                .get(wa_id)
                .cloned()
                .unwrap_or(LeadPhoneMatch::None),
            primary => primary,
        }
    }
}

/// Extract the deliberately narrow phone tokens Scout writes in an activity note.
///
/// A token contains only ASCII digits, one optional `+`, and ASCII spaces. Splitting on every
/// other character keeps adjacent digits in the same token, so a target can never match a
/// substring of a longer digit run. `normalize_wa_id` then rejects malformed tokens and turns
/// the accepted local and international forms into WhatsApp's canonical digits.
fn activity_note_phone_tokens(note: &str) -> impl Iterator<Item = String> + '_ {
    note.split(|ch: char| !(ch.is_ascii_digit() || matches!(ch, '+' | ' ')))
        .filter_map(normalize_wa_id)
}

fn candidate_matches(
    candidates: HashMap<String, HashSet<String>>,
) -> HashMap<String, LeadPhoneMatch> {
    candidates
        .into_iter()
        .map(|(wa_id, candidate_ids)| {
            let mut candidate_ids = candidate_ids.into_iter();
            let matched = match (candidate_ids.next(), candidate_ids.next()) {
                (Some(lead_id), None) => LeadPhoneMatch::Unique(lead_id),
                _ => LeadPhoneMatch::Ambiguous,
            };
            (wa_id, matched)
        })
        .collect()
}

/// The media or structured content of an inbound message: a picture, sticker, voice note,
/// document, location or contact card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMedia {
    /// `image`, `video`, `audio`, `voice`, `document`, `sticker`, `location` or `contacts`.
    pub kind: &'static str,
    /// What is kept in the database (`type`, `mediaId`, `mime`, `caption`, ...).
    pub data: Value,
}

impl InboundMedia {
    /// The Meta media id, when there are bytes to download.
    pub fn media_id(&self) -> Option<&str> {
        self.data.get("mediaId").and_then(Value::as_str)
    }

    /// `pending` when bytes have to be downloaded, `failed` when the payload named a file but
    /// gave no usable id, `None` for a location or contact card (nothing to download).
    pub fn initial_state(&self) -> Option<&'static str> {
        match self.kind {
            "location" | "contacts" => None,
            _ if self.media_id().is_some() => Some("pending"),
            _ => Some("failed"),
        }
    }

    /// The reason for a `failed` initial state.
    pub fn initial_error(&self) -> Option<&'static str> {
        (self.initial_state() == Some("failed")).then_some("no_media_id")
    }
}

/// One inbound customer message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    /// Sender's `wa_id` (digits).
    pub wa_id: String,
    /// Profile name from the payload.
    pub name: Option<String>,
    /// WhatsApp message id.
    pub wamid: String,
    /// When the customer sent it.
    pub at: DateTime<Utc>,
    /// `text`, `button`, `media` or `other`.
    pub kind: &'static str,
    /// Text, caption, button title or a short placeholder.
    pub text: String,
    /// The message is a button reply.
    pub is_button: bool,
    /// WhatsApp id of the message this one answers (the template a button was tapped on).
    pub context_wamid: Option<String>,
    /// The media or structured content, when the message has any.
    pub media: Option<InboundMedia>,
}

/// One delivery status callback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusUpdate {
    /// WhatsApp message id.
    pub wamid: String,
    /// `sent`, `delivered`, `read` or `failed`.
    pub state: &'static str,
    /// Meta error code on failure.
    pub code: Option<i64>,
    /// Meta error text on failure.
    pub error_text: Option<String>,
}

/// Everything the relay acts on in one payload.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedPayload {
    /// Customer messages.
    pub messages: Vec<InboundMessage>,
    /// Delivery statuses.
    pub statuses: Vec<StatusUpdate>,
    /// Meta reported a quality or number change.
    pub phone_changed: bool,
    /// Template status changes: `(name, event)`.
    pub template_events: Vec<(String, String)>,
}

fn timestamp(value: Option<&Value>) -> DateTime<Utc> {
    value
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse::<i64>().ok())
                .or_else(|| v.as_i64())
        })
        .and_then(|secs| DateTime::from_timestamp(secs, 0))
        .unwrap_or_else(Utc::now)
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn parse_message(
    message: &Value,
    names: &std::collections::HashMap<String, String>,
) -> Option<InboundMessage> {
    let from = message.get("from")?.as_str()?;
    let wa_id: String = from.chars().filter(char::is_ascii_digit).collect();
    if !(6..=15).contains(&wa_id.len()) {
        return None;
    }
    let wamid = message.get("id")?.as_str()?.to_string();
    if wamid.is_empty() || wamid.len() > 256 {
        return None;
    }
    let at = timestamp(message.get("timestamp"));
    let text_at = |path: &str| {
        message
            .pointer(path)
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");
    let mut media = None;
    let (kind, text, is_button) = match message_type {
        "text" => ("text", text_at("/text/body").unwrap_or_default(), false),
        "button" => ("button", text_at("/button/text").unwrap_or_default(), true),
        "interactive" => {
            let title = text_at("/interactive/button_reply/title")
                .or_else(|| text_at("/interactive/list_reply/title"))
                .unwrap_or_default();
            ("button", title, true)
        }
        "image" | "video" | "document" | "audio" | "sticker" => {
            let found = media_of(message, message_type);
            let caption = found
                .data
                .get("caption")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let placeholder = match found.kind {
                "voice" => "[voice note]",
                "audio" => "[audio]",
                "video" => "[video]",
                "document" => "[document]",
                "sticker" => "[sticker]",
                _ => "[image]",
            };
            media = Some(found);
            (
                "media",
                caption
                    .filter(|caption| !caption.trim().is_empty())
                    .unwrap_or_else(|| placeholder.to_string()),
                false,
            )
        }
        "location" => {
            let found = location_of(message);
            let text = found
                .data
                .get("name")
                .and_then(Value::as_str)
                .map(|name| format!("[location] {name}"))
                .unwrap_or_else(|| "[location]".to_string());
            media = Some(found);
            ("other", text, false)
        }
        "contacts" => {
            let found = contacts_of(message);
            let names = found
                .data
                .pointer("/contacts")
                .and_then(Value::as_array)
                .map(|contacts| {
                    contacts
                        .iter()
                        .filter_map(|contact| contact.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|names| !names.is_empty());
            let text = match names {
                Some(names) => format!("[contact card] {names}"),
                None => "[contact card]".to_string(),
            };
            media = Some(found);
            ("other", text, false)
        }
        // Reactions are not messages: they never open a window or wake an agent.
        "reaction" => return None,
        _ => ("other", "[unsupported message]".to_string(), false),
    };
    Some(InboundMessage {
        name: names.get(&wa_id).cloned(),
        wa_id,
        wamid,
        at,
        kind,
        text: clip(&text, 4000),
        is_button,
        context_wamid: message
            .pointer("/context/id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 256)
            .map(str::to_owned),
        media,
    })
}

fn clipped(value: Option<&Value>, max: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|text| clip(text.trim(), max))
        .filter(|text| !text.is_empty())
}

/// The downloadable media of an image, video, document, audio or sticker message.
fn media_of(message: &Value, message_type: &str) -> InboundMedia {
    let body = message.get(message_type);
    let field = |name: &str| body.and_then(|body| body.get(name));
    let media_id = field("id")
        .and_then(Value::as_str)
        .filter(|id| super::graph::media_id_is_safe(id));
    let voice = message_type == "audio" && field("voice").and_then(Value::as_bool) == Some(true);
    let animated =
        message_type == "sticker" && field("animated").and_then(Value::as_bool) == Some(true);
    let kind = match message_type {
        "audio" if voice => "voice",
        "audio" => "audio",
        "video" => "video",
        "document" => "document",
        "sticker" => "sticker",
        _ => "image",
    };
    let mut data = serde_json::Map::new();
    data.insert("type".into(), Value::from(kind));
    if let Some(id) = media_id {
        data.insert("mediaId".into(), Value::from(id));
    }
    for (key, source, max) in [
        ("mime", "mime_type", 100),
        ("sha256", "sha256", 100),
        ("caption", "caption", 1024),
        ("filename", "filename", 200),
    ] {
        if let Some(text) = clipped(field(source), max) {
            data.insert(key.into(), Value::from(text));
        }
    }
    if animated {
        data.insert("animated".into(), Value::from(true));
    }
    InboundMedia {
        kind,
        data: Value::Object(data),
    }
}

/// A shared location. Coordinates are kept only when they are real numbers on the globe.
fn location_of(message: &Value) -> InboundMedia {
    let location = message.get("location");
    let coordinate = |name: &str, limit: f64| {
        location
            .and_then(|location| location.get(name))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && value.abs() <= limit)
    };
    let mut data = serde_json::Map::new();
    data.insert("type".into(), Value::from("location"));
    if let (Some(latitude), Some(longitude)) =
        (coordinate("latitude", 90.0), coordinate("longitude", 180.0))
    {
        data.insert("latitude".into(), Value::from(latitude));
        data.insert("longitude".into(), Value::from(longitude));
    }
    for name in ["name", "address"] {
        if let Some(text) = clipped(location.and_then(|location| location.get(name)), 300) {
            data.insert(name.into(), Value::from(text));
        }
    }
    InboundMedia {
        kind: "location",
        data: Value::Object(data),
    }
}

/// Shared contact cards: a name and the phone numbers of each, at most ten cards.
fn contacts_of(message: &Value) -> InboundMedia {
    let cards: Vec<Value> = message
        .get("contacts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(10)
        .map(|card| {
            let name = clipped(card.pointer("/name/formatted_name"), 200)
                .or_else(|| clipped(card.pointer("/name/first_name"), 200));
            let phones: Vec<Value> = card
                .get("phones")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|phone| clipped(phone.get("phone"), 40))
                .take(5)
                .map(Value::from)
                .collect();
            let mut out = serde_json::Map::new();
            if let Some(name) = name {
                out.insert("name".into(), Value::from(name));
            }
            out.insert("phones".into(), Value::Array(phones));
            Value::Object(out)
        })
        .collect();
    InboundMedia {
        kind: "contacts",
        data: serde_json::json!({"type": "contacts", "contacts": cards}),
    }
}

/// Read a webhook payload. Messages for another phone number id are dropped.
pub fn parse_payload(payload: &Value, expected_phone_number_id: &str) -> ParsedPayload {
    let mut parsed = ParsedPayload::default();
    let entries = payload.get("entry").and_then(Value::as_array);
    for entry in entries.into_iter().flatten() {
        let changes = entry.get("changes").and_then(Value::as_array);
        for change in changes.into_iter().flatten() {
            let field = change.get("field").and_then(Value::as_str).unwrap_or("");
            let Some(value) = change.get("value") else {
                continue;
            };
            match field {
                "messages" => {
                    let phone_id = value
                        .pointer("/metadata/phone_number_id")
                        .and_then(Value::as_str);
                    if phone_id.is_some_and(|id| id != expected_phone_number_id) {
                        continue;
                    }
                    let mut names = std::collections::HashMap::new();
                    for contact in value
                        .get("contacts")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if let (Some(id), Some(name)) = (
                            contact.get("wa_id").and_then(Value::as_str),
                            contact.pointer("/profile/name").and_then(Value::as_str),
                        ) {
                            names.insert(id.to_string(), clip(name, 200));
                        }
                    }
                    for message in value
                        .get("messages")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if let Some(message) = parse_message(message, &names) {
                            parsed.messages.push(message);
                        }
                    }
                    for status in value
                        .get("statuses")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        let Some(wamid) = status.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let state = match status.get("status").and_then(Value::as_str) {
                            Some("sent") => "sent",
                            Some("delivered") => "delivered",
                            Some("read") => "read",
                            Some("failed") => "failed",
                            _ => continue,
                        };
                        let error = status.pointer("/errors/0");
                        parsed.statuses.push(StatusUpdate {
                            wamid: wamid.to_string(),
                            state,
                            code: error.and_then(|e| e.get("code")).and_then(Value::as_i64),
                            error_text: error
                                .and_then(|e| {
                                    e.get("message")
                                        .or_else(|| e.get("title"))
                                        .and_then(Value::as_str)
                                })
                                .map(|text| clip(text, 300)),
                        });
                    }
                }
                "phone_number_quality_update" | "phone_number_name_update" | "account_update" => {
                    parsed.phone_changed = true;
                }
                "message_template_status_update" => {
                    if let (Some(name), Some(event)) = (
                        value.get("message_template_name").and_then(Value::as_str),
                        value.get("event").and_then(Value::as_str),
                    ) {
                        parsed
                            .template_events
                            .push((clip(name, 200), clip(event, 40)));
                    }
                }
                _ => {}
            }
        }
    }
    parsed
}

/// Load the bounded authoritative prospect-phone and activity-note index for a company.
///
/// Fetching one extra row makes an over-limit result an error instead of silently treating a
/// truncated snapshot as a no-match. Callers then leave their durable retry record untouched.
pub async fn load_lead_phone_lookup(
    state: &Arc<AppState>,
    tenant: &TenantContext,
) -> Result<LeadPhoneLookup, String> {
    let mut query = EventQuery::for_community(tenant.community());
    query.kinds = Some(vec![KIND_PROSPECT_HEAD as i32]);
    query.limit = Some(MAX_LEADS_SCANNED + 1);
    query.max_limit = Some(MAX_LEADS_SCANNED + 1);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(|error| format!("prospect phone lookup failed: {error}"))?;
    if rows.len() > MAX_LEADS_SCANNED as usize {
        return Err(format!(
            "prospect phone lookup exceeds its bounded scan of {MAX_LEADS_SCANNED} heads"
        ));
    }

    let mut phone_candidates: HashMap<String, HashSet<String>> = HashMap::new();
    let mut activity_note_candidates: HashMap<String, HashSet<String>> = HashMap::new();
    for stored in rows {
        let head: ProspectHead = serde_json::from_str(&stored.event.content)
            .map_err(|error| format!("invalid prospect head during phone lookup: {error}"))?;
        if head.status == "archived" {
            continue;
        }
        let prospect_id = head.prospect_id.to_string();
        if let Some(wa_id) = head.prospect.phone.as_deref().and_then(normalize_wa_id) {
            phone_candidates
                .entry(wa_id)
                .or_default()
                .insert(prospect_id.clone());
        }
        for activity in &head.activities {
            if activity.activity_kind != ProspectActivityKind::Note {
                continue;
            }
            for wa_id in activity_note_phone_tokens(&activity.content) {
                activity_note_candidates
                    .entry(wa_id)
                    .or_default()
                    .insert(prospect_id.clone());
            }
        }
    }

    Ok(LeadPhoneLookup {
        phone_matches: candidate_matches(phone_candidates),
        activity_note_matches: candidate_matches(activity_note_candidates),
    })
}

/// Find the active lead whose phone number matches, by E.164 digits.
///
/// This prefers an exact `prospect.phone` match, then falls back to one uniquely matching
/// active activity note using [`activity_note_phone_tokens`].
pub async fn find_lead_by_phone(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    wa_id: &str,
) -> Result<LeadPhoneMatch, String> {
    Ok(load_lead_phone_lookup(state, tenant)
        .await?
        .find_lead_by_phone(wa_id))
}

/// Act on one verified payload. An `Err` makes the webhook answer 500 so Meta retries.
pub async fn process_payload(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection: &WhatsappConnection,
    payload: &Value,
) -> Result<(), String> {
    let parsed = parse_payload(payload, &connection.phone_number_id);
    let mut failures = Vec::new();
    for message in &parsed.messages {
        if let Err(error) = handle_message(state, tenant, connection, message).await {
            tracing::warn!(wamid = %message.wamid, "whatsapp inbound message failed: {error}");
            failures.push(error);
        }
    }
    for status in &parsed.statuses {
        if let Err(error) = handle_status(state, tenant, status).await {
            tracing::warn!(wamid = %status.wamid, "whatsapp status failed: {error}");
            failures.push(error);
        }
    }
    if parsed.phone_changed {
        if let Err(error) = refresh_phone_info(state, tenant).await {
            tracing::warn!("whatsapp phone refresh failed: {error}");
        }
    }
    for (name, event) in &parsed.template_events {
        handle_template_event(state, tenant, name, event).await;
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

async fn handle_message(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection: &WhatsappConnection,
    message: &InboundMessage,
) -> Result<(), String> {
    let community = tenant.community();
    let settings = state
        .db
        .whatsapp_ensure_settings(community)
        .await
        .map_err(|error| error.to_string())?;
    let mut contact = state
        .db
        .whatsapp_ensure_contact(community, &message.wa_id, message.name.as_deref())
        .await
        .map_err(|error| error.to_string())?;

    // Dedupe by WhatsApp message id. A repeat whose Colony post never landed is finished
    // instead of dropped, so a failed post is retried by Meta's own redelivery.
    let stored_id = state
        .db
        .whatsapp_insert_inbound(
            community,
            &message.wa_id,
            message.kind,
            &message.text,
            &message.wamid,
            message.at,
        )
        .await
        .map_err(|error| error.to_string())?;
    let stored = match stored_id {
        Some(id) => state
            .db
            .whatsapp_get_message(community, id)
            .await
            .map_err(|error| error.to_string())?,
        None => state
            .db
            .whatsapp_get_message_by_wamid(community, &message.wamid)
            .await
            .map_err(|error| error.to_string())?,
    };
    let Some(stored) = stored else {
        return Err("stored message vanished".into());
    };

    if contact.lead_id.is_none() {
        if let LeadPhoneMatch::Unique(lead_id) =
            find_lead_by_phone(state, tenant, &message.wa_id).await?
        {
            contact.lead_id = Some(lead_id);
        }
    }
    let opt_out = match_opt_out(&message.text);
    let opt_out_kind = opt_out.map(|matched| matched.kind);
    // Every safety write is one transaction. A failed write returns 500, so Meta redelivers the
    // same inbound message instead of allowing an incomplete contact or business fence.
    let safety = state
        .db
        .whatsapp_record_inbound_safety(
            community,
            &message.wa_id,
            contact.lead_id.as_deref(),
            message.at,
            opt_out_kind.map(OptOutKind::reason),
            opt_out.map(|matched| matched.rule_id),
        )
        .await
        .map_err(|error| error.to_string())?;

    // Keep what Meta said about the media (its id expires), then fetch the bytes while the
    // webhook is still open so the picture is there when the owner opens the chat. The first
    // call per message writes; a redelivery repeats it harmlessly. A download that does not
    // finish here is retried by the sender loop from the durable record.
    if let Some(media) = message.media.as_ref() {
        state
            .db
            .whatsapp_set_inbound_media(
                community,
                stored.id,
                &media.data,
                media.initial_state(),
                media.initial_error(),
                Utc::now(),
            )
            .await
            .map_err(|error| error.to_string())?;
        if media.initial_state() == Some("pending") {
            super::media::fetch_inline(state, tenant, connection, stored.id).await;
        }
    }

    // A tap on the template's first quick-reply button means "call me". Recorded on the
    // message so the contact's stage reads it later; safe to repeat on a redelivery.
    if message.is_button
        && opt_out_kind.is_none()
        && tap_means_wants_call(state, community, message).await?
    {
        state
            .db
            .whatsapp_set_message_intent(community, stored.id, "wants_call")
            .await
            .map_err(|error| error.to_string())?;
    }

    contact = state
        .db
        .whatsapp_get_contact(community, &message.wa_id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(contact);

    if stored.event_id.is_none() {
        let channel_id = settings
            .outreach_channel_id
            .ok_or_else(|| "the Outreach channel does not exist yet".to_string())?;
        channel::post_for_message(state, tenant, channel_id, &contact, &stored).await?;
    }
    // Scout hears about a reply once, whoever answers it. The wake carries the
    // message id only, never the contact's name or text.
    crate::cofounder_wake::enqueue(
        state,
        community,
        crate::cofounder_wake::WakeReason::InboundReply,
        &format!("reply:{}", stored.id),
        "",
    )
    .await;
    if safety.opted_out_now {
        let label = contact_label(&contact.display_name, &contact.wa_id);
        let who = if label == e164(&contact.wa_id) {
            label
        } else {
            format!("{label} ({})", e164(&contact.wa_id))
        };
        let what = if opt_out_kind == Some(OptOutKind::NoThanks) {
            "said no thanks"
        } else {
            "asked to stop"
        };
        channel::post_notice(
            state,
            tenant,
            "opt_out",
            &format!("{who} {what}. Nothing more will be sent to them."),
        )
        .await;
    }
    if opt_out_kind.is_some() && has_complaint_or_legal_signal(&message.text) {
        channel::post_owner_notice(
            state,
            tenant,
            "opt_out_legal_escalation",
            "A contact opted out and mentioned a complaint or legal action. Outreach remains stopped; review the conversation before any further action.",
        )
        .await;
    }
    if safety.business_stopped_now {
        channel::post_notice(
            state,
            tenant,
            "business_outreach_stopped",
            "An inbound reply stopped outreach to every contact of this business.",
        )
        .await;
    }
    Ok(())
}

/// Does this button tap answer the first quick-reply button of the template it was tapped on?
/// The template is found from the tapped message (`context.id`); when that is missing or
/// unknown the literal fallback applies (see [`is_wants_call_tap`]).
async fn tap_means_wants_call(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    message: &InboundMessage,
) -> Result<bool, String> {
    let mut buttons = None;
    if let Some(context) = message.context_wamid.as_deref() {
        let tapped = state
            .db
            .whatsapp_get_message_by_wamid(community, context)
            .await
            .map_err(|error| error.to_string())?;
        if let Some((name, language)) = tapped
            .filter(|row| row.direction == "out")
            .and_then(|row| row.template_name.zip(row.template_language))
        {
            buttons = state
                .db
                .whatsapp_get_template(community, &name, &language)
                .await
                .map_err(|error| error.to_string())?
                .map(|template| template.buttons);
        }
    }
    Ok(is_wants_call_tap(buttons.as_ref(), &message.text))
}

async fn handle_status(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    status: &StatusUpdate,
) -> Result<(), String> {
    let community = tenant.community();
    let code = status.code.map(|c| c.to_string());
    let account_failure = status
        .code
        .map(classify_failure_code)
        .and_then(|kind| match kind {
            FailureKind::Account(failure) => Some(failure),
            _ => None,
        });
    let error_text = status
        .error_text
        .as_deref()
        .unwrap_or("Meta did not provide an error message");
    let updated = state
        .db
        .whatsapp_update_status_with_account_health(
            community,
            &WhatsappStatusHealthUpdate {
                wamid: &status.wamid,
                state: status.state,
                error_code: code.as_deref(),
                error_text: (status.state == "failed").then_some(error_text),
                account_pause_reason: account_failure.map(|failure| failure.health_title()),
                at: Utc::now(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    if status.state == "failed" {
        if updated.became_unhealthy {
            let account_codes = account_retry_error_codes();
            let waiting = state
                .db
                .whatsapp_count_account_health_waiting(community, &account_codes)
                .await
                .unwrap_or(0);
            if let Some(failure) = account_failure {
                channel::post_owner_notice(
                    state,
                    tenant,
                    "account_sending_paused",
                    &failure.health_banner(waiting),
                )
                .await;
            }
        }
        if let Some(message) = updated.message.filter(|_| account_failure.is_none()) {
            handle_failure(state, tenant, &message, status.code, error_text).await;
        }
    }
    Ok(())
}

async fn handle_template_event(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    name: &str,
    event: &str,
) {
    let community = tenant.community();
    let upper = event.to_ascii_uppercase();
    if upper == "APPROVED" {
        let _ = state
            .db
            .whatsapp_clear_issue(community, "template_paused")
            .await;
    } else if matches!(
        upper.as_str(),
        "PAUSED" | "DISABLED" | "REJECTED" | "FLAGGED"
    ) {
        let message = format!("Template {name} is {}.", upper.to_ascii_lowercase());
        let _ = state
            .db
            .whatsapp_set_issue(community, "template_paused", &message, Utc::now())
            .await;
        channel::post_notice(state, tenant, "template_paused", &message).await;
    }
    if let Err(error) = sync_templates(state, tenant).await {
        tracing::warn!("whatsapp template resync after status change failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::super::policy::is_opt_out_button;
    use super::*;
    use serde_json::json;

    #[test]
    fn scout_activity_phone_tokens_normalize_the_supported_standalone_formats() {
        let expected = "27732086891";
        for number in ["+27 73 208 6891", "0732086891", "27732086891"] {
            let note = format!("Used mobile {number} from their website.");
            assert!(
                activity_note_phone_tokens(&note).any(|candidate| candidate == expected),
                "expected {number:?} to name {expected}"
            );
        }
    }

    #[test]
    fn scout_activity_phone_tokens_never_match_a_substring_of_a_longer_digit_run() {
        let expected = "27732086891";
        for note in [
            "Used mobile 127732086891 from their website.",
            "Used mobile 277320868911 from their website.",
        ] {
            assert!(
                !activity_note_phone_tokens(note).any(|candidate| candidate == expected),
                "a longer digit run must not link {expected}: {note:?}"
            );
        }
    }

    fn text_payload(phone_id: &str, from: &str, id: &str, body: &str) -> Value {
        json!({"object": "whatsapp_business_account", "entry": [{"id": "W", "changes": [{
        "field": "messages",
        "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "1", "phone_number_id": phone_id},
            "contacts": [{"profile": {"name": "Thabo"}, "wa_id": from}],
            "messages": [{"from": from, "id": id, "timestamp": "1800000000",
                          "type": "text", "text": {"body": body}}]
        }}]}]})
    }

    #[test]
    fn text_message_is_parsed_with_the_profile_name() {
        let parsed = parse_payload(
            &text_payload("111", "27821234567", "wamid.A", "Hello"),
            "111",
        );
        assert_eq!(parsed.messages.len(), 1);
        let message = &parsed.messages[0];
        assert_eq!(message.wa_id, "27821234567");
        assert_eq!(message.name.as_deref(), Some("Thabo"));
        assert_eq!(message.text, "Hello");
        assert_eq!(message.kind, "text");
        assert_eq!(message.at.timestamp(), 1_800_000_000);
    }

    #[test]
    fn a_payload_for_another_number_is_ignored() {
        let parsed = parse_payload(
            &text_payload("999", "27821234567", "wamid.A", "Hello"),
            "111",
        );
        assert!(parsed.messages.is_empty());
    }

    #[test]
    fn captions_buttons_and_placeholders_become_text() {
        let payload = json!({"entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "111"},
        "messages": [
            {"from": "27821234567", "id": "a", "timestamp": "1", "type": "image", "image": {"caption": "my shop"}},
            {"from": "27821234567", "id": "b", "timestamp": "1", "type": "button", "button": {"text": "Stop promotions", "payload": "x"}},
            {"from": "27821234567", "id": "c", "timestamp": "1", "type": "interactive",
             "interactive": {"type": "button_reply", "button_reply": {"id": "1", "title": "Tell me more"}}},
            {"from": "27821234567", "id": "d", "timestamp": "1", "type": "audio", "audio": {"id": "m", "voice": true}},
            {"from": "27821234567", "id": "e", "timestamp": "1", "type": "reaction", "reaction": {"emoji": "x"}},
            {"from": "12", "id": "f", "timestamp": "1", "type": "text", "text": {"body": "short number"}}
        ]}}]}]});
        let parsed = parse_payload(&payload, "111");
        let texts: Vec<_> = parsed.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(
            texts,
            ["my shop", "Stop promotions", "Tell me more", "[voice note]"]
        );
        assert!(parsed.messages[1].is_button && parsed.messages[2].is_button);
        assert!(is_opt_out_button(&parsed.messages[1].text));
        assert!(!is_opt_out_button(&parsed.messages[2].text));
    }

    #[test]
    fn a_quick_reply_tap_is_the_reply_text_and_not_interested_is_an_opt_out() {
        let tap = |title: &str| {
            json!({"entry": [{"changes": [{"field": "messages", "value": {
                "metadata": {"phone_number_id": "111"},
                "messages": [{"from": "27821234567", "id": "t", "timestamp": "1",
                              "type": "button", "button": {"text": title, "payload": "p"}}]
            }}]}]})
        };
        let parsed = parse_payload(&tap("Not interested"), "111");
        assert_eq!(parsed.messages[0].text, "Not interested");
        assert!(parsed.messages[0].is_button);
        assert!(is_opt_out_button(&parsed.messages[0].text));
        let parsed = parse_payload(&tap("Tell me more"), "111");
        assert_eq!(parsed.messages[0].text, "Tell me more");
        assert!(!is_opt_out_button(&parsed.messages[0].text));
    }

    /// One message of the given type in a Meta webhook payload.
    fn one(message: Value) -> InboundMessage {
        let mut message = message;
        message["from"] = json!("27821234567");
        message["id"] = json!("wamid.M");
        message["timestamp"] = json!("1800000000");
        let payload = json!({"entry": [{"changes": [{"field": "messages", "value": {
            "metadata": {"phone_number_id": "111"}, "messages": [message]}}]}]});
        let mut parsed = parse_payload(&payload, "111");
        assert_eq!(parsed.messages.len(), 1, "one message expected");
        parsed.messages.remove(0)
    }

    #[test]
    fn a_sticker_keeps_its_media_id_mime_and_animation() {
        // GUARD: the sticker used to become the text "[sticker]" and the media id was lost, so
        // the picture could never be fetched.
        let message = one(json!({"type": "sticker", "sticker": {
            "id": "1234567890", "mime_type": "image/webp", "sha256": "abc", "animated": true}}));
        assert_eq!(message.kind, "media");
        assert_eq!(message.text, "[sticker]");
        let media = message.media.expect("media");
        assert_eq!(media.kind, "sticker");
        assert_eq!(media.media_id(), Some("1234567890"));
        assert_eq!(media.data["mime"], "image/webp");
        assert_eq!(media.data["sha256"], "abc");
        assert_eq!(media.data["animated"], true);
        assert_eq!(media.initial_state(), Some("pending"));
    }

    #[test]
    fn every_downloadable_type_keeps_its_id_and_caption() {
        for (kind, key, expected, placeholder) in [
            ("image", "image", "image", "[image]"),
            ("video", "video", "video", "[video]"),
            ("document", "document", "document", "[document]"),
            ("audio", "audio", "audio", "[audio]"),
            ("sticker", "sticker", "sticker", "[sticker]"),
        ] {
            let plain = one(json!({"type": kind, key: {"id": "77", "mime_type": "x/y"}}));
            let media = plain.media.expect("media");
            assert_eq!((media.kind, media.media_id()), (expected, Some("77")));
            assert_eq!(plain.text, placeholder);
            assert_eq!(plain.kind, "media");
            assert!(!plain.is_button);
        }
        let captioned = one(json!({"type": "image", "image": {"id": "9", "caption": "my shop"}}));
        assert_eq!(captioned.text, "my shop");
        assert_eq!(captioned.media.expect("media").data["caption"], "my shop");
        let doc = one(json!({"type": "document",
            "document": {"id": "9", "filename": "quote.pdf", "mime_type": "application/pdf"}}));
        assert_eq!(doc.media.expect("media").data["filename"], "quote.pdf");
    }

    #[test]
    fn a_voice_note_is_told_apart_from_an_audio_file() {
        let voice = one(json!({"type": "audio", "audio": {"id": "5", "voice": true}}));
        assert_eq!(voice.media.as_ref().expect("media").kind, "voice");
        assert_eq!(voice.text, "[voice note]");
        let audio = one(json!({"type": "audio", "audio": {"id": "5", "voice": false}}));
        assert_eq!(audio.media.as_ref().expect("media").kind, "audio");
        assert_eq!(audio.text, "[audio]");
    }

    #[test]
    fn media_without_a_usable_id_is_marked_failed_not_dropped() {
        for id in [json!(null), json!("../../me"), json!("")] {
            let message = one(json!({"type": "sticker", "sticker": {"id": id}}));
            let media = message
                .media
                .expect("the message still has its media record");
            assert_eq!(media.media_id(), None);
            assert_eq!(media.initial_state(), Some("failed"));
            assert_eq!(media.initial_error(), Some("no_media_id"));
        }
    }

    #[test]
    fn a_location_keeps_coordinates_name_and_address() {
        let message = one(json!({"type": "location", "location": {
            "latitude": -26.2041, "longitude": 28.0473, "name": "Kensington Guest House",
            "address": "12 Main Rd"}}));
        assert_eq!(message.kind, "other");
        assert_eq!(message.text, "[location] Kensington Guest House");
        let media = message.media.expect("media");
        assert_eq!(media.initial_state(), None);
        assert_eq!(media.data["latitude"], -26.2041);
        assert_eq!(media.data["longitude"], 28.0473);
        assert_eq!(media.data["address"], "12 Main Rd");
        // A coordinate off the globe is not kept.
        let bad =
            one(json!({"type": "location", "location": {"latitude": 123.0, "longitude": 1.0}}));
        let bad = bad.media.expect("media");
        assert!(bad.data.get("latitude").is_none());
        assert_eq!(
            one(json!({"type": "location", "location": {}})).text,
            "[location]"
        );
    }

    #[test]
    fn contact_cards_keep_names_and_numbers() {
        let message = one(json!({"type": "contacts", "contacts": [
            {"name": {"formatted_name": "Sipho Dlamini"},
             "phones": [{"phone": "+27 82 111 2222", "type": "CELL"}, {"phone": "+27 11 000 1111"}]},
            {"name": {"first_name": "Anele"}, "phones": []}]}));
        assert_eq!(message.kind, "other");
        assert_eq!(message.text, "[contact card] Sipho Dlamini, Anele");
        let media = message.media.expect("media");
        assert_eq!(media.initial_state(), None);
        let cards = media.data["contacts"].as_array().expect("cards");
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["phones"][0], "+27 82 111 2222");
        assert_eq!(cards[1]["name"], "Anele");
    }

    #[test]
    fn reactions_text_buttons_and_unsupported_have_no_media() {
        let payload = json!({"entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "111"},
        "messages": [
            {"from": "27821234567", "id": "r", "timestamp": "1", "type": "reaction", "reaction": {"emoji": "x"}},
            {"from": "27821234567", "id": "t", "timestamp": "1", "type": "text", "text": {"body": "hi"}},
            {"from": "27821234567", "id": "b", "timestamp": "1", "type": "button", "button": {"text": "Yes"}},
            {"from": "27821234567", "id": "u", "timestamp": "1", "type": "unsupported"},
            {"from": "27821234567", "id": "o", "timestamp": "1", "type": "order", "order": {}}
        ]}}]}]});
        let parsed = parse_payload(&payload, "111");
        // The reaction is not a message.
        let texts: Vec<_> = parsed.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "hi",
                "Yes",
                "[unsupported message]",
                "[unsupported message]"
            ]
        );
        assert!(parsed.messages.iter().all(|m| m.media.is_none()));
    }

    #[test]
    fn the_debug_form_of_a_media_message_carries_the_media_id() {
        // The red proof asserts on this form because it compiles on main too.
        let message = one(json!({"type": "sticker", "sticker": {"id": "MEDIA_ID_123"}}));
        assert!(format!("{message:?}").contains("MEDIA_ID_123"));
    }

    #[test]
    fn statuses_carry_the_meta_error_code() {
        let payload = json!({"entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "111"},
        "statuses": [
            {"id": "wamid.1", "status": "delivered", "timestamp": "1", "recipient_id": "27821234567"},
            {"id": "wamid.2", "status": "failed", "timestamp": "1",
             "errors": [{"code": 131049, "title": "Healthy ecosystem", "message": "Not delivered"}]},
            {"id": "wamid.3", "status": "deleted"}
        ]}}]}]});
        let parsed = parse_payload(&payload, "111");
        assert_eq!(parsed.statuses.len(), 2);
        assert_eq!(parsed.statuses[0].state, "delivered");
        assert_eq!(parsed.statuses[1].state, "failed");
        assert_eq!(parsed.statuses[1].code, Some(131_049));
        assert_eq!(
            parsed.statuses[1].error_text.as_deref(),
            Some("Not delivered")
        );
    }

    #[test]
    fn account_and_template_events_are_noticed() {
        let payload = json!({"entry": [{"changes": [
            {"field": "phone_number_quality_update", "value": {"event": "FLAGGED"}},
            {"field": "message_template_status_update", "value": {"event": "PAUSED", "message_template_name": "intro"}},
            {"field": "something_else", "value": {}}
        ]}]});
        let parsed = parse_payload(&payload, "111");
        assert!(parsed.phone_changed);
        assert_eq!(
            parsed.template_events,
            vec![("intro".to_string(), "PAUSED".to_string())]
        );
    }

    #[test]
    fn garbage_payloads_parse_to_nothing() {
        for payload in [
            json!(null),
            json!({}),
            json!({"entry": "x"}),
            json!({"entry": [{"changes": [{"field": "messages"}]}]}),
        ] {
            assert_eq!(parse_payload(&payload, "111"), ParsedPayload::default());
        }
    }
}
