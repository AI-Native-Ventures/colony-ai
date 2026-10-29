//! Per-company monthly counter of Discovery results served by the relay.
//!
//! The relay checks this counter before it asks the provider for places and
//! adds the number of places it returned afterwards, so a company cannot spend
//! the operator's provider credits without bound. The counter is a cost guard:
//! it holds no search text and no places.

use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::Result;
use crate::Db;
use buzz_datastore_tracing::datastore_span;

/// Add `results` to a company's total for `month` and return the new total.
///
/// `month` must be the first day of a month (the table rejects anything else).
/// The upsert is atomic, so concurrent searches never lose each other's counts.
#[datastore_span(name = "add_discovery_results", system = "postgresql")]
pub async fn add_discovery_results(
    pool: &PgPool,
    community_id: Uuid,
    month: NaiveDate,
    results: i32,
) -> Result<i32> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    let total: i32 = sqlx::query_scalar(
        "INSERT INTO discovery_usage (community_id, month, results) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, month) DO UPDATE \
         SET results = discovery_usage.results + EXCLUDED.results, updated_at = now() \
         RETURNING results",
    )
    .bind(community_id)
    .bind(month)
    .bind(results)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(total)
}

/// Read a company's Discovery results total for `month`, zero when none yet.
#[datastore_span(name = "discovery_results_this_month", system = "postgresql")]
pub async fn discovery_results_this_month(
    pool: &PgPool,
    community_id: Uuid,
    month: NaiveDate,
) -> Result<i32> {
    let total: Option<i32> = sqlx::query_scalar(
        "SELECT results FROM discovery_usage WHERE community_id = $1 AND month = $2",
    )
    .bind(community_id)
    .bind(month)
    .fetch_optional(pool)
    .await?;
    Ok(total.unwrap_or(0))
}

impl Db {
    /// Add Discovery results to a company's monthly total and return the total.
    pub async fn add_discovery_results(
        &self,
        community_id: Uuid,
        month: NaiveDate,
        results: i32,
    ) -> Result<i32> {
        add_discovery_results(&self.pool, community_id, month, results).await
    }

    /// Read a company's Discovery results total for a month.
    pub async fn discovery_results_this_month(
        &self,
        community_id: Uuid,
        month: NaiveDate,
    ) -> Result<i32> {
        discovery_results_this_month(&self.pool, community_id, month).await
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
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

    fn month(y: i32, m: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, 1).expect("month")
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn counts_accumulate_per_company_and_month() {
        let (pool, a, b) = fixture().await;
        let oct = month(2026, 10);
        assert_eq!(
            discovery_results_this_month(&pool, a, oct).await.unwrap(),
            0
        );
        assert_eq!(add_discovery_results(&pool, a, oct, 10).await.unwrap(), 10);
        assert_eq!(add_discovery_results(&pool, a, oct, 5).await.unwrap(), 15);
        assert_eq!(
            add_discovery_results(&pool, a, month(2026, 11), 3)
                .await
                .unwrap(),
            3
        );
        assert_eq!(add_discovery_results(&pool, b, oct, 7).await.unwrap(), 7);
        assert_eq!(
            discovery_results_this_month(&pool, a, oct).await.unwrap(),
            15
        );
        assert_eq!(
            discovery_results_this_month(&pool, b, oct).await.unwrap(),
            7
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn concurrent_adds_do_not_lose_counts() {
        let (pool, a, _) = fixture().await;
        let oct = month(2026, 10);
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let pool = pool.clone();
            tasks.push(tokio::spawn(async move {
                add_discovery_results(&pool, a, oct, 5).await.unwrap()
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(
            discovery_results_this_month(&pool, a, oct).await.unwrap(),
            40
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn table_rejects_mid_month_dates_and_negative_counts() {
        let (pool, a, _) = fixture().await;
        let mid = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        assert!(add_discovery_results(&pool, a, mid, 1).await.is_err());
        assert!(add_discovery_results(&pool, a, month(2026, 10), -1)
            .await
            .is_err());
    }
}
