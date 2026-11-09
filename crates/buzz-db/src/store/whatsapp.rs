//! Per-company WhatsApp outreach state: connection (sealed secrets), settings, templates,
//! contacts, messages and batches. Contract: `docs/whatsapp-outreach.md`.
//!
//! Every statement is scoped by `community_id`. Secrets are stored exactly as the relay
//! sealed them; nothing in this module can open them, and nothing here logs a value.

use buzz_core::CommunityId;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::error::{DbError, Result};
use crate::Db;

/// Highest daily cap an owner can set.
pub const MAX_DAILY_NEW_CHAT_CAP: i32 = 1000;
/// Default daily cap on NEW chats.
pub const DEFAULT_DAILY_NEW_CHAT_CAP: i32 = 30;
/// Durable reason shown when an owner deliberately stops all sending.
pub const OWNER_PAUSE_REASON: &str = "owner paused";
/// Durable reason shown when Meta reports RED quality.
pub const QUALITY_PAUSE_REASON: &str = "Quality rating is RED. Sending stopped.";
/// Failed Colony posts of one message before the repair loop gives up on it.
pub const POST_MAX_ATTEMPTS: i32 = 24;
/// Failed downloads of one inbound media file before the owner has to press Retry.
pub const MEDIA_MAX_ATTEMPTS: i32 = 8;
/// Failed follow-up posts (the link added to an already posted message) before the repair
/// loop stops trying. Counted together with the download attempts of the same row.
pub const MEDIA_LINK_MAX_ATTEMPTS: i32 = 40;

async fn begin(pool: &PgPool) -> Result<sqlx::Transaction<'static, sqlx::Postgres>> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    Ok(sqlx::Transaction::begin(connection, None).await?)
}

/// Persist the account-health fence in the same transaction as the refusal that caused it.
/// Returns whether this is a newly unhealthy state, which callers use to avoid duplicate
/// owner notifications while Meta keeps returning the same refusal.
async fn mark_account_unhealthy_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    error_code: &str,
    error_text: &str,
    pause_reason: &str,
    now: DateTime<Utc>,
) -> Result<bool> {
    sqlx::query(
        "INSERT INTO whatsapp_settings (community_id) VALUES ($1) \
         ON CONFLICT (community_id) DO NOTHING",
    )
    .bind(community.as_uuid())
    .execute(&mut **tx)
    .await?;

    let previous: (Option<String>, bool) = sqlx::query_as(
        "SELECT account_health_code, system_paused FROM whatsapp_settings \
         WHERE community_id = $1 FOR UPDATE",
    )
    .bind(community.as_uuid())
    .fetch_one(&mut **tx)
    .await?;
    // A resumed incident stays visible until the next accepted Graph send. If the same code
    // fails again during that resume attempt, the connection has become unhealthy again and
    // the owner needs another notification even though the stored code did not change.
    let became_unhealthy = !previous.1 || previous.0.as_deref() != Some(error_code);

    sqlx::query(
        "UPDATE whatsapp_settings SET system_paused = TRUE, system_pause_reason = $2, \
             send_paused = TRUE, \
             pause_reason = CASE \
                 WHEN owner_paused THEN $6 \
                 WHEN quality_paused THEN $7 \
                 ELSE $2 \
             END, \
             account_health_code = $3, account_health_text = $4, account_health_at = $5, \
             account_health_resume_requested_at = NULL, updated_at = now() \
         WHERE community_id = $1",
    )
    .bind(community.as_uuid())
    .bind(pause_reason.chars().take(500).collect::<String>())
    .bind(error_code.chars().take(64).collect::<String>())
    .bind(error_text.chars().take(500).collect::<String>())
    .bind(now)
    .bind(OWNER_PAUSE_REASON)
    .bind(QUALITY_PAUSE_REASON)
    .execute(&mut **tx)
    .await?;
    Ok(became_unhealthy)
}

/// Company level outreach settings.
#[derive(Clone, Debug)]
pub struct WhatsappSettings {
    /// Daily cap on NEW chats.
    pub daily_new_chat_cap: i32,
    /// Private Outreach channel, once created.
    pub outreach_channel_id: Option<Uuid>,
    /// Sending is stopped (for example quality RED).
    pub send_paused: bool,
    /// Plain reason for the pause.
    pub pause_reason: Option<String>,
    /// Whether an owner or admin has manually paused sending.
    pub owner_paused: bool,
    /// Public key of the owner or admin who made the active manual pause.
    pub owner_paused_by: Option<Vec<u8>>,
    /// When the active manual pause was made.
    pub owner_paused_at: Option<DateTime<Utc>>,
    /// Whether Meta RED quality has independently paused sending.
    pub quality_paused: bool,
    /// Whether a non-quality automatic incident has independently paused sending.
    pub system_paused: bool,
    /// Reason for the non-quality automatic pause.
    pub system_pause_reason: Option<String>,
    /// Meta account failure that caused the automatic sender pause, if any.
    pub account_health_code: Option<String>,
    /// Meta's stored error text for the automatic account pause.
    pub account_health_text: Option<String>,
    /// When the automatic account pause was recorded.
    pub account_health_at: Option<DateTime<Utc>>,
    /// When an owner or admin last asked the relay to retry the account queue.
    pub account_health_resume_requested_at: Option<DateTime<Utc>>,
    /// Visible issues: `[{code, message, at}]`.
    pub issues: Value,
    /// Last template sync.
    pub templates_synced_at: Option<DateTime<Utc>>,
}

/// A stored connection. Secrets are still sealed.
#[derive(Clone)]
pub struct WhatsappConnection {
    /// Connection id used in the webhook URL.
    pub id: Uuid,
    /// Meta phone number id.
    pub phone_number_id: String,
    /// WhatsApp business account id.
    pub waba_id: String,
    /// Display number.
    pub display_phone_number: Option<String>,
    /// Verified business name.
    pub verified_name: Option<String>,
    /// Meta quality rating.
    pub quality_rating: String,
    /// Meta phone status.
    pub phone_status: Option<String>,
    /// Identifier of the KEK that sealed the secrets.
    pub kek_id: String,
    /// Sealed access token.
    pub sealed_token: Vec<u8>,
    /// Nonce of the sealed access token.
    pub token_nonce: Vec<u8>,
    /// Sealed app secret.
    pub sealed_app_secret: Vec<u8>,
    /// Nonce of the sealed app secret.
    pub app_secret_nonce: Vec<u8>,
    /// SHA-256 of the webhook verify token.
    pub verify_token_hash: Vec<u8>,
    /// Who connected the number.
    pub created_by: Vec<u8>,
}

impl std::fmt::Debug for WhatsappConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhatsappConnection")
            .field("id", &self.id)
            .field("phone_number_id", &self.phone_number_id)
            .field("secrets", &"[REDACTED]")
            .finish()
    }
}

/// Input for a new connection.
pub struct NewWhatsappConnection {
    /// Connection id used in the webhook URL.
    pub id: Uuid,
    /// Meta phone number id.
    pub phone_number_id: String,
    /// WhatsApp business account id.
    pub waba_id: String,
    /// Display number.
    pub display_phone_number: Option<String>,
    /// Verified business name.
    pub verified_name: Option<String>,
    /// Meta quality rating.
    pub quality_rating: String,
    /// Meta phone status.
    pub phone_status: Option<String>,
    /// Identifier of the sealing KEK.
    pub kek_id: String,
    /// Sealed access token.
    pub sealed_token: Vec<u8>,
    /// Nonce of the sealed access token.
    pub token_nonce: Vec<u8>,
    /// Sealed app secret.
    pub sealed_app_secret: Vec<u8>,
    /// Nonce of the sealed app secret.
    pub app_secret_nonce: Vec<u8>,
    /// SHA-256 of the verify token.
    pub verify_token_hash: Vec<u8>,
    /// Who connected the number.
    pub created_by: Vec<u8>,
}

/// An approved template.
#[derive(Clone, Debug)]
pub struct WhatsappTemplate {
    /// Template name.
    pub name: String,
    /// Language code.
    pub language: String,
    /// Meta category.
    pub category: String,
    /// Meta status.
    pub status: String,
    /// Body text with `{{n}}` slots.
    pub body: String,
    /// Highest slot number.
    pub slots: i32,
    /// Buttons: `[{type, text}]`.
    pub buttons: Value,
    /// Colony display title. Agents and the UI use it; `name` stays the send key.
    pub title: String,
    /// The title was set by an owner or admin and sync no longer rewrites it.
    pub title_custom: bool,
    /// A better title proposed by an agent, waiting for an owner or admin.
    pub proposed_title: Option<String>,
}

/// What a contact's outbound rows say about the conversation, for the contact status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OutreachFlags {
    /// A row is `held`: its batch still waits for an owner or admin.
    pub awaiting_approval: bool,
    /// A row is approved but not sent yet (`ready`, `queued` or `sending`).
    pub queued: bool,
    /// A row reached Meta: `sent`, `delivered` or `read`.
    pub sent: bool,
}

/// What the Outreach desk reads about one contact beyond the contact row: the owner's label,
/// a stage set by hand, and facts folded from its messages.
#[derive(Clone, Debug, Default)]
pub struct DeskFacts {
    /// Owner's name for the contact, if set.
    pub label: Option<String>,
    /// Stage a person set by hand.
    pub manual_stage: Option<String>,
    /// Who set it.
    pub manual_stage_by: Option<Vec<u8>>,
    /// When they set it.
    pub manual_stage_at: Option<DateTime<Utc>>,
    /// When the latest outbound message reached Meta (`sent`, `delivered` or `read`).
    pub last_contacted_at: Option<DateTime<Utc>>,
    /// When an approved outbound row last entered the send queue.
    pub queued_at: Option<DateTime<Utc>>,
    /// The batch note or queue where the approved unsent row came from.
    pub queued_from: Option<String>,
    /// When the customer last tapped the template's first quick-reply button.
    pub wants_call_at: Option<DateTime<Utc>>,
    /// When the latest outbound send outcome happened.
    pub last_outcome_at: Option<DateTime<Utc>>,
    /// State of the latest outbound send outcome (`sent`, `delivered`, `read` or `failed`).
    pub last_outcome_state: Option<String>,
    /// Meta error code of that outcome when it failed.
    pub last_outcome_code: Option<String>,
}

/// A WhatsApp contact (one per wa_id and company).
#[derive(Clone, Debug)]
pub struct WhatsappContact {
    /// Digits only, E.164 without the plus.
    pub wa_id: String,
    /// Name from the WhatsApp profile.
    pub display_name: String,
    /// Matching lead id.
    pub lead_id: Option<String>,
    /// Agent that owns the contact.
    pub owner_pubkey: Option<Vec<u8>>,
    /// Root event of the contact's single thread.
    pub thread_root_event_id: Option<Vec<u8>>,
    /// Last inbound message time.
    pub last_inbound_at: Option<DateTime<Utc>>,
    /// Last outbound message time.
    pub last_outbound_at: Option<DateTime<Utc>>,
    /// Outbound messages sent since the last inbound one.
    pub outbound_since_inbound: i32,
    /// When the contact opted out.
    pub opted_out_at: Option<DateTime<Utc>>,
    /// Why the contact opted out.
    pub opt_out_reason: Option<String>,
    /// When the contact was paused.
    pub paused_at: Option<DateTime<Utc>>,
    /// Why the contact was paused.
    pub pause_reason: Option<String>,
    /// When a documented recipient-level failure may return to the ordinary queue.
    pub retry_after: Option<DateTime<Utc>>,
    /// When the contact was first seen.
    pub created_at: DateTime<Utc>,
}

/// One active or historical contact-safety decision. `identity_kind` is deliberately broader
/// than WhatsApp numbers so email and domain safety can join the same ledger later.
#[derive(Clone, Debug)]
pub struct WhatsappSuppression {
    /// Stable row id.
    pub id: Uuid,
    /// `phone`, `email` or `domain`.
    pub identity_kind: String,
    /// Canonical identity value.
    pub identity_value: String,
    /// `opt_out` or `never_contact`.
    pub scope: String,
    /// Human-readable decision reason.
    pub reason: String,
    /// Deterministic phrase rule when an inbound phrase created the row.
    pub matched_rule: Option<String>,
    /// Inbound detection or owner action.
    pub source: String,
    /// When the decision was recorded.
    pub created_at: DateTime<Utc>,
    /// When an owner or admin undid it, if ever.
    pub undone_at: Option<DateTime<Utc>>,
}

/// A durable hold on every current and future contact attached to one business. The source
/// reply stays visible so an owner can understand why the business was stopped.
#[derive(Clone, Debug)]
pub struct WhatsappBusinessStop {
    /// Business or prospect identity shared by its WhatsApp contacts.
    pub business_id: String,
    /// Number that sent the inbound reply which created the hold.
    pub source_wa_id: String,
    /// Plain reason for the stop.
    pub reason: String,
    /// Deterministic phrase rule when the source reply was an opt-out.
    pub matched_rule: Option<String>,
    /// When the hold was recorded.
    pub created_at: DateTime<Utc>,
}

/// The first active safety fence that prevents a WhatsApp recipient from receiving outreach.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WhatsappSendSafety {
    /// `opt_out`, `never_contact` or `business_stop`.
    pub scope: String,
    /// Plain reason shown to the caller and stored on skipped rows.
    pub reason: String,
    /// Matching phrase rule when the fence came from a deterministic opt-out rule.
    pub matched_rule: Option<String>,
    /// Business id for a whole-business stop.
    pub business_id: Option<String>,
}

/// Result of durably applying an inbound reply's safety effect.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InboundSafetyOutcome {
    /// The inbound event made this phone's opt-out record active for the first time.
    pub opted_out_now: bool,
    /// The inbound event stopped this linked business for the first time.
    pub business_stopped_now: bool,
}

/// The result of an owner-confirmed replacement for an unknown provider outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnknownSendReplacement {
    /// This action created the only permitted replacement row.
    Created(Uuid),
    /// A previous owner action already created a replacement row.
    Existing(Uuid),
}

/// Result of recording a definitive account-level Graph refusal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AccountFailureOutcome {
    /// The leased message was changed from `sending` to `failed`.
    pub failed: bool,
    /// This refusal changed the connection from healthy to unhealthy, or changed its code.
    pub became_unhealthy: bool,
}

/// The leased outbound row and Meta details that caused an account-wide sender pause.
#[derive(Clone, Debug)]
pub struct WhatsappAccountFailure<'a> {
    /// Leased message that Graph definitely refused.
    pub message_id: Uuid,
    /// Lease token held by the sender that called Graph.
    pub lease_token: Uuid,
    /// Meta error code.
    pub error_code: &'a str,
    /// Meta error message.
    pub error_text: &'a str,
    /// Plain account-level pause reason stored with the queue fence.
    pub pause_reason: &'a str,
    /// Time the account health incident was observed.
    pub at: DateTime<Utc>,
}

/// Result of applying one Meta delivery callback.
#[derive(Clone, Debug)]
pub struct WhatsappStatusUpdate {
    /// The outbound message Meta named, after its durable state transition.
    pub message: Option<WhatsappMessage>,
    /// The callback made the connection newly unhealthy.
    pub became_unhealthy: bool,
}

/// A delivery callback and, when applicable, the account-health pause it causes.
#[derive(Clone, Debug)]
pub struct WhatsappStatusHealthUpdate<'a> {
    /// Meta WhatsApp message identifier from the callback.
    pub wamid: &'a str,
    /// Delivery state supplied by Meta.
    pub state: &'a str,
    /// Meta error code, when supplied.
    pub error_code: Option<&'a str>,
    /// Meta error text, when supplied.
    pub error_text: Option<&'a str>,
    /// Plain account-level pause reason for an account-wide failed callback.
    pub account_pause_reason: Option<&'a str>,
    /// Time the callback was handled.
    pub at: DateTime<Utc>,
}

/// One inbound or outbound message.
#[derive(Clone, Debug)]
pub struct WhatsappMessage {
    /// Message id.
    pub id: Uuid,
    /// Contact.
    pub wa_id: String,
    /// `in` or `out`.
    pub direction: String,
    /// `text`, `template`, `media`, `button` or `other`.
    pub kind: String,
    /// Text (rendered text for templates).
    pub body: String,
    /// Template name.
    pub template_name: Option<String>,
    /// Template language.
    pub template_language: Option<String>,
    /// Template parameters.
    pub params: Value,
    /// Delivery state.
    pub state: String,
    /// Why a row was skipped.
    pub skip_reason: Option<String>,
    /// WhatsApp message id.
    pub wamid: Option<String>,
    /// Meta error code.
    pub error_code: Option<String>,
    /// Meta error text.
    pub error_text: Option<String>,
    /// Colony message event.
    pub event_id: Option<Vec<u8>>,
    /// Batch id.
    pub batch_id: Option<Uuid>,
    /// Row index within the batch.
    pub batch_idx: Option<i32>,
    /// Counts to the daily cap.
    pub new_chat: bool,
    /// The owner's `send_now` marker or a delayed per-contact retry deadline. A `ready` row
    /// with this marker was released by Send now and skips the send window and pacing gap; a
    /// delayed retry remains `failed` until its deadline releases it and clears this field.
    pub send_after: Option<DateTime<Utc>>,
    /// Who asked for the send.
    pub sender_pubkey: Option<Vec<u8>>,
    /// Attempt time.
    pub sent_at: Option<DateTime<Utc>>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// Input for an outbound message (a single send or one batch row).
#[derive(Clone, Debug)]
pub struct NewOutboundMessage {
    /// Message id.
    pub id: Uuid,
    /// Contact.
    pub wa_id: String,
    /// `text` or `template`.
    pub kind: String,
    /// Text or rendered template text.
    pub body: String,
    /// Template name.
    pub template_name: Option<String>,
    /// Template language.
    pub template_language: Option<String>,
    /// Template parameters.
    pub params: Value,
    /// Initial state: `held`, `queued`.
    pub state: String,
    /// `req:<requestId>` or `batch:<batchId>:<idx>`.
    pub idempotency_key: String,
    /// Batch id.
    pub batch_id: Option<Uuid>,
    /// Row index within the batch.
    pub batch_idx: Option<i32>,
    /// Counts to the daily cap.
    pub new_chat: bool,
    /// Who asked for the send.
    pub sender_pubkey: Vec<u8>,
}

/// A batch header.
#[derive(Clone, Debug)]
pub struct WhatsappBatch {
    /// Batch id.
    pub id: Uuid,
    /// Author.
    pub created_by: Vec<u8>,
    /// Template name.
    pub template_name: String,
    /// Template language.
    pub language: String,
    /// `pending`, `approved`, `rejected` or `completed`.
    pub status: String,
    /// Note for the approver.
    pub note: String,
    /// Material links.
    pub material_links: Value,
    /// Who decided.
    pub decided_by: Option<Vec<u8>>,
    /// When it was decided.
    pub decided_at: Option<DateTime<Utc>>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// Result of an owner decision on a batch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchDecisionOutcome {
    /// No such batch in this company.
    NotFound,
    /// The batch was already decided.
    NotPending,
    /// An edit or drop named a row that does not exist.
    UnknownRow(i32),
    /// Approved with this many rows ready.
    Approved(i64),
    /// Rejected.
    Rejected,
}

/// Result of an owner `send_now` decision on an approved batch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SendNowOutcome {
    /// No such batch in this company.
    NotFound,
    /// The batch is not approved (pending, rejected or completed).
    NotApproved,
    /// The batch has more rows than a test may have; carries its row count.
    TooManyRows(i64),
    /// No row is waiting to be sent (all sent, dropped or failed already).
    NothingWaiting,
    /// This many waiting rows now skip the send window and the pacing gap.
    Flagged(i64),
}

/// Result of an owner decision on one agent draft.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DraftDecisionOutcome {
    /// No such outbound message in this company.
    NotFound,
    /// The message is not a pending draft (already decided or never one).
    NotDraft,
    /// Approved: queued for the sender.
    Approved,
    /// Rejected: it will never be sent.
    Rejected,
}

/// One edit to a held row, with the relay-rendered body.
#[derive(Clone, Debug)]
pub struct RowEdit {
    /// Row index.
    pub idx: i32,
    /// New parameters.
    pub params: Value,
    /// Re-rendered text.
    pub body: String,
}

/// An inbound media message: what the webhook said and where the download stands.
#[derive(Clone, Debug, PartialEq)]
pub struct WhatsappMedia {
    /// Message row id.
    pub message_id: Uuid,
    /// Contact.
    pub wa_id: String,
    /// What the webhook said (`type`, `mediaId`, `mime`, `caption`, ...).
    pub media: Value,
    /// `pending`, `stored`, `failed`, `gone`, or `None` when there is nothing to download.
    pub state: Option<String>,
    /// The stored blob: `{sha256, ext, mime, size, opaque}`.
    pub stored: Option<Value>,
    /// Failed download attempts.
    pub attempts: i32,
    /// Next download attempt.
    pub retry_at: Option<DateTime<Utc>>,
    /// Why the download stopped, in a short code.
    pub error: Option<String>,
    /// The Colony message event already carries the media link.
    pub linked: bool,
    /// Colony message event, once posted.
    pub event_id: Option<Vec<u8>>,
    /// When the customer sent it.
    pub created_at: DateTime<Utc>,
}

/// `SELECT` of the media columns plus a fixed tail, as one string literal (sqlx takes only
/// static SQL; there is no dynamic text here).
macro_rules! media_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, wa_id, media, media_state, media_stored, media_attempts, \
             media_retry_at, media_error, media_linked, event_id, created_at \
             FROM whatsapp_messages ",
            $tail
        )
    };
}

fn row_to_media(row: &PgRow) -> Result<WhatsappMedia> {
    Ok(WhatsappMedia {
        message_id: row.try_get("id")?,
        wa_id: row.try_get("wa_id")?,
        media: row
            .try_get::<Option<Value>, _>("media")?
            .unwrap_or(Value::Null),
        state: row.try_get("media_state")?,
        stored: row.try_get("media_stored")?,
        attempts: row.try_get("media_attempts")?,
        retry_at: row.try_get("media_retry_at")?,
        error: row.try_get("media_error")?,
        linked: row.try_get("media_linked")?,
        event_id: row.try_get("event_id")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_message(row: &PgRow) -> Result<WhatsappMessage> {
    Ok(WhatsappMessage {
        id: row.try_get("id")?,
        wa_id: row.try_get("wa_id")?,
        direction: row.try_get("direction")?,
        kind: row.try_get("kind")?,
        body: row.try_get("body")?,
        template_name: row.try_get("template_name")?,
        template_language: row.try_get("template_language")?,
        params: row.try_get("params")?,
        state: row.try_get("state")?,
        skip_reason: row.try_get("skip_reason")?,
        wamid: row.try_get("wamid")?,
        error_code: row.try_get("error_code")?,
        error_text: row.try_get("error_text")?,
        event_id: row.try_get("event_id")?,
        batch_id: row.try_get("batch_id")?,
        batch_idx: row.try_get("batch_idx")?,
        new_chat: row.try_get("new_chat")?,
        send_after: row.try_get("send_after")?,
        sender_pubkey: row.try_get("sender_pubkey")?,
        sent_at: row.try_get("sent_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_contact(row: &PgRow) -> Result<WhatsappContact> {
    Ok(WhatsappContact {
        wa_id: row.try_get("wa_id")?,
        display_name: row.try_get("display_name")?,
        lead_id: row.try_get("lead_id")?,
        owner_pubkey: row.try_get("owner_pubkey")?,
        thread_root_event_id: row.try_get("thread_root_event_id")?,
        last_inbound_at: row.try_get("last_inbound_at")?,
        last_outbound_at: row.try_get("last_outbound_at")?,
        outbound_since_inbound: row.try_get("outbound_since_inbound")?,
        opted_out_at: row.try_get("opted_out_at")?,
        opt_out_reason: row.try_get("opt_out_reason")?,
        paused_at: row.try_get("paused_at")?,
        pause_reason: row.try_get("pause_reason")?,
        retry_after: row.try_get("retry_after")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_suppression(row: &PgRow) -> Result<WhatsappSuppression> {
    Ok(WhatsappSuppression {
        id: row.try_get("id")?,
        identity_kind: row.try_get("identity_kind")?,
        identity_value: row.try_get("identity_value")?,
        scope: row.try_get("scope")?,
        reason: row.try_get("reason")?,
        matched_rule: row.try_get("matched_rule")?,
        source: row.try_get("source")?,
        created_at: row.try_get("created_at")?,
        undone_at: row.try_get("undone_at")?,
    })
}

fn row_to_business_stop(row: &PgRow) -> Result<WhatsappBusinessStop> {
    Ok(WhatsappBusinessStop {
        business_id: row.try_get("business_id")?,
        source_wa_id: row.try_get("source_wa_id")?,
        reason: row.try_get("reason")?,
        matched_rule: row.try_get("matched_rule")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_batch(row: &PgRow) -> Result<WhatsappBatch> {
    Ok(WhatsappBatch {
        id: row.try_get("id")?,
        created_by: row.try_get("created_by")?,
        template_name: row.try_get("template_name")?,
        language: row.try_get("language")?,
        status: row.try_get("status")?,
        note: row.try_get("note")?,
        material_links: row.try_get("material_links")?,
        decided_by: row.try_get("decided_by")?,
        decided_at: row.try_get("decided_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_template(row: &PgRow) -> Result<WhatsappTemplate> {
    Ok(WhatsappTemplate {
        name: row.try_get("name")?,
        language: row.try_get("language")?,
        category: row.try_get("category")?,
        status: row.try_get("status")?,
        body: row.try_get("body")?,
        slots: row.try_get("slots")?,
        buttons: row.try_get("buttons")?,
        title: row.try_get("title")?,
        title_custom: row.try_get("title_custom")?,
        proposed_title: row.try_get("proposed_title")?,
    })
}

fn row_to_connection(row: &PgRow) -> Result<WhatsappConnection> {
    Ok(WhatsappConnection {
        id: row.try_get("id")?,
        phone_number_id: row.try_get("phone_number_id")?,
        waba_id: row.try_get("waba_id")?,
        display_phone_number: row.try_get("display_phone_number")?,
        verified_name: row.try_get("verified_name")?,
        quality_rating: row.try_get("quality_rating")?,
        phone_status: row.try_get("phone_status")?,
        kek_id: row.try_get("kek_id")?,
        sealed_token: row.try_get("sealed_token")?,
        token_nonce: row.try_get("token_nonce")?,
        sealed_app_secret: row.try_get("sealed_app_secret")?,
        app_secret_nonce: row.try_get("app_secret_nonce")?,
        verify_token_hash: row.try_get("verify_token_hash")?,
        created_by: row.try_get("created_by")?,
    })
}

impl Db {
    // ── agent ownership ────────────────────────────────────────────────────────

    /// True when `agent` is an active agent whose recorded owner (`users.agent_owner_pubkey`,
    /// written from the verified NIP-OA auth tag) is currently an owner or admin of the
    /// company. Display names play no part; a demoted owner takes the agent's access with them.
    pub async fn whatsapp_agent_is_owned_by_admin(
        &self,
        community: CommunityId,
        agent: &[u8],
    ) -> Result<bool> {
        let owned = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS ( \
                 SELECT 1 FROM users u \
                 JOIN relay_members rm ON rm.community_id = u.community_id \
                  AND rm.pubkey = encode(u.agent_owner_pubkey, 'hex') \
                 WHERE u.community_id = $1 AND u.pubkey = $2 \
                   AND u.deactivated_at IS NULL \
                   AND rm.role IN ('owner', 'admin'))",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .fetch_one(&self.pool)
        .await?;
        Ok(owned)
    }

    // ── settings ───────────────────────────────────────────────────────────────

    /// Read the company's settings, creating the default row on first use.
    pub async fn whatsapp_ensure_settings(
        &self,
        community: CommunityId,
    ) -> Result<WhatsappSettings> {
        sqlx::query(
            "INSERT INTO whatsapp_settings (community_id) VALUES ($1) \
             ON CONFLICT (community_id) DO NOTHING",
        )
        .bind(community.as_uuid())
        .execute(&self.pool)
        .await?;
        let row = sqlx::query(
            "SELECT daily_new_chat_cap, outreach_channel_id, send_paused, pause_reason, \
                    owner_paused, owner_paused_by, owner_paused_at, quality_paused, \
                    system_paused, system_pause_reason, \
                    account_health_code, account_health_text, account_health_at, \
                    account_health_resume_requested_at, issues, templates_synced_at \
             FROM whatsapp_settings WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .fetch_one(&self.pool)
        .await?;
        Ok(WhatsappSettings {
            daily_new_chat_cap: row.try_get("daily_new_chat_cap")?,
            outreach_channel_id: row.try_get("outreach_channel_id")?,
            send_paused: row.try_get("send_paused")?,
            pause_reason: row.try_get("pause_reason")?,
            owner_paused: row.try_get("owner_paused")?,
            owner_paused_by: row.try_get("owner_paused_by")?,
            owner_paused_at: row.try_get("owner_paused_at")?,
            quality_paused: row.try_get("quality_paused")?,
            system_paused: row.try_get("system_paused")?,
            system_pause_reason: row.try_get("system_pause_reason")?,
            account_health_code: row.try_get("account_health_code")?,
            account_health_text: row.try_get("account_health_text")?,
            account_health_at: row.try_get("account_health_at")?,
            account_health_resume_requested_at: row
                .try_get("account_health_resume_requested_at")?,
            issues: row.try_get("issues")?,
            templates_synced_at: row.try_get("templates_synced_at")?,
        })
    }

    /// Change the daily cap on NEW chats. Takes effect on the next send decision.
    pub async fn whatsapp_set_daily_cap(&self, community: CommunityId, cap: i32) -> Result<()> {
        if !(0..=MAX_DAILY_NEW_CHAT_CAP).contains(&cap) {
            return Err(DbError::InvalidData(format!(
                "daily cap must be 0 through {MAX_DAILY_NEW_CHAT_CAP}"
            )));
        }
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET daily_new_chat_cap = $2, updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(cap)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Remember the Outreach channel.
    pub async fn whatsapp_set_outreach_channel(
        &self,
        community: CommunityId,
        channel_id: Uuid,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET outreach_channel_id = $2, updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(channel_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Set or clear the manual owner pause without disturbing quality or automatic stops.
    pub async fn whatsapp_set_owner_send_paused(
        &self,
        community: CommunityId,
        paused: bool,
        actor: &[u8],
        at: DateTime<Utc>,
    ) -> Result<()> {
        if actor.len() != 32 {
            return Err(DbError::InvalidData(
                "owner pause actor must be a 32-byte public key".to_string(),
            ));
        }
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET \
                 owner_paused = $2, \
                 owner_paused_by = CASE WHEN $2 THEN $3 ELSE NULL END, \
                 owner_paused_at = CASE WHEN $2 THEN $4 ELSE NULL END, \
                 send_paused = $2 OR quality_paused OR system_paused, \
                 pause_reason = CASE \
                     WHEN $2 THEN $5 \
                     WHEN quality_paused THEN $6 \
                     WHEN system_paused THEN system_pause_reason \
                     ELSE NULL \
                 END, \
                 updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(paused)
        .bind(actor)
        .bind(at)
        .bind(OWNER_PAUSE_REASON)
        .bind(QUALITY_PAUSE_REASON)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Set or clear the RED-quality pause without disturbing owner or automatic stops.
    pub async fn whatsapp_set_quality_send_paused(
        &self,
        community: CommunityId,
        paused: bool,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET \
                 quality_paused = $2, \
                 send_paused = owner_paused OR $2 OR system_paused, \
                 pause_reason = CASE \
                     WHEN owner_paused THEN $3 \
                     WHEN $2 THEN $4 \
                     WHEN system_paused THEN system_pause_reason \
                     ELSE NULL \
                 END, \
                 updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(paused)
        .bind(OWNER_PAUSE_REASON)
        .bind(QUALITY_PAUSE_REASON)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Set or clear a non-quality automatic pause without disturbing an owner or quality pause.
    pub async fn whatsapp_set_system_send_paused(
        &self,
        community: CommunityId,
        paused: bool,
        reason: Option<&str>,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET \
                 system_paused = $2, \
                 system_pause_reason = CASE WHEN $2 THEN $3 ELSE NULL END, \
                 send_paused = owner_paused OR quality_paused OR $2, \
                 pause_reason = CASE \
                     WHEN owner_paused THEN $4 \
                     WHEN quality_paused THEN $5 \
                     WHEN $2 THEN $3 \
                     ELSE NULL \
                 END, \
                 updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(paused)
        .bind(reason.map(|r| r.chars().take(500).collect::<String>()))
        .bind(OWNER_PAUSE_REASON)
        .bind(QUALITY_PAUSE_REASON)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Compatibility wrapper for existing internal callers that represent an automatic pause.
    pub async fn whatsapp_set_send_paused(
        &self,
        community: CommunityId,
        paused: bool,
        reason: Option<&str>,
    ) -> Result<()> {
        self.whatsapp_set_system_send_paused(community, paused, reason)
            .await
    }

    /// Show an issue to the owner. One entry per code; a repeat replaces the old entry.
    pub async fn whatsapp_set_issue(
        &self,
        community: CommunityId,
        code: &str,
        message: &str,
        at: DateTime<Utc>,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        let entry = serde_json::json!({
            "code": code,
            "message": message.chars().take(500).collect::<String>(),
            "at": at.to_rfc3339(),
        });
        sqlx::query(
            "UPDATE whatsapp_settings SET issues = \
                 COALESCE((SELECT jsonb_agg(i) FROM jsonb_array_elements(issues) AS i \
                           WHERE i->>'code' <> $2), '[]'::jsonb) || jsonb_build_array($3::jsonb), \
                 updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(code)
        .bind(entry)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Remove a resolved issue.
    pub async fn whatsapp_clear_issue(&self, community: CommunityId, code: &str) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_settings SET issues = \
                 COALESCE((SELECT jsonb_agg(i) FROM jsonb_array_elements(issues) AS i \
                           WHERE i->>'code' <> $2), '[]'::jsonb), \
                 updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(code)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── connection ─────────────────────────────────────────────────────────────

    /// Store a new connection. Returns `false` when the company already has one.
    pub async fn whatsapp_insert_connection(
        &self,
        community: CommunityId,
        connection: &NewWhatsappConnection,
    ) -> Result<bool> {
        let result = sqlx::query(
            "INSERT INTO whatsapp_connections \
             (community_id, id, phone_number_id, waba_id, display_phone_number, verified_name, \
              quality_rating, phone_status, kek_id, sealed_token, token_nonce, \
              sealed_app_secret, app_secret_nonce, verify_token_hash, created_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) \
             ON CONFLICT (community_id) DO NOTHING",
        )
        .bind(community.as_uuid())
        .bind(connection.id)
        .bind(&connection.phone_number_id)
        .bind(&connection.waba_id)
        .bind(&connection.display_phone_number)
        .bind(&connection.verified_name)
        .bind(&connection.quality_rating)
        .bind(&connection.phone_status)
        .bind(&connection.kek_id)
        .bind(&connection.sealed_token)
        .bind(&connection.token_nonce)
        .bind(&connection.sealed_app_secret)
        .bind(&connection.app_secret_nonce)
        .bind(&connection.verify_token_hash)
        .bind(&connection.created_by)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// The company's connection, if any.
    pub async fn whatsapp_get_connection(
        &self,
        community: CommunityId,
    ) -> Result<Option<WhatsappConnection>> {
        let row = sqlx::query(
            "SELECT id, phone_number_id, waba_id, display_phone_number, verified_name, \
                    quality_rating, phone_status, kek_id, sealed_token, token_nonce, \
                    sealed_app_secret, app_secret_nonce, verify_token_hash, created_by \
             FROM whatsapp_connections WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_connection).transpose()
    }

    /// The company's connection when `connection_id` is its connection id.
    pub async fn whatsapp_get_connection_by_id(
        &self,
        community: CommunityId,
        connection_id: Uuid,
    ) -> Result<Option<WhatsappConnection>> {
        let row = sqlx::query(
            "SELECT id, phone_number_id, waba_id, display_phone_number, verified_name, \
                    quality_rating, phone_status, kek_id, sealed_token, token_nonce, \
                    sealed_app_secret, app_secret_nonce, verify_token_hash, created_by \
             FROM whatsapp_connections WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(connection_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_connection).transpose()
    }

    /// Delete the connection and with it the sealed secrets.
    pub async fn whatsapp_delete_connection(&self, community: CommunityId) -> Result<bool> {
        let result = sqlx::query("DELETE FROM whatsapp_connections WHERE community_id = $1")
            .bind(community.as_uuid())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Every connected company, for the sender loop.
    pub async fn whatsapp_list_connected_communities(&self) -> Result<Vec<CommunityId>> {
        let rows =
            sqlx::query("SELECT community_id FROM whatsapp_connections ORDER BY community_id")
                .fetch_all(&self.pool)
                .await?;
        rows.iter()
            .map(|row| Ok(CommunityId::from_uuid(row.try_get("community_id")?)))
            .collect()
    }

    /// Record what Meta says about the number.
    pub async fn whatsapp_update_phone_info(
        &self,
        community: CommunityId,
        display_phone_number: Option<&str>,
        verified_name: Option<&str>,
        quality_rating: &str,
        phone_status: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_connections SET display_phone_number = COALESCE($2, display_phone_number), \
                 verified_name = COALESCE($3, verified_name), quality_rating = $4, \
                 phone_status = COALESCE($5, phone_status), updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(display_phone_number)
        .bind(verified_name)
        .bind(quality_rating)
        .bind(phone_status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── templates ──────────────────────────────────────────────────────────────

    /// Replace the synced template list in one transaction.
    pub async fn whatsapp_replace_templates(
        &self,
        community: CommunityId,
        templates: &[WhatsappTemplate],
        synced_at: DateTime<Utc>,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        let mut tx = begin(&self.pool).await?;
        // Upsert so an owner's title survives every sync; only default titles follow the body.
        for template in templates {
            sqlx::query(
                "INSERT INTO whatsapp_templates \
                 (community_id, name, language, category, status, body, slots, buttons, synced_at, \
                  title) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                 ON CONFLICT (community_id, name, language) DO UPDATE SET \
                     category = EXCLUDED.category, status = EXCLUDED.status, \
                     body = EXCLUDED.body, slots = EXCLUDED.slots, buttons = EXCLUDED.buttons, \
                     synced_at = EXCLUDED.synced_at, \
                     title = CASE WHEN whatsapp_templates.title_custom \
                                  THEN whatsapp_templates.title ELSE EXCLUDED.title END",
            )
            .bind(community.as_uuid())
            .bind(&template.name)
            .bind(&template.language)
            .bind(&template.category)
            .bind(&template.status)
            .bind(&template.body)
            .bind(template.slots)
            .bind(&template.buttons)
            .bind(synced_at)
            .bind(&template.title)
            .execute(&mut *tx)
            .await?;
        }
        // Templates Meta no longer lists as approved are gone from this sync.
        sqlx::query("DELETE FROM whatsapp_templates WHERE community_id = $1 AND synced_at <> $2")
            .bind(community.as_uuid())
            .bind(synced_at)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET templates_synced_at = $2, updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Synced templates, newest names last.
    pub async fn whatsapp_list_templates(
        &self,
        community: CommunityId,
    ) -> Result<Vec<WhatsappTemplate>> {
        let rows = sqlx::query(
            "SELECT name, language, category, status, body, slots, buttons, title, title_custom, \
                    proposed_title \
             FROM whatsapp_templates WHERE community_id = $1 ORDER BY name, language",
        )
        .bind(community.as_uuid())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_template).collect()
    }

    /// One template.
    pub async fn whatsapp_get_template(
        &self,
        community: CommunityId,
        name: &str,
        language: &str,
    ) -> Result<Option<WhatsappTemplate>> {
        let row = sqlx::query(
            "SELECT name, language, category, status, body, slots, buttons, title, title_custom, \
                    proposed_title \
             FROM whatsapp_templates WHERE community_id = $1 AND name = $2 AND language = $3",
        )
        .bind(community.as_uuid())
        .bind(name)
        .bind(language)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_template).transpose()
    }

    /// Find a template by its Meta name or, failing that, by its Colony title (case
    /// insensitive). Agents may use either; the Meta name stays the send key.
    pub async fn whatsapp_find_template(
        &self,
        community: CommunityId,
        key: &str,
        language: &str,
    ) -> Result<Option<WhatsappTemplate>> {
        if let Some(found) = self.whatsapp_get_template(community, key, language).await? {
            return Ok(Some(found));
        }
        let rows = sqlx::query(
            "SELECT name, language, category, status, body, slots, buttons, title, title_custom, \
                    proposed_title \
             FROM whatsapp_templates \
             WHERE community_id = $1 AND language = $2 AND lower(title) = lower($3) \
             ORDER BY name LIMIT 2",
        )
        .bind(community.as_uuid())
        .bind(language)
        .bind(key.trim())
        .fetch_all(&self.pool)
        .await?;
        // Two templates with the same title are ambiguous: the caller must use the Meta name.
        if rows.len() == 1 {
            rows.first().map(row_to_template).transpose()
        } else {
            Ok(None)
        }
    }

    /// Owner or admin renames a template. The new title survives later syncs.
    /// Returns `false` when the template does not exist.
    pub async fn whatsapp_set_template_title(
        &self,
        community: CommunityId,
        name: &str,
        language: &str,
        title: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_templates SET title = $4, title_custom = true, \
                 proposed_title = NULL, proposed_by = NULL \
             WHERE community_id = $1 AND name = $2 AND language = $3",
        )
        .bind(community.as_uuid())
        .bind(name)
        .bind(language)
        .bind(title)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// An agent proposes a better title. It changes nothing until an owner or admin accepts.
    pub async fn whatsapp_propose_template_title(
        &self,
        community: CommunityId,
        name: &str,
        language: &str,
        title: &str,
        proposed_by: &[u8],
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_templates SET proposed_title = $4, proposed_by = $5 \
             WHERE community_id = $1 AND name = $2 AND language = $3",
        )
        .bind(community.as_uuid())
        .bind(name)
        .bind(language)
        .bind(title)
        .bind(proposed_by)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    // ── contacts ───────────────────────────────────────────────────────────────

    /// Create the contact if missing and return it.
    pub async fn whatsapp_ensure_contact(
        &self,
        community: CommunityId,
        wa_id: &str,
        display_name: Option<&str>,
    ) -> Result<WhatsappContact> {
        sqlx::query(
            "INSERT INTO whatsapp_contacts (community_id, wa_id, display_name) \
             VALUES ($1, $2, COALESCE($3, '')) \
             ON CONFLICT (community_id, wa_id) DO UPDATE SET \
                 display_name = CASE WHEN $3 IS NOT NULL AND $3 <> '' \
                                THEN $3 ELSE whatsapp_contacts.display_name END, \
                 updated_at = now()",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(display_name.map(|n| n.chars().take(200).collect::<String>()))
        .execute(&self.pool)
        .await?;
        self.whatsapp_get_contact(community, wa_id)
            .await?
            .ok_or_else(|| DbError::NotFound("whatsapp contact".into()))
    }

    /// Outbound row flags for a set of contacts. Contacts with no outbound rows are absent.
    pub async fn whatsapp_outreach_flags(
        &self,
        community: CommunityId,
        wa_ids: &[String],
    ) -> Result<std::collections::HashMap<String, OutreachFlags>> {
        if wa_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let rows = sqlx::query(
            "SELECT wa_id, \
                    bool_or(state = 'held') AS awaiting_approval, \
                    bool_or(state IN ('ready', 'queued', 'sending')) AS queued, \
                    bool_or(state IN ('sent', 'delivered', 'read')) AS sent \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND direction = 'out' AND wa_id = ANY($2) \
             GROUP BY wa_id",
        )
        .bind(community.as_uuid())
        .bind(wa_ids)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((
                    row.try_get("wa_id")?,
                    OutreachFlags {
                        awaiting_approval: row.try_get("awaiting_approval")?,
                        queued: row.try_get("queued")?,
                        sent: row.try_get("sent")?,
                    },
                ))
            })
            .collect()
    }

    /// Desk facts for a set of contacts in ONE query, whatever their number. Contacts that do
    /// not exist are absent.
    pub async fn whatsapp_desk_facts(
        &self,
        community: CommunityId,
        wa_ids: &[String],
    ) -> Result<std::collections::HashMap<String, DeskFacts>> {
        if wa_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let rows = sqlx::query(
            "SELECT c.wa_id, c.label, c.manual_stage, c.manual_stage_by, c.manual_stage_at, \
                    max(COALESCE(m.sent_at, m.created_at)) FILTER ( \
                        WHERE m.direction = 'out' AND m.state IN ('sent', 'delivered', 'read') \
                    ) AS last_contacted_at, \
                    max(m.updated_at) FILTER ( \
                        WHERE m.direction = 'out' AND m.state IN ('ready', 'queued', 'sending') \
                    ) AS queued_at, \
                    (array_agg( \
                        CASE \
                            WHEN b.id IS NULL THEN 'Outreach queue' \
                            WHEN NULLIF(btrim(b.note), '') IS NOT NULL THEN 'Batch: ' || btrim(b.note) \
                            WHEN NULLIF(btrim(b.template_name), '') IS NOT NULL THEN 'Batch: ' || btrim(b.template_name) \
                            ELSE 'Outreach batch' \
                        END \
                        ORDER BY m.updated_at DESC, m.created_at DESC, m.id DESC \
                    ) FILTER ( \
                        WHERE m.direction = 'out' AND m.state IN ('ready', 'queued', 'sending') \
                    ))[1] AS queued_from, \
                    max(m.created_at) FILTER ( \
                        WHERE m.direction = 'in' AND m.intent = 'wants_call' \
                    ) AS wants_call_at, \
                    max(COALESCE(m.sent_at, m.created_at)) FILTER ( \
                        WHERE m.direction = 'out' \
                          AND m.state IN ('sent', 'delivered', 'read', 'failed') \
                    ) AS last_outcome_at, \
                    (array_agg(m.state ORDER BY COALESCE(m.sent_at, m.created_at) DESC, m.created_at DESC) \
                        FILTER (WHERE m.direction = 'out' \
                                AND m.state IN ('sent', 'delivered', 'read', 'failed')))[1] \
                        AS last_outcome_state, \
                    (array_agg(m.error_code ORDER BY COALESCE(m.sent_at, m.created_at) DESC, m.created_at DESC) \
                        FILTER (WHERE m.direction = 'out' \
                                AND m.state IN ('sent', 'delivered', 'read', 'failed')))[1] \
                        AS last_outcome_code \
             FROM whatsapp_contacts c \
             LEFT JOIN whatsapp_messages m \
                    ON m.community_id = c.community_id AND m.wa_id = c.wa_id \
             LEFT JOIN whatsapp_batches b \
                    ON b.community_id = m.community_id AND b.id = m.batch_id \
             WHERE c.community_id = $1 AND c.wa_id = ANY($2) \
             GROUP BY c.community_id, c.wa_id",
        )
        .bind(community.as_uuid())
        .bind(wa_ids)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((
                    row.try_get("wa_id")?,
                    DeskFacts {
                        label: row.try_get("label")?,
                        manual_stage: row.try_get("manual_stage")?,
                        manual_stage_by: row.try_get("manual_stage_by")?,
                        manual_stage_at: row.try_get("manual_stage_at")?,
                        last_contacted_at: row.try_get("last_contacted_at")?,
                        queued_at: row.try_get("queued_at")?,
                        queued_from: row.try_get("queued_from")?,
                        wants_call_at: row.try_get("wants_call_at")?,
                        last_outcome_at: row.try_get("last_outcome_at")?,
                        last_outcome_state: row.try_get("last_outcome_state")?,
                        last_outcome_code: row.try_get("last_outcome_code")?,
                    },
                ))
            })
            .collect()
    }

    /// Set a contact's stage and/or label. `stage` is `Some((stage, by, at))` to set it;
    /// `label` is `Some(Some(text))` to set, `Some(None)` to clear, `None` to leave alone.
    /// Returns `false` when the contact does not exist.
    pub async fn whatsapp_set_contact_desk(
        &self,
        community: CommunityId,
        wa_id: &str,
        stage: Option<(&str, &[u8], DateTime<Utc>)>,
        label: Option<Option<&str>>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET \
                 manual_stage = CASE WHEN $3 THEN $4 ELSE manual_stage END, \
                 manual_stage_by = CASE WHEN $3 THEN $5 ELSE manual_stage_by END, \
                 manual_stage_at = CASE WHEN $3 THEN $6 ELSE manual_stage_at END, \
                 label = CASE WHEN $7 THEN $8 ELSE label END, \
                 updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(stage.is_some())
        .bind(stage.map(|(name, _, _)| name))
        .bind(stage.map(|(_, by, _)| by))
        .bind(stage.map(|(_, _, at)| at))
        .bind(label.is_some())
        .bind(label.flatten())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record what an inbound message means (`wants_call`). Safe to repeat.
    pub async fn whatsapp_set_message_intent(
        &self,
        community: CommunityId,
        message_id: Uuid,
        intent: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET intent = $3 \
             WHERE community_id = $1 AND id = $2 AND direction = 'in'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(intent)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Give a contact a name only when it has none, so a name from a batch row never
    /// overwrites the profile name WhatsApp reported.
    pub async fn whatsapp_set_name_if_blank(
        &self,
        community: CommunityId,
        wa_id: &str,
        name: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_contacts SET display_name = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND display_name = ''",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(name.chars().take(200).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One contact.
    pub async fn whatsapp_get_contact(
        &self,
        community: CommunityId,
        wa_id: &str,
    ) -> Result<Option<WhatsappContact>> {
        let row = sqlx::query(
            "SELECT wa_id, display_name, lead_id, owner_pubkey, thread_root_event_id, \
                    last_inbound_at, last_outbound_at, outbound_since_inbound, opted_out_at, \
                    opt_out_reason, paused_at, pause_reason, retry_after, created_at \
             FROM whatsapp_contacts WHERE community_id = $1 AND wa_id = $2",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_contact).transpose()
    }

    /// Every contact of the company, oldest first, for the customer records.
    pub async fn whatsapp_contacts_bulk(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappContact>> {
        let rows = sqlx::query(
            "SELECT wa_id, display_name, lead_id, owner_pubkey, thread_root_event_id, \
                    last_inbound_at, last_outbound_at, outbound_since_inbound, opted_out_at, \
                    opt_out_reason, paused_at, pause_reason, retry_after, created_at \
             FROM whatsapp_contacts WHERE community_id = $1 \
             ORDER BY created_at, wa_id LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 100_000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_contact).collect()
    }

    /// Every message of the company that is part of a chat (not dropped, not a
    /// draft, rejected or skipped), oldest first, for the customer records.
    pub async fn whatsapp_messages_bulk(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND state NOT IN ('dropped', 'draft', 'rejected', 'skipped') \
             ORDER BY created_at, id LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 500_000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Every decided batch header of the company, for the customer records.
    pub async fn whatsapp_batches_bulk(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappBatch>> {
        let rows = sqlx::query(
            "SELECT id, created_by, template_name, language, status, note, material_links, \
                    decided_by, decided_at, created_at \
             FROM whatsapp_batches WHERE community_id = $1 \
             ORDER BY created_at, id LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 100_000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_batch).collect()
    }

    /// Contact whose thread root is `root_event_id`.
    pub async fn whatsapp_get_contact_by_thread(
        &self,
        community: CommunityId,
        root_event_id: &[u8],
    ) -> Result<Option<WhatsappContact>> {
        let row = sqlx::query(
            "SELECT wa_id, display_name, lead_id, owner_pubkey, thread_root_event_id, \
                    last_inbound_at, last_outbound_at, outbound_since_inbound, opted_out_at, \
                    opt_out_reason, paused_at, pause_reason, retry_after, created_at \
             FROM whatsapp_contacts WHERE community_id = $1 AND thread_root_event_id = $2",
        )
        .bind(community.as_uuid())
        .bind(root_event_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_contact).transpose()
    }

    /// Record an inbound message time and reset the one-message-in-a-row counter. Only a
    /// message newer than the last one counts, so a redelivered old message changes nothing.
    pub async fn whatsapp_touch_inbound(
        &self,
        community: CommunityId,
        wa_id: &str,
        at: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_contacts SET last_inbound_at = $3, \
                 outbound_since_inbound = 0, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 \
               AND (last_inbound_at IS NULL OR last_inbound_at < $3)",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Remember the contact's single thread root (first writer wins). `true` when this call
    /// recorded it, `false` when a racing first post had already won.
    pub async fn whatsapp_set_thread_root(
        &self,
        community: CommunityId,
        wa_id: &str,
        root_event_id: &[u8],
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET thread_root_event_id = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND thread_root_event_id IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(root_event_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Assign the owning agent when the contact has none yet.
    pub async fn whatsapp_set_owner_if_unowned(
        &self,
        community: CommunityId,
        wa_id: &str,
        owner: &[u8],
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_contacts SET owner_pubkey = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND owner_pubkey IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(owner)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Return a bounded page of unlinked contacts whose durable lookup retry is due.
    pub async fn whatsapp_list_contacts_needing_lead_link(
        &self,
        community: CommunityId,
        retry_before: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<String>> {
        let rows = sqlx::query_scalar(
            "SELECT wa_id FROM whatsapp_contacts \
             WHERE community_id = $1 AND lead_id IS NULL \
               AND (lead_link_checked_at IS NULL OR lead_link_checked_at <= $2) \
             ORDER BY lead_link_checked_at NULLS FIRST, created_at, wa_id LIMIT $3",
        )
        .bind(community.as_uuid())
        .bind(retry_before)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Record that an unlinked contact was checked, so no-match and ambiguous rows retry on a
    /// bounded durable schedule rather than starving later contacts after a restart.
    pub async fn whatsapp_mark_lead_link_checked(
        &self,
        community: CommunityId,
        wa_id: &str,
        checked_at: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET lead_link_checked_at = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND lead_id IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(checked_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Tag a previously unlinked contact with the lead it matches. First writer wins so a
    /// concurrent exact lookup or an existing batch association can never be overwritten.
    pub async fn whatsapp_set_lead(
        &self,
        community: CommunityId,
        wa_id: &str,
        lead_id: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET lead_id = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND lead_id IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(lead_id.chars().take(128).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Mark a contact opted out. Returns `true` when this call changed it.
    pub async fn whatsapp_opt_out(
        &self,
        community: CommunityId,
        wa_id: &str,
        reason: &str,
        at: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET opted_out_at = $3, opt_out_reason = $4, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND opted_out_at IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(at)
        .bind(reason.chars().take(200).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Persist every safety consequence of one inbound reply in a transaction. An opt-out keeps
    /// the legacy contact projection for installed desktop clients and also records the exact
    /// matched rule in the append-only suppression ledger. Any linked reply stops every current
    /// and future contact of that business before another outbound lease can be claimed.
    #[allow(clippy::too_many_arguments)]
    pub async fn whatsapp_record_inbound_safety(
        &self,
        community: CommunityId,
        wa_id: &str,
        lead_id: Option<&str>,
        at: DateTime<Utc>,
        opt_out_reason: Option<&str>,
        matched_rule: Option<&str>,
    ) -> Result<InboundSafetyOutcome> {
        let mut tx = begin(&self.pool).await?;
        // A lead link is first-writer-wins, matching the previous inbound path. The same
        // transaction then reads the actual link that fences every number of the business.
        if let Some(lead_id) = lead_id {
            sqlx::query(
                "UPDATE whatsapp_contacts SET lead_id = COALESCE(lead_id, $3), updated_at = now() \
                 WHERE community_id = $1 AND wa_id = $2",
            )
            .bind(community.as_uuid())
            .bind(wa_id)
            .bind(lead_id.chars().take(128).collect::<String>())
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "UPDATE whatsapp_contacts SET last_inbound_at = $3, outbound_since_inbound = 0, \
                 updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 \
               AND (last_inbound_at IS NULL OR last_inbound_at < $3)",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(at)
        .execute(&mut *tx)
        .await?;

        let business_id: Option<String> = sqlx::query_scalar(
            "SELECT lead_id FROM whatsapp_contacts WHERE community_id = $1 AND wa_id = $2 \
             FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();

        let mut outcome = InboundSafetyOutcome::default();
        if let Some(reason) = opt_out_reason {
            let opted_out = sqlx::query(
                "UPDATE whatsapp_contacts SET opted_out_at = $3, opt_out_reason = $4, \
                     updated_at = now() \
                 WHERE community_id = $1 AND wa_id = $2 AND opted_out_at IS NULL",
            )
            .bind(community.as_uuid())
            .bind(wa_id)
            .bind(at)
            .bind(reason.chars().take(200).collect::<String>())
            .execute(&mut *tx)
            .await?;
            outcome.opted_out_now = opted_out.rows_affected() == 1;
            sqlx::query(
                "INSERT INTO whatsapp_suppressions \
                 (community_id, id, identity_kind, identity_value, scope, reason, matched_rule, source) \
                 VALUES ($1, $2, 'phone', $3, 'opt_out', $4, $5, 'inbound') \
                 ON CONFLICT DO NOTHING",
            )
            .bind(community.as_uuid())
            .bind(Uuid::new_v4())
            .bind(wa_id)
            .bind(reason.chars().take(500).collect::<String>())
            .bind(matched_rule.map(|rule| rule.chars().take(120).collect::<String>()))
            .execute(&mut *tx)
            .await?;
            // Rows already queued for this number are not left waiting for a later sender
            // tick. The claim predicate below is the concurrent-race fence.
            sqlx::query(
                "UPDATE whatsapp_messages SET state = 'skipped', skip_reason = $3, updated_at = now() \
                 WHERE community_id = $1 AND wa_id = $2 AND direction = 'out' \
                   AND state IN ('queued', 'ready')",
            )
            .bind(community.as_uuid())
            .bind(wa_id)
            .bind("contact opted out")
            .execute(&mut *tx)
            .await?;
        }

        if let Some(business_id) = business_id.as_deref() {
            let reason = if opt_out_reason.is_some() {
                "contact opted out"
            } else {
                "inbound reply received"
            };
            let inserted = sqlx::query(
                "INSERT INTO whatsapp_business_stops \
                 (community_id, business_id, source_wa_id, reason, matched_rule) \
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            )
            .bind(community.as_uuid())
            .bind(business_id)
            .bind(wa_id)
            .bind(reason)
            .bind(matched_rule.map(|rule| rule.chars().take(120).collect::<String>()))
            .execute(&mut *tx)
            .await?;
            outcome.business_stopped_now = inserted.rows_affected() == 1;
            sqlx::query(
                "UPDATE whatsapp_messages m SET state = 'skipped', \
                     skip_reason = 'outreach stopped for the whole business', updated_at = now() \
                 FROM whatsapp_contacts c \
                 WHERE m.community_id = $1 AND c.community_id = m.community_id \
                   AND c.wa_id = m.wa_id AND c.lead_id = $2 AND m.direction = 'out' \
                   AND m.state IN ('queued', 'ready')",
            )
            .bind(community.as_uuid())
            .bind(business_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(outcome)
    }

    /// Add an owner-maintained never-contact phone entry. `false` means the same active entry
    /// already exists, so retries do not create a second decision.
    pub async fn whatsapp_add_never_contact(
        &self,
        community: CommunityId,
        wa_id: &str,
        reason: &str,
        created_by: &[u8],
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let inserted = sqlx::query(
            "INSERT INTO whatsapp_suppressions \
             (community_id, id, identity_kind, identity_value, scope, reason, source, created_by) \
             VALUES ($1, $2, 'phone', $3, 'never_contact', $4, 'owner', $5) \
             ON CONFLICT DO NOTHING",
        )
        .bind(community.as_uuid())
        .bind(Uuid::new_v4())
        .bind(wa_id)
        .bind(reason.chars().take(500).collect::<String>())
        .bind(created_by)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            sqlx::query(
                "UPDATE whatsapp_messages SET state = 'skipped', skip_reason = $3, updated_at = now() \
                 WHERE community_id = $1 AND wa_id = $2 AND direction = 'out' \
                   AND state IN ('queued', 'ready')",
            )
            .bind(community.as_uuid())
            .bind(wa_id)
            .bind("never-contact entry")
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(inserted.rows_affected() == 1)
    }

    /// Undo one active phone-safety decision while retaining its full history. Undoing an
    /// opt-out clears the legacy contact projection as well; a business reply stop remains a
    /// separate conservative hold until a later product decision provides an override.
    pub async fn whatsapp_undo_suppression(
        &self,
        community: CommunityId,
        wa_id: &str,
        scope: &str,
        undone_by: &[u8],
        at: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let undone = sqlx::query(
            "UPDATE whatsapp_suppressions SET undone_at = $5, undone_by = $4, \
                 undo_reason = 'owner undo' \
             WHERE community_id = $1 AND identity_kind = 'phone' AND identity_value = $2 \
               AND scope = $3 AND undone_at IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(scope)
        .bind(undone_by)
        .bind(at)
        .execute(&mut *tx)
        .await?;
        if undone.rows_affected() == 1 && scope == "opt_out" {
            sqlx::query(
                "UPDATE whatsapp_contacts SET opted_out_at = NULL, opt_out_reason = NULL, \
                     updated_at = now() WHERE community_id = $1 AND wa_id = $2",
            )
            .bind(community.as_uuid())
            .bind(wa_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(undone.rows_affected() == 1)
    }

    /// Return the active direct or business-scoped send fence for a recipient. Direct consent
    /// fences sort before a business hold so a specific opt-out reason stays explainable.
    pub async fn whatsapp_send_safety(
        &self,
        community: CommunityId,
        wa_id: &str,
        lead_id: Option<&str>,
    ) -> Result<Option<WhatsappSendSafety>> {
        let row = sqlx::query(
            "SELECT scope, reason, matched_rule, business_id FROM ( \
                 SELECT s.scope, s.reason, s.matched_rule, NULL::text AS business_id, 0 AS priority \
                 FROM whatsapp_suppressions s \
                 WHERE s.community_id = $1 AND s.identity_kind = 'phone' \
                   AND s.identity_value = $2 AND s.undone_at IS NULL \
                 UNION ALL \
                 SELECT 'business_stop', b.reason, b.matched_rule, b.business_id, 1 AS priority \
                 FROM whatsapp_business_stops b \
                 WHERE b.community_id = $1 AND b.business_id = $3::text \
             ) safety ORDER BY priority LIMIT 1",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(lead_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(WhatsappSendSafety {
                scope: row.try_get("scope")?,
                reason: row.try_get("reason")?,
                matched_rule: row.try_get("matched_rule")?,
                business_id: row.try_get("business_id")?,
            })
        })
        .transpose()
    }

    /// Active phone decisions for settings and discovery/list preflight. Historical rows stay
    /// in the ledger but are deliberately absent here.
    pub async fn whatsapp_list_active_suppressions(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappSuppression>> {
        let rows = sqlx::query(
            "SELECT id, identity_kind, identity_value, scope, reason, matched_rule, source, \
                    created_at, undone_at FROM whatsapp_suppressions \
             WHERE community_id = $1 AND undone_at IS NULL \
             ORDER BY created_at DESC, id DESC LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 1_000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_suppression).collect()
    }

    /// Active whole-business reply stops for the owner safety ledger.
    pub async fn whatsapp_list_business_stops(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappBusinessStop>> {
        let rows = sqlx::query(
            "SELECT business_id, source_wa_id, reason, matched_rule, created_at \
             FROM whatsapp_business_stops WHERE community_id = $1 \
             ORDER BY created_at DESC, business_id DESC LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 1_000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_business_stop).collect()
    }

    /// Whole-business holds keyed by the contact number they fence. This bulk projection keeps
    /// contact and thread reads additive while avoiding one query per contact row.
    pub async fn whatsapp_business_stops_for_contacts(
        &self,
        community: CommunityId,
        wa_ids: &[String],
    ) -> Result<std::collections::HashMap<String, WhatsappBusinessStop>> {
        if wa_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let rows = sqlx::query(
            "SELECT c.wa_id, b.business_id, b.source_wa_id, b.reason, b.matched_rule, \
                    b.created_at \
             FROM whatsapp_contacts c JOIN whatsapp_business_stops b \
               ON b.community_id = c.community_id AND b.business_id = c.lead_id \
             WHERE c.community_id = $1 AND c.wa_id = ANY($2)",
        )
        .bind(community.as_uuid())
        .bind(wa_ids)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| Ok((row.try_get("wa_id")?, row_to_business_stop(row)?)))
            .collect()
    }

    /// Return active decisions that match the caller-provided identities. This intentionally
    /// returns the durable rows rather than a boolean so owner settings can show the same
    /// reason and audit rule as the send fence. Callers that are not allowed to read those
    /// details should project only their own matched input values.
    pub async fn whatsapp_match_active_suppressions(
        &self,
        community: CommunityId,
        identities: &[(String, String)],
    ) -> Result<Vec<WhatsappSuppression>> {
        if identities.is_empty() {
            return Ok(Vec::new());
        }
        let kinds: Vec<&str> = identities.iter().map(|(kind, _)| kind.as_str()).collect();
        let values: Vec<&str> = identities.iter().map(|(_, value)| value.as_str()).collect();
        let rows = sqlx::query(
            "SELECT DISTINCT ON (s.id) s.id, s.identity_kind, s.identity_value, s.scope, \
                    s.reason, s.matched_rule, s.source, s.created_at, s.undone_at \
             FROM whatsapp_suppressions s \
             JOIN unnest($2::text[], $3::text[]) AS requested(identity_kind, identity_value) \
               ON requested.identity_kind = s.identity_kind \
              AND requested.identity_value = s.identity_value \
             WHERE s.community_id = $1 AND s.undone_at IS NULL \
             ORDER BY s.id, s.created_at DESC",
        )
        .bind(community.as_uuid())
        .bind(kinds)
        .bind(values)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_suppression).collect()
    }

    /// Pause a contact after a Meta block or spam error. Returns `true` when newly paused.
    pub async fn whatsapp_pause_contact(
        &self,
        community: CommunityId,
        wa_id: &str,
        reason: &str,
        at: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_contacts SET paused_at = $3, pause_reason = $4, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2 AND paused_at IS NULL",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(at)
        .bind(reason.chars().take(200).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Most recently active contacts.
    pub async fn whatsapp_list_contacts(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappContact>> {
        let rows = sqlx::query(
            "SELECT wa_id, display_name, lead_id, owner_pubkey, thread_root_event_id, \
                    last_inbound_at, last_outbound_at, outbound_since_inbound, opted_out_at, \
                    opt_out_reason, paused_at, pause_reason, retry_after, created_at \
             FROM whatsapp_contacts WHERE community_id = $1 \
             ORDER BY GREATEST(last_inbound_at, last_outbound_at, created_at) DESC \
             LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_contact).collect()
    }

    /// Contacts whose latest inbound message has no reply yet.
    pub async fn whatsapp_list_inbox(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappContact>> {
        let rows = sqlx::query(
            "SELECT wa_id, display_name, lead_id, owner_pubkey, thread_root_event_id, \
                    last_inbound_at, last_outbound_at, outbound_since_inbound, opted_out_at, \
                    opt_out_reason, paused_at, pause_reason, retry_after, created_at \
             FROM whatsapp_contacts \
             WHERE community_id = $1 AND last_inbound_at IS NOT NULL AND opted_out_at IS NULL \
               AND (last_outbound_at IS NULL OR last_outbound_at < last_inbound_at) \
             ORDER BY last_inbound_at DESC LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_contact).collect()
    }

    // ── numbers (co-founder scorecard) ─────────────────────────────────────────

    /// Send times of the first message of every new chat sent at or after `since`.
    /// Only messages the provider accepted count (`sent`, `delivered`, `read`).
    pub async fn whatsapp_numbers_chats_started(
        &self,
        community: CommunityId,
        since: DateTime<Utc>,
    ) -> Result<Vec<DateTime<Utc>>> {
        let rows = sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT sent_at FROM whatsapp_messages \
             WHERE community_id = $1 AND direction = 'out' AND new_chat \
               AND sent_at IS NOT NULL AND state IN ('sent', 'delivered', 'read') \
               AND sent_at >= $2 \
             ORDER BY sent_at LIMIT 100000",
        )
        .bind(community.as_uuid())
        .bind(since)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// For every contact we opened a new chat with, the time of their first
    /// inbound message after that chat started, when it is at or after `since`.
    pub async fn whatsapp_numbers_first_replies(
        &self,
        community: CommunityId,
        since: DateTime<Utc>,
    ) -> Result<Vec<DateTime<Utc>>> {
        let rows = sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT MIN(i.created_at) \
             FROM whatsapp_messages i \
             JOIN ( \
                 SELECT wa_id, MIN(sent_at) AS first_out FROM whatsapp_messages \
                 WHERE community_id = $1 AND direction = 'out' AND new_chat \
                   AND sent_at IS NOT NULL \
                 GROUP BY wa_id \
             ) o ON o.wa_id = i.wa_id \
             WHERE i.community_id = $1 AND i.direction = 'in' AND i.created_at > o.first_out \
             GROUP BY i.wa_id \
             HAVING MIN(i.created_at) >= $2 \
             ORDER BY MIN(i.created_at) LIMIT 100000",
        )
        .bind(community.as_uuid())
        .bind(since)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    // ── messages ───────────────────────────────────────────────────────────────

    /// Store an inbound message. `None` means the WhatsApp message id was already stored.
    pub async fn whatsapp_insert_inbound(
        &self,
        community: CommunityId,
        wa_id: &str,
        kind: &str,
        body: &str,
        wamid: &str,
        at: DateTime<Utc>,
    ) -> Result<Option<Uuid>> {
        let id = Uuid::new_v4();
        let result = sqlx::query(
            "INSERT INTO whatsapp_messages \
             (community_id, id, wa_id, direction, kind, body, state, wamid, created_at) \
             VALUES ($1, $2, $3, 'in', $4, $5, 'received', $6, $7) \
             ON CONFLICT (community_id, wamid) DO NOTHING",
        )
        .bind(community.as_uuid())
        .bind(id)
        .bind(wa_id)
        .bind(kind)
        .bind(body.chars().take(8000).collect::<String>())
        .bind(wamid)
        .bind(at)
        .execute(&self.pool)
        .await?;
        Ok((result.rows_affected() == 1).then_some(id))
    }

    // ── inbound media ──────────────────────────────────────────────────────────

    /// Remember what the webhook said about a message's media. Only the first call per message
    /// writes (a redelivery repeats it harmlessly). `state` is `pending` when there are bytes
    /// to download, `failed` (with `error`) when the payload gave no usable media id, `None`
    /// for a location or contact card.
    pub async fn whatsapp_set_inbound_media(
        &self,
        community: CommunityId,
        message_id: Uuid,
        media: &Value,
        state: Option<&str>,
        error: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET media = $3, media_state = $4, media_error = $5, \
                 media_retry_at = CASE WHEN $4 = 'pending' THEN $6::timestamptz END, \
                 updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media IS NULL",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(media)
        .bind(state)
        .bind(error)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Take the right to download one pending file for `lease_secs`, so two relays (or the
    /// webhook and the sender loop) never fetch the same file at once. A crashed holder is
    /// retried after the lease runs out.
    pub async fn whatsapp_media_claim(
        &self,
        community: CommunityId,
        message_id: Uuid,
        now: DateTime<Utc>,
        lease_secs: f64,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages \
             SET media_retry_at = $3::timestamptz + make_interval(secs => $4) \
             WHERE community_id = $1 AND id = $2 AND media_state = 'pending' \
               AND (media_retry_at IS NULL OR media_retry_at <= $3)",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(now)
        .bind(lease_secs)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// The media record of one message, if it has any.
    pub async fn whatsapp_get_media(
        &self,
        community: CommunityId,
        message_id: Uuid,
    ) -> Result<Option<WhatsappMedia>> {
        let row = sqlx::query(media_select!(
            "WHERE community_id = $1 AND id = $2 AND media IS NOT NULL"
        ))
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_media).transpose()
    }

    /// The media records of several messages (one thread), by message id.
    pub async fn whatsapp_media_for_messages(
        &self,
        community: CommunityId,
        message_ids: &[Uuid],
    ) -> Result<std::collections::HashMap<Uuid, WhatsappMedia>> {
        if message_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let rows = sqlx::query(media_select!(
            "WHERE community_id = $1 AND id = ANY($2) AND media IS NOT NULL"
        ))
        .bind(community.as_uuid())
        .bind(message_ids)
        .fetch_all(&self.pool)
        .await?;
        let mut out = std::collections::HashMap::new();
        for row in &rows {
            let media = row_to_media(row)?;
            out.insert(media.message_id, media);
        }
        Ok(out)
    }

    /// Downloads that are due: pending and past their retry time, oldest first.
    pub async fn whatsapp_media_list_due(
        &self,
        community: CommunityId,
        limit: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<WhatsappMedia>> {
        let rows = sqlx::query(media_select!(
            "WHERE community_id = $1 AND media_state = 'pending' \
               AND (media_retry_at IS NULL OR media_retry_at <= $3) \
             ORDER BY created_at LIMIT $2"
        ))
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 50))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_media).collect()
    }

    /// Record a finished download. Only a row still waiting for it changes.
    pub async fn whatsapp_media_set_stored(
        &self,
        community: CommunityId,
        message_id: Uuid,
        stored: &Value,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET media_state = 'stored', media_stored = $3, \
                 media_error = NULL, media_retry_at = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media_state IN ('pending', 'failed')",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(stored)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record a download that will not be tried again by itself (`failed`, the owner may retry,
    /// or `gone`, Meta no longer has the file).
    pub async fn whatsapp_media_set_final_failure(
        &self,
        community: CommunityId,
        message_id: Uuid,
        state: &str,
        error: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET media_state = $3, media_error = $4, \
                 media_attempts = media_attempts + 1, media_retry_at = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media_state = 'pending'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(state)
        .bind(error.chars().take(200).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Record a failed download that may work later: 30 s doubling to a cap of 1 h. After
    /// [`MEDIA_MAX_ATTEMPTS`] failures the row becomes `failed` and waits for the owner's
    /// Retry. Returns the attempt count and whether the row gave up.
    pub async fn whatsapp_media_note_failure(
        &self,
        community: CommunityId,
        message_id: Uuid,
        now: DateTime<Utc>,
        error: &str,
    ) -> Result<(i32, bool)> {
        let row = sqlx::query(
            "UPDATE whatsapp_messages SET media_attempts = media_attempts + 1, \
                 media_error = $4, \
                 media_retry_at = $3::timestamptz + LEAST(interval '1 hour', \
                     interval '30 seconds' * power(2, LEAST(media_attempts, 11))), \
                 media_state = CASE WHEN media_attempts + 1 >= $5 THEN 'failed' ELSE 'pending' END, \
                 updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media_state = 'pending' \
             RETURNING media_attempts, media_state = 'failed'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(now)
        .bind(error.chars().take(200).collect::<String>())
        .bind(MEDIA_MAX_ATTEMPTS)
        .fetch_optional(&self.pool)
        .await?;
        Ok(match row {
            Some(row) => (row.try_get(0)?, row.try_get(1)?),
            None => (0, false),
        })
    }

    /// The owner pressed Retry on a download that gave up. Only `failed` rows restart.
    pub async fn whatsapp_media_reset(
        &self,
        community: CommunityId,
        message_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET media_state = 'pending', media_attempts = 0, \
                 media_error = NULL, media_retry_at = $3, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media_state = 'failed' \
               AND media_error IS DISTINCT FROM 'too_large'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// The Colony message event carries the media link now.
    pub async fn whatsapp_media_mark_linked(
        &self,
        community: CommunityId,
        message_id: Uuid,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET media_linked = true, updated_at = now() \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Stored media whose message was posted before the download finished, so no event
    /// carries the link yet. The repair loop adds one follow-up message for each.
    pub async fn whatsapp_media_list_unlinked(
        &self,
        community: CommunityId,
        limit: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<WhatsappMedia>> {
        let rows = sqlx::query(media_select!(
            "WHERE community_id = $1 AND media_state = 'stored' AND NOT media_linked \
               AND event_id IS NOT NULL AND media_attempts < $4 \
               AND (media_retry_at IS NULL OR media_retry_at <= $3) \
             ORDER BY created_at LIMIT $2"
        ))
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 50))
        .bind(now)
        .bind(MEDIA_LINK_MAX_ATTEMPTS)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_media).collect()
    }

    /// A follow-up post failed: back off before the next try (30 s doubling to 1 h).
    pub async fn whatsapp_media_note_link_failure(
        &self,
        community: CommunityId,
        message_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET media_attempts = media_attempts + 1, \
                 media_retry_at = $3::timestamptz + LEAST(interval '1 hour', \
                     interval '30 seconds' * power(2, LEAST(media_attempts, 11))), \
                 updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND media_state = 'stored'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Attach the Colony message event to a stored message.
    pub async fn whatsapp_set_message_event(
        &self,
        community: CommunityId,
        message_id: Uuid,
        event_id: &[u8],
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_messages SET event_id = $3, updated_at = now() \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(event_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Record a failed Colony post of a stored message and schedule its next try: 5 s doubling
    /// to a cap of 1 h. After [`POST_MAX_ATTEMPTS`] failures the row stops being retried.
    /// Returns the attempt count and whether the row gave up.
    pub async fn whatsapp_note_post_failure(
        &self,
        community: CommunityId,
        message_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<(i32, bool)> {
        let row = sqlx::query(
            "UPDATE whatsapp_messages SET post_attempts = post_attempts + 1, \
                 post_retry_at = $3::timestamptz + LEAST(interval '1 hour', \
                     interval '5 seconds' * power(2, LEAST(post_attempts, 11))), \
                 post_gave_up_at = CASE WHEN post_attempts + 1 >= $4 THEN $3::timestamptz END \
             WHERE community_id = $1 AND id = $2 AND event_id IS NULL \
             RETURNING post_attempts, post_gave_up_at IS NOT NULL",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(now)
        .bind(POST_MAX_ATTEMPTS)
        .fetch_optional(&self.pool)
        .await?;
        Ok(match row {
            Some(row) => (row.try_get(0)?, row.try_get(1)?),
            None => (0, false),
        })
    }

    /// Store one outbound message. `None` means the idempotency key was already used.
    pub async fn whatsapp_insert_outbound(
        &self,
        community: CommunityId,
        message: &NewOutboundMessage,
    ) -> Result<Option<Uuid>> {
        let result = sqlx::query(
            "INSERT INTO whatsapp_messages \
             (community_id, id, wa_id, direction, kind, body, template_name, template_language, \
              params, state, idempotency_key, batch_id, batch_idx, new_chat, sender_pubkey) \
             VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) \
             ON CONFLICT (community_id, idempotency_key) DO NOTHING",
        )
        .bind(community.as_uuid())
        .bind(message.id)
        .bind(&message.wa_id)
        .bind(&message.kind)
        .bind(&message.body)
        .bind(&message.template_name)
        .bind(&message.template_language)
        .bind(&message.params)
        .bind(&message.state)
        .bind(&message.idempotency_key)
        .bind(message.batch_id)
        .bind(message.batch_idx)
        .bind(message.new_chat)
        .bind(&message.sender_pubkey)
        .execute(&self.pool)
        .await?;
        Ok((result.rows_affected() == 1).then_some(message.id))
    }

    /// One message.
    pub async fn whatsapp_get_message(
        &self,
        community: CommunityId,
        message_id: Uuid,
    ) -> Result<Option<WhatsappMessage>> {
        let row = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_message).transpose()
    }

    /// Messages of one contact, newest first.
    pub async fn whatsapp_list_thread(
        &self,
        community: CommunityId,
        wa_id: &str,
        limit: i64,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND wa_id = $2 AND state <> 'dropped' \
             ORDER BY created_at DESC, id LIMIT $3",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Outbound messages waiting to be sent, singles first then batch rows in batch order.
    ///
    /// `send_after` is the owner's existing Send now marker, not a generic eligibility clock.
    /// A delayed per-contact retry stays `failed` until its deadline releases it, so filtering
    /// ready work by this field would silently strand an owner-released batch.
    pub async fn whatsapp_list_sendable(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT m.id, m.wa_id, m.direction, m.kind, m.body, m.template_name, \
                    m.template_language, m.params, m.state, m.skip_reason, m.wamid, \
                    m.error_code, m.error_text, m.event_id, m.batch_id, m.batch_idx, \
                    m.new_chat, m.send_after, m.sender_pubkey, m.sent_at, m.created_at \
             FROM whatsapp_messages m \
             WHERE m.community_id = $1 AND m.state IN ('queued', 'ready') \
             ORDER BY (m.state = 'queued') DESC, (m.send_after IS NOT NULL) DESC, \
                      m.created_at, m.batch_idx NULLS FIRST, m.id \
             LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Lease one sendable message before the Graph call. `false` means someone else took it.
    pub async fn whatsapp_claim_message(
        &self,
        community: CommunityId,
        message_id: Uuid,
        lease_token: Uuid,
        lease_until: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages AS m SET state = 'sending', lease_token = $3, lease_until = $4, \
                 sent_at = $5, updated_at = now() \
             WHERE m.community_id = $1 AND m.id = $2 AND m.state IN ('queued', 'ready') \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_settings s \
                   WHERE s.community_id = m.community_id \
                     AND s.send_paused \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               )",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(lease_token)
        .bind(lease_until)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record the Graph acceptance and update the contact, in one transaction.
    pub async fn whatsapp_complete_send(
        &self,
        community: CommunityId,
        message: &WhatsappMessage,
        lease_token: Uuid,
        wamid: &str,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'sent', wamid = $4, lease_token = NULL, \
                 lease_until = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $3",
        )
        .bind(community.as_uuid())
        .bind(message.id)
        .bind(lease_token)
        .bind(wamid)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Ok(false);
        }
        sqlx::query(
            "UPDATE whatsapp_contacts SET last_outbound_at = $3, \
                 outbound_since_inbound = outbound_since_inbound + 1, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2",
        )
        .bind(community.as_uuid())
        .bind(&message.wa_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        // A resumed account health incident is cleared only after Meta accepts a new send.
        // The health record stays visible while a resume request is still waiting in the queue.
        sqlx::query(
            "UPDATE whatsapp_settings SET account_health_code = NULL, account_health_text = NULL, \
                 account_health_at = NULL, account_health_resume_requested_at = NULL, \
                 updated_at = now() \
             WHERE community_id = $1 AND NOT system_paused \
               AND account_health_resume_requested_at IS NOT NULL",
        )
        .bind(community.as_uuid())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    /// Record a definite refusal from Graph. Nothing was sent.
    pub async fn whatsapp_fail_send(
        &self,
        community: CommunityId,
        message_id: Uuid,
        lease_token: Uuid,
        error_code: &str,
        error_text: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'failed', error_code = $4, error_text = $5, \
                 lease_token = NULL, lease_until = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $3",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(lease_token)
        .bind(error_code.chars().take(64).collect::<String>())
        .bind(error_text.chars().take(500).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record a definite account-wide refusal and close the sender fence atomically. The message
    /// that reached Graph is failed, but all untouched `ready` rows remain ready. The claim
    /// predicate also reads this fence, so concurrent sender workers cannot burn through them.
    pub async fn whatsapp_fail_send_and_pause_account(
        &self,
        community: CommunityId,
        failure: &WhatsappAccountFailure<'_>,
    ) -> Result<AccountFailureOutcome> {
        let mut tx = begin(&self.pool).await?;
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'failed', error_code = $4, error_text = $5, \
                 lease_token = NULL, lease_until = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $3",
        )
        .bind(community.as_uuid())
        .bind(failure.message_id)
        .bind(failure.lease_token)
        .bind(failure.error_code.chars().take(64).collect::<String>())
        .bind(failure.error_text.chars().take(500).collect::<String>())
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.commit().await?;
            return Ok(AccountFailureOutcome::default());
        }
        let became_unhealthy = mark_account_unhealthy_in(
            &mut tx,
            community,
            failure.error_code,
            failure.error_text,
            failure.pause_reason,
            failure.at,
        )
        .await?;
        tx.commit().await?;
        Ok(AccountFailureOutcome {
            failed: true,
            became_unhealthy,
        })
    }

    /// Count definite account-level failures that an owner can safely put back into the normal
    /// queue. A contact that has opted out or is paused since its failed attempt is deliberately
    /// excluded, even when the old Graph error was account-wide.
    pub async fn whatsapp_count_retryable_account_failures(
        &self,
        community: CommunityId,
        error_codes: &[String],
    ) -> Result<i64> {
        if error_codes.is_empty() {
            return Ok(0);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages m \
             WHERE m.community_id = $1 AND m.direction = 'out' AND m.state = 'failed' \
               AND m.error_code = ANY($2) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               )",
        )
        .bind(community.as_uuid())
        .bind(error_codes)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Messages that are waiting behind an automatic account-health pause. This includes both
    /// the one-or-more account failures that need requeueing and untouched ready rows, while
    /// excluding contacts that have subsequently opted out or were paused for their own reason.
    pub async fn whatsapp_count_account_health_waiting(
        &self,
        community: CommunityId,
        error_codes: &[String],
    ) -> Result<i64> {
        if error_codes.is_empty() {
            return Ok(0);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages m \
             WHERE m.community_id = $1 AND m.direction = 'out' \
               AND (m.state IN ('queued', 'ready') \
                    OR (m.state = 'failed' AND m.error_code = ANY($2))) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               )",
        )
        .bind(community.as_uuid())
        .bind(error_codes)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Put every eligible account-level refusal back into its original queue shape. This updates
    /// the existing rows only: their ids, batch indexes and idempotency keys remain untouched.
    /// Clearing `send_after` makes a retry go through ordinary pacing and the daily cap rather
    /// than replaying an earlier owner-only send-now release.
    pub async fn whatsapp_retry_account_failures(
        &self,
        community: CommunityId,
        error_codes: &[String],
    ) -> Result<i64> {
        if error_codes.is_empty() {
            return Ok(0);
        }
        let mut tx = begin(&self.pool).await?;
        let rows = sqlx::query(
            "UPDATE whatsapp_messages m SET \
                 state = CASE WHEN m.batch_id IS NULL THEN 'queued' ELSE 'ready' END, \
                 lease_token = NULL, lease_until = NULL, sent_at = NULL, send_after = NULL, \
                 updated_at = now() \
             WHERE m.community_id = $1 AND m.direction = 'out' AND m.state = 'failed' \
               AND m.error_code = ANY($2) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               ) \
             RETURNING m.batch_id",
        )
        .bind(community.as_uuid())
        .bind(error_codes)
        .fetch_all(&mut *tx)
        .await?;
        let batch_ids = rows
            .iter()
            .filter_map(|row| row.try_get::<Option<Uuid>, _>("batch_id").ok().flatten())
            .collect::<Vec<_>>();
        if !batch_ids.is_empty() {
            sqlx::query(
                "UPDATE whatsapp_batches SET status = 'approved' \
                 WHERE community_id = $1 AND status = 'completed' AND id = ANY($2)",
            )
            .bind(community.as_uuid())
            .bind(&batch_ids)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(rows.len() as i64)
    }

    /// Resume an automatic account-health pause and requeue the eligible failed rows in the
    /// same transaction. The update only touches `failed` rows, so a repeat action cannot send
    /// a row twice and preserves its idempotency key, batch id and batch ordering.
    pub async fn whatsapp_resume_account_health_and_retry(
        &self,
        community: CommunityId,
        error_codes: &[String],
        now: DateTime<Utc>,
    ) -> Result<i64> {
        if error_codes.is_empty() {
            return Ok(0);
        }
        let mut tx = begin(&self.pool).await?;
        sqlx::query(
            "INSERT INTO whatsapp_settings (community_id) VALUES ($1) \
             ON CONFLICT (community_id) DO NOTHING",
        )
        .bind(community.as_uuid())
        .execute(&mut *tx)
        .await?;

        // Clear only the automatic account-health source. An owner or quality pause stays
        // active, and the health record remains visible until Meta accepts a subsequent send.
        sqlx::query(
            "UPDATE whatsapp_settings SET \
                 system_paused = FALSE, system_pause_reason = NULL, \
                 send_paused = owner_paused OR quality_paused, \
                 pause_reason = CASE \
                     WHEN owner_paused THEN $3 \
                     WHEN quality_paused THEN $4 \
                     ELSE NULL \
                 END, \
                 account_health_resume_requested_at = $2, updated_at = now() \
             WHERE community_id = $1 AND account_health_code IS NOT NULL",
        )
        .bind(community.as_uuid())
        .bind(now)
        .bind(OWNER_PAUSE_REASON)
        .bind(QUALITY_PAUSE_REASON)
        .execute(&mut *tx)
        .await?;

        let rows = sqlx::query(
            "UPDATE whatsapp_messages m SET \
                 state = CASE WHEN m.batch_id IS NULL THEN 'queued' ELSE 'ready' END, \
                 lease_token = NULL, lease_until = NULL, sent_at = NULL, send_after = NULL, \
                 updated_at = now() \
             WHERE m.community_id = $1 AND m.direction = 'out' AND m.state = 'failed' \
               AND m.error_code = ANY($2) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               ) \
             RETURNING m.batch_id",
        )
        .bind(community.as_uuid())
        .bind(error_codes)
        .fetch_all(&mut *tx)
        .await?;
        let batch_ids = rows
            .iter()
            .filter_map(|row| row.try_get::<Option<Uuid>, _>("batch_id").ok().flatten())
            .collect::<Vec<_>>();
        if !batch_ids.is_empty() {
            sqlx::query(
                "UPDATE whatsapp_batches SET status = 'approved' \
                 WHERE community_id = $1 AND status = 'completed' AND id = ANY($2)",
            )
            .bind(community.as_uuid())
            .bind(&batch_ids)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(rows.len() as i64)
    }

    /// Count the Meta engagement-limit failures separately so an owner can see a growing
    /// template or number-quality problem without treating it as an account-wide outage.
    pub async fn whatsapp_count_failed_messages_by_code(
        &self,
        community: CommunityId,
        error_code: &str,
    ) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages \
             WHERE community_id = $1 AND direction = 'out' AND state = 'failed' \
               AND error_code = $2",
        )
        .bind(community.as_uuid())
        .bind(error_code)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Requeue one definite temporary refusal. The exact failed-state and error-code predicates
    /// make repeated actions a no-op, and the existing row retains its idempotency key.
    pub async fn whatsapp_retry_failed_message(
        &self,
        community: CommunityId,
        wa_id: &str,
        message_id: Uuid,
        expected_error_code: &str,
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let row = sqlx::query(
            "UPDATE whatsapp_messages m SET \
                 state = CASE WHEN m.batch_id IS NULL THEN 'queued' ELSE 'ready' END, \
                 lease_token = NULL, lease_until = NULL, sent_at = NULL, send_after = NULL, \
                 updated_at = now() \
             WHERE m.community_id = $1 AND m.id = $2 AND m.wa_id = $3 \
               AND m.direction = 'out' AND m.state = 'failed' AND m.error_code = $4 \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
                     AND (c.opted_out_at IS NOT NULL OR c.paused_at IS NOT NULL) \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_suppressions s \
                   WHERE s.community_id = m.community_id AND s.identity_kind = 'phone' \
                     AND s.identity_value = m.wa_id AND s.undone_at IS NULL \
               ) \
               AND NOT EXISTS ( \
                   SELECT 1 FROM whatsapp_contacts c \
                   JOIN whatsapp_business_stops b \
                     ON b.community_id = c.community_id AND b.business_id = c.lead_id \
                   WHERE c.community_id = m.community_id AND c.wa_id = m.wa_id \
               ) \
             RETURNING m.batch_id",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(wa_id)
        .bind(expected_error_code)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(false);
        };
        if let Some(batch_id) = row.try_get::<Option<Uuid>, _>("batch_id")? {
            sqlx::query(
                "UPDATE whatsapp_batches SET status = 'approved' \
                 WHERE community_id = $1 AND id = $2 AND status = 'completed'",
            )
            .bind(community.as_uuid())
            .bind(batch_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    /// Record one owner-selected delayed retry for a Meta engagement-limit refusal. The selected
    /// failed row remains failed until the deadline, so it cannot be sent in the current sender
    /// pass. `retry_after IS NULL` makes duplicate command delivery harmless.
    pub async fn whatsapp_schedule_contact_retry(
        &self,
        community: CommunityId,
        wa_id: &str,
        message_id: Uuid,
        expected_error_code: &str,
        retry_after: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let result = sqlx::query(
            "WITH scheduled_contact AS ( \
                 UPDATE whatsapp_contacts c SET paused_at = COALESCE(c.paused_at, $5), \
                     pause_reason = $6, retry_after = $7, updated_at = now() \
                 WHERE c.community_id = $1 AND c.wa_id = $2 \
                   AND c.opted_out_at IS NULL AND c.retry_after IS NULL \
                   AND (c.paused_at IS NULL OR c.pause_reason = $6) \
                   AND NOT EXISTS ( \
                       SELECT 1 FROM whatsapp_suppressions s \
                       WHERE s.community_id = c.community_id AND s.identity_kind = 'phone' \
                         AND s.identity_value = c.wa_id AND s.undone_at IS NULL \
                   ) \
                   AND NOT EXISTS ( \
                       SELECT 1 FROM whatsapp_business_stops b \
                       WHERE b.community_id = c.community_id AND b.business_id = c.lead_id \
                   ) \
                   AND EXISTS ( \
                       SELECT 1 FROM whatsapp_messages m \
                       WHERE m.community_id = c.community_id AND m.id = $3 AND m.wa_id = c.wa_id \
                         AND m.direction = 'out' AND m.state = 'failed' AND m.error_code = $4 \
                   ) \
                 RETURNING c.wa_id \
             ) \
             UPDATE whatsapp_messages m SET send_after = $7, updated_at = now() \
             FROM scheduled_contact c \
             WHERE m.community_id = $1 AND m.wa_id = c.wa_id AND m.id = $3 \
               AND m.direction = 'out' AND m.state = 'failed' AND m.error_code = $4",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(message_id)
        .bind(expected_error_code)
        .bind(now)
        .bind(format!("Meta error {expected_error_code}"))
        .bind(retry_after)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(result.rows_affected() == 1)
    }

    /// Release delayed Meta engagement-limit retries that are due. It is safe to call on every
    /// sender tick: only the selected, still-failed row at the exact code transition is released,
    /// and it retains its idempotency key and original batch position.
    pub async fn whatsapp_release_due_contact_retries(
        &self,
        community: CommunityId,
        expected_error_code: &str,
        now: DateTime<Utc>,
    ) -> Result<i64> {
        let mut tx = begin(&self.pool).await?;
        let rows = sqlx::query(
            "WITH due_contacts AS ( \
                 UPDATE whatsapp_contacts c SET paused_at = NULL, pause_reason = NULL, \
                     retry_after = NULL, updated_at = now() \
                 WHERE c.community_id = $1 AND c.retry_after IS NOT NULL \
                   AND c.retry_after <= $3 AND c.opted_out_at IS NULL \
                   AND c.pause_reason = $2 \
                   AND NOT EXISTS ( \
                       SELECT 1 FROM whatsapp_suppressions s \
                       WHERE s.community_id = c.community_id AND s.identity_kind = 'phone' \
                         AND s.identity_value = c.wa_id AND s.undone_at IS NULL \
                   ) \
                   AND NOT EXISTS ( \
                       SELECT 1 FROM whatsapp_business_stops b \
                       WHERE b.community_id = c.community_id AND b.business_id = c.lead_id \
                   ) \
                   AND EXISTS ( \
                       SELECT 1 FROM whatsapp_messages m \
                       WHERE m.community_id = c.community_id AND m.wa_id = c.wa_id \
                         AND m.direction = 'out' AND m.state = 'failed' AND m.error_code = $4 \
                         AND m.send_after IS NOT NULL AND m.send_after <= $3 \
                   ) \
                 RETURNING c.wa_id \
             ) \
             UPDATE whatsapp_messages m SET \
                 state = CASE WHEN m.batch_id IS NULL THEN 'queued' ELSE 'ready' END, \
                 lease_token = NULL, lease_until = NULL, sent_at = NULL, send_after = NULL, \
                 updated_at = now() \
             FROM due_contacts d \
             WHERE m.community_id = $1 AND m.wa_id = d.wa_id AND m.direction = 'out' \
               AND m.state = 'failed' AND m.error_code = $4 \
               AND m.send_after IS NOT NULL AND m.send_after <= $3 \
             RETURNING m.batch_id",
        )
        .bind(community.as_uuid())
        .bind(format!("Meta error {expected_error_code}"))
        .bind(now)
        .bind(expected_error_code)
        .fetch_all(&mut *tx)
        .await?;
        let batch_ids = rows
            .iter()
            .filter_map(|row| row.try_get::<Option<Uuid>, _>("batch_id").ok().flatten())
            .collect::<Vec<_>>();
        if !batch_ids.is_empty() {
            sqlx::query(
                "UPDATE whatsapp_batches SET status = 'approved' \
                 WHERE community_id = $1 AND status = 'completed' AND id = ANY($2)",
            )
            .bind(community.as_uuid())
            .bind(&batch_ids)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(rows.len() as i64)
    }

    /// Skip a message that must not be sent any more (for example the contact opted out).
    pub async fn whatsapp_skip_message(
        &self,
        community: CommunityId,
        message_id: Uuid,
        reason: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'skipped', skip_reason = $3, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state IN ('queued', 'ready')",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(reason.chars().take(300).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// A send whose lease ran out never got a recorded answer. It is NEVER sent again:
    /// it becomes `unconfirmed` and the caller tells the owner. Returns the affected rows.
    pub async fn whatsapp_expire_leases(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<(CommunityId, WhatsappMessage)>> {
        let rows = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'unconfirmed', lease_token = NULL, \
                 lease_until = NULL, \
                 error_text = 'The relay stopped before it recorded the answer. Not sent again.', \
                 updated_at = now() \
             WHERE state = 'sending' AND lease_until <= $1 \
             RETURNING community_id, id, wa_id, direction, kind, body, template_name, \
                 template_language, params, state, skip_reason, wamid, error_code, error_text, \
                 event_id, batch_id, batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at",
        )
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((
                    CommunityId::from_uuid(row.try_get("community_id")?),
                    row_to_message(row)?,
                ))
            })
            .collect()
    }

    /// List unresolved sends whose Graph outcome was never recorded. They are intentionally not
    /// part of the ordinary send queue and need an owner recovery decision.
    pub async fn whatsapp_list_unknown_sends(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND direction = 'out' \
               AND state = 'unconfirmed' ORDER BY updated_at DESC, id DESC LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Record that an owner checked the relay's last known state for an unknown send. There is
    /// no fabricated provider read here: the durable row remains `unconfirmed` until the owner
    /// explicitly marks it delivered or creates a new replacement.
    pub async fn whatsapp_check_unknown_send(
        &self,
        community: CommunityId,
        message_id: Uuid,
        checked_by: &[u8],
        at: DateTime<Utc>,
    ) -> Result<Option<WhatsappMessage>> {
        let mut tx = begin(&self.pool).await?;
        let row = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND id = $2 AND direction = 'out' \
               AND state = 'unconfirmed' FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        sqlx::query(
            "INSERT INTO whatsapp_unknown_send_recoveries \
             (community_id, message_id, checked_at, checked_by) VALUES ($1, $2, $3, $4) \
             ON CONFLICT (community_id, message_id) DO UPDATE SET \
                 checked_at = EXCLUDED.checked_at, checked_by = EXCLUDED.checked_by",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(at)
        .bind(checked_by)
        .execute(&mut *tx)
        .await?;
        let message = row_to_message(&row)?;
        tx.commit().await?;
        Ok(Some(message))
    }

    /// Apply an owner's explicit confirmation that an unknown send reached the recipient. The
    /// original id and draft remain intact; only `unconfirmed` can make this transition.
    pub async fn whatsapp_mark_unknown_send_delivered(
        &self,
        community: CommunityId,
        message_id: Uuid,
        marked_by: &[u8],
        at: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        // Lock the original before reading the recovery record. A concurrent confirmed resend
        // must win or lose as one decision: marking the original delivered after its replacement
        // was queued could otherwise produce two deliberate sends.
        let original = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM whatsapp_messages WHERE community_id = $1 AND id = $2 \
             AND direction = 'out' AND state = 'unconfirmed' FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(_) = original else {
            tx.commit().await?;
            return Ok(false);
        };
        let replacement: Option<Uuid> = sqlx::query_scalar(
            "SELECT replacement_message_id FROM whatsapp_unknown_send_recoveries \
             WHERE community_id = $1 AND message_id = $2 FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        if replacement.is_some() {
            tx.commit().await?;
            return Ok(false);
        }
        let updated = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'delivered', \
                 error_text = 'Marked delivered by owner after unknown send outcome.', \
                 updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state = 'unconfirmed'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() == 1 {
            sqlx::query(
                "INSERT INTO whatsapp_unknown_send_recoveries \
                 (community_id, message_id, marked_delivered_at, marked_delivered_by) \
                 VALUES ($1, $2, $3, $4) \
                 ON CONFLICT (community_id, message_id) DO UPDATE SET \
                     marked_delivered_at = EXCLUDED.marked_delivered_at, \
                     marked_delivered_by = EXCLUDED.marked_delivered_by",
            )
            .bind(community.as_uuid())
            .bind(message_id)
            .bind(at)
            .bind(marked_by)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(updated.rows_affected() == 1)
    }

    /// Create exactly one new queued message after an owner's explicit resend confirmation. The
    /// original unknown row stays `unconfirmed`, retaining its evidence and at-most-once fence.
    pub async fn whatsapp_create_unknown_send_replacement(
        &self,
        community: CommunityId,
        message_id: Uuid,
        created_by: &[u8],
        at: DateTime<Utc>,
    ) -> Result<Option<UnknownSendReplacement>> {
        let mut tx = begin(&self.pool).await?;
        // Lock the original first. This serializes every recovery path for this send, including
        // two owners choosing Resend at the same time and Mark delivered racing a resend.
        let row = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND id = $2 AND direction = 'out' \
               AND state = 'unconfirmed' FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT replacement_message_id FROM whatsapp_unknown_send_recoveries \
             WHERE community_id = $1 AND message_id = $2 FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        if let Some(existing) = existing {
            tx.commit().await?;
            return Ok(Some(UnknownSendReplacement::Existing(existing)));
        }
        let original = row_to_message(&row)?;
        let replacement_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO whatsapp_messages \
             (community_id, id, wa_id, direction, kind, body, template_name, template_language, \
              params, state, idempotency_key, new_chat, sender_pubkey) \
             VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, 'queued', $9, $10, $11)",
        )
        .bind(community.as_uuid())
        .bind(replacement_id)
        .bind(&original.wa_id)
        .bind(&original.kind)
        .bind(&original.body)
        .bind(&original.template_name)
        .bind(&original.template_language)
        .bind(&original.params)
        .bind(format!("unknown-recovery:{message_id}"))
        .bind(original.new_chat)
        .bind(created_by)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO whatsapp_unknown_send_recoveries \
             (community_id, message_id, replacement_message_id, replacement_created_at, \
              replacement_created_by) VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (community_id, message_id) DO UPDATE SET \
                 replacement_message_id = EXCLUDED.replacement_message_id, \
                 replacement_created_at = EXCLUDED.replacement_created_at, \
                 replacement_created_by = EXCLUDED.replacement_created_by",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(replacement_id)
        .bind(at)
        .bind(created_by)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(UnknownSendReplacement::Created(replacement_id)))
    }

    /// Apply a Meta status callback. States only move forward, `failed` always applies.
    /// Returns the updated message when the WhatsApp message id is known.
    pub async fn whatsapp_update_status(
        &self,
        community: CommunityId,
        wamid: &str,
        state: &str,
        error_code: Option<&str>,
        error_text: Option<&str>,
    ) -> Result<Option<WhatsappMessage>> {
        let row = sqlx::query(
            "UPDATE whatsapp_messages SET state = $3, \
                 error_code = COALESCE($4, error_code), error_text = COALESCE($5, error_text), \
                 updated_at = now() \
             WHERE community_id = $1 AND wamid = $2 AND direction = 'out' \
               AND ($3 = 'failed' OR \
                    (CASE state WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 \
                                WHEN 'unconfirmed' THEN 0 ELSE -1 END) < \
                    (CASE $3 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 \
                             ELSE 99 END)) \
               AND state NOT IN ('failed') \
             RETURNING id, wa_id, direction, kind, body, template_name, template_language, params, \
                 state, skip_reason, wamid, error_code, error_text, event_id, batch_id, batch_idx, \
                 new_chat, send_after, sender_pubkey, sent_at, created_at",
        )
        .bind(community.as_uuid())
        .bind(wamid)
        .bind(state)
        .bind(error_code.map(|c| c.chars().take(64).collect::<String>()))
        .bind(error_text.map(|t| t.chars().take(500).collect::<String>()))
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_message).transpose()
    }

    /// Apply a delivery callback and, when the callback is an account-wide refusal, record the
    /// account-health fence in that same transaction. Older callers can continue using
    /// [`Self::whatsapp_update_status`] when no account pause is required.
    pub async fn whatsapp_update_status_with_account_health(
        &self,
        community: CommunityId,
        update: &WhatsappStatusHealthUpdate<'_>,
    ) -> Result<WhatsappStatusUpdate> {
        let mut tx = begin(&self.pool).await?;
        let row = sqlx::query(
            "UPDATE whatsapp_messages SET state = $3, \
                 error_code = COALESCE($4, error_code), error_text = COALESCE($5, error_text), \
                 updated_at = now() \
             WHERE community_id = $1 AND wamid = $2 AND direction = 'out' \
               AND ($3 = 'failed' OR \
                    (CASE state WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 \
                                WHEN 'unconfirmed' THEN 0 ELSE -1 END) < \
                    (CASE $3 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 \
                             ELSE 99 END)) \
               AND state NOT IN ('failed') \
             RETURNING id, wa_id, direction, kind, body, template_name, template_language, params, \
                 state, skip_reason, wamid, error_code, error_text, event_id, batch_id, batch_idx, \
                 new_chat, send_after, sender_pubkey, sent_at, created_at",
        )
        .bind(community.as_uuid())
        .bind(update.wamid)
        .bind(update.state)
        .bind(
            update
                .error_code
                .map(|c| c.chars().take(64).collect::<String>()),
        )
        .bind(
            update
                .error_text
                .map(|t| t.chars().take(500).collect::<String>()),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let message = row.as_ref().map(row_to_message).transpose()?;
        let became_unhealthy = match (
            message.as_ref(),
            update.error_code,
            update.error_text,
            update.account_pause_reason,
        ) {
            (Some(_), Some(code), Some(text), Some(pause_reason)) if update.state == "failed" => {
                mark_account_unhealthy_in(&mut tx, community, code, text, pause_reason, update.at)
                    .await?
            }
            _ => false,
        };
        tx.commit().await?;
        Ok(WhatsappStatusUpdate {
            message,
            became_unhealthy,
        })
    }

    /// The message with this WhatsApp id, any state.
    pub async fn whatsapp_get_message_by_wamid(
        &self,
        community: CommunityId,
        wamid: &str,
    ) -> Result<Option<WhatsappMessage>> {
        let row = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND wamid = $2",
        )
        .bind(community.as_uuid())
        .bind(wamid)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_message).transpose()
    }

    /// NEW chats already attempted since `since` (failed refusals do not count).
    pub async fn whatsapp_count_new_chats_since(
        &self,
        community: CommunityId,
        since: DateTime<Utc>,
    ) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages \
             WHERE community_id = $1 AND new_chat AND sent_at >= $2 AND state <> 'failed'",
        )
        .bind(community.as_uuid())
        .bind(since)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Time of the latest NEW chat attempt, for pacing.
    pub async fn whatsapp_last_new_chat_at(
        &self,
        community: CommunityId,
    ) -> Result<Option<DateTime<Utc>>> {
        let at: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT max(sent_at) FROM whatsapp_messages \
             WHERE community_id = $1 AND new_chat AND sent_at IS NOT NULL",
        )
        .bind(community.as_uuid())
        .fetch_one(&self.pool)
        .await?;
        Ok(at)
    }

    /// Outbound messages to this contact that are drafted, approved or queued but not yet
    /// answered by Graph (counts toward the one-message-in-a-row rule).
    pub async fn whatsapp_count_pending_outbound(
        &self,
        community: CommunityId,
        wa_id: &str,
    ) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages \
             WHERE community_id = $1 AND wa_id = $2 AND direction = 'out' \
               AND state IN ('draft', 'queued', 'ready', 'sending')",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Messages that Graph accepted (or that arrived) but whose Colony message event is not
    /// written yet. The sender loop retries these so a failed post is never lost.
    pub async fn whatsapp_list_unposted(
        &self,
        community: CommunityId,
        limit: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND event_id IS NULL AND wamid IS NOT NULL \
               AND state IN ('received', 'sent', 'delivered', 'read') \
               AND post_gave_up_at IS NULL AND (post_retry_at IS NULL OR post_retry_at <= $3) \
             ORDER BY created_at LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 200))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Pending agent drafts, oldest first.
    pub async fn whatsapp_list_drafts(
        &self,
        community: CommunityId,
        limit: i64,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND direction = 'out' AND state = 'draft' \
             ORDER BY created_at LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Drafts whose Colony thread message is not written yet (retried by the sender loop).
    pub async fn whatsapp_list_unposted_drafts(
        &self,
        community: CommunityId,
        limit: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages \
             WHERE community_id = $1 AND direction = 'out' AND state = 'draft' \
               AND event_id IS NULL \
               AND post_gave_up_at IS NULL AND (post_retry_at IS NULL OR post_retry_at <= $3) \
             ORDER BY created_at LIMIT $2",
        )
        .bind(community.as_uuid())
        .bind(limit.clamp(1, 200))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Owner or admin decides one draft in a single statement: approve moves it to `queued`
    /// (optionally with an edited body and parameters), reject moves it to `rejected`.
    /// Only a `draft` can be decided, so a repeat decision changes nothing.
    pub async fn whatsapp_decide_draft(
        &self,
        community: CommunityId,
        message_id: Uuid,
        approve: bool,
        edit: Option<(&str, &Value)>,
    ) -> Result<DraftDecisionOutcome> {
        let new_state = if approve { "queued" } else { "rejected" };
        let (body, params) = match edit {
            Some((body, params)) if approve => (Some(body), Some(params)),
            _ => (None, None),
        };
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = $3, body = COALESCE($4, body), \
                 params = COALESCE($5, params), updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND direction = 'out' AND state = 'draft'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .bind(new_state)
        .bind(body)
        .bind(params)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 1 {
            return Ok(if approve {
                DraftDecisionOutcome::Approved
            } else {
                DraftDecisionOutcome::Rejected
            });
        }
        let exists: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages \
             WHERE community_id = $1 AND id = $2 AND direction = 'out'",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(if exists == 0 {
            DraftDecisionOutcome::NotFound
        } else {
            DraftDecisionOutcome::NotDraft
        })
    }

    // ── batches ────────────────────────────────────────────────────────────────

    /// Store a pending batch with its held rows in one transaction.
    /// Returns `false` when a batch with this id already exists (idempotent re-send).
    pub async fn whatsapp_insert_batch(
        &self,
        community: CommunityId,
        batch: &WhatsappBatch,
        request_event_id: &[u8],
        rows: &[NewOutboundMessage],
    ) -> Result<bool> {
        let mut tx = begin(&self.pool).await?;
        let inserted = sqlx::query(
            "INSERT INTO whatsapp_batches \
             (community_id, id, created_by, template_name, language, status, note, \
              material_links, request_event_id) \
             VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8) \
             ON CONFLICT (community_id, id) DO NOTHING",
        )
        .bind(community.as_uuid())
        .bind(batch.id)
        .bind(&batch.created_by)
        .bind(&batch.template_name)
        .bind(&batch.language)
        .bind(&batch.note)
        .bind(&batch.material_links)
        .bind(request_event_id)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() != 1 {
            return Ok(false);
        }
        for row in rows {
            sqlx::query(
                "INSERT INTO whatsapp_messages \
                 (community_id, id, wa_id, direction, kind, body, template_name, \
                  template_language, params, state, idempotency_key, batch_id, batch_idx, \
                  new_chat, sender_pubkey) \
                 VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, 'held', $9, $10, $11, $12, $13)",
            )
            .bind(community.as_uuid())
            .bind(row.id)
            .bind(&row.wa_id)
            .bind(&row.kind)
            .bind(&row.body)
            .bind(&row.template_name)
            .bind(&row.template_language)
            .bind(&row.params)
            .bind(&row.idempotency_key)
            .bind(row.batch_id)
            .bind(row.batch_idx)
            .bind(row.new_chat)
            .bind(&row.sender_pubkey)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    /// One batch header.
    pub async fn whatsapp_get_batch(
        &self,
        community: CommunityId,
        batch_id: Uuid,
    ) -> Result<Option<WhatsappBatch>> {
        let row = sqlx::query(
            "SELECT id, created_by, template_name, language, status, note, material_links, \
                    decided_by, decided_at, created_at \
             FROM whatsapp_batches WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_batch).transpose()
    }

    /// Batches, newest first, optionally in one status.
    pub async fn whatsapp_list_batches(
        &self,
        community: CommunityId,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<WhatsappBatch>> {
        let rows = sqlx::query(
            "SELECT id, created_by, template_name, language, status, note, material_links, \
                    decided_by, decided_at, created_at \
             FROM whatsapp_batches WHERE community_id = $1 AND ($2::text IS NULL OR status = $2) \
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(community.as_uuid())
        .bind(status)
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_batch).collect()
    }

    /// Rows of one batch in order.
    pub async fn whatsapp_list_batch_rows(
        &self,
        community: CommunityId,
        batch_id: Uuid,
    ) -> Result<Vec<WhatsappMessage>> {
        let rows = sqlx::query(
            "SELECT id, wa_id, direction, kind, body, template_name, template_language, params, \
                    state, skip_reason, wamid, error_code, error_text, event_id, batch_id, \
                    batch_idx, new_chat, send_after, sender_pubkey, sent_at, created_at \
             FROM whatsapp_messages WHERE community_id = $1 AND batch_id = $2 \
             ORDER BY batch_idx",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_message).collect()
    }

    /// Apply an owner decision to a pending batch in one transaction: edits, drops, then
    /// approve (held rows become ready) or reject (all rows dropped).
    #[allow(clippy::too_many_arguments)]
    pub async fn whatsapp_decide_batch(
        &self,
        community: CommunityId,
        batch_id: Uuid,
        decided_by: &[u8],
        approve: bool,
        drop_rows: &[i32],
        edits: &[RowEdit],
        now: DateTime<Utc>,
    ) -> Result<BatchDecisionOutcome> {
        let mut tx = begin(&self.pool).await?;
        let status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM whatsapp_batches WHERE community_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .fetch_optional(&mut *tx)
        .await?;
        match status.as_deref() {
            None => return Ok(BatchDecisionOutcome::NotFound),
            Some("pending") => {}
            Some(_) => return Ok(BatchDecisionOutcome::NotPending),
        }
        for edit in edits {
            let result = sqlx::query(
                "UPDATE whatsapp_messages SET params = $4, body = $5, updated_at = now() \
                 WHERE community_id = $1 AND batch_id = $2 AND batch_idx = $3 AND state = 'held'",
            )
            .bind(community.as_uuid())
            .bind(batch_id)
            .bind(edit.idx)
            .bind(&edit.params)
            .bind(&edit.body)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                return Ok(BatchDecisionOutcome::UnknownRow(edit.idx));
            }
        }
        for idx in drop_rows {
            let result = sqlx::query(
                "UPDATE whatsapp_messages SET state = 'dropped', updated_at = now() \
                 WHERE community_id = $1 AND batch_id = $2 AND batch_idx = $3 AND state = 'held'",
            )
            .bind(community.as_uuid())
            .bind(batch_id)
            .bind(*idx)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                return Ok(BatchDecisionOutcome::UnknownRow(*idx));
            }
        }
        let outcome = if approve {
            let ready = sqlx::query(
                "UPDATE whatsapp_messages SET state = 'ready', updated_at = now() \
                 WHERE community_id = $1 AND batch_id = $2 AND state = 'held'",
            )
            .bind(community.as_uuid())
            .bind(batch_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            BatchDecisionOutcome::Approved(ready as i64)
        } else {
            sqlx::query(
                "UPDATE whatsapp_messages SET state = 'dropped', updated_at = now() \
                 WHERE community_id = $1 AND batch_id = $2 AND state = 'held'",
            )
            .bind(community.as_uuid())
            .bind(batch_id)
            .execute(&mut *tx)
            .await?;
            BatchDecisionOutcome::Rejected
        };
        sqlx::query(
            "UPDATE whatsapp_batches SET status = $3, decided_by = $4, decided_at = $5 \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .bind(if approve { "approved" } else { "rejected" })
        .bind(decided_by)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(outcome)
    }

    /// Let the waiting rows of an approved batch skip the send window and the pacing gap.
    ///
    /// One transaction under the batch row lock: the batch must be `approved` and have at
    /// most `max_rows` rows in total (dropped rows count, so a blast cannot be pruned into a
    /// "test" afterwards). Only `ready` rows are flagged; sending, the daily cap, opt-outs and
    /// the quality stop are untouched. A repeat keeps the first moment.
    pub async fn whatsapp_send_now_batch(
        &self,
        community: CommunityId,
        batch_id: Uuid,
        max_rows: i64,
        now: DateTime<Utc>,
    ) -> Result<SendNowOutcome> {
        let mut tx = begin(&self.pool).await?;
        let status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM whatsapp_batches WHERE community_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .fetch_optional(&mut *tx)
        .await?;
        match status.as_deref() {
            None => return Ok(SendNowOutcome::NotFound),
            Some("approved") => {}
            Some(_) => return Ok(SendNowOutcome::NotApproved),
        }
        let total: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM whatsapp_messages WHERE community_id = $1 AND batch_id = $2",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .fetch_one(&mut *tx)
        .await?;
        if total > max_rows {
            return Ok(SendNowOutcome::TooManyRows(total));
        }
        let flagged = sqlx::query(
            "UPDATE whatsapp_messages SET send_after = COALESCE(send_after, $3), \
                    updated_at = now() \
             WHERE community_id = $1 AND batch_id = $2 AND state = 'ready'",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .bind(now)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        tx.commit().await?;
        Ok(if flagged == 0 {
            SendNowOutcome::NothingWaiting
        } else {
            SendNowOutcome::Flagged(flagged as i64)
        })
    }

    /// Mark approved batches with nothing left to send as completed. Returns their ids.
    pub async fn whatsapp_complete_finished_batches(
        &self,
        community: CommunityId,
    ) -> Result<Vec<Uuid>> {
        let rows = sqlx::query(
            "UPDATE whatsapp_batches b SET status = 'completed' \
             WHERE b.community_id = $1 AND b.status = 'approved' AND NOT EXISTS ( \
                 SELECT 1 FROM whatsapp_messages m \
                 WHERE m.community_id = b.community_id AND m.batch_id = b.id \
                   AND m.state IN ('held', 'ready', 'queued', 'sending')) \
             RETURNING b.id",
        )
        .bind(community.as_uuid())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(|row| Ok(row.try_get("id")?)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_contains_sealed_secrets() {
        let connection = WhatsappConnection {
            id: Uuid::nil(),
            phone_number_id: "123".into(),
            waba_id: "456".into(),
            display_phone_number: None,
            verified_name: None,
            quality_rating: "GREEN".into(),
            phone_status: None,
            kek_id: "kek-x".into(),
            sealed_token: b"super-secret-sealed-token".to_vec(),
            token_nonce: vec![0; 12],
            sealed_app_secret: b"super-secret-sealed-app".to_vec(),
            app_secret_nonce: vec![0; 12],
            verify_token_hash: vec![0; 32],
            created_by: vec![0; 32],
        };
        let shown = format!("{connection:?}");
        assert!(shown.contains("REDACTED"));
        assert!(!shown.contains("super-secret"));
        assert!(
            !shown.contains("115, 117"),
            "no byte dump of the sealed token"
        );
    }
}
