//! Placement watch: a harness leaves when its agent is placed somewhere else.
//!
//! An agent works in exactly one home, "This Mac" or "Cloud". The relay holds
//! the truth as a relay-signed placement head (kind 30682, `d` = the agent's
//! pubkey) with a monotonic generation. Every harness learns its own home and
//! generation at start (a cloud machine from its boot environment, a Mac
//! harness from the first head it reads) and watches the head afterwards.
//!
//! When the head moves away from this harness, the harness
//!   1. takes no new messages (the listener drops them before the wake ledger
//!      sees them, so the next home still finds them unanswered),
//!   2. starts no new turn (queued work stays queued, unanswered),
//!   3. finishes the turn it is on,
//!   4. publishes offline presence through the normal shutdown path, and
//!   5. exits with [`PLACEMENT_MOVED_EXIT_CODE`].
//!
//! A cloud harness reads the head by a bounded poll of the relay's `/query`
//! endpoint every 15 s. A Mac harness reads it once at start and never polls:
//! the relay closes every agent connection on a home change and refuses the
//! next AUTH with "works in another home", which `relay.rs` turns into the same
//! moved-away exit (see `relay::is_home_fence_refusal`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use buzz_core::agent_placement::{Home, PlacementHead, PLACEMENT_SCHEMA_VERSION};
use nostr::{Alphabet, Filter, Kind, PublicKey, SingleLetterTag};
use tokio::sync::mpsc;

use crate::config::PlacementIdentity;
use crate::relay::RestClient;

/// Exit code of a harness whose agent was placed in another home (BSD
/// `EX_TEMPFAIL`): "do not restart me on your own".
pub const PLACEMENT_MOVED_EXIT_CODE: i32 = 75;

/// How often a cloud harness reads the head. Cloud machines are capped, so
/// this is bounded load. A Mac harness runs no recurring poll at all: every
/// local agent of every user would hit `/query` on a timer even with cloud
/// agents switched off. It reads the head once at start, and the relay's home
/// fence (connection closed, next AUTH refused) does the rest.
const CLOUD_POLL: Duration = Duration::from_secs(15);
/// Longest one head query may take.
const QUERY_TIMEOUT: Duration = Duration::from_secs(5);
/// Most heads buffered between the poller and the listener.
const CHANNEL_DEPTH: usize = 4;

static MOVED_AWAY: AtomicBool = AtomicBool::new(false);

/// Record that this process must stop taking work and exit with
/// [`PLACEMENT_MOVED_EXIT_CODE`] once its current turn ends.
pub(crate) fn mark_moved_away() {
    MOVED_AWAY.store(true, Ordering::SeqCst);
}

/// Whether the agent was placed in another home. Read by the dispatcher so no
/// new turn starts, and by `run` to pick the exit code.
pub(crate) fn moved_away() -> bool {
    MOVED_AWAY.load(Ordering::SeqCst)
}

/// `true` when `head` says this harness no longer owns the agent: the
/// generation moved on, or the head names the other home.
pub(crate) fn should_exit(own_home: Home, own_gen: u64, head: &PlacementHead) -> bool {
    head.generation > own_gen || head.home != own_home
}

/// What this harness knows about its own placement.
#[derive(Debug)]
pub(crate) struct PlacementWatch {
    own_home: Home,
    /// Generation this harness runs for. A cloud harness knows it from its boot
    /// environment; a Mac harness learns it from the first head it reads.
    own_gen: Option<u64>,
    moved: bool,
}

impl PlacementWatch {
    pub(crate) fn new(identity: PlacementIdentity) -> Self {
        let own_gen = match identity.home {
            Home::Cloud => Some(identity.generation),
            Home::Mac => None,
        };
        Self {
            own_home: identity.home,
            own_gen,
            moved: false,
        }
    }

    /// Feed one observation of the head (`None` = the relay holds no head, which
    /// means "Mac, generation 0"). Returns whether this harness must leave.
    /// Once moved it stays moved.
    pub(crate) fn observe(&mut self, head: Option<&PlacementHead>) -> bool {
        if self.moved {
            return true;
        }
        let moved = match (self.own_gen, head) {
            (Some(generation), Some(head)) => should_exit(self.own_home, generation, head),
            // No head means Mac at generation 0: a cloud harness has no home.
            (Some(_), None) => self.own_home != Home::Mac,
            (None, Some(head)) => {
                if head.home == self.own_home {
                    self.own_gen = Some(head.generation);
                    false
                } else {
                    true
                }
            }
            (None, None) => {
                self.own_gen = Some(0);
                false
            }
        };
        self.moved = moved;
        moved
    }

    /// Whether this harness has seen itself moved away.
    pub(crate) fn is_moved(&self) -> bool {
        self.moved
    }

    /// May the process exit now? Only after a move, and only once no turn is
    /// running: a reply that is being written finishes where it started.
    pub(crate) fn may_exit(&self, turn_in_flight: bool) -> bool {
        self.moved && !turn_in_flight
    }
}

/// Read the newest valid head for `agent_hex` out of a `/query` response.
///
/// `Ok(None)` means the relay answered and holds no head. Events that are not
/// valid placement heads for this agent are ignored, so a malformed event can
/// never move a harness.
pub(crate) fn head_from_response(
    response: &serde_json::Value,
    agent_hex: &str,
) -> Result<Option<PlacementHead>, String> {
    let events = response
        .as_array()
        .ok_or_else(|| "query response is not an event array".to_owned())?;
    let mut best: Option<PlacementHead> = None;
    for raw in events {
        let Ok(event) = serde_json::from_value::<nostr::Event>(raw.clone()) else {
            continue;
        };
        if event.kind != Kind::Custom(buzz_core::kind::KIND_AGENT_PLACEMENT_HEAD as u16)
            || event.verify().is_err()
        {
            continue;
        }
        let Ok(head) = serde_json::from_str::<PlacementHead>(&event.content) else {
            continue;
        };
        if head.schema != PLACEMENT_SCHEMA_VERSION || head.agent != agent_hex {
            continue;
        }
        let newer = best.as_ref().is_none_or(|current| {
            (head.generation, head.updated_at) > (current.generation, current.updated_at)
        });
        if newer {
            best = Some(head);
        }
    }
    Ok(best)
}

/// Query the relay once for this agent's head.
pub(crate) async fn poll_once(
    rest: &RestClient,
    agent: &PublicKey,
) -> Result<Option<PlacementHead>, String> {
    let agent_hex = agent.to_hex();
    let filter = Filter::new()
        .kind(Kind::Custom(
            buzz_core::kind::KIND_AGENT_PLACEMENT_HEAD as u16,
        ))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [agent_hex.clone()])
        .limit(5);
    let response = tokio::time::timeout(QUERY_TIMEOUT, rest.query(std::slice::from_ref(&filter)))
        .await
        .map_err(|_| format!("timed out after {}s", QUERY_TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;
    head_from_response(&response, &agent_hex)
}

/// Poll the head until the receiver is dropped. Each successful read is sent
/// as `Some(head)` or `None` (no head); a failed read is logged and skipped, so
/// a flaky relay never moves a harness.
///
/// Only a cloud harness polls. A Mac harness gets `None`: it must not add a
/// recurring query per local agent (see [`CLOUD_POLL`]).
pub(crate) fn spawn_watch(
    rest: RestClient,
    agent: PublicKey,
    home: Home,
) -> Option<mpsc::Receiver<Option<PlacementHead>>> {
    if home != Home::Cloud {
        return None;
    }
    let (tx, rx) = mpsc::channel(CHANNEL_DEPTH);
    tokio::spawn(async move {
        let mut timer =
            tokio::time::interval_at(tokio::time::Instant::now() + CLOUD_POLL, CLOUD_POLL);
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut failing = false;
        loop {
            timer.tick().await;
            match poll_once(&rest, &agent).await {
                Ok(head) => {
                    failing = false;
                    if tx.send(head).await.is_err() {
                        return;
                    }
                }
                Err(error) => {
                    // One warning per outage, not one per tick.
                    if !failing {
                        tracing::warn!(%error, "placement head could not be read; will keep trying");
                    }
                    failing = true;
                    if tx.is_closed() {
                        return;
                    }
                }
            }
        }
    });
    Some(rx)
}

/// Test-only: clear the moved-away flag so one test cannot leak into another
/// when the runner shares a process.
#[cfg(test)]
pub(crate) fn reset_moved_away_for_test() {
    MOVED_AWAY.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::agent_placement::PlacementStatus;
    use nostr::{EventBuilder, Keys, Tag};

    fn head(home: Home, generation: u64) -> PlacementHead {
        PlacementHead {
            schema: PLACEMENT_SCHEMA_VERSION,
            agent: "a".repeat(64),
            owner: "b".repeat(64),
            home,
            generation,
            cloud_ready: true,
            config_version: 1,
            cloud_model: None,
            status: match home {
                Home::Cloud => Some(PlacementStatus::Asleep),
                Home::Mac => None,
            },
            updated_at: 1_764_072_000,
        }
    }

    fn cloud() -> PlacementIdentity {
        PlacementIdentity::from_parts("cloud", 4, Some("tok")).expect("cloud identity")
    }

    #[test]
    fn exits_on_newer_generation() {
        assert!(should_exit(Home::Cloud, 4, &head(Home::Cloud, 5)));
        assert!(!should_exit(Home::Cloud, 4, &head(Home::Cloud, 4)));
        // An older head (a stale replica) never moves a harness.
        assert!(!should_exit(Home::Cloud, 4, &head(Home::Cloud, 3)));
        let mut watch = PlacementWatch::new(cloud());
        assert!(!watch.observe(Some(&head(Home::Cloud, 4))));
        assert!(watch.observe(Some(&head(Home::Cloud, 6))));
        assert!(watch.is_moved());
    }

    #[test]
    fn exits_on_home_change() {
        assert!(should_exit(Home::Cloud, 4, &head(Home::Mac, 4)));
        assert!(should_exit(Home::Mac, 2, &head(Home::Cloud, 2)));
        let mut watch = PlacementWatch::new(cloud());
        assert!(watch.observe(Some(&head(Home::Mac, 5))));
        // A head that disappears cannot keep a cloud harness: no head is Mac.
        let mut watch = PlacementWatch::new(cloud());
        assert!(watch.observe(None));
    }

    #[test]
    fn moved_stays_moved() {
        let mut watch = PlacementWatch::new(cloud());
        assert!(watch.observe(Some(&head(Home::Mac, 5))));
        // A later head that matches again (an out-of-order read) does not revive it.
        assert!(watch.observe(Some(&head(Home::Cloud, 4))));
    }

    #[test]
    fn mac_harness_learns_its_generation_from_the_first_head() {
        // Started while the agent is on the Mac at generation 2: stay, then
        // leave only when something newer or different shows up.
        let mut watch = PlacementWatch::new(PlacementIdentity::MAC);
        assert!(!watch.observe(Some(&head(Home::Mac, 2))));
        assert!(!watch.observe(Some(&head(Home::Mac, 2))));
        assert!(watch.observe(Some(&head(Home::Mac, 4))));

        // Started while the agent is already in the cloud: never run.
        let mut watch = PlacementWatch::new(PlacementIdentity::MAC);
        assert!(watch.observe(Some(&head(Home::Cloud, 3))));

        // No head at all is the Mac at generation 0; a later flip moves it.
        let mut watch = PlacementWatch::new(PlacementIdentity::MAC);
        assert!(!watch.observe(None));
        assert!(watch.observe(Some(&head(Home::Cloud, 1))));
    }

    #[test]
    fn finishes_current_turn_before_exit() {
        let mut watch = PlacementWatch::new(cloud());
        // Not moved: never exits, busy or idle.
        assert!(!watch.may_exit(false));
        assert!(!watch.may_exit(true));
        watch.observe(Some(&head(Home::Cloud, 5)));
        // Moved with a turn running: the turn finishes first.
        assert!(!watch.may_exit(true));
        // Moved and idle: exit now.
        assert!(watch.may_exit(false));
    }

    fn signed_head_event(keys: &Keys, head: &PlacementHead) -> serde_json::Value {
        let event = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_AGENT_PLACEMENT_HEAD as u16),
            serde_json::to_string(head).expect("head json"),
        )
        .tags([Tag::parse(["d", head.agent.as_str()]).expect("d tag")])
        .sign_with_keys(keys)
        .expect("sign");
        serde_json::to_value(event).expect("event json")
    }

    #[test]
    fn newest_valid_head_wins_and_junk_is_ignored() {
        let keys = Keys::generate();
        let agent = "a".repeat(64);
        let response = serde_json::json!([
            signed_head_event(&keys, &head(Home::Cloud, 3)),
            signed_head_event(&keys, &head(Home::Mac, 4)),
            {"not": "an event"},
        ]);
        let found = head_from_response(&response, &agent)
            .expect("ok")
            .expect("a head");
        assert_eq!((found.home, found.generation), (Home::Mac, 4));

        // A head for another agent is ignored.
        let other = "c".repeat(64);
        assert_eq!(head_from_response(&response, &other).expect("ok"), None);
        // Empty answer: no head.
        assert_eq!(
            head_from_response(&serde_json::json!([]), &agent).expect("ok"),
            None
        );
        // Not an array: an error, never "no head".
        assert!(head_from_response(&serde_json::json!({"error": "x"}), &agent).is_err());
    }

    #[test]
    fn head_with_bad_signature_or_schema_is_ignored() {
        let keys = Keys::generate();
        let agent = "a".repeat(64);
        let mut tampered = signed_head_event(&keys, &head(Home::Mac, 9));
        tampered["content"] =
            serde_json::json!(serde_json::to_string(&head(Home::Mac, 99)).unwrap());
        assert_eq!(
            head_from_response(&serde_json::json!([tampered]), &agent).expect("ok"),
            None
        );
        let mut bad_schema = head(Home::Mac, 9);
        bad_schema.schema = 2;
        assert_eq!(
            head_from_response(
                &serde_json::json!([signed_head_event(&keys, &bad_schema)]),
                &agent
            )
            .expect("ok"),
            None
        );
    }
}
