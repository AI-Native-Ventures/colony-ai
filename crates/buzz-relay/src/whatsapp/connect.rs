//! Connect and disconnect a company's number, sync templates, track quality, and build the
//! status object the desktop shows.

use std::sync::Arc;

use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;
use zeroize::Zeroizing;

use buzz_core::TenantContext;
use buzz_db::whatsapp::{NewWhatsappConnection, WhatsappConnection, WhatsappTemplate};

use super::channel;
use super::graph::{GraphError, PhoneInfo};
use super::policy::{hash_verify_token, sast_day_start, template_slot_count};
use super::secrets::{self, SecretField};
use crate::state::AppState;

/// Reason stored when sending was stopped by a RED quality rating.
pub const QUALITY_PAUSE_REASON: &str = "Quality rating is RED. Sending stopped.";

/// What the owner submits to connect a number. Never formatted.
pub struct ConnectInput {
    /// Permanent system-user access token.
    pub access_token: Zeroizing<String>,
    /// Meta phone number id.
    pub phone_number_id: String,
    /// WhatsApp business account id.
    pub waba_id: String,
    /// Meta app secret.
    pub app_secret: Zeroizing<String>,
}

impl std::fmt::Debug for ConnectInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectInput")
            .field("phone_number_id", &self.phone_number_id)
            .field("waba_id", &self.waba_id)
            .field("secrets", &"[REDACTED]")
            .finish()
    }
}

/// Why a connect or disconnect failed, with a stable code for the desktop.
#[derive(Debug, PartialEq, Eq)]
pub enum ConnectError {
    /// The relay has no key-encryption key configured.
    NotConfigured,
    /// The request was malformed.
    Invalid(String),
    /// The company already has a number connected.
    AlreadyConnected,
    /// Meta refused the token.
    TokenRejected,
    /// Meta could not be reached.
    GraphUnavailable,
    /// Anything else; the text is for logs.
    Internal(String),
}

impl ConnectError {
    /// Machine readable code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "whatsapp_not_configured",
            Self::Invalid(_) => "whatsapp_invalid_input",
            Self::AlreadyConnected => "whatsapp_already_connected",
            Self::TokenRejected => "whatsapp_token_rejected",
            Self::GraphUnavailable => "whatsapp_graph_unavailable",
            Self::Internal(_) => "whatsapp_internal",
        }
    }

    /// Plain message for the owner.
    pub fn message(&self) -> String {
        match self {
            Self::NotConfigured => "WhatsApp is not set up on this server yet. The server owner needs to add the account key.".into(),
            Self::Invalid(reason) => reason.clone(),
            Self::AlreadyConnected => "A WhatsApp number is already connected. Disconnect it first.".into(),
            Self::TokenRejected => "Meta rejected the access token or phone number id.".into(),
            Self::GraphUnavailable => "Meta did not answer. Try again in a minute.".into(),
            Self::Internal(_) => "Something went wrong on the server.".into(),
        }
    }
}

fn digits_only(value: &str, field: &str) -> Result<String, ConnectError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 32 || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ConnectError::Invalid(format!(
            "{field} must be digits only"
        )));
    }
    Ok(trimmed.to_string())
}

/// Validate and trim the submitted fields.
pub fn validate_input(
    access_token: &str,
    phone_number_id: &str,
    waba_id: &str,
    app_secret: &str,
) -> Result<ConnectInput, ConnectError> {
    let token = access_token.trim();
    let secret = app_secret.trim();
    if token.is_empty() || token.len() > 1024 || token.chars().any(char::is_whitespace) {
        return Err(ConnectError::Invalid(
            "accessToken is missing or malformed".into(),
        ));
    }
    if secret.is_empty() || secret.len() > 256 || secret.chars().any(char::is_whitespace) {
        return Err(ConnectError::Invalid(
            "appSecret is missing or malformed".into(),
        ));
    }
    Ok(ConnectInput {
        access_token: Zeroizing::new(token.to_string()),
        phone_number_id: digits_only(phone_number_id, "phoneNumberId")?,
        waba_id: digits_only(waba_id, "wabaId")?,
        app_secret: Zeroizing::new(secret.to_string()),
    })
}

/// The webhook URL Meta is pointed at.
pub fn webhook_url(state: &AppState, tenant: &TenantContext, connection_id: Uuid) -> String {
    let scheme = if state.config.relay_url.trim_start().starts_with("wss://") {
        "https"
    } else {
        "http"
    };
    format!(
        "{scheme}://{}/hooks/whatsapp/{connection_id}",
        tenant.host()
    )
}

/// Open both sealed secrets of a connection.
pub fn open_secrets(
    kek: &[u8; 32],
    community: Uuid,
    connection: &WhatsappConnection,
) -> Result<(Zeroizing<String>, Zeroizing<String>), String> {
    let token = secrets::open(
        kek,
        &connection.kek_id,
        community,
        connection.id,
        SecretField::AccessToken,
        &connection.sealed_token,
        &connection.token_nonce,
    )
    .map_err(|error| error.to_string())?;
    let app_secret = secrets::open(
        kek,
        &connection.kek_id,
        community,
        connection.id,
        SecretField::AppSecret,
        &connection.sealed_app_secret,
        &connection.app_secret_nonce,
    )
    .map_err(|error| error.to_string())?;
    Ok((token, app_secret))
}

/// Connect a company's number.
pub async fn connect(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    actor: &nostr::PublicKey,
    input: ConnectInput,
) -> Result<Value, ConnectError> {
    let community = tenant.community();
    let Some(kek) = state.config.accounts.account_kek() else {
        return Err(ConnectError::NotConfigured);
    };
    let existing = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| ConnectError::Internal(error.to_string()))?;
    if existing.is_some() {
        return Err(ConnectError::AlreadyConnected);
    }

    let info = match state
        .whatsapp_graph
        .get_phone_info(&input.access_token, &input.phone_number_id)
        .await
    {
        Ok(info) => info,
        Err(GraphError::Unavailable(_)) => return Err(ConnectError::GraphUnavailable),
        Err(GraphError::Rejected { .. }) => return Err(ConnectError::TokenRejected),
    };

    let connection_id = Uuid::new_v4();
    let verify_token = hex::encode(rand::random::<[u8; 32]>());
    let sealed_token = secrets::seal(
        kek,
        *community.as_uuid(),
        connection_id,
        SecretField::AccessToken,
        &input.access_token,
    )
    .map_err(|error| ConnectError::Internal(error.to_string()))?;
    let sealed_secret = secrets::seal(
        kek,
        *community.as_uuid(),
        connection_id,
        SecretField::AppSecret,
        &input.app_secret,
    )
    .map_err(|error| ConnectError::Internal(error.to_string()))?;
    let new_connection = NewWhatsappConnection {
        id: connection_id,
        phone_number_id: input.phone_number_id.clone(),
        waba_id: input.waba_id.clone(),
        display_phone_number: info.display_phone_number.clone(),
        verified_name: info.verified_name.clone(),
        quality_rating: info
            .quality_rating
            .clone()
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        phone_status: info.status.clone(),
        kek_id: secrets::kek_id(kek),
        sealed_token: sealed_token.ciphertext,
        token_nonce: sealed_token.nonce.to_vec(),
        sealed_app_secret: sealed_secret.ciphertext,
        app_secret_nonce: sealed_secret.nonce.to_vec(),
        verify_token_hash: hash_verify_token(&verify_token).to_vec(),
        created_by: actor.to_bytes().to_vec(),
    };
    // The row exists before Meta is told about the URL: Meta verifies the callback with a
    // GET while the override is being set.
    let inserted = state
        .db
        .whatsapp_insert_connection(community, &new_connection)
        .await
        .map_err(|error| ConnectError::Internal(error.to_string()))?;
    if !inserted {
        return Err(ConnectError::AlreadyConnected);
    }

    let callback = webhook_url(state, tenant, connection_id);
    let wiring = async {
        state
            .whatsapp_graph
            .set_webhook_override(
                &input.access_token,
                &input.phone_number_id,
                &callback,
                &verify_token,
            )
            .await?;
        state
            .whatsapp_graph
            .subscribe_app(&input.access_token, &input.waba_id)
            .await
    }
    .await;
    if let Err(error) = wiring {
        // Roll back so a half-wired number is never left behind.
        if let Err(db_error) = state.db.whatsapp_delete_connection(community).await {
            tracing::error!("whatsapp connect rollback failed: {db_error}");
        }
        return Err(match error {
            GraphError::Unavailable(_) => ConnectError::GraphUnavailable,
            GraphError::Rejected { .. } => ConnectError::TokenRejected,
        });
    }

    let actor_bytes = actor.to_bytes();
    if let Err(error) = channel::ensure_outreach_channel(state, tenant, &actor_bytes).await {
        tracing::error!("whatsapp outreach channel setup failed: {error}");
        return Err(ConnectError::Internal(error));
    }
    for code in [
        "token_expired",
        "number_disconnected",
        "quality_red",
        "quality_yellow",
    ] {
        if let Err(error) = state.db.whatsapp_clear_issue(community, code).await {
            tracing::warn!("whatsapp issue clear failed: {error}");
        }
    }
    // A fresh connection starts unpaused; the quality reading below can stop it again.
    if let Err(error) = state
        .db
        .whatsapp_set_send_paused(community, false, None)
        .await
    {
        tracing::warn!("whatsapp unpause after connect failed: {error}");
    }
    apply_phone_info(state, tenant, &info).await;
    if let Err(error) = sync_templates(state, tenant).await {
        tracing::warn!("whatsapp template sync after connect failed: {error}");
        let _ = state
            .db
            .whatsapp_set_issue(community, "template_sync", &error, Utc::now())
            .await;
    }
    channel::post_notice(state, tenant, "connected", "WhatsApp number connected.").await;
    status_view(state, tenant)
        .await
        .map_err(ConnectError::Internal)
}

/// Disconnect: remove the webhook override, delete the sealed secrets.
pub async fn disconnect(
    state: &Arc<AppState>,
    tenant: &TenantContext,
) -> Result<Value, ConnectError> {
    let community = tenant.community();
    let connection = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| ConnectError::Internal(error.to_string()))?;
    if let Some(connection) = connection {
        if let Some(kek) = state.config.accounts.account_kek() {
            match open_secrets(kek, *community.as_uuid(), &connection) {
                Ok((token, _)) => {
                    if let Err(error) = state
                        .whatsapp_graph
                        .clear_webhook_override(&token, &connection.phone_number_id)
                        .await
                    {
                        tracing::warn!("whatsapp webhook override removal failed: {error}");
                    }
                }
                Err(error) => {
                    tracing::warn!("whatsapp disconnect could not open the token: {error}")
                }
            }
        }
        state
            .db
            .whatsapp_delete_connection(community)
            .await
            .map_err(|error| ConnectError::Internal(error.to_string()))?;
        channel::post_notice(
            state,
            tenant,
            "disconnected",
            "WhatsApp number disconnected.",
        )
        .await;
    }
    status_view(state, tenant)
        .await
        .map_err(ConnectError::Internal)
}

/// Fetch approved templates from Meta and store them. Returns how many.
pub async fn sync_templates(
    state: &Arc<AppState>,
    tenant: &TenantContext,
) -> Result<usize, String> {
    let community = tenant.community();
    let kek = state
        .config
        .accounts
        .account_kek()
        .ok_or_else(|| "the account key is not configured".to_string())?;
    let connection = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no WhatsApp number is connected".to_string())?;
    let (token, _) = open_secrets(kek, *community.as_uuid(), &connection)?;
    let remote = state
        .whatsapp_graph
        .list_templates(&token, &connection.waba_id)
        .await
        .map_err(|error| match error {
            GraphError::Rejected { .. } => "Meta rejected the template request".to_string(),
            GraphError::Unavailable(_) => "Meta did not answer the template request".to_string(),
        })?;
    let templates: Vec<WhatsappTemplate> = remote
        .into_iter()
        .map(|template| WhatsappTemplate {
            slots: i32::try_from(template_slot_count(&template.body)).unwrap_or(0),
            name: template.name,
            language: template.language,
            category: template.category,
            status: template.status,
            body: template.body,
            buttons: template.buttons,
        })
        .collect();
    let count = templates.len();
    state
        .db
        .whatsapp_replace_templates(community, &templates, Utc::now())
        .await
        .map_err(|error| error.to_string())?;
    let _ = state
        .db
        .whatsapp_clear_issue(community, "template_sync")
        .await;
    Ok(count)
}

/// Ask Meta about the number and apply quality and connection state.
pub async fn refresh_phone_info(
    state: &Arc<AppState>,
    tenant: &TenantContext,
) -> Result<(), String> {
    let community = tenant.community();
    let Some(kek) = state.config.accounts.account_kek() else {
        return Ok(());
    };
    let Some(connection) = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let (token, _) = open_secrets(kek, *community.as_uuid(), &connection)?;
    match state
        .whatsapp_graph
        .get_phone_info(&token, &connection.phone_number_id)
        .await
    {
        Ok(info) => {
            let _ = state
                .db
                .whatsapp_clear_issue(community, "token_expired")
                .await;
            apply_phone_info(state, tenant, &info).await;
            Ok(())
        }
        Err(GraphError::Rejected {
            code: Some(190 | 102),
            ..
        }) => {
            note_token_expired(state, tenant).await;
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

/// The access token no longer works: show it and stop sending.
pub async fn note_token_expired(state: &Arc<AppState>, tenant: &TenantContext) {
    let community = tenant.community();
    let before = state.db.whatsapp_ensure_settings(community).await.ok();
    let already = before
        .as_ref()
        .is_some_and(|settings| has_issue(&settings.issues, "token_expired"));
    let message = "The WhatsApp access token expired or was revoked. Reconnect the number.";
    let _ = state
        .db
        .whatsapp_set_issue(community, "token_expired", message, Utc::now())
        .await;
    let _ = state
        .db
        .whatsapp_set_send_paused(community, true, Some(message))
        .await;
    if !already {
        channel::post_notice(state, tenant, "token_expired", message).await;
    }
}

/// `true` when the issues array has an entry with this code.
pub fn has_issue(issues: &Value, code: &str) -> bool {
    issues.as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item.get("code").and_then(Value::as_str) == Some(code))
    })
}

/// What a quality reading means for the company.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct QualityActions {
    /// Issues to show: `(code, message)`.
    pub set_issues: Vec<(&'static str, String)>,
    /// Issues that are resolved.
    pub clear_issues: Vec<&'static str>,
    /// `Some(true)` stop sending, `Some(false)` resume, `None` leave as is.
    pub pause: Option<bool>,
    /// Notices to post (only for issues that are new).
    pub notify: Vec<(&'static str, String)>,
}

/// Pure decision from a quality reading. RED stops sending by itself; a later better
/// reading resumes only a pause that quality caused.
pub fn plan_quality(
    quality: &str,
    phone_status: Option<&str>,
    pause_reason: Option<&str>,
    current_issue_codes: &[&str],
) -> QualityActions {
    let mut actions = QualityActions::default();
    let new = |code: &str| !current_issue_codes.contains(&code);
    let paused_by_quality = pause_reason == Some(QUALITY_PAUSE_REASON);
    match quality.to_ascii_uppercase().as_str() {
        "RED" => {
            let message = QUALITY_PAUSE_REASON.to_string();
            if new("quality_red") {
                actions.notify.push(("quality_red", message.clone()));
            }
            actions.set_issues.push(("quality_red", message));
            actions.clear_issues.push("quality_yellow");
            actions.pause = Some(true);
        }
        "YELLOW" => {
            let message =
                "Quality rating is YELLOW. Send fewer messages and watch replies.".to_string();
            if new("quality_yellow") {
                actions.notify.push(("quality_yellow", message.clone()));
            }
            actions.set_issues.push(("quality_yellow", message));
            actions.clear_issues.push("quality_red");
            if paused_by_quality {
                actions.pause = Some(false);
            }
        }
        _ => {
            actions.clear_issues.push("quality_red");
            actions.clear_issues.push("quality_yellow");
            if paused_by_quality {
                actions.pause = Some(false);
            }
        }
    }
    let disconnected = phone_status
        .map(str::trim)
        .is_some_and(|status| !status.is_empty() && !status.eq_ignore_ascii_case("CONNECTED"));
    if disconnected {
        let message = "Meta reports the number is not connected.".to_string();
        if new("number_disconnected") {
            actions
                .notify
                .push(("number_disconnected", message.clone()));
        }
        actions.set_issues.push(("number_disconnected", message));
    } else {
        actions.clear_issues.push("number_disconnected");
    }
    actions
}

/// Store Meta's reading of the number and apply the quality plan.
pub async fn apply_phone_info(state: &Arc<AppState>, tenant: &TenantContext, info: &PhoneInfo) {
    let community = tenant.community();
    let quality = info
        .quality_rating
        .clone()
        .unwrap_or_else(|| "UNKNOWN".to_string());
    if let Err(error) = state
        .db
        .whatsapp_update_phone_info(
            community,
            info.display_phone_number.as_deref(),
            info.verified_name.as_deref(),
            &quality,
            info.status.as_deref(),
        )
        .await
    {
        tracing::warn!("whatsapp phone info update failed: {error}");
        return;
    }
    let Ok(settings) = state.db.whatsapp_ensure_settings(community).await else {
        return;
    };
    let codes: Vec<String> = settings
        .issues
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("code").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let code_refs: Vec<&str> = codes.iter().map(String::as_str).collect();
    let plan = plan_quality(
        &quality,
        info.status.as_deref(),
        settings.pause_reason.as_deref(),
        &code_refs,
    );
    for (code, message) in &plan.set_issues {
        let _ = state
            .db
            .whatsapp_set_issue(community, code, message, Utc::now())
            .await;
    }
    for code in &plan.clear_issues {
        let _ = state.db.whatsapp_clear_issue(community, code).await;
    }
    match plan.pause {
        Some(true) => {
            let _ = state
                .db
                .whatsapp_set_send_paused(community, true, Some(QUALITY_PAUSE_REASON))
                .await;
        }
        Some(false) => {
            let _ = state
                .db
                .whatsapp_set_send_paused(community, false, None)
                .await;
        }
        None => {}
    }
    for (code, message) in &plan.notify {
        channel::post_notice(state, tenant, code, message).await;
    }
}

/// One template as the contract shows it.
pub fn template_json(template: &WhatsappTemplate) -> Value {
    json!({
        "name": template.name,
        "language": template.language,
        "category": template.category,
        "status": template.status,
        "body": template.body,
        "slots": template.slots,
        "buttons": template.buttons,
    })
}

/// The status object of the contract.
pub async fn status_view(state: &Arc<AppState>, tenant: &TenantContext) -> Result<Value, String> {
    let community = tenant.community();
    let settings = state
        .db
        .whatsapp_ensure_settings(community)
        .await
        .map_err(|error| error.to_string())?;
    let connection = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?;
    let templates = state
        .db
        .whatsapp_list_templates(community)
        .await
        .map_err(|error| error.to_string())?;
    let sent_today = state
        .db
        .whatsapp_count_new_chats_since(community, sast_day_start(Utc::now()))
        .await
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "connected": connection.is_some(),
        "connectionId": connection.as_ref().map(|c| c.id.to_string()),
        "displayPhoneNumber": connection.as_ref().and_then(|c| c.display_phone_number.clone()),
        "verifiedName": connection.as_ref().and_then(|c| c.verified_name.clone()),
        "quality": connection.as_ref().map(|c| c.quality_rating.clone()),
        "phoneStatus": connection.as_ref().and_then(|c| c.phone_status.clone()),
        "dailyNewChatCap": settings.daily_new_chat_cap,
        "newChatsSentToday": sent_today,
        "sendingPaused": settings.send_paused,
        "pauseReason": settings.pause_reason,
        "issues": settings.issues,
        "outreachChannelId": settings.outreach_channel_id.map(|id| id.to_string()),
        "templatesSyncedAt": settings.templates_synced_at.map(|at| at.to_rfc3339()),
        "templates": templates.iter().map(template_json).collect::<Vec<_>>(),
        "webhookUrl": connection.as_ref().map(|c| webhook_url(state, tenant, c.id)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_is_validated_and_never_printed() {
        let input = validate_input(" EAAB-token ", " 123456 ", "789", " shh ").expect("valid");
        assert_eq!(input.phone_number_id, "123456");
        assert_eq!(&*input.access_token, "EAAB-token");
        let shown = format!("{input:?}");
        assert!(!shown.contains("EAAB-token") && !shown.contains("shh"));
        assert!(validate_input("", "1", "2", "s").is_err());
        assert!(validate_input("t", "12a", "2", "s").is_err());
        assert!(validate_input("t", "1", "", "s").is_err());
        assert!(validate_input("t", "1", "2", "").is_err());
        assert!(validate_input("a b", "1", "2", "s").is_err());
    }

    #[test]
    fn red_quality_stops_sending_and_tells_the_owner_once() {
        let first = plan_quality("RED", Some("CONNECTED"), None, &[]);
        assert_eq!(first.pause, Some(true));
        assert!(first
            .set_issues
            .iter()
            .any(|(code, _)| *code == "quality_red"));
        assert_eq!(first.notify.len(), 1);
        let repeat = plan_quality(
            "RED",
            Some("CONNECTED"),
            Some(QUALITY_PAUSE_REASON),
            &["quality_red"],
        );
        assert_eq!(repeat.pause, Some(true));
        assert!(repeat.notify.is_empty());
    }

    #[test]
    fn better_quality_resumes_only_a_pause_quality_caused() {
        let resumed = plan_quality(
            "GREEN",
            Some("CONNECTED"),
            Some(QUALITY_PAUSE_REASON),
            &["quality_red"],
        );
        assert_eq!(resumed.pause, Some(false));
        assert!(resumed.clear_issues.contains(&"quality_red"));
        let manual = plan_quality(
            "GREEN",
            Some("CONNECTED"),
            Some("The WhatsApp access token expired"),
            &[],
        );
        assert_eq!(manual.pause, None);
        let yellow = plan_quality("YELLOW", None, None, &[]);
        assert_eq!(yellow.pause, None);
        assert!(yellow
            .set_issues
            .iter()
            .any(|(code, _)| *code == "quality_yellow"));
    }

    #[test]
    fn a_disconnected_number_is_an_issue() {
        let plan = plan_quality("GREEN", Some("DISCONNECTED"), None, &[]);
        assert!(plan
            .set_issues
            .iter()
            .any(|(code, _)| *code == "number_disconnected"));
        assert_eq!(plan.notify.len(), 1);
        let ok = plan_quality("GREEN", Some("connected"), None, &["number_disconnected"]);
        assert!(ok.clear_issues.contains(&"number_disconnected"));
    }

    #[test]
    fn issue_lookup_reads_codes() {
        let issues = json!([{"code": "quality_red", "message": "x", "at": "t"}]);
        assert!(has_issue(&issues, "quality_red"));
        assert!(!has_issue(&issues, "token_expired"));
        assert!(!has_issue(&json!(null), "quality_red"));
    }

    #[test]
    fn connect_errors_have_stable_codes() {
        assert_eq!(
            ConnectError::NotConfigured.code(),
            "whatsapp_not_configured"
        );
        assert_eq!(
            ConnectError::TokenRejected.code(),
            "whatsapp_token_rejected"
        );
        assert_eq!(
            ConnectError::AlreadyConnected.code(),
            "whatsapp_already_connected"
        );
    }
}
