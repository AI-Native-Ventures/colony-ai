//! Money rails (payment links) relay tables: provider connections with sealed secrets, the
//! private recipient of a card, durable jobs and the payment notice inbox.
//! Contract: `docs/money-rails-pay-contract.md`.
//!
//! Every statement is scoped by `community_id`. Secrets are stored exactly as the relay sealed
//! them; nothing in this module can open them, and nothing here logs or formats a value.

use buzz_core::CommunityId;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::error::Result;
use crate::Db;

// sqlx 0.9 only takes literal SQL, so the column lists are macros that expand to literals.
macro_rules! connection_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, notice_id, provider, route, status, is_default, config, kek_id, \
             sealed_api_key, api_key_nonce, sealed_signing_secret, signing_secret_nonce, \
             created_by, created_at, last_used_at FROM money_rails_connections ",
            $tail
        )
    };
}

macro_rules! job_select {
    ($tail:literal) => {
        concat!(
            "SELECT community_id, link_id, kind, payload, result, attempts, \
             (done_at IS NOT NULL) AS done FROM money_rails_jobs ",
            $tail
        )
    };
}

macro_rules! notice_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, connection_id, received_at, body, signature_state, link_id, reference, \
             amount_minor, currency, judgement FROM money_rails_notices ",
            $tail
        )
    };
}

/// A stored connection. Secrets are still sealed. Not `Debug`, so a value cannot be printed.
#[derive(Clone)]
pub struct MoneyConnectionRow {
    /// Connection id.
    pub id: Uuid,
    /// Random id of the private notice address.
    pub notice_id: Uuid,
    /// Provider slug.
    pub provider: String,
    /// `api` or `browser`.
    pub route: String,
    /// `connected`, `needs_attention` or `disconnected`.
    pub status: String,
    /// The default connection.
    pub is_default: bool,
    /// Non secret configuration (`ConnectionConfig` as JSON).
    pub config: Value,
    /// Key id of the KEK that sealed the secrets.
    pub kek_id: Option<String>,
    /// Sealed API key.
    pub sealed_api_key: Option<Vec<u8>>,
    /// Nonce of the API key.
    pub api_key_nonce: Option<Vec<u8>>,
    /// Sealed signing secret.
    pub sealed_signing_secret: Option<Vec<u8>>,
    /// Nonce of the signing secret.
    pub signing_secret_nonce: Option<Vec<u8>>,
    /// Pubkey of whoever connected it.
    pub created_by: Vec<u8>,
    /// Created.
    pub created_at: DateTime<Utc>,
    /// Last use.
    pub last_used_at: Option<DateTime<Utc>>,
}

/// A connection to insert.
pub struct NewMoneyConnection {
    /// Connection id.
    pub id: Uuid,
    /// Notice address id.
    pub notice_id: Uuid,
    /// Provider slug.
    pub provider: String,
    /// `api` or `browser`.
    pub route: String,
    /// Non secret configuration.
    pub config: Value,
    /// KEK id, when any secret is sealed.
    pub kek_id: Option<String>,
    /// Sealed API key and nonce.
    pub api_key: Option<(Vec<u8>, Vec<u8>)>,
    /// Sealed signing secret and nonce.
    pub signing_secret: Option<(Vec<u8>, Vec<u8>)>,
    /// Pubkey of whoever connected it.
    pub created_by: Vec<u8>,
    /// Make it the default.
    pub is_default: bool,
}

/// The private recipient of a card.
#[derive(Clone)]
pub struct MoneyRecipientRow {
    /// Opaque reference named by the head.
    pub recipient_ref: Uuid,
    /// Card.
    pub link_id: Uuid,
    /// `whatsapp` or `email`.
    pub channel: String,
    /// Normalised number or email address.
    pub address: String,
    /// Name.
    pub name: String,
}

/// A durable job.
#[derive(Clone, Debug)]
pub struct MoneyJob {
    /// Community.
    pub community_id: Uuid,
    /// Card.
    pub link_id: Uuid,
    /// `create`, `send`, `evidence`, `expire` or `grant`.
    pub kind: String,
    /// Job input.
    pub payload: Value,
    /// Saved result of a step that must not be repeated.
    pub result: Option<Value>,
    /// Tries so far, including the current one.
    pub attempts: i32,
    /// True once finished or cancelled.
    pub done: bool,
}

/// A notice to store.
pub struct NewMoneyNotice {
    /// Notice id.
    pub id: Uuid,
    /// Connection.
    pub connection_id: Uuid,
    /// Dedupe key.
    pub dedupe_key: String,
    /// Raw body, at most 64 KiB.
    pub body: Vec<u8>,
    /// `verified`, `invalid`, `unsigned` or `no_secret`.
    pub signature_state: String,
    /// The signature header as received (a signature, never a secret).
    pub signature_header: Option<String>,
    /// Matched card.
    pub link_id: Option<Uuid>,
    /// Reference read from the body.
    pub reference: Option<String>,
    /// Amount read from the body.
    pub amount_minor: Option<i64>,
    /// Currency read from the body.
    pub currency: Option<String>,
    /// `unmatched`, `ignored`, `reported` or `verified`.
    pub judgement: String,
}

/// A stored notice.
#[derive(Clone)]
pub struct MoneyNoticeRow {
    /// Notice id.
    pub id: Uuid,
    /// Connection.
    pub connection_id: Uuid,
    /// Received.
    pub received_at: DateTime<Utc>,
    /// Raw body until it is reduced.
    pub body: Option<Vec<u8>>,
    /// Signature result.
    pub signature_state: String,
    /// Matched card.
    pub link_id: Option<Uuid>,
    /// Reference.
    pub reference: Option<String>,
    /// Amount.
    pub amount_minor: Option<i64>,
    /// Currency.
    pub currency: Option<String>,
    /// Judgement.
    pub judgement: String,
}

fn row_to_connection(row: &PgRow) -> Result<MoneyConnectionRow> {
    Ok(MoneyConnectionRow {
        id: row.try_get("id")?,
        notice_id: row.try_get("notice_id")?,
        provider: row.try_get("provider")?,
        route: row.try_get("route")?,
        status: row.try_get("status")?,
        is_default: row.try_get("is_default")?,
        config: row.try_get("config")?,
        kek_id: row.try_get("kek_id")?,
        sealed_api_key: row.try_get("sealed_api_key")?,
        api_key_nonce: row.try_get("api_key_nonce")?,
        sealed_signing_secret: row.try_get("sealed_signing_secret")?,
        signing_secret_nonce: row.try_get("signing_secret_nonce")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        last_used_at: row.try_get("last_used_at")?,
    })
}

fn row_to_job(row: &PgRow) -> Result<MoneyJob> {
    Ok(MoneyJob {
        community_id: row.try_get("community_id")?,
        link_id: row.try_get("link_id")?,
        kind: row.try_get("kind")?,
        payload: row.try_get("payload")?,
        result: row.try_get("result")?,
        attempts: row.try_get("attempts")?,
        done: row.try_get("done")?,
    })
}

fn row_to_notice(row: &PgRow) -> Result<MoneyNoticeRow> {
    Ok(MoneyNoticeRow {
        id: row.try_get("id")?,
        connection_id: row.try_get("connection_id")?,
        received_at: row.try_get("received_at")?,
        body: row.try_get("body")?,
        signature_state: row.try_get("signature_state")?,
        link_id: row.try_get("link_id")?,
        reference: row.try_get("reference")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        judgement: row.try_get("judgement")?,
    })
}

// ── transaction scoped statements ─────────────────────────────────────────────

/// Insert a connection. Returns `false` when the id already exists.
pub async fn money_insert_connection_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    new: &NewMoneyConnection,
) -> Result<bool> {
    let (sealed_api_key, api_key_nonce) = match &new.api_key {
        Some((ciphertext, nonce)) => (Some(ciphertext.as_slice()), Some(nonce.as_slice())),
        None => (None, None),
    };
    let (sealed_signing_secret, signing_secret_nonce) = match &new.signing_secret {
        Some((ciphertext, nonce)) => (Some(ciphertext.as_slice()), Some(nonce.as_slice())),
        None => (None, None),
    };
    let result = sqlx::query(
        "INSERT INTO money_rails_connections \
         (community_id, id, notice_id, provider, route, is_default, config, kek_id, \
          sealed_api_key, api_key_nonce, sealed_signing_secret, signing_secret_nonce, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) \
         ON CONFLICT (community_id, id) DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(new.id)
    .bind(new.notice_id)
    .bind(&new.provider)
    .bind(&new.route)
    .bind(new.is_default)
    .bind(&new.config)
    .bind(&new.kek_id)
    .bind(sealed_api_key)
    .bind(api_key_nonce)
    .bind(sealed_signing_secret)
    .bind(signing_secret_nonce)
    .bind(&new.created_by)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Lock and load a connection for update.
pub async fn money_lock_connection_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    id: Uuid,
) -> Result<Option<MoneyConnectionRow>> {
    let row = sqlx::query(connection_select!(
        "WHERE community_id = $1 AND id = $2 FOR UPDATE"
    ))
    .bind(community.as_uuid())
    .bind(id)
    .fetch_optional(conn)
    .await?;
    row.as_ref().map(row_to_connection).transpose()
}

/// Save the non secret configuration, status and default flag.
pub async fn money_save_connection_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    id: Uuid,
    status: &str,
    is_default: bool,
    config: &Value,
) -> Result<()> {
    sqlx::query(
        "UPDATE money_rails_connections \
         SET status = $3, is_default = $4, config = $5, updated_at = now() \
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community.as_uuid())
    .bind(id)
    .bind(status)
    .bind(is_default)
    .bind(config)
    .execute(conn)
    .await?;
    Ok(())
}

/// Clear the default flag on every other connection of the company.
pub async fn money_clear_other_defaults_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    keep: Uuid,
) -> Result<()> {
    sqlx::query(
        "UPDATE money_rails_connections SET is_default = false, updated_at = now() \
         WHERE community_id = $1 AND id <> $2 AND is_default",
    )
    .bind(community.as_uuid())
    .bind(keep)
    .execute(conn)
    .await?;
    Ok(())
}

/// Replace one sealed secret. `field` is `api_key` or `signing_secret`.
pub async fn money_set_secret_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    id: Uuid,
    field: &str,
    kek_id: &str,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<bool> {
    let sql = match field {
        "api_key" => {
            "UPDATE money_rails_connections \
             SET kek_id = $3, sealed_api_key = $4, api_key_nonce = $5, updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND status <> 'disconnected'"
        }
        "signing_secret" => {
            "UPDATE money_rails_connections \
             SET kek_id = $3, sealed_signing_secret = $4, signing_secret_nonce = $5, \
                 updated_at = now() \
             WHERE community_id = $1 AND id = $2 AND status <> 'disconnected'"
        }
        _ => return Ok(false),
    };
    let result = sqlx::query(sql)
        .bind(community.as_uuid())
        .bind(id)
        .bind(kek_id)
        .bind(ciphertext)
        .bind(nonce)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() == 1)
}

/// Delete both sealed secrets of a connection at once.
pub async fn money_delete_secrets_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    id: Uuid,
) -> Result<()> {
    sqlx::query(
        "UPDATE money_rails_connections \
         SET sealed_api_key = NULL, api_key_nonce = NULL, sealed_signing_secret = NULL, \
             signing_secret_nonce = NULL, kek_id = NULL, updated_at = now() \
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community.as_uuid())
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Store the private recipient of a card. A reference is written once and never changed.
pub async fn money_insert_recipient_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    recipient_ref: Uuid,
    link_id: Uuid,
    channel: &str,
    address: &str,
    name: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO money_rails_recipients \
         (community_id, recipient_ref, link_id, channel, address, name) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (community_id, recipient_ref) DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(recipient_ref)
    .bind(link_id)
    .bind(channel)
    .bind(address)
    .bind(name)
    .execute(conn)
    .await?;
    Ok(())
}

/// Queue (or re-queue) a job to run at `next_at`. A re-queue clears any earlier result.
pub async fn money_enqueue_job_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    link_id: Uuid,
    kind: &str,
    payload: &Value,
    next_at: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO money_rails_jobs (community_id, link_id, kind, payload, next_at) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (community_id, link_id, kind) DO UPDATE \
         SET payload = EXCLUDED.payload, result = NULL, attempts = 0, \
             next_at = EXCLUDED.next_at, lease_until = NULL, last_error = NULL, done_at = NULL",
    )
    .bind(community.as_uuid())
    .bind(link_id)
    .bind(kind)
    .bind(payload)
    .bind(next_at)
    .execute(conn)
    .await?;
    Ok(())
}

/// Cancel every open job of a card.
pub async fn money_cancel_jobs_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    link_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "UPDATE money_rails_jobs SET done_at = now(), lease_until = NULL \
         WHERE community_id = $1 AND link_id = $2 AND done_at IS NULL",
    )
    .bind(community.as_uuid())
    .bind(link_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Cancel the open jobs of the given kinds for a card.
pub async fn money_cancel_job_kinds_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    link_id: Uuid,
    kinds: &[&str],
) -> Result<()> {
    let kinds: Vec<String> = kinds.iter().map(|kind| (*kind).to_owned()).collect();
    sqlx::query(
        "UPDATE money_rails_jobs SET done_at = now(), lease_until = NULL \
         WHERE community_id = $1 AND link_id = $2 AND kind = ANY($3) AND done_at IS NULL",
    )
    .bind(community.as_uuid())
    .bind(link_id)
    .bind(&kinds)
    .execute(conn)
    .await?;
    Ok(())
}

/// Store a notice. Returns `false` when the same dedupe key was stored before.
pub async fn money_insert_notice_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    new: &NewMoneyNotice,
) -> Result<bool> {
    let result = sqlx::query(
        "INSERT INTO money_rails_notices \
         (community_id, id, connection_id, dedupe_key, body, signature_state, signature_header, \
          link_id, reference, amount_minor, currency, judgement) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
         ON CONFLICT (community_id, connection_id, dedupe_key) DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(new.id)
    .bind(new.connection_id)
    .bind(&new.dedupe_key)
    .bind(&new.body)
    .bind(&new.signature_state)
    .bind(&new.signature_header)
    .bind(new.link_id)
    .bind(&new.reference)
    .bind(new.amount_minor)
    .bind(&new.currency)
    .bind(&new.judgement)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Record how a notice was judged.
pub async fn money_set_notice_judgement_tx(
    conn: &mut PgConnection,
    community: CommunityId,
    id: Uuid,
    judgement: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE money_rails_notices SET judgement = $3 WHERE community_id = $1 AND id = $2",
    )
    .bind(community.as_uuid())
    .bind(id)
    .bind(judgement)
    .execute(conn)
    .await?;
    Ok(())
}

// ── pool statements ───────────────────────────────────────────────────────────

impl Db {
    /// One connection of the company.
    pub async fn money_get_connection(
        &self,
        community: CommunityId,
        id: Uuid,
    ) -> Result<Option<MoneyConnectionRow>> {
        let row = sqlx::query(connection_select!("WHERE community_id = $1 AND id = $2"))
            .bind(community.as_uuid())
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(row_to_connection).transpose()
    }

    /// The connection that owns a notice address.
    pub async fn money_get_connection_by_notice(
        &self,
        community: CommunityId,
        notice_id: Uuid,
    ) -> Result<Option<MoneyConnectionRow>> {
        let row = sqlx::query(connection_select!(
            "WHERE community_id = $1 AND notice_id = $2 AND status <> 'disconnected'"
        ))
        .bind(community.as_uuid())
        .bind(notice_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_connection).transpose()
    }

    /// Every connection of the company, newest first.
    pub async fn money_list_connections(
        &self,
        community: CommunityId,
    ) -> Result<Vec<MoneyConnectionRow>> {
        let rows = sqlx::query(connection_select!(
            "WHERE community_id = $1 ORDER BY created_at DESC"
        ))
        .bind(community.as_uuid())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_connection).collect()
    }

    /// A live connection with this provider and route, if any.
    pub async fn money_find_live_connection(
        &self,
        community: CommunityId,
        provider: &str,
        route: &str,
    ) -> Result<Option<MoneyConnectionRow>> {
        let row = sqlx::query(connection_select!(
            "WHERE community_id = $1 AND provider = $2 AND route = $3 \
               AND status <> 'disconnected' LIMIT 1"
        ))
        .bind(community.as_uuid())
        .bind(provider)
        .bind(route)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_connection).transpose()
    }

    /// Note that a connection was used.
    pub async fn money_touch_connection(&self, community: CommunityId, id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE money_rails_connections SET last_used_at = now() \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The private recipient behind a reference.
    pub async fn money_get_recipient(
        &self,
        community: CommunityId,
        recipient_ref: Uuid,
    ) -> Result<Option<MoneyRecipientRow>> {
        let row = sqlx::query(
            "SELECT recipient_ref, link_id, channel, address, name \
             FROM money_rails_recipients WHERE community_id = $1 AND recipient_ref = $2",
        )
        .bind(community.as_uuid())
        .bind(recipient_ref)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(MoneyRecipientRow {
                recipient_ref: row.try_get("recipient_ref")?,
                link_id: row.try_get("link_id")?,
                channel: row.try_get("channel")?,
                address: row.try_get("address")?,
                name: row.try_get("name")?,
            })
        })
        .transpose()
    }

    /// One job of a card.
    pub async fn money_get_job(
        &self,
        community: CommunityId,
        link_id: Uuid,
        kind: &str,
    ) -> Result<Option<MoneyJob>> {
        let row = sqlx::query(job_select!(
            "WHERE community_id = $1 AND link_id = $2 AND kind = $3"
        ))
        .bind(community.as_uuid())
        .bind(link_id)
        .bind(kind)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_job).transpose()
    }

    /// Lease up to `limit` due jobs for `lease_secs`. Each claim counts as an attempt.
    pub async fn money_claim_due_jobs(&self, limit: i64, lease_secs: i64) -> Result<Vec<MoneyJob>> {
        let rows = sqlx::query(
            "UPDATE money_rails_jobs j \
             SET lease_until = now() + make_interval(secs => $2::double precision), \
                 attempts = j.attempts + 1 \
             FROM ( \
                 SELECT community_id, link_id, kind FROM money_rails_jobs \
                 WHERE done_at IS NULL AND next_at <= now() \
                   AND (lease_until IS NULL OR lease_until <= now()) \
                 ORDER BY next_at LIMIT $1 FOR UPDATE SKIP LOCKED \
             ) due \
             WHERE j.community_id = due.community_id AND j.link_id = due.link_id \
               AND j.kind = due.kind \
             RETURNING j.community_id, j.link_id, j.kind, j.payload, j.result, j.attempts, \
                       (j.done_at IS NOT NULL) AS done",
        )
        .bind(limit)
        .bind(lease_secs as f64)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_job).collect()
    }

    /// Lease one specific job if it is open and not leased, counting the claim as an attempt.
    pub async fn money_claim_job(
        &self,
        community: CommunityId,
        link_id: Uuid,
        kind: &str,
        lease_secs: i64,
    ) -> Result<Option<MoneyJob>> {
        let row = sqlx::query(
            "UPDATE money_rails_jobs \
             SET lease_until = now() + make_interval(secs => $4::double precision), \
                 attempts = attempts + 1 \
             WHERE community_id = $1 AND link_id = $2 AND kind = $3 AND done_at IS NULL \
               AND (lease_until IS NULL OR lease_until <= now()) \
             RETURNING community_id, link_id, kind, payload, result, attempts, \
                       (done_at IS NOT NULL) AS done",
        )
        .bind(community.as_uuid())
        .bind(link_id)
        .bind(kind)
        .bind(lease_secs as f64)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_job).transpose()
    }

    /// Whether a notice with this dedupe key was already stored for the connection.
    pub async fn money_notice_exists(
        &self,
        community: CommunityId,
        connection_id: Uuid,
        dedupe_key: &str,
    ) -> Result<bool> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM money_rails_notices \
             WHERE community_id = $1 AND connection_id = $2 AND dedupe_key = $3)",
        )
        .bind(community.as_uuid())
        .bind(connection_id)
        .bind(dedupe_key)
        .fetch_one(&self.pool)
        .await?;
        Ok(exists)
    }

    /// Finish a job.
    pub async fn money_complete_job(
        &self,
        community: CommunityId,
        link_id: Uuid,
        kind: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE money_rails_jobs SET done_at = now(), lease_until = NULL \
             WHERE community_id = $1 AND link_id = $2 AND kind = $3",
        )
        .bind(community.as_uuid())
        .bind(link_id)
        .bind(kind)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Save the result of a step that must not be repeated.
    pub async fn money_save_job_result(
        &self,
        community: CommunityId,
        link_id: Uuid,
        kind: &str,
        result: &Value,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE money_rails_jobs SET result = $4 \
             WHERE community_id = $1 AND link_id = $2 AND kind = $3",
        )
        .bind(community.as_uuid())
        .bind(link_id)
        .bind(kind)
        .bind(result)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Release a job's lease and run it again after `delay_secs`.
    pub async fn money_retry_job_later(
        &self,
        community: CommunityId,
        link_id: Uuid,
        kind: &str,
        error: &str,
        delay_secs: i64,
    ) -> Result<()> {
        let error: String = error.chars().take(400).collect();
        sqlx::query(
            "UPDATE money_rails_jobs \
             SET lease_until = NULL, last_error = $4, \
                 next_at = now() + make_interval(secs => $5::double precision) \
             WHERE community_id = $1 AND link_id = $2 AND kind = $3",
        )
        .bind(community.as_uuid())
        .bind(link_id)
        .bind(kind)
        .bind(error)
        .bind(delay_secs as f64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Notices received on a connection in the last `secs` seconds.
    pub async fn money_count_recent_notices(
        &self,
        community: CommunityId,
        connection_id: Uuid,
        secs: i64,
    ) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM money_rails_notices \
             WHERE community_id = $1 AND connection_id = $2 \
               AND received_at > now() - make_interval(secs => $3::double precision)",
        )
        .bind(community.as_uuid())
        .bind(connection_id)
        .bind(secs as f64)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Notices of a connection that still hold a raw body.
    pub async fn money_count_unreduced_notices(
        &self,
        community: CommunityId,
        connection_id: Uuid,
    ) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM money_rails_notices \
             WHERE community_id = $1 AND connection_id = $2 AND body IS NOT NULL",
        )
        .bind(community.as_uuid())
        .bind(connection_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// One notice.
    pub async fn money_get_notice(
        &self,
        community: CommunityId,
        id: Uuid,
    ) -> Result<Option<MoneyNoticeRow>> {
        let row = sqlx::query(notice_select!("WHERE community_id = $1 AND id = $2"))
            .bind(community.as_uuid())
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(row_to_notice).transpose()
    }

    /// Notices, newest first, optionally limited to a connection, a card, or unmatched ones.
    pub async fn money_list_notices(
        &self,
        community: CommunityId,
        connection_id: Option<Uuid>,
        link_id: Option<Uuid>,
        unmatched_only: bool,
        limit: i64,
    ) -> Result<Vec<MoneyNoticeRow>> {
        let rows = sqlx::query(notice_select!(
            "WHERE community_id = $1 \
               AND ($2::uuid IS NULL OR connection_id = $2) \
               AND ($3::uuid IS NULL OR link_id = $3) \
               AND (NOT $4 OR link_id IS NULL) \
             ORDER BY received_at DESC LIMIT $5"
        ))
        .bind(community.as_uuid())
        .bind(connection_id)
        .bind(link_id)
        .bind(unmatched_only)
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_notice).collect()
    }

    /// Drop the raw body (and the signature value) of notices older than `days`, keeping the
    /// evidence fields and the dedupe row. Returns how many were reduced.
    pub async fn money_reduce_old_notices(&self, days: i64, limit: i64) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE money_rails_notices n \
             SET body = NULL, signature_header = NULL, reduced_at = now() \
             FROM ( \
                 SELECT community_id, id FROM money_rails_notices \
                 WHERE body IS NOT NULL \
                   AND received_at < now() - make_interval(days => $1::int) \
                 LIMIT $2 \
             ) old \
             WHERE n.community_id = old.community_id AND n.id = old.id",
        )
        .bind(days as i32)
        .bind(limit)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// The id and state of the WhatsApp message queued under an idempotency key.
    pub async fn money_find_whatsapp_message(
        &self,
        community: CommunityId,
        idempotency_key: &str,
    ) -> Result<Option<(Uuid, String)>> {
        let row = sqlx::query(
            "SELECT id, state FROM whatsapp_messages \
             WHERE community_id = $1 AND idempotency_key = $2",
        )
        .bind(community.as_uuid())
        .bind(idempotency_key)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| Ok((row.try_get("id")?, row.try_get("state")?)))
            .transpose()
    }

    /// The state of one WhatsApp message.
    pub async fn money_whatsapp_message_state(
        &self,
        community: CommunityId,
        message_id: Uuid,
    ) -> Result<Option<String>> {
        let state: Option<String> = sqlx::query_scalar(
            "SELECT state FROM whatsapp_messages WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(state)
    }
}
