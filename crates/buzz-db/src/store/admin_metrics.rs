//! Operator admin metrics: nightly rollups and live collectors.
//!
//! Every table written here is deployment-global and holds counts, ids and
//! timestamps only (see `docs/admin-api-contract.md`). The rollups are rebuilt
//! idempotently from `events`, `users`, `event_mentions` and the AI journal, one
//! UTC day at a time, so a day can always be recomputed. The collectors
//! (`record_*`, `add_*`) are best-effort telemetry written by the relay.

use buzz_datastore_tracing::datastore_span;
use chrono::{DateTime, Days, NaiveDate, NaiveTime, Utc};
use sqlx::PgPool;

use crate::error::Result;
use crate::Db;

/// Deployment-global advisory lock so one relay pod runs the rollup at a time.
pub const METRICS_ROLLUP_LOCK_KEY: i64 = 0x4255_5a5a_4d45_5452;

/// Days the first run (and any later gap) backfills. The extra 30 days give
/// the earliest point in the 90-day admin range a complete MAU window.
pub const BACKFILL_DAYS: u64 = 120;

/// Days of rollup rows kept.
pub const RETENTION_DAYS: u64 = 400;

/// A person who connects again within this many minutes stays in the same session.
pub const SESSION_GAP_MINUTES: i32 = 30;

/// Midnight UTC at the start of `day`.
pub fn day_start(day: NaiveDate) -> DateTime<Utc> {
    day.and_time(NaiveTime::MIN).and_utc()
}

/// Rebuild one UTC day of person, agent, AI and headline rows in a single transaction.
///
/// `now` bounds the mention window: a mention only counts once it has had its
/// full five minutes to be answered, so a partial day never reports a mention
/// as unanswered that simply has not had time yet.
async fn rollup_day(
    pool: &PgPool,
    day: NaiveDate,
    finalize: bool,
    now: DateTime<Utc>,
) -> Result<()> {
    let start = day_start(day);
    let end = start + Days::new(1);
    let mention_cutoff = std::cmp::min(end, now - chrono::TimeDelta::minutes(5));
    let mut tx = pool.begin().await?;
    sqlx::query("SET LOCAL statement_timeout = '120s'")
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM metrics_person_daily WHERE day = $1")
        .bind(day)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO metrics_person_daily (day, community_id, pubkey, human_events, last_event_at) \
         SELECT $1, e.community_id, e.pubkey, count(*)::int, max(e.created_at) \
           FROM events e \
           JOIN users u ON u.community_id = e.community_id AND u.pubkey = e.pubkey \
          WHERE u.agent_type IS NULL AND u.agent_owner_pubkey IS NULL \
            AND e.created_at >= $2 AND e.created_at < $3 \
            AND e.deleted_at IS NULL AND e.kind <> 0 AND e.kind NOT BETWEEN 20000 AND 29999 \
          GROUP BY e.community_id, e.pubkey",
    )
    .bind(day)
    .bind(start)
    .bind(end)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM metrics_agent_daily WHERE day = $1")
        .bind(day)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO metrics_agent_daily \
             (day, community_id, agent_pubkey, events, last_event_at, mentions, answered_5m, answer_seconds_sum) \
         WITH posted AS ( \
             SELECT e.community_id, e.pubkey AS agent_pubkey, count(*)::int AS events, \
                    max(e.created_at) AS last_event_at \
               FROM events e \
               JOIN users u ON u.community_id = e.community_id AND u.pubkey = e.pubkey \
              WHERE (u.agent_type IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(u.agent_type, '')) <> 'worker' \
                AND e.created_at >= $2 AND e.created_at < $3 \
                AND e.deleted_at IS NULL AND e.kind <> 0 AND e.kind NOT BETWEEN 20000 AND 29999 \
              GROUP BY e.community_id, e.pubkey \
         ), asked AS ( \
             SELECT p.community_id, p.agent_pubkey, count(*)::int AS mentions, \
                    count(p.answered_at)::int AS answered_5m, \
                    COALESCE(sum(extract(epoch FROM (p.answered_at - p.event_created_at)))::bigint, 0) \
                        AS answer_seconds_sum \
               FROM ( \
                   SELECT a.community_id, a.pubkey AS agent_pubkey, m.event_created_at, \
                          (SELECT min(r.created_at) FROM events r \
                            WHERE r.community_id = a.community_id AND r.pubkey = a.pubkey \
                              AND r.channel_id IS NOT DISTINCT FROM m.channel_id \
                              AND r.created_at > m.event_created_at \
                              AND r.created_at <= m.event_created_at + interval '5 minutes' \
                              AND r.deleted_at IS NULL AND r.kind <> 0 \
                              AND r.kind NOT BETWEEN 20000 AND 29999) AS answered_at \
                     FROM users a \
                     JOIN event_mentions m ON m.community_id = a.community_id \
                                          AND m.pubkey_hex = encode(a.pubkey, 'hex') \
                     JOIN events me ON me.community_id = m.community_id \
                                   AND me.created_at = m.event_created_at AND me.id = m.event_id \
                    WHERE (a.agent_type IS NOT NULL OR a.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(a.agent_type, '')) <> 'worker' \
                      AND m.event_created_at >= $2 AND m.event_created_at < $4 \
                      AND me.pubkey <> a.pubkey AND me.deleted_at IS NULL \
               ) p \
              GROUP BY p.community_id, p.agent_pubkey \
         ) \
         SELECT $1, COALESCE(po.community_id, a.community_id), COALESCE(po.agent_pubkey, a.agent_pubkey), \
                COALESCE(po.events, 0), po.last_event_at, COALESCE(a.mentions, 0), \
                COALESCE(a.answered_5m, 0), COALESCE(a.answer_seconds_sum, 0) \
           FROM posted po \
           FULL JOIN asked a ON a.community_id = po.community_id AND a.agent_pubkey = po.agent_pubkey",
    )
    .bind(day)
    .bind(start)
    .bind(end)
    .bind(mention_cutoff)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM metrics_ai_daily WHERE day = $1")
        .bind(day)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO metrics_ai_daily \
             (day, community_id, model, requests, settled, estimated, rejected, \
              input_tokens, output_tokens, charged_nanousd) \
         SELECT $1, s.community_id, COALESCE(r.model, ''), count(*), \
                count(*) FILTER (WHERE r.status = 'settled' AND r.usage -> 'upstreamRejected' IS NULL), \
                count(*) FILTER (WHERE r.status = 'estimated'), \
                count(*) FILTER (WHERE r.usage -> 'upstreamRejected' IS NOT NULL), \
                COALESCE(sum(r.input_tokens), 0)::bigint, \
                COALESCE(sum(r.output_tokens), 0)::bigint, \
                COALESCE(sum(r.charged_nanousd), 0)::bigint \
           FROM account_ai_requests r \
           JOIN account_ai_sessions s ON s.id = r.session_id \
          WHERE r.created_at >= $2 AND r.created_at < $3 \
          GROUP BY s.community_id, COALESCE(r.model, '')",
    )
    .bind(day)
    .bind(start)
    .bind(end)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO metrics_daily_active \
             (day, dau, wau, mau, people_total, new_people, new_accounts, \
              businesses_total, businesses_archived, businesses_active_7d, businesses_created, \
              agents_total, agents_scout, agents_active_7d, agents_never_started, is_final, computed_at) \
         SELECT $1, \
                (SELECT count(DISTINCT pubkey) FROM metrics_person_daily WHERE day = $1)::int, \
                (SELECT count(DISTINCT pubkey) FROM metrics_person_daily \
                  WHERE day BETWEEN $1 - 6 AND $1)::int, \
                (SELECT count(DISTINCT pubkey) FROM metrics_person_daily \
                  WHERE day BETWEEN $1 - 29 AND $1)::int, \
                (SELECT count(DISTINCT u.pubkey) FROM users u \
                   JOIN communities c ON c.id = u.community_id \
                  WHERE u.agent_type IS NULL AND u.agent_owner_pubkey IS NULL AND u.deactivated_at IS NULL \
                    AND c.deleted_at IS NULL AND u.created_at < $3)::int, \
                (SELECT count(*) FROM ( \
                    SELECT u.pubkey FROM users u WHERE u.agent_type IS NULL AND u.agent_owner_pubkey IS NULL \
                     GROUP BY u.pubkey \
                    HAVING min(u.created_at) >= $2 AND min(u.created_at) < $3) f)::int, \
                (SELECT count(*) FROM accounts WHERE created_at >= $2 AND created_at < $3)::int, \
                (SELECT count(*) FROM communities c WHERE c.created_at < $3 \
                    AND (c.deleted_at IS NULL OR c.deleted_at >= $3))::int, \
                (SELECT count(*) FROM communities c WHERE c.created_at < $3 \
                    AND (c.deleted_at IS NULL OR c.deleted_at >= $3) AND c.archived_at < $3)::int, \
                (SELECT count(DISTINCT community_id) FROM metrics_person_daily \
                  WHERE day BETWEEN $1 - 6 AND $1)::int, \
                (SELECT count(*) FROM communities c WHERE c.created_at >= $2 AND c.created_at < $3)::int, \
                (SELECT count(*) FROM users u JOIN communities c ON c.id = u.community_id \
                  WHERE (u.agent_type IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(u.agent_type, '')) <> 'worker' AND c.deleted_at IS NULL AND u.created_at < $3)::int, \
                (SELECT count(*) FROM users u JOIN communities c ON c.id = u.community_id \
                  WHERE (u.agent_type IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(u.agent_type, '')) <> 'worker' AND c.deleted_at IS NULL AND u.created_at < $3 \
                    AND lower(btrim(COALESCE(u.display_name, ''))) = 'scout')::int, \
                (SELECT count(*) FROM (SELECT DISTINCT community_id, agent_pubkey FROM metrics_agent_daily \
                  WHERE day BETWEEN $1 - 6 AND $1 AND events > 0) f)::int, \
                (SELECT count(*) FROM users u JOIN communities c ON c.id = u.community_id \
                  WHERE (u.agent_type IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(u.agent_type, '')) <> 'worker' AND c.deleted_at IS NULL AND u.created_at < $3 \
                    AND NOT EXISTS (SELECT 1 FROM metrics_agent_daily d \
                                     WHERE d.community_id = u.community_id AND d.agent_pubkey = u.pubkey \
                                       AND d.events > 0 AND d.day <= $1))::int, \
                $4, now() \
         ON CONFLICT (day) DO UPDATE SET \
             dau = EXCLUDED.dau, wau = EXCLUDED.wau, mau = EXCLUDED.mau, \
             people_total = EXCLUDED.people_total, new_people = EXCLUDED.new_people, \
             new_accounts = EXCLUDED.new_accounts, businesses_total = EXCLUDED.businesses_total, \
             businesses_archived = EXCLUDED.businesses_archived, \
             businesses_active_7d = EXCLUDED.businesses_active_7d, \
             businesses_created = EXCLUDED.businesses_created, agents_total = EXCLUDED.agents_total, \
             agents_scout = EXCLUDED.agents_scout, agents_active_7d = EXCLUDED.agents_active_7d, \
             agents_never_started = EXCLUDED.agents_never_started, is_final = EXCLUDED.is_final, \
             computed_at = EXCLUDED.computed_at",
    )
    .bind(day)
    .bind(start)
    .bind(end)
    .bind(finalize)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// What one pass of the rollup job did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RollupSummary {
    /// Whether this pod held the rollup lock. `false` means another pod is running it.
    pub ran: bool,
    /// Days rebuilt, including today.
    pub days: u32,
}

impl Db {
    /// Rebuild one UTC day of rollup rows. `finalize` marks the day complete.
    ///
    /// Idempotent: the same input yields the same rows, so a day can be
    /// recomputed at any time (the 15 minute refresh and the nightly finalise
    /// both call this).
    #[datastore_span(name = "rollup_metrics_day", system = "postgresql")]
    pub async fn rollup_metrics_day(
        &self,
        day: NaiveDate,
        finalize: bool,
        now: DateTime<Utc>,
    ) -> Result<()> {
        rollup_day(&self.pool, day, finalize, now).await
    }

    /// One pass of the metrics job: fill missing or unfinished days of the last
    /// [`BACKFILL_DAYS`] oldest first (so each day's weekly and monthly windows
    /// find their predecessors), refresh today, and prune old rows.
    ///
    /// Only one pod runs a pass at a time (Postgres advisory lock); a pod that
    /// does not get the lock returns `ran: false` and does nothing.
    #[datastore_span(name = "run_metrics_rollup", system = "postgresql")]
    pub async fn run_metrics_rollup(&self, now: DateTime<Utc>) -> Result<RollupSummary> {
        let mut lock = self.pool.begin().await?;
        let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(METRICS_ROLLUP_LOCK_KEY)
            .fetch_one(&mut *lock)
            .await?;
        if !acquired {
            return Ok(RollupSummary::default());
        }

        let today = now.date_naive();
        let first_possible: Option<NaiveDate> = sqlx::query_scalar(
            "SELECT (min(created_at) AT TIME ZONE 'UTC')::date FROM communities",
        )
        .fetch_one(&mut *lock)
        .await?;
        let window_start = today - Days::new(BACKFILL_DAYS - 1);
        let first_day = first_possible.map_or(window_start, |first| first.max(window_start));

        let finals: Vec<NaiveDate> = sqlx::query_scalar(
            "SELECT day FROM metrics_daily_active WHERE day >= $1 AND day < $2 AND is_final",
        )
        .bind(first_day)
        .bind(today)
        .fetch_all(&mut *lock)
        .await?;

        let settle_after = day_start(today) + chrono::TimeDelta::minutes(10);
        let mut summary = RollupSummary { ran: true, days: 0 };
        let mut day = first_day;
        while day < today {
            if !finals.contains(&day) {
                // Yesterday stays open until 00:10 UTC so late writes land before it is final.
                let finalize = !(day + Days::new(1) == today && now < settle_after);
                rollup_day(&self.pool, day, finalize, now).await?;
                summary.days += 1;
            }
            day = day + Days::new(1);
        }
        rollup_day(&self.pool, today, false, now).await?;
        summary.days += 1;

        let keep_from = today - Days::new(RETENTION_DAYS);
        for table in [
            "DELETE FROM metrics_daily_active WHERE day < $1",
            "DELETE FROM metrics_person_daily WHERE day < $1",
            "DELETE FROM metrics_agent_daily WHERE day < $1",
            "DELETE FROM metrics_ai_daily WHERE day < $1",
            "DELETE FROM metrics_app_sessions_daily WHERE day < $1",
        ] {
            sqlx::query(table)
                .bind(keep_from)
                .execute(&self.pool)
                .await?;
        }
        sqlx::query("DELETE FROM metrics_http_hourly WHERE hour < $1")
            .bind(day_start(keep_from))
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM metrics_gateway_outcomes_hourly WHERE hour < $1")
            .bind(day_start(keep_from))
            .execute(&self.pool)
            .await?;

        lock.commit().await?;
        Ok(summary)
    }

    /// Record that `pubkey` authenticated a WebSocket connection to `community_id`.
    ///
    /// One row per person per business per day. A connection more than
    /// [`SESSION_GAP_MINUTES`] after the previous one starts a new session.
    /// `app_version` is the desktop's own version from its AUTH event, when sent;
    /// a connection without one keeps the day's earlier version.
    #[datastore_span(name = "record_app_connection", system = "postgresql")]
    pub async fn record_app_connection(
        &self,
        community_id: uuid::Uuid,
        pubkey: &[u8],
        app_version: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO metrics_app_sessions_daily \
                 (day, community_id, pubkey, sessions, connections, first_seen_at, last_seen_at, app_version) \
             VALUES (($1 AT TIME ZONE 'UTC')::date, $2, $3, 1, 1, $1, $1, $4) \
             ON CONFLICT (day, community_id, pubkey) DO UPDATE SET \
                 sessions = metrics_app_sessions_daily.sessions + \
                     CASE WHEN EXCLUDED.last_seen_at - metrics_app_sessions_daily.last_seen_at \
                               > make_interval(mins => $5) THEN 1 ELSE 0 END, \
                 connections = metrics_app_sessions_daily.connections + 1, \
                 last_seen_at = GREATEST(metrics_app_sessions_daily.last_seen_at, EXCLUDED.last_seen_at), \
                 app_version = COALESCE(EXCLUDED.app_version, metrics_app_sessions_daily.app_version)",
        )
        .bind(now)
        .bind(community_id)
        .bind(pubkey)
        .bind(app_version)
        .bind(SESSION_GAP_MINUTES)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Add counted HTTP responses for one route in one hour.
    #[datastore_span(name = "add_http_metrics", system = "postgresql")]
    pub async fn add_http_metrics(
        &self,
        hour: DateTime<Utc>,
        route: &str,
        requests: i64,
        errors_4xx: i64,
        errors_5xx: i64,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO metrics_http_hourly (hour, route, requests, errors_4xx, errors_5xx) \
             VALUES (date_trunc('hour', $1 AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', $2, $3, $4, $5) \
             ON CONFLICT (hour, route) DO UPDATE SET \
                 requests = metrics_http_hourly.requests + EXCLUDED.requests, \
                 errors_4xx = metrics_http_hourly.errors_4xx + EXCLUDED.errors_4xx, \
                 errors_5xx = metrics_http_hourly.errors_5xx + EXCLUDED.errors_5xx",
        )
        .bind(hour)
        .bind(route)
        .bind(requests)
        .bind(errors_4xx)
        .bind(errors_5xx)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Add finished free AI gateway requests of one outcome in one hour.
    #[datastore_span(name = "add_gateway_outcomes", system = "postgresql")]
    pub async fn add_gateway_outcomes(
        &self,
        hour: DateTime<Utc>,
        outcome: &str,
        handed_on: bool,
        requests: i64,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO metrics_gateway_outcomes_hourly (hour, outcome, handed_on, requests) \
             VALUES (date_trunc('hour', $1 AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', $2, $3, $4) \
             ON CONFLICT (hour, outcome, handed_on) DO UPDATE SET \
                 requests = metrics_gateway_outcomes_hourly.requests + EXCLUDED.requests",
        )
        .bind(hour)
        .bind(outcome)
        .bind(handed_on)
        .bind(requests)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Record one operator read of an admin board (actor, route, time; nothing else).
    #[datastore_span(name = "record_operator_read", system = "postgresql")]
    pub async fn record_operator_read(&self, actor_pubkey: &[u8], route: &str) -> Result<()> {
        sqlx::query("INSERT INTO relay_operator_read_audit (actor_pubkey, route) VALUES ($1, $2)")
            .bind(actor_pubkey)
            .bind(route)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use buzz_core::company_onboarding::{
        OnboardingHead, OnboardingStatus, OnboardingStep, OpenQuestion, StepState, StepStatus,
        ONBOARDING_D_TAG,
    };
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use serde_json::Value;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::Row as _;
    use uuid::Uuid;

    type AiDailyRow = (String, i64, i64, i64, i64, i64, i64, i64);

    const SECRET: &str = "TOP-SECRET-MESSAGE-BODY-7f3c";

    fn key() -> Vec<u8> {
        let mut bytes = Uuid::new_v4().as_bytes().to_vec();
        bytes.extend_from_slice(Uuid::new_v4().as_bytes());
        bytes
    }

    /// A day nobody else's test touches, so global counts (DAU and friends) are exact.
    fn unique_day() -> NaiveDate {
        let offset = (Uuid::new_v4().as_u128() % 20_000) as u64;
        NaiveDate::from_ymd_opt(2100, 1, 1).expect("date") + Days::new(offset)
    }

    fn at(day: NaiveDate, hour: i64, minute: i64) -> DateTime<Utc> {
        day_start(day) + chrono::TimeDelta::hours(hour) + chrono::TimeDelta::minutes(minute)
    }

    async fn pool() -> PgPool {
        PgPoolOptions::new()
            .max_connections(6)
            .connect(&crate::test_support::database_url())
            .await
            .expect("test database")
    }

    async fn community(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(format!("{id}.example"))
            .execute(pool)
            .await
            .expect("community");
        id
    }

    async fn human(pool: &PgPool, community: Uuid) -> Vec<u8> {
        let pubkey = key();
        sqlx::query("INSERT INTO users (community_id, pubkey) VALUES ($1, $2)")
            .bind(community)
            .bind(&pubkey)
            .execute(pool)
            .await
            .expect("human");
        pubkey
    }

    async fn agent(pool: &PgPool, community: Uuid, owner: &[u8], name: &str) -> Vec<u8> {
        let pubkey = key();
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, agent_type, agent_owner_pubkey, display_name) \
             VALUES ($1, $2, 'claude_code', $3, $4)",
        )
        .bind(community)
        .bind(&pubkey)
        .bind(owner)
        .bind(name)
        .execute(pool)
        .await
        .expect("agent");
        pubkey
    }

    async fn event(
        pool: &PgPool,
        community: Uuid,
        pubkey: &[u8],
        created_at: DateTime<Utc>,
        kind: i32,
        channel: Option<Uuid>,
        content: &str,
    ) -> Vec<u8> {
        let id = key();
        sqlx::query(
            "INSERT INTO events (community_id, id, pubkey, created_at, kind, tags, content, sig, channel_id) \
             VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8)",
        )
        .bind(community)
        .bind(&id)
        .bind(pubkey)
        .bind(created_at)
        .bind(kind)
        .bind(content)
        .bind(vec![0u8; 64])
        .bind(channel)
        .execute(pool)
        .await
        .expect("event");
        id
    }

    async fn onboarding_head_event(
        pool: &PgPool,
        community: Uuid,
        relay_pubkey: &[u8],
        created_at: DateTime<Utc>,
        content: &str,
    ) {
        sqlx::query(
            "INSERT INTO events (community_id, id, pubkey, created_at, kind, tags, content, sig, channel_id, d_tag) \
             VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, NULL, $8)",
        )
        .bind(community)
        .bind(key())
        .bind(relay_pubkey)
        .bind(created_at)
        .bind(buzz_core::kind::KIND_ONBOARDING_HEAD as i32)
        .bind(content)
        .bind(vec![0u8; 64])
        .bind(ONBOARDING_D_TAG)
        .execute(pool)
        .await
        .expect("onboarding head event");
    }

    async fn mention(
        pool: &PgPool,
        community: Uuid,
        agent: &[u8],
        event_id: &[u8],
        created_at: DateTime<Utc>,
        channel: Uuid,
    ) {
        sqlx::query(
            "INSERT INTO event_mentions (community_id, pubkey_hex, event_id, event_created_at, channel_id, event_kind) \
             VALUES ($1, $2, $3, $4, $5, 9)",
        )
        .bind(community)
        .bind(hex::encode(agent))
        .bind(event_id)
        .bind(created_at)
        .bind(channel)
        .execute(pool)
        .await
        .expect("mention");
    }

    async fn daily(pool: &PgPool, day: NaiveDate) -> (i64, i64, i64, bool) {
        let row = sqlx::query(
            "SELECT dau::bigint AS dau, wau::bigint AS wau, mau::bigint AS mau, is_final \
               FROM metrics_daily_active WHERE day = $1",
        )
        .bind(day)
        .fetch_one(pool)
        .await
        .expect("daily row");
        (
            row.get("dau"),
            row.get("wau"),
            row.get("mau"),
            row.get("is_final"),
        )
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn rollup_counts_people_not_agents_and_builds_dau_wau_mau() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let day = unique_day();
        let c = community(&pool).await;
        let a = human(&pool, c).await;
        let b = human(&pool, c).await;
        let late = human(&pool, c).await;
        let old = human(&pool, c).await;
        let scout = agent(&pool, c, &a, "Scout").await;

        event(
            &pool,
            c,
            &old,
            at(day - Days::new(20), 9, 0),
            9,
            None,
            SECRET,
        )
        .await;
        event(
            &pool,
            c,
            &late,
            at(day - Days::new(3), 9, 0),
            9,
            None,
            SECRET,
        )
        .await;
        event(&pool, c, &a, at(day, 10, 0), 9, None, SECRET).await;
        event(&pool, c, &a, at(day, 11, 0), 9, None, SECRET).await;
        // Ephemeral AUTH (kind 22242) and a deleted event are not activity.
        event(&pool, c, &a, at(day, 12, 0), 22242, None, "").await;
        let removed = event(&pool, c, &b, at(day, 12, 30), 9, None, SECRET).await;
        sqlx::query("UPDATE events SET deleted_at = now() WHERE community_id = $1 AND id = $2")
            .bind(c)
            .bind(&removed)
            .execute(&pool)
            .await
            .expect("delete");
        event(&pool, c, &b, at(day, 13, 0), 7, None, "+").await;
        event(&pool, c, &scout, at(day, 14, 0), 9, None, SECRET).await;

        let now = at(day, 23, 0) + Days::new(2);
        for d in [day - Days::new(20), day - Days::new(3), day] {
            db.rollup_metrics_day(d, true, now).await.expect("rollup");
        }

        let people: Vec<(Vec<u8>, i32)> = sqlx::query_as(
            "SELECT pubkey, human_events FROM metrics_person_daily \
              WHERE day = $1 AND community_id = $2 ORDER BY human_events DESC",
        )
        .bind(day)
        .bind(c)
        .fetch_all(&pool)
        .await
        .expect("person rows");
        assert_eq!(people, vec![(a.clone(), 2), (b.clone(), 1)]);

        let (dau, wau, mau, is_final) = daily(&pool, day).await;
        assert_eq!(
            (dau, wau, mau),
            (2, 3, 4),
            "the scout agent is not a person"
        );
        assert!(is_final);

        // Recomputing the same day changes nothing, and finalize can be turned off again.
        db.rollup_metrics_day(day, false, now).await.expect("again");
        let (dau, wau, mau, is_final) = daily(&pool, day).await;
        assert_eq!((dau, wau, mau), (2, 3, 4));
        assert!(!is_final);

        let agent_row: (i32, i32) = sqlx::query_as(
            "SELECT events, mentions FROM metrics_agent_daily WHERE day = $1 AND community_id = $2",
        )
        .bind(day)
        .bind(c)
        .fetch_one(&pool)
        .await
        .expect("agent row");
        assert_eq!(agent_row, (1, 0));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn rollup_pairs_mentions_with_answers_within_five_minutes() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let day = unique_day();
        let c = community(&pool).await;
        let owner = human(&pool, c).await;
        let scout = agent(&pool, c, &owner, "Scout").await;
        let room = Uuid::new_v4();
        let other_room = Uuid::new_v4();

        // Answered after 2 minutes.
        let first = event(&pool, c, &owner, at(day, 9, 0), 9, Some(room), SECRET).await;
        mention(&pool, c, &scout, &first, at(day, 9, 0), room).await;
        event(&pool, c, &scout, at(day, 9, 2), 9, Some(room), SECRET).await;
        // Answered after 7 minutes: too late.
        let second = event(&pool, c, &owner, at(day, 10, 0), 9, Some(room), SECRET).await;
        mention(&pool, c, &scout, &second, at(day, 10, 0), room).await;
        event(&pool, c, &scout, at(day, 10, 7), 9, Some(room), SECRET).await;
        // Never answered.
        let third = event(&pool, c, &owner, at(day, 11, 0), 9, Some(room), SECRET).await;
        mention(&pool, c, &scout, &third, at(day, 11, 0), room).await;
        // Answered, but in a different channel.
        let fourth = event(&pool, c, &owner, at(day, 12, 0), 9, Some(room), SECRET).await;
        mention(&pool, c, &scout, &fourth, at(day, 12, 0), room).await;
        event(
            &pool,
            c,
            &scout,
            at(day, 12, 1),
            9,
            Some(other_room),
            SECRET,
        )
        .await;

        db.rollup_metrics_day(day, true, at(day, 23, 0) + Days::new(1))
            .await
            .expect("rollup");
        let row: (i32, i32, i32, i64) = sqlx::query_as(
            "SELECT events, mentions, answered_5m, answer_seconds_sum FROM metrics_agent_daily \
              WHERE day = $1 AND community_id = $2 AND agent_pubkey = $3",
        )
        .bind(day)
        .bind(c)
        .bind(&scout)
        .fetch_one(&pool)
        .await
        .expect("agent row");
        assert_eq!(row, (3, 4, 1, 120));

        // A partial day counts only mentions that have had their five minutes: with the
        // clock at 12:03 the 12:00 mention is too new to judge, the earlier ones count.
        db.rollup_metrics_day(day, false, at(day, 12, 3))
            .await
            .expect("partial rollup");
        let partial: (i32, i32) = sqlx::query_as(
            "SELECT mentions, answered_5m FROM metrics_agent_daily \
              WHERE day = $1 AND community_id = $2 AND agent_pubkey = $3",
        )
        .bind(day)
        .bind(c)
        .bind(&scout)
        .fetch_one(&pool)
        .await
        .expect("partial row");
        assert_eq!(partial, (3, 1));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn ai_journal_gains_model_and_token_columns_and_rolls_up() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let day = unique_day();
        let c = community(&pool).await;
        let owner = human(&pool, c).await;
        let scout = agent(&pool, c, &owner, "Scout").await;
        let account = Uuid::new_v4();
        let account_key = nostr::Keys::generate();
        sqlx::query(
            "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, sealed_nsec, nonce) \
             VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
        )
        .bind(account)
        .bind(format!("{account}@example.invalid"))
        .bind(account_key.public_key().to_hex())
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&pool)
        .await
        .expect("account");
        let session = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO account_ai_sessions (id, account_id, community_id, agent_pubkey, expires_at) \
             VALUES ($1, $2, $3, $4, now() + interval '1 hour')",
        )
        .bind(session)
        .bind(account)
        .bind(c)
        .bind(&scout)
        .execute(&pool)
        .await
        .expect("session");

        let insert = |status: &'static str, charged: i64, usage: Value, hour: i64| {
            let pool = pool.clone();
            async move {
                let id = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO account_ai_requests \
                         (id, account_id, session_id, upstream_id, body_sha256, reserved_nanousd, \
                          charged_nanousd, status, usage, created_at, settled_at) \
                     VALUES ($1, $2, $3, $4, $5, 1000, $6, $7, $8, $9, $9)",
                )
                .bind(id)
                .bind(account)
                .bind(session)
                .bind(id.simple().to_string())
                .bind("a".repeat(64))
                .bind(charged)
                .bind(status)
                .bind(usage)
                .bind(at(day, hour, 0))
                .execute(&pool)
                .await
                .expect("request");
                id
            }
        };
        let deepseek = serde_json::json!({"model": "free/deepseek", "prompt_tokens": 100, "completion_tokens": 50});
        let first = insert("settled", 0, deepseek.clone(), 8).await;
        insert("settled", 0, deepseek, 9).await;
        insert(
            "settled",
            0,
            serde_json::json!({"upstreamRejected": true}),
            10,
        )
        .await;
        insert(
            "estimated",
            5,
            serde_json::json!({"model": "free/other", "prompt_tokens": "not a number", "completion_tokens": 7}),
            11,
        )
        .await;

        // The database fills the columns from the stored usage: no code path has to remember to.
        let columns: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT model, input_tokens, output_tokens FROM account_ai_requests WHERE id = $1",
        )
        .bind(first)
        .fetch_one(&pool)
        .await
        .expect("columns");
        assert_eq!(
            columns,
            (Some("free/deepseek".to_owned()), Some(100), Some(50))
        );

        db.rollup_metrics_day(day, true, at(day, 23, 0) + Days::new(1))
            .await
            .expect("rollup");
        let rows: Vec<AiDailyRow> = sqlx::query_as(
            "SELECT model, requests, settled, estimated, rejected, input_tokens, output_tokens, charged_nanousd \
               FROM metrics_ai_daily WHERE day = $1 AND community_id = $2 ORDER BY model",
        )
        .bind(day)
        .bind(c)
        .fetch_all(&pool)
        .await
        .expect("ai rows");
        assert_eq!(
            rows,
            vec![
                // The rejected request has no model.
                (String::new(), 1, 0, 0, 1, 0, 0, 0),
                ("free/deepseek".to_owned(), 2, 2, 0, 0, 200, 100, 0),
                // A token count that is not a number stays empty instead of failing the rollup.
                ("free/other".to_owned(), 1, 0, 1, 0, 0, 7, 5),
            ]
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn app_connections_group_into_sessions_and_keep_the_version() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let day = unique_day();
        let c = community(&pool).await;
        let person = key();
        db.record_app_connection(c, &person, None, at(day, 9, 0))
            .await
            .expect("first");
        db.record_app_connection(c, &person, Some("3.0.31"), at(day, 9, 10))
            .await
            .expect("same session");
        db.record_app_connection(c, &person, None, at(day, 9, 45))
            .await
            .expect("new session");
        db.record_app_connection(c, &person, None, at(day, 9, 50))
            .await
            .expect("same session again");
        let row: (i32, i32, Option<String>) = sqlx::query_as(
            "SELECT sessions, connections, app_version FROM metrics_app_sessions_daily \
              WHERE day = $1 AND community_id = $2 AND pubkey = $3",
        )
        .bind(day)
        .bind(c)
        .bind(&person)
        .fetch_one(&pool)
        .await
        .expect("row");
        assert_eq!(row, (2, 4, Some("3.0.31".to_owned())));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn http_and_gateway_counters_add_up_per_hour() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let route = format!("/test/{}", Uuid::new_v4());
        let hour = at(unique_day(), 5, 30);
        db.add_http_metrics(hour, &route, 10, 2, 1)
            .await
            .expect("one");
        db.add_http_metrics(hour + chrono::TimeDelta::minutes(20), &route, 5, 0, 3)
            .await
            .expect("two");
        let row: (i64, i64, i64) = sqlx::query_as(
            "SELECT requests, errors_4xx, errors_5xx FROM metrics_http_hourly WHERE route = $1",
        )
        .bind(&route)
        .fetch_one(&pool)
        .await
        .expect("http row");
        assert_eq!(row, (15, 2, 4), "both writes land in the same hour row");

        let outcome = format!("t_{}", &Uuid::new_v4().simple().to_string()[..12]);
        db.add_gateway_outcomes(hour, &outcome, true, 2)
            .await
            .expect("g1");
        db.add_gateway_outcomes(hour, &outcome, true, 3)
            .await
            .expect("g2");
        db.add_gateway_outcomes(hour, &outcome, false, 1)
            .await
            .expect("g3");
        let rows: Vec<(bool, i64)> = sqlx::query_as(
            "SELECT handed_on, requests FROM metrics_gateway_outcomes_hourly \
              WHERE outcome = $1 ORDER BY handed_on",
        )
        .bind(&outcome)
        .fetch_all(&pool)
        .await
        .expect("gateway rows");
        assert_eq!(rows, vec![(false, 1), (true, 5)]);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_full_pass_fills_missing_days_with_mau_context_then_refreshes_today() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        // Days before every other test's data, so the 120 day window and the
        // retention prune cannot touch rows another test is building.
        let now = at(
            NaiveDate::from_ymd_opt(2099, 1, 1).expect("date")
                + Days::new((Uuid::new_v4().as_u128() % 300) as u64),
            12,
            0,
        );
        let context_community = community(&pool).await;
        let context_person = human(&pool, context_community).await;
        let context_day = now.date_naive() - Days::new(110);
        event(
            &pool,
            context_community,
            &context_person,
            at(context_day, 9, 0),
            9,
            None,
            "",
        )
        .await;
        let mut first = RollupSummary::default();
        for _ in 0..40 {
            first = db.run_metrics_rollup(now).await.expect("first pass");
            if first.ran {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert!(first.ran, "the rollup lease was never free");
        assert!(first.days >= 1);

        let today = now.date_naive();
        let finals: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM metrics_daily_active WHERE day >= $1 AND day < $2 AND is_final",
        )
        .bind(today - Days::new(BACKFILL_DAYS - 1))
        .bind(today)
        .fetch_one(&pool)
        .await
        .expect("finals");
        assert_eq!(finals, i64::try_from(BACKFILL_DAYS - 1).expect("days"));
        let earliest_chart_day = today - Days::new(89);
        let earliest_mau: i64 =
            sqlx::query_scalar("SELECT mau::bigint FROM metrics_daily_active WHERE day = $1")
                .bind(earliest_chart_day)
                .fetch_one(&pool)
                .await
                .expect("earliest chart MAU");
        assert_eq!(
            earliest_mau, 1,
            "the first 90-day point includes its prior 30 days"
        );
        let (_, _, _, today_final) = daily(&pool, today).await;
        assert!(!today_final, "today stays open until the nightly finalise");

        let mut second = RollupSummary::default();
        for _ in 0..40 {
            second = db.run_metrics_rollup(now).await.expect("second pass");
            if second.ran {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert!(second.ran);
        assert_eq!(second.days, 1, "a second pass only refreshes today");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn only_one_pod_runs_the_rollup_at_a_time() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        // Another pod holds the lease for the whole pass.
        let mut other = pool.begin().await.expect("other pod");
        let held: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(METRICS_ROLLUP_LOCK_KEY)
            .fetch_one(&mut *other)
            .await
            .expect("lock");
        if !held {
            // A parallel test run is mid-pass; the lease is demonstrably exclusive.
            return;
        }
        let blocked = db
            .run_metrics_rollup(Utc::now())
            .await
            .expect("blocked pass");
        assert_eq!(blocked, RollupSummary::default());
        other.rollback().await.expect("release");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boards_report_a_business_and_never_show_message_text() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let day = unique_day();
        let c = community(&pool).await;
        let owner = human(&pool, c).await;
        sqlx::query(
            "INSERT INTO relay_members (community_id, pubkey, role) VALUES ($1, $2, 'owner')",
        )
        .bind(c)
        .bind(hex::encode(&owner))
        .execute(&pool)
        .await
        .expect("member");
        let scout = agent(&pool, c, &owner, "Scout").await;
        let onboarding = OnboardingHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            revision: 1,
            status: OnboardingStatus::InProgress,
            lead_pubkey: hex::encode(&scout),
            steps: OnboardingStep::ALL
                .into_iter()
                .enumerate()
                .map(|(index, step)| StepStatus {
                    step,
                    state: match index {
                        0 => StepState::Done,
                        1 => StepState::Asked,
                        _ => StepState::Todo,
                    },
                })
                .collect(),
            question: Some(OpenQuestion {
                step: OnboardingStep::Money,
                text: SECRET.to_owned(),
                account: None,
            }),
            accounts: Vec::new(),
            map: None,
            started_at: at(day, 8, 0).timestamp(),
            resumed_at: None,
            resume_count: 0,
            completed_at: None,
            updated_by_pubkey: hex::encode(&owner),
            updated_at: at(day, 22, 0).timestamp(),
        };
        let onboarding_content = serde_json::to_string(&onboarding).expect("onboarding JSON");
        onboarding_head_event(&pool, c, &owner, at(day, 22, 0), &onboarding_content).await;
        let mut untrusted_head = onboarding.clone();
        untrusted_head.status = OnboardingStatus::Complete;
        untrusted_head.steps.iter_mut().for_each(|step| {
            step.state = StepState::Done;
        });
        let untrusted_content = serde_json::to_string(&untrusted_head).expect("untrusted JSON");
        onboarding_head_event(&pool, c, &scout, at(day, 23, 0), &untrusted_content).await;
        let room = Uuid::new_v4();
        let ask = event(&pool, c, &owner, at(day, 9, 0), 9, Some(room), SECRET).await;
        mention(&pool, c, &scout, &ask, at(day, 9, 0), room).await;
        event(&pool, c, &scout, at(day, 9, 1), 9, Some(room), SECRET).await;
        // Co-founder mode on, from the settings record; only its `enabled` flag is read.
        event(
            &pool,
            c,
            &owner,
            at(day, 8, 0),
            30670,
            None,
            "{\"settings\":{\"enabled\":true}}",
        )
        .await;
        for n in 0..2 {
            sqlx::query(
                "INSERT INTO cofounder_wakes \
                     (community_id, reason, dedupe_key, detail, status, outcome, created_at) \
                 VALUES ($1, 'daily_start', $2, $3, 'skipped', 'no Scout found', $4)",
            )
            .bind(c)
            .bind(format!("k{n}"))
            .bind(SECRET)
            .bind(at(day, 22, 0))
            .execute(&pool)
            .await
            .expect("wake");
        }

        let now = at(day, 23, 0);
        db.rollup_metrics_day(day, true, now + Days::new(1))
            .await
            .expect("rollup");

        let overview = db
            .admin_metrics_overview(30, 2000, now)
            .await
            .expect("overview");
        let listing = db
            .admin_metrics_businesses(30, &c.to_string(), "active", (50, 0), 2000, now)
            .await
            .expect("businesses");
        let detail = db
            .admin_metrics_business(c, 30, 2000, &owner, now)
            .await
            .expect("detail")
            .expect("business exists");
        let ai = db.admin_metrics_ai_usage(30, now).await.expect("ai");
        let health = db.admin_metrics_health(now).await.expect("health");
        for (name, board) in [
            ("overview", &overview),
            ("businesses", &listing),
            ("business", &detail),
            ("ai-usage", &ai),
            ("health", &health),
        ] {
            assert!(
                !board.to_string().contains(SECRET),
                "{name} must not carry message text"
            );
        }

        assert_eq!(listing["total"], 1);
        assert_eq!(listing["items"][0]["host"], format!("{c}.example"));
        assert_eq!(listing["items"][0]["cofounderOn"], true);
        assert_eq!(listing["items"][0]["health"], "bad");

        assert_eq!(detail["business"]["health"], "bad");
        assert_eq!(detail["cofounder"]["on"], true);
        assert_eq!(detail["cofounder"]["onboarding"]["status"], "in_progress");
        assert_eq!(detail["cofounder"]["onboarding"]["currentStep"], "money");
        assert_eq!(
            detail["cofounder"]["onboarding"]["currentStepState"],
            "asked"
        );
        assert_eq!(
            detail["cofounder"]["onboarding"]["steps"]
                .as_array()
                .map(Vec::len),
            Some(5)
        );
        let onboarding = &detail["cofounder"]["onboarding"];
        assert!(onboarding.get("question").is_none());
        assert!(onboarding.get("accounts").is_none());
        assert!(onboarding.get("map").is_none());
        assert!(onboarding.get("leadPubkey").is_none());
        assert!(onboarding.get("updatedByPubkey").is_none());
        assert_eq!(detail["cofounder"]["wakes"]["skipped"], 2);
        assert_eq!(
            detail["cofounder"]["skippedByOutcome"][0]["outcome"],
            "no Scout found"
        );
        assert_eq!(detail["agents"][0]["name"], "Scout");
        assert_eq!(detail["agents"][0]["answerRatePct"], 100.0);
        assert_eq!(detail["agents"][0]["avgAnswerSeconds"], 60);
        assert_eq!(detail["kpis"]["agents"], 1);
        assert_eq!(detail["people"]["byRole"][0]["role"], "owner");

        let keys: Vec<&str> = overview["needsAttention"]
            .as_array()
            .expect("list")
            .iter()
            .filter_map(|item| item["key"].as_str())
            .collect();
        assert!(keys.contains(&"cofounder_wakes_skipped"), "{keys:?}");
        for board in [
            "kpis",
            "series",
            "businesses",
            "agents",
            "ai",
            "discovery",
            "whatsapp",
        ] {
            assert!(overview.get(board).is_some(), "overview.{board}");
        }
        assert!(
            health["cofounderWakes"]["allTime"]["skipped"]
                .as_i64()
                .unwrap_or(0)
                >= 2
        );

        let missing = db
            .admin_metrics_business(Uuid::new_v4(), 30, 2000, &owner, now)
            .await
            .expect("lookup");
        assert!(missing.is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn operator_reads_are_recorded_without_the_query() {
        let pool = pool().await;
        let db = Db::from_pool(pool.clone());
        let actor = key();
        db.record_operator_read(&actor, "metrics/overview")
            .await
            .expect("audit");
        let row =
            sqlx::query("SELECT route FROM relay_operator_read_audit WHERE actor_pubkey = $1")
                .bind(&actor)
                .fetch_one(&pool)
                .await
                .expect("row");
        assert_eq!(row.get::<String, _>("route"), "metrics/overview");
    }
}
