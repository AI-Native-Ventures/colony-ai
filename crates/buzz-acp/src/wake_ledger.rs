//! Durable record of the wake events a managed employee has handled.
//!
//! Every run used to subscribe from a startup watermark close to process
//! start, so a mention or routine wake sent while the computer slept or Colony
//! was closed never reached the employee. The ledger keeps one small JSON file
//! per employee and relay: a floor, an eviction exclusion boundary, and the ids
//! of recently handled events. On start the channel subscriptions replay from
//! the floor (at most
//! [`MAX_LOOKBACK_SECS`] back) and every id already handled is skipped, so each
//! missed event is processed once.
//! The persisted exclusion boundary takes precedence over the startup watermark
//! and time clamp, so evicted events stay excluded even after a clock rewind.
//!
//! Events are recorded as handled before a turn sees them: the listener calls
//! [`WakeLedger::commit`] with a batch right before its turn starts, and with a
//! steered event right before it reaches a running turn, and starts nothing
//! when the file cannot be written. A crash during a turn therefore never
//! replays that turn's events. Events still waiting in the queue stay out of
//! the handled list and hold the floor at or below them, so a restart replays
//! them. Events handed back with [`WakeLedger::forget_events`] (a turn that
//! stopped before doing its work, for example because credits ran out) leave
//! the handled list too and are processed again on the next start, once.
//!
//! Known limits: a turn cut short by a crash is not run again (at most once);
//! a handed-back event older than an id already forgotten by the size bound is
//! not replayed (at most once wins);
//! an event whose `created_at` is already older than the floor when it reaches
//! the relay is not replayed; one replay request returns at most the relay's
//! query limit of stored events, so a very busy week offline replays only the
//! newest of them.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::relay::SINCE_SKEW_SECS;

/// Longest look-back a restarted employee replays: seven days.
pub(crate) const MAX_LOOKBACK_SECS: u64 = 7 * 24 * 60 * 60;
/// Most handled ids kept in memory and in the file.
pub(crate) const MAX_HANDLED: usize = 512;
/// How long the floor stays at this run's replay start. The startup replay
/// arrives newest first and one channel at a time; holding the floor until it
/// has settled keeps a restart inside that window from skipping older events.
pub(crate) const SETTLE_SECS: u64 = 30;
/// Pause after a failed write before the next attempt.
pub(crate) const WRITE_RETRY_SECS: u64 = 30;
/// Largest ledger file read back; a bigger file is treated as damaged.
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// File format version; a file with any other version is replaced.
const FILE_VERSION: u32 = 1;

/// Current unix time in seconds; zero if the clock reads before 1970.
pub(crate) fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// One handled event: its id and the `created_at` it was published with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandledEvent {
    id: String,
    created_at: u64,
}

/// The ledger file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedgerFile {
    version: u32,
    relay_url: String,
    agent_pubkey: String,
    floor: u64,
    /// Lowest floor that keeps evicted ids outside the relay's replay window.
    /// Older version-one files have no eviction boundary recorded.
    #[serde(default)]
    evicted_floor: u64,
    handled: Vec<HandledEvent>,
}

/// How a delivered channel event relates to what this employee already handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Admission {
    /// Handled before, in this run or an earlier one. Skip it.
    Duplicate,
    /// New, and inside the window every start replays anyway.
    Live,
    /// New, and delivered only because this run replayed from the saved floor:
    /// it was sent while the employee was offline.
    CaughtUp,
}

/// What a write attempt did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SyncOutcome {
    /// The file already matched the current state.
    Unchanged,
    /// The file now holds the current state.
    Written,
    /// A recent write failed; the next attempt waits for [`WRITE_RETRY_SECS`].
    Deferred,
    /// The write failed. The state stays in memory and is written later.
    Failed,
}

impl SyncOutcome {
    /// Whether the file now holds the current state.
    pub(crate) fn is_saved(self) -> bool {
        matches!(self, Self::Unchanged | Self::Written)
    }
}

/// Floor and handled ids for one employee on one relay, backed by one file.
pub(crate) struct WakeLedger {
    path: PathBuf,
    relay_url: String,
    agent_pubkey: String,
    /// Where this run's channel subscriptions start, when a usable file existed.
    catch_up_since: Option<u64>,
    /// Events created before this were delivered only by the catch-up.
    live_cutoff: u64,
    /// The replay start while startup settles, including the saved eviction boundary.
    /// Pending or released events may lower snapshots only to that boundary.
    baseline: u64,
    settle_until: u64,
    /// Newest `created_at` delivered in this run, capped at the receive time.
    newest_received: Option<u64>,
    handled: VecDeque<HandledEvent>,
    handled_ids: HashSet<String>,
    /// Ids recorded through [`WakeLedger::commit`]: handled even while the same
    /// event still waits in the queue (a steered event).
    committed: HashSet<String>,
    /// Lowest floor that keeps every evicted id out of the next replay.
    evicted_floor: u64,
    /// Events handed back by [`WakeLedger::forget_events`] and not received
    /// again since, with their `created_at`. They hold the floor at or below
    /// them, so the next start replays them.
    released: HashMap<String, u64>,
    written: Option<LedgerFile>,
    retry_at: Option<u64>,
}

impl WakeLedger {
    /// Load the ledger at `path` for this employee and relay.
    ///
    /// A missing file means a first run: nothing older than the startup
    /// watermark is replayed. A damaged file, or one written for another
    /// employee, relay or format, is logged and replaced on the next write;
    /// that start also keeps the startup watermark, so it can miss wakes but
    /// never runs one twice.
    /// A saved eviction boundary overrides the usual time and startup clamps,
    /// even when it temporarily lies after `now` or `startup_watermark`.
    pub(crate) fn open(
        path: PathBuf,
        relay_url: &str,
        agent_pubkey: &str,
        now: u64,
        startup_watermark: u64,
    ) -> Self {
        let loaded = match read_file(&path) {
            Ok(Some(file))
                if file.version == FILE_VERSION
                    && file.relay_url == relay_url
                    && file.agent_pubkey == agent_pubkey =>
            {
                Some(file)
            }
            Ok(Some(_)) => {
                tracing::warn!(
                    path = %path.display(),
                    "wake ledger was written for another employee, relay or format; starting fresh"
                );
                None
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    "wake ledger is unreadable, starting fresh: {error}"
                );
                None
            }
        };
        let evicted_floor = loaded.as_ref().map_or(0, |file| file.evicted_floor);
        let catch_up_since = loaded.as_ref().map(|file| {
            file.floor
                .clamp(now.saturating_sub(MAX_LOOKBACK_SECS), now)
                .min(startup_watermark)
                .max(evicted_floor)
        });
        let mut ledger = Self {
            path,
            relay_url: relay_url.to_string(),
            agent_pubkey: agent_pubkey.to_string(),
            catch_up_since,
            live_cutoff: startup_watermark.saturating_sub(SINCE_SKEW_SECS),
            baseline: catch_up_since.unwrap_or(startup_watermark),
            settle_until: now.saturating_add(SETTLE_SECS),
            newest_received: None,
            handled: VecDeque::new(),
            handled_ids: HashSet::new(),
            committed: HashSet::new(),
            evicted_floor,
            released: HashMap::new(),
            written: None,
            retry_at: None,
        };
        for entry in loaded.map(|file| file.handled).unwrap_or_default() {
            ledger.remember(entry);
        }
        ledger
    }

    /// Where this run's channel subscriptions should start: the saved floor, at
    /// most [`MAX_LOOKBACK_SECS`] back and at or before the startup watermark,
    /// unless the persisted eviction boundary requires a later start to exclude
    /// handled events whose ids were evicted. `None` keeps the startup watermark.
    pub(crate) fn catch_up_since(&self) -> Option<u64> {
        self.catch_up_since
    }

    /// Record a channel event the listener received.
    ///
    /// `now` caps a future `created_at`, so one event from a fast clock cannot
    /// move the floor past events that are still to come.
    pub(crate) fn admit(&mut self, event: &nostr::Event, now: u64) -> Admission {
        let created_at = event.created_at.as_secs();
        let seen_at = created_at.min(now);
        self.newest_received = Some(
            self.newest_received
                .map_or(seen_at, |newest| newest.max(seen_at)),
        );
        let id = event.id.to_hex();
        // Received again: a handed-back event no longer holds the floor.
        self.released.remove(&id);
        if self.handled_ids.contains(&id) {
            return Admission::Duplicate;
        }
        self.remember(HandledEvent { id, created_at });
        if self.catch_up_since.is_some() && created_at < self.live_cutoff {
            Admission::CaughtUp
        } else {
            Admission::Live
        }
    }

    /// Record `events` as handled and save the ledger before a turn sees them.
    ///
    /// The events count as handled from now on, even while one of them still
    /// waits in the queue (a steered event). The caller lets the turn see them
    /// only when the result [`SyncOutcome::is_saved`].
    pub(crate) fn commit<'e, 'p>(
        &mut self,
        events: impl IntoIterator<Item = &'e nostr::Event>,
        pending: impl IntoIterator<Item = &'p nostr::Event>,
        now: u64,
    ) -> SyncOutcome {
        for event in events {
            let id = event.id.to_hex();
            self.remember(HandledEvent {
                id: id.clone(),
                created_at: event.created_at.as_secs(),
            });
            self.committed.insert(id);
        }
        self.sync(pending, now)
    }

    /// Hand events back after their turn stopped before doing the work, for
    /// example when credits ran out mid-turn and the process is about to exit.
    ///
    /// They leave the handled list and hold the floor at or below them, so the
    /// next start processes them again, once. The ledger is written at once,
    /// ignoring the write backoff, because this is the last chance before the
    /// process exits; the caller logs a result that is not
    /// [`SyncOutcome::is_saved`]. Ids this ledger never handled are ignored.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "part I (credits live) calls this when credits run out mid-turn; remove this attribute there"
        )
    )]
    pub(crate) fn forget_events<'i, 'p>(
        &mut self,
        event_ids: impl IntoIterator<Item = &'i str>,
        pending: impl IntoIterator<Item = &'p nostr::Event>,
        now: u64,
    ) -> SyncOutcome {
        let forgotten: HashSet<&str> = event_ids.into_iter().collect();
        let mut kept = VecDeque::with_capacity(self.handled.len());
        for entry in self.handled.drain(..) {
            if forgotten.contains(entry.id.as_str()) {
                self.handled_ids.remove(&entry.id);
                self.committed.remove(&entry.id);
                self.released.insert(entry.id.clone(), entry.created_at);
            } else {
                kept.push_back(entry);
            }
        }
        self.handled = kept;
        self.write_snapshot(pending, now)
    }

    /// Write the ledger when it changed since the last successful write.
    ///
    /// `pending` lists the events still waiting in the queue: unless committed,
    /// they stay out of the handled list and hold the floor at or below them,
    /// so a restart replays them. A failed write keeps the state in memory and
    /// is retried after [`WRITE_RETRY_SECS`].
    pub(crate) fn sync<'p>(
        &mut self,
        pending: impl IntoIterator<Item = &'p nostr::Event>,
        now: u64,
    ) -> SyncOutcome {
        if self.retry_at.is_some_and(|retry_at| now < retry_at) {
            return SyncOutcome::Deferred;
        }
        self.write_snapshot(pending, now)
    }

    /// Write the current state now when it changed, ignoring the backoff.
    fn write_snapshot<'p>(
        &mut self,
        pending: impl IntoIterator<Item = &'p nostr::Event>,
        now: u64,
    ) -> SyncOutcome {
        let file = self.snapshot(pending, now);
        if self.written.as_ref() == Some(&file) {
            self.retry_at = None;
            return SyncOutcome::Unchanged;
        }
        match write_file(&self.path, &file) {
            Ok(()) => {
                self.written = Some(file);
                self.retry_at = None;
                SyncOutcome::Written
            }
            Err(error) => {
                tracing::warn!(
                    path = %self.path.display(),
                    "wake ledger write failed, retrying in {WRITE_RETRY_SECS}s: {error}"
                );
                self.retry_at = Some(now.saturating_add(WRITE_RETRY_SECS));
                SyncOutcome::Failed
            }
        }
    }

    /// Whether the last write attempt failed and no write has succeeded since.
    pub(crate) fn write_failed(&self) -> bool {
        self.retry_at.is_some()
    }

    /// How long until the next write attempt after a failure. `None` when no
    /// write failed, or when the backoff already ended: a passed deadline never
    /// wakes the main loop again by itself (no busy loop); the next dispatch
    /// retries instead.
    pub(crate) fn retry_delay(&self, now: u64) -> Option<Duration> {
        let retry_at = self.retry_at.filter(|retry_at| *retry_at > now)?;
        Some(Duration::from_secs(retry_at - now))
    }

    fn snapshot<'p>(
        &self,
        pending: impl IntoIterator<Item = &'p nostr::Event>,
        now: u64,
    ) -> LedgerFile {
        let mut pending_ids = HashSet::new();
        let mut oldest_pending: Option<u64> = None;
        for event in pending {
            let id = event.id.to_hex();
            if self.committed.contains(&id) {
                continue;
            }
            let created_at = event.created_at.as_secs();
            oldest_pending =
                Some(oldest_pending.map_or(created_at, |oldest| oldest.min(created_at)));
            pending_ids.insert(id);
        }
        let caught_up = if now < self.settle_until {
            self.baseline
        } else {
            self.newest_received
                .unwrap_or(self.baseline)
                .max(self.baseline)
        };
        let lowest_unhandled = oldest_pending
            .into_iter()
            .chain(self.released.values().copied())
            .min();
        let floor = lowest_unhandled
            .map_or(caught_up, |lowest| lowest.min(caught_up))
            .max(self.evicted_floor);
        LedgerFile {
            version: FILE_VERSION,
            relay_url: self.relay_url.clone(),
            agent_pubkey: self.agent_pubkey.clone(),
            floor,
            evicted_floor: self.evicted_floor,
            handled: self
                .handled
                .iter()
                .filter(|entry| !pending_ids.contains(&entry.id))
                .cloned()
                .collect(),
        }
    }

    fn remember(&mut self, entry: HandledEvent) {
        if !self.handled_ids.insert(entry.id.clone()) {
            return;
        }
        self.handled.push_back(entry);
        while self.handled.len() > MAX_HANDLED {
            let Some(evicted) = self.handled.pop_front() else {
                break;
            };
            self.handled_ids.remove(&evicted.id);
            self.committed.remove(&evicted.id);
            // A replay starts `SINCE_SKEW_SECS` before the floor; keep it after
            // the forgotten id so that id is never processed again.
            self.evicted_floor = self
                .evicted_floor
                .max(evicted.created_at.saturating_add(SINCE_SKEW_SECS + 1));
        }
    }
}

fn read_file(path: &Path) -> std::io::Result<Option<LedgerFile>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(std::io::Error::other(
            "wake ledger is larger than its limit",
        ));
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(std::io::Error::other)
}

/// Replace the ledger atomically: write a temporary file, flush it to disk,
/// then rename it over the old one, so a crash never leaves a torn file.
fn write_file(path: &Path, file: &LedgerFile) -> std::io::Result<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(file).map_err(std::io::Error::other)?;
    let temp = path.with_extension("tmp");
    let mut out = std::fs::File::create(&temp)?;
    out.write_all(&bytes)?;
    out.sync_all()?;
    drop(out);
    std::fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Timestamp};

    const RELAY: &str = "wss://relay.example.com";

    fn agent() -> String {
        "ab".repeat(32)
    }

    fn event_at(created_at: u64) -> nostr::Event {
        EventBuilder::new(Kind::Custom(9), "wake")
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(&Keys::generate())
            .expect("sign test event")
    }

    /// A ledger path inside a fresh temporary directory, removed on drop.
    struct TempLedger {
        dir: PathBuf,
    }

    impl TempLedger {
        fn new() -> Self {
            Self {
                dir: std::env::temp_dir()
                    .join(format!("colony-wake-ledger-{}", uuid::Uuid::new_v4())),
            }
        }

        fn path(&self) -> PathBuf {
            self.dir.join("wake.json")
        }

        fn open(&self, now: u64) -> WakeLedger {
            WakeLedger::open(self.path(), RELAY, &agent(), now, now)
        }

        fn written(&self) -> LedgerFile {
            read_file(&self.path())
                .expect("read ledger")
                .expect("ledger exists")
        }
    }

    impl Drop for TempLedger {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn first_run_starts_at_the_startup_watermark() {
        let temp = TempLedger::new();
        let mut ledger = temp.open(10_000);
        assert_eq!(
            ledger.catch_up_since(),
            None,
            "without a file nothing older than the watermark is replayed"
        );
        assert_eq!(ledger.admit(&event_at(9_000), 10_000), Admission::Live);
        assert_eq!(
            ledger.sync(std::iter::empty(), 10_000),
            SyncOutcome::Written
        );
        assert_eq!(
            temp.written().floor,
            10_000,
            "a first run records where it started"
        );
    }

    #[test]
    fn first_run_keeps_a_replay_floor_that_reaches_back_further() {
        // The host passes the moment before it published the hire, so the
        // on-hire kickoff already on the relay is replayed on the first start.
        let temp = TempLedger::new();
        let mut ledger = WakeLedger::open(temp.path(), RELAY, &agent(), 10_000, 9_950);
        assert_eq!(ledger.catch_up_since(), None);
        assert_eq!(
            ledger.admit(&event_at(9_960), 10_000),
            Admission::Live,
            "the kickoff is inside the startup window"
        );
        ledger.sync(std::iter::empty(), 10_000);
        assert_eq!(temp.written().floor, 9_950);
    }

    #[test]
    fn restart_replays_from_the_floor_and_skips_handled_events() {
        let temp = TempLedger::new();
        let handled = event_at(10_100);
        let mut first = temp.open(10_000);
        assert_eq!(first.admit(&handled, 10_100), Admission::Live);
        first.sync(std::iter::empty(), 10_000 + SETTLE_SECS);
        assert_eq!(temp.written().floor, 10_100);

        let mut second = temp.open(20_000);
        assert_eq!(second.catch_up_since(), Some(10_100));
        assert_eq!(second.admit(&handled, 20_000), Admission::Duplicate);
        assert_eq!(second.admit(&event_at(15_000), 20_000), Admission::CaughtUp);
        assert_eq!(second.admit(&event_at(19_999), 20_000), Admission::Live);
    }

    #[test]
    fn queued_events_stay_replayable_after_restart() {
        let temp = TempLedger::new();
        let dispatched = event_at(10_100);
        let queued = event_at(10_050);
        let mut first = temp.open(10_000);
        first.admit(&dispatched, 10_100);
        first.admit(&queued, 10_100);
        first.sync([&queued], 10_000 + SETTLE_SECS);
        let file = temp.written();
        assert_eq!(
            file.floor, 10_050,
            "a queued event holds the floor at its own time"
        );
        assert!(file
            .handled
            .iter()
            .all(|entry| entry.id != queued.id.to_hex()));

        let mut second = temp.open(20_000);
        assert_eq!(
            second.admit(&queued, 20_000),
            Admission::CaughtUp,
            "the queued event runs after the restart"
        );
        assert_eq!(
            second.admit(&dispatched, 20_000),
            Admission::Duplicate,
            "the dispatched event does not run twice"
        );
    }

    #[test]
    fn a_committed_event_counts_as_handled_while_still_queued() {
        let temp = TempLedger::new();
        let steered = event_at(10_100);
        let mut first = temp.open(10_000);
        first.admit(&steered, 10_100);
        assert!(first
            .commit([&steered], [&steered], 10_000 + SETTLE_SECS)
            .is_saved());
        assert!(
            temp.written()
                .handled
                .iter()
                .any(|entry| entry.id == steered.id.to_hex()),
            "a steered event is saved as handled before it reaches the turn"
        );
        let mut second = temp.open(20_000);
        assert_eq!(
            second.admit(&steered, 20_000),
            Admission::Duplicate,
            "it is not answered again after a restart"
        );
    }

    #[test]
    fn crash_during_replay_never_answers_twice() {
        let temp = TempLedger::new();
        // The last run saved floor 10_000, then the computer slept.
        temp.open(10_000).sync(std::iter::empty(), 10_000);
        let first_wake = event_at(12_000);
        let second_wake = event_at(13_000);

        // Restart: both wakes arrive through the catch-up replay.
        let mut replay = temp.open(20_000);
        assert_eq!(replay.catch_up_since(), Some(10_000));
        assert_eq!(replay.admit(&first_wake, 20_000), Admission::CaughtUp);
        assert_eq!(replay.admit(&second_wake, 20_000), Admission::CaughtUp);
        // The first wake's turn starts, so it is saved as handled first. The
        // second still waits in the queue.
        assert!(replay
            .commit([&first_wake], [&second_wake], 20_001)
            .is_saved());
        // Crash: the process dies mid-turn and writes nothing else.
        drop(replay);
        // A torn temporary file from an interrupted write is ignored.
        std::fs::write(temp.path().with_extension("tmp"), b"{\"partial")
            .expect("write a torn temporary file");

        let mut after_crash = temp.open(30_000);
        assert_eq!(
            after_crash.catch_up_since(),
            Some(10_000),
            "the floor stays at or below the wake still queued"
        );
        assert_eq!(
            after_crash.admit(&first_wake, 30_000),
            Admission::Duplicate,
            "the wake whose turn had started is never answered twice"
        );
        assert_eq!(
            after_crash.admit(&second_wake, 30_000),
            Admission::CaughtUp,
            "the wake that never reached a turn still runs once"
        );
    }

    #[test]
    fn look_back_is_capped_at_seven_days() {
        let temp = TempLedger::new();
        temp.open(1_000).sync(std::iter::empty(), 1_000);
        let now = 1_000 + 30 * 24 * 60 * 60;
        assert_eq!(
            temp.open(now).catch_up_since(),
            Some(now - MAX_LOOKBACK_SECS)
        );
    }

    #[test]
    fn catch_up_never_starts_after_the_startup_watermark() {
        let temp = TempLedger::new();
        let mut first = temp.open(10_000);
        first.admit(&event_at(10_900), 10_900);
        first.sync(std::iter::empty(), 10_900);
        assert_eq!(temp.written().floor, 10_900);
        // A replay floor from the host already reaches back further.
        let second = WakeLedger::open(temp.path(), RELAY, &agent(), 11_000, 10_500);
        assert_eq!(second.catch_up_since(), Some(10_500));
    }

    #[test]
    fn floor_waits_for_the_startup_replay_to_settle() {
        let temp = TempLedger::new();
        let mut ledger = temp.open(10_000);
        ledger.admit(&event_at(10_020), 10_020);
        ledger.sync(std::iter::empty(), 10_020);
        assert_eq!(
            temp.written().floor,
            10_000,
            "older replayed events may still be on their way"
        );
        ledger.sync(std::iter::empty(), 10_000 + SETTLE_SECS);
        assert_eq!(temp.written().floor, 10_020);
    }

    #[test]
    fn a_future_dated_event_cannot_move_the_floor_past_now() {
        let temp = TempLedger::new();
        let mut ledger = temp.open(10_000);
        ledger.admit(&event_at(99_999), 10_040);
        ledger.sync(std::iter::empty(), 10_040);
        assert_eq!(temp.written().floor, 10_040);
    }

    #[test]
    fn a_damaged_or_foreign_ledger_starts_fresh() {
        let temp = TempLedger::new();
        std::fs::create_dir_all(&temp.dir).expect("create ledger dir");
        std::fs::write(temp.path(), b"not json").expect("write damaged ledger");
        assert_eq!(temp.open(10_000).catch_up_since(), None);

        WakeLedger::open(temp.path(), RELAY, &"cd".repeat(32), 10_000, 10_000)
            .sync(std::iter::empty(), 10_000);
        assert_eq!(
            temp.open(20_000).catch_up_since(),
            None,
            "another employee's ledger is ignored"
        );

        WakeLedger::open(
            temp.path(),
            "wss://other.example.com",
            &agent(),
            10_000,
            10_000,
        )
        .sync(std::iter::empty(), 10_000);
        assert_eq!(
            temp.open(20_000).catch_up_since(),
            None,
            "another relay's ledger is ignored"
        );

        temp.open(10_000).sync(std::iter::empty(), 10_000);
        assert_eq!(
            temp.open(20_000).catch_up_since(),
            Some(10_000),
            "its own ledger is used"
        );
    }

    #[test]
    fn a_failed_write_backs_off_and_blocks_commits_until_it_succeeds() {
        let temp = TempLedger::new();
        let mut ledger = temp.open(10_000);
        assert_eq!(
            ledger.sync(std::iter::empty(), 10_000),
            SyncOutcome::Written
        );
        assert_eq!(
            ledger.sync(std::iter::empty(), 10_001),
            SyncOutcome::Unchanged
        );
        assert!(SyncOutcome::Written.is_saved() && SyncOutcome::Unchanged.is_saved());
        assert!(!ledger.write_failed());

        // A file where the ledger folder should be makes every write fail.
        std::fs::write(temp.dir.join("blocker"), b"").expect("write blocker file");
        let mut blocked = WakeLedger::open(
            temp.dir.join("blocker").join("wake.json"),
            RELAY,
            &agent(),
            10_000,
            10_000,
        );
        let wake = event_at(10_000);
        assert_eq!(
            blocked.commit([&wake], std::iter::empty(), 10_000),
            SyncOutcome::Failed
        );
        assert!(!SyncOutcome::Failed.is_saved());
        assert!(blocked.write_failed());
        assert_eq!(
            blocked.commit([&wake], std::iter::empty(), 10_000 + WRITE_RETRY_SECS - 1),
            SyncOutcome::Deferred,
            "commits wait for the backoff"
        );
        assert!(!SyncOutcome::Deferred.is_saved());
        assert_eq!(
            blocked.retry_delay(10_000 + WRITE_RETRY_SECS - 1),
            Some(std::time::Duration::from_secs(1)),
            "the main loop is told when to retry"
        );
        assert_eq!(
            blocked.retry_delay(10_000 + WRITE_RETRY_SECS),
            None,
            "a passed deadline never wakes the loop by itself"
        );
        assert_eq!(
            blocked.commit([&wake], std::iter::empty(), 10_000 + WRITE_RETRY_SECS),
            SyncOutcome::Failed
        );
    }

    #[test]
    fn a_forgotten_id_never_replays() {
        let temp = TempLedger::new();
        let mut ledger = temp.open(1_000);
        let oldest = event_at(1_000);
        ledger.admit(&oldest, 1_000);
        assert!(ledger
            .commit([&oldest], std::iter::empty(), 1_000)
            .is_saved());
        for offset in 0..(MAX_HANDLED as u64 - 1) {
            ledger.admit(&event_at(2_000 + offset), 2_000 + offset);
        }
        // One more id pushes the oldest out. It is a late, older event that is
        // still queued, so it would pull the floor below the forgotten id.
        let late = event_at(900);
        ledger.admit(&late, 2_600);
        ledger.sync([&late], 2_600);
        let file = temp.written();
        assert_eq!(
            file.handled.len(),
            MAX_HANDLED - 1,
            "the list is bounded and leaves the queued event out"
        );
        assert!(file
            .handled
            .iter()
            .all(|entry| entry.id != oldest.id.to_hex()));
        assert_eq!(
            file.floor,
            1_000 + SINCE_SKEW_SECS + 1,
            "the next replay starts after the forgotten id"
        );
        assert!(
            !ledger.committed.contains(&oldest.id.to_hex()),
            "a forgotten id also leaves the committed set, so it stays bounded"
        );
    }

    #[test]
    fn an_immediate_restart_keeps_evicted_events_out_of_replay() {
        let temp = TempLedger::new();
        let events: Vec<_> = (0..=MAX_HANDLED).map(|_| event_at(1_000)).collect();
        let mut first = temp.open(1_000);
        for event in &events {
            first.admit(event, 1_000);
        }
        assert!(first.commit(&events, std::iter::empty(), 1_000).is_saved());
        let file = temp.written();
        assert_eq!(file.handled.len(), MAX_HANDLED);
        assert!(file
            .handled
            .iter()
            .all(|entry| entry.id != events[0].id.to_hex()));
        assert_eq!(file.floor, 1_000 + SINCE_SKEW_SECS + 1);
        assert_eq!(file.evicted_floor, file.floor);
        drop(first);

        let restarted = temp.open(1_001);
        let since = restarted.catch_up_since().expect("saved replay floor");
        assert!(
            since.saturating_sub(SINCE_SKEW_SECS) > 1_000,
            "the relay's inclusive since filter must exclude the evicted event"
        );
    }

    #[test]
    fn a_rewound_startup_watermark_cannot_replay_evicted_events() {
        let temp = TempLedger::new();
        let events: Vec<_> = (0..=MAX_HANDLED).map(|_| event_at(1_000)).collect();
        let mut first = temp.open(1_000);
        for event in &events {
            first.admit(event, 1_000);
        }
        assert!(first.commit(&events, std::iter::empty(), 1_000).is_saved());
        assert_eq!(temp.written().floor, 1_000 + SINCE_SKEW_SECS + 1);
        drop(first);

        let restarted = WakeLedger::open(temp.path(), RELAY, &agent(), 3_000, 900);
        let since = restarted.catch_up_since().expect("saved replay floor");
        assert!(
            since.saturating_sub(SINCE_SKEW_SECS) > 1_000,
            "a host replay watermark cannot override the eviction exclusion"
        );
    }

    #[test]
    fn an_older_queued_event_cannot_erase_an_eviction_after_restart() {
        let temp = TempLedger::new();
        let oldest = event_at(1_000);
        let mut first = temp.open(1_000);
        first.admit(&oldest, 1_000);
        assert!(first
            .commit([&oldest], std::iter::empty(), 1_000)
            .is_saved());
        for offset in 0..(MAX_HANDLED as u64 - 1) {
            first.admit(&event_at(2_000 + offset), 2_000 + offset);
        }
        let late = event_at(900);
        first.admit(&late, 2_600);
        assert!(first.sync([&late], 2_600).is_saved());
        let file = temp.written();
        assert_eq!(file.handled.len(), MAX_HANDLED - 1);
        assert_eq!(file.floor, 1_000 + SINCE_SKEW_SECS + 1);
        assert!(file
            .handled
            .iter()
            .all(|entry| entry.id != oldest.id.to_hex()));
        drop(first);

        let mut second = temp.open(3_000);
        let queued = event_at(1_001);
        assert_eq!(second.admit(&queued, 3_000), Admission::CaughtUp);
        assert_eq!(second.handled.len(), MAX_HANDLED, "no new eviction");
        assert!(second.sync([&queued], 3_001).is_saved());
        let file = temp.written();
        assert_eq!(file.handled.len(), MAX_HANDLED - 1);
        assert_eq!(file.floor, 1_000 + SINCE_SKEW_SECS + 1);
        assert_eq!(file.evicted_floor, file.floor);
        drop(second);

        let third = temp.open(4_000);
        let since = third.catch_up_since().expect("saved replay floor");
        assert!(
            since.saturating_sub(SINCE_SKEW_SECS) > oldest.created_at.as_secs(),
            "successive snapshots must preserve exclusion without a new eviction"
        );
    }

    #[test]
    fn a_version_one_file_without_an_eviction_boundary_still_loads() {
        let temp = TempLedger::new();
        let handled = event_at(1_000);
        let legacy = serde_json::json!({
            "version": 1,
            "relayUrl": RELAY,
            "agentPubkey": agent(),
            "floor": 1_006,
            "handled": [{ "id": handled.id.to_hex(), "createdAt": 1_000 }]
        });
        std::fs::create_dir_all(&temp.dir).expect("create ledger dir");
        std::fs::write(
            temp.path(),
            serde_json::to_vec(&legacy).expect("encode legacy file"),
        )
        .expect("write legacy file");
        let file = temp.written();
        assert_eq!(file.version, 1);
        assert_eq!(file.evicted_floor, 0);

        let mut ledger = temp.open(1_001);
        assert_eq!(ledger.catch_up_since(), Some(1_001));
        assert_eq!(ledger.admit(&handled, 1_001), Admission::Duplicate);
        assert!(ledger.sync(std::iter::empty(), 1_001).is_saved());
        assert_eq!(temp.written().floor, 1_001);
    }

    #[test]
    fn credits_out_mid_turn_hands_the_wake_back_for_one_more_run() {
        let temp = TempLedger::new();
        let wake = event_at(10_100);
        let mut first = temp.open(10_000);
        first.admit(&wake, 10_100);
        // The turn starts: the wake is saved as handled.
        assert!(first.commit([&wake], std::iter::empty(), 10_100).is_saved());
        // Credits run out mid-turn: the harness hands the wake back and exits.
        let wake_id = wake.id.to_hex();
        assert!(first
            .forget_events([wake_id.as_str()], std::iter::empty(), 10_200)
            .is_saved());
        let file = temp.written();
        assert!(file.handled.iter().all(|entry| entry.id != wake_id));
        assert!(file.floor <= 10_100, "the floor reaches back to the wake");
        drop(first);

        // The team resumes: the wake runs once more.
        let mut resumed = temp.open(20_000);
        assert_eq!(resumed.admit(&wake, 20_000), Admission::CaughtUp);
        assert!(resumed
            .commit([&wake], std::iter::empty(), 20_001)
            .is_saved());
        drop(resumed);
        let mut later = temp.open(30_000);
        assert_eq!(
            later.admit(&wake, 30_000),
            Admission::Duplicate,
            "and never a third time"
        );
    }

    #[test]
    fn handing_back_ignores_the_write_backoff() {
        let temp = TempLedger::new();
        std::fs::create_dir_all(&temp.dir).expect("create ledger dir");
        let blocker = temp.dir.join("blocker");
        std::fs::write(&blocker, b"").expect("write blocker file");
        let mut ledger =
            WakeLedger::open(blocker.join("wake.json"), RELAY, &agent(), 10_000, 10_000);
        let wake = event_at(10_000);
        ledger.admit(&wake, 10_000);
        assert_eq!(
            ledger.commit([&wake], std::iter::empty(), 10_000),
            SyncOutcome::Failed
        );
        assert!(ledger.write_failed());
        // The folder is writable again inside the backoff, and the process is
        // about to exit: handing back must not wait for the backoff.
        std::fs::remove_file(&blocker).expect("remove blocker file");
        let wake_id = wake.id.to_hex();
        assert_eq!(
            ledger.forget_events([wake_id.as_str()], std::iter::empty(), 10_001),
            SyncOutcome::Written
        );
        assert!(!ledger.write_failed());
        assert!(
            ledger
                .forget_events(["ff".repeat(32).as_str()], std::iter::empty(), 10_002)
                .is_saved(),
            "an id this ledger never handled changes nothing"
        );
    }
}
