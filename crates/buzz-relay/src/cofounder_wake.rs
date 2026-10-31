//! Wakes for Scout in co-founder mode (spec section 9).
//!
//! Scout moves work forward without being mentioned. The relay wakes it on a
//! daily start and on events: an inbound reply, a worker run that finished, an
//! approval that was given, a deadline that is near, and the moment co-founder
//! mode is switched on. A wake is a row in `cofounder_wakes`; a worker turns the
//! pending rows of a company into ONE short relay-signed message in the direct
//! message between Scout and its owner.
//!
//! The guards, each of them tested:
//! - **Off does nothing.** Nothing is queued while co-founder mode is off, and a
//!   wake queued before the switch went off is closed unsent.
//! - **Deduplicated.** Every wake has a key (`worker:<id>`, `approval:<ask id>`,
//!   `daily:<date>` ...); the same key queues once, ever.
//! - **No storms.** At most one wake message per company every five minutes,
//!   carrying everything pending (at most ten reasons), never one per event.
//! - **Bounded retry.** A failed delivery backs off and ends after eight
//!   attempts; a wake older than a day is closed as stale.
//!
//! A wake carries a reason and ids only, never text that came from outside the
//! company (a contact's name or message), so a stranger cannot put instructions
//! in front of Scout through a wake. A queued wake can be lost only if the
//! relay's database write itself fails; the daily start is the backstop.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Timelike, Utc};
use tracing::{error, info, warn};
use uuid::Uuid;

use buzz_core::business_records::{CompanyWorkItemHead, CompanyWorkStatus};
use buzz_core::company_members::{MemberKind, MemberPositionHead, MemberStatus};
use buzz_core::company_onboarding::{OnboardingHead, ONBOARDING_D_TAG};
use buzz_core::kind::{KIND_MEMBER_POSITION_HEAD, KIND_ONBOARDING_HEAD, KIND_WORK_ITEM_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::cofounder_wakes::PendingWake;
use buzz_db::EventQuery;

use crate::handlers::company_initiative::{cofounder_settings, load_head};
use crate::state::AppState;

/// Least time between two wake messages to the same company.
pub const MIN_WAKE_INTERVAL_SECS: i64 = 300;
/// Most reasons one wake message carries.
pub const MAX_WAKES_PER_MESSAGE: i64 = 10;
/// A wake older than this is closed unsent: the moment has passed.
pub const WAKE_STALE_SECS: i64 = 86_400;
/// Delivery attempts before a wake ends.
pub const MAX_DELIVERY_ATTEMPTS: i32 = 8;
/// Companies delivered to per worker pass.
const DELIVERY_BATCH: i64 = 50;
/// How often the worker looks for due wakes.
const POLL_INTERVAL: Duration = Duration::from_secs(30);
/// Polls between sweeps (daily start, deadlines, pruning): ten minutes.
const SWEEP_EVERY_POLLS: u32 = 20;
/// Companies read per sweep page.
const SWEEP_PAGE: i64 = 200;
/// Daily start fires from this UTC hour (08:00 in Johannesburg).
const DAILY_START_HOUR_UTC: u32 = 6;
/// A work item due within this many seconds wakes Scout.
const DEADLINE_WINDOW_SECS: i64 = 86_400;
/// Work item heads read per company per sweep.
const MAX_WORK_HEADS_PER_SWEEP: i64 = 500;
/// Finished wakes are kept this long, then pruned.
const KEEP_FINISHED_SECS: i64 = 30 * 86_400;
/// A wake whose `detail` starts with this carries the Friday of a weekly review
/// (`weekly-review:2026-10-30`). It uses the daily-start reason, so the queue's
/// reason list does not change, but it is worded and counted on its own.
pub const WEEKLY_REVIEW_DETAIL_PREFIX: &str = "weekly-review:";

/// Why Scout is being woken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeReason {
    /// Co-founder mode was just switched on.
    ModeOn,
    /// The start of the day.
    DailyStart,
    /// A contact replied to outreach.
    InboundReply,
    /// A worker run finished.
    WorkerFinished,
    /// An approval was given.
    ApprovalGiven,
    /// A work item is due soon.
    DeadlineNear,
}

impl WakeReason {
    /// The value stored in the `reason` column and in the message tag.
    pub const fn id(self) -> &'static str {
        match self {
            WakeReason::ModeOn => "mode_on",
            WakeReason::DailyStart => "daily_start",
            WakeReason::InboundReply => "inbound_reply",
            WakeReason::WorkerFinished => "worker_finished",
            WakeReason::ApprovalGiven => "approval_given",
            WakeReason::DeadlineNear => "deadline_near",
        }
    }

    fn from_id(id: &str) -> Option<Self> {
        [
            WakeReason::ModeOn,
            WakeReason::DailyStart,
            WakeReason::InboundReply,
            WakeReason::WorkerFinished,
            WakeReason::ApprovalGiven,
            WakeReason::DeadlineNear,
        ]
        .into_iter()
        .find(|reason| reason.id() == id)
    }

    /// What Scout is asked to do, in one short line.
    const fn instruction(self) -> &'static str {
        match self {
            WakeReason::ModeOn => {
                "Co-founder mode was just switched on. Read the cofounder and onboarding records, then start or resume onboarding."
            }
            WakeReason::DailyStart => {
                "Daily start. Look at what moved since yesterday and move the next thing forward."
            }
            WakeReason::InboundReply => {
                "A reply arrived in Outreach. Check it and make sure the right person handles it."
            }
            WakeReason::WorkerFinished => {
                "A worker finished. Review its output before anyone relies on it."
            }
            WakeReason::ApprovalGiven => {
                "An approval was given. Carry on with the approved step."
            }
            WakeReason::DeadlineNear => {
                "Work is due within a day. Check what is due and who has it."
            }
        }
    }
}

/// Queue a wake for Scout. Does nothing while co-founder mode is off, and
/// queues each `dedupe_key` once. `detail` is a short system-written note
/// (ids, never outside text). Never fails the caller: a failure is logged and
/// the daily start is the backstop.
pub async fn enqueue(
    state: &Arc<AppState>,
    community_id: CommunityId,
    reason: WakeReason,
    dedupe_key: &str,
    detail: &str,
) {
    match cofounder_settings(state, community_id).await {
        Ok(settings) if !settings.enabled => return,
        Ok(_) => {}
        // Fail open: the delivery worker checks again before anything is sent.
        Err(_) => warn!(
            community = %community_id.as_uuid(),
            "co-founder wake: could not read the settings, queueing anyway"
        ),
    }
    if let Err(error) = state
        .db
        .enqueue_cofounder_wake(*community_id.as_uuid(), reason.id(), dedupe_key, detail)
        .await
    {
        error!(
            community = %community_id.as_uuid(),
            reason = reason.id(),
            "co-founder wake could not be queued: {error}"
        );
    }
}

/// Run the wake worker forever: deliver due wakes every poll, sweep every ten minutes.
pub async fn run(state: Arc<AppState>) {
    info!("Co-founder wake worker started");
    let mut polls_until_sweep: u32 = 0;
    loop {
        let now = Utc::now();
        if let Err(error) = deliver_due(&state, now).await {
            error!("co-founder wake delivery pass failed: {error}");
        }
        if polls_until_sweep == 0 {
            if let Err(error) = sweep(&state, now).await {
                error!("co-founder wake sweep failed: {error}");
            }
            polls_until_sweep = SWEEP_EVERY_POLLS;
        }
        polls_until_sweep -= 1;
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Deliver every company's due wakes. Returns how many companies were looked at.
pub async fn deliver_due(state: &Arc<AppState>, now: DateTime<Utc>) -> Result<usize, String> {
    let communities = state
        .db
        .cofounder_wake_due_communities(now, DELIVERY_BATCH)
        .await
        .map_err(|error| format!("could not list due wakes: {error}"))?;
    let count = communities.len();
    for community in communities {
        if let Err(error) = deliver_one(state, community, now).await {
            warn!(%community, "co-founder wake delivery failed: {error}");
        }
    }
    Ok(count)
}

/// Deliver one company's due wakes as a single message.
pub(crate) async fn deliver_one(
    state: &Arc<AppState>,
    community: Uuid,
    now: DateTime<Utc>,
) -> Result<(), String> {
    // One deliverer per company at a time, across relay instances.
    let mut lock = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(|error| format!("could not begin the delivery lock: {error}"))?;
    let locked =
        sqlx::query_scalar::<_, bool>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("cofounder-wake:{community}"))
            .fetch_one(&mut *lock)
            .await
            .map_err(|error| format!("could not take the delivery lock: {error}"))?;
    if !locked {
        return Ok(());
    }

    let outcome = deliver_locked(state, community, now).await;
    // End the lock transaction here. A transaction that is only dropped frees
    // its advisory lock when sqlx's deferred rollback has run, which can lag
    // behind the next pass and turn that pass into a silent no-op.
    lock.rollback()
        .await
        .map_err(|error| format!("could not release the delivery lock: {error}"))?;
    outcome
}

/// The delivery pass itself, run while this process holds the company's lock.
async fn deliver_locked(
    state: &Arc<AppState>,
    community: Uuid,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let community_id = CommunityId::from_uuid(community);
    let pending = state
        .db
        .cofounder_pending_wakes(community, now, MAX_WAKES_PER_MESSAGE)
        .await
        .map_err(|error| format!("could not read pending wakes: {error}"))?;
    if pending.is_empty() {
        return Ok(());
    }

    // Off does nothing: close the wakes unsent.
    let settings = cofounder_settings(state, community_id)
        .await
        .map_err(|error| format!("could not read the co-founder settings: {error:?}"))?;
    if !settings.enabled {
        close(state, community, &pending, "co-founder mode is off").await?;
        return Ok(());
    }

    // A wake from yesterday is not news any more.
    let stale_before = now - chrono::Duration::seconds(WAKE_STALE_SECS);
    let (stale, fresh): (Vec<PendingWake>, Vec<PendingWake>) = pending
        .into_iter()
        .partition(|wake| wake.created_at < stale_before);
    if !stale.is_empty() {
        close(state, community, &stale, "stale: the moment passed").await?;
    }
    if fresh.is_empty() {
        return Ok(());
    }

    // No storms: one message per interval carries everything pending.
    if let Some(last) = state
        .db
        .cofounder_last_wake_delivered(community)
        .await
        .map_err(|error| format!("could not read the last wake time: {error}"))?
    {
        if now - last < chrono::Duration::seconds(MIN_WAKE_INTERVAL_SECS) {
            return Ok(());
        }
    }

    let ids = fresh.iter().map(|wake| wake.id).collect::<Vec<_>>();
    let attempts = fresh.iter().map(|wake| wake.attempts).max().unwrap_or(0);
    let target = match resolve_target(state, community_id).await {
        Ok(Some(target)) => target,
        Ok(None) => {
            return retry(
                state,
                community,
                &ids,
                attempts,
                now,
                "no Scout to wake yet",
            )
            .await;
        }
        Err(error) => return retry(state, community, &ids, attempts, now, &error).await,
    };
    let (weekly, regular): (Vec<&PendingWake>, Vec<&PendingWake>) = fresh
        .iter()
        .partition(|wake| wake.detail.starts_with(WEEKLY_REVIEW_DETAIL_PREFIX));
    let reasons = regular
        .iter()
        .filter_map(|wake| WakeReason::from_id(&wake.reason))
        .collect::<Vec<_>>();
    let review_dates = weekly
        .iter()
        .filter_map(|wake| wake.detail.strip_prefix(WEEKLY_REVIEW_DETAIL_PREFIX))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    match post_wake(state, community_id, &target, &reasons, &review_dates, now).await {
        Ok(event_id) => {
            state
                .db
                .cofounder_wakes_delivered(community, &ids, &event_id, now)
                .await
                .map_err(|error| format!("could not mark wakes delivered: {error}"))?;
            info!(%community, wakes = ids.len(), "woke Scout");
            Ok(())
        }
        Err(error) => retry(state, community, &ids, attempts, now, &error).await,
    }
}

async fn close(
    state: &Arc<AppState>,
    community: Uuid,
    wakes: &[PendingWake],
    outcome: &str,
) -> Result<(), String> {
    let ids = wakes.iter().map(|wake| wake.id).collect::<Vec<_>>();
    state
        .db
        .cofounder_wakes_skipped(community, &ids, outcome)
        .await
        .map_err(|error| format!("could not close wakes: {error}"))?;
    Ok(())
}

async fn retry(
    state: &Arc<AppState>,
    community: Uuid,
    ids: &[Uuid],
    attempts: i32,
    now: DateTime<Utc>,
    outcome: &str,
) -> Result<(), String> {
    let backoff = (60_i64 << attempts.clamp(0, 6)).min(3_600);
    let outcome = outcome.chars().take(280).collect::<String>();
    state
        .db
        .cofounder_wakes_retry(
            community,
            ids,
            &outcome,
            now + chrono::Duration::seconds(backoff),
            MAX_DELIVERY_ATTEMPTS,
        )
        .await
        .map_err(|error| format!("could not record the wake retry: {error}"))?;
    Ok(())
}

/// Who to wake and where.
struct Target {
    scout_hex: String,
    owner_hex: String,
    dm_channel: Uuid,
}

async fn resolve_target(
    state: &Arc<AppState>,
    community_id: CommunityId,
) -> Result<Option<Target>, String> {
    let Some(scout_hex) = lead_pubkey(state, community_id).await? else {
        return Ok(None);
    };
    let scout = nostr::PublicKey::from_hex(&scout_hex)
        .map_err(|_| "the lead public key is invalid".to_string())?
        .to_bytes();
    let owner = state
        .db
        .get_agent_channel_policy(community_id, &scout)
        .await
        .map_err(|error| format!("could not read Scout's owner: {error}"))?
        .and_then(|(_, owner)| owner)
        .ok_or_else(|| "Scout has no owner to talk to".to_string())?;
    let hash = buzz_db::dm::compute_participant_hash(&[&scout[..], &owner[..]]);
    let dm = state
        .db
        .find_dm_by_participants(community_id, &hash)
        .await
        .map_err(|error| format!("could not look up the direct message: {error}"))?
        .ok_or_else(|| "no direct message between Scout and its owner yet".to_string())?;
    Ok(Some(Target {
        scout_hex,
        owner_hex: hex::encode(&owner),
        dm_channel: dm.id,
    }))
}

/// The agent that leads co-founder work: the one onboarding recorded, else the
/// only active Chief of Staff on the team.
async fn lead_pubkey(
    state: &Arc<AppState>,
    community_id: CommunityId,
) -> Result<Option<String>, String> {
    let onboarding = load_head(state, community_id, KIND_ONBOARDING_HEAD, ONBOARDING_D_TAG)
        .await
        .map_err(|error| format!("could not read onboarding: {error:?}"))?;
    if let Some(stored) = onboarding {
        let head = serde_json::from_str::<OnboardingHead>(&stored.event.content)
            .map_err(|error| format!("stored onboarding head is invalid: {error}"))?;
        return Ok(Some(head.lead_pubkey));
    }
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(500);
    let rows = state
        .db
        .query_events_for_maintenance(&query)
        .await
        .map_err(|error| format!("could not read member positions: {error}"))?;
    let mut leads = rows
        .iter()
        .filter_map(|stored| serde_json::from_str::<MemberPositionHead>(&stored.event.content).ok())
        .filter(|head| {
            head.kind == MemberKind::Employee
                && head.status == MemberStatus::Active
                && head.title.trim().eq_ignore_ascii_case("chief of staff")
        })
        .map(|head| head.pubkey);
    let first = leads.next();
    // Two Chiefs of Staff is ambiguous: wake nobody rather than guess.
    Ok(first.filter(|_| leads.next().is_none()))
}

/// The lines of the wake message for these reasons.
fn wake_lines(reasons: &[WakeReason]) -> Vec<String> {
    let mut lines = Vec::new();
    for reason in [
        WakeReason::ModeOn,
        WakeReason::DailyStart,
        WakeReason::InboundReply,
        WakeReason::WorkerFinished,
        WakeReason::ApprovalGiven,
        WakeReason::DeadlineNear,
    ] {
        let count = reasons.iter().filter(|seen| **seen == reason).count();
        match count {
            0 => {}
            1 => lines.push(format!("- {}", reason.instruction())),
            n => lines.push(format!("- {} ({n} times)", reason.instruction())),
        }
    }
    lines
}

/// The one message a company's pending wakes become.
pub fn wake_message(reasons: &[WakeReason]) -> String {
    wake_message_with_reviews(reasons, &[])
}

/// What Scout is asked to do for the weekly review of a Friday, in one short line.
fn weekly_review_instruction(review_date: &str) -> String {
    format!(
        "The weekly review for Friday {review_date} is ready. Read it with `colony numbers review show {review_date}`, write the wins, misses and decisions the owner must make with `colony numbers review write {review_date}`, then post one short message to the owner linking colony://numbers/review/{review_date}."
    )
}

/// The wake message, with a line for each weekly review that is ready.
pub fn wake_message_with_reviews(reasons: &[WakeReason], review_dates: &[String]) -> String {
    let mut lines = wake_lines(reasons);
    for review_date in review_dates {
        lines.push(format!("- {}", weekly_review_instruction(review_date)));
    }
    format!(
        "Wake from the relay (co-founder mode):\n{}",
        lines.join("\n")
    )
}

async fn post_wake(
    state: &Arc<AppState>,
    community_id: CommunityId,
    target: &Target,
    reasons: &[WakeReason],
    review_dates: &[String],
    now: DateTime<Utc>,
) -> Result<Vec<u8>, String> {
    let host = state
        .db
        .lookup_community_host(community_id)
        .await
        .map_err(|error| format!("community host lookup failed: {error}"))?
        .ok_or_else(|| "community no longer exists".to_string())?;
    let tenant = TenantContext::resolved(community_id, host);
    let mut wake_tag = vec!["buzz:cofounder-wake".to_string()];
    wake_tag.extend(reasons.iter().map(|reason| reason.id().to_string()));
    if !review_dates.is_empty() {
        wake_tag.push("weekly_review".to_string());
    }
    // Same provenance as a scheduled duty: the relay speaks for the owner's
    // standing choice to run co-founder mode, and the message names the agent.
    let tags = vec![
        vec!["p".to_string(), target.owner_hex.clone()],
        vec!["p".to_string(), target.scout_hex.clone()],
        vec!["buzz:workflow".to_string(), "true".to_string()],
        vec!["buzz:workflow-owner".to_string(), target.owner_hex.clone()],
        vec![
            "buzz:workflow-mention".to_string(),
            target.scout_hex.clone(),
        ],
        wake_tag,
    ];
    let event = crate::whatsapp::channel::post_message(
        state,
        &tenant,
        target.dm_channel,
        None,
        wake_message_with_reviews(reasons, review_dates),
        tags,
        now,
    )
    .await?;
    Ok(event.id.as_bytes().to_vec())
}

/// Daily start, deadline and pruning for every company in co-founder mode.
pub async fn sweep(state: &Arc<AppState>, now: DateTime<Utc>) -> Result<(), String> {
    let mut after = None;
    loop {
        let page = state
            .db
            .cofounder_sweep_communities(after, SWEEP_PAGE)
            .await
            .map_err(|error| format!("could not list companies: {error}"))?;
        let Some(last) = page.last().copied() else {
            break;
        };
        for community in &page {
            if let Err(error) = sweep_one(state, CommunityId::from_uuid(*community), now).await {
                warn!(%community, "co-founder wake sweep failed for a company: {error}");
            }
        }
        if (page.len() as i64) < SWEEP_PAGE {
            break;
        }
        after = Some(last);
    }
    state
        .db
        .cofounder_wakes_prune(now - chrono::Duration::seconds(KEEP_FINISHED_SECS))
        .await
        .map_err(|error| format!("could not prune finished wakes: {error}"))?;
    Ok(())
}

/// The sweep for one company: nothing at all unless co-founder mode is on.
pub(crate) async fn sweep_one(
    state: &Arc<AppState>,
    community_id: CommunityId,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let settings = cofounder_settings(state, community_id)
        .await
        .map_err(|error| format!("could not read the co-founder settings: {error:?}"))?;
    if !settings.enabled {
        return Ok(());
    }
    if now.hour() >= DAILY_START_HOUR_UTC {
        enqueue(
            state,
            community_id,
            WakeReason::DailyStart,
            &format!("daily:{}", now.format("%Y-%m-%d")),
            "",
        )
        .await;
    }
    // The Friday review: the relay writes the week's numbers once, then wakes
    // Scout for the words. The wake is queued on every sweep while the review is
    // due (its key makes that idempotent), so a wake lost to a database error is
    // retried by the next sweep.
    if let Some(window) = buzz_core::company_numbers::review_due(now.timestamp()) {
        match crate::handlers::company_numbers::ensure_weekly_review(
            state,
            community_id,
            now.timestamp(),
        )
        .await
        {
            Ok(_) => {
                enqueue(
                    state,
                    community_id,
                    WakeReason::DailyStart,
                    &format!("weekly:{}", window.review_date),
                    &format!("{WEEKLY_REVIEW_DETAIL_PREFIX}{}", window.review_date),
                )
                .await;
            }
            Err(error) => warn!(
                community = %community_id.as_uuid(),
                "weekly review could not be written: {error}"
            ),
        }
    }
    // Every business with a prospect or a client record has a customer record,
    // brought up to date with the company's records. A record that could not be
    // written is retried by the next sweep.
    if let Err(error) = crate::handlers::company_customers::ensure_customer_records(
        state,
        community_id,
        now.timestamp(),
    )
    .await
    {
        warn!(
            community = %community_id.as_uuid(),
            "customer records could not be brought up to date: {error}"
        );
    }
    for due in work_items_due_soon(state, community_id, now).await? {
        enqueue(
            state,
            community_id,
            WakeReason::DeadlineNear,
            &format!("deadline:{}:{}", due.work_item_id, due.due_at),
            &format!("work item {} is due {}", due.work_item_id, due.due_at),
        )
        .await;
    }
    Ok(())
}

/// A work item whose due time is within the wake window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DueSoon {
    pub work_item_id: Uuid,
    pub due_at: String,
}

/// Work items that are still open and due within a day. Reads at most
/// [`MAX_WORK_HEADS_PER_SWEEP`] heads.
pub(crate) async fn work_items_due_soon(
    state: &Arc<AppState>,
    community_id: CommunityId,
    now: DateTime<Utc>,
) -> Result<Vec<DueSoon>, String> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_WORK_ITEM_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.limit = Some(MAX_WORK_HEADS_PER_SWEEP);
    let rows = state
        .db
        .query_events_for_maintenance(&query)
        .await
        .map_err(|error| format!("could not read work items: {error}"))?;
    let heads = rows
        .iter()
        .filter_map(|stored| {
            serde_json::from_str::<CompanyWorkItemHead>(&stored.event.content).ok()
        })
        .collect::<Vec<_>>();
    Ok(due_soon(&heads, now))
}

/// Pure selection: open work items due between now and the end of the window.
pub(crate) fn due_soon(heads: &[CompanyWorkItemHead], now: DateTime<Utc>) -> Vec<DueSoon> {
    let window_end = now + chrono::Duration::seconds(DEADLINE_WINDOW_SECS);
    heads
        .iter()
        .filter(|head| {
            matches!(
                head.status,
                CompanyWorkStatus::Active | CompanyWorkStatus::Blocked | CompanyWorkStatus::Paused
            )
        })
        .filter_map(|head| {
            let due_at = head.due_at.as_deref()?;
            let due = DateTime::parse_from_rfc3339(due_at)
                .ok()?
                .with_timezone(&Utc);
            (due >= now && due <= window_end).then(|| DueSoon {
                work_item_id: head.work_item_id,
                due_at: due_at.to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reason_round_trips_through_its_id() {
        for reason in [
            WakeReason::ModeOn,
            WakeReason::DailyStart,
            WakeReason::InboundReply,
            WakeReason::WorkerFinished,
            WakeReason::ApprovalGiven,
            WakeReason::DeadlineNear,
        ] {
            assert_eq!(WakeReason::from_id(reason.id()), Some(reason));
            assert!(buzz_db::cofounder_wakes::WAKE_REASONS.contains(&reason.id()));
        }
        assert_eq!(WakeReason::from_id("because"), None);
    }

    #[test]
    fn many_reasons_become_one_short_message() {
        let message = wake_message(&[
            WakeReason::WorkerFinished,
            WakeReason::DailyStart,
            WakeReason::WorkerFinished,
            WakeReason::InboundReply,
        ]);
        assert_eq!(message.lines().count(), 4, "{message}");
        assert!(message.contains("(2 times)"), "{message}");
        assert!(message.starts_with("Wake from the relay"), "{message}");
        assert!(message.len() < 600, "{message}");
        assert!(!message.contains('\u{2014}'), "no em dash in copy");
    }

    fn work_item(status: &str, due_at: Option<&str>, id: u128) -> CompanyWorkItemHead {
        let mut value = serde_json::json!({
            "schemaVersion": 1,
            "workItemId": Uuid::from_u128(id),
            "title": "Send the quote",
            "status": status,
            "assignedPubkeys": [],
            "approverPubkeys": [],
            "deliverables": [],
            "requesterPubkey": "a".repeat(64),
            "doneCondition": "The quote is sent",
            "sourceActionEventId": "b".repeat(64),
        });
        if let Some(due_at) = due_at {
            value["dueAt"] = serde_json::json!(due_at);
        }
        serde_json::from_value(value).expect("work item head")
    }

    #[test]
    fn only_open_work_due_within_a_day_wakes_scout() {
        let now = DateTime::parse_from_rfc3339("2026-11-02T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let heads = vec![
            work_item("active", Some("2026-11-02T20:00:00Z"), 1),
            work_item("blocked", Some("2026-11-03T08:00:00Z"), 2),
            // Too far away, already past, done, archived or without a date.
            work_item("active", Some("2026-11-05T09:00:00Z"), 3),
            work_item("active", Some("2026-11-01T09:00:00Z"), 4),
            work_item("done_verified", Some("2026-11-02T12:00:00Z"), 5),
            work_item("archived", Some("2026-11-02T12:00:00Z"), 6),
            work_item("active", None, 7),
        ];
        let due = due_soon(&heads, now);
        let ids = due.iter().map(|d| d.work_item_id).collect::<Vec<_>>();
        assert_eq!(ids, vec![Uuid::from_u128(1), Uuid::from_u128(2)]);
    }

    #[test]
    fn the_weekly_review_wake_names_the_friday_the_commands_and_the_link() {
        let message =
            wake_message_with_reviews(&[WakeReason::DailyStart], &["2026-10-30".to_owned()]);
        assert_eq!(message.lines().count(), 3, "{message}");
        assert!(message.contains("Friday 2026-10-30"), "{message}");
        assert!(
            message.contains("colony numbers review show 2026-10-30"),
            "{message}"
        );
        assert!(
            message.contains("colony numbers review write 2026-10-30"),
            "{message}"
        );
        assert!(
            message.contains("colony://numbers/review/2026-10-30"),
            "{message}"
        );
        assert!(!message.contains('\u{2014}'), "no em dash in copy");
        // Without a review the message is the plain wake message.
        assert_eq!(
            wake_message_with_reviews(&[WakeReason::DailyStart], &[]),
            wake_message(&[WakeReason::DailyStart])
        );
    }

    #[test]
    fn a_message_never_carries_outside_text() {
        // The message is built from reasons only; there is no field to put a
        // contact's name or message into.
        let message = wake_message(&[WakeReason::InboundReply]);
        assert!(!message.to_lowercase().contains("whatsapp:"), "{message}");
    }
}

#[cfg(test)]
mod postgres_tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    use buzz_core::company_cofounder::CofounderSettings;
    use buzz_core::company_onboarding::{OnboardingAction, OnboardingActionKind};
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;

    use super::*;
    use crate::handlers::company_initiative::test_support::{
        add_agent, add_member, auth, enable_cofounder, fixture, save_cofounder_settings, Fixture,
    };

    fn community(fixture: &Fixture) -> Uuid {
        *fixture.tenant.community().as_uuid()
    }

    async fn pending_count(fixture: &Fixture) -> usize {
        fixture
            .state
            .db
            .cofounder_pending_wakes(
                community(fixture),
                Utc::now() + chrono::Duration::days(30),
                100,
            )
            .await
            .expect("pending wakes")
            .len()
    }

    /// Wake messages posted in a channel, newest first.
    async fn wake_messages(fixture: &Fixture, channel: Uuid) -> Vec<buzz_core::StoredEvent> {
        let mut query = EventQuery::for_community(fixture.tenant.community());
        query.channel_id = Some(channel);
        query.kinds = Some(vec![9]);
        query.limit = Some(50);
        fixture
            .state
            .db
            .query_events_for_event_write(&query)
            .await
            .expect("channel messages")
    }

    /// An owner, Scout (a managed agent) as the onboarding lead, a DM between
    /// them, and co-founder mode on.
    async fn company_with_scout() -> (Fixture, nostr::Keys, nostr::Keys, Uuid) {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        let scout = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        add_agent(&fixture, &owner, &scout).await;
        enable_cofounder(&fixture, &owner).await;
        let start = OnboardingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: OnboardingActionKind::Start,
            step: None,
            text: None,
            account: None,
            map: None,
            skipped: false,
            money_preference: None,
            approval_switches: None,
            lead_pubkey: None,
            expected_head_event_id: None,
        };
        let event = buzz_sdk::company_initiative::build_onboarding_action(&start)
            .expect("build start")
            .sign_with_keys(&scout)
            .expect("sign start");
        crate::handlers::company_onboarding::handle(
            &fixture.tenant,
            &fixture.state,
            event,
            auth(&scout),
        )
        .await
        .expect("Scout starts onboarding");
        let owner_bytes = owner.public_key().to_bytes();
        let scout_bytes = scout.public_key().to_bytes();
        let dm = fixture
            .state
            .db
            .create_dm(
                fixture.tenant.community(),
                &[&owner_bytes[..], &scout_bytes[..]],
                &owner_bytes[..],
            )
            .await
            .expect("direct message")
            .id;
        // Wakes queued by the switch itself are not under test here.
        let all = fixture
            .state
            .db
            .cofounder_pending_wakes(
                community(&fixture),
                Utc::now() + chrono::Duration::days(30),
                100,
            )
            .await
            .expect("pending wakes");
        let ids = all.iter().map(|wake| wake.id).collect::<Vec<_>>();
        fixture
            .state
            .db
            .cofounder_wakes_skipped(community(&fixture), &ids, "test setup")
            .await
            .expect("clear setup wakes");
        (fixture, owner, scout, dm)
    }

    fn soon() -> DateTime<Utc> {
        Utc::now() + chrono::Duration::seconds(2)
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn nothing_is_queued_while_cofounder_mode_is_off() {
        let fixture = fixture().await;
        enqueue(
            &fixture.state,
            fixture.tenant.community(),
            WakeReason::WorkerFinished,
            "worker:1",
            "",
        )
        .await;
        assert_eq!(pending_count(&fixture).await, 0);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn switching_cofounder_mode_on_queues_a_mode_on_wake() {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        enable_cofounder(&fixture, &owner).await;
        let pending = fixture
            .state
            .db
            .cofounder_pending_wakes(community(&fixture), soon(), 10)
            .await
            .expect("pending wakes");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].reason, "mode_on");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_same_event_queues_one_wake() {
        let (fixture, _owner, _scout, _dm) = company_with_scout().await;
        for _ in 0..3 {
            enqueue(
                &fixture.state,
                fixture.tenant.community(),
                WakeReason::WorkerFinished,
                "worker:7",
                "",
            )
            .await;
        }
        assert_eq!(pending_count(&fixture).await, 1);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_burst_becomes_one_message_in_scouts_direct_message() {
        let (fixture, owner, scout, dm) = company_with_scout().await;
        for (reason, key) in [
            (WakeReason::WorkerFinished, "worker:1"),
            (WakeReason::WorkerFinished, "worker:2"),
            (WakeReason::InboundReply, "reply:1"),
            (WakeReason::ApprovalGiven, "approval:1"),
        ] {
            enqueue(&fixture.state, fixture.tenant.community(), reason, key, "").await;
        }
        deliver_one(&fixture.state, community(&fixture), soon())
            .await
            .expect("deliver");

        let messages = wake_messages(&fixture, dm).await;
        assert_eq!(messages.len(), 1, "a burst must be one message");
        let event = &messages[0].event;
        assert_eq!(event.pubkey, fixture.state.relay_keypair.public_key());
        assert!(event.content.contains("(2 times)"), "{}", event.content);
        let tags = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect::<Vec<_>>();
        assert!(tags
            .iter()
            .any(|tag| tag[0] == "p" && tag[1] == scout.public_key().to_hex()));
        assert!(tags
            .iter()
            .any(|tag| tag[0] == "p" && tag[1] == owner.public_key().to_hex()));
        assert!(tags
            .iter()
            .any(|tag| tag[0] == "buzz:workflow-mention" && tag[1] == scout.public_key().to_hex()));
        assert!(tags.iter().any(|tag| tag[0] == "buzz:cofounder-wake"));
        assert_eq!(pending_count(&fixture).await, 0, "every wake was delivered");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_second_wake_inside_the_interval_waits() {
        let (fixture, _owner, _scout, dm) = company_with_scout().await;
        enqueue(
            &fixture.state,
            fixture.tenant.community(),
            WakeReason::WorkerFinished,
            "worker:1",
            "",
        )
        .await;
        let now = soon();
        deliver_one(&fixture.state, community(&fixture), now)
            .await
            .expect("first delivery");
        enqueue(
            &fixture.state,
            fixture.tenant.community(),
            WakeReason::InboundReply,
            "reply:2",
            "",
        )
        .await;
        deliver_one(
            &fixture.state,
            community(&fixture),
            now + chrono::Duration::seconds(60),
        )
        .await
        .expect("second delivery");
        assert_eq!(wake_messages(&fixture, dm).await.len(), 1, "no storm");
        assert_eq!(pending_count(&fixture).await, 1, "the second wake waits");

        deliver_one(
            &fixture.state,
            community(&fixture),
            now + chrono::Duration::seconds(MIN_WAKE_INTERVAL_SECS + 60),
        )
        .await
        .expect("delivery after the interval");
        assert_eq!(wake_messages(&fixture, dm).await.len(), 2);
        assert_eq!(pending_count(&fixture).await, 0);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_wake_queued_before_the_switch_went_off_is_closed_unsent() {
        let (fixture, owner, _scout, dm) = company_with_scout().await;
        enqueue(
            &fixture.state,
            fixture.tenant.community(),
            WakeReason::WorkerFinished,
            "worker:9",
            "",
        )
        .await;
        save_cofounder_settings(&fixture, &owner, &CofounderSettings::default()).await;
        deliver_one(&fixture.state, community(&fixture), soon())
            .await
            .expect("deliver");
        assert!(
            wake_messages(&fixture, dm).await.is_empty(),
            "no message while co-founder mode is off"
        );
        assert_eq!(pending_count(&fixture).await, 0, "the wake is closed");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_stale_wake_is_closed_unsent() {
        let (fixture, _owner, _scout, dm) = company_with_scout().await;
        enqueue(
            &fixture.state,
            fixture.tenant.community(),
            WakeReason::DailyStart,
            "daily:2026-11-01",
            "",
        )
        .await;
        let two_days_later = Utc::now() + chrono::Duration::days(2);
        deliver_one(&fixture.state, community(&fixture), two_days_later)
            .await
            .expect("deliver");
        assert!(wake_messages(&fixture, dm).await.is_empty());
        assert_eq!(pending_count(&fixture).await, 0);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn without_a_direct_message_the_wake_backs_off_and_then_ends() {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        let scout = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        add_agent(&fixture, &owner, &scout).await;
        enable_cofounder(&fixture, &owner).await;
        let start = OnboardingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: OnboardingActionKind::Start,
            step: None,
            text: None,
            account: None,
            map: None,
            skipped: false,
            money_preference: None,
            approval_switches: None,
            lead_pubkey: None,
            expected_head_event_id: None,
        };
        let event = buzz_sdk::company_initiative::build_onboarding_action(&start)
            .expect("build start")
            .sign_with_keys(&scout)
            .expect("sign start");
        crate::handlers::company_onboarding::handle(
            &fixture.tenant,
            &fixture.state,
            event,
            auth(&scout),
        )
        .await
        .expect("Scout starts onboarding");

        // No direct message exists. The wake is retried later, not lost and not
        // retried at once.
        let base = Utc::now();
        deliver_one(
            &fixture.state,
            community(&fixture),
            base + chrono::Duration::seconds(2),
        )
        .await
        .expect("first attempt");
        let early = fixture
            .state
            .db
            .cofounder_pending_wakes(
                community(&fixture),
                base + chrono::Duration::seconds(30),
                10,
            )
            .await
            .expect("pending wakes");
        assert!(early.is_empty(), "the retry is not immediate");
        let later = fixture
            .state
            .db
            .cofounder_pending_wakes(community(&fixture), base + chrono::Duration::hours(2), 10)
            .await
            .expect("pending wakes");
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].attempts, 1);

        // Persistent failure ends instead of retrying forever.
        for attempt in 1..=MAX_DELIVERY_ATTEMPTS {
            deliver_one(
                &fixture.state,
                community(&fixture),
                base + chrono::Duration::hours(2 * i64::from(attempt)),
            )
            .await
            .expect("attempt");
        }
        let left = fixture
            .state
            .db
            .cofounder_pending_wakes(
                community(&fixture),
                Utc::now() + chrono::Duration::days(30),
                100,
            )
            .await
            .expect("pending wakes");
        assert!(left.is_empty(), "the wake ended, still pending: {left:?}");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_sweep_queues_nothing_while_cofounder_mode_is_off() {
        let off = fixture().await;
        let morning = DateTime::parse_from_rfc3339("2026-11-02T07:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        sweep_one(&off.state, off.tenant.community(), morning)
            .await
            .expect("sweep while off");
        assert_eq!(pending_count(&off).await, 0, "off does nothing");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_sweep_queues_one_daily_start_per_day() {
        let morning = DateTime::parse_from_rfc3339("2026-11-04T07:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let (fixture, _owner, _scout, _dm) = company_with_scout().await;
        let early = DateTime::parse_from_rfc3339("2026-11-04T04:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        sweep_one(&fixture.state, fixture.tenant.community(), early)
            .await
            .expect("early sweep");
        assert_eq!(
            pending_count(&fixture).await,
            0,
            "not before the start hour"
        );
        for _ in 0..3 {
            sweep_one(&fixture.state, fixture.tenant.community(), morning)
                .await
                .expect("morning sweep");
        }
        assert_eq!(pending_count(&fixture).await, 1, "one daily start per day");
        let next_day = morning + chrono::Duration::days(1);
        sweep_one(&fixture.state, fixture.tenant.community(), next_day)
            .await
            .expect("next day sweep");
        assert_eq!(pending_count(&fixture).await, 2);
    }
}
