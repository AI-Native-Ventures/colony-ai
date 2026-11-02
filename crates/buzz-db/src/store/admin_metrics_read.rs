//! Operator admin metrics: read side.
//!
//! Every function returns the JSON shape documented in `docs/admin-api-contract.md`.
//! Everything here reads the precomputed `metrics_*` tables or small operational
//! tables (wakes, WhatsApp states, the AI journal). Nothing returns message
//! text: the settings read returns only `enabled`, and the onboarding read
//! returns only fixed progress enums from the relay-authored head.

use std::collections::{HashMap, HashSet};

use buzz_core::company_onboarding::{ONBOARDING_D_TAG, OnboardingHead, StepState};
use buzz_core::kind::KIND_ONBOARDING_HEAD;
use buzz_datastore_tracing::datastore_span;
use chrono::{DateTime, Datelike, Days, NaiveDate, Utc};
use serde_json::{Value, json};
use sqlx::Row as _;
use uuid::Uuid;

use super::admin_metrics::day_start;
use crate::Db;
use crate::error::Result;

/// Largest page of the businesses table.
pub const MAX_BUSINESS_PAGE: i64 = 200;

/// Sort orders accepted by the businesses table.
pub const BUSINESS_SORTS: [&str; 8] = [
    "active",
    "people",
    "agents",
    "ai",
    "discovery",
    "whatsapp",
    "created",
    "name",
];

/// Render nanousd as a USD decimal string with six places, rounded to the nearest micro-dollar.
pub fn usd_string(nanousd: i64) -> String {
    let micro = nanousd.saturating_add(500) / 1000;
    format!("{}.{:06}", micro / 1_000_000, micro % 1_000_000)
}

/// One decimal percentage, or `None` when there is nothing to divide by.
fn pct(numerator: i64, denominator: i64) -> Option<f64> {
    if denominator <= 0 {
        return None;
    }
    Some((numerator as f64 / denominator as f64 * 1000.0).round() / 10.0)
}

fn kpi(value: Option<impl Into<Value>>, previous: Option<impl Into<Value>>) -> Value {
    json!({
        "value": value.map(Into::into).unwrap_or(Value::Null),
        "previous": previous.map(Into::into).unwrap_or(Value::Null),
    })
}

fn back(day: NaiveDate, days: u64) -> NaiveDate {
    day - Days::new(days)
}

fn month_start(day: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(day.year(), day.month(), 1).unwrap_or(day)
}

fn range_json(days: i64, today: NaiveDate) -> Value {
    json!({
        "days": days,
        "from": back(today, u64::try_from(days.max(1) - 1).unwrap_or(0)),
        "to": today,
    })
}

fn version_key(version: &str) -> Vec<u32> {
    version
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u32>()
                .unwrap_or(0)
        })
        .collect()
}

fn attention(
    key: &str,
    severity: &str,
    title: &str,
    detail: String,
    count: i64,
    board: &str,
) -> Value {
    json!({
        "key": key,
        "severity": severity,
        "title": title,
        "detail": detail,
        "count": count,
        "link": { "board": board, "params": {} },
    })
}

/// A row of `metrics_daily_active`.
struct DayRow {
    day: NaiveDate,
    dau: i64,
    wau: i64,
    mau: i64,
    people_total: i64,
    new_accounts: i64,
    businesses_total: i64,
    businesses_archived: i64,
    businesses_active_7d: i64,
    businesses_created: i64,
    agents_total: i64,
    agents_scout: i64,
    agents_active_7d: i64,
    agents_never_started: i64,
    is_final: bool,
}

/// Business identity: name, host, owner.
struct BusinessBase {
    id: Uuid,
    host: String,
    created_at: DateTime<Utc>,
    archived: bool,
    name: String,
    owner_name: Option<String>,
}

impl Db {
    /// Whether co-founder mode is on, per business. `None` means the settings
    /// record exists but could not be read. Only the `enabled` flag is taken
    /// from the record; nothing else leaves this function.
    async fn cofounder_flags(&self) -> Result<HashMap<Uuid, Option<bool>>> {
        let rows: Vec<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT c.id, h.content \
               FROM communities c \
               LEFT JOIN LATERAL ( \
                    SELECT e.content FROM events e \
                     WHERE e.community_id = c.id AND e.kind = 30670 AND e.deleted_at IS NULL \
                     ORDER BY e.created_at DESC LIMIT 1) h ON true \
              WHERE c.deleted_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, content)| {
                let enabled = match content {
                    None => Some(false),
                    Some(text) => serde_json::from_str::<Value>(&text).ok().and_then(|value| {
                        value.pointer("/settings/enabled").and_then(Value::as_bool)
                    }),
                };
                (id, enabled)
            })
            .collect())
    }

    /// Return only the safe progress enums from the current relay-authored
    /// onboarding head. Questions, requested accounts, map proposals and
    /// pubkeys stay inside the stored event and never leave this query.
    async fn onboarding_progress(
        &self,
        community_id: Uuid,
        relay_pubkey: &[u8],
    ) -> Result<Option<Value>> {
        let content: Option<String> = sqlx::query_scalar(
            "SELECT content FROM events \
              WHERE community_id = $1 AND kind = $2 AND pubkey = $3 \
                AND d_tag = $4 AND channel_id IS NULL AND deleted_at IS NULL \
              ORDER BY created_at DESC, id ASC LIMIT 1",
        )
        .bind(community_id)
        .bind(KIND_ONBOARDING_HEAD as i32)
        .bind(relay_pubkey)
        .bind(ONBOARDING_D_TAG)
        .fetch_optional(&self.pool)
        .await?;
        let Some(content) = content else {
            return Ok(None);
        };
        let head: OnboardingHead = serde_json::from_str(&content)?;
        let current = head
            .steps
            .iter()
            .find(|step| !matches!(step.state, StepState::Done | StepState::Skipped));
        let current_step = current.map(|step| step.step);
        let current_step_state = current.map(|step| step.state);
        Ok(Some(json!({
            "status": head.status,
            "currentStep": current_step,
            "currentStepState": current_step_state,
            "steps": head.steps,
        })))
    }

    async fn business_bases(&self, only: Option<Uuid>) -> Result<Vec<BusinessBase>> {
        let rows = sqlx::query(
            "SELECT c.id, c.host, c.created_at, (c.archived_at IS NOT NULL) AS archived, \
                    ch.name AS business_name, \
                    (SELECT NULLIF(btrim(u.display_name), '') \
                       FROM relay_members m \
                       JOIN users u ON u.community_id = m.community_id \
                                   AND encode(u.pubkey, 'hex') = m.pubkey \
                      WHERE m.community_id = c.id AND m.role = 'owner' \
                      ORDER BY m.created_at LIMIT 1) AS owner_name \
               FROM communities c \
               LEFT JOIN channels ch ON ch.community_id = c.id AND ch.id = c.business_channel_id \
              WHERE c.deleted_at IS NULL AND ($1::uuid IS NULL OR c.id = $1) \
              ORDER BY c.created_at",
        )
        .bind(only)
        .fetch_all(&self.pool)
        .await?;
        let mut bases = Vec::with_capacity(rows.len());
        for row in rows {
            let host: String = row.try_get("host")?;
            let business_name: Option<String> = row.try_get("business_name")?;
            let name = business_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| host.clone());
            bases.push(BusinessBase {
                id: row.try_get("id")?,
                host,
                created_at: row.try_get("created_at")?,
                archived: row.try_get("archived")?,
                name,
                owner_name: row.try_get("owner_name")?,
            });
        }
        Ok(bases)
    }

    async fn day_rows(&self, from: NaiveDate, to: NaiveDate) -> Result<Vec<DayRow>> {
        let rows = sqlx::query(
            "SELECT day, dau::bigint AS dau, wau::bigint AS wau, mau::bigint AS mau, \
                    people_total::bigint AS people_total, new_accounts::bigint AS new_accounts, \
                    businesses_total::bigint AS businesses_total, \
                    businesses_archived::bigint AS businesses_archived, \
                    businesses_active_7d::bigint AS businesses_active_7d, \
                    businesses_created::bigint AS businesses_created, \
                    agents_total::bigint AS agents_total, agents_scout::bigint AS agents_scout, \
                    agents_active_7d::bigint AS agents_active_7d, \
                    agents_never_started::bigint AS agents_never_started, is_final \
               FROM metrics_daily_active WHERE day >= $1 AND day <= $2 ORDER BY day",
        )
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(DayRow {
                day: row.try_get("day")?,
                dau: row.try_get("dau")?,
                wau: row.try_get("wau")?,
                mau: row.try_get("mau")?,
                people_total: row.try_get("people_total")?,
                new_accounts: row.try_get("new_accounts")?,
                businesses_total: row.try_get("businesses_total")?,
                businesses_archived: row.try_get("businesses_archived")?,
                businesses_active_7d: row.try_get("businesses_active_7d")?,
                businesses_created: row.try_get("businesses_created")?,
                agents_total: row.try_get("agents_total")?,
                agents_scout: row.try_get("agents_scout")?,
                agents_active_7d: row.try_get("agents_active_7d")?,
                agents_never_started: row.try_get("agents_never_started")?,
                is_final: row.try_get("is_final")?,
            });
        }
        Ok(out)
    }

    /// Newest day with a finished rollup, for `dataThrough`.
    async fn data_through(&self) -> Result<Option<NaiveDate>> {
        Ok(
            sqlx::query_scalar("SELECT max(day) FROM metrics_daily_active WHERE is_final")
                .fetch_one(&self.pool)
                .await?,
        )
    }

    /// Mentions and answers inside `[from, to]`.
    async fn answer_totals(&self, from: NaiveDate, to: NaiveDate) -> Result<(i64, i64)> {
        let row: (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(sum(mentions), 0)::bigint, COALESCE(sum(answered_5m), 0)::bigint \
               FROM metrics_agent_daily WHERE day >= $1 AND day <= $2",
        )
        .bind(from)
        .bind(to)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    /// Latest app version per person over the last 7 days, as `(version, people)` pairs.
    async fn desktop_versions(&self, today: NaiveDate) -> Result<Vec<(String, i64)>> {
        Ok(sqlx::query_as(
            "SELECT v.app_version, count(*)::bigint FROM ( \
                SELECT DISTINCT ON (pubkey) pubkey, app_version \
                  FROM metrics_app_sessions_daily \
                 WHERE day > $1 AND app_version IS NOT NULL \
                 ORDER BY pubkey, day DESC, last_seen_at DESC) v \
              GROUP BY v.app_version ORDER BY count(*) DESC, v.app_version DESC LIMIT 30",
        )
        .bind(back(today, 7))
        .fetch_all(&self.pool)
        .await?)
    }

    /// Businesses flagged bad and warn, for the table's health dot.
    async fn business_flags(&self, now: DateTime<Utc>) -> Result<(HashSet<Uuid>, HashSet<Uuid>)> {
        let today = now.date_naive();
        let day_ago = now - chrono::TimeDelta::hours(24);
        let hour_ago = now - chrono::TimeDelta::hours(1);
        let mut bad: HashSet<Uuid> = HashSet::new();
        let wakes: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT DISTINCT community_id FROM cofounder_wakes \
              WHERE (status = 'skipped' AND created_at >= $1) \
                 OR (status = 'pending' AND created_at < $2)",
        )
        .bind(day_ago)
        .bind(hour_ago)
        .fetch_all(&self.pool)
        .await?;
        bad.extend(wakes.into_iter().map(|row| row.0));
        let silent: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT DISTINCT community_id FROM metrics_agent_daily \
              WHERE day >= $1 AND mentions > answered_5m",
        )
        .bind(back(today, 1))
        .fetch_all(&self.pool)
        .await?;
        bad.extend(silent.into_iter().map(|row| row.0));

        let mut warn: HashSet<Uuid> = HashSet::new();
        let failed: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT DISTINCT community_id FROM whatsapp_messages \
              WHERE state = 'failed' AND updated_at >= $1",
        )
        .bind(day_ago)
        .fetch_all(&self.pool)
        .await?;
        warn.extend(failed.into_iter().map(|row| row.0));
        let refused: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT DISTINCT community_id FROM metrics_ai_daily WHERE day >= $1 AND rejected > 0",
        )
        .bind(back(today, 1))
        .fetch_all(&self.pool)
        .await?;
        warn.extend(refused.into_iter().map(|row| row.0));
        let active: Vec<(Uuid,)> =
            sqlx::query_as("SELECT DISTINCT community_id FROM metrics_person_daily WHERE day > $1")
                .bind(back(today, 7))
                .fetch_all(&self.pool)
                .await?;
        let active: HashSet<Uuid> = active.into_iter().map(|row| row.0).collect();
        let all: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM communities WHERE deleted_at IS NULL AND archived_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await?;
        warn.extend(
            all.into_iter()
                .map(|row| row.0)
                .filter(|id| !active.contains(id)),
        );
        Ok((bad, warn))
    }

    /// The "needs attention" list shared by Overview and Health.
    #[datastore_span(name = "admin_metrics_needs_attention", system = "postgresql")]
    pub async fn admin_metrics_needs_attention(&self, now: DateTime<Utc>) -> Result<Vec<Value>> {
        let today = now.date_naive();
        let day_ago = now - chrono::TimeDelta::hours(24);
        let mut items: Vec<Value> = Vec::new();

        let wakes: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT count(*) FILTER (WHERE status = 'skipped' AND created_at >= $1)::bigint, \
                    count(*) FILTER (WHERE status = 'skipped')::bigint, \
                    count(*) FILTER (WHERE status = 'delivered')::bigint, \
                    count(*) FILTER (WHERE status = 'pending' AND created_at < $2)::bigint \
               FROM cofounder_wakes",
        )
        .bind(day_ago)
        .bind(now - chrono::TimeDelta::hours(1))
        .fetch_one(&self.pool)
        .await?;
        let (skipped_day, skipped_all, delivered_all, stuck) = wakes;
        if skipped_day > 0 || (skipped_all > 0 && delivered_all == 0) {
            let top: Option<String> = sqlx::query_scalar(
                "SELECT outcome FROM cofounder_wakes WHERE status = 'skipped' AND outcome <> '' \
                  GROUP BY outcome ORDER BY count(*) DESC, outcome LIMIT 1",
            )
            .fetch_optional(&self.pool)
            .await?;
            let count = if skipped_day > 0 {
                skipped_day
            } else {
                skipped_all
            };
            let mut detail = format!("{count} skipped, {delivered_all} delivered");
            if let Some(reason) = top {
                detail.push_str(&format!(": {reason}"));
            }
            items.push(attention(
                "cofounder_wakes_skipped",
                "red",
                "Co-founder wakes",
                detail,
                count,
                "health",
            ));
        }
        if stuck > 0 {
            items.push(attention(
                "cofounder_wakes_stuck",
                "red",
                "Co-founder wakes stuck",
                format!("{stuck} pending for more than an hour"),
                stuck,
                "health",
            ));
        }

        let silent: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT community_id)::bigint FROM metrics_agent_daily \
              WHERE day >= $1 AND mentions > answered_5m",
        )
        .bind(back(today, 1))
        .fetch_one(&self.pool)
        .await?;
        if silent > 0 {
            items.push(attention(
                "agents_not_answering",
                "red",
                "Agents not answering",
                format!("{silent} businesses: a mention waited more than 5 minutes"),
                silent,
                "businesses",
            ));
        }

        let ai_stuck: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM account_ai_requests \
              WHERE status = 'pending' AND created_at < $1",
        )
        .bind(now - chrono::TimeDelta::minutes(15))
        .fetch_one(&self.pool)
        .await?;
        if ai_stuck > 0 {
            items.push(attention(
                "ai_requests_stuck",
                "red",
                "Free AI requests stuck",
                format!("{ai_stuck} pending for more than 15 minutes"),
                ai_stuck,
                "ai-usage",
            ));
        }

        let outcomes: (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(sum(requests), 0)::bigint, \
                    COALESCE(sum(requests) FILTER (WHERE outcome IN ('upstream_rejected', 'upstream_unclear')), 0)::bigint \
               FROM metrics_gateway_outcomes_hourly WHERE hour >= $1",
        )
        .bind(day_start(today))
        .fetch_one(&self.pool)
        .await?;
        if outcomes.0 >= 20 {
            if let Some(share) = pct(outcomes.1, outcomes.0).filter(|share| *share >= 5.0) {
                items.push(attention(
                    "gateway_refusals",
                    "amber",
                    "Free AI refusals",
                    format!("{share}% of gateway requests refused or timed out today"),
                    outcomes.1,
                    "ai-usage",
                ));
            }
        }

        let server_errors: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(errors_5xx), 0)::bigint FROM metrics_http_hourly WHERE hour >= $1",
        )
        .bind(day_ago - chrono::TimeDelta::hours(1))
        .fetch_one(&self.pool)
        .await?;
        if server_errors > 0 {
            items.push(attention(
                "relay_5xx",
                if server_errors >= 50 { "red" } else { "amber" },
                "Relay errors",
                format!("{server_errors} server errors in 24 hours"),
                server_errors,
                "health",
            ));
        }

        let whatsapp_failed: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM whatsapp_messages WHERE state = 'failed' AND updated_at >= $1",
        )
        .bind(day_start(today))
        .fetch_one(&self.pool)
        .await?;
        if whatsapp_failed > 0 {
            items.push(attention(
                "whatsapp_failed",
                "amber",
                "WhatsApp sends",
                format!("{whatsapp_failed} failed today"),
                whatsapp_failed,
                "health",
            ));
        }

        let versions = self.desktop_versions(today).await?;
        let newest = versions
            .iter()
            .filter(|(_, people)| *people >= 2)
            .map(|(version, _)| version.as_str())
            .max_by_key(|version| version_key(version));
        if let Some(newest) = newest {
            let newest_key = version_key(newest);
            let old: i64 = versions
                .iter()
                .filter(|(version, _)| version_key(version) < newest_key)
                .map(|(_, people)| *people)
                .sum();
            if old > 0 {
                items.push(attention(
                    "old_app_versions",
                    "amber",
                    "Old app versions",
                    format!("{old} people still on an app older than {newest}"),
                    old,
                    "health",
                ));
            }
        }

        items.sort_by(|a, b| {
            let rank = |item: &Value| i32::from(item["severity"] != "red");
            rank(a)
                .cmp(&rank(b))
                .then_with(|| b["count"].as_i64().cmp(&a["count"].as_i64()))
        });
        Ok(items)
    }

    /// Overview board.
    #[datastore_span(name = "admin_metrics_overview", system = "postgresql")]
    pub async fn admin_metrics_overview(
        &self,
        days: i64,
        discovery_cap: i64,
        now: DateTime<Utc>,
    ) -> Result<Value> {
        let today = now.date_naive();
        let window = u64::try_from(days.max(1)).unwrap_or(30);
        let from = back(today, window - 1);
        let rows = self.day_rows(back(today, window.max(31)), today).await?;
        let at = |day: NaiveDate| rows.iter().find(|row| row.day == day);
        let latest = rows.last();
        let week_ago = at(back(today, 7));
        let month_ago = at(back(today, 30));
        let stick = |row: Option<&DayRow>| row.and_then(|row| pct(row.dau, row.mau));

        let sum_new = |lo: NaiveDate, hi: NaiveDate| -> i64 {
            rows.iter()
                .filter(|row| row.day > lo && row.day <= hi)
                .map(|row| row.new_accounts)
                .sum()
        };
        let created_week: i64 = rows
            .iter()
            .filter(|row| row.day > back(today, 7))
            .map(|row| row.businesses_created)
            .sum();

        let series: Vec<Value> = rows
            .iter()
            .filter(|row| row.day >= from)
            .map(|row| {
                json!({
                    "day": row.day, "dau": row.dau, "wau": row.wau, "mau": row.mau,
                    "newAccounts": row.new_accounts, "partial": !row.is_final,
                })
            })
            .collect();

        let (mentions, answered) = self.answer_totals(back(today, 6), today).await?;
        let flags = self.cofounder_flags().await?;
        let cofounder_on = flags.values().filter(|on| **on == Some(true)).count();

        let month = month_start(today);
        let models: Vec<(Option<String>, i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT NULLIF(model, ''), sum(requests)::bigint, sum(input_tokens)::bigint, \
                    sum(output_tokens)::bigint, sum(charged_nanousd)::bigint \
               FROM metrics_ai_daily WHERE day >= $1 GROUP BY model ORDER BY sum(requests) DESC",
        )
        .bind(month)
        .fetch_all(&self.pool)
        .await?;
        let requests: i64 = models.iter().map(|m| m.1).sum();
        let input: i64 = models.iter().map(|m| m.2).sum();
        let output: i64 = models.iter().map(|m| m.3).sum();
        let charged: i64 = models.iter().map(|m| m.4).sum();
        let by_model: Vec<Value> = models
            .iter()
            .take(3)
            .map(|m| json!({ "model": m.0.clone().unwrap_or_else(|| "unknown".to_owned()), "requests": m.1 }))
            .collect();

        let discovery: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(results), 0)::bigint FROM discovery_usage WHERE month = $1",
        )
        .bind(month)
        .fetch_one(&self.pool)
        .await?;
        let month_begin = day_start(month);
        let sent: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM whatsapp_messages \
              WHERE direction = 'out' AND state IN ('sent', 'delivered', 'read') AND sent_at >= $1",
        )
        .bind(month_begin)
        .fetch_one(&self.pool)
        .await?;
        let replied: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT (community_id, wa_id))::bigint FROM whatsapp_messages \
              WHERE direction = 'in' AND created_at >= $1",
        )
        .bind(month_begin)
        .fetch_one(&self.pool)
        .await?;

        let needs = self.admin_metrics_needs_attention(now).await?;
        let through = self.data_through().await?;
        Ok(json!({
            "generatedAt": now,
            "dataThrough": through,
            "range": range_json(days, today),
            "kpis": {
                "people": kpi(latest.map(|r| r.people_total), week_ago.map(|r| r.people_total)),
                "dau": kpi(latest.map(|r| r.dau), week_ago.map(|r| r.dau)),
                "wau": kpi(latest.map(|r| r.wau), week_ago.map(|r| r.wau)),
                "mau": kpi(latest.map(|r| r.mau), month_ago.map(|r| r.mau)),
                "stickinessPct": kpi(stick(latest), stick(week_ago)),
                "newAccounts": kpi(Some(sum_new(back(today, 7), today)), Some(sum_new(back(today, 14), back(today, 7)))),
            },
            "series": series,
            "businesses": {
                "total": latest.map_or(0, |r| r.businesses_total),
                "archived": latest.map_or(0, |r| r.businesses_archived),
                "activeThisWeek": latest.map_or(0, |r| r.businesses_active_7d),
                "createdThisWeek": created_week,
                "cofounderOn": cofounder_on,
            },
            "agents": {
                "total": latest.map_or(0, |r| r.agents_total),
                "scout": latest.map_or(0, |r| r.agents_scout),
                "activeThisWeek": latest.map_or(0, |r| r.agents_active_7d),
                "answerWithin5MinPct": pct(answered, mentions),
                "neverStarted": latest.map_or(0, |r| r.agents_never_started),
            },
            "ai": {
                "month": format!("{:04}-{:02}", month.year(), month.month()),
                "requests": requests, "inputTokens": input, "outputTokens": output,
                "chargedUsd": usd_string(charged),
                "byModel": by_model,
            },
            "discovery": { "resultsThisMonth": discovery, "capPerBusiness": discovery_cap, "repeatsSkipped": Value::Null },
            "whatsapp": { "sentThisMonth": sent, "repliedThisMonth": replied },
            "needsAttention": needs,
            "unavailable": ["discovery.repeatsSkipped"],
        }))
    }

    /// Businesses table.
    #[datastore_span(name = "admin_metrics_businesses", system = "postgresql")]
    pub async fn admin_metrics_businesses(
        &self,
        days: i64,
        query: &str,
        sort: &str,
        page: (i64, i64),
        discovery_cap: i64,
        now: DateTime<Utc>,
    ) -> Result<Value> {
        let (limit, offset) = page;
        let today = now.date_naive();
        let from = back(today, u64::try_from(days.max(1) - 1).unwrap_or(0));
        let bases = self.business_bases(None).await?;
        let flags = self.cofounder_flags().await?;
        let (bad, warn) = self.business_flags(now).await?;

        let people: Vec<(Uuid, i64, i64)> = sqlx::query_as(
            "SELECT community_id, \
                    count(*) FILTER (WHERE agent_type IS NULL AND agent_owner_pubkey IS NULL AND deactivated_at IS NULL)::bigint, \
                    count(*) FILTER (WHERE (agent_type IS NOT NULL OR agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(agent_type, '')) <> 'worker' AND deactivated_at IS NULL)::bigint \
               FROM users GROUP BY community_id",
        )
        .fetch_all(&self.pool)
        .await?;
        let people: HashMap<Uuid, (i64, i64)> =
            people.into_iter().map(|r| (r.0, (r.1, r.2))).collect();
        let active: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT community_id, count(DISTINCT day)::bigint FROM metrics_person_daily \
              WHERE day > $1 GROUP BY community_id",
        )
        .bind(back(today, 7))
        .fetch_all(&self.pool)
        .await?;
        let active: HashMap<Uuid, i64> = active.into_iter().collect();
        let ai: Vec<(Uuid, i64, i64)> = sqlx::query_as(
            "SELECT community_id, sum(requests)::bigint, sum(charged_nanousd)::bigint \
               FROM metrics_ai_daily WHERE day >= $1 AND day <= $2 GROUP BY community_id",
        )
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let ai: HashMap<Uuid, (i64, i64)> = ai.into_iter().map(|r| (r.0, (r.1, r.2))).collect();
        let discovery: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT community_id, results::bigint FROM discovery_usage WHERE month = $1",
        )
        .bind(month_start(today))
        .fetch_all(&self.pool)
        .await?;
        let discovery: HashMap<Uuid, i64> = discovery.into_iter().collect();
        let whatsapp: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT community_id, count(*)::bigint FROM whatsapp_messages \
              WHERE direction = 'out' AND state IN ('sent', 'delivered', 'read') AND sent_at >= $1 \
              GROUP BY community_id",
        )
        .bind(day_start(from))
        .fetch_all(&self.pool)
        .await?;
        let whatsapp: HashMap<Uuid, i64> = whatsapp.into_iter().collect();

        struct Line {
            sort_active: i64,
            sort_name: String,
            sort_created: DateTime<Utc>,
            sort_people: i64,
            sort_agents: i64,
            sort_ai: i64,
            sort_discovery: i64,
            sort_whatsapp: i64,
            json: Value,
        }
        let needle = query.trim().to_lowercase();
        let mut lines: Vec<Line> = Vec::new();
        for base in &bases {
            let (humans, agents) = people.get(&base.id).copied().unwrap_or((0, 0));
            let active_days = active.get(&base.id).copied().unwrap_or(0);
            let (ai_requests, ai_charged) = ai.get(&base.id).copied().unwrap_or((0, 0));
            let discovery_used = discovery.get(&base.id).copied().unwrap_or(0);
            let sent = whatsapp.get(&base.id).copied().unwrap_or(0);
            if !needle.is_empty() {
                let haystack = format!(
                    "{} {} {}",
                    base.name.to_lowercase(),
                    base.host.to_lowercase(),
                    base.owner_name.clone().unwrap_or_default().to_lowercase()
                );
                if !haystack.contains(&needle) {
                    continue;
                }
            }
            let health = if bad.contains(&base.id) {
                "bad"
            } else if warn.contains(&base.id) {
                "warn"
            } else {
                "ok"
            };
            lines.push(Line {
                sort_active: active_days,
                sort_name: base.name.to_lowercase(),
                sort_created: base.created_at,
                sort_people: humans,
                sort_agents: agents,
                sort_ai: ai_requests,
                sort_discovery: discovery_used,
                sort_whatsapp: sent,
                json: json!({
                    "communityId": base.id,
                    "name": base.name,
                    "host": base.host,
                    "ownerName": base.owner_name,
                    "createdAt": base.created_at,
                    "archived": base.archived,
                    "people": humans,
                    "agents": agents,
                    "activeDaysLast7": active_days,
                    "aiRequests": ai_requests,
                    "aiChargedUsd": usd_string(ai_charged),
                    "discoveryResultsThisMonth": discovery_used,
                    "discoveryCap": discovery_cap,
                    "whatsappSentInRange": sent,
                    "cofounderOn": flags.get(&base.id).copied().flatten(),
                    "health": health,
                }),
            });
        }
        match sort {
            "people" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_people)),
            "agents" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_agents)),
            "ai" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_ai)),
            "discovery" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_discovery)),
            "whatsapp" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_whatsapp)),
            "created" => lines.sort_by_key(|b| std::cmp::Reverse(b.sort_created)),
            "name" => lines.sort_by(|a, b| a.sort_name.cmp(&b.sort_name)),
            _ => lines.sort_by(|a, b| {
                b.sort_active
                    .cmp(&a.sort_active)
                    .then_with(|| b.sort_people.cmp(&a.sort_people))
                    .then_with(|| a.sort_name.cmp(&b.sort_name))
            }),
        }
        let total = lines.len();
        let items: Vec<Value> = lines
            .into_iter()
            .skip(usize::try_from(offset.max(0)).unwrap_or(0))
            .take(usize::try_from(limit.clamp(1, MAX_BUSINESS_PAGE)).unwrap_or(100))
            .map(|line| line.json)
            .collect();
        let active_this_week = active.len();
        let through = self.data_through().await?;
        Ok(json!({
            "generatedAt": now,
            "dataThrough": through,
            "range": range_json(days, today),
            "total": total,
            "activeThisWeek": active_this_week,
            "items": items,
        }))
    }

    /// Business detail board. `None` when the business does not exist.
    #[datastore_span(name = "admin_metrics_business", system = "postgresql")]
    pub async fn admin_metrics_business(
        &self,
        community_id: Uuid,
        days: i64,
        discovery_cap: i64,
        relay_pubkey: &[u8],
        now: DateTime<Utc>,
    ) -> Result<Option<Value>> {
        let Some(base) = self.business_bases(Some(community_id)).await?.pop() else {
            return Ok(None);
        };
        let today = now.date_naive();
        let from = back(today, u64::try_from(days.max(1) - 1).unwrap_or(0));
        let week_start = back(today, 7);
        let flags = self.cofounder_flags().await?;
        let onboarding = self.onboarding_progress(community_id, relay_pubkey).await?;
        let (bad, warn) = self.business_flags(now).await?;
        let health = if bad.contains(&community_id) {
            "bad"
        } else if warn.contains(&community_id) {
            "warn"
        } else {
            "ok"
        };

        let owner_pubkey: Option<String> = sqlx::query_scalar(
            "SELECT left(pubkey, 8) FROM relay_members \
              WHERE community_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1",
        )
        .bind(community_id)
        .fetch_optional(&self.pool)
        .await?;

        let counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT count(*) FILTER (WHERE agent_type IS NULL AND agent_owner_pubkey IS NULL AND deactivated_at IS NULL)::bigint, \
                    count(*) FILTER (WHERE agent_type IS NULL AND agent_owner_pubkey IS NULL AND deactivated_at IS NULL AND created_at >= $2)::bigint, \
                    count(*) FILTER (WHERE (agent_type IS NOT NULL OR agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(agent_type, '')) <> 'worker' AND deactivated_at IS NULL)::bigint \
               FROM users WHERE community_id = $1",
        )
        .bind(community_id)
        .bind(now - chrono::TimeDelta::days(7))
        .fetch_one(&self.pool)
        .await?;

        let active_days: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT day)::bigint FROM metrics_person_daily \
              WHERE community_id = $1 AND day > $2",
        )
        .bind(community_id)
        .bind(week_start)
        .fetch_one(&self.pool)
        .await?;

        let roles: Vec<(String, i64, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT m.role, count(DISTINCT u.pubkey)::bigint, max(p.last_event_at) \
               FROM relay_members m \
               JOIN users u ON u.community_id = m.community_id AND encode(u.pubkey, 'hex') = m.pubkey \
                           AND u.agent_type IS NULL AND u.agent_owner_pubkey IS NULL AND u.deactivated_at IS NULL \
               LEFT JOIN metrics_person_daily p ON p.community_id = u.community_id AND p.pubkey = u.pubkey \
              WHERE m.community_id = $1 GROUP BY m.role",
        )
        .bind(community_id)
        .fetch_all(&self.pool)
        .await?;
        let mut by_role: Vec<Value> = Vec::new();
        for wanted in ["owner", "admin", "member"] {
            if let Some((role, count, last)) = roles.iter().find(|row| row.0 == wanted) {
                by_role.push(json!({ "role": role, "count": count, "lastActiveAt": last }));
            }
        }
        let stale: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM users u \
              WHERE u.community_id = $1 AND u.agent_type IS NULL AND u.agent_owner_pubkey IS NULL AND u.deactivated_at IS NULL \
                AND NOT EXISTS (SELECT 1 FROM metrics_person_daily p \
                                 WHERE p.community_id = u.community_id AND p.pubkey = u.pubkey AND p.day > $2)",
        )
        .bind(community_id)
        .bind(week_start)
        .fetch_one(&self.pool)
        .await?;

        let agent_rows = sqlx::query(
            "SELECT left(encode(u.pubkey, 'hex'), 8) AS short, NULLIF(btrim(u.display_name), '') AS name, \
                    u.agent_type, a.last_event_at, \
                    COALESCE(r.mentions, 0)::bigint AS mentions, COALESCE(r.answered, 0)::bigint AS answered, \
                    COALESCE(r.secs, 0)::bigint AS secs \
               FROM users u \
               LEFT JOIN (SELECT agent_pubkey, max(last_event_at) AS last_event_at \
                            FROM metrics_agent_daily WHERE community_id = $1 GROUP BY agent_pubkey) a \
                      ON a.agent_pubkey = u.pubkey \
               LEFT JOIN (SELECT agent_pubkey, sum(mentions) AS mentions, sum(answered_5m) AS answered, \
                                 sum(answer_seconds_sum) AS secs \
                            FROM metrics_agent_daily \
                           WHERE community_id = $1 AND day >= $2 AND day <= $3 GROUP BY agent_pubkey) r \
                      ON r.agent_pubkey = u.pubkey \
              WHERE u.community_id = $1 AND (u.agent_type IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL) AND lower(COALESCE(u.agent_type, '')) <> 'worker' AND u.deactivated_at IS NULL \
              ORDER BY u.created_at",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let mut agents: Vec<Value> = Vec::new();
        let mut agent_names: Vec<String> = Vec::new();
        for row in agent_rows {
            let last: Option<DateTime<Utc>> = row.try_get("last_event_at")?;
            let name: Option<String> = row.try_get("name")?;
            let mentions: i64 = row.try_get("mentions")?;
            let answered: i64 = row.try_get("answered")?;
            let secs: i64 = row.try_get("secs")?;
            let age = last.map(|at| now - at);
            let status = match age {
                Some(age) if age <= chrono::TimeDelta::minutes(30) => "running",
                Some(age) if age <= chrono::TimeDelta::days(7) => "idle",
                _ => "offline",
            };
            let offline_hours = match (status, age) {
                ("offline", Some(age)) => Some(age.num_hours()),
                _ => None,
            };
            if let Some(name) = &name {
                agent_names.push(name.clone());
            }
            let short: String = row.try_get("short")?;
            let runtime: Option<String> = row.try_get("agent_type")?;
            let avg_answer = if answered > 0 {
                Some(secs / answered)
            } else {
                None
            };
            agents.push(json!({
                "pubkeyShort": short,
                "name": name,
                "runtime": runtime,
                "status": status,
                "lastEventAt": last,
                "offlineHours": offline_hours,
                "answerRatePct": pct(answered, mentions),
                "avgAnswerSeconds": avg_answer,
            }));
        }

        let models: Vec<(Option<String>, i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT NULLIF(model, ''), sum(requests)::bigint, sum(input_tokens)::bigint, \
                    sum(output_tokens)::bigint, sum(charged_nanousd)::bigint \
               FROM metrics_ai_daily WHERE community_id = $1 AND day >= $2 AND day <= $3 \
              GROUP BY model ORDER BY sum(requests) DESC",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let ai_requests: i64 = models.iter().map(|m| m.1).sum();
        let ai_in: i64 = models.iter().map(|m| m.2).sum();
        let ai_out: i64 = models.iter().map(|m| m.3).sum();
        let ai_charged: i64 = models.iter().map(|m| m.4).sum();
        let rejected: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(rejected), 0)::bigint FROM metrics_ai_daily \
              WHERE community_id = $1 AND day >= $2 AND day <= $3",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_one(&self.pool)
        .await?;

        let discovery: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(results), 0)::bigint FROM discovery_usage \
              WHERE community_id = $1 AND month = $2",
        )
        .bind(community_id)
        .bind(month_start(today))
        .fetch_one(&self.pool)
        .await?;

        let wa: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT count(*) FILTER (WHERE direction = 'out' AND state IN ('sent', 'delivered', 'read'))::bigint, \
                    count(*) FILTER (WHERE direction = 'out' AND state IN ('delivered', 'read'))::bigint, \
                    count(*) FILTER (WHERE direction = 'out' AND state = 'read')::bigint, \
                    count(*) FILTER (WHERE direction = 'out' AND state = 'failed')::bigint, \
                    count(*) FILTER (WHERE direction = 'out' AND new_chat AND state IN ('sent', 'delivered', 'read'))::bigint, \
                    count(DISTINCT wa_id) FILTER (WHERE direction = 'in')::bigint \
               FROM whatsapp_messages WHERE community_id = $1 AND created_at >= $2",
        )
        .bind(community_id)
        .bind(day_start(from))
        .fetch_one(&self.pool)
        .await?;
        let failed_codes: Vec<(Option<String>, i64)> = sqlx::query_as(
            "SELECT error_code, count(*)::bigint FROM whatsapp_messages \
              WHERE community_id = $1 AND state = 'failed' AND created_at >= $2 \
              GROUP BY error_code ORDER BY count(*) DESC, error_code LIMIT 5",
        )
        .bind(community_id)
        .bind(day_start(from))
        .fetch_all(&self.pool)
        .await?;

        let wake_counts: Vec<(String, i64)> = sqlx::query_as(
            "SELECT status, count(*)::bigint FROM cofounder_wakes WHERE community_id = $1 GROUP BY status",
        )
        .bind(community_id)
        .fetch_all(&self.pool)
        .await?;
        let wake = |status: &str| {
            wake_counts
                .iter()
                .find(|row| row.0 == status)
                .map_or(0, |row| row.1)
        };
        let last_wake: Option<(DateTime<Utc>, String, String)> = sqlx::query_as(
            "SELECT created_at, status, reason FROM cofounder_wakes \
              WHERE community_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(community_id)
        .fetch_optional(&self.pool)
        .await?;
        let on_since: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT min(created_at) FROM cofounder_wakes WHERE community_id = $1 AND reason = 'mode_on'",
        )
        .bind(community_id)
        .fetch_one(&self.pool)
        .await?;
        let skipped_by: Vec<(String, i64)> = sqlx::query_as(
            "SELECT outcome, count(*)::bigint FROM cofounder_wakes \
              WHERE community_id = $1 AND status = 'skipped' \
              GROUP BY outcome ORDER BY count(*) DESC, outcome LIMIT 5",
        )
        .bind(community_id)
        .fetch_all(&self.pool)
        .await?;

        let people_by_day: Vec<(NaiveDate, i64)> = sqlx::query_as(
            "SELECT day, count(*)::bigint FROM metrics_person_daily \
              WHERE community_id = $1 AND day >= $2 AND day <= $3 GROUP BY day",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let agents_by_day: Vec<(NaiveDate, i64)> = sqlx::query_as(
            "SELECT day, count(*) FILTER (WHERE events > 0)::bigint FROM metrics_agent_daily \
              WHERE community_id = $1 AND day >= $2 AND day <= $3 GROUP BY day",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let ai_by_day: Vec<(NaiveDate, i64)> = sqlx::query_as(
            "SELECT day, sum(requests)::bigint FROM metrics_ai_daily \
              WHERE community_id = $1 AND day >= $2 AND day <= $3 GROUP BY day",
        )
        .bind(community_id)
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let lookup = |rows: &[(NaiveDate, i64)], day: NaiveDate| {
            rows.iter().find(|row| row.0 == day).map_or(0, |row| row.1)
        };
        let mut series: Vec<Value> = Vec::new();
        let mut day = from;
        while day <= today {
            series.push(json!({
                "day": day,
                "activePeople": lookup(&people_by_day, day),
                "agentsActive": lookup(&agents_by_day, day),
                "aiRequests": lookup(&ai_by_day, day),
                "partial": day == today,
            }));
            day = day + Days::new(1);
        }

        let through = self.data_through().await?;
        Ok(Some(json!({
            "generatedAt": now,
            "dataThrough": through,
            "range": range_json(days, today),
            "business": {
                "communityId": base.id, "name": base.name, "host": base.host,
                "ownerName": base.owner_name, "ownerPubkeyShort": owner_pubkey,
                "createdAt": base.created_at, "archived": base.archived, "health": health,
            },
            "kpis": {
                "people": counts.0, "newPeopleThisWeek": counts.1,
                "agents": counts.2, "agentNames": agent_names,
                "activeDaysLast7": active_days,
                "discoveryResultsThisMonth": discovery, "discoveryCap": discovery_cap,
                "whatsappSentInRange": wa.0, "whatsappRepliedInRange": wa.5,
            },
            "people": { "byRole": by_role, "staleMembers": stale },
            "agents": agents,
            "ai": {
                "requests": ai_requests, "inputTokens": ai_in, "outputTokens": ai_out,
                "chargedUsd": usd_string(ai_charged),
                "byModel": models.iter().map(|m| json!({
                    "model": m.0.clone().unwrap_or_else(|| "unknown".to_owned()),
                    "requests": m.1, "inputTokens": m.2, "outputTokens": m.3,
                    "chargedUsd": usd_string(m.4),
                })).collect::<Vec<Value>>(),
            },
            "discovery": { "resultsThisMonth": discovery, "cap": discovery_cap, "repeatsSkipped": Value::Null },
            "whatsapp": {
                "sent": wa.0, "delivered": wa.1, "read": wa.2, "failed": wa.3,
                "newChats": wa.4, "replied": wa.5,
                "failedByCode": failed_codes.iter().map(|row| json!({
                    "code": row.0.clone().unwrap_or_else(|| "unknown".to_owned()), "count": row.1,
                })).collect::<Vec<Value>>(),
            },
            "cofounder": {
                "on": flags.get(&community_id).copied().flatten(),
                "onSince": on_since,
                "onboarding": onboarding,
                "wakes": { "delivered": wake("delivered"), "skipped": wake("skipped"), "pending": wake("pending") },
                "lastWake": last_wake.map(|(at, status, reason)| json!({ "at": at, "status": status, "reason": reason })),
                "skippedByOutcome": skipped_by.iter().map(|row| json!({ "outcome": row.0, "count": row.1 })).collect::<Vec<Value>>(),
            },
            "problems": {
                "gatewayRefusals": rejected,
                "whatsappFailed": wa.3,
                "skippedWakes": wake("skipped"),
            },
            "series": series,
            "unavailable": ["discovery.repeatsSkipped"],
        })))
    }

    /// AI usage board.
    #[datastore_span(name = "admin_metrics_ai_usage", system = "postgresql")]
    pub async fn admin_metrics_ai_usage(&self, days: i64, now: DateTime<Utc>) -> Result<Value> {
        let today = now.date_naive();
        let window = u64::try_from(days.max(1)).unwrap_or(30);
        let from = back(today, window - 1);
        let prev_from = back(from, window);
        let prev_to = back(from, 1);

        let rows: Vec<(NaiveDate, Option<String>, i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT day, NULLIF(model, ''), sum(requests)::bigint, sum(input_tokens)::bigint, \
                    sum(output_tokens)::bigint, sum(charged_nanousd)::bigint \
               FROM metrics_ai_daily WHERE day >= $1 AND day <= $2 GROUP BY day, model",
        )
        .bind(prev_from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let model_name =
            |model: &Option<String>| model.clone().unwrap_or_else(|| "unknown".to_owned());
        let totals = |lo: NaiveDate, hi: NaiveDate| -> (i64, i64, i64, i64) {
            rows.iter()
                .filter(|row| row.0 >= lo && row.0 <= hi)
                .fold((0, 0, 0, 0), |acc, row| {
                    (acc.0 + row.2, acc.1 + row.3, acc.2 + row.4, acc.3 + row.5)
                })
        };
        let current = totals(from, today);
        let previous = totals(prev_from, prev_to);

        let mut per_model: HashMap<String, i64> = HashMap::new();
        for row in rows.iter().filter(|row| row.0 >= from) {
            *per_model.entry(model_name(&row.1)).or_insert(0) += row.2;
        }
        let mut ranked: Vec<(String, i64)> = per_model.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let shown: Vec<String> = ranked.iter().take(8).map(|row| row.0.clone()).collect();
        let folds_other = ranked.len() > shown.len();

        let mut series: Vec<Value> = Vec::new();
        let mut day = from;
        while day <= today {
            let mut by_model = serde_json::Map::new();
            let mut other: i64 = 0;
            let (mut requests, mut input, mut output, mut charged) = (0i64, 0i64, 0i64, 0i64);
            for row in rows.iter().filter(|row| row.0 == day) {
                requests += row.2;
                input += row.3;
                output += row.4;
                charged += row.5;
                let name = model_name(&row.1);
                if shown.contains(&name) {
                    let entry = by_model.entry(name).or_insert(json!(0));
                    *entry = json!(entry.as_i64().unwrap_or(0) + row.2);
                } else {
                    other += row.2;
                }
            }
            if other > 0 {
                by_model.insert("other".to_owned(), json!(other));
            }
            series.push(json!({
                "day": day, "requests": requests, "inputTokens": input, "outputTokens": output,
                "chargedUsd": usd_string(charged), "partial": day == today,
                "byModel": by_model,
            }));
            day = day + Days::new(1);
        }
        let mut models = shown.clone();
        if folds_other {
            models.push("other".to_owned());
        }

        let sessions = |lo: NaiveDate, hi: NaiveDate| {
            let query = sqlx::query_scalar::<sqlx::Postgres, i64>(
                "SELECT count(DISTINCT session_id)::bigint FROM account_ai_requests \
                  WHERE created_at >= $1 AND created_at < $2",
            )
            .bind(day_start(lo))
            .bind(day_start(hi) + Days::new(1));
            let pool = self.pool.clone();
            async move { query.fetch_one(&pool).await }
        };
        let sessions_now = sessions(from, today).await?;
        let sessions_before = sessions(prev_from, prev_to).await?;

        let outcome_rows: Vec<(DateTime<Utc>, String, bool, i64)> = sqlx::query_as(
            "SELECT hour, outcome, handed_on, requests FROM metrics_gateway_outcomes_hourly WHERE hour >= $1",
        )
        .bind(day_start(prev_from))
        .fetch_all(&self.pool)
        .await?;
        let fold = |lo: NaiveDate, hi: NaiveDate| -> (i64, i64, i64, i64, i64, bool) {
            let mut out = (0i64, 0i64, 0i64, 0i64, 0i64, false);
            for (hour, outcome, handed, requests) in &outcome_rows {
                if *hour < day_start(lo) || *hour >= day_start(hi) + Days::new(1) {
                    continue;
                }
                out.5 = true;
                match (outcome.as_str(), *handed) {
                    ("ok", false) => out.0 += requests,
                    ("ok", true) => out.1 += requests,
                    ("upstream_rejected", _) => out.2 += requests,
                    ("upstream_unclear", _) => out.3 += requests,
                    _ => out.4 += requests,
                }
            }
            out
        };
        let now_outcomes = fold(from, today);
        let before_outcomes = fold(prev_from, prev_to);
        let bad_pct =
            |o: (i64, i64, i64, i64, i64, bool)| pct(o.2 + o.3, o.0 + o.1 + o.2 + o.3 + o.4);
        let outcomes_json = if now_outcomes.5 {
            json!({
                "settled": now_outcomes.0, "handedToNextModel": now_outcomes.1,
                "refused": now_outcomes.2, "timedOut": now_outcomes.3, "other": now_outcomes.4,
            })
        } else {
            Value::Null
        };

        let top: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT community_id, sum(requests)::bigint FROM metrics_ai_daily \
              WHERE day >= $1 AND day <= $2 GROUP BY community_id ORDER BY sum(requests) DESC LIMIT 10",
        )
        .bind(from)
        .bind(today)
        .fetch_all(&self.pool)
        .await?;
        let names: HashMap<Uuid, String> = self
            .business_bases(None)
            .await?
            .into_iter()
            .map(|base| (base.id, base.name))
            .collect();
        let top_json: Vec<Value> = top
            .iter()
            .map(|(id, requests)| {
                json!({
                    "communityId": id,
                    "name": names.get(id).cloned().unwrap_or_else(|| "unknown".to_owned()),
                    "requests": requests,
                })
            })
            .collect();

        let through = self.data_through().await?;
        let mut unavailable: Vec<&str> = Vec::new();
        if !now_outcomes.5 {
            unavailable.push("gatewayOutcomes");
        }
        Ok(json!({
            "generatedAt": now,
            "dataThrough": through,
            "range": range_json(days, today),
            "kpis": {
                "requests": kpi(Some(current.0), Some(previous.0)),
                "inputTokens": kpi(Some(current.1), Some(previous.1)),
                "outputTokens": kpi(Some(current.2), Some(previous.2)),
                "chargedUsd": kpi(Some(usd_string(current.3)), Some(usd_string(previous.3))),
                "refusedOrTimedOutPct": kpi(bad_pct(now_outcomes), bad_pct(before_outcomes)),
                "sessions": kpi(Some(sessions_now), Some(sessions_before)),
            },
            "models": models,
            "series": series,
            "gatewayOutcomes": outcomes_json,
            "topBusinesses": top_json,
            "notCounted": "Own-AI use (Claude Code, Codex, OpenCode) runs on the person's Mac and never reaches Colony. Only the free AI gateway is counted.",
            "unavailable": unavailable,
        }))
    }

    /// Health board (database part). The relay adds its own version, start time and connection count.
    #[datastore_span(name = "admin_metrics_health", system = "postgresql")]
    pub async fn admin_metrics_health(&self, now: DateTime<Utc>) -> Result<Value> {
        let today = now.date_naive();
        let day_ago = now - chrono::TimeDelta::hours(24);

        let wakes_day: Vec<(String, i64)> = sqlx::query_as(
            "SELECT status, count(*)::bigint FROM cofounder_wakes WHERE created_at >= $1 GROUP BY status",
        )
        .bind(day_ago)
        .fetch_all(&self.pool)
        .await?;
        let wakes_all: Vec<(String, i64)> =
            sqlx::query_as("SELECT status, count(*)::bigint FROM cofounder_wakes GROUP BY status")
                .fetch_all(&self.pool)
                .await?;
        let wake_status = |rows: &[(String, i64)], status: &str| {
            rows.iter()
                .find(|row| row.0 == status)
                .map_or(0, |row| row.1)
        };
        let by_outcome: Vec<(String, String, i64, DateTime<Utc>)> = sqlx::query_as(
            "SELECT status, outcome, count(*)::bigint, max(created_at) FROM cofounder_wakes \
              GROUP BY status, outcome ORDER BY count(*) DESC, status, outcome LIMIT 20",
        )
        .fetch_all(&self.pool)
        .await?;

        let (mentions, answered) = self.answer_totals(back(today, 6), today).await?;
        let (prev_mentions, prev_answered) =
            self.answer_totals(back(today, 13), back(today, 7)).await?;
        let not_answering: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT community_id)::bigint FROM metrics_agent_daily \
              WHERE day >= $1 AND mentions > answered_5m",
        )
        .bind(back(today, 1))
        .fetch_one(&self.pool)
        .await?;

        let failed: (i64, i64) = sqlx::query_as(
            "SELECT count(*) FILTER (WHERE updated_at >= $1)::bigint, count(*)::bigint \
               FROM whatsapp_messages WHERE state = 'failed' AND updated_at >= $2",
        )
        .bind(day_start(today))
        .bind(day_start(back(today, 6)))
        .fetch_one(&self.pool)
        .await?;
        let failed_codes: Vec<(Option<String>, i64)> = sqlx::query_as(
            "SELECT error_code, count(*)::bigint FROM whatsapp_messages \
              WHERE state = 'failed' AND updated_at >= $1 \
              GROUP BY error_code ORDER BY count(*) DESC, error_code LIMIT 5",
        )
        .bind(day_start(today))
        .fetch_all(&self.pool)
        .await?;

        let hour_floor = day_ago - chrono::TimeDelta::hours(1);
        let errors_24h: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(errors_5xx), 0)::bigint FROM metrics_http_hourly WHERE hour >= $1",
        )
        .bind(hour_floor)
        .fetch_one(&self.pool)
        .await?;
        let by_route: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT route, sum(errors_5xx)::bigint, sum(requests)::bigint FROM metrics_http_hourly \
              WHERE hour >= $1 GROUP BY route HAVING sum(errors_5xx) > 0 \
              ORDER BY sum(errors_5xx) DESC, route LIMIT 10",
        )
        .bind(hour_floor)
        .fetch_all(&self.pool)
        .await?;

        let queues: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM cofounder_wakes WHERE status = 'pending')::bigint, \
                    (SELECT count(*) FROM account_ai_requests WHERE status = 'pending')::bigint, \
                    (SELECT count(*) FROM account_ai_requests WHERE status = 'pending' AND created_at < $1)::bigint, \
                    (SELECT count(*) FROM whatsapp_messages WHERE state IN ('queued', 'ready', 'sending'))::bigint",
        )
        .bind(now - chrono::TimeDelta::minutes(15))
        .fetch_one(&self.pool)
        .await?;

        let versions = self.desktop_versions(today).await?;
        let needs = self.admin_metrics_needs_attention(now).await?;
        let through = self.data_through().await?;

        let answer_pct = pct(answered, mentions);
        let answer_prev = pct(prev_answered, prev_mentions);
        let whatsapp_status = if failed.0 > 0 { "warn" } else { "ok" };
        let agents_status = if not_answering > 0 { "bad" } else { "ok" };
        Ok(json!({
            "generatedAt": now,
            "dataThrough": through,
            "cofounderWakes": {
                "last24h": {
                    "delivered": wake_status(&wakes_day, "delivered"),
                    "skipped": wake_status(&wakes_day, "skipped"),
                    "pending": wake_status(&wakes_day, "pending"),
                },
                "allTime": {
                    "delivered": wake_status(&wakes_all, "delivered"),
                    "skipped": wake_status(&wakes_all, "skipped"),
                    "pending": wake_status(&wakes_all, "pending"),
                },
                "byOutcome": by_outcome.iter().map(|row| json!({
                    "status": row.0, "outcome": row.1, "count": row.2, "lastAt": row.3,
                })).collect::<Vec<Value>>(),
            },
            "agents": {
                "answerWithin5MinPct": answer_pct,
                "previousPct": answer_prev,
                "businessesNotAnswering": not_answering,
            },
            "whatsapp": {
                "failedToday": failed.0,
                "failedLast7d": failed.1,
                "failedByCode": failed_codes.iter().map(|row| json!({
                    "code": row.0.clone().unwrap_or_else(|| "unknown".to_owned()), "count": row.1,
                })).collect::<Vec<Value>>(),
            },
            "relayErrors": {
                "last24h": errors_24h,
                "byRoute": by_route.iter().map(|row| json!({
                    "route": row.0, "errors5xx": row.1, "requests": row.2,
                })).collect::<Vec<Value>>(),
            },
            "queues": {
                "cofounderWakesPending": queues.0,
                "aiRequestsPending": queues.1,
                "aiRequestsStuck": queues.2,
                "whatsappQueued": queues.3,
            },
            "checks": [
                { "key": "database", "label": "Database", "status": "unknown", "value": "not collected" },
                { "key": "redis", "label": "Redis fan-out", "status": "unknown", "value": "not collected" },
                { "key": "whatsapp", "label": "WhatsApp sends", "status": whatsapp_status,
                  "value": format!("{} failed today", failed.0) },
                { "key": "discovery", "label": "Discovery provider", "status": "unknown", "value": "not collected" },
                { "key": "agents", "label": "Agents not answering", "status": agents_status,
                  "value": format!("{not_answering} businesses") },
            ],
            "desktopVersions": versions.iter().map(|row| json!({ "version": row.0, "people": row.1 })).collect::<Vec<Value>>(),
            "needsAttention": needs,
            "unavailable": ["relay.uptimePct7d", "checks.database", "checks.redis", "checks.discovery"],
        }))
    }
}
