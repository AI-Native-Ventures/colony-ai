//! Restart policy for a company's employees. No I/O here.
//!
//! The book is desired state: an employee the team runner expects to run and
//! finds down is restarted after a wait that grows 5 s, 15 s, 45 s, 2 min and
//! 5 min along a streak of exits. The fifth counted exit within ten minutes
//! is a crash loop: the employee is failing and nothing restarts it until a
//! person does. An employee stopped on purpose is not expected and is never
//! restarted. A credits exit is settled by `credits_pause` and never counted.

use std::collections::{HashMap, VecDeque};

use super::EmployeeState;
use crate::managed_agents::credits_pause::ExitHandling;

/// Waits before a restart, by position in the current streak of exits.
pub(crate) const BACKOFF_SECS: [i64; 5] = [5, 15, 45, 120, 300];
/// The crash-loop window.
pub(crate) const CRASH_WINDOW_SECS: i64 = 600;
/// Counted exits inside the window that make a crash loop.
pub(crate) const CRASH_LOOP_EXITS: usize = 5;
/// An employee that stays up this long starts a fresh streak.
pub(crate) const HEALTHY_AFTER_SECS: i64 = 600;

/// What to do about an expected employee that is not running.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DownDecision {
    /// Not expected, failing, or nothing to do.
    Ignore,
    /// First sighting of this exit: settle it with its exit code.
    NewExit,
    /// A restart is scheduled and not due yet.
    Wait,
    /// Start it now.
    RestartNow,
}

/// How one exit or failed start was settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Settled {
    /// Credits paused the company; nothing restarts.
    Paused,
    /// Restart at once, not counted.
    RestartNow,
    /// Counted; restart after this many seconds.
    Crashed {
        /// Seconds until the restart.
        restart_in_secs: i64,
    },
    /// Counted; the fifth in ten minutes: failing, no restart.
    CrashLoop,
}

#[derive(Debug, Clone, Default)]
struct Entry {
    relay_url: String,
    expected: bool,
    exits: VecDeque<i64>,
    streak: usize,
    up_since: Option<i64>,
    down_since: Option<i64>,
    restart_at: Option<i64>,
    failing: bool,
    state: Option<(EmployeeState, i64)>,
}

/// Every employee the team runner knows about, keyed by lowercase pubkey.
#[derive(Debug, Default)]
pub(crate) struct SupervisorBook {
    entries: HashMap<String, Entry>,
}

fn key(pubkey: &str) -> String {
    pubkey.to_ascii_lowercase()
}

impl SupervisorBook {
    /// The team runner wants `pubkey` running on `relay_url`.
    pub(crate) fn expect_running(&mut self, pubkey: &str, relay_url: &str) {
        let entry = self.entries.entry(key(pubkey)).or_default();
        entry.relay_url = relay_url.to_string();
        entry.expected = true;
        entry.down_since = None;
        entry.restart_at = None;
    }

    /// The pair on `relay_url` was stopped on purpose (a person, pause,
    /// delete or a move). A stop on another relay changes nothing.
    pub(crate) fn note_stopped(&mut self, pubkey: &str, relay_url: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            if entry.relay_url == relay_url {
                entry.expected = false;
                entry.down_since = None;
                entry.restart_at = None;
                entry.up_since = None;
            }
        }
    }

    /// Forget the crash history: a person restarted the employee.
    pub(crate) fn reset(&mut self, pubkey: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.exits.clear();
            entry.streak = 0;
            entry.failing = false;
            entry.down_since = None;
            entry.restart_at = None;
        }
    }

    /// The pair is running.
    pub(crate) fn note_up(&mut self, pubkey: &str, now: i64) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.down_since = None;
            entry.restart_at = None;
            let up_since = *entry.up_since.get_or_insert(now);
            if now - up_since >= HEALTHY_AFTER_SECS {
                entry.streak = 0;
            }
        }
    }

    /// The pair is not running.
    pub(crate) fn observe_down(&mut self, pubkey: &str, now: i64) -> DownDecision {
        let Some(entry) = self.entries.get_mut(&key(pubkey)) else {
            return DownDecision::Ignore;
        };
        if !entry.expected || entry.failing {
            return DownDecision::Ignore;
        }
        entry.up_since = None;
        if entry.down_since.is_none() {
            entry.down_since = Some(now);
            return DownDecision::NewExit;
        }
        match entry.restart_at {
            Some(at) if now >= at => DownDecision::RestartNow,
            _ => DownDecision::Wait,
        }
    }

    /// Settle a new exit with what the credits seam decided.
    pub(crate) fn settle_exit(
        &mut self,
        pubkey: &str,
        now: i64,
        handling: ExitHandling,
    ) -> Option<Settled> {
        match handling {
            ExitHandling::PausedForCredits => {
                self.entries.get_mut(&key(pubkey))?.restart_at = None;
                Some(Settled::Paused)
            }
            ExitHandling::RestartNow => {
                self.entries.get_mut(&key(pubkey))?.restart_at = Some(now);
                Some(Settled::RestartNow)
            }
            ExitHandling::Crash => self.count_failure(pubkey, now),
        }
    }

    /// A restart is being attempted: the next sighting of this employee down
    /// is a new exit, so a harness that dies at once is counted.
    pub(crate) fn restarting(&mut self, pubkey: &str) {
        if let Some(entry) = self.entries.get_mut(&key(pubkey)) {
            entry.down_since = None;
            entry.restart_at = None;
        }
    }

    /// A start attempt failed; counted like a crash.
    pub(crate) fn start_failed(&mut self, pubkey: &str, now: i64) -> Option<Settled> {
        self.count_failure(pubkey, now)
    }

    fn count_failure(&mut self, pubkey: &str, now: i64) -> Option<Settled> {
        let entry = self.entries.get_mut(&key(pubkey))?;
        if !entry.expected || entry.failing {
            return None;
        }
        entry.down_since.get_or_insert(now);
        entry.exits.push_back(now);
        while entry
            .exits
            .front()
            .is_some_and(|at| now - at >= CRASH_WINDOW_SECS)
        {
            entry.exits.pop_front();
        }
        entry.streak += 1;
        if entry.exits.len() >= CRASH_LOOP_EXITS {
            entry.failing = true;
            entry.restart_at = None;
            return Some(Settled::CrashLoop);
        }
        let wait = BACKOFF_SECS[(entry.streak - 1).min(BACKOFF_SECS.len() - 1)];
        entry.restart_at = Some(now + wait);
        Some(Settled::Crashed {
            restart_in_secs: wait,
        })
    }

    /// Remember the reported state; returns when it began and whether it changed.
    pub(crate) fn record_state(
        &mut self,
        pubkey: &str,
        state: EmployeeState,
        now: i64,
    ) -> (i64, bool) {
        let entry = self.entries.entry(key(pubkey)).or_default();
        match entry.state {
            Some((current, since)) if current == state => (since, false),
            _ => {
                entry.state = Some((state, now));
                (now, true)
            }
        }
    }

    /// Counted exits in the last ten minutes.
    pub(crate) fn restarts_in_window(&self, pubkey: &str, now: i64) -> u32 {
        self.entries.get(&key(pubkey)).map_or(0, |entry| {
            let recent = entry
                .exits
                .iter()
                .filter(|at| now - **at < CRASH_WINDOW_SECS)
                .count();
            u32::try_from(recent).unwrap_or(u32::MAX)
        })
    }

    /// Whether restarts stopped after a crash loop.
    pub(crate) fn is_failing(&self, pubkey: &str) -> bool {
        self.entries
            .get(&key(pubkey))
            .is_some_and(|entry| entry.failing)
    }

    /// Whether the team runner wants `pubkey` running.
    pub(crate) fn is_expected(&self, pubkey: &str) -> bool {
        self.entries
            .get(&key(pubkey))
            .is_some_and(|entry| entry.expected)
    }

    /// Employees expected to run on `relay_url`.
    pub(crate) fn expected_on(&self, relay_url: &str) -> Vec<String> {
        let mut pubkeys: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.expected && entry.relay_url == relay_url)
            .map(|(pubkey, _)| pubkey.clone())
            .collect();
        pubkeys.sort();
        pubkeys
    }
}
