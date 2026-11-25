//! The durable journal worker: runs the Fly operations placement queues.
//!
//! Every placement change writes its follow-up operation (`ensure`, `start`,
//! `stop`, `destroy`) in the same transaction as the change, so a crash can not
//! lose it. This worker claims due operations (a short lease, so a crashed
//! worker's operation is picked up again within a minute), runs them against the
//! [`CloudHost`], and either finishes them, reschedules them with backoff, or
//! gives up and says so in the agent's status.
//!
//! Two rules keep a slow host from reviving an old decision:
//! - An operation written for an older placement generation than the agent's
//!   current one is marked done without running. A cloud machine started for
//!   generation N can never come back after a flip to the Mac.
//! - Every result that writes agent state is guarded by the generation, so a
//!   late success or failure never writes over the new placement.

use std::sync::Arc;
use std::time::Duration;

use buzz_core::agent_placement::PlacementStatus;
use buzz_core::tenant::CommunityId;
use buzz_db::cloud_agents::{CloudAgentRow, CloudOp, OpRow};
use tokio::task::JoinHandle;

use super::host::{BootEnvelope, CloudHost, HostError, MachineRef, MachineSpec};
use crate::state::AppState;

/// Seconds between journal passes.
pub const POLL_SECS: u64 = 5;
/// Most operations one pass claims.
pub const CLAIM_BATCH: i64 = 8;
/// Attempts before an `ensure` or `start` is given up on.
pub const MAX_ATTEMPTS: i32 = 3;
/// Attempts before a `stop` or `destroy` is given up on. These two protect the
/// bill, so they keep trying longer.
pub const MAX_ATTEMPTS_TEARDOWN: i32 = 8;

/// Seconds to wait before the next try after `attempt` tries have failed.
pub const fn backoff_secs(attempt: i32) -> i64 {
    match attempt {
        ..=1 => 10,
        2 => 30,
        _ => 120,
    }
}

/// Attempts allowed for an operation.
pub const fn max_attempts(op: CloudOp) -> i32 {
    match op {
        CloudOp::Ensure | CloudOp::Start => MAX_ATTEMPTS,
        CloudOp::Stop | CloudOp::Destroy => MAX_ATTEMPTS_TEARDOWN,
    }
}

/// Why one operation did not finish.
#[derive(Debug)]
enum OpError {
    /// Worth another try after backoff.
    Retry(String),
    /// Trying again will not help.
    Give(String),
}

impl From<HostError> for OpError {
    fn from(error: HostError) -> Self {
        match error {
            HostError::Transient(text) => Self::Retry(text),
            HostError::Permanent(text) => Self::Give(text),
        }
    }
}

fn db_error(error: impl std::fmt::Display) -> OpError {
    OpError::Retry(format!("database: {error}"))
}

/// Starts the worker. Without a configured host the journal stays idle and its
/// operations wait; configuring Fly picks them up.
pub fn spawn_ops_worker(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        tracing::info!("cloud agent op journal worker started");
        let mut interval = tokio::time::interval(Duration::from_secs(POLL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Some(host) = state.cloud_host.clone() else {
                continue;
            };
            if let Err(error) = process_due(&state, host.as_ref()).await {
                tracing::error!(%error, "cloud agent op journal pass failed");
            }
        }
    })
}

/// Claims and runs the operations that are due. Returns how many were claimed.
pub async fn process_due(state: &Arc<AppState>, host: &dyn CloudHost) -> Result<usize, String> {
    process_due_for(state, host, None).await
}

/// [`process_due`] narrowed to one community, so tests that share a database
/// never run each other's operations.
pub async fn process_due_for(
    state: &Arc<AppState>,
    host: &dyn CloudHost,
    community: Option<CommunityId>,
) -> Result<usize, String> {
    let ops = state
        .db
        .claim_due_cloud_ops_for(community, CLAIM_BATCH)
        .await
        .map_err(|error| format!("could not claim operations: {error}"))?;
    let claimed = ops.len();
    for op in ops {
        settle(state, host, &op).await;
    }
    Ok(claimed)
}

/// Runs one claimed operation and records what happened. Never loses an
/// operation: whichever way it ends, the journal row says how.
async fn settle(state: &Arc<AppState>, host: &dyn CloudHost, op: &OpRow) {
    let outcome = run_op(state, host, op).await;
    let db = &state.db;
    let recorded = match outcome {
        Ok(()) => db.finish_cloud_op(op.community, op.id).await,
        Err(OpError::Retry(error)) if op.attempt < max_attempts(op.op) => {
            tracing::warn!(op = op.op.as_str(), attempt = op.attempt, %error, "cloud agent operation will be retried");
            db.reschedule_cloud_op(op.community, op.id, backoff_secs(op.attempt), &error)
                .await
        }
        Err(OpError::Retry(error) | OpError::Give(error)) => {
            tracing::error!(op = op.op.as_str(), attempt = op.attempt, %error, "cloud agent operation failed for good");
            note_failure(state, op, &error).await;
            db.fail_cloud_op(op.community, op.id, &error).await
        }
    };
    if let Err(error) = recorded {
        // The lease expires and the operation runs again: nothing is lost, and
        // every operation is safe to repeat.
        tracing::error!(%error, "cloud agent operation result not recorded; it will run again");
    }
}

/// Puts a final failure into the agent's status so the interface can say it.
async fn note_failure(state: &Arc<AppState>, op: &OpRow, error: &str) {
    if !matches!(op.op, CloudOp::Ensure | CloudOp::Start) {
        return;
    }
    if let Err(db_error) = state
        .db
        .fail_pending_cloud_ops(
            op.community,
            &op.agent_pubkey,
            op.generation,
            "an earlier step failed",
        )
        .await
    {
        tracing::error!(error = %db_error, "later steps of a failed wake not cancelled");
    }
    match state
        .db
        .set_cloud_status(
            op.community,
            &op.agent_pubkey,
            op.generation,
            PlacementStatus::Failed,
            Some(error),
        )
        .await
    {
        Ok(true) => {
            super::refresh_head_for(state, op.community, &op.agent_pubkey).await;
        }
        Ok(false) => {}
        Err(error) => tracing::error!(%error, "agent failure status not stored"),
    }
}

fn machine_of(row: &CloudAgentRow) -> Option<MachineRef> {
    Some(MachineRef {
        machine_id: row.fly_machine_id.clone()?,
        volume_id: row.fly_volume_id.clone()?,
    })
}

async fn run_op(state: &Arc<AppState>, host: &dyn CloudHost, op: &OpRow) -> Result<(), OpError> {
    let Some(row) = state
        .db
        .get_cloud_agent(op.community, &op.agent_pubkey)
        .await
        .map_err(db_error)?
    else {
        // The agent is gone. A destroy that finds no row has nothing left to do.
        return Ok(());
    };
    // Fence by generation: an operation written for an older placement is moot.
    // RED PROOF: the generation fence is disabled.
    let fenced = false;
    if fenced && op.op != CloudOp::Destroy && op.generation < row.generation {
        tracing::info!(
            op = op.op.as_str(),
            op_generation = op.generation,
            current = row.generation,
            "skipping a stale cloud agent operation"
        );
        return Ok(());
    }
    // The generation fence above is the one guard that decides whether an
    // operation still applies: an operation is written in the same transaction as
    // the placement change that made it, so one at the current generation always
    // matches the current home.
    match op.op {
        CloudOp::Ensure => ensure_machine(state, host, &row).await.map(|_| ()),
        CloudOp::Start => start_machine(state, host, &row, op).await,
        CloudOp::Stop => match machine_of(&row) {
            Some(machine) => host.stop(&machine).await.map_err(OpError::from),
            None => Ok(()),
        },
        CloudOp::Destroy => {
            if let Some(machine) = machine_of(&row) {
                host.destroy(&machine).await?;
            }
            // Only after the host confirmed: the sealed key and the journal
            // go together with the machine.
            state
                .db
                .delete_cloud_agent(op.community, &op.agent_pubkey)
                .await
                .map_err(db_error)?;
            Ok(())
        }
    }
}

/// The machine for this agent, created if it does not exist yet.
async fn ensure_machine(
    state: &Arc<AppState>,
    host: &dyn CloudHost,
    row: &CloudAgentRow,
) -> Result<MachineRef, OpError> {
    if let Some(machine) = machine_of(row) {
        return Ok(machine);
    }
    let fly = state
        .config
        .cloud_agents
        .fly
        .as_ref()
        .ok_or_else(|| OpError::Give("cloud machines are not configured".into()))?;
    let created = host
        .ensure(&MachineSpec {
            agent_pubkey: hex::encode(&row.agent_pubkey),
            image: fly.image.clone(),
            memory_mb: fly.memory_mb,
            volume_gb: fly.volume_gb,
            region: fly.region.clone(),
        })
        .await?;
    let stored = state
        .db
        .set_cloud_machine(
            row.community,
            &row.agent_pubkey,
            &created.machine_id,
            &created.volume_id,
        )
        .await;
    match stored {
        Ok(true) => Ok(created),
        Ok(false) => {
            // The agent was deleted while the machine was being created.
            destroy_unrecorded(host, &created).await;
            Ok(created)
        }
        Err(error) => {
            // Not recorded means not tracked: remove it now rather than leave
            // it to the orphan sweep, then try the whole step again.
            destroy_unrecorded(host, &created).await;
            Err(db_error(error))
        }
    }
}

async fn destroy_unrecorded(host: &dyn CloudHost, machine: &MachineRef) {
    if let Err(error) = host.destroy(machine).await {
        tracing::warn!(%error, "machine created but not recorded could not be removed; reconcile will");
    }
}

async fn start_machine(
    state: &Arc<AppState>,
    host: &dyn CloudHost,
    row: &CloudAgentRow,
    op: &OpRow,
) -> Result<(), OpError> {
    let machine = ensure_machine(state, host, row).await?;
    let token =
        match super::boot::issue(state, row.community, &row.agent_pubkey, op.generation).await {
            Ok(token) => token,
            // Not in the cloud at this generation any more: nothing to start.
            Err(super::boot::BootError::Unauthorized) => return Ok(()),
            Err(super::boot::BootError::Unavailable(reason)) => return Err(OpError::Retry(reason)),
        };
    let boot_url = boot_url(state, row.community).await?;
    host.start(
        &machine,
        &BootEnvelope {
            boot_url,
            boot_token: token,
        },
    )
    .await?;
    Ok(())
}

async fn boot_url(state: &Arc<AppState>, community: CommunityId) -> Result<String, OpError> {
    let host = state
        .db
        .lookup_community_host(community)
        .await
        .map_err(db_error)?
        .ok_or_else(|| OpError::Give("community no longer exists".into()))?;
    let tenant = buzz_core::tenant::TenantContext::resolved(community, host);
    Ok(crate::api::bridge::nip98_expected_url(
        &state.config.relay_url,
        &tenant,
        "/api/cloud-agents/boot",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_teardown_keeps_trying_longer() {
        assert_eq!([1, 2, 3, 4, 9].map(backoff_secs), [10, 30, 120, 120, 120]);
        assert_eq!(max_attempts(CloudOp::Start), 3);
        assert_eq!(max_attempts(CloudOp::Ensure), 3);
        assert!(max_attempts(CloudOp::Destroy) > max_attempts(CloudOp::Start));
        assert!(max_attempts(CloudOp::Stop) > max_attempts(CloudOp::Start));
    }
}

#[cfg(test)]
mod postgres_tests {
    use buzz_core::agent_placement::Home;

    use super::*;
    use crate::cloud_agents::fake_host::FakeCall;
    use crate::cloud_agents::test_support::fixture;

    /// [red-proof] An operation written for an old placement generation must
    /// not run: a machine ensured for generation 1 has no business appearing
    /// after the agent was moved back to the Mac at generation 2.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stale_generation_op_is_skipped() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await; // writes `ensure` for generation 1
        f.flip(1, Home::Mac).await; // writes `stop` for generation 2
        f.pass().await;
        assert!(
            !f.host
                .calls()
                .iter()
                .any(|c| matches!(c, FakeCall::Ensure(_))),
            "the stale ensure must not reach the host: {:?}",
            f.host.calls()
        );
        let journal = f.journal().await;
        assert_eq!(journal[0], ("ensure".into(), 1, "done".into(), 1));
        assert!(f.row().await.fly_machine_id.is_none());
    }

    /// A stop written for an old generation must not stop the machine of the
    /// new one: the agent went Mac, then back to the cloud, and its machine is
    /// running for the new generation.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stale_stop_does_not_stop_the_new_generations_machine() {
        use crate::cloud_agents::host::{BootEnvelope, CloudHost, MachineRef, MachineState};
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.pass().await; // ensure for generation 1
        let row = f.row().await;
        let machine = MachineRef {
            machine_id: row.fly_machine_id.clone().expect("machine"),
            volume_id: row.fly_volume_id.clone().expect("volume"),
        };
        f.host
            .start(
                &machine,
                &BootEnvelope {
                    boot_url: "https://x".into(),
                    boot_token: zeroize::Zeroizing::new("t".into()),
                },
            )
            .await
            .expect("start");
        f.flip(1, Home::Mac).await; // stop for generation 2
        f.flip(2, Home::Cloud).await; // back in the cloud at generation 3
        f.pass().await; // the old stop is claimed first
        assert!(
            !f.host
                .calls()
                .iter()
                .any(|c| matches!(c, FakeCall::Stop(_))),
            "the stale stop must not reach the host: {:?}",
            f.host.calls()
        );
        assert_eq!(
            f.host.machine_state(&machine.machine_id),
            MachineState::Started
        );
        let journal = f.journal().await;
        assert_eq!(journal[1], ("stop".into(), 2, "done".into(), 1));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn ensure_then_start_boots_the_machine_with_a_single_use_token() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.state
            .db
            .enqueue_cloud_op(f.community, &f.agent, CloudOp::Start, 1)
            .await
            .expect("enqueue start");
        f.pass().await; // ensure
        let row = f.row().await;
        assert_eq!(row.fly_machine_id.as_deref(), Some("m1"));
        assert_eq!(row.fly_volume_id.as_deref(), Some("v1"));
        f.pass().await; // start
        let calls = f.host.calls();
        let FakeCall::Start(machine, token) = calls.last().expect("a start call").clone() else {
            panic!("expected a start call, got {calls:?}");
        };
        assert_eq!(machine, "m1");
        assert_eq!(token.len(), 64);
        let consumed = f
            .state
            .db
            .consume_cloud_boot_token(&crate::cloud_agents::token_hash(&token))
            .await
            .expect("consume");
        assert!(
            consumed.is_some(),
            "the token handed to the machine is redeemable once"
        );
        assert!(f
            .journal()
            .await
            .iter()
            .all(|(_, _, status, _)| status == "done"));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transient_failure_retries_with_backoff() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.host.fail_next([
            HostError::Transient("429".into()),
            HostError::Transient("503".into()),
        ]);
        f.pass().await;
        assert_eq!(
            f.journal().await[0],
            ("ensure".into(), 1, "pending".into(), 1)
        );
        let wait: f64 = sqlx::query_scalar(
            "SELECT extract(epoch FROM next_attempt_at - now())::float8 FROM cloud_agent_ops \
             WHERE community_id = $1",
        )
        .bind(f.community.as_uuid())
        .fetch_one(&f.pool)
        .await
        .expect("read delay");
        assert!(
            (5.0..=10.5).contains(&wait),
            "first retry waits about 10 s, got {wait}"
        );
        assert_eq!(f.pass().await, 0, "a rescheduled op is not due yet");

        f.make_due().await;
        f.pass().await;
        assert_eq!(
            f.journal().await[0],
            ("ensure".into(), 1, "pending".into(), 2)
        );
        f.make_due().await;
        f.pass().await; // third attempt succeeds
        assert_eq!(f.journal().await[0], ("ensure".into(), 1, "done".into(), 3));
        assert!(f.row().await.fly_machine_id.is_some());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn permanent_failure_marks_failed_status() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.host.fail_next([HostError::Permanent("quota".into())]);
        f.pass().await;
        assert_eq!(
            f.journal().await[0],
            ("ensure".into(), 1, "failed".into(), 1)
        );
        let row = f.row().await;
        assert_eq!(row.status, Some(PlacementStatus::Failed));
        assert!(row
            .last_error
            .as_deref()
            .is_some_and(|e| e.contains("quota")));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn three_transient_failures_end_in_failed_status_not_a_loop() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.host.fail_next([
            HostError::Transient("a".into()),
            HostError::Transient("b".into()),
            HostError::Transient("c".into()),
        ]);
        for _ in 0..3 {
            f.pass().await;
            f.make_due().await;
        }
        assert_eq!(
            f.journal().await[0],
            ("ensure".into(), 1, "failed".into(), 3)
        );
        assert_eq!(f.row().await.status, Some(PlacementStatus::Failed));
        assert_eq!(f.pass().await, 0, "a failed op never comes back on its own");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn op_survives_worker_restart() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        // A worker claims the op and dies before it records anything.
        let claimed = f
            .state
            .db
            .claim_due_cloud_ops_for(Some(f.community), 8)
            .await
            .expect("claim");
        assert_eq!(claimed.len(), 1);
        assert_eq!(f.pass().await, 0, "the lease keeps a second worker off it");
        // The lease runs out; a new worker finishes the operation.
        sqlx::query("UPDATE cloud_agent_ops SET claimed_until = now() - interval '1 second' WHERE community_id = $1")
            .bind(f.community.as_uuid())
            .execute(&f.pool)
            .await
            .expect("expire lease");
        assert_eq!(f.pass().await, 1);
        assert_eq!(f.journal().await[0], ("ensure".into(), 1, "done".into(), 2));
        assert!(f.row().await.fly_machine_id.is_some());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stop_stops_the_machine_when_the_agent_moved_to_the_mac() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.pass().await; // ensure
        f.flip(1, Home::Mac).await;
        f.pass().await; // stop
        assert!(matches!(f.host.calls().last(), Some(FakeCall::Stop(m)) if m == "m1"));
        assert!(f
            .journal()
            .await
            .iter()
            .all(|(_, _, status, _)| status == "done"));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn destroy_removes_the_machine_then_the_sealed_key() {
        let f = fixture().await;
        f.flip(0, Home::Cloud).await;
        f.pass().await; // ensure
        f.state
            .db
            .enqueue_cloud_op(f.community, &f.agent, CloudOp::Destroy, 1)
            .await
            .expect("enqueue destroy");
        f.host.fail_next([HostError::Transient("fly down".into())]);
        f.pass().await;
        assert!(
            f.state
                .db
                .get_cloud_agent(f.community, &f.agent)
                .await
                .expect("read")
                .is_some(),
            "the key stays while the machine still exists"
        );
        f.make_due().await;
        f.pass().await;
        assert!(f
            .state
            .db
            .get_cloud_agent(f.community, &f.agent)
            .await
            .expect("read")
            .is_none());
        assert_eq!(
            f.host.machine_state("m1"),
            crate::cloud_agents::host::MachineState::Destroyed
        );
    }
}
