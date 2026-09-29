//! DB-leased watchdog check-in scheduler and thread-message delivery worker.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};
use serde::de::DeserializeOwned;
use tracing::{error, info, warn};
use uuid::Uuid;

use buzz_core::business_records::{company_work_d_tag, CompanyWorkItemHead, CompanyWorkStatus};
use buzz_core::company_work_tracking::{
    company_work_watchdog_d_tag, CompanyWorkCheckWhen, CompanyWorkTrackingHead,
    CompanyWorkWatchdogConfig,
};
use buzz_core::kind::*;
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::company_work_watchdog::{ClaimedDelivery, MAX_DELIVERY_ATTEMPTS};
use buzz_db::EventQuery;

use crate::state::AppState;

const CLAIM_BATCH_SIZE: i64 = 16;
const LEASE_SECS: i64 = 30;
const IDLE_POLL: Duration = Duration::from_secs(1);

/// Run the watchdog check-in worker forever.
pub async fn run(state: Arc<AppState>) {
    let worker_id = format!("company-work-watchdog-{}", Uuid::new_v4());
    info!(worker_id = %worker_id, "Company work watchdog worker started");
    loop {
        if let Err(error) = process_due_batch(&state, &worker_id, Utc::now()).await {
            error!(worker_id = %worker_id, error = %error, "Watchdog scheduler batch failed");
        }
        tokio::time::sleep(IDLE_POLL).await;
    }
}

/// Process one scheduled batch at an injected time.
pub(crate) async fn process_due_batch(
    state: &Arc<AppState>,
    worker_id: &str,
    now: DateTime<Utc>,
) -> Result<usize, String> {
    let lease_until = now + chrono::Duration::seconds(LEASE_SECS);
    let deliveries = state
        .db
        .claim_due_company_work_watchdog_deliveries(worker_id, now, lease_until, CLAIM_BATCH_SIZE)
        .await
        .map_err(|error| format!("claim failed: {error}"))?;
    let count = deliveries.len();
    for delivery in deliveries {
        if let Err(error) = deliver_one(state, &delivery, now).await {
            warn!(
                delivery_id = %delivery.id,
                work_item_id = %delivery.work_item_id,
                attempt = delivery.attempt_count,
                error = %error,
                "Watchdog check-in delivery failed"
            );
            let updated = state
                .db
                .fail_company_work_watchdog_delivery(&delivery, now, &error)
                .await
                .map_err(|db_error| format!("failed to persist watchdog retry: {db_error}"))?;
            if !updated {
                warn!(delivery_id = %delivery.id, "Watchdog retry lost its lease");
            } else if delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS {
                error!(
                    delivery_id = %delivery.id,
                    work_item_id = %delivery.work_item_id,
                    "Watchdog check-in reached terminal retry state"
                );
            }
        }
    }
    Ok(count)
}

async fn deliver_one(
    state: &Arc<AppState>,
    delivery: &ClaimedDelivery,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let host = state
        .db
        .lookup_community_host(delivery.community_id)
        .await
        .map_err(|error| format!("community host lookup failed: {error}"))?
        .ok_or_else(|| "community no longer exists".to_string())?;
    let tenant = TenantContext::resolved(delivery.community_id, host);
    let work_d_tag = company_work_d_tag(delivery.work_item_id);
    let watchdog_d_tag = company_work_watchdog_d_tag(delivery.work_item_id);

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(|error| format!("begin delivery transaction failed: {error}"))?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, delivery.community_id)
        .await
        .map_err(|error| format!("community write fence rejected delivery: {error}"))?;

    let relay_pubkey = state.relay_keypair.public_key().to_bytes();
    let locked_work_head = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        delivery.community_id,
        KIND_WORK_ITEM_HEAD,
        &relay_pubkey,
        &work_d_tag,
    )
    .await
    .map_err(|error| format!("work head lock failed: {error}"))?;
    let locked_config_head = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        delivery.community_id,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &relay_pubkey,
        &watchdog_d_tag,
    )
    .await
    .map_err(|error| format!("watchdog head lock failed: {error}"))?;

    let work_event = relay_head::<CompanyWorkItemHead>(
        state,
        delivery.community_id,
        delivery.channel_id,
        KIND_WORK_ITEM_HEAD,
        &work_d_tag,
    )
    .await?
    .ok_or_else(|| "work item was removed before its check-in".to_string())?;
    let config_event = relay_head::<CompanyWorkTrackingHead>(
        state,
        delivery.community_id,
        delivery.channel_id,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &watchdog_d_tag,
    )
    .await?
    .ok_or_else(|| "watchdog config was removed before its check-in".to_string())?;
    if locked_work_head.as_deref() != Some(work_event.event.id.as_bytes())
        || locked_config_head.as_deref() != Some(config_event.event.id.as_bytes())
    {
        return Err("work or watchdog head changed while its transaction lock was held".into());
    }

    let work: CompanyWorkItemHead = serde_json::from_str(&work_event.event.content)
        .map_err(|_| "stored company work head is invalid".to_string())?;
    let CompanyWorkTrackingHead::WatchdogConfiguration(config_head) =
        serde_json::from_str::<CompanyWorkTrackingHead>(&config_event.event.content)
            .map_err(|_| "stored watchdog head is invalid".to_string())?
    else {
        return Err("tracking head is not a watchdog configuration".into());
    };
    if work.status == CompanyWorkStatus::Archived
        || work.status == CompanyWorkStatus::DoneUnverified
        || work.status == CompanyWorkStatus::DoneVerified
        || !config_head.enabled
        || config_event.event.id.as_bytes() != delivery.config_event_id.as_slice()
        || work_event.channel_id != Some(delivery.channel_id)
        || config_event.channel_id != Some(delivery.channel_id)
        || work.thread_root_event_id.as_deref()
            != Some(hex::encode(&delivery.thread_root_event_id).as_str())
    {
        buzz_db::company_work_watchdog::mark_skipped_in_transaction(
            &mut tx,
            delivery,
            "watchdog or work state changed before delivery",
        )
        .await
        .map_err(|error| format!("cancel stale delivery failed: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("cancel stale delivery commit failed: {error}"))?;
        return Ok(());
    }
    let config = config_head
        .config
        .as_ref()
        .ok_or_else(|| "enabled watchdog has no saved config".to_string())?;
    if config.check_interval_seconds == 0 {
        return Err("enabled watchdog has no explicit positive interval".into());
    }

    let ancestry = crate::handlers::ingest::resolve_relay_reply_thread_meta(
        delivery.community_id,
        &hex::encode(&delivery.thread_root_event_id),
        delivery.channel_id,
        state,
    )
    .await?;
    let trigger = trigger_is_due(state, delivery, &work, config, now).await?;
    let next_at = now + chrono::Duration::seconds(i64::from(config.check_interval_seconds));
    if !trigger {
        let updated = buzz_db::company_work_watchdog::mark_skipped_in_transaction(
            &mut tx,
            delivery,
            "selected watchdog trigger was not present",
        )
        .await
        .map_err(|error| format!("skip delivery update failed: {error}"))?;
        if !updated {
            return Err("watchdog occurrence lease was lost".into());
        }
        buzz_db::company_work_watchdog::schedule_in_transaction(
            &mut tx,
            delivery.community_id,
            delivery.work_item_id,
            &delivery.config_event_id,
            delivery.channel_id,
            &delivery.thread_root_event_id,
            next_at,
        )
        .await
        .map_err(|error| format!("schedule next watchdog check failed: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("watchdog skip commit failed: {error}"))?;
        return Ok(());
    }

    let event = build_check_in(
        state,
        delivery,
        &work,
        config,
        config_event.event.id.as_bytes(),
        &ancestry,
        now,
    )
    .await?;
    let created_at = DateTime::<Utc>::from_timestamp(
        i64::try_from(event.created_at.as_secs())
            .map_err(|_| "check-in timestamp is outside the supported range")?,
        0,
    )
    .ok_or_else(|| "check-in timestamp is invalid".to_string())?;
    let owned_metadata = ancestry.into_thread_meta(
        event.id.as_bytes().to_vec(),
        created_at,
        delivery.channel_id,
    );
    let metadata = owned_metadata.as_params();
    let (stored_event, inserted) =
        buzz_db::event::insert_event_with_thread_metadata_in_transaction(
            &mut tx,
            delivery.community_id,
            &event,
            Some(delivery.channel_id),
            Some(metadata),
        )
        .await
        .map_err(|error| format!("persist check-in message failed: {error}"))?;
    let completed = buzz_db::company_work_watchdog::mark_delivered_in_transaction(
        &mut tx,
        delivery,
        event.id.as_bytes(),
    )
    .await
    .map_err(|error| format!("mark check-in delivered failed: {error}"))?;
    if !completed {
        return Err("watchdog occurrence lease was lost before commit".into());
    }
    buzz_db::company_work_watchdog::schedule_in_transaction(
        &mut tx,
        delivery.community_id,
        delivery.work_item_id,
        &delivery.config_event_id,
        delivery.channel_id,
        &delivery.thread_root_event_id,
        next_at,
    )
    .await
    .map_err(|error| format!("schedule next watchdog check failed: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("check-in delivery commit failed: {error}"))?;

    if inserted {
        super::event::dispatch_persistent_event(
            &tenant,
            state,
            &stored_event,
            KIND_STREAM_MESSAGE,
            &event.pubkey.to_hex(),
            None,
        )
        .await;
        crate::handlers::side_effects::emit_live_thread_summary(
            &tenant,
            state,
            delivery.channel_id,
            delivery.thread_root_event_id.clone(),
        );
    }
    Ok(())
}

async fn relay_head<T: DeserializeOwned>(
    state: &AppState,
    community: CommunityId,
    channel_id: Uuid,
    kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, String> {
    let mut query = EventQuery::for_community(community);
    query.channel_id = Some(channel_id);
    query.kinds = Some(vec![kind as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(|error| format!("current head lookup failed: {error}"))?;
    if rows.len() > 1 {
        return Err("duplicate relay-signed head coordinate".into());
    }
    let stored = rows.pop();
    if let Some(stored) = stored.as_ref() {
        serde_json::from_str::<T>(&stored.event.content)
            .map_err(|_| "stored relay-signed head content is invalid".to_string())?;
    }
    Ok(stored)
}

async fn trigger_is_due(
    state: &AppState,
    delivery: &ClaimedDelivery,
    work: &CompanyWorkItemHead,
    config: &CompanyWorkWatchdogConfig,
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let last_activity = if config.check_when == CompanyWorkCheckWhen::NoUpdate {
        state
            .db
            .latest_company_work_thread_activity(
                delivery.community_id,
                delivery.channel_id,
                &delivery.thread_root_event_id,
            )
            .await
            .map_err(|error| format!("thread activity lookup failed: {error}"))?
    } else {
        None
    };
    let due_at = work
        .due_at
        .as_deref()
        .map(chrono::DateTime::parse_from_rfc3339)
        .transpose()
        .map_err(|_| "stored work dueAt is invalid".to_string())?
        .map(|timestamp| timestamp.with_timezone(&Utc));
    let quiet_since = delivery.scheduled_for
        - chrono::Duration::seconds(i64::from(config.check_interval_seconds));
    Ok(evaluate_trigger(
        config.check_when,
        work.status,
        due_at,
        last_activity,
        quiet_since,
        now,
    ))
}

async fn build_check_in(
    state: &AppState,
    delivery: &ClaimedDelivery,
    work: &CompanyWorkItemHead,
    config: &CompanyWorkWatchdogConfig,
    config_event_id: &[u8],
    ancestry: &crate::handlers::ingest::ReplyAncestry,
    now: DateTime<Utc>,
) -> Result<Event, String> {
    let escalation_target =
        escalation_is_due(state, delivery, config, config_event_id, now).await?;
    let recipient = if escalation_target {
        config.escalate_to_pubkey.as_deref()
    } else {
        config.ask_first_pubkey.as_deref()
    };
    let mut tags = vec![Tag::parse(["h", &delivery.channel_id.to_string()])
        .map_err(|error| format!("check-in h tag is invalid: {error}"))?];
    if let Some(recipient) = recipient {
        tags.push(
            Tag::parse(["p", recipient])
                .map_err(|error| format!("check-in recipient tag is invalid: {error}"))?,
        );
    }
    let root_hex = ancestry.root_hex();
    let parent_hex = ancestry.parent_hex();
    if root_hex == parent_hex {
        tags.push(
            Tag::parse(["e", &root_hex, "", "reply"])
                .map_err(|error| format!("check-in reply tag is invalid: {error}"))?,
        );
    } else {
        tags.push(
            Tag::parse(["e", &root_hex, "", "root"])
                .map_err(|error| format!("check-in root tag is invalid: {error}"))?,
        );
        tags.push(
            Tag::parse(["e", &parent_hex, "", "reply"])
                .map_err(|error| format!("check-in reply tag is invalid: {error}"))?,
        );
    }
    let timestamp = u64::try_from(delivery.scheduled_for.timestamp())
        .map_err(|_| "check-in schedule predates the Unix epoch".to_string())?;
    let content = format!("Check-in: {}", work.title);
    let event = EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(timestamp))
        .sign_with_keys(&state.relay_keypair)
        .map_err(|error| format!("sign check-in message failed: {error}"))?;
    Ok(event)
}

fn evaluate_trigger(
    check_when: CompanyWorkCheckWhen,
    status: CompanyWorkStatus,
    due_at: Option<DateTime<Utc>>,
    last_activity: Option<DateTime<Utc>>,
    quiet_since: DateTime<Utc>,
    now: DateTime<Utc>,
) -> bool {
    match check_when {
        CompanyWorkCheckWhen::NoUpdate => last_activity.is_none_or(|last| last <= quiet_since),
        CompanyWorkCheckWhen::DueDatePasses => due_at.is_some_and(|due| due <= now),
        CompanyWorkCheckWhen::WorkerReportsFailure => status == CompanyWorkStatus::Blocked,
    }
}

async fn escalation_is_due(
    state: &AppState,
    delivery: &ClaimedDelivery,
    config: &CompanyWorkWatchdogConfig,
    config_event_id: &[u8],
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let (Some(interval), Some(_recipient)) = (
        config.escalation_interval_seconds,
        config.escalate_to_pubkey.as_deref(),
    ) else {
        return Ok(false);
    };
    let Some(previous_delivery) = state
        .db
        .latest_company_work_watchdog_delivery(
            delivery.community_id,
            delivery.work_item_id,
            config_event_id,
        )
        .await
        .map_err(|error| format!("previous delivery lookup failed: {error}"))?
    else {
        return Ok(false);
    };
    if previous_delivery + chrono::Duration::seconds(i64::from(interval)) > now {
        return Ok(false);
    }
    let latest_activity = state
        .db
        .latest_company_work_thread_activity(
            delivery.community_id,
            delivery.channel_id,
            &delivery.thread_root_event_id,
        )
        .await
        .map_err(|error| format!("thread activity lookup failed: {error}"))?;
    Ok(latest_activity.is_none_or(|activity| activity <= previous_delivery))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trigger_evaluation_uses_supplied_time_and_explicit_interval() {
        let schedule = DateTime::from_timestamp(1_800_000_000, 0).expect("test schedule");
        let quiet_since = schedule - chrono::Duration::seconds(86_400);
        let last_activity = Some(quiet_since - chrono::Duration::seconds(1));
        assert!(evaluate_trigger(
            CompanyWorkCheckWhen::NoUpdate,
            CompanyWorkStatus::Active,
            None,
            last_activity,
            quiet_since,
            schedule
        ));
        let activity_during_interval = Some(quiet_since + chrono::Duration::seconds(1));
        assert!(!evaluate_trigger(
            CompanyWorkCheckWhen::NoUpdate,
            CompanyWorkStatus::Active,
            None,
            activity_during_interval,
            quiet_since,
            schedule
        ));
        assert!(evaluate_trigger(
            CompanyWorkCheckWhen::DueDatePasses,
            CompanyWorkStatus::Active,
            Some(schedule),
            None,
            quiet_since,
            schedule
        ));
        assert!(!evaluate_trigger(
            CompanyWorkCheckWhen::WorkerReportsFailure,
            CompanyWorkStatus::Active,
            None,
            None,
            quiet_since,
            schedule
        ));
        assert!(evaluate_trigger(
            CompanyWorkCheckWhen::WorkerReportsFailure,
            CompanyWorkStatus::Blocked,
            None,
            None,
            quiet_since,
            schedule
        ));
    }
}
