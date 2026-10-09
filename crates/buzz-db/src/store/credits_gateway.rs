//! Atomic managed-session spend holds and durable recovery. No provider secrets.

use buzz_core::CommunityId;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Result of admission under the payer row lock.
#[derive(Debug, PartialEq, Eq)]
pub enum Admission {
    /// A durable hold was committed; inference may start exactly once.
    New {
        /// Authenticated payer, only for server-side provider attribution.
        account_id: Uuid,
    },
    /// Original inference is still in progress or recovering.
    Pending,
    /// Original inference was already charged; never repeat it.
    Completed {
        /// Exact debit including margin, in nanoUSD.
        charged: i64,
        /// Whether recovery used the conservative maximum.
        provisional: bool,
    },
    /// The payer cannot cover the entire conservative hold.
    Insufficient,
    /// Four account requests or one session request are already pending.
    Busy,
}

/// One durable request available to the bounded recovery worker.
pub struct RecoveryRequest {
    /// Globally unique request identity.
    pub id: Uuid,
    /// Payer account identity.
    pub account_id: Uuid,
    /// Maximum authorized debit.
    pub reserved: i64,
    /// Actual returned charge, if durably observed.
    pub observed: Option<i64>,
    /// Non-secret fingerprint of the original provider and price configuration.
    pub upstream_id: String,
    /// Provider generation identity, if known.
    pub generation_id: Option<String>,
    /// Original admission time; retries never reset this deadline.
    pub created_at: DateTime<Utc>,
}

impl Db {
    /// Authorize a fresh Colony Agent session using an existing owner mapping.
    /// Replaces the same agent's previous authorization without reviving it.
    pub async fn create_credit_ai_session(
        &self,
        owner: &str,
        community: CommunityId,
        agent: &[u8],
    ) -> Result<Uuid> {
        let mut tx = self.pool.begin().await?;
        let account: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM accounts WHERE pubkey = $1 AND email_verified_at IS NOT NULL FOR UPDATE",
        ).bind(owner).fetch_optional(&mut *tx).await?;
        let account =
            account.ok_or_else(|| DbError::NotFound("verified account required".into()))?;
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE community_id = $1 AND pubkey = $2 AND agent_owner_pubkey = decode($3, 'hex'))",
        ).bind(community.as_uuid()).bind(agent).bind(owner).fetch_one(&mut *tx).await?;
        if !owned {
            return Err(DbError::InvalidData(
                "managed agent ownership required".into(),
            ));
        }
        sqlx::query("UPDATE account_ai_sessions SET revoked = true WHERE account_id = $1 AND community_id = $2 AND agent_pubkey = $3")
            .bind(account).bind(community.as_uuid()).bind(agent).execute(&mut *tx).await?;
        let active: i64 = sqlx::query_scalar("SELECT count(*) FROM account_ai_sessions WHERE account_id = $1 AND NOT revoked AND expires_at > now()")
            .bind(account).fetch_one(&mut *tx).await?;
        if active >= 16 {
            return Err(DbError::InvalidData("managed session limit reached".into()));
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO account_ai_sessions (id, account_id, community_id, agent_pubkey, expires_at) VALUES ($1,$2,$3,$4, now() + interval '2 hours')")
            .bind(id).bind(account).bind(community.as_uuid()).bind(agent).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Revoke an authorization immediately; existing spending still settles.
    pub async fn revoke_credit_ai_session(&self, owner: &str, session: Uuid) -> Result<()> {
        sqlx::query("UPDATE account_ai_sessions s SET revoked = true FROM accounts a WHERE s.account_id = a.id AND a.pubkey = $1 AND s.id = $2")
            .bind(owner).bind(session).execute(&self.pool).await?;
        Ok(())
    }

    /// Authenticate the session, reserve funds and journal before upstream spend.
    #[allow(clippy::too_many_arguments)]
    pub async fn admit_credit_ai_request(
        &self,
        upstream_id: &str,
        community: CommunityId,
        agent: &[u8],
        session: Uuid,
        request: Uuid,
        digest: &str,
        reserve: i64,
    ) -> Result<Admission> {
        if !(1..=400_000_000).contains(&reserve)
            || digest.len() != 64
            || upstream_id.is_empty()
            || upstream_id.len() > 64
        {
            return Err(DbError::InvalidData("invalid AI reservation".into()));
        }
        let mut tx = self.pool.begin().await?;
        // Always use the same payer lock as every existing ledger debit.
        let account: Option<Uuid> = sqlx::query_scalar(
            "SELECT a.id FROM accounts a JOIN account_ai_sessions s ON s.account_id = a.id \
             JOIN users u ON u.community_id = s.community_id AND u.pubkey = s.agent_pubkey \
             WHERE s.id = $1 AND s.community_id = $2 AND s.agent_pubkey = $3 \
             AND NOT s.revoked AND s.expires_at > now() AND a.email_verified_at IS NOT NULL \
             AND u.agent_owner_pubkey = decode(a.pubkey, 'hex') FOR UPDATE OF a, s",
        )
        .bind(session)
        .bind(community.as_uuid())
        .bind(agent)
        .fetch_optional(&mut *tx)
        .await?;
        let account = account
            .ok_or_else(|| DbError::NotFound("managed session expired or unauthorized".into()))?;
        // A recovery backlog must never strand a person after the fifteen-minute
        // window. At most four expired holds exist for this locked payer.
        let expired: Vec<(Uuid, i64, Option<i64>)> = sqlx::query_as("SELECT id, reserved_nanousd, observed_nanousd FROM account_ai_requests WHERE account_id = $1 AND status = 'pending' AND created_at <= now() - interval '15 minutes' ORDER BY id LIMIT 4 FOR UPDATE")
            .bind(account).fetch_all(&mut *tx).await?;
        for (id, maximum, observed) in expired {
            let actual = observed.filter(|cost| *cost <= maximum);
            settle_locked(
                &mut tx,
                account,
                id,
                actual.unwrap_or(maximum),
                actual.is_none(),
            )
            .await?;
            if actual.is_none() {
                tracing::warn!(request_id = %id, "Colony credit usage provisional settlement prepared during admission; operator review required");
            }
        }
        if let Some(row) = sqlx::query("SELECT account_id, session_id, body_sha256, status, charged_nanousd FROM account_ai_requests WHERE id = $1")
            .bind(request).fetch_optional(&mut *tx).await? {
            if row.try_get::<Uuid,_>("account_id")? != account || row.try_get::<Uuid,_>("session_id")? != session || row.try_get::<String,_>("body_sha256")? != digest {
                return Err(DbError::InvalidData("request id reused with different terms".into()));
            }
            let outcome = match row.try_get::<String,_>("status")?.as_str() {
                "pending" => Admission::Pending,
                status => Admission::Completed { charged: row.try_get("charged_nanousd")?, provisional: status == "estimated" },
            };
            tx.commit().await?;
            return Ok(outcome);
        }
        let (pending, same_session): (i64, bool) = sqlx::query_as("SELECT count(*), COALESCE(bool_or(session_id = $2), false) FROM account_ai_requests WHERE account_id = $1 AND status = 'pending'")
            .bind(account).bind(session).fetch_one(&mut *tx).await?;
        if pending >= 4 || same_session {
            tx.commit().await?;
            return Ok(Admission::Busy);
        }
        // Includes all outstanding negative holds, including other communities.
        let balance: i64 = sqlx::query_scalar("SELECT COALESCE(sum(amount_nanousd), 0)::bigint FROM account_credit_ledger WHERE account_id = $1")
            .bind(account).fetch_one(&mut *tx).await?;
        if balance < reserve {
            tx.commit().await?;
            return Ok(Admission::Insufficient);
        }
        sqlx::query("INSERT INTO account_ai_requests (id, account_id, session_id, body_sha256, reserved_nanousd, upstream_id) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(request).bind(account).bind(session).bind(digest).bind(reserve).bind(upstream_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO account_credit_ledger (account_id, entry_type, amount_nanousd, source_id, description, metadata) VALUES ($1,'adjustment',$2,$3,'Colony Agent pending usage hold',$4)")
            .bind(account).bind(-reserve).bind(format!("ai:{request}:hold")).bind(json!({"requestId":request,"pending":true})).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(Admission::New {
            account_id: account,
        })
    }

    /// Persist an authoritative upstream rejection as zero usage before releasing
    /// its hold. Recovery can finish this if the settlement acknowledgement is lost.
    pub async fn reject_credit_ai_request(&self, id: Uuid) -> Result<()> {
        sqlx::query("UPDATE account_ai_requests SET observed_nanousd = 0, usage = '{\"upstreamRejected\":true}'::jsonb WHERE id = $1 AND status = 'pending' AND generation_id IS NULL")
            .bind(id).execute(&self.pool).await?;
        self.settle_credit_ai_request(id, 0, false).await
    }

    /// Persist returned attribution before trying settlement. Above-ceiling costs
    /// remain review evidence and cannot increase the authorized debit.
    pub async fn observe_credit_ai_usage(
        &self,
        id: Uuid,
        generation: &str,
        charged: Option<i64>,
        usage: &Value,
    ) -> Result<()> {
        if generation.is_empty() || generation.len() > 200 || !usage.is_object() {
            return Err(DbError::InvalidData("invalid AI usage attribution".into()));
        }
        let updated = sqlx::query("UPDATE account_ai_requests SET generation_id = $2, observed_nanousd = $3, usage = $4 WHERE id = $1 AND (generation_id IS NULL OR generation_id = $2)")
            .bind(id).bind(generation).bind(charged).bind(usage).execute(&self.pool).await?;
        if updated.rows_affected() != 1 {
            return Err(DbError::InvalidData(
                "generation attribution conflicts".into(),
            ));
        }
        Ok(())
    }

    /// Settle a hold exactly once, or correct an estimated charge from actual usage.
    /// A single atomic transaction owns the release, debit, journal and refund.
    pub async fn settle_credit_ai_request(
        &self,
        id: Uuid,
        charged: i64,
        provisional: bool,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let account: Uuid =
            sqlx::query_scalar("SELECT account_id FROM account_ai_requests WHERE id = $1")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        sqlx::query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE")
            .bind(account)
            .execute(&mut *tx)
            .await?;
        settle_locked(&mut tx, account, id, charged, provisional).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Claim at most 16 due records across workers, with durable exponential
    /// backoff. The original fifteen-minute deadline always wins over backoff.
    pub async fn claim_credit_ai_recovery(&self) -> Result<Vec<RecoveryRequest>> {
        let rows = sqlx::query("WITH due AS (SELECT id FROM account_ai_requests WHERE status = 'pending' AND next_retry_at <= now() ORDER BY next_retry_at LIMIT 16 FOR UPDATE SKIP LOCKED) \
            UPDATE account_ai_requests r SET recovery_attempts = LEAST(r.recovery_attempts + 1, 16), \
            next_retry_at = CASE WHEN r.created_at <= now() - interval '15 minutes' THEN now() + interval '1 minute' ELSE LEAST(r.created_at + interval '15 minutes', now() + make_interval(secs => LEAST(300, 15 * power(2, LEAST(r.recovery_attempts, 5)))::int)) END \
            FROM due WHERE r.id = due.id RETURNING r.id, r.account_id, r.reserved_nanousd, r.observed_nanousd, r.generation_id, r.upstream_id, r.created_at")
            .fetch_all(&self.pool).await?;
        rows.into_iter().map(recovery_from_row).collect()
    }

    /// Read an original journal for authenticated operator correction.
    pub async fn credit_ai_recovery_request(&self, id: Uuid) -> Result<RecoveryRequest> {
        recovery_from_row(sqlx::query("SELECT id, account_id, reserved_nanousd, observed_nanousd, generation_id, upstream_id, created_at FROM account_ai_requests WHERE id = $1")
            .bind(id).fetch_one(&self.pool).await?)
    }
}

// Caller must hold the payer row lock before entering this shared settlement seam.
async fn settle_locked(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account: Uuid,
    id: Uuid,
    charged: i64,
    provisional: bool,
) -> Result<()> {
    let row = sqlx::query("SELECT reserved_nanousd, charged_nanousd, status FROM account_ai_requests WHERE id = $1 FOR UPDATE")
            .bind(id).fetch_one(&mut **tx).await?;
    let reserve: i64 = row.try_get("reserved_nanousd")?;
    let status: String = row.try_get("status")?;
    if !(0..=reserve).contains(&charged) || (provisional && charged != reserve) {
        return Err(DbError::InvalidData("usage exceeds authorized hold".into()));
    }
    if status == "settled" {
        let existing: i64 = row.try_get("charged_nanousd")?;
        if existing != charged {
            return Err(DbError::InvalidData("settled usage cost conflicts".into()));
        }
        return Ok(());
    }
    if status == "estimated" && provisional {
        return Ok(());
    }
    if status == "pending" {
        sqlx::query("INSERT INTO account_credit_ledger (account_id, entry_type, amount_nanousd, source_id, description) VALUES ($1,'adjustment',$2,$3,'Colony Agent usage hold released')")
                .bind(account).bind(reserve).bind(format!("ai:{id}:release")).execute(&mut **tx).await?;
        if charged > 0 {
            sqlx::query("INSERT INTO account_credit_ledger (account_id, entry_type, amount_nanousd, source_id, description, metadata) VALUES ($1,'usage',$2,$3,'Colony Agent usage',$4)")
                    .bind(account).bind(-charged).bind(format!("ai:{id}:usage")).bind(json!({"requestId":id,"provisional":provisional,"marginPercent":20})).execute(&mut **tx).await?;
        }
    } else {
        let previous: i64 = row.try_get("charged_nanousd")?;
        if previous > charged {
            sqlx::query("INSERT INTO account_credit_ledger (account_id, entry_type, amount_nanousd, source_id, description, metadata) VALUES ($1,'refund',$2,$3,'Colony Agent actual usage correction',$4)")
                    .bind(account).bind(previous - charged).bind(format!("ai:{id}:correction")).bind(json!({"requestId":id,"actualNanousd":charged.to_string()})).execute(&mut **tx).await?;
        }
    }
    sqlx::query("UPDATE account_ai_requests SET status = $2, charged_nanousd = $3, settled_at = now() WHERE id = $1")
            .bind(id).bind(if provisional {"estimated"} else {"settled"}).bind(charged).execute(&mut **tx).await?;
    Ok(())
}

fn recovery_from_row(row: sqlx::postgres::PgRow) -> Result<RecoveryRequest> {
    Ok(RecoveryRequest {
        id: row.try_get("id")?,
        account_id: row.try_get("account_id")?,
        reserved: row.try_get("reserved_nanousd")?,
        observed: row.try_get("observed_nanousd")?,
        generation_id: row.try_get("generation_id")?,
        upstream_id: row.try_get("upstream_id")?,
        created_at: row.try_get("created_at")?,
    })
}

#[cfg(test)]
mod postgres_tests;
