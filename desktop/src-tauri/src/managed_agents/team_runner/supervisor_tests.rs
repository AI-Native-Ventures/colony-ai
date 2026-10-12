//! Restart policy (review focus 3 and 4).

use super::supervisor::{DownDecision, Settled, SupervisorBook};
use super::EmployeeState;
use crate::managed_agents::credits_pause::ExitHandling;

const PK: &str = "abababababababababababababababababababababababababababababababab";
const RELAY: &str = "wss://lerato.colony.example";
const OTHER_RELAY: &str = "wss://elsewhere.colony.example";

fn expecting() -> SupervisorBook {
    let mut book = SupervisorBook::default();
    book.expect_running(PK, RELAY);
    book
}

/// Crash once at `now`, restart when due, and come back up. Returns the wait.
fn crash_and_restart(book: &mut SupervisorBook, now: &mut i64) -> i64 {
    assert_eq!(book.observe_down(PK, *now), DownDecision::NewExit);
    let Some(Settled::Crashed { restart_in_secs }) =
        book.settle_exit(PK, *now, ExitHandling::Crash)
    else {
        panic!("a counted exit below the limit schedules a restart");
    };
    assert_eq!(
        book.observe_down(PK, *now + restart_in_secs - 1),
        DownDecision::Wait
    );
    *now += restart_in_secs;
    assert_eq!(book.observe_down(PK, *now), DownDecision::RestartNow);
    book.restarting(PK);
    book.note_up(PK, *now);
    restart_in_secs
}

#[test]
fn fifth_exit_in_ten_minutes_is_a_crash_loop_and_stops_restarts() {
    let mut book = expecting();
    let mut now = 1_000;
    let mut waits = Vec::new();
    for _ in 0..4 {
        waits.push(crash_and_restart(&mut book, &mut now));
        now += 1; // it dies a second after each restart
    }
    assert_eq!(waits, vec![5, 15, 45, 120]);

    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now, ExitHandling::Crash),
        Some(Settled::CrashLoop)
    );
    assert!(book.is_failing(PK));
    assert_eq!(book.restarts_in_window(PK, now), 5);
    assert_eq!(
        book.observe_down(PK, now + 3_600),
        DownDecision::Ignore,
        "a failing employee is never restarted by itself"
    );

    book.reset(PK);
    book.expect_running(PK, RELAY);
    assert!(
        !book.is_failing(PK),
        "a person's restart clears the crash loop"
    );
    assert_eq!(book.observe_down(PK, now + 3_601), DownDecision::NewExit);
}

#[test]
fn waits_reach_five_minutes_when_exits_are_spread_out() {
    let mut book = expecting();
    let mut now = 1_000;
    let mut waits = Vec::new();
    for _ in 0..6 {
        waits.push(crash_and_restart(&mut book, &mut now));
        now += 240; // runs four minutes each time, never five exits in ten minutes
        assert!(!book.is_failing(PK));
    }
    assert_eq!(waits, vec![5, 15, 45, 120, 300, 300]);
}

#[test]
fn an_employee_up_for_ten_minutes_starts_a_new_streak() {
    let mut book = expecting();
    let mut now = 1_000;
    assert_eq!(crash_and_restart(&mut book, &mut now), 5);
    now += 1;
    assert_eq!(crash_and_restart(&mut book, &mut now), 15);
    book.note_up(PK, now + 600);
    now += 601;
    assert_eq!(crash_and_restart(&mut book, &mut now), 5);
}

#[test]
fn credits_exits_never_count_toward_the_crash_window() {
    let mut book = expecting();
    let mut now = 1_000;
    for _ in 0..10 {
        assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
        assert_eq!(
            book.settle_exit(PK, now, ExitHandling::PausedForCredits),
            Some(Settled::Paused)
        );
        assert_eq!(
            book.observe_down(PK, now + 600),
            DownDecision::Wait,
            "no backoff restart is scheduled"
        );
        // The credits seam pauses the company, which stops it on purpose;
        // buying credits resumes it.
        book.note_stopped(PK, RELAY);
        book.expect_running(PK, RELAY);
        now += 1;
    }
    assert_eq!(book.restarts_in_window(PK, now), 0);
    assert!(!book.is_failing(PK));

    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now, ExitHandling::RestartNow),
        Some(Settled::RestartNow)
    );
    assert_eq!(book.observe_down(PK, now), DownDecision::RestartNow);
    assert_eq!(
        book.restarts_in_window(PK, now),
        0,
        "a reauthorized restart is not a crash"
    );
}

#[test]
fn an_employee_stopped_on_purpose_is_never_restarted() {
    let mut book = expecting();
    book.note_stopped(PK, RELAY);
    for now in [1_000, 2_000, 90_000] {
        assert_eq!(book.observe_down(PK, now), DownDecision::Ignore);
    }
    assert!(!book.is_expected(PK));
    assert_eq!(
        book.start_failed(PK, 1_000),
        None,
        "a stopped employee is not counted"
    );
}

#[test]
fn stopping_a_pair_on_another_relay_keeps_the_employee_expected() {
    let mut book = expecting();
    book.note_stopped(PK, OTHER_RELAY);
    assert!(book.is_expected(PK));
    assert_eq!(book.expected_on(RELAY), vec![PK.to_string()]);
    assert!(book.expected_on(OTHER_RELAY).is_empty());
}

#[test]
fn a_restart_that_dies_at_once_is_counted_not_repeated() {
    let mut book = expecting();
    let now = 1_000;
    assert_eq!(book.observe_down(PK, now), DownDecision::NewExit);
    book.settle_exit(PK, now, ExitHandling::Crash);
    assert_eq!(book.observe_down(PK, now + 5), DownDecision::RestartNow);
    book.restarting(PK);
    // It died before the next tick saw it up: that is a new, counted exit.
    assert_eq!(book.observe_down(PK, now + 7), DownDecision::NewExit);
    assert_eq!(
        book.settle_exit(PK, now + 7, ExitHandling::Crash),
        Some(Settled::Crashed {
            restart_in_secs: 15
        })
    );
}

#[test]
fn failed_starts_follow_the_same_waits() {
    let mut book = expecting();
    assert_eq!(
        book.start_failed(PK, 1_000),
        Some(Settled::Crashed { restart_in_secs: 5 })
    );
    assert_eq!(book.observe_down(PK, 1_004), DownDecision::Wait);
    assert_eq!(book.observe_down(PK, 1_005), DownDecision::RestartNow);
}

#[test]
fn state_changes_keep_their_first_time() {
    let mut book = SupervisorBook::default();
    assert_eq!(
        book.record_state(PK, EmployeeState::Starting, 10),
        (10, true)
    );
    assert_eq!(
        book.record_state(PK, EmployeeState::Starting, 20),
        (10, false)
    );
    assert_eq!(
        book.record_state(PK, EmployeeState::Running, 30),
        (30, true)
    );
}

#[test]
fn an_async_exit_or_queued_restart_cannot_survive_a_stop_or_new_start() {
    let mut book = SupervisorBook::default();
    book.expect_running(PK, RELAY);
    assert_eq!(book.observe_down(PK, 10), DownDecision::NewExit);
    let old = book.generation(PK, RELAY).expect("expected");
    book.note_stopped(PK, RELAY);
    assert_eq!(
        book.settle_exit_if_current(PK, RELAY, old, 11, ExitHandling::RestartNow),
        None
    );
    assert!(!book.restart_if_current(PK, RELAY, old));
    book.expect_running(PK, RELAY);
    assert_ne!(book.generation(PK, RELAY), Some(old));
    assert_eq!(
        book.settle_exit_if_current(PK, RELAY, old, 12, ExitHandling::Crash),
        None
    );
    assert_eq!(book.restarts_in_window(PK, 12), 0);
    let current = book.generation(PK, RELAY).expect("expected");
    assert!(book.restart_if_current(PK, RELAY, current));
    book.reset(PK);
    assert_eq!(book.start_failed_if_current(PK, RELAY, current, 13), None);
}
