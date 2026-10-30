//! Durable queue of wakes for Scout in co-founder mode.
//!
//! A wake is a reason the relay turns into one short message to Scout. Every
//! wake has a dedupe key, so queueing the same event twice is a no-op, and the
//! delivery worker coalesces everything pending for a company into one message
//! per interval. The queue holds reasons and ids only, never text that came from
//! outside the company.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::error::Result;
use crate::Db;
use buzz_datastore_tracing::datastore_span;

/// Why Scout is being woken. The strings are the table's `reason` values.
pub const WAKE_REASONS: [&str; 6] = [
    "mode_on",
    "daily_start",
    "inbound_reply",
    "worker_finished",
    "approval_given",
    "deadline_near",
];

/// One queued wake that has not been delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingWake {
    /// Row id.
    pub id: Uuid,
    /// One of [`WAKE_REASONS`].
    pub reason: String,
    /// A short system-written note (ids and counts, never outside text).
    pub detail: String,
    /// When the wake was queued.
    pub created_at: DateTime<Utc>,
    /// Failed delivery attempts so far.
    pub attempts: i32,
}

async fn writer_transaction(pool: &PgPool) -> Result<sqlx::Transaction<'static, sqlx::Postgres>> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    Ok(sqlx::Transaction::begin(connection, None).await?)
}

/// Queue a wake. Returns `true` when it was new and `false` when the same
/// `dedupe_key` was already queued, delivered or skipped for this company.
#[datastore_span(name = "enqueue_cofounder_wake", system = "postgresql")]
pub async fn enqueue_wake(
    pool: &PgPool,
    community_id: Uuid,
    reason: &str,
    dedupe_key: &str,
    detail: &str,
) -> Result<bool> {
    let mut tx = writer_transaction(pool).await?;
    let result = sqlx::query(
        "INSERT INTO cofounder_wakes (community_id, reason, dedupe_key, detail) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (community_id, dedupe_key) DO NOTHING",
    )
    .bind(community_id)
    .bind(reason)
    .bind(dedupe_key)
    .bind(detail)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected() == 1)
}

/// Companies that have a pending wake due at `now`, oldest first, at most `limit`.
#[datastore_span(name = "cofounder_wake_due_communities", system = "postgresql")]
pub async fn due_communities(pool: &PgPool, now: DateTime<Utc>, limit: i64) -> Result<Vec<Uuid>> {
    let mut tx = writer_transaction(pool).await?;
    let rows = sqlx::query(
        "SELECT community_id FROM cofounder_wakes \
         WHERE status = 'pending' AND next_attempt_at <= $1 \
         GROUP BY community_id ORDER BY MIN(created_at) LIMIT $2",
    )
    .bind(now)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows
        .iter()
        .map(|row| row.get::<Uuid, _>("community_id"))
        .collect())
}

/// A company's pending wakes due at `now`, oldest first, at most `limit`.
#[datastore_span(name = "cofounder_pending_wakes", system = "postgresql")]
pub async fn pending_wakes(
    pool: &PgPool,
    community_id: Uuid,
    now: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<PendingWake>> {
    let mut tx = writer_transaction(pool).await?;
    let rows = sqlx::query(
        "SELECT id, reason, detail, created_at, attempts FROM cofounder_wakes \
         WHERE community_id = $1 AND status = 'pending' AND next_attempt_at <= $2 \
         ORDER BY created_at, id LIMIT $3",
    )
    .bind(community_id)
    .bind(now)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows
        .iter()
        .map(|row| PendingWake {
            id: row.get("id"),
            reason: row.get("reason"),
            detail: row.get("detail"),
            created_at: row.get("created_at"),
            attempts: row.get("attempts"),
        })
        .collect())
}

/// When the last wake message for this company was delivered, if ever.
#[datastore_span(name = "cofounder_last_wake_delivered", system = "postgresql")]
pub async fn last_delivered_at(pool: &PgPool, community_id: Uuid) -> Result<Option<DateTime<Utc>>> {
    let mut tx = writer_transaction(pool).await?;
    let last: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(delivered_at) FROM cofounder_wakes \
         WHERE community_id = $1 AND status = 'delivered'",
    )
    .bind(community_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(last)
}

/// Mark wakes delivered by the message `event_id`.
#[datastore_span(name = "cofounder_wakes_delivered", system = "postgresql")]
pub async fn mark_delivered(
    pool: &PgPool,
    community_id: Uuid,
    ids: &[Uuid],
    event_id: &[u8],
    now: DateTime<Utc>,
) -> Result<u64> {
    let mut tx = writer_transaction(pool).await?;
    let result = sqlx::query(
        "UPDATE cofounder_wakes \
         SET status = 'delivered', delivered_at = $4, message_event_id = $3 \
         WHERE community_id = $1 AND id = ANY($2) AND status = 'pending'",
    )
    .bind(community_id)
    .bind(ids)
    .bind(event_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Close wakes without a message (co-founder mode is off, or they went stale).
#[datastore_span(name = "cofounder_wakes_skipped", system = "postgresql")]
pub async fn mark_skipped(
    pool: &PgPool,
    community_id: Uuid,
    ids: &[Uuid],
    outcome: &str,
) -> Result<u64> {
    let mut tx = writer_transaction(pool).await?;
    let result = sqlx::query(
        "UPDATE cofounder_wakes SET status = 'skipped', outcome = $3 \
         WHERE community_id = $1 AND id = ANY($2) AND status = 'pending'",
    )
    .bind(community_id)
    .bind(ids)
    .bind(outcome)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Record a failed delivery and try again at `next_attempt_at`. A wake that has
/// failed `max_attempts` times is skipped with the last error as its outcome, so
/// a persistent failure ends instead of retrying forever.
#[datastore_span(name = "cofounder_wakes_retry", system = "postgresql")]
pub async fn retry_later(
    pool: &PgPool,
    community_id: Uuid,
    ids: &[Uuid],
    outcome: &str,
    next_attempt_at: DateTime<Utc>,
    max_attempts: i32,
) -> Result<u64> {
    let mut tx = writer_transaction(pool).await?;
    let result = sqlx::query(
        "UPDATE cofounder_wakes \
         SET attempts = attempts + 1, outcome = $3, next_attempt_at = $4, \
             status = CASE WHEN attempts + 1 >= $5 THEN 'skipped' ELSE status END \
         WHERE community_id = $1 AND id = ANY($2) AND status = 'pending'",
    )
    .bind(community_id)
    .bind(ids)
    .bind(outcome)
    .bind(next_attempt_at)
    .bind(max_attempts)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Delete wakes that are no longer pending and were queued before `before`.
#[datastore_span(name = "cofounder_wakes_prune", system = "postgresql")]
pub async fn prune_wakes(pool: &PgPool, before: DateTime<Utc>) -> Result<u64> {
    let mut tx = writer_transaction(pool).await?;
    let result =
        sqlx::query("DELETE FROM cofounder_wakes WHERE status <> 'pending' AND created_at < $1")
            .bind(before)
            .execute(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Every company id, in id order, after `after` (for paged sweeps).
#[datastore_span(name = "cofounder_sweep_communities", system = "postgresql")]
pub async fn communities_after(
    pool: &PgPool,
    after: Option<Uuid>,
    limit: i64,
) -> Result<Vec<Uuid>> {
    let rows = sqlx::query(
        "SELECT id FROM communities WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2",
    )
    .bind(after)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(|row| row.get::<Uuid, _>("id")).collect())
}

impl Db {
    /// Queue a wake; `false` when the same key was already queued.
    pub async fn enqueue_cofounder_wake(
        &self,
        community_id: Uuid,
        reason: &str,
        dedupe_key: &str,
        detail: &str,
    ) -> Result<bool> {
        enqueue_wake(&self.pool, community_id, reason, dedupe_key, detail).await
    }

    /// Companies with a pending wake due now.
    pub async fn cofounder_wake_due_communities(
        &self,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Uuid>> {
        due_communities(&self.pool, now, limit).await
    }

    /// A company's pending wakes due now.
    pub async fn cofounder_pending_wakes(
        &self,
        community_id: Uuid,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<PendingWake>> {
        pending_wakes(&self.pool, community_id, now, limit).await
    }

    /// When the last wake message was delivered for a company.
    pub async fn cofounder_last_wake_delivered(
        &self,
        community_id: Uuid,
    ) -> Result<Option<DateTime<Utc>>> {
        last_delivered_at(&self.pool, community_id).await
    }

    /// Mark wakes delivered by one message.
    pub async fn cofounder_wakes_delivered(
        &self,
        community_id: Uuid,
        ids: &[Uuid],
        event_id: &[u8],
        now: DateTime<Utc>,
    ) -> Result<u64> {
        mark_delivered(&self.pool, community_id, ids, event_id, now).await
    }

    /// Close wakes without a message.
    pub async fn cofounder_wakes_skipped(
        &self,
        community_id: Uuid,
        ids: &[Uuid],
        outcome: &str,
    ) -> Result<u64> {
        mark_skipped(&self.pool, community_id, ids, outcome).await
    }

    /// Record a failed delivery and schedule the next attempt.
    pub async fn cofounder_wakes_retry(
        &self,
        community_id: Uuid,
        ids: &[Uuid],
        outcome: &str,
        next_attempt_at: DateTime<Utc>,
        max_attempts: i32,
    ) -> Result<u64> {
        retry_later(
            &self.pool,
            community_id,
            ids,
            outcome,
            next_attempt_at,
            max_attempts,
        )
        .await
    }

    /// Delete old finished wakes.
    pub async fn cofounder_wakes_prune(&self, before: DateTime<Utc>) -> Result<u64> {
        prune_wakes(&self.pool, before).await
    }

    /// Company ids after `after`, for paged sweeps.
    pub async fn cofounder_sweep_communities(
        &self,
        after: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<Uuid>> {
        communities_after(&self.pool, after, limit).await
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use chrono::Duration;
    use sqlx::postgres::PgPoolOptions;

    async fn fixture() -> (PgPool, Uuid, Uuid) {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(&crate::test_support::database_url())
            .await
            .expect("test database");
        let mut ids = Vec::new();
        for _ in 0..2 {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
                .bind(id)
                .bind(format!("{id}.example"))
                .execute(&pool)
                .await
                .expect("community");
            ids.push(id);
        }
        (pool, ids[0], ids[1])
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_same_key_queues_once_per_company() {
        let (pool, a, b) = fixture().await;
        assert!(
            enqueue_wake(&pool, a, "daily_start", "daily:2026-11-01", "")
                .await
                .unwrap()
        );
        assert!(
            !enqueue_wake(&pool, a, "daily_start", "daily:2026-11-01", "")
                .await
                .unwrap()
        );
        // Another company may use the same key.
        assert!(
            enqueue_wake(&pool, b, "daily_start", "daily:2026-11-01", "")
                .await
                .unwrap()
        );
        let pending = pending_wakes(&pool, a, Utc::now() + Duration::seconds(1), 10)
            .await
            .unwrap();
        assert_eq!(pending.len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_delivered_key_is_never_queued_again() {
        let (pool, a, _) = fixture().await;
        enqueue_wake(&pool, a, "worker_finished", "worker:1", "")
            .await
            .unwrap();
        let now = Utc::now() + Duration::seconds(1);
        let pending = pending_wakes(&pool, a, now, 10).await.unwrap();
        let ids = pending.iter().map(|wake| wake.id).collect::<Vec<_>>();
        assert_eq!(
            mark_delivered(&pool, a, &ids, b"event", now).await.unwrap(),
            1
        );
        assert!(!enqueue_wake(&pool, a, "worker_finished", "worker:1", "")
            .await
            .unwrap());
        assert!(pending_wakes(&pool, a, now, 10).await.unwrap().is_empty());
        assert!(last_delivered_at(&pool, a).await.unwrap().is_some());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn retries_back_off_and_end_after_the_cap() {
        let (pool, a, _) = fixture().await;
        enqueue_wake(&pool, a, "inbound_reply", "reply:1", "")
            .await
            .unwrap();
        let now = Utc::now();
        let ids = pending_wakes(&pool, a, now + Duration::seconds(1), 10)
            .await
            .unwrap()
            .iter()
            .map(|wake| wake.id)
            .collect::<Vec<_>>();
        let later = now + Duration::minutes(10);
        retry_later(&pool, a, &ids, "no direct message yet", later, 2)
            .await
            .unwrap();
        // Not due before the retry time.
        assert!(pending_wakes(&pool, a, now + Duration::minutes(1), 10)
            .await
            .unwrap()
            .is_empty());
        let due = pending_wakes(&pool, a, later + Duration::seconds(1), 10)
            .await
            .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].attempts, 1);
        // The second failure reaches the cap and ends the wake.
        retry_later(&pool, a, &ids, "still no direct message", later, 2)
            .await
            .unwrap();
        assert!(pending_wakes(&pool, a, later + Duration::hours(1), 10)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn due_communities_lists_each_company_once() {
        let (pool, a, b) = fixture().await;
        for key in ["x", "y"] {
            enqueue_wake(&pool, a, "approval_given", key, "")
                .await
                .unwrap();
        }
        enqueue_wake(&pool, b, "approval_given", "x", "")
            .await
            .unwrap();
        let due = due_communities(&pool, Utc::now() + Duration::seconds(1), 100)
            .await
            .unwrap();
        assert_eq!(due.iter().filter(|id| **id == a).count(), 1);
        assert_eq!(due.iter().filter(|id| **id == b).count(), 1);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_table_rejects_an_unknown_reason() {
        let (pool, a, _) = fixture().await;
        assert!(enqueue_wake(&pool, a, "because", "k", "").await.is_err());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn prune_removes_only_finished_wakes() {
        let (pool, a, _) = fixture().await;
        enqueue_wake(&pool, a, "approval_given", "keep", "")
            .await
            .unwrap();
        enqueue_wake(&pool, a, "approval_given", "drop", "")
            .await
            .unwrap();
        let now = Utc::now() + Duration::seconds(1);
        let pending = pending_wakes(&pool, a, now, 10).await.unwrap();
        let drop_id = pending
            .iter()
            .position(|wake| wake.detail.is_empty())
            .map(|index| pending[index].id);
        mark_skipped(&pool, a, &[drop_id.expect("a wake")], "test")
            .await
            .unwrap();
        let removed = prune_wakes(&pool, Utc::now() + Duration::hours(1))
            .await
            .unwrap();
        assert!(removed >= 1);
        // One wake is still pending.
        assert_eq!(pending_wakes(&pool, a, now, 10).await.unwrap().len(), 1);
    }
}
