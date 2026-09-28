//! Consent gate for sensitive ACP tool calls.

use std::future::Future;
use std::time::Duration;

use buzz_core::company_records::{
    AskAction, AskActionKind, AskCategory, AskHead, AskOutcome, AskRecord, AskStatus, AskType,
    ToolConsentPreview, ToolPermissionHead, ToolPermissionScopeKind, ToolPermissionStatus,
    ToolPermissionVerb, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_HEAD, KIND_TOOL_PERMISSION_HEAD};
use chrono::{DateTime, SecondsFormat, Utc};
use nostr::{Event, EventId, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::relay::RestClient;

const PERMISSION_EVENT_BOUND: usize = 10_000;
const TOOL_CONSENT_TTL: Duration = Duration::from_secs(4 * 60);
const TOOL_CONSENT_POLL: Duration = Duration::from_secs(2);
const TOOL_CONSENT_IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ACTION_PREVIEW_BYTES: usize = 4_000;

/// Relay and thread coordinates for the prompt currently being answered.
#[derive(Debug, Clone)]
pub(super) struct ToolPermissionContext {
    pub rest_client: RestClient,
    pub channel_id: Uuid,
    pub thread_root_event_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SensitiveAction {
    SpendMoney,
    MessageOutsider,
    DeleteData,
    PublishPublicly,
}

impl SensitiveAction {
    fn permission_verb(self) -> ToolPermissionVerb {
        match self {
            Self::SpendMoney => ToolPermissionVerb::SpendMoney,
            Self::MessageOutsider => ToolPermissionVerb::MessageOutsider,
            Self::DeleteData => ToolPermissionVerb::DeleteData,
            Self::PublishPublicly => ToolPermissionVerb::PublishPublicly,
        }
    }

    fn key(self) -> &'static str {
        self.permission_verb().permission_key()
    }

    fn preview(self, input: &Value) -> Option<String> {
        let object = input.as_object()?;
        let preview = match self {
            Self::SpendMoney => {
                let amount = first_text(object, &["amount", "total"])?;
                let currency = first_text(object, &["currency"])?;
                let recipient = first_text(object, &["payee", "recipient", "merchant"])?;
                format!("Spend {currency} {amount} with {recipient}")
            }
            Self::MessageOutsider => {
                let recipient = first_text(
                    object,
                    &[
                        "to",
                        "recipient",
                        "email",
                        "recipientEmail",
                        "recipient_email",
                    ],
                )?;
                let body = first_text(object, &["body", "content", "message", "text"])?;
                let subject = first_text(object, &["subject"]);
                match subject {
                    Some(subject) => {
                        format!("Send this email to {recipient} (subject: {subject}): {body}")
                    }
                    None => format!("Send this email to {recipient}: {body}"),
                }
            }
            Self::DeleteData => {
                let target = first_text(object, &["target", "path", "resource", "recordId", "id"])?;
                format!("Delete {target}")
            }
            Self::PublishPublicly => {
                let content = first_text(object, &["content", "body", "message", "text"])?;
                match first_text(object, &["platform", "destination", "account"]) {
                    Some(destination) => {
                        format!("Publish publicly to {destination}: {content}")
                    }
                    None => format!("Publish publicly: {content}"),
                }
            }
        };
        (preview.len() <= MAX_ACTION_PREVIEW_BYTES).then_some(preview)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Classification {
    Unclassified,
    Sensitive {
        action: SensitiveAction,
        preview: Option<String>,
    },
}

/// A permission gate decision. Refusal messages are returned to buzz-agent as
/// a tool error and never contain tool input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ToolPermissionDecision {
    Unclassified,
    Allowed,
    Refused(&'static str),
}

fn first_text<'a>(object: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

fn sensitive_action(value: &str) -> Option<SensitiveAction> {
    let trimmed = value.trim();
    let bare_name = trimmed.rsplit_once("__").map_or(trimmed, |(_, name)| name);
    let normalized = bare_name.to_ascii_lowercase().replace(['-', ' '], "_");
    match normalized.as_str() {
        "spend_money" | "make_payment" | "send_payment" | "purchase" => {
            Some(SensitiveAction::SpendMoney)
        }
        "message_outsider" | "send_email" => Some(SensitiveAction::MessageOutsider),
        "delete_data" | "delete_file" | "delete_record" => Some(SensitiveAction::DeleteData),
        "publish_publicly" | "publish_post" | "publish_content" => {
            Some(SensitiveAction::PublishPublicly)
        }
        _ => None,
    }
}

fn tool_call_from_params(params: &Value) -> Option<&Value> {
    let nested = params
        .get("subject")
        .filter(|subject| subject.get("type").and_then(Value::as_str) == Some("tool_call"))
        .and_then(|subject| subject.get("toolCall"));
    let legacy = params.get("toolCall");
    match (nested, legacy) {
        (Some(_), Some(_)) => None,
        (Some(tool_call), None) | (None, Some(tool_call)) => Some(tool_call),
        (None, None) => None,
    }
}

fn classify_permission_request(message: &Value) -> Classification {
    if message.get("method").and_then(Value::as_str) != Some("session/request_permission") {
        return Classification::Unclassified;
    }
    let Some(params) = message.get("params") else {
        return Classification::Unclassified;
    };
    let Some(tool_call) = tool_call_from_params(params) else {
        return Classification::Unclassified;
    };
    let title = params
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| tool_call.get("title").and_then(Value::as_str));
    let explicit_action = tool_call
        .get("rawInput")
        .and_then(Value::as_object)
        .and_then(|input| input.get("action"))
        .and_then(Value::as_str);
    let action = title
        .and_then(sensitive_action)
        .or_else(|| explicit_action.and_then(sensitive_action));
    let Some(action) = action else {
        return Classification::Unclassified;
    };
    let preview = tool_call
        .get("rawInput")
        .and_then(|input| action.preview(input));
    Classification::Sensitive { action, preview }
}

fn scope_covers(
    head: &ToolPermissionHead,
    action: SensitiveAction,
    channel_id: Uuid,
    thread_root_event_id: Option<&str>,
    agent_pubkey: &str,
    now: DateTime<Utc>,
) -> bool {
    if head.status != ToolPermissionStatus::Active
        || head.permission.agent_pubkey != agent_pubkey
        || head.permission.action != action.key()
        || DateTime::parse_from_rfc3339(&head.permission.expires_at)
            .ok()
            .is_none_or(|expiry| expiry.with_timezone(&Utc) <= now)
    {
        return false;
    }
    match head.permission.scope.kind {
        ToolPermissionScopeKind::Thread => thread_root_event_id
            .is_some_and(|root| root.eq_ignore_ascii_case(&head.permission.scope.id)),
        ToolPermissionScopeKind::Channel | ToolPermissionScopeKind::Customer => {
            head.permission.scope.id == channel_id.to_string()
        }
    }
}

async fn fetch_matching_permission(
    context: &ToolPermissionContext,
    action: SensitiveAction,
    now: DateTime<Utc>,
) -> Result<bool, ()> {
    let relay_self =
        tokio::time::timeout(TOOL_CONSENT_IO_TIMEOUT, context.rest_client.relay_self())
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?
            .ok_or(())?;
    let agent_pubkey = context.rest_client.keys.public_key().to_hex();
    let filter = json!({
        "kinds": [KIND_TOOL_PERMISSION_HEAD],
        "authors": [relay_self],
        "#p": [agent_pubkey],
        "limit": PERMISSION_EVENT_BOUND + 1,
    });
    let events = tokio::time::timeout(
        TOOL_CONSENT_IO_TIMEOUT,
        context.rest_client.query_raw_all(filter),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    if events.len() > PERMISSION_EVENT_BOUND {
        return Err(());
    }
    let mut seen = std::collections::HashSet::new();
    for value in events {
        let event: Event = serde_json::from_value(value).map_err(|_| ())?;
        event.verify().map_err(|_| ())?;
        if event.kind != Kind::Custom(KIND_TOOL_PERMISSION_HEAD as u16)
            || event.pubkey.to_hex() != relay_self
        {
            return Err(());
        }
        let permission_head: ToolPermissionHead =
            serde_json::from_str(&event.content).map_err(|_| ())?;
        if !seen.insert(permission_head.permission_id) {
            return Err(());
        }
        let d_tag = format!("company:permission:{}", permission_head.permission_id);
        let d_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .collect();
        let p_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "p")
            .collect();
        if event.tags.len() != 2
            || d_tags.len() != 1
            || p_tags.len() != 1
            || d_tags[0].content() != Some(d_tag.as_str())
            || p_tags[0].content() != Some(permission_head.permission.agent_pubkey.as_str())
            || permission_head.permission.permission_id != permission_head.permission_id
        {
            return Err(());
        }
        if scope_covers(
            &permission_head,
            action,
            context.channel_id,
            context.thread_root_event_id.as_deref(),
            &agent_pubkey,
            now,
        ) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn create_tool_consent_ask(
    context: &ToolPermissionContext,
    action: SensitiveAction,
    preview: &str,
    now: DateTime<Utc>,
) -> Result<Uuid, ()> {
    let thread_root = context.thread_root_event_id.as_deref().ok_or(())?;
    EventId::parse(thread_root).map_err(|_| ())?;
    let ask_id = Uuid::new_v4();
    let decide_by = (now + chrono::Duration::from_std(TOOL_CONSENT_TTL).map_err(|_| ())?)
        .to_rfc3339_opts(SecondsFormat::Secs, true);
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::ToolConsent,
        category: AskCategory::Tool,
        title: "Tool consent".to_string(),
        body: None,
        thread_root_event_id: thread_root.to_ascii_lowercase(),
        addressee_pubkey: None,
        decide_by: Some(decide_by),
        options: None,
        items: None,
        tool_consent: Some(ToolConsentPreview {
            action: action.permission_verb(),
            action_preview: preview.to_string(),
        }),
        subject: None,
    };
    let action_command = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    let builder =
        buzz_sdk::asks::build_ask_action(context.channel_id, &action_command).map_err(|_| ())?;
    let event = builder
        .sign_with_keys(&context.rest_client.keys)
        .map_err(|_| ())?;
    let response = tokio::time::timeout(
        TOOL_CONSENT_IO_TIMEOUT,
        context.rest_client.submit_event(&event),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    if response.get("accepted").and_then(Value::as_bool) != Some(true) {
        return Err(());
    }
    Ok(ask_id)
}

async fn poll_tool_consent(
    context: &ToolPermissionContext,
    ask_id: Uuid,
    action: SensitiveAction,
    preview: &str,
    decision_deadline: tokio::time::Instant,
) -> Result<bool, ()> {
    let relay_self =
        tokio::time::timeout(TOOL_CONSENT_IO_TIMEOUT, context.rest_client.relay_self())
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?
            .ok_or(())?;
    let thread_root = context.thread_root_event_id.as_deref().ok_or(())?;
    let d_tag = format!("channel:{}:ask:{ask_id}", context.channel_id);
    let agent_pubkey = context.rest_client.keys.public_key().to_hex();
    loop {
        let filter = json!({
            "kinds": [KIND_ASK_HEAD],
            "authors": [relay_self],
            "#h": [context.channel_id.to_string()],
            "#d": [d_tag],
            "limit": 10,
        });
        let events = tokio::time::timeout(
            TOOL_CONSENT_IO_TIMEOUT,
            context.rest_client.query_raw(&[filter]),
        )
        .await
        .map_err(|_| ())?
        .map_err(|_| ())?;
        let events = events.as_array().ok_or(())?;
        if events.len() > 1 {
            return Err(());
        }
        for value in events {
            let event: Event = serde_json::from_value(value.clone()).map_err(|_| ())?;
            event.verify().map_err(|_| ())?;
            if event.kind != Kind::Custom(KIND_ASK_HEAD as u16)
                || event.pubkey.to_hex() != relay_self
            {
                return Err(());
            }
            let ask_head: AskHead = serde_json::from_str(&event.content).map_err(|_| ())?;
            let expected_d = format!("channel:{}:ask:{}", context.channel_id, ask_id);
            let d_tags: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.kind().to_string() == "d")
                .collect();
            let h_tags: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.kind().to_string() == "h")
                .collect();
            let e_tags: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.kind().to_string() == "e")
                .collect();
            let t_tags: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.kind().to_string() == "t")
                .collect();
            let channel_id = context.channel_id.to_string();
            let consent = ask_head.ask.tool_consent.as_ref().ok_or(())?;
            if ask_head.ask_id != ask_id
                || ask_head.ask.ask_id != ask_id
                || ask_head.asker_pubkey != agent_pubkey
                || ask_head.ask.ask_type != AskType::ToolConsent
                || ask_head.ask.category != AskCategory::Tool
                || ask_head.ask.thread_root_event_id != thread_root
                || ask_head.ask.addressee_pubkey.is_some()
                || consent.action != action.permission_verb()
                || consent.action_preview != preview
                || event.tags.len() != 4
                || d_tags.len() != 1
                || h_tags.len() != 1
                || e_tags.len() != 1
                || t_tags.len() != 1
                || d_tags[0].content() != Some(expected_d.as_str())
                || h_tags[0].content() != Some(channel_id.as_str())
                || e_tags[0].content() != Some(thread_root)
                || t_tags[0].content() != Some("tool_consent")
            {
                return Err(());
            }
            if ask_head.status != AskStatus::Open {
                if let Some(resolution) = ask_head.resolution {
                    return Ok(resolution.response.outcome == AskOutcome::Approved
                        && resolution.resolved_by_pubkey != agent_pubkey);
                }
                return Ok(false);
            }
            if ask_head
                .ask
                .decide_by
                .as_deref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .is_none_or(|expires| expires.with_timezone(&Utc) <= Utc::now())
            {
                return Ok(false);
            }
        }
        if tokio::time::Instant::now() >= decision_deadline {
            return Ok(false);
        }
        tokio::time::sleep_until(
            (tokio::time::Instant::now() + TOOL_CONSENT_POLL).min(decision_deadline),
        )
        .await;
    }
}

/// Classify an ACP permission request, verify current standing permission heads,
/// and create and wait on an ask when the call needs human consent.
pub(super) async fn authorize_tool_call(
    message: &Value,
    context: Option<&ToolPermissionContext>,
) -> ToolPermissionDecision {
    let Classification::Sensitive { action, preview } = classify_permission_request(message) else {
        return ToolPermissionDecision::Unclassified;
    };
    let Some(context) = context else {
        return ToolPermissionDecision::Refused(
            "sensitive tool call has no current thread scope; the tool call was refused",
        );
    };
    let Some(preview) = preview else {
        return ToolPermissionDecision::Refused(
            "sensitive tool details could not be previewed; the tool call was refused",
        );
    };
    let ask_context = context.clone();
    authorize_sensitive(
        || fetch_matching_permission(context, action, Utc::now()),
        move |deadline| async move {
            let ask_id =
                create_tool_consent_ask(&ask_context, action, &preview, Utc::now()).await?;
            poll_tool_consent(&ask_context, ask_id, action, &preview, deadline).await
        },
    )
    .await
}

async fn authorize_sensitive<Lookup, LookupFuture, Ask, AskFuture>(
    lookup: Lookup,
    ask: Ask,
) -> ToolPermissionDecision
where
    Lookup: FnOnce() -> LookupFuture,
    LookupFuture: Future<Output = Result<bool, ()>>,
    Ask: FnOnce(tokio::time::Instant) -> AskFuture,
    AskFuture: Future<Output = Result<bool, ()>>,
{
    match tokio::time::timeout(TOOL_CONSENT_IO_TIMEOUT, lookup()).await {
        Ok(Ok(true)) => return ToolPermissionDecision::Allowed,
        Ok(Ok(false)) => {}
        Ok(Err(())) | Err(_) => {
            tracing::warn!(target: "acp::permission", "standing permission read failed; refusing sensitive tool call");
            return ToolPermissionDecision::Refused(
                "standing permission could not be verified; the tool call was refused",
            );
        }
    }

    let deadline = tokio::time::Instant::now() + TOOL_CONSENT_TTL;
    match tokio::time::timeout_at(deadline, ask(deadline)).await {
        Ok(Ok(true)) => ToolPermissionDecision::Allowed,
        Ok(Ok(false)) => ToolPermissionDecision::Refused(
            "tool consent was rejected or expired; the tool call was refused",
        ),
        Ok(Err(())) => {
            tracing::warn!(target: "acp::permission", "tool consent result could not be verified; refusing sensitive tool call");
            ToolPermissionDecision::Refused(
                "tool consent result could not be verified; the tool call was refused",
            )
        }
        Err(_) => {
            ToolPermissionDecision::Refused("tool consent timed out; the tool call was refused")
        }
    }
}

/// Replace raw tool arguments before ACP traffic enters the observer log.
pub(super) fn observer_safe_message(message: &Value) -> Value {
    let mut safe = message.clone();
    let method = message.get("method").and_then(Value::as_str);
    if method == Some("session/request_permission") {
        if let Some(params) = safe.get_mut("params").and_then(Value::as_object_mut) {
            if let Some(tool_call) = params
                .get_mut("subject")
                .and_then(Value::as_object_mut)
                .and_then(|subject| subject.get_mut("toolCall"))
                .and_then(Value::as_object_mut)
            {
                tool_call.remove("rawInput");
            }
            if let Some(tool_call) = params.get_mut("toolCall").and_then(Value::as_object_mut) {
                tool_call.remove("rawInput");
            }
        }
    }
    if method == Some("session/update") {
        if let Some(update) = safe
            .get_mut("params")
            .and_then(Value::as_object_mut)
            .and_then(|params| params.get_mut("update"))
            .and_then(Value::as_object_mut)
        {
            if update.get("sessionUpdate").and_then(Value::as_str) == Some("tool_call") {
                update.remove("rawInput");
            }
        }
    }
    safe
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn request(version: u32, title: &str, raw_input: Value) -> Value {
        let tool_call = json!({
            "toolCallId": "call-1",
            "title": title,
            "rawInput": raw_input,
        });
        let params = if version >= 2 {
            json!({
                "sessionId": "ses_1",
                "title": title,
                "subject": { "type": "tool_call", "toolCall": tool_call },
                "options": [
                    { "optionId": "allow_once", "kind": "allow_once" },
                    { "optionId": "reject_once", "kind": "reject_once" }
                ]
            })
        } else {
            let mut legacy_tool_call = tool_call.as_object().unwrap().clone();
            legacy_tool_call.insert("kind".into(), json!("other"));
            json!({
                "sessionId": "ses_1",
                "toolCall": legacy_tool_call,
                "options": [
                    { "optionId": "allow_once", "kind": "allow_once" },
                    { "optionId": "reject_once", "kind": "reject_once" }
                ]
            })
        };
        json!({ "jsonrpc": "2.0", "id": "perm-1", "method": "session/request_permission", "params": params })
    }

    #[test]
    fn classification_reads_the_harness_v1_and_v2_shapes() {
        let cases = [
            (
                1,
                "smtp__send_email",
                json!({ "to": "x@y.com", "body": "The report is ready." }),
            ),
            (
                2,
                "smtp__send_email",
                json!({ "to": "x@y.com", "body": "The report is ready." }),
            ),
        ];
        for (version, title, raw_input) in cases {
            let classification = classify_permission_request(&request(version, title, raw_input));
            assert_eq!(
                classification,
                Classification::Sensitive {
                    action: SensitiveAction::MessageOutsider,
                    preview: Some("Send this email to x@y.com: The report is ready.".into()),
                }
            );
        }
    }

    #[test]
    fn exact_action_catalog_covers_all_always_ask_categories() {
        let cases = [
            (
                "payments__make_payment",
                json!({ "amount": "25.00", "currency": "USD", "payee": "Studio" }),
                SensitiveAction::SpendMoney,
            ),
            (
                "smtp__send_email",
                json!({ "to": "x@y.com", "body": "Hello" }),
                SensitiveAction::MessageOutsider,
            ),
            (
                "storage__delete_file",
                json!({ "path": "/reports/final.csv" }),
                SensitiveAction::DeleteData,
            ),
            (
                "social__publish_post",
                json!({ "platform": "Company page", "content": "We are live." }),
                SensitiveAction::PublishPublicly,
            ),
        ];
        for (title, input, action) in cases {
            assert!(matches!(
                classify_permission_request(&request(2, title, input)),
                Classification::Sensitive { action: found, preview: Some(_) } if found == action
            ));
        }
    }

    #[test]
    fn missing_preview_is_sensitive_and_unknown_or_hybrid_shapes_stay_unclassified() {
        assert!(matches!(
            classify_permission_request(&request(
                2,
                "smtp__send_email",
                json!({ "to": "x@y.com" })
            )),
            Classification::Sensitive {
                action: SensitiveAction::MessageOutsider,
                preview: None
            }
        ));
        assert_eq!(
            classify_permission_request(&request(
                2,
                "fake__read_file",
                json!({ "path": "/tmp/a" })
            )),
            Classification::Unclassified
        );
        let mut hybrid = request(
            2,
            "smtp__send_email",
            json!({ "to": "x@y.com", "body": "Hello" }),
        );
        hybrid["params"]["toolCall"] = hybrid["params"]["subject"]["toolCall"].clone();
        assert_eq!(
            classify_permission_request(&hybrid),
            Classification::Unclassified
        );
    }

    #[test]
    fn observer_redaction_removes_raw_tool_input_from_both_request_shapes() {
        let message = request(
            2,
            "smtp__send_email",
            json!({ "to": "x@y.com", "body": "secret body" }),
        );
        let safe = observer_safe_message(&message);
        assert!(safe["params"]["subject"]["toolCall"]
            .get("rawInput")
            .is_none());
        assert!(message["params"]["subject"]["toolCall"]
            .get("rawInput")
            .is_some());
    }

    fn permission_head(
        scope_kind: ToolPermissionScopeKind,
        scope_id: String,
        expires_at: String,
        status: ToolPermissionStatus,
    ) -> ToolPermissionHead {
        let permission_id = Uuid::new_v4();
        let agent_pubkey = "ab".repeat(32);
        ToolPermissionHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            status,
            permission: buzz_core::company_records::ToolPermissionRecord {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                permission_id,
                agent_pubkey: agent_pubkey.clone(),
                action: ToolPermissionVerb::MessageOutsider
                    .permission_key()
                    .to_owned(),
                scope: buzz_core::company_records::ToolPermissionScope {
                    kind: scope_kind,
                    id: scope_id,
                },
                expires_at,
            },
            granted_by_pubkey: "cd".repeat(32),
            changed_by_pubkey: "cd".repeat(32),
            updated_at: "2026-09-28T00:00:00Z".to_owned(),
            source_action_event_id: "ef".repeat(32),
        }
    }

    #[test]
    fn standing_permission_scope_requires_matching_agent_action_scope_and_live_head() {
        let now = Utc::now();
        let agent = "ab".repeat(32);
        let channel = Uuid::new_v4();
        let root = "12".repeat(32);
        let future = (now + chrono::Duration::hours(1)).to_rfc3339();
        let active_thread = permission_head(
            ToolPermissionScopeKind::Thread,
            root.clone(),
            future.clone(),
            ToolPermissionStatus::Active,
        );
        assert!(scope_covers(
            &active_thread,
            SensitiveAction::MessageOutsider,
            channel,
            Some(&root.to_ascii_uppercase()),
            &agent,
            now,
        ));
        assert!(!scope_covers(
            &active_thread,
            SensitiveAction::MessageOutsider,
            channel,
            Some(&"34".repeat(32)),
            &agent,
            now,
        ));

        let channel_permission = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            future.clone(),
            ToolPermissionStatus::Active,
        );
        assert!(scope_covers(
            &channel_permission,
            SensitiveAction::MessageOutsider,
            channel,
            None,
            &agent,
            now,
        ));
        let customer_permission = permission_head(
            ToolPermissionScopeKind::Customer,
            channel.to_string(),
            future,
            ToolPermissionStatus::Active,
        );
        assert!(scope_covers(
            &customer_permission,
            SensitiveAction::MessageOutsider,
            channel,
            None,
            &agent,
            now,
        ));

        let expired = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now - chrono::Duration::seconds(1)).to_rfc3339(),
            ToolPermissionStatus::Active,
        );
        assert!(!scope_covers(
            &expired,
            SensitiveAction::MessageOutsider,
            channel,
            None,
            &agent,
            now,
        ));
        let revoked = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now + chrono::Duration::hours(1)).to_rfc3339(),
            ToolPermissionStatus::Revoked,
        );
        assert!(!scope_covers(
            &revoked,
            SensitiveAction::MessageOutsider,
            channel,
            None,
            &agent,
            now,
        ));
    }

    #[tokio::test]
    async fn missing_grant_raises_an_ask_and_blocks_until_the_human_responds() {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(authorize_sensitive(
            || async { Ok(false) },
            move |_| async move { reply_rx.await.map_err(|_| ())? },
        ));
        tokio::task::yield_now().await;
        assert!(!task.is_finished(), "the tool must stay blocked on the ask");
        let _ = reply_tx.send(Ok(false));
        assert_eq!(
            task.await.expect("authorization task completes"),
            ToolPermissionDecision::Refused(
                "tool consent was rejected or expired; the tool call was refused"
            )
        );
    }

    #[tokio::test]
    async fn in_scope_grant_skips_the_ask_and_store_errors_fail_closed() {
        let now = Utc::now();
        let channel = Uuid::new_v4();
        let record = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now + chrono::Duration::hours(1)).to_rfc3339(),
            ToolPermissionStatus::Active,
        );
        let ask_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = Arc::clone(&ask_count);
        let granted = authorize_sensitive(
            move || async move {
                Ok(scope_covers(
                    &record,
                    SensitiveAction::MessageOutsider,
                    channel,
                    None,
                    &"ab".repeat(32),
                    now,
                ))
            },
            move |_| async move {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(true)
            },
        )
        .await;
        assert_eq!(granted, ToolPermissionDecision::Allowed);
        assert_eq!(ask_count.load(std::sync::atomic::Ordering::SeqCst), 0);

        let failed = authorize_sensitive(|| async { Err(()) }, |_| async { Ok(true) }).await;
        assert_eq!(
            failed,
            ToolPermissionDecision::Refused(
                "standing permission could not be verified; the tool call was refused"
            )
        );
    }

    #[tokio::test]
    async fn out_of_scope_expired_and_revoked_permissions_raise_an_ask() {
        let now = Utc::now();
        let channel = Uuid::new_v4();
        let agent = "ab".repeat(32);
        let root = "12".repeat(32);
        let active = permission_head(
            ToolPermissionScopeKind::Thread,
            root,
            (now + chrono::Duration::hours(1)).to_rfc3339(),
            ToolPermissionStatus::Active,
        );
        let expired = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now - chrono::Duration::seconds(1)).to_rfc3339(),
            ToolPermissionStatus::Active,
        );
        let revoked = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now + chrono::Duration::hours(1)).to_rfc3339(),
            ToolPermissionStatus::Revoked,
        );
        for miss in [
            !scope_covers(
                &active,
                SensitiveAction::MessageOutsider,
                channel,
                Some(&"34".repeat(32)),
                &agent,
                now,
            ),
            !scope_covers(
                &expired,
                SensitiveAction::MessageOutsider,
                channel,
                None,
                &agent,
                now,
            ),
            !scope_covers(
                &revoked,
                SensitiveAction::MessageOutsider,
                channel,
                None,
                &agent,
                now,
            ),
        ] {
            assert!(miss);
            let asked = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let asked_in_ask = Arc::clone(&asked);
            let result = authorize_sensitive(
                || async { Ok(false) },
                move |_| async move {
                    asked_in_ask.store(true, std::sync::atomic::Ordering::SeqCst);
                    Ok(false)
                },
            )
            .await;
            assert!(asked.load(std::sync::atomic::Ordering::SeqCst));
            assert!(matches!(result, ToolPermissionDecision::Refused(_)));
        }
    }

    #[tokio::test]
    async fn revocation_is_observed_on_the_next_tool_call() {
        let now = Utc::now();
        let channel = Uuid::new_v4();
        let head = permission_head(
            ToolPermissionScopeKind::Channel,
            channel.to_string(),
            (now + chrono::Duration::hours(1)).to_rfc3339(),
            ToolPermissionStatus::Active,
        );
        let state = Arc::new(Mutex::new(head));
        let first_read = Arc::clone(&state);
        let first = authorize_sensitive(
            move || async move {
                let head = first_read.lock().map_err(|_| ())?;
                Ok(scope_covers(
                    &head,
                    SensitiveAction::MessageOutsider,
                    channel,
                    None,
                    &"ab".repeat(32),
                    now,
                ))
            },
            |_| async { Ok(false) },
        )
        .await;
        assert_eq!(first, ToolPermissionDecision::Allowed);

        state.lock().expect("permission head lock").status = ToolPermissionStatus::Revoked;
        let second_read = Arc::clone(&state);
        let ask_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let ask_count_in_ask = Arc::clone(&ask_count);
        let second = authorize_sensitive(
            move || async move {
                let head = second_read.lock().map_err(|_| ())?;
                Ok(scope_covers(
                    &head,
                    SensitiveAction::MessageOutsider,
                    channel,
                    None,
                    &"ab".repeat(32),
                    now,
                ))
            },
            move |_| async move {
                ask_count_in_ask.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(false)
            },
        )
        .await;
        assert!(matches!(second, ToolPermissionDecision::Refused(_)));
        assert_eq!(ask_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn consent_wait_timeout_returns_a_terminal_refusal() {
        let task = tokio::spawn(authorize_sensitive(
            || async { Ok(false) },
            |_| async { std::future::pending::<Result<bool, ()>>().await },
        ));
        tokio::task::yield_now().await;
        tokio::time::advance(TOOL_CONSENT_TTL).await;
        assert_eq!(
            task.await.expect("timed out authorization task completes"),
            ToolPermissionDecision::Refused("tool consent timed out; the tool call was refused")
        );
    }
}
