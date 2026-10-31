//! Turn a Meta webhook payload into Colony messages, opt-outs and delivery states.
//!
//! The HTTP layer has already checked the signature. Everything here is bound to one
//! company's connection: a payload for another phone number id is ignored.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::Value;

use buzz_core::business_records::ProspectHead;
use buzz_core::kind::KIND_PROSPECT_HEAD;
use buzz_core::TenantContext;
use buzz_db::whatsapp::WhatsappConnection;
use buzz_db::EventQuery;

use super::channel;
use super::connect::{refresh_phone_info, sync_templates};
use super::policy::{contact_label, e164, is_opt_out_button, is_stop_message, normalize_wa_id};
use super::sender::handle_failure;
use crate::state::AppState;

const MAX_LEADS_SCANNED: i64 = 2000;

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
    let (kind, text, is_button) = match message.get("type").and_then(Value::as_str).unwrap_or("") {
        "text" => ("text", text_at("/text/body").unwrap_or_default(), false),
        "button" => ("button", text_at("/button/text").unwrap_or_default(), true),
        "interactive" => {
            let title = text_at("/interactive/button_reply/title")
                .or_else(|| text_at("/interactive/list_reply/title"))
                .unwrap_or_default();
            ("button", title, true)
        }
        "image" => (
            "media",
            text_at("/image/caption").unwrap_or_else(|| "[image]".into()),
            false,
        ),
        "video" => (
            "media",
            text_at("/video/caption").unwrap_or_else(|| "[video]".into()),
            false,
        ),
        "document" => (
            "media",
            text_at("/document/caption").unwrap_or_else(|| "[document]".into()),
            false,
        ),
        "audio" => ("media", "[voice note]".to_string(), false),
        "sticker" => ("media", "[sticker]".to_string(), false),
        "location" => ("other", "[location]".to_string(), false),
        "contacts" => ("other", "[contact card]".to_string(), false),
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
    })
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

/// Find the lead whose phone number matches, by E.164 digits.
pub async fn find_lead_by_phone(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    wa_id: &str,
) -> Option<String> {
    let mut query = EventQuery::for_community(tenant.community());
    query.kinds = Some(vec![KIND_PROSPECT_HEAD as i32]);
    query.limit = Some(MAX_LEADS_SCANNED);
    let rows = state.db.query_events_for_event_write(&query).await.ok()?;
    rows.iter().find_map(|stored| {
        let head: ProspectHead = serde_json::from_str(&stored.event.content).ok()?;
        if head.status == "archived" {
            return None;
        }
        let phone = head.prospect.phone.as_deref()?;
        (normalize_wa_id(phone).as_deref() == Some(wa_id)).then(|| head.prospect_id.to_string())
    })
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
        if let Err(error) = handle_message(state, tenant, message).await {
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
    // Every step below is safe to repeat, so a webhook that died half way is finished by
    // Meta's redelivery instead of leaving the window, the opt-out or the post undone.
    state
        .db
        .whatsapp_touch_inbound(community, &message.wa_id, message.at)
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

    let opted_out_now = if is_stop_message(&message.text)
        || (message.is_button && is_opt_out_button(&message.text))
    {
        state
            .db
            .whatsapp_opt_out(community, &message.wa_id, "asked to stop", message.at)
            .await
            .map_err(|error| error.to_string())?
    } else {
        false
    };

    if contact.lead_id.is_none() {
        if let Some(lead) = find_lead_by_phone(state, tenant, &message.wa_id).await {
            state
                .db
                .whatsapp_set_lead(community, &message.wa_id, &lead)
                .await
                .map_err(|error| error.to_string())?;
        }
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
    if opted_out_now {
        let label = contact_label(&contact.display_name, &contact.wa_id);
        let who = if label == e164(&contact.wa_id) {
            label
        } else {
            format!("{label} ({})", e164(&contact.wa_id))
        };
        channel::post_notice(
            state,
            tenant,
            "opt_out",
            &format!("{who} asked to stop. Nothing more will be sent to them."),
        )
        .await;
    }
    Ok(())
}

async fn handle_status(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    status: &StatusUpdate,
) -> Result<(), String> {
    let community = tenant.community();
    let code = status.code.map(|c| c.to_string());
    let updated = state
        .db
        .whatsapp_update_status(
            community,
            &status.wamid,
            status.state,
            code.as_deref(),
            status.error_text.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())?;
    if status.state == "failed" {
        if let Some(message) = updated {
            handle_failure(
                state,
                tenant,
                &message,
                status.code,
                status.error_text.as_deref().unwrap_or("delivery failed"),
            )
            .await;
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
    use super::*;
    use serde_json::json;

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
            {"from": "27821234567", "id": "d", "timestamp": "1", "type": "audio", "audio": {"id": "m"}},
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
