//! Bounded, loud startup.
//!
//! A harness that came up, initialised its agent and then went silent used to
//! leave nothing in its log: no stage, no timeout, no exit. The person's first
//! mention was never read (GATE-302, 26 Oct). Two things fix that:
//!
//! * [`bounded`] puts a time limit and a log line on every `.await` of startup
//!   that waits on the relay, so a stuck step fails with a named error.
//! * [`StartupWatch`] tracks the stage startup is in and runs a watchdog on a
//!   plain OS thread. A tokio timeout cannot fire while a worker is blocked
//!   inside a synchronous call (the timed future is never polled again), so the
//!   backstop must not depend on the async runtime. When startup has not
//!   reached readiness by the deadline it logs the stage it is stuck in and
//!   exits, so the desktop sees a dead harness and starts a fresh one.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Longest startup may take from the relay connect to readiness. A healthy
/// start finishes in seconds; three minutes means something is wedged.
pub(crate) const STARTUP_DEADLINE: Duration = Duration::from_secs(180);
/// How often the watchdog looks at the clock.
pub(crate) const WATCHDOG_TICK: Duration = Duration::from_secs(1);
/// How often a start that is still waiting says so.
const WARN_EVERY: Duration = Duration::from_secs(15);
/// Budget for the relay connect (WebSocket and NIP-42 handshake), retries
/// included. It leaves room for the retry ladder on a slow link and stays
/// below [`STARTUP_DEADLINE`], so a healthy runtime fails with a named error
/// before the watchdog has to step in.
pub(crate) const RELAY_CONNECT_BUDGET: Duration = Duration::from_secs(90);
/// Budget for each later startup step that waits on the relay.
pub(crate) const STARTUP_STEP_BUDGET: Duration = Duration::from_secs(30);
/// Exit status of a start the watchdog gave up on (`EX_TEMPFAIL`).
pub(crate) const STARTUP_STALLED_EXIT_CODE: i32 = 75;

/// A startup step that did not finish within its budget.
#[derive(Debug)]
pub(crate) struct StartupTimeout {
    pub(crate) stage: &'static str,
    pub(crate) budget: Duration,
}

impl std::fmt::Display for StartupTimeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "startup step '{}' did not finish within {}s",
            self.stage,
            self.budget.as_secs()
        )
    }
}

impl std::error::Error for StartupTimeout {}

/// Run `work` within `budget`. On timeout, log which step it was and return a
/// [`StartupTimeout`] naming it, so the harness fails loudly instead of
/// waiting forever.
pub(crate) async fn bounded<T>(
    stage: &'static str,
    budget: Duration,
    work: impl Future<Output = T>,
) -> Result<T, StartupTimeout> {
    tokio::time::timeout(budget, work).await.map_err(|_| {
        tracing::error!(
            stage,
            budget_secs = budget.as_secs(),
            "startup step timed out"
        );
        StartupTimeout { stage, budget }
    })
}

/// What the watchdog does when startup stalls: say where, then exit with
/// [`STARTUP_STALLED_EXIT_CODE`] so the desktop starts a fresh harness.
pub(crate) fn exit_on_stall(stage: &'static str, elapsed: Duration) {
    tracing::error!(
        stage,
        elapsed_secs = elapsed.as_secs(),
        "startup stalled; exiting so the desktop can start a fresh harness"
    );
    std::process::exit(STARTUP_STALLED_EXIT_CODE);
}

struct Shared {
    stage: Mutex<&'static str>,
    done: AtomicBool,
}

impl Shared {
    fn current_stage(&self) -> &'static str {
        self.stage.lock().map(|stage| *stage).unwrap_or("unknown")
    }

    fn watch(
        &self,
        started: Instant,
        deadline: Duration,
        tick: Duration,
        on_stall: impl FnOnce(&'static str, Duration),
    ) {
        let mut next_warning = WARN_EVERY;
        loop {
            std::thread::sleep(tick);
            if self.done.load(Ordering::Acquire) {
                return;
            }
            let elapsed = started.elapsed();
            if elapsed >= deadline {
                on_stall(self.current_stage(), elapsed);
                return;
            }
            if elapsed >= next_warning {
                tracing::warn!(
                    stage = self.current_stage(),
                    elapsed_secs = elapsed.as_secs(),
                    "startup is taking longer than expected"
                );
                next_warning += WARN_EVERY;
            }
        }
    }
}

/// Tracks the startup stage and runs the stall watchdog until [`finish`].
///
/// [`finish`]: StartupWatch::finish
pub(crate) struct StartupWatch {
    shared: Arc<Shared>,
}

impl StartupWatch {
    /// Start watching in `first_stage`. `on_stall` runs once, on the watchdog
    /// thread, if [`finish`](StartupWatch::finish) has not been called after
    /// `deadline`; it gets the stage startup is stuck in. `tick` is how often
    /// the watchdog wakes.
    pub(crate) fn begin(
        first_stage: &'static str,
        deadline: Duration,
        tick: Duration,
        on_stall: impl FnOnce(&'static str, Duration) + Send + 'static,
    ) -> Self {
        let shared = Arc::new(Shared {
            stage: Mutex::new(first_stage),
            done: AtomicBool::new(false),
        });
        tracing::info!(stage = first_stage, "startup stage");
        let watcher = Arc::clone(&shared);
        let started = Instant::now();
        let spawned = std::thread::Builder::new()
            .name("startup-watchdog".into())
            .spawn(move || watcher.watch(started, deadline, tick, on_stall));
        if let Err(error) = spawned {
            tracing::warn!("startup watchdog could not start: {error}");
        }
        Self { shared }
    }

    /// Record that startup moved on to `stage`.
    pub(crate) fn enter(&self, stage: &'static str) {
        if let Ok(mut current) = self.shared.stage.lock() {
            *current = stage;
        }
        tracing::info!(stage, "startup stage");
    }

    /// Startup reached readiness: stand the watchdog down.
    pub(crate) fn finish(&self) {
        self.shared.done.store(true, Ordering::Release);
        tracing::info!("startup finished");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Collects what the watchdog reports from its own thread.
    #[derive(Clone, Default)]
    struct Stalls(Arc<Mutex<Vec<(&'static str, Duration)>>>);

    impl Stalls {
        fn recorder(&self) -> impl FnOnce(&'static str, Duration) + Send + 'static {
            let seen = Arc::clone(&self.0);
            move |stage, elapsed| {
                if let Ok(mut seen) = seen.lock() {
                    seen.push((stage, elapsed));
                }
            }
        }

        fn seen(&self) -> Vec<(&'static str, Duration)> {
            self.0.lock().map(|seen| seen.clone()).unwrap_or_default()
        }
    }

    #[test]
    fn a_stalled_start_reports_the_stage_it_is_stuck_in() {
        let stalls = Stalls::default();
        let watch = StartupWatch::begin(
            "relay_connect",
            Duration::from_millis(60),
            Duration::from_millis(5),
            stalls.recorder(),
        );
        watch.enter("channel_discovery");
        std::thread::sleep(Duration::from_millis(300));

        let seen = stalls.seen();
        assert_eq!(seen.len(), 1, "the watchdog reports exactly once");
        assert_eq!(seen[0].0, "channel_discovery");
        assert!(seen[0].1 >= Duration::from_millis(60));
    }

    #[test]
    fn a_start_that_finishes_in_time_is_left_alone() {
        let stalls = Stalls::default();
        let watch = StartupWatch::begin(
            "relay_connect",
            Duration::from_millis(100),
            Duration::from_millis(5),
            stalls.recorder(),
        );
        watch.finish();
        std::thread::sleep(Duration::from_millis(300));

        assert!(stalls.seen().is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn the_watchdog_still_fires_while_the_async_runtime_is_blocked() {
        // A synchronous call that never returns blocks the only worker: a
        // tokio timeout around the same work could not fire, because the timed
        // future is never polled again. The watchdog runs on its own thread.
        let fired = Arc::new(AtomicUsize::new(0));
        let flag = Arc::clone(&fired);
        let _watch = StartupWatch::begin(
            "relay_connect",
            Duration::from_millis(50),
            Duration::from_millis(5),
            move |_, _| {
                flag.fetch_add(1, Ordering::SeqCst);
            },
        );

        // Block the runtime thread well past the deadline.
        std::thread::sleep(Duration::from_millis(300));

        assert_eq!(
            fired.load(Ordering::SeqCst),
            1,
            "the watchdog fired while the runtime was blocked"
        );
    }

    #[tokio::test]
    async fn a_stuck_step_times_out_and_is_named() {
        let result = bounded(
            "channel_discovery",
            Duration::from_millis(50),
            std::future::pending::<()>(),
        )
        .await;

        let timeout = result.expect_err("a pending step must time out");
        assert_eq!(timeout.stage, "channel_discovery");
        assert_eq!(
            timeout.to_string(),
            "startup step 'channel_discovery' did not finish within 0s"
        );
    }

    #[tokio::test]
    async fn a_step_that_finishes_in_time_keeps_its_value() {
        let result = bounded("relay_connect", Duration::from_secs(5), async { 7 }).await;
        assert_eq!(result.expect("the step finished"), 7);
    }

    /// A log sink the test can read back.
    #[derive(Clone, Default)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if let Ok(mut buffer) = self.0.lock() {
                buffer.extend_from_slice(bytes);
            }
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl LogBuffer {
        fn text(&self) -> String {
            self.0
                .lock()
                .map(|buffer| String::from_utf8_lossy(&buffer).into_owned())
                .unwrap_or_default()
        }
    }

    #[test]
    fn a_timed_out_step_logs_which_step_it_was() {
        let logs = LogBuffer::default();
        let sink = logs.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || sink.clone())
            .with_ansi(false)
            .finish();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("build test runtime");

        tracing::subscriber::with_default(subscriber, || {
            runtime.block_on(async {
                let _ = bounded(
                    "relay_connect",
                    Duration::from_millis(20),
                    std::future::pending::<()>(),
                )
                .await;
            });
        });

        let text = logs.text();
        assert!(text.contains("startup step timed out"), "{text}");
        assert!(text.contains("relay_connect"), "{text}");
    }
}
