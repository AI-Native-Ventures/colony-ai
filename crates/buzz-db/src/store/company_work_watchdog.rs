//! Durable schedule and delivery journal for company work watchdog check-ins.

use buzz_core::CommunityId;
use chrono::{DateTime, Duration, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{error::Result, Db};
use buzz_datastore_tracing::datastore_span;

/// Maximum number of delivery attempts before a journal row becomes terminal.
pub const MAX_DELIVERY_ATTEMPTS: i32 = 5;

/// One durable scheduled watchdog check-in claimed by a worker.
#[derive(Clone, Debug)]
pub struct ClaimedDelivery {
    /// Community that owns the delivery.
    pub community_id: CommunityId,
    /// Delivery journal row UUID.
    pub id: Uuid,
    /// Work item UUID.
    pub work_item_id: Uuid,
    /// Exact watchdog configuration event that scheduled this delivery.
    pub config_event_id: Vec<u8>,
    /// Current channel expected for this delivery.
    pub channel_id: Uuid,
    /// Thread root event to which the check-in will reply.
    pub thread_root_event_id: Vec<u8>,
    /// Stable schedule occurrence used for event identity.
    pub scheduled_for: DateTime<Utc>,
    /// Claim fencing token.
    pub lease_token: Uuid,
    /// Attempt number for this claim.
    pub attempt_count: i32,
}

/// Schedule the first check-in after a configuration is saved.
pub async fn schedule_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    work_item_id: Uuid,
    config_event_id: &[u8],
    channel_id: Uuid,
    thread_root_event_id: &[u8],
    scheduled_for: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO company_work_watchdog_deliveries \
         (community_id, work_item_id, config_event_id, channel_id, thread_root_event_id, \
          scheduled_for, next_attempt_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $6) \
         ON CONFLICT (community_id, work_item_id, config_event_id, scheduled_for) DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(work_item_id)
    .bind(config_event_id)
    .bind(channel_id)
    .bind(thread_root_event_id)
    .bind(scheduled_for)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Cancel pending and leased deliveries for one community work item.
pub async fn cancel_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    work_item_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "UPDATE company_work_watchdog_deliveries \
         SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_until = NULL, \
             updated_at = transaction_timestamp() \
         WHERE community_id = $1 AND work_item_id = $2 AND state IN ('pending', 'sending')",
    )
    .bind(community.as_uuid())
    .bind(work_item_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Claim due rows in stable order, reclaiming expired leases with a new token.
#[datastore_span(name = "claim_company_work_watchdog_deliveries", system = "postgresql")]
pub async fn claim_due_batch(
    pool: &PgPool,
    worker_id: &str,
    now: DateTime<Utc>,
    lease_until: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<ClaimedDelivery>> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    sqlx::query(
        "UPDATE company_work_watchdog_deliveries \
         SET state = 'failed', lease_owner = NULL, lease_token = NULL, lease_until = NULL, \
             last_error = COALESCE(last_error, 'delivery lease expired at retry limit'), \
             updated_at = $1 \
         WHERE state = 'sending' AND lease_until <= $1 AND attempt_count >= $2",
    )
    .bind(now)
    .bind(MAX_DELIVERY_ATTEMPTS)
    .execute(&mut *tx)
    .await?;
    let rows = sqlx::query(
        "WITH due AS ( \
             SELECT community_id, id FROM company_work_watchdog_deliveries \
             WHERE (state = 'pending' AND next_attempt_at <= $1 AND attempt_count < $3) \
                OR (state = 'sending' AND lease_until <= $1 AND attempt_count < $3) \
             ORDER BY next_attempt_at, scheduled_for, id \
             LIMIT $4 FOR UPDATE SKIP LOCKED \
         ) \
         UPDATE company_work_watchdog_deliveries AS delivery \
         SET state = 'sending', attempt_count = delivery.attempt_count + 1, \
             lease_owner = $2, lease_token = gen_random_uuid(), lease_until = $5, \
             updated_at = $1 \
         FROM due \
         WHERE delivery.community_id = due.community_id AND delivery.id = due.id \
         RETURNING delivery.community_id, delivery.id, delivery.work_item_id, \
                   delivery.config_event_id, delivery.channel_id, delivery.thread_root_event_id, \
                   delivery.scheduled_for, delivery.lease_token, delivery.attempt_count",
    )
    .bind(now)
    .bind(worker_id)
    .bind(MAX_DELIVERY_ATTEMPTS)
    .bind(limit)
    .bind(lease_until)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    rows.into_iter()
        .map(|row| {
            Ok(ClaimedDelivery {
                community_id: CommunityId::from_uuid(row.try_get("community_id")?),
                id: row.try_get("id")?,
                work_item_id: row.try_get("work_item_id")?,
                config_event_id: row.try_get("config_event_id")?,
                channel_id: row.try_get("channel_id")?,
                thread_root_event_id: row.try_get("thread_root_event_id")?,
                scheduled_for: row.try_get("scheduled_for")?,
                lease_token: row.try_get("lease_token")?,
                attempt_count: row.try_get("attempt_count")?,
            })
        })
        .collect()
}

/// Mark a claimed message durable and release its lease in the same transaction.
pub async fn mark_delivered_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    delivery: &ClaimedDelivery,
    message_event_id: &[u8],
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE company_work_watchdog_deliveries \
         SET state = 'delivered', message_event_id = $4, lease_owner = NULL, \
             lease_token = NULL, lease_until = NULL, last_error = NULL, \
             updated_at = transaction_timestamp() \
         WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $3",
    )
    .bind(delivery.community_id.as_uuid())
    .bind(delivery.id)
    .bind(delivery.lease_token)
    .bind(message_event_id)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Mark an occurrence skipped because its explicitly selected trigger is false.
pub async fn mark_skipped_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    delivery: &ClaimedDelivery,
    reason: &str,
) -> Result<bool> {
    let bounded_reason = reason.chars().take(1000).collect::<String>();
    let result = sqlx::query(
        "UPDATE company_work_watchdog_deliveries \
         SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_until = NULL, \
             last_error = $4, updated_at = transaction_timestamp() \
         WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $3",
    )
    .bind(delivery.community_id.as_uuid())
    .bind(delivery.id)
    .bind(delivery.lease_token)
    .bind(bounded_reason)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Read the most recent persisted activity in a work item's thread.
#[datastore_span(name = "company_work_thread_activity", system = "postgresql")]
pub async fn latest_thread_activity(
    pool: &PgPool,
    community: CommunityId,
    channel_id: Uuid,
    root_event_id: &[u8],
) -> Result<Option<DateTime<Utc>>> {
    let row: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(event_created_at) FROM thread_metadata \
         WHERE community_id = $1 AND channel_id = $2 \
           AND (event_id = $3 OR root_event_id = $3)",
    )
    .bind(community.as_uuid())
    .bind(channel_id)
    .bind(root_event_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Read the most recent successfully delivered occurrence for one config.
#[datastore_span(name = "company_work_watchdog_last_delivery", system = "postgresql")]
pub async fn latest_delivery_time(
    pool: &PgPool,
    community: CommunityId,
    work_item_id: Uuid,
    config_event_id: &[u8],
) -> Result<Option<DateTime<Utc>>> {
    sqlx::query_scalar(
        "SELECT MAX(scheduled_for) FROM company_work_watchdog_deliveries \
         WHERE community_id = $1 AND work_item_id = $2 AND config_event_id = $3 \
           AND state = 'delivered'",
    )
    .bind(community.as_uuid())
    .bind(work_item_id)
    .bind(config_event_id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Record a failed attempt with bounded exponential retry or terminal failure.
#[datastore_span(name = "fail_company_work_watchdog_delivery", system = "postgresql")]
pub async fn fail_delivery(
    pool: &PgPool,
    delivery: &ClaimedDelivery,
    now: DateTime<Utc>,
    error: &str,
) -> Result<bool> {
    let bounded_error = error.chars().take(1000).collect::<String>();
    let retry_at = retry_at(now, delivery.attempt_count);
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    let result = sqlx::query(
        "UPDATE company_work_watchdog_deliveries \
         SET state = CASE WHEN attempt_count >= $4 THEN 'failed' ELSE 'pending' END, \
             next_attempt_at = CASE WHEN attempt_count >= $4 THEN next_attempt_at ELSE $5 END, \
             lease_owner = NULL, lease_token = NULL, lease_until = NULL, last_error = $6, \
             updated_at = $3 \
         WHERE community_id = $1 AND id = $2 AND state = 'sending' AND lease_token = $7",
    )
    .bind(delivery.community_id.as_uuid())
    .bind(delivery.id)
    .bind(now)
    .bind(MAX_DELIVERY_ATTEMPTS)
    .bind(retry_at)
    .bind(bounded_error)
    .bind(delivery.lease_token)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected() == 1)
}

/// Retry timestamp using bounded exponential backoff.
pub fn retry_at(now: DateTime<Utc>, attempt_count: i32) -> DateTime<Utc> {
    let exponent = attempt_count.saturating_sub(1).clamp(0, 10) as u32;
    let seconds = 30_i64.saturating_mul(1_i64 << exponent).min(3600);
    now + Duration::seconds(seconds)
}

impl Db {
    /// Claim due watchdog deliveries under database row leases.
    pub async fn claim_due_company_work_watchdog_deliveries(
        &self,
        worker_id: &str,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<ClaimedDelivery>> {
        claim_due_batch(&self.pool, worker_id, now, lease_until, limit).await
    }

    /// Persist a failed watchdog delivery and its retry or terminal state.
    pub async fn fail_company_work_watchdog_delivery(
        &self,
        delivery: &ClaimedDelivery,
        now: DateTime<Utc>,
        error: &str,
    ) -> Result<bool> {
        fail_delivery(&self.pool, delivery, now, error).await
    }

    /// Read latest thread activity for watchdog trigger evaluation.
    pub async fn latest_company_work_thread_activity(
        &self,
        community: CommunityId,
        channel_id: Uuid,
        root_event_id: &[u8],
    ) -> Result<Option<DateTime<Utc>>> {
        latest_thread_activity(&self.pool, community, channel_id, root_event_id).await
    }

    /// Read the last successful check-in time for watchdog escalation.
    pub async fn latest_company_work_watchdog_delivery(
        &self,
        community: CommunityId,
        work_item_id: Uuid,
        config_event_id: &[u8],
    ) -> Result<Option<DateTime<Utc>>> {
        latest_delivery_time(&self.pool, community, work_item_id, config_event_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn retry_schedule_is_injected_bounded_and_exponential() {
        let now = Utc
            .timestamp_opt(1_800_000_000, 0)
            .single()
            .expect("test timestamp");
        assert_eq!(retry_at(now, 1), now + Duration::seconds(30));
        assert_eq!(retry_at(now, 2), now + Duration::seconds(60));
        assert_eq!(
            retry_at(now, MAX_DELIVERY_ATTEMPTS),
            now + Duration::seconds(480)
        );
        assert_eq!(retry_at(now, 20), now + Duration::seconds(3600));
    }
}
