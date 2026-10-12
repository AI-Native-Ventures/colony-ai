//! How the host reads the relay's answers to team computer actions.

use buzz_core_pkg::team_computer::TEAM_COMPUTER_HEARTBEAT_MIN_SECS;
use nostr::{EventBuilder, Keys, Kind, Timestamp};

use super::claim::HEARTBEAT_EVERY_SECS;
use super::claim_io::{is_conflict, is_not_holder, is_rate_limited, newest};

#[test]
fn relay_refusals_are_told_apart() {
    let held =
        "relay rejected event: conflict: the team runs on Office iMac; move it with a forced claim";
    let not_holder =
        "relay rejected event: restricted: only the computer that runs the team can do this";
    let too_soon = "relay rejected event: rate-limited: heartbeat at most once every 60 seconds; retry in 12 seconds";
    let offline = "network error: connection refused";

    assert!(is_conflict(held) && !is_conflict(too_soon) && !is_conflict(offline));
    assert!(is_rate_limited(too_soon) && !is_rate_limited(held));
    assert!(is_not_holder(held) && is_not_holder(not_holder));
    assert!(!is_not_holder(too_soon) && !is_not_holder(offline));
}

#[test]
fn the_heartbeat_stays_clear_of_the_relay_limit() {
    let every = i64::try_from(HEARTBEAT_EVERY_SECS).expect("small");
    assert!(
        every >= 2 * TEAM_COMPUTER_HEARTBEAT_MIN_SECS,
        "a heartbeat every {every} s could collide with the relay's {TEAM_COMPUTER_HEARTBEAT_MIN_SECS} s limit"
    );
}

#[test]
fn the_newest_event_wins() {
    let keys = Keys::generate();
    let at = |secs: u64| {
        EventBuilder::new(Kind::Custom(30658), secs.to_string())
            .custom_created_at(Timestamp::from(secs))
            .sign_with_keys(&keys)
            .expect("signed")
    };
    let picked = newest(vec![at(10), at(30), at(20)]).expect("one event");
    assert_eq!(picked.content, "30");
    assert!(newest(Vec::new()).is_none());
}
