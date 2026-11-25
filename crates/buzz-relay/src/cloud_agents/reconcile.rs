//! Reconcile: keeps the registry and the host telling the same story.
//!
//! Every 60 seconds, against the host's own list of machines:
//! - a machine the registry does not know is an orphan and is destroyed (after
//!   it has been seen unknown twice in a row, so a machine that was just created
//!   and is not recorded yet is never destroyed);
//! - a registry machine the host no longer has is forgotten, so the next wake
//!   creates a new one;
//! - a started machine whose agent is on the Mac, or with no presence for 15
//!   minutes, or while the feature is off (the kill switch), is stopped;
//! - the agent's status follows the machine: working while present, asleep once
//!   stopped.
//!
//! One `info` line per UTC day says how many machines were created, how many
//! hours they were awake, how many wakes there were and how many operations
//! failed.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use buzz_core::agent_placement::{Home, PlacementStatus};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::cloud_agents::MachineRow;
use chrono::Utc;
use tokio::task::JoinHandle;

use super::config::CloudMode;
use super::host::{CloudHost, MachineRef, MachineState};
use super::presence::{PresenceSource, PubsubPresence};
use crate::state::AppState;

/// Seconds between passes.
pub const RECONCILE_SECS: u64 = 60;
/// A started machine with no presence for this long is stopped.
pub const IDLE_STOP: Duration = Duration::from_secs(15 * 60);
/// A `waking` machine that is stopped and has not changed for this long went
/// back to sleep without ever connecting.
pub const WAKING_STALE_SECS: i64 = 300;

/// What one pass did, for tests and logs.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Summary {
    /// Orphan machines destroyed.
    pub destroyed: usize,
    /// Machines stopped.
    pub stopped: usize,
    /// Registry machines the host no longer had.
    pub forgotten: usize,
    /// Agents whose status changed.
    pub status_changes: usize,
}

/// State kept between passes.
pub struct Reconciler {
    idle_stop: Duration,
    /// Host machines seen without a registry row on the previous pass.
    suspects: HashSet<String>,
    /// When each started machine's agent was last seen online (or first seen
    /// started, as the baseline).
    last_present: HashMap<(CommunityId, Vec<u8>), Instant>,
    /// Awake machine time since the last daily report, in seconds.
    awake_secs: f64,
    last_pass: Option<Instant>,
    last_report_day: Option<chrono::NaiveDate>,
}

impl Default for Reconciler {
    fn default() -> Self {
        Self::new(IDLE_STOP)
    }
}

impl Reconciler {
    /// A reconciler that stops a machine idle for `idle_stop`.
    pub fn new(idle_stop: Duration) -> Self {
        Self {
            idle_stop,
            suspects: HashSet::new(),
            last_present: HashMap::new(),
            awake_secs: 0.0,
            last_pass: None,
            last_report_day: None,
        }
    }

    /// One reconcile pass at `now`.
    pub async fn run(
        &mut self,
        state: &Arc<AppState>,
        host: &dyn CloudHost,
        presence: &dyn PresenceSource,
        now: Instant,
    ) -> Result<Summary, String> {
        let mut summary = Summary::default();
        let machines = host
            .list()
            .await
            .map_err(|error| format!("could not list machines: {error}"))?;
        let rows = state
            .db
            .list_cloud_machine_rows()
            .await
            .map_err(|error| format!("could not read the registry: {error}"))?;

        self.sweep_orphans(host, &machines, &rows, &mut summary)
            .await;

        let on_host: HashSet<&str> = machines.iter().map(|m| m.machine_id.as_str()).collect();
        let kill_switch = state.config.cloud_agents.mode == CloudMode::Off;
        let elapsed = self.last_pass.map_or(0.0, |previous| {
            now.saturating_duration_since(previous).as_secs_f64()
        });
        self.last_pass = Some(now);
        let mut awake = 0usize;
        for row in &rows {
            if !on_host.contains(row.machine_id.as_str()) {
                self.forget(state, row, &mut summary).await;
                continue;
            }
            let machine = MachineRef {
                machine_id: row.machine_id.clone(),
                volume_id: row.volume_id.clone(),
            };
            let machine_state = match host.state(&machine).await {
                Ok(machine_state) => machine_state,
                Err(error) => {
                    tracing::warn!(%error, "cloud machine state unreadable; left as is this pass");
                    continue;
                }
            };
            match machine_state {
                MachineState::Started => {
                    awake += 1;
                    self.started(
                        state,
                        host,
                        presence,
                        row,
                        &machine,
                        kill_switch,
                        now,
                        &mut summary,
                    )
                    .await;
                }
                MachineState::Stopped | MachineState::Suspended => {
                    self.last_present
                        .remove(&(row.community, row.agent_pubkey.clone()));
                    self.stopped(state, row, &mut summary).await;
                }
                MachineState::Destroyed => self.forget(state, row, &mut summary).await,
                MachineState::Unknown => {}
            }
        }
        self.awake_secs += awake as f64 * elapsed;
        self.report_daily(state).await;
        Ok(summary)
    }

    async fn sweep_orphans(
        &mut self,
        host: &dyn CloudHost,
        machines: &[MachineRef],
        rows: &[MachineRow],
        summary: &mut Summary,
    ) {
        let known: HashSet<&str> = rows.iter().map(|row| row.machine_id.as_str()).collect();
        let orphans: HashSet<String> = machines
            .iter()
            .filter(|machine| !known.contains(machine.machine_id.as_str()))
            .map(|machine| machine.machine_id.clone())
            .collect();
        let mut destroyed: HashSet<String> = HashSet::new();
        for machine in machines {
            if !orphans.contains(&machine.machine_id) {
                continue;
            }
            if !self.suspects.contains(&machine.machine_id) {
                continue; // first sighting: give a just-created machine time to be recorded
            }
            match host.destroy(machine).await {
                Ok(()) => {
                    tracing::warn!(machine = %machine.machine_id, "destroyed an orphan cloud machine");
                    summary.destroyed += 1;
                    destroyed.insert(machine.machine_id.clone());
                }
                Err(error) => {
                    tracing::error!(%error, "orphan cloud machine could not be destroyed; will retry")
                }
            }
        }
        // First sightings and failed destroys are watched again next pass.
        self.suspects = orphans.difference(&destroyed).cloned().collect();
    }

    async fn forget(&mut self, state: &Arc<AppState>, row: &MachineRow, summary: &mut Summary) {
        match state
            .db
            .clear_cloud_machine(row.community, &row.agent_pubkey, &row.machine_id)
            .await
        {
            Ok(true) => {
                tracing::warn!(
                    "a cloud machine is gone from the host; the next wake creates a new one"
                );
                summary.forgotten += 1;
                self.set_status(state, row, PlacementStatus::Asleep, summary)
                    .await;
            }
            Ok(false) => {}
            Err(error) => tracing::error!(%error, "could not forget a missing cloud machine"),
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn started(
        &mut self,
        state: &Arc<AppState>,
        host: &dyn CloudHost,
        presence: &dyn PresenceSource,
        row: &MachineRow,
        machine: &MachineRef,
        kill_switch: bool,
        now: Instant,
        summary: &mut Summary,
    ) {
        let key = (row.community, row.agent_pubkey.clone());
        let stop_reason = if kill_switch {
            Some("the cloud agents switch is off")
        } else if row.home == Home::Mac {
            Some("the agent works on the Mac")
        } else {
            None
        };
        let mut online = false;
        if stop_reason.is_none() {
            match self.online(state, presence, row).await {
                Ok(value) => online = value,
                // Unknown presence is never a reason to stop a machine.
                Err(error) => {
                    tracing::warn!(%error, "presence unknown; machine left running this pass");
                    return;
                }
            }
        }
        if online {
            self.last_present.insert(key.clone(), now);
        }
        let baseline = *self.last_present.entry(key.clone()).or_insert(now);
        let idle = !online && now.saturating_duration_since(baseline) >= self.idle_stop;
        let reason = stop_reason.or(idle.then_some("no presence for too long"));
        if let Some(reason) = reason {
            match host.stop(machine).await {
                Ok(()) => {
                    tracing::info!(reason, "stopped a cloud machine");
                    summary.stopped += 1;
                    self.last_present.remove(&key);
                    if row.home == Home::Cloud {
                        self.set_status(state, row, PlacementStatus::Asleep, summary)
                            .await;
                    }
                }
                Err(error) => {
                    tracing::error!(%error, "cloud machine could not be stopped; will retry")
                }
            }
            return;
        }
        if online && row.home == Home::Cloud && row.status != Some(PlacementStatus::Working) {
            self.set_status(state, row, PlacementStatus::Working, summary)
                .await;
        }
    }

    async fn stopped(&mut self, state: &Arc<AppState>, row: &MachineRow, summary: &mut Summary) {
        if row.home != Home::Cloud {
            return;
        }
        let stale_waking = row.status == Some(PlacementStatus::Waking)
            && (Utc::now() - row.updated_at).num_seconds() >= WAKING_STALE_SECS;
        if row.status == Some(PlacementStatus::Working) || stale_waking {
            self.set_status(state, row, PlacementStatus::Asleep, summary)
                .await;
        }
    }

    async fn online(
        &self,
        state: &Arc<AppState>,
        presence: &dyn PresenceSource,
        row: &MachineRow,
    ) -> Result<bool, String> {
        let host = state
            .db
            .lookup_community_host(row.community)
            .await
            .map_err(|error| format!("community lookup failed: {error}"))?
            .ok_or_else(|| "community no longer exists".to_owned())?;
        let tenant = TenantContext::resolved(row.community, host);
        presence.is_online(&tenant, &row.agent_pubkey).await
    }

    async fn set_status(
        &mut self,
        state: &Arc<AppState>,
        row: &MachineRow,
        status: PlacementStatus,
        summary: &mut Summary,
    ) {
        match state
            .db
            .set_cloud_status(
                row.community,
                &row.agent_pubkey,
                row.generation,
                status,
                None,
            )
            .await
        {
            Ok(true) => {
                summary.status_changes += 1;
                super::refresh_head_for(state, row.community, &row.agent_pubkey).await;
            }
            Ok(false) => {}
            Err(error) => tracing::error!(%error, "agent status not updated"),
        }
    }

    /// One `info` line per UTC day.
    async fn report_daily(&mut self, state: &Arc<AppState>) {
        let today = Utc::now().date_naive();
        if self.last_report_day == Some(today) {
            return;
        }
        let first = self.last_report_day.is_none();
        self.last_report_day = Some(today);
        if first {
            return; // the first pass after a start has nothing to report yet
        }
        match state.db.cloud_op_counts_since(24).await {
            Ok((created, wakes, failures)) => {
                tracing::info!(
                    machines_created = created,
                    awake_hours = self.awake_secs / 3600.0,
                    wakes,
                    failures,
                    "cloud agents daily report"
                );
                self.awake_secs = 0.0;
            }
            Err(error) => tracing::warn!(%error, "cloud agents daily report not written"),
        }
    }
}

/// Starts the reconciler. Idle without a host.
pub fn spawn_reconciler(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        tracing::info!("cloud agent reconciler started");
        let presence = PubsubPresence::new(Arc::clone(&state.pubsub));
        let mut reconciler = Reconciler::default();
        let mut interval = tokio::time::interval(Duration::from_secs(RECONCILE_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Some(host) = state.cloud_host.clone() else {
                continue;
            };
            if let Err(error) = reconciler
                .run(&state, host.as_ref(), &presence, Instant::now())
                .await
            {
                tracing::error!(%error, "cloud agent reconcile pass failed");
            }
        }
    })
}

#[cfg(test)]
mod postgres_tests {
    use buzz_core::agent_placement::Home;

    use super::*;
    use crate::cloud_agents::fake_host::FakeCall;
    use crate::cloud_agents::presence::FakePresence;
    use crate::cloud_agents::test_support::{fixture, fixture_in, Fixture};

    /// Ensures a machine for the agent and starts it on the fake host.
    async fn running_cloud_agent() -> Fixture {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.pass().await; // ensure
        let machine = MachineRef {
            machine_id: f.row().await.fly_machine_id.expect("machine"),
            volume_id: f.row().await.fly_volume_id.expect("volume"),
        };
        f.host
            .start(
                &machine,
                &crate::cloud_agents::host::BootEnvelope {
                    boot_url: "https://x".into(),
                    boot_token: zeroize::Zeroizing::new("t".into()),
                },
            )
            .await
            .expect("start");
        f
    }

    async fn pass(f: &Fixture, reconciler: &mut Reconciler, presence: &FakePresence) -> Summary {
        // Other tests share the host-less database but not this fake host, so a
        // pass only ever sees this fixture's machines.
        reconciler
            .run(&f.state, &f.host, presence, Instant::now())
            .await
            .expect("reconcile pass")
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn orphan_machine_destroyed() {
        let f = fixture().await;
        let orphan = f.host.add_machine(MachineState::Started);
        let presence = FakePresence::default();
        let mut reconciler = Reconciler::default();
        let first = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(
            first.destroyed, 0,
            "a first sighting may be a machine being created"
        );
        assert_eq!(
            f.host.machine_state(&orphan.machine_id),
            MachineState::Started
        );
        let second = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(second.destroyed, 1);
        assert_eq!(
            f.host.machine_state(&orphan.machine_id),
            MachineState::Destroyed
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_machine_recorded_between_passes_is_never_destroyed() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        let machine = f
            .host
            .ensure(&crate::cloud_agents::host::MachineSpec {
                agent_pubkey: hex::encode(&f.agent),
                image: "img".into(),
                memory_mb: 1024,
                volume_gb: 1,
                region: "iad".into(),
            })
            .await
            .expect("ensure");
        let presence = FakePresence::default();
        let mut reconciler = Reconciler::default();
        pass(&f, &mut reconciler, &presence).await; // sees it unrecorded
        f.state
            .db
            .set_cloud_machine(
                f.community,
                &f.agent,
                &machine.machine_id,
                &machine.volume_id,
            )
            .await
            .expect("record");
        let second = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(second.destroyed, 0);
        assert_ne!(
            f.host.machine_state(&machine.machine_id),
            MachineState::Destroyed
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flag_off_stops_all_machines() {
        let f = fixture_in(CloudMode::Off).await;
        // Seed a started cloud machine directly: the broker would refuse the flip.
        f.flip(0, Home::Cloud).await;
        f.pass().await;
        let row = f.row().await;
        let machine = MachineRef {
            machine_id: row.fly_machine_id.clone().expect("machine"),
            volume_id: row.fly_volume_id.clone().expect("volume"),
        };
        f.host
            .start(
                &machine,
                &crate::cloud_agents::host::BootEnvelope {
                    boot_url: "https://x".into(),
                    boot_token: zeroize::Zeroizing::new("t".into()),
                },
            )
            .await
            .expect("start");
        let presence = FakePresence::default();
        presence.set(&f.agent, true); // even a working agent is stopped by the kill switch
        let mut reconciler = Reconciler::default();
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(summary.stopped, 1);
        assert!(
            matches!(f.host.calls().last(), Some(FakeCall::Stop(m)) if *m == machine.machine_id)
        );
        assert_eq!(
            f.host.machine_state(&machine.machine_id),
            MachineState::Stopped
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn mac_placed_running_machine_stopped() {
        let f = running_cloud_agent().await;
        f.flip(1, Home::Mac).await;
        let presence = FakePresence::default();
        presence.set(&f.agent, true);
        let mut reconciler = Reconciler::default();
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(summary.stopped, 1);
        let id = f.row().await.fly_machine_id.expect("machine");
        assert_eq!(f.host.machine_state(&id), MachineState::Stopped);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn an_idle_machine_is_stopped_and_a_present_one_is_not() {
        let f = running_cloud_agent().await;
        let id = f.row().await.fly_machine_id.expect("machine");
        let presence = FakePresence::default();
        presence.set(&f.agent, true);
        let mut reconciler = Reconciler::new(Duration::ZERO);
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(
            summary.stopped, 0,
            "an agent with presence keeps its machine"
        );
        assert_eq!(f.row().await.status, Some(PlacementStatus::Working));

        presence.set(&f.agent, false);
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(summary.stopped, 1);
        assert_eq!(f.host.machine_state(&id), MachineState::Stopped);
        assert_eq!(f.row().await.status, Some(PlacementStatus::Asleep));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn status_becomes_asleep_after_stop() {
        let f = running_cloud_agent().await;
        f.force_status(PlacementStatus::Working).await;
        let id = f.row().await.fly_machine_id.expect("machine");
        // Someone else stopped the machine (the harness exited after idling).
        f.host
            .stop(&MachineRef {
                machine_id: id.clone(),
                volume_id: f.row().await.fly_volume_id.expect("volume"),
            })
            .await
            .expect("stop");
        let presence = FakePresence::default();
        let mut reconciler = Reconciler::default();
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(summary.status_changes, 1);
        assert_eq!(f.row().await.status, Some(PlacementStatus::Asleep));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_machine_missing_from_the_host_is_forgotten() {
        let f = running_cloud_agent().await;
        let id = f.row().await.fly_machine_id.expect("machine");
        f.host
            .destroy(&MachineRef {
                machine_id: id,
                volume_id: f.row().await.fly_volume_id.expect("volume"),
            })
            .await
            .expect("destroy");
        let presence = FakePresence::default();
        let mut reconciler = Reconciler::default();
        let summary = pass(&f, &mut reconciler, &presence).await;
        assert_eq!(summary.forgotten, 1);
        assert!(f.row().await.fly_machine_id.is_none());
    }

    /// An agent that is removed loses its machine first and its sealed key
    /// only once the host confirmed.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn agent_delete_destroys_machine_and_key() {
        let f = running_cloud_agent().await;
        let id = f.row().await.fly_machine_id.expect("machine");
        assert!(f
            .state
            .db
            .begin_cloud_teardown(&f.owner, f.community, &f.agent)
            .await
            .expect("teardown"));
        let row = f.row().await;
        assert_eq!(
            row.home,
            Home::Mac,
            "the fence stops the machine answering at once"
        );
        assert_eq!(row.generation, 2);
        f.pass().await; // stale ensure/none skipped; destroy runs
        f.make_due().await;
        f.pass().await;
        assert_eq!(f.host.machine_state(&id), MachineState::Destroyed);
        assert!(
            !f.row_exists().await,
            "the sealed key goes with the machine"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn account_delete_tears_down_its_agents() {
        let f = running_cloud_agent().await;
        let id = f.row().await.fly_machine_id.expect("machine");
        let owner_hex = hex::encode(&f.owner);
        sqlx::query(
            "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, \
             sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(format!("{}@example.invalid", uuid::Uuid::new_v4().simple()))
        .bind(&owner_hex)
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&f.pool)
        .await
        .expect("insert account");
        assert!(f
            .state
            .db
            .delete_account(&owner_hex)
            .await
            .expect("delete account"));
        assert_eq!(f.row().await.home, Home::Mac);
        f.pass().await;
        f.make_due().await;
        f.pass().await;
        assert_eq!(f.host.machine_state(&id), MachineState::Destroyed);
        assert!(!f.row_exists().await);
    }
}
