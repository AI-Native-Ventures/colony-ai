//! The doorbell: a message that could need a sleeping cloud agent wakes it.
//!
//! When the relay stores a message, this module asks which cloud-placed agents
//! it might be for: the agents it names in a `p` tag, and the agents that belong
//! to the direct-message channel it was posted in. For each one with no presence
//! it starts a wake: the agent becomes `waking` and the operations that start its
//! machine are journaled. The harness then connects and answers through its
//! normal path.
//!
//! The doorbell is deliberately a superset of the harness's own subscribe and
//! respond-to rules. A wasted wake costs seconds of machine time and the
//! harness then applies its rules and goes back to sleep; a missed wake loses a
//! message. So it never tries to be clever about who the message is "really"
//! for.
//!
//! It never blocks storing the message: it runs on its own task, and any failure
//! here is logged, never turned into a refusal of the message.

use std::sync::Arc;

use buzz_core::agent_placement::PlacementStatus;
use buzz_core::kind::{
    KIND_EVENT_REMINDER, KIND_FORUM_COMMENT, KIND_FORUM_POST, KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2, KIND_STREAM_REMINDER,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::cloud_agents::WakeCandidate;

use super::config::CloudMode;
use super::presence::{PresenceSource, PubsubPresence};
use crate::state::AppState;

/// A wake already in flight this recently is not started again.
pub const WAKE_DEBOUNCE_SECS: i64 = 60;

/// Kinds that can wake an agent: chat messages, forum posts and comments, and
/// the two reminder kinds (which carry the workflow approvals and reminders
/// addressed to an agent).
pub const WAKE_KINDS: &[u32] = &[
    KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
    KIND_FORUM_POST,
    KIND_FORUM_COMMENT,
    KIND_STREAM_REMINDER,
    KIND_EVENT_REMINDER,
];

/// Kinds that wake an agent that is merely a member of the direct-message
/// channel they were posted in (no `p` tag needed).
const DM_WAKE_KINDS: &[u32] = &[
    KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
    KIND_FORUM_POST,
    KIND_FORUM_COMMENT,
];

/// What happened to one agent a message might have woken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WakeOutcome {
    /// A wake was started.
    Woke,
    /// The agent is connected already.
    Present,
    /// A wake started less than a minute ago is still in flight.
    Debounced,
    /// The agent needs a new machine and the host is at its machine cap.
    Capacity,
    /// Nothing could be started (the agent moved, or the database failed).
    Skipped,
}

/// Entry point from the post-store fan-out. Does nothing, at no cost, while the
/// feature is off or no host is configured. Runs the whole job on its own task.
pub fn on_stored(state: &Arc<AppState>, tenant: &TenantContext, stored: &StoredEvent) {
    let config = &state.config.cloud_agents;
    if config.mode == CloudMode::Off || config.fly.is_none() {
        return;
    }
    if !WAKE_KINDS.contains(&u32::from(stored.event.kind.as_u16())) {
        return;
    }
    let state = Arc::clone(state);
    let tenant = tenant.clone();
    let stored = stored.clone();
    tokio::spawn(async move {
        let presence = PubsubPresence::new(Arc::clone(&state.pubsub));
        if let Err(error) = ring(&state, &presence, &tenant, &stored).await {
            tracing::warn!(%error, "cloud agent doorbell failed; a later message or a retry wakes the agent");
        }
    });
}

/// The agents `stored` names in `p` tags, as raw keys.
fn mentioned_agents(stored: &StoredEvent) -> Vec<Vec<u8>> {
    let mut keys: Vec<Vec<u8>> = stored
        .event
        .tags
        .iter()
        .filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.first().map(String::as_str) == Some("p"))
                .then(|| parts.get(1))
                .flatten()
                .and_then(|value| nostr::PublicKey::from_hex(value).ok())
                .map(|key| key.to_bytes().to_vec())
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys.truncate(64);
    keys
}

/// Decides and starts the wakes for one stored message.
pub async fn ring(
    state: &Arc<AppState>,
    presence: &dyn PresenceSource,
    tenant: &TenantContext,
    stored: &StoredEvent,
) -> Result<Vec<(Vec<u8>, WakeOutcome)>, String> {
    let kind = u32::from(stored.event.kind.as_u16());
    if !WAKE_KINDS.contains(&kind) {
        return Ok(Vec::new());
    }
    let dm_channel = DM_WAKE_KINDS
        .contains(&kind)
        .then_some(stored.channel_id)
        .flatten();
    let mentioned = mentioned_agents(stored);
    if mentioned.is_empty() && dm_channel.is_none() {
        return Ok(Vec::new());
    }
    let candidates = state
        .db
        .cloud_wake_candidates(
            tenant.community(),
            dm_channel,
            &mentioned,
            &stored.event.pubkey.to_bytes(),
        )
        .await
        .map_err(|error| format!("could not look up cloud agents: {error}"))?;
    let mut outcomes = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let outcome = wake_if_needed(state, presence, tenant, &candidate).await;
        outcomes.push((candidate.agent_pubkey, outcome));
    }
    Ok(outcomes)
}

async fn wake_if_needed(
    state: &Arc<AppState>,
    presence: &dyn PresenceSource,
    tenant: &TenantContext,
    candidate: &WakeCandidate,
) -> WakeOutcome {
    // Unknown presence is treated as offline: a wasted wake is cheap, a missed
    // one loses a message.
    if presence
        .is_online(tenant, &candidate.agent_pubkey)
        .await
        .unwrap_or(false)
    {
        return WakeOutcome::Present;
    }
    start_wake(state, tenant.community(), candidate, WAKE_DEBOUNCE_SECS).await
}

/// Starts a wake for a candidate, honoring the machine cap.
async fn start_wake(
    state: &Arc<AppState>,
    community: CommunityId,
    candidate: &WakeCandidate,
    debounce_secs: i64,
) -> WakeOutcome {
    if !candidate.has_machine {
        match state.db.count_cloud_machines().await {
            Ok(count) if count >= state.config.cloud_agents.max_machines => {
                capacity_refused(state, community, candidate).await;
                return WakeOutcome::Capacity;
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(%error, "machine count unreadable; wake not started");
                return WakeOutcome::Skipped;
            }
        }
    }
    match state
        .db
        .begin_cloud_wake(
            community,
            &candidate.agent_pubkey,
            candidate.generation,
            debounce_secs,
        )
        .await
    {
        Ok(true) => {
            super::refresh_head_for(state, community, &candidate.agent_pubkey).await;
            WakeOutcome::Woke
        }
        Ok(false) => {
            if candidate.status == Some(PlacementStatus::Waking) {
                WakeOutcome::Debounced
            } else {
                WakeOutcome::Skipped
            }
        }
        Err(error) => {
            tracing::warn!(%error, "wake not started: database error");
            WakeOutcome::Skipped
        }
    }
}

async fn capacity_refused(state: &Arc<AppState>, community: CommunityId, c: &WakeCandidate) {
    tracing::warn!("cloud machine cap reached; an agent without a machine was not woken");
    match state
        .db
        .set_cloud_status(
            community,
            &c.agent_pubkey,
            c.generation,
            PlacementStatus::Failed,
            Some("capacity"),
        )
        .await
    {
        Ok(true) => {
            super::refresh_head_for(state, community, &c.agent_pubkey).await;
        }
        Ok(false) => {}
        Err(error) => tracing::warn!(%error, "capacity failure not recorded"),
    }
}

/// Wakes one agent now, as the owner asked (a flip to the cloud, or `Try
/// again`): no presence check, no debounce. A wake already queued is not
/// duplicated. Returns whether a wake was started.
pub async fn wake_now(state: &Arc<AppState>, community: CommunityId, agent: &[u8]) -> bool {
    let config = &state.config.cloud_agents;
    if config.mode == CloudMode::Off || config.fly.is_none() {
        return false;
    }
    let row = match state.db.get_cloud_agent(community, agent).await {
        Ok(Some(row)) => row,
        Ok(None) => return false,
        Err(error) => {
            tracing::warn!(%error, "wake not started: agent unreadable");
            return false;
        }
    };
    if row.home != buzz_core::agent_placement::Home::Cloud {
        return false;
    }
    let candidate = WakeCandidate {
        agent_pubkey: row.agent_pubkey.clone(),
        generation: row.generation,
        status: row.status,
        has_machine: row.fly_machine_id.is_some(),
        last_wake_at: row.last_wake_at,
    };
    start_wake(state, community, &candidate, 0).await == WakeOutcome::Woke
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: u32, p: &[&str]) -> StoredEvent {
        let keys = nostr::Keys::generate();
        let tags: Vec<nostr::Tag> = p
            .iter()
            .map(|value| nostr::Tag::parse(["p", value]).expect("p tag"))
            .collect();
        let event = nostr::EventBuilder::new(nostr::Kind::Custom(kind as u16), "hi")
            .tags(tags)
            .sign_with_keys(&keys)
            .expect("sign");
        StoredEvent::new(event, None)
    }

    #[test]
    fn only_message_like_kinds_can_wake_an_agent() {
        for kind in [7u32, 5, 22242, 30682, 47071] {
            assert!(
                !WAKE_KINDS.contains(&kind),
                "kind {kind} must not ring the doorbell"
            );
        }
        assert!(DM_WAKE_KINDS.iter().all(|kind| WAKE_KINDS.contains(kind)));
        assert!(
            !DM_WAKE_KINDS.contains(&KIND_STREAM_REMINDER),
            "a reminder in a DM names its agent in a p tag"
        );
    }

    #[test]
    fn mentions_are_the_valid_deduplicated_p_tags() {
        let a = nostr::Keys::generate().public_key();
        let stored = event(9, &[&a.to_hex(), &a.to_hex(), "not-a-key"]);
        assert_eq!(mentioned_agents(&stored), vec![a.to_bytes().to_vec()]);
        assert!(mentioned_agents(&event(9, &[])).is_empty());
    }
}

#[cfg(test)]
mod postgres_tests {
    use buzz_core::agent_placement::{Home, PlacementStatus};
    use buzz_core::kind::KIND_STREAM_MESSAGE;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use uuid::Uuid;

    use super::*;
    use crate::cloud_agents::fake_host::FakeCall;
    use crate::cloud_agents::presence::FakePresence;
    use crate::cloud_agents::test_support::{fixture, fixture_with, Fixture};

    fn tenant(f: &Fixture, host: String) -> TenantContext {
        TenantContext::resolved(f.community, host)
    }

    async fn tenant_of(f: &Fixture) -> TenantContext {
        let host = f
            .state
            .db
            .lookup_community_host(f.community)
            .await
            .expect("host lookup")
            .expect("host");
        tenant(f, host)
    }

    fn message(author: &Keys, mention: Option<&[u8]>, channel: Option<Uuid>) -> StoredEvent {
        let tags: Vec<Tag> = mention
            .map(|key| {
                let hex = hex::encode(key);
                vec![Tag::parse(["p", hex.as_str()]).expect("p tag")]
            })
            .unwrap_or_default();
        let event = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), "ping")
            .tags(tags)
            .sign_with_keys(author)
            .expect("sign");
        StoredEvent::new(event, channel)
    }

    async fn ring_once(
        f: &Fixture,
        presence: &FakePresence,
        stored: &StoredEvent,
    ) -> Vec<WakeOutcome> {
        let tenant = tenant_of(f).await;
        ring(&f.state, presence, &tenant, stored)
            .await
            .expect("ring")
            .into_iter()
            .map(|(_, outcome)| outcome)
            .collect()
    }

    async fn cloud_agent() -> Fixture {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f
    }

    async fn dm_with(f: &Fixture, author: &Keys) -> Uuid {
        let channel = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO channels (id, community_id, name, channel_type, created_by) \
             VALUES ($1, $2, 'dm', 'dm', $3)",
        )
        .bind(channel)
        .bind(f.community.as_uuid())
        .bind(author.public_key().to_bytes().to_vec())
        .execute(&f.pool)
        .await
        .expect("insert dm channel");
        for member in [f.agent.clone(), author.public_key().to_bytes().to_vec()] {
            sqlx::query(
                "INSERT INTO channel_members (community_id, channel_id, pubkey) VALUES ($1, $2, $3)",
            )
            .bind(f.community.as_uuid())
            .bind(channel)
            .bind(member)
            .execute(&f.pool)
            .await
            .expect("insert dm member");
        }
        channel
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn mention_wakes_sleeping_cloud_agent() {
        let f = cloud_agent().await;
        let sender = Keys::generate();
        let outcomes = ring_once(
            &f,
            &FakePresence::default(),
            &message(&sender, Some(&f.agent), None),
        )
        .await;
        assert_eq!(outcomes, vec![WakeOutcome::Woke]);
        assert_eq!(f.row().await.status, Some(PlacementStatus::Waking));
        // The flip already queued `ensure`; the wake adds `start` after it.
        let journal = f.journal().await;
        assert_eq!(
            journal
                .iter()
                .map(|(op, _, status, _)| (op.as_str(), status.as_str()))
                .collect::<Vec<_>>(),
            vec![("ensure", "pending"), ("start", "pending")]
        );
        // And the journal turns that into a started machine.
        f.pass().await;
        f.pass().await;
        assert!(matches!(f.host.calls().last(), Some(FakeCall::Start(..))));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn dm_message_wakes_member_agent() {
        let f = cloud_agent().await;
        let sender = Keys::generate();
        let channel = dm_with(&f, &sender).await;
        let outcomes = ring_once(
            &f,
            &FakePresence::default(),
            &message(&sender, None, Some(channel)),
        )
        .await;
        assert_eq!(outcomes, vec![WakeOutcome::Woke], "a DM needs no p tag");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_stream_message_with_no_mention_wakes_nobody() {
        let f = cloud_agent().await;
        let sender = Keys::generate();
        let channel = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO channels (id, community_id, name, channel_type, created_by) \
             VALUES ($1, $2, 'general', 'stream', $3)",
        )
        .bind(channel)
        .bind(f.community.as_uuid())
        .bind(sender.public_key().to_bytes().to_vec())
        .execute(&f.pool)
        .await
        .expect("insert channel");
        sqlx::query(
            "INSERT INTO channel_members (community_id, channel_id, pubkey) VALUES ($1, $2, $3)",
        )
        .bind(f.community.as_uuid())
        .bind(channel)
        .bind(&f.agent)
        .execute(&f.pool)
        .await
        .expect("member");
        let outcomes = ring_once(
            &f,
            &FakePresence::default(),
            &message(&sender, None, Some(channel)),
        )
        .await;
        assert!(outcomes.is_empty());
        assert_eq!(f.row().await.status, Some(PlacementStatus::Asleep));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn no_wake_when_present() {
        let f = cloud_agent().await;
        let presence = FakePresence::default();
        presence.set(&f.agent, true);
        let outcomes = ring_once(
            &f,
            &presence,
            &message(&Keys::generate(), Some(&f.agent), None),
        )
        .await;
        assert_eq!(outcomes, vec![WakeOutcome::Present]);
        assert_eq!(f.row().await.status, Some(PlacementStatus::Asleep));
        assert_eq!(
            f.journal().await.len(),
            1,
            "only the flip's ensure is queued"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn wake_debounced_within_60s() {
        let f = cloud_agent().await;
        let presence = FakePresence::default();
        let sender = Keys::generate();
        let first = ring_once(&f, &presence, &message(&sender, Some(&f.agent), None)).await;
        let second = ring_once(&f, &presence, &message(&sender, Some(&f.agent), None)).await;
        assert_eq!(
            (first, second),
            (vec![WakeOutcome::Woke], vec![WakeOutcome::Debounced])
        );
        let starts = f
            .journal()
            .await
            .iter()
            .filter(|(op, ..)| op == "start")
            .count();
        assert_eq!(starts, 1);
        // Past the debounce window a wake that never connected may be rung again.
        sqlx::query("UPDATE cloud_agents SET last_wake_at = now() - interval '2 minutes' WHERE community_id = $1")
            .bind(f.community.as_uuid())
            .execute(&f.pool)
            .await
            .expect("age wake");
        let third = ring_once(&f, &presence, &message(&sender, Some(&f.agent), None)).await;
        assert_eq!(third, vec![WakeOutcome::Woke]);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn wake_gives_up_after_three_attempts() {
        let f = cloud_agent().await;
        let presence = FakePresence::default();
        let sender = Keys::generate();
        f.host.fail_next([
            HostError::Transient("fly down".into()),
            HostError::Transient("fly down".into()),
            HostError::Transient("fly down".into()),
        ]);
        ring_once(&f, &presence, &message(&sender, Some(&f.agent), None)).await;
        for _ in 0..4 {
            f.pass().await;
            f.make_due().await;
        }
        let ensures = f
            .host
            .calls()
            .iter()
            .filter(|call| matches!(call, FakeCall::Ensure(_)))
            .count();
        assert_eq!(ensures, 3, "exactly three attempts, no loop");
        let row = f.row().await;
        assert_eq!(row.status, Some(PlacementStatus::Failed));
        assert!(
            f.journal()
                .await
                .iter()
                .all(|(_, _, status, _)| status != "pending"),
            "nothing is left queued to retry on its own: {:?}",
            f.journal().await
        );
        assert!(
            !f.host
                .calls()
                .iter()
                .any(|call| matches!(call, FakeCall::Start(..))),
            "a failed create must not be followed by a start"
        );

        // The next message starts a fresh wake and this time it works.
        let again = ring_once(&f, &presence, &message(&sender, Some(&f.agent), None)).await;
        assert_eq!(again, vec![WakeOutcome::Woke]);
        f.pass().await;
        f.pass().await;
        assert!(matches!(f.host.calls().last(), Some(FakeCall::Start(..))));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn capacity_cap_blocks_wake() {
        let f = fixture_with(crate::cloud_agents::config::CloudMode::On, |config| {
            config.max_machines = 1;
        })
        .await;
        f.flip(0, Home::Cloud).await;
        // Another agent already holds the one machine the cap allows (the cap is
        // global, so it counts machines of every community).
        let other = nostr::Keys::generate().public_key().to_bytes().to_vec();
        f.state
            .db
            .upsert_cloud_bundle(&buzz_db::cloud_agents::BundleRow {
                community: f.community,
                agent_pubkey: other.clone(),
                owner_pubkey: f.owner.clone(),
                wrapped_dek: vec![1; 28],
                sealed_nsec: vec![2; 48],
                nonce: vec![3; 12],
                kek_id: "test-kek".into(),
                auth_tag: None,
                config: serde_json::json!({"name": "Other"}),
                config_version: 1,
            })
            .await
            .expect("bundle");
        f.state
            .db
            .set_cloud_machine(f.community, &other, "mach_other", "vol_other")
            .await
            .expect("machine");
        let outcomes = ring_once(
            &f,
            &FakePresence::default(),
            &message(&Keys::generate(), Some(&f.agent), None),
        )
        .await;
        assert_eq!(outcomes, vec![WakeOutcome::Capacity]);
        let row = f.row().await;
        assert_eq!(row.status, Some(PlacementStatus::Failed));
        assert_eq!(row.last_error.as_deref(), Some("capacity"));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_mac_agent_is_never_woken_in_the_cloud() {
        let f = cloud_agent().await;
        f.flip(1, Home::Mac).await;
        let outcomes = ring_once(
            &f,
            &FakePresence::default(),
            &message(&Keys::generate(), Some(&f.agent), None),
        )
        .await;
        assert!(outcomes.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn an_agents_own_message_is_not_a_reason_to_wake_it() {
        let f = cloud_agent().await;
        let by_others = f
            .state
            .db
            .cloud_wake_candidates(f.community, None, &[f.agent.clone()], &[9u8; 32])
            .await
            .expect("candidates");
        assert_eq!(by_others.len(), 1);
        let by_itself = f
            .state
            .db
            .cloud_wake_candidates(f.community, None, &[f.agent.clone()], &f.agent)
            .await
            .expect("candidates");
        assert!(by_itself.is_empty(), "the author is never a candidate");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn wake_now_starts_a_wake_without_a_message_and_without_duplicating() {
        let f = cloud_agent().await;
        assert!(wake_now(&f.state, f.community, &f.agent).await);
        assert_eq!(f.row().await.status, Some(PlacementStatus::Waking));
        let starts = |journal: &[(String, i64, String, i32)]| {
            journal.iter().filter(|(op, ..)| op == "start").count()
        };
        assert_eq!(starts(&f.journal().await), 1);
        f.pass().await;
        f.pass().await;
        assert!(
            wake_now(&f.state, f.community, &f.agent).await,
            "Try again always starts over"
        );
        assert_eq!(starts(&f.journal().await), 2);
    }
}
