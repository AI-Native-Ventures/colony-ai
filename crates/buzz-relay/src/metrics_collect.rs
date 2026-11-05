//! Live collectors and the rollup job behind the operator admin boards.
//!
//! Counts only. The HTTP and gateway counters are kept in memory and flushed to
//! Postgres every minute; a failed flush puts the counts back so nothing is
//! lost while the database is unreachable. App connections are written as they
//! happen; they are telemetry, so a failed write is logged and not retried.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, OnceLock, PoisonError};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tracing::{info, warn};

use crate::state::AppState;

/// Most distinct counter keys held between flushes. Routes are matched templates,
/// so this only bites if the database is unreachable for a long time.
const MAX_PENDING_KEYS: usize = 4096;

/// A server error, a client error and a request count for one route and hour.
type HttpCounts = (i64, i64, i64);

#[derive(Default)]
struct Pending {
    /// `(hour as unix seconds, route)` to `(requests, 4xx, 5xx)`.
    http: HashMap<(i64, String), HttpCounts>,
    /// `(hour as unix seconds, outcome, handed_on)` to requests.
    gateway: HashMap<(i64, String, bool), i64>,
}

static PENDING: LazyLock<Mutex<Pending>> = LazyLock::new(|| Mutex::new(Pending::default()));
static STARTED_AT: OnceLock<DateTime<Utc>> = OnceLock::new();

fn hour_of(now: DateTime<Utc>) -> i64 {
    now.timestamp().div_euclid(3600) * 3600
}

/// When this relay process started its metrics job, for the Health board.
pub fn started_at() -> Option<DateTime<Utc>> {
    STARTED_AT.get().copied()
}

/// Count one HTTP response for a matched route template.
pub fn record_http(route: &str, status: u16) {
    let hour = hour_of(Utc::now());
    let mut pending = PENDING.lock().unwrap_or_else(PoisonError::into_inner);
    let key = (hour, route.to_owned());
    if pending.http.len() >= MAX_PENDING_KEYS && !pending.http.contains_key(&key) {
        return;
    }
    let counts = pending.http.entry(key).or_insert((0, 0, 0));
    counts.0 += 1;
    if (400..500).contains(&status) {
        counts.1 += 1;
    } else if status >= 500 {
        counts.2 += 1;
    }
}

/// Count one finished free AI gateway request: how it ended, and whether more than one model was called.
pub fn record_gateway(outcome: &str, handed_on: bool) {
    let hour = hour_of(Utc::now());
    let mut pending = PENDING.lock().unwrap_or_else(PoisonError::into_inner);
    let key = (hour, outcome.to_owned(), handed_on);
    if pending.gateway.len() >= MAX_PENDING_KEYS && !pending.gateway.contains_key(&key) {
        return;
    }
    *pending.gateway.entry(key).or_insert(0) += 1;
}

/// The desktop's version from an AUTH event's `["client", "colony-desktop", "<version>"]` tag.
/// Anything that is not a short plain version string is ignored.
pub fn client_version_from_auth(event: &nostr::Event) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let parts = tag.as_slice();
        let version = match (parts.first(), parts.get(1), parts.get(2)) {
            (Some(name), Some(app), Some(version))
                if name == "client" && app == "colony-desktop" =>
            {
                version
            }
            _ => return None,
        };
        let plain = (1..=40).contains(&version.len())
            && version
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'));
        plain.then(|| version.clone())
    })
}

/// Record that `pubkey` authenticated a connection to a business. Best effort.
pub fn record_app_connection(
    state: &Arc<AppState>,
    community_id: uuid::Uuid,
    pubkey: Vec<u8>,
    app_version: Option<String>,
) {
    let db = state.db.clone();
    tokio::spawn(async move {
        if let Err(error) = db
            .record_app_connection(community_id, &pubkey, app_version.as_deref(), Utc::now())
            .await
        {
            warn!(%error, "could not record an app connection for the admin metrics");
        }
    });
}

/// Write the in-memory counters to Postgres. On failure the counts go back into memory.
pub async fn flush(db: &buzz_db::Db) {
    let (http, gateway) = {
        let mut pending = PENDING.lock().unwrap_or_else(PoisonError::into_inner);
        (
            std::mem::take(&mut pending.http),
            std::mem::take(&mut pending.gateway),
        )
    };
    for ((hour, route), counts) in http {
        let Some(at) = DateTime::from_timestamp(hour, 0) else {
            continue;
        };
        if let Err(error) = db
            .add_http_metrics(at, &route, counts.0, counts.1, counts.2)
            .await
        {
            warn!(%error, "http counters not saved, keeping them for the next flush");
            let mut pending = PENDING.lock().unwrap_or_else(PoisonError::into_inner);
            let entry = pending.http.entry((hour, route)).or_insert((0, 0, 0));
            entry.0 += counts.0;
            entry.1 += counts.1;
            entry.2 += counts.2;
        }
    }
    for ((hour, outcome, handed_on), requests) in gateway {
        let Some(at) = DateTime::from_timestamp(hour, 0) else {
            continue;
        };
        if let Err(error) = db
            .add_gateway_outcomes(at, &outcome, handed_on, requests)
            .await
        {
            warn!(%error, "gateway counters not saved, keeping them for the next flush");
            let mut pending = PENDING.lock().unwrap_or_else(PoisonError::into_inner);
            *pending
                .gateway
                .entry((hour, outcome, handed_on))
                .or_insert(0) += requests;
        }
    }
}

/// Flush the counters every minute, for the life of the process.
pub async fn run_flush(state: Arc<AppState>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        flush(&state.db).await;
    }
}

/// Rebuild the admin rollups every 15 minutes, for the life of the process.
///
/// One pod at a time does the work (Postgres advisory lock inside the pass).
/// A failed pass is logged and tried again next cycle; every pass first fills any
/// missing or unfinished day, so a missed run repairs itself.
pub async fn run_rollup(state: Arc<AppState>) {
    let _ = STARTED_AT.set(Utc::now());
    tokio::time::sleep(Duration::from_secs(90)).await;
    let mut ticker = tokio::time::interval(Duration::from_secs(15 * 60));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        match state.db.run_metrics_rollup(Utc::now()).await {
            Ok(summary) if summary.ran => {
                info!(days = summary.days, "admin metrics rollup finished");
            }
            Ok(_) => {}
            Err(error) => warn!(%error, "admin metrics rollup failed, will retry next cycle"),
        }
    }
}
