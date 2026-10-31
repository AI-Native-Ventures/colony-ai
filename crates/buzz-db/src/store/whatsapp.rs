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
/// Failed Colony posts of one message before the repair loop gives up on it.
pub const POST_MAX_ATTEMPTS: i32 = 24;

async fn begin(pool: &PgPool) -> Result<sqlx::Transaction<'static, sqlx::Postgres>> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    Ok(sqlx::Transaction::begin(connection, None).await?)
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
    /// When the contact was first seen.
    pub created_at: DateTime<Utc>,
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
    /// Set only by the owner's `send_now` decision: the moment it was given. The sender
    /// treats a set value as "skip the send window and the pacing gap".
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
            "SELECT daily_new_chat_cap, outreach_channel_id, send_paused, pause_reason, issues, \
                    templates_synced_at \
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

    /// Stop or resume all sending for the company.
    pub async fn whatsapp_set_send_paused(
        &self,
        community: CommunityId,
        paused: bool,
        reason: Option<&str>,
    ) -> Result<()> {
        self.whatsapp_ensure_settings(community).await?;
        sqlx::query(
            "UPDATE whatsapp_settings SET send_paused = $2, pause_reason = $3, updated_at = now() \
             WHERE community_id = $1",
        )
        .bind(community.as_uuid())
        .bind(paused)
        .bind(reason.map(|r| r.chars().take(500).collect::<String>()))
        .execute(&self.pool)
        .await?;
        Ok(())
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
                    opt_out_reason, paused_at, pause_reason, created_at \
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
                    opt_out_reason, paused_at, pause_reason, created_at \
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
                    opt_out_reason, paused_at, pause_reason, created_at \
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

    /// Tag the contact with the lead it matches.
    pub async fn whatsapp_set_lead(
        &self,
        community: CommunityId,
        wa_id: &str,
        lead_id: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE whatsapp_contacts SET lead_id = $3, updated_at = now() \
             WHERE community_id = $1 AND wa_id = $2",
        )
        .bind(community.as_uuid())
        .bind(wa_id)
        .bind(lead_id.chars().take(128).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(())
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
                    opt_out_reason, paused_at, pause_reason, created_at \
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
                    opt_out_reason, paused_at, pause_reason, created_at \
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
            "UPDATE whatsapp_messages SET state = 'sending', lease_token = $3, lease_until = $4, \
                 sent_at = $5, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND state IN ('queued', 'ready')",
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
