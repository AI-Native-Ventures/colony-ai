//! Relay-answered catch-up: which replayed messages still need an answer.
//!
//! The wake ledger is a local file per home, so it does not travel between "This
//! Mac" and "Cloud". A fresh cloud volume knows nothing, and a Mac coming back
//! after the cloud worked would otherwise answer days of messages the cloud
//! already handled. The relay is the shared memory: a message counts as answered
//! only when the agent published a reply to it. A 👀 or 💬 reaction is progress,
//! never an answer (a harness that reacted and was then stopped left its mention
//! unanswered; see `turn_reply::ReplyPlan::is_answer`).
//!
//! On start every home replays at least the last [`UNANSWERED_WINDOW_SECS`] from
//! the relay (the ledger can only reach further back), and every message that
//! arrives by replay is checked against the relay before it runs. The check
//! fails open: a relay that cannot be asked means one possible duplicate, never
//! silence.

use std::future::Future;

use crate::wake_ledger::WakeLedger;

/// How far back a starting home looks for messages nobody answered: 24 hours.
pub(crate) const UNANSWERED_WINDOW_SECS: u64 = 24 * 60 * 60;

/// The earliest `created_at` a starting home replays from, whatever its ledger says.
pub(crate) fn replay_floor(now: u64) -> u64 {
    now.saturating_sub(UNANSWERED_WINDOW_SECS)
}

/// What to do with a message the wake ledger let through.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CatchUpVerdict {
    /// Run the turn.
    Run,
    /// The agent already published a reply to it: settle it, do not answer twice.
    SkipAnswered,
}

/// Decide whether a message that reached the listener by replay was already
/// answered on the relay.
///
/// Only replayed messages (redelivered after a cut-off turn, or older than this
/// run's listening start) cost a relay question; a live message never does.
/// `answered` asks the relay, `Some(true)` = a reply exists, `None` = the relay
/// could not be asked.
pub(crate) async fn catch_up_verdict<F, Fut>(
    ledger: Option<&WakeLedger>,
    event_id: &str,
    created_at: u64,
    answered: F,
) -> CatchUpVerdict
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Option<bool>>,
{
    let replayed = ledger
        .is_some_and(|ledger| ledger.is_redelivery(event_id) || ledger.is_catch_up(created_at));
    if !replayed {
        return CatchUpVerdict::Run;
    }
    // RED PROOF: relay-answered guard removed.
    let _ = answered().await;
    CatchUpVerdict::Run
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Timestamp};
    use std::sync::atomic::{AtomicUsize, Ordering};

    const NOW: u64 = 1_000_000;

    fn event_at(created_at: u64) -> nostr::Event {
        EventBuilder::new(Kind::Custom(9), "@Scout hello")
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(&Keys::generate())
            .expect("sign")
    }

    /// A ledger of a fresh home (no file) that replays the last 24 hours.
    fn fresh_home_ledger() -> WakeLedger {
        let path = std::env::temp_dir().join(format!(
            "colony-answered-{}/wake.json",
            uuid::Uuid::new_v4()
        ));
        let mut ledger =
            WakeLedger::open(path, "wss://relay.example.com", &"ab".repeat(32), NOW, NOW);
        ledger.widen_catch_up(replay_floor(NOW));
        ledger
    }

    #[test]
    fn replay_floor_is_24_hours_back() {
        assert_eq!(replay_floor(NOW), NOW - 86_400);
        assert_eq!(replay_floor(10), 0, "never underflows");
        assert_eq!(UNANSWERED_WINDOW_SECS, 86_400);
    }

    #[tokio::test]
    async fn catch_up_skips_relay_answered() {
        let ledger = fresh_home_ledger();
        let event = event_at(NOW - 3_600);
        let id = event.id.to_hex();
        let asked = AtomicUsize::new(0);

        // The relay says the agent already replied: not answered a second time.
        let verdict = catch_up_verdict(Some(&ledger), &id, NOW - 3_600, || async {
            asked.fetch_add(1, Ordering::SeqCst);
            Some(true)
        })
        .await;
        assert_eq!(verdict, CatchUpVerdict::SkipAnswered);
        assert_eq!(asked.load(Ordering::SeqCst), 1);

        // No reply on the relay: the replayed message runs.
        let verdict =
            catch_up_verdict(Some(&ledger), &id, NOW - 3_600, || async { Some(false) }).await;
        assert_eq!(verdict, CatchUpVerdict::Run);

        // A relay that cannot be asked fails open: one possible duplicate, not silence.
        let verdict = catch_up_verdict(Some(&ledger), &id, NOW - 3_600, || async { None }).await;
        assert_eq!(verdict, CatchUpVerdict::Run);
    }

    #[tokio::test]
    async fn live_messages_never_cost_a_relay_question() {
        let ledger = fresh_home_ledger();
        let asked = AtomicUsize::new(0);
        let verdict = catch_up_verdict(Some(&ledger), "live", NOW, || async {
            asked.fetch_add(1, Ordering::SeqCst);
            Some(true)
        })
        .await;
        assert_eq!(verdict, CatchUpVerdict::Run);
        assert_eq!(asked.load(Ordering::SeqCst), 0);

        // No ledger at all (a harness started without one): nothing is replayed.
        let verdict = catch_up_verdict(None, "x", NOW - 3_600, || async { Some(true) }).await;
        assert_eq!(verdict, CatchUpVerdict::Run);
    }

    #[tokio::test]
    async fn mention_stalled_while_the_mac_was_off_is_answered_after_the_move() {
        // A mention from 3 hours ago that nobody answered reaches a fresh cloud
        // volume through the 24 hour replay and runs; one from 30 hours ago is
        // outside the window and is never requested.
        let ledger = fresh_home_ledger();
        assert_eq!(ledger.catch_up_since(), Some(replay_floor(NOW)));
        let stalled = event_at(NOW - 3 * 3_600);
        let verdict = catch_up_verdict(
            Some(&ledger),
            &stalled.id.to_hex(),
            NOW - 3 * 3_600,
            || async { Some(false) },
        )
        .await;
        assert_eq!(verdict, CatchUpVerdict::Run);
        assert!(NOW - 30 * 3_600 < ledger.catch_up_since().expect("floor"));
    }
}
