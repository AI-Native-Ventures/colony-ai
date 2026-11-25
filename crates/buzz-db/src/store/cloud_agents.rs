//! Cloud agent registry, boot tokens and the durable Fly operation journal.
//!
//! One `cloud_agents` row exists per agent that has uploaded a cloud bundle: the
//! agent key sealed with the deployment key, the runnable config snapshot, the
//! placement home and generation, and the Fly machine and volume ids. Every
//! placement change is one transaction that also writes the operation it needs
//! (`ensure` or `stop`) and revokes the agent's AI sessions, so a crash never
//! leaves a flipped agent without its follow-up work.
//!
//! The boot token and the home token are stored as SHA-256 hashes only. Nothing
//! here logs or prints a secret: [`BundleRow`] and [`CloudAgentRow`] redact the
//! sealed key material in `Debug`.

use std::fmt;

use buzz_core::agent_placement::{Home, PlacementStatus};
use buzz_core::CommunityId;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Seconds a claimed operation stays leased to one worker before another may
/// claim it again. Longer than the Fly client timeout, short enough that a
/// crashed worker's operation is retried within a minute.
pub const OP_LEASE_SECS: i64 = 60;

/// Column list of a full agent row, as a literal so every statement built from
/// it stays a `&'static str` (sqlx refuses dynamically built SQL).
macro_rules! agent_columns {
    () => {
        "community_id, agent_pubkey, owner_pubkey, home, generation, \
         cloud_model, status, wrapped_dek, sealed_nsec, nonce, kek_id, auth_tag, config, \
         config_version, fly_machine_id, fly_volume_id, home_token_hash, wake_attempts, \
         last_wake_at, last_error, created_at, updated_at"
    };
}

/// The sealed key and runnable config an agent's owner uploaded.
#[derive(Clone)]
pub struct BundleRow {
    /// Community the agent belongs to.
    pub community: CommunityId,
    /// Agent pubkey, 32 bytes.
    pub agent_pubkey: Vec<u8>,
    /// Owner pubkey, 32 bytes.
    pub owner_pubkey: Vec<u8>,
    /// Data key wrapped by the deployment key (nonce first).
    pub wrapped_dek: Vec<u8>,
    /// Agent secret key sealed with the data key.
    pub sealed_nsec: Vec<u8>,
    /// Nonce for `sealed_nsec`, 12 bytes.
    pub nonce: Vec<u8>,
    /// Non-secret identifier of the deployment key that wrapped `wrapped_dek`.
    pub kek_id: String,
    /// The agent's auth tag JSON, when it has one.
    pub auth_tag: Option<String>,
    /// Runnable config snapshot as a JSON object.
    pub config: Value,
    /// Monotonic version of the snapshot.
    pub config_version: i64,
}

impl fmt::Debug for BundleRow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BundleRow")
            .field("community", &self.community)
            .field("config_version", &self.config_version)
            .field("secrets", &"<redacted>")
            .finish()
    }
}

/// Result of [`Db::upsert_cloud_bundle`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    /// The bundle was stored (new row or an equal or newer `config_version`).
    Stored,
    /// A newer bundle is already stored.
    Stale {
        /// The stored `config_version`.
        current: i64,
    },
}

/// Result of [`Db::set_cloud_home_cas`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CasOutcome {
    /// The expected generation matched. `generation` is the generation after the
    /// call; `changed` is `false` when the agent already had that home.
    Applied {
        /// Generation after the call.
        generation: i64,
        /// Whether the home changed (and so the generation grew).
        changed: bool,
    },
    /// The expected generation did not match the stored one.
    Conflict {
        /// The stored generation.
        current_generation: i64,
    },
    /// The agent has no stored bundle, so it is not cloud ready.
    NotFound,
}

/// A stored cloud agent. Secret columns are redacted in `Debug`.
#[derive(Clone)]
pub struct CloudAgentRow {
    /// Community the agent belongs to.
    pub community: CommunityId,
    /// Agent pubkey, 32 bytes.
    pub agent_pubkey: Vec<u8>,
    /// Owner pubkey, 32 bytes.
    pub owner_pubkey: Vec<u8>,
    /// Current home.
    pub home: Home,
    /// Current placement generation.
    pub generation: i64,
    /// Cloud model, when one is set.
    pub cloud_model: Option<String>,
    /// Cloud machine state; `None` when `home` is `mac`.
    pub status: Option<PlacementStatus>,
    /// Data key wrapped by the deployment key.
    pub wrapped_dek: Vec<u8>,
    /// Agent secret key sealed with the data key.
    pub sealed_nsec: Vec<u8>,
    /// Nonce for `sealed_nsec`.
    pub nonce: Vec<u8>,
    /// Identifier of the deployment key that wrapped `wrapped_dek`.
    pub kek_id: String,
    /// The agent's auth tag JSON, when it has one.
    pub auth_tag: Option<String>,
    /// Runnable config snapshot.
    pub config: Value,
    /// Version of the snapshot.
    pub config_version: i64,
    /// Fly machine id, once created.
    pub fly_machine_id: Option<String>,
    /// Fly volume id, once created.
    pub fly_volume_id: Option<String>,
    /// SHA-256 of the current home token, once a machine has booted.
    pub home_token_hash: Option<Vec<u8>>,
    /// Failed or pending wake attempts since the last reset.
    pub wake_attempts: i32,
    /// Time of the last wake request.
    pub last_wake_at: Option<DateTime<Utc>>,
    /// Last failure text, never a secret.
    pub last_error: Option<String>,
    /// Row creation time.
    pub created_at: DateTime<Utc>,
    /// Last change time.
    pub updated_at: DateTime<Utc>,
}

impl fmt::Debug for CloudAgentRow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CloudAgentRow")
            .field("community", &self.community)
            .field("home", &self.home)
            .field("generation", &self.generation)
            .field("status", &self.status)
            .field("config_version", &self.config_version)
            .field("secrets", &"<redacted>")
            .finish()
    }
}

/// A Fly operation kind in the journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudOp {
    /// Create the machine and volume when missing.
    Ensure,
    /// Start the machine with a boot token.
    Start,
    /// Stop the machine, keeping the volume.
    Stop,
    /// Destroy the machine and the volume.
    Destroy,
}

impl CloudOp {
    /// The `cloud_agent_ops.op` value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ensure => "ensure",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Destroy => "destroy",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "ensure" => Ok(Self::Ensure),
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "destroy" => Ok(Self::Destroy),
            other => Err(DbError::InvalidData(format!("unknown cloud op {other}"))),
        }
    }
}

/// One claimed journal operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpRow {
    /// Operation id.
    pub id: Uuid,
    /// Community the agent belongs to.
    pub community: CommunityId,
    /// Agent pubkey, 32 bytes.
    pub agent_pubkey: Vec<u8>,
    /// What to do.
    pub op: CloudOp,
    /// Placement generation the operation was written for.
    pub generation: i64,
    /// Attempts including this claim.
    pub attempt: i32,
}

fn home_str(home: Home) -> &'static str {
    match home {
        Home::Mac => "mac",
        Home::Cloud => "cloud",
    }
}

fn parse_home(value: &str) -> Result<Home> {
    match value {
        "mac" => Ok(Home::Mac),
        "cloud" => Ok(Home::Cloud),
        other => Err(DbError::InvalidData(format!("unknown home {other}"))),
    }
}

/// The `cloud_agents.status` value for a placement status. `NotCloudReady` is a
/// head-only state and has no stored form.
pub const fn status_str(status: PlacementStatus) -> Option<&'static str> {
    match status {
        PlacementStatus::Asleep => Some("asleep"),
        PlacementStatus::Waking => Some("waking"),
        PlacementStatus::Working => Some("working"),
        PlacementStatus::Failed => Some("failed"),
        PlacementStatus::OutOfCredit => Some("outOfCredit"),
        PlacementStatus::NotCloudReady => None,
    }
}

fn parse_status(value: &str) -> Result<PlacementStatus> {
    match value {
        "asleep" => Ok(PlacementStatus::Asleep),
        "waking" => Ok(PlacementStatus::Waking),
        "working" => Ok(PlacementStatus::Working),
        "failed" => Ok(PlacementStatus::Failed),
        "outOfCredit" => Ok(PlacementStatus::OutOfCredit),
        other => Err(DbError::InvalidData(format!("unknown status {other}"))),
    }
}

fn agent_from_row(row: &PgRow) -> Result<CloudAgentRow> {
    let status: Option<String> = row.try_get("status")?;
    Ok(CloudAgentRow {
        community: CommunityId::from_uuid(row.try_get("community_id")?),
        agent_pubkey: row.try_get("agent_pubkey")?,
        owner_pubkey: row.try_get("owner_pubkey")?,
        home: parse_home(&row.try_get::<String, _>("home")?)?,
        generation: row.try_get("generation")?,
        cloud_model: row.try_get("cloud_model")?,
        status: status.as_deref().map(parse_status).transpose()?,
        wrapped_dek: row.try_get("wrapped_dek")?,
        sealed_nsec: row.try_get("sealed_nsec")?,
        nonce: row.try_get("nonce")?,
        kek_id: row.try_get("kek_id")?,
        auth_tag: row.try_get("auth_tag")?,
        config: row.try_get("config")?,
        config_version: row.try_get("config_version")?,
        fly_machine_id: row.try_get("fly_machine_id")?,
        fly_volume_id: row.try_get("fly_volume_id")?,
        home_token_hash: row.try_get("home_token_hash")?,
        wake_attempts: row.try_get("wake_attempts")?,
        last_wake_at: row.try_get("last_wake_at")?,
        last_error: row.try_get("last_error")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn check_pubkey(name: &str, value: &[u8]) -> Result<()> {
    if value.len() == 32 {
        Ok(())
    } else {
        Err(DbError::InvalidData(format!("{name} must be 32 bytes")))
    }
}

impl Db {
    /// Store an agent's sealed key and config snapshot.
    ///
    /// A bundle with a lower `config_version` than the stored one is refused
    /// with [`UpsertOutcome::Stale`]; an equal version is accepted so a retried
    /// upload is harmless. Placement, machine ids and tokens of an existing row
    /// are never touched.
    pub async fn upsert_cloud_bundle(&self, bundle: &BundleRow) -> Result<UpsertOutcome> {
        check_pubkey("agent_pubkey", &bundle.agent_pubkey)?;
        check_pubkey("owner_pubkey", &bundle.owner_pubkey)?;
        let stored: Option<i64> = sqlx::query_scalar(
            "INSERT INTO cloud_agents (community_id, agent_pubkey, owner_pubkey, wrapped_dek, \
                 sealed_nsec, nonce, kek_id, auth_tag, config, config_version) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
             ON CONFLICT (community_id, agent_pubkey) DO UPDATE SET \
                 owner_pubkey = EXCLUDED.owner_pubkey, \
                 wrapped_dek = EXCLUDED.wrapped_dek, \
                 sealed_nsec = EXCLUDED.sealed_nsec, \
                 nonce = EXCLUDED.nonce, \
                 kek_id = EXCLUDED.kek_id, \
                 auth_tag = EXCLUDED.auth_tag, \
                 config = EXCLUDED.config, \
                 config_version = EXCLUDED.config_version, \
                 updated_at = now() \
             WHERE cloud_agents.config_version <= EXCLUDED.config_version \
             RETURNING config_version",
        )
        .bind(bundle.community.as_uuid())
        .bind(&bundle.agent_pubkey)
        .bind(&bundle.owner_pubkey)
        .bind(&bundle.wrapped_dek)
        .bind(&bundle.sealed_nsec)
        .bind(&bundle.nonce)
        .bind(&bundle.kek_id)
        .bind(&bundle.auth_tag)
        .bind(&bundle.config)
        .bind(bundle.config_version)
        .fetch_optional(&self.pool)
        .await?;
        if stored.is_some() {
            return Ok(UpsertOutcome::Stored);
        }
        let current: i64 = sqlx::query_scalar(
            "SELECT config_version FROM cloud_agents WHERE community_id = $1 AND agent_pubkey = $2",
        )
        .bind(bundle.community.as_uuid())
        .bind(&bundle.agent_pubkey)
        .fetch_one(&self.pool)
        .await?;
        Ok(UpsertOutcome::Stale { current })
    }

    /// Load one cloud agent.
    pub async fn get_cloud_agent(
        &self,
        community: CommunityId,
        agent: &[u8],
    ) -> Result<Option<CloudAgentRow>> {
        let mut conn = self.pool.acquire().await?;
        get_cloud_agent_in(&mut conn, community, agent, false).await
    }

    /// Change an agent's home in its own transaction. See
    /// [`set_cloud_home_cas_in`] for the rules; the relay's placement broker
    /// calls that function inside its event-write transaction instead.
    pub async fn set_cloud_home_cas(
        &self,
        community: CommunityId,
        agent: &[u8],
        expected_generation: i64,
        home: Home,
    ) -> Result<CasOutcome> {
        let mut tx = self.pool.begin().await?;
        let outcome =
            set_cloud_home_cas_in(&mut tx, community, agent, expected_generation, home).await?;
        tx.commit().await?;
        Ok(outcome)
    }

    /// The fence columns of one agent. See [`cloud_agent_fence_state`].
    pub async fn cloud_fence_state(
        &self,
        community: CommunityId,
        agent: &[u8],
    ) -> Result<Option<FenceState>> {
        let mut conn = self.pool.acquire().await?;
        cloud_agent_fence_state(&mut conn, community, agent).await
    }

    /// The verified account email behind an owner pubkey (64 hex characters).
    /// See [`verified_account_email`].
    pub async fn owner_account_email(&self, owner_hex: &str) -> Result<Option<String>> {
        let mut conn = self.pool.acquire().await?;
        verified_account_email(&mut conn, owner_hex).await
    }

    /// Store a fresh boot token hash for a cloud-placed agent at `generation`.
    ///
    /// Returns `false` when the agent is not placed in the cloud at that
    /// generation, so a stale wake can never mint a token. A new token replaces
    /// any outstanding one. `ttl_secs` is counted on the database clock.
    pub async fn issue_cloud_boot_token(
        &self,
        community: CommunityId,
        agent: &[u8],
        generation: i64,
        token_hash: &[u8],
        ttl_secs: i64,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE cloud_agents SET boot_token_hash = $4, \
                 boot_token_expires_at = now() + make_interval(secs => $5::double precision), \
                 updated_at = now() \
             WHERE community_id = $1 AND agent_pubkey = $2 AND generation = $3 AND home = 'cloud'",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .bind(generation)
        .bind(token_hash)
        .bind(ttl_secs)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Redeem a boot token: returns the agent once, then never again.
    ///
    /// The token is cleared in the same statement that checks it, so two
    /// concurrent redemptions cannot both succeed. An expired token returns
    /// `None` and stays unusable.
    pub async fn consume_cloud_boot_token(
        &self,
        token_hash: &[u8],
    ) -> Result<Option<CloudAgentRow>> {
        let row = sqlx::query(concat!(
            "UPDATE cloud_agents SET boot_token_hash = NULL, boot_token_expires_at = NULL, \
                 updated_at = now() \
             WHERE boot_token_hash = $1 AND boot_token_expires_at > now() AND home = 'cloud' \
             RETURNING ",
            agent_columns!()
        ))
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(agent_from_row).transpose()
    }

    /// Store the hash of the home token a booted machine must present when it
    /// authenticates. Returns `false` when the agent is no longer in the cloud
    /// at `generation`.
    pub async fn set_cloud_home_token(
        &self,
        community: CommunityId,
        agent: &[u8],
        generation: i64,
        token_hash: &[u8],
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE cloud_agents SET home_token_hash = $4, updated_at = now() \
             WHERE community_id = $1 AND agent_pubkey = $2 AND generation = $3 AND home = 'cloud'",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .bind(generation)
        .bind(token_hash)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Queue a Fly operation. Returns `None` when the same operation for the
    /// same agent and generation is already pending.
    pub async fn enqueue_cloud_op(
        &self,
        community: CommunityId,
        agent: &[u8],
        op: CloudOp,
        generation: i64,
    ) -> Result<Option<Uuid>> {
        let mut tx = self.pool.begin().await?;
        let id = insert_op(&mut tx, community, agent, op, generation).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Claim up to `limit` due operations of any community. See
    /// [`Db::claim_due_cloud_ops_for`].
    pub async fn claim_due_cloud_ops(&self, limit: i64) -> Result<Vec<OpRow>> {
        self.claim_due_cloud_ops_for(None, limit).await
    }

    /// Claim up to `limit` due operations, at most one per agent and always the
    /// agent's oldest pending one, so an agent's operations run in order. A
    /// claim leases the operation for [`OP_LEASE_SECS`] and counts as an
    /// attempt, so a crash is bounded by the attempt limit like any failure.
    /// `community` narrows the claim to one community (tests; production
    /// passes `None`).
    pub async fn claim_due_cloud_ops_for(
        &self,
        community: Option<CommunityId>,
        limit: i64,
    ) -> Result<Vec<OpRow>> {
        let rows = sqlx::query(
            "WITH heads AS ( \
                 SELECT DISTINCT ON (community_id, agent_pubkey) \
                        community_id, id, next_attempt_at, claimed_until \
                 FROM cloud_agent_ops \
                 WHERE status = 'pending' AND ($3::uuid IS NULL OR community_id = $3) \
                 ORDER BY community_id, agent_pubkey, created_at, id \
             ), due AS ( \
                 SELECT o.community_id, o.id \
                 FROM cloud_agent_ops o \
                 JOIN heads h ON h.community_id = o.community_id AND h.id = o.id \
                 WHERE h.next_attempt_at <= now() \
                   AND (h.claimed_until IS NULL OR h.claimed_until <= now()) \
                 ORDER BY h.next_attempt_at, o.id \
                 LIMIT $1 \
                 FOR UPDATE OF o SKIP LOCKED \
             ) \
             UPDATE cloud_agent_ops o SET attempt = o.attempt + 1, \
                 claimed_until = now() + make_interval(secs => $2::double precision), \
                 updated_at = now() \
             FROM due WHERE o.community_id = due.community_id AND o.id = due.id \
             RETURNING o.id, o.community_id, o.agent_pubkey, o.op, o.generation, o.attempt",
        )
        .bind(limit)
        .bind(OP_LEASE_SECS)
        .bind(community.map(|c| *c.as_uuid()))
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| -> Result<OpRow> {
                Ok(OpRow {
                    id: row.try_get("id")?,
                    community: CommunityId::from_uuid(row.try_get("community_id")?),
                    agent_pubkey: row.try_get("agent_pubkey")?,
                    op: CloudOp::parse(&row.try_get::<String, _>("op")?)?,
                    generation: row.try_get("generation")?,
                    attempt: row.try_get("attempt")?,
                })
            })
            .collect()
    }

    /// Record the host's ids for an agent's machine and volume. Returns `false`
    /// when the agent has no row any more.
    pub async fn set_cloud_machine(
        &self,
        community: CommunityId,
        agent: &[u8],
        machine_id: &str,
        volume_id: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE cloud_agents SET fly_machine_id = $3, fly_volume_id = $4, updated_at = now() \
             WHERE community_id = $1 AND agent_pubkey = $2",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .bind(machine_id)
        .bind(volume_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Set the status of an agent that is still placed in the cloud at
    /// `generation` (and set `last_error`, or clear it with `None`). A stale
    /// caller changes nothing and gets `false`: a result that arrives after the
    /// agent moved must never write over the new placement.
    pub async fn set_cloud_status(
        &self,
        community: CommunityId,
        agent: &[u8],
        generation: i64,
        status: PlacementStatus,
        last_error: Option<&str>,
    ) -> Result<bool> {
        let Some(status) = status_str(status) else {
            return Err(DbError::InvalidData("status has no stored form".into()));
        };
        let result = sqlx::query(
            "UPDATE cloud_agents SET status = $4, last_error = $5, updated_at = now() \
             WHERE community_id = $1 AND agent_pubkey = $2 AND generation = $3 AND home = 'cloud'",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .bind(generation)
        .bind(status)
        .bind(last_error.map(|text| text.chars().take(500).collect::<String>()))
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Mark a claimed operation done.
    pub async fn finish_cloud_op(&self, community: CommunityId, id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE cloud_agent_ops SET status = 'done', claimed_until = NULL, updated_at = now() \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Give a claimed operation back to the journal to run again after
    /// `delay_secs`, remembering why it failed.
    pub async fn reschedule_cloud_op(
        &self,
        community: CommunityId,
        id: Uuid,
        delay_secs: i64,
        error: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE cloud_agent_ops SET claimed_until = NULL, last_error = $4, updated_at = now(), \
                 next_attempt_at = now() + make_interval(secs => $3::double precision) \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(id)
        .bind(delay_secs)
        .bind(error.chars().take(500).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Give up on a claimed operation. It stays in the journal as `failed`
    /// with its reason.
    pub async fn fail_cloud_op(&self, community: CommunityId, id: Uuid, error: &str) -> Result<()> {
        sqlx::query(
            "UPDATE cloud_agent_ops SET status = 'failed', claimed_until = NULL, last_error = $3, \
                 updated_at = now() WHERE community_id = $1 AND id = $2",
        )
        .bind(community.as_uuid())
        .bind(id)
        .bind(error.chars().take(500).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Agents of one owner that are placed in the cloud (the per-account cap).
    pub async fn count_cloud_agents_for_owner(&self, owner: &[u8]) -> Result<i64> {
        let mut conn = self.pool.acquire().await?;
        count_cloud_agents_for_owner_in(&mut conn, owner).await
    }

    /// Machines that exist on the host, started or stopped (the global cap).
    pub async fn count_cloud_machines(&self) -> Result<i64> {
        Ok(
            sqlx::query_scalar(
                "SELECT count(*) FROM cloud_agents WHERE fly_machine_id IS NOT NULL",
            )
            .fetch_one(&self.pool)
            .await?,
        )
    }

    /// Remove an agent's sealed key, config and queued operations, and revoke
    /// its AI sessions, in one transaction. Returns `false` when it had no row.
    ///
    /// The caller destroys the machine first (see the `destroy` operation); a
    /// machine whose row is already gone is destroyed by reconcile.
    pub async fn delete_cloud_agent(&self, community: CommunityId, agent: &[u8]) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM cloud_agent_ops WHERE community_id = $1 AND agent_pubkey = $2")
            .bind(community.as_uuid())
            .bind(agent)
            .execute(&mut *tx)
            .await?;
        let deleted =
            sqlx::query("DELETE FROM cloud_agents WHERE community_id = $1 AND agent_pubkey = $2")
                .bind(community.as_uuid())
                .bind(agent)
                .execute(&mut *tx)
                .await?;
        sqlx::query(
            "UPDATE account_ai_sessions SET revoked = true \
             WHERE community_id = $1 AND agent_pubkey = $2 AND NOT revoked",
        )
        .bind(community.as_uuid())
        .bind(agent)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(deleted.rows_affected() == 1)
    }
}

/// Load one cloud agent on an existing connection or transaction. With
/// `lock`, the row is locked `FOR UPDATE` until the transaction ends.
pub async fn get_cloud_agent_in(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
    lock: bool,
) -> Result<Option<CloudAgentRow>> {
    let sql = if lock {
        concat!(
            "SELECT ",
            agent_columns!(),
            " FROM cloud_agents WHERE community_id = $1 AND agent_pubkey = $2 FOR UPDATE"
        )
    } else {
        concat!(
            "SELECT ",
            agent_columns!(),
            " FROM cloud_agents WHERE community_id = $1 AND agent_pubkey = $2"
        )
    };
    let row = sqlx::query(sql)
        .bind(community.as_uuid())
        .bind(agent)
        .fetch_optional(conn)
        .await?;
    row.as_ref().map(agent_from_row).transpose()
}

/// What the NIP-42 fence needs to know about an agent: no sealed key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FenceState {
    /// Current home.
    pub home: Home,
    /// Current placement generation.
    pub generation: i64,
    /// SHA-256 of the current home token, once a machine has booted.
    pub home_token_hash: Option<Vec<u8>>,
}

/// Load only the fence columns of one agent (a primary-key read that never
/// pulls the sealed key into memory). `None` means the agent has no bundle,
/// which is the Mac at generation 0.
pub async fn cloud_agent_fence_state(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
) -> Result<Option<FenceState>> {
    let row: Option<(String, i64, Option<Vec<u8>>)> = sqlx::query_as(
        "SELECT home, generation, home_token_hash FROM cloud_agents \
         WHERE community_id = $1 AND agent_pubkey = $2",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .fetch_optional(conn)
    .await?;
    row.map(
        |(home, generation, home_token_hash)| -> Result<FenceState> {
            Ok(FenceState {
                home: parse_home(&home)?,
                generation,
                home_token_hash,
            })
        },
    )
    .transpose()
}

/// Set the cloud model of an agent that has a bundle. Returns `false` when the
/// agent has none. The caller checks the model against the allowlist.
pub async fn set_cloud_model_in(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
    model: &str,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE cloud_agents SET cloud_model = $3, updated_at = now() \
         WHERE community_id = $1 AND agent_pubkey = $2",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .bind(model)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Clear a failed wake so the next message or `Try again` starts fresh: the
/// attempt counter and error go to zero and a `failed` status goes back to
/// `asleep`. Returns `false` unless the agent is placed in the cloud.
pub async fn reset_cloud_wake_in(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE cloud_agents SET wake_attempts = 0, last_error = NULL, last_wake_at = NULL, \
             status = CASE WHEN status = 'failed' THEN 'asleep' ELSE status END, \
             updated_at = now() \
         WHERE community_id = $1 AND agent_pubkey = $2 AND home = 'cloud'",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// The verified account email behind an owner pubkey (64 hex characters), or
/// `None` when no verified account has that key. Used for the beta allowlist.
pub async fn verified_account_email(
    conn: &mut sqlx::PgConnection,
    owner_hex: &str,
) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT email FROM accounts WHERE pubkey = $1 AND email_verified_at IS NOT NULL",
    )
    .bind(owner_hex)
    .fetch_optional(conn)
    .await?)
}

/// Agents of one owner that are placed in the cloud, on an existing
/// connection or transaction.
pub async fn count_cloud_agents_for_owner_in(
    conn: &mut sqlx::PgConnection,
    owner: &[u8],
) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "SELECT count(*) FROM cloud_agents WHERE owner_pubkey = $1 AND home = 'cloud'",
    )
    .bind(owner)
    .fetch_one(conn)
    .await?)
}

/// Change an agent's home if `expected_generation` is still current. The
/// caller owns the transaction: nothing here commits or rolls back, so the
/// placement change, the follow-up operation and the caller's own writes (the
/// action and head events) land together or not at all.
///
/// A real change bumps the generation, sets the status (`asleep` for the
/// cloud, none for the Mac), clears the home token, boot token and wake
/// counters, writes the follow-up operation (`ensure` for the cloud, `stop`
/// for the Mac) for the new generation, and revokes the agent's open AI
/// sessions. Asking for the home the agent already has changes nothing.
pub async fn set_cloud_home_cas_in(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
    expected_generation: i64,
    home: Home,
) -> Result<CasOutcome> {
    let Some(current) = get_cloud_agent_in(conn, community, agent, true).await? else {
        return Ok(CasOutcome::NotFound);
    };
    if current.generation != expected_generation {
        return Ok(CasOutcome::Conflict {
            current_generation: current.generation,
        });
    }
    if current.home == home {
        return Ok(CasOutcome::Applied {
            generation: current.generation,
            changed: false,
        });
    }
    let next = current.generation + 1;
    let (status, op) = match home {
        Home::Cloud => (Some("asleep"), CloudOp::Ensure),
        Home::Mac => (None, CloudOp::Stop),
    };
    sqlx::query(
        "UPDATE cloud_agents SET home = $3, generation = $4, status = $5, \
             home_token_hash = NULL, boot_token_hash = NULL, boot_token_expires_at = NULL, \
             wake_attempts = 0, last_wake_at = NULL, last_error = NULL, updated_at = now() \
         WHERE community_id = $1 AND agent_pubkey = $2",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .bind(home_str(home))
    .bind(next)
    .bind(status)
    .execute(&mut *conn)
    .await?;
    insert_op(conn, community, agent, op, next).await?;
    sqlx::query(
        "UPDATE account_ai_sessions SET revoked = true \
         WHERE community_id = $1 AND agent_pubkey = $2 AND NOT revoked",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .execute(&mut *conn)
    .await?;
    Ok(CasOutcome::Applied {
        generation: next,
        changed: true,
    })
}

async fn insert_op(
    conn: &mut sqlx::PgConnection,
    community: CommunityId,
    agent: &[u8],
    op: CloudOp,
    generation: i64,
) -> Result<Option<Uuid>> {
    check_pubkey("agent_pubkey", agent)?;
    Ok(sqlx::query_scalar(
        "INSERT INTO cloud_agent_ops (community_id, agent_pubkey, op, generation) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (community_id, agent_pubkey, op, generation) WHERE status = 'pending' \
         DO NOTHING RETURNING id",
    )
    .bind(community.as_uuid())
    .bind(agent)
    .bind(op.as_str())
    .bind(generation)
    .fetch_optional(conn)
    .await?)
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn fixture() -> (Db, sqlx::PgPool, CommunityId) {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(&crate::test_support::database_url())
            .await
            .unwrap();
        let db = Db::from_pool(pool.clone());
        let community = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community)
            .bind(format!("{community}.example"))
            .execute(&pool)
            .await
            .unwrap();
        (db, pool, CommunityId::from_uuid(community))
    }

    fn key(byte: u8) -> Vec<u8> {
        vec![byte; 32]
    }

    fn bundle(community: CommunityId, agent: u8, config_version: i64) -> BundleRow {
        BundleRow {
            community,
            agent_pubkey: key(agent),
            owner_pubkey: key(0xaa),
            wrapped_dek: vec![1; 28],
            sealed_nsec: vec![2; 48],
            nonce: vec![3; 12],
            kek_id: "test-kek".to_string(),
            auth_tag: None,
            config: serde_json::json!({"name": "Scout"}),
            config_version,
        }
    }

    async fn stored(db: &Db, community: CommunityId, agent: u8) -> CloudAgentRow {
        db.get_cloud_agent(community, &key(agent))
            .await
            .unwrap()
            .expect("cloud agent row")
    }

    async fn pending_ops(pool: &sqlx::PgPool, community: CommunityId) -> Vec<(String, i64)> {
        sqlx::query_as(
            "SELECT op, generation FROM cloud_agent_ops \
             WHERE community_id = $1 AND status = 'pending' ORDER BY created_at, id",
        )
        .bind(community.as_uuid())
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cas_rejects_stale_generation() {
        let (db, _pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        let applied = db
            .set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert_eq!(
            applied,
            CasOutcome::Applied {
                generation: 1,
                changed: true
            }
        );
        // A second flip that still believes the generation is 0 must lose.
        let stale = db
            .set_cloud_home_cas(community, &key(1), 0, Home::Mac)
            .await
            .unwrap();
        assert_eq!(
            stale,
            CasOutcome::Conflict {
                current_generation: 1
            }
        );
        let row = stored(&db, community, 1).await;
        assert_eq!(row.home, Home::Cloud);
        assert_eq!(row.generation, 1);
        assert_eq!(row.status, Some(PlacementStatus::Asleep));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cas_without_bundle_is_not_found() {
        let (db, _pool, community) = fixture().await;
        let outcome = db
            .set_cloud_home_cas(community, &key(9), 0, Home::Cloud)
            .await
            .unwrap();
        assert_eq!(outcome, CasOutcome::NotFound);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cas_same_home_changes_nothing() {
        let (db, pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        let outcome = db
            .set_cloud_home_cas(community, &key(1), 0, Home::Mac)
            .await
            .unwrap();
        assert_eq!(
            outcome,
            CasOutcome::Applied {
                generation: 0,
                changed: false
            }
        );
        assert!(pending_ops(&pool, community).await.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cas_writes_follow_up_op_and_clears_tokens_atomically() {
        let (db, pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert_eq!(
            pending_ops(&pool, community).await,
            vec![("ensure".to_string(), 1)]
        );
        assert!(db
            .set_cloud_home_token(community, &key(1), 1, &[7; 32])
            .await
            .unwrap());
        assert!(db
            .issue_cloud_boot_token(community, &key(1), 1, &[8; 32], 300)
            .await
            .unwrap());
        db.set_cloud_home_cas(community, &key(1), 1, Home::Mac)
            .await
            .unwrap();
        let row = stored(&db, community, 1).await;
        assert_eq!(row.home, Home::Mac);
        assert_eq!(row.generation, 2);
        assert_eq!(row.status, None);
        assert_eq!(row.home_token_hash, None);
        assert!(
            db.consume_cloud_boot_token(&[8; 32])
                .await
                .unwrap()
                .is_none(),
            "a flip must void an outstanding boot token"
        );
        assert_eq!(
            pending_ops(&pool, community).await,
            vec![("ensure".to_string(), 1), ("stop".to_string(), 2)]
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boot_token_single_use() {
        let (db, _pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert!(db
            .issue_cloud_boot_token(community, &key(1), 1, &[5; 32], 300)
            .await
            .unwrap());
        let first = db.consume_cloud_boot_token(&[5; 32]).await.unwrap();
        assert_eq!(first.map(|row| row.generation), Some(1));
        assert!(db
            .consume_cloud_boot_token(&[5; 32])
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boot_token_expires() {
        let (db, _pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert!(db
            .issue_cloud_boot_token(community, &key(1), 1, &[6; 32], -1)
            .await
            .unwrap());
        assert!(db
            .consume_cloud_boot_token(&[6; 32])
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boot_token_refused_for_stale_generation_or_mac() {
        let (db, _pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        assert!(
            !db.issue_cloud_boot_token(community, &key(1), 0, &[4; 32], 300)
                .await
                .unwrap(),
            "a Mac-placed agent gets no boot token"
        );
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert!(
            !db.issue_cloud_boot_token(community, &key(1), 0, &[4; 32], 300)
                .await
                .unwrap(),
            "an old generation gets no boot token"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_rejects_lower_config_version() {
        let (db, _pool, community) = fixture().await;
        assert_eq!(
            db.upsert_cloud_bundle(&bundle(community, 1, 5))
                .await
                .unwrap(),
            UpsertOutcome::Stored
        );
        assert_eq!(
            db.upsert_cloud_bundle(&bundle(community, 1, 4))
                .await
                .unwrap(),
            UpsertOutcome::Stale { current: 5 }
        );
        assert_eq!(
            db.upsert_cloud_bundle(&bundle(community, 1, 5))
                .await
                .unwrap(),
            UpsertOutcome::Stored,
            "a retried upload of the same version is accepted"
        );
        assert_eq!(stored(&db, community, 1).await.config_version, 5);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_upload_keeps_placement() {
        let (db, _pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        db.upsert_cloud_bundle(&bundle(community, 1, 2))
            .await
            .unwrap();
        let row = stored(&db, community, 1).await;
        assert_eq!(
            (row.home, row.generation, row.config_version),
            (Home::Cloud, 1, 2)
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn delete_agent_removes_ops_and_secrets() {
        let (db, pool, community) = fixture().await;
        db.upsert_cloud_bundle(&bundle(community, 1, 1))
            .await
            .unwrap();
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert!(!pending_ops(&pool, community).await.is_empty());
        assert!(db.delete_cloud_agent(community, &key(1)).await.unwrap());
        assert!(db
            .get_cloud_agent(community, &key(1))
            .await
            .unwrap()
            .is_none());
        assert!(pending_ops(&pool, community).await.is_empty());
        let sealed: i64 =
            sqlx::query_scalar("SELECT count(*) FROM cloud_agents WHERE community_id = $1")
                .bind(community.as_uuid())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sealed, 0);
        assert!(!db.delete_cloud_agent(community, &key(1)).await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn claim_runs_one_op_per_agent_in_order_and_leases() {
        let (db, _pool, community) = fixture().await;
        db.enqueue_cloud_op(community, &key(1), CloudOp::Ensure, 1)
            .await
            .unwrap();
        db.enqueue_cloud_op(community, &key(1), CloudOp::Start, 1)
            .await
            .unwrap();
        // The same pending op twice is one op.
        assert_eq!(
            db.enqueue_cloud_op(community, &key(1), CloudOp::Start, 1)
                .await
                .unwrap(),
            None
        );
        let first: Vec<_> = db
            .claim_due_cloud_ops_for(Some(community), 10_000)
            .await
            .unwrap()
            .into_iter()
            .filter(|op| op.community == community)
            .collect();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].op, CloudOp::Ensure);
        assert_eq!(first[0].attempt, 1);
        // The lease hides it from a second worker, and `start` waits for `ensure`.
        let second: Vec<_> = db
            .claim_due_cloud_ops_for(Some(community), 10_000)
            .await
            .unwrap()
            .into_iter()
            .filter(|op| op.community == community)
            .collect();
        assert!(second.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn counts_cover_owner_cap_and_machines() {
        let (db, pool, community) = fixture().await;
        for agent in [1u8, 2] {
            db.upsert_cloud_bundle(&bundle(community, agent, 1))
                .await
                .unwrap();
        }
        db.set_cloud_home_cas(community, &key(1), 0, Home::Cloud)
            .await
            .unwrap();
        assert_eq!(
            db.count_cloud_agents_for_owner(&key(0xaa)).await.unwrap(),
            1
        );
        let before = db.count_cloud_machines().await.unwrap();
        sqlx::query(
            "UPDATE cloud_agents SET fly_machine_id = 'm1' \
             WHERE community_id = $1 AND agent_pubkey = $2",
        )
        .bind(community.as_uuid())
        .bind(key(1))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(db.count_cloud_machines().await.unwrap(), before + 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_bundle() -> BundleRow {
        BundleRow {
            community: CommunityId::from_uuid(Uuid::nil()),
            agent_pubkey: vec![1; 32],
            owner_pubkey: vec![2; 32],
            wrapped_dek: vec![1; 28],
            sealed_nsec: vec![2; 48],
            nonce: vec![3; 12],
            kek_id: "test-kek".to_string(),
            auth_tag: None,
            config: serde_json::json!({}),
            config_version: 1,
        }
    }

    #[test]
    fn debug_output_never_shows_secret_columns() {
        let text = format!("{:?}", sample_bundle());
        assert!(text.contains("<redacted>"));
        assert!(!text.contains("sealed_nsec"));
        assert!(!text.contains("wrapped_dek"));
    }
}
