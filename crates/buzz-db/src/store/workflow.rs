//! Workflow CRUD -- workflows, workflow_runs, and workflow_approvals tables.
//!
//! All IDs are native Postgres UUID columns. Never uses string interpolation
//! for query values -- all user data goes through bind parameters.
//!
//! Security notes:
//! - Approval tokens are stored as SHA-256 hashes (never plaintext).
//! - All list queries have a bounded LIMIT to prevent unbounded scans.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use buzz_core::CommunityId;

use crate::error::{DbError, Result};
use crate::Db;
use buzz_datastore_tracing::datastore_span;

// -- Token hashing ------------------------------------------------------------

/// Default maximum rows returned by list queries. Callers may request fewer.
pub const LIST_DEFAULT_LIMIT: i64 = 100;
/// Hard cap on rows returned by list queries.
pub const LIST_MAX_LIMIT: i64 = 1000;

/// SHA-256 hash of a raw approval token. Returns the 32-byte digest.
///
/// Approval tokens are stored hashed so that a DB read does not expose
/// the raw token (same pattern as API tokens in buzz-auth).
fn hash_approval_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

// -- Status enums -------------------------------------------------------------

/// Status of a workflow definition. Stored as ENUM('active','disabled','archived').
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowStatus {
    /// Workflow is live and will fire on matching events.
    Active,
    /// Workflow is paused and will not fire.
    Disabled,
    /// Workflow has been retired.
    Archived,
}

impl fmt::Display for WorkflowStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkflowStatus::Active => write!(f, "active"),
            WorkflowStatus::Disabled => write!(f, "disabled"),
            WorkflowStatus::Archived => write!(f, "archived"),
        }
    }
}

impl FromStr for WorkflowStatus {
    type Err = DbError;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "active" => Ok(WorkflowStatus::Active),
            "disabled" => Ok(WorkflowStatus::Disabled),
            "archived" => Ok(WorkflowStatus::Archived),
            other => Err(DbError::InvalidData(format!(
                "unknown workflow status: {other}"
            ))),
        }
    }
}

/// Status of a workflow run. Stored as ENUM in workflow_runs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    /// Run is queued but not yet started.
    Pending,
    /// Run is actively executing steps.
    Running,
    /// Run is suspended waiting for an approval gate.
    WaitingApproval,
    /// Suspended while waiting for an assigned channel agent to reply.
    WaitingAgent,
    /// Run finished successfully.
    Completed,
    /// Run terminated with an error.
    Failed,
    /// Run was cancelled before completion.
    Cancelled,
    /// A bounded agent or approval wait expired.
    TimedOut,
}

impl fmt::Display for RunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RunStatus::Pending => write!(f, "pending"),
            RunStatus::Running => write!(f, "running"),
            RunStatus::WaitingApproval => write!(f, "waiting_approval"),
            RunStatus::WaitingAgent => write!(f, "waiting_agent"),
            RunStatus::Completed => write!(f, "completed"),
            RunStatus::Failed => write!(f, "failed"),
            RunStatus::Cancelled => write!(f, "cancelled"),
            RunStatus::TimedOut => write!(f, "timed_out"),
        }
    }
}

impl FromStr for RunStatus {
    type Err = DbError;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "pending" => Ok(RunStatus::Pending),
            "running" => Ok(RunStatus::Running),
            "waiting_approval" => Ok(RunStatus::WaitingApproval),
            "waiting_agent" => Ok(RunStatus::WaitingAgent),
            "completed" => Ok(RunStatus::Completed),
            "failed" => Ok(RunStatus::Failed),
            "cancelled" => Ok(RunStatus::Cancelled),
            "timed_out" => Ok(RunStatus::TimedOut),
            other => Err(DbError::InvalidData(format!("unknown run status: {other}"))),
        }
    }
}

/// Status of an approval request. Stored as ENUM in workflow_approvals.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalStatus {
    /// Approval has been requested but not yet acted on.
    Pending,
    /// Approval was granted; the run may proceed.
    Granted,
    /// Approval was denied; the run should fail.
    Denied,
    /// The approval window elapsed without a decision.
    Expired,
}

impl fmt::Display for ApprovalStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApprovalStatus::Pending => write!(f, "pending"),
            ApprovalStatus::Granted => write!(f, "granted"),
            ApprovalStatus::Denied => write!(f, "denied"),
            ApprovalStatus::Expired => write!(f, "expired"),
        }
    }
}

impl FromStr for ApprovalStatus {
    type Err = DbError;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "pending" => Ok(ApprovalStatus::Pending),
            "granted" => Ok(ApprovalStatus::Granted),
            "denied" => Ok(ApprovalStatus::Denied),
            "expired" => Ok(ApprovalStatus::Expired),
            other => Err(DbError::InvalidData(format!(
                "unknown approval status: {other}"
            ))),
        }
    }
}

// -- Record types -------------------------------------------------------------

/// A workflow definition record. Run-state columns live in `workflow_runs`.
#[derive(Debug, Clone)]
pub struct WorkflowRecord {
    /// Unique workflow identifier.
    pub id: Uuid,
    /// Server-resolved community that owns this workflow.
    pub community_id: CommunityId,
    /// Human-readable workflow name.
    pub name: String,
    /// Compressed public key bytes of the workflow owner.
    pub owner_pubkey: Vec<u8>,
    /// Channel this workflow is scoped to, if any.
    pub channel_id: Option<Uuid>,
    /// Canonical JSON of the workflow definition.
    pub definition: serde_json::Value,
    /// SHA-256 hash of the canonical definition JSON.
    pub definition_hash: Vec<u8>,
    /// Current lifecycle status of the workflow definition.
    pub status: WorkflowStatus,
    /// Whether the workflow will fire on matching events.
    pub enabled: bool,
    /// When the workflow was created.
    pub created_at: DateTime<Utc>,
    /// When the workflow was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A single execution of a workflow.
#[derive(Debug, Clone)]
pub struct WorkflowRunRecord {
    /// Unique run identifier.
    pub id: Uuid,
    /// Server-resolved community this run (and its workflow) belongs to.
    ///
    /// `workflow_runs` is keyed `(community_id, id)`; the same run/workflow
    /// UUID is allowed across communities, so every run carries its owning
    /// community and downstream execution (side-effect sink, scoped lookups)
    /// runs under it rather than re-deriving a tenant from the deployment host.
    pub community_id: CommunityId,
    /// The workflow definition that was executed.
    pub workflow_id: Uuid,
    /// Workflow channel captured when this run started. Null for legacy runs.
    pub workflow_channel_id: Option<Uuid>,
    /// Content hash identifying the active workflow definition this run used.
    /// Null only for runs created before definition snapshots were added.
    pub definition_version: Option<Vec<u8>>,
    /// Immutable definition snapshot used by this run and any later resume.
    /// Null only for runs created before definition snapshots were added.
    pub definition_snapshot: Option<serde_json::Value>,
    /// Current execution status of this run.
    pub status: RunStatus,
    /// Raw event ID bytes that triggered this run, if any.
    pub trigger_event_id: Option<Vec<u8>>,
    /// Index of the step currently executing (0-based).
    pub current_step: i32,
    /// JSON execution trace -- one entry per completed step.
    pub execution_trace: serde_json::Value,
    /// Serialized `TriggerContext` captured at workflow start.
    /// NULL for runs created before this column was added (backwards-compatible).
    pub trigger_context: Option<serde_json::Value>,
    /// When execution began.
    pub started_at: Option<DateTime<Utc>>,
    /// When execution finished (success or failure).
    pub completed_at: Option<DateTime<Utc>>,
    /// Redacted human-readable diagnostic for failed or cancelled runs.
    pub error_message: Option<String>,
    /// Stable machine-readable failure or cancellation classification.
    /// Kept separate from `error_message` so callers never parse diagnostics.
    pub error_code: Option<String>,
    /// When the run record was created.
    pub created_at: DateTime<Utc>,
}

/// Lifecycle status of a persisted agent reply wait.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowAgentWaitStatus {
    /// Request was published and is waiting for the assigned agent.
    Pending,
    /// The assigned agent replied in the request thread.
    Completed,
    /// No reply arrived before the configured deadline.
    TimedOut,
    /// The run failed before the request could be completed.
    Failed,
}

impl fmt::Display for WorkflowAgentWaitStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Completed => write!(f, "completed"),
            Self::TimedOut => write!(f, "timed_out"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

impl FromStr for WorkflowAgentWaitStatus {
    type Err = DbError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "completed" => Ok(Self::Completed),
            "timed_out" => Ok(Self::TimedOut),
            "failed" => Ok(Self::Failed),
            other => Err(DbError::InvalidData(format!(
                "unknown workflow agent wait status: {other}"
            ))),
        }
    }
}

/// Persisted wait for a named agent's reply to a workflow request thread.
#[derive(Debug, Clone)]
pub struct WorkflowAgentWaitRecord {
    /// Owning community.
    pub community_id: CommunityId,
    /// Workflow the wait belongs to.
    pub workflow_id: Uuid,
    /// Run currently suspended on the agent.
    pub run_id: Uuid,
    /// Workflow step waiting for the response.
    pub step_id: String,
    /// Zero-based workflow step index.
    pub step_index: i32,
    /// Channel containing the request thread.
    pub channel_id: Uuid,
    /// Pubkey bytes of the assigned agent.
    pub agent_pubkey: Vec<u8>,
    /// Event ID bytes of the request thread root.
    pub request_event_id: Vec<u8>,
    /// Wait lifecycle state.
    pub status: WorkflowAgentWaitStatus,
    /// Reply event ID bytes after completion.
    pub reply_event_id: Option<Vec<u8>>,
    /// Deadline for the agent reply.
    pub expires_at: DateTime<Utc>,
}

/// Values stored atomically when a workflow step starts waiting for an agent.
pub struct CreateWorkflowAgentWaitParams<'a> {
    /// Community that owns the workflow and run.
    pub community_id: CommunityId,
    /// Workflow the run is executing.
    pub workflow_id: Uuid,
    /// Run to suspend.
    pub run_id: Uuid,
    /// Step being suspended.
    pub step_id: &'a str,
    /// Zero-based step index.
    pub step_index: i32,
    /// Channel containing the request thread.
    pub channel_id: Uuid,
    /// Assigned agent pubkey bytes.
    pub agent_pubkey: &'a [u8],
    /// Request event ID bytes, computed before it is published.
    pub request_event_id: &'a [u8],
    /// Signed request event stored in the same transaction as the wait.
    pub request_event: &'a nostr::Event,
    /// Deadline for the reply.
    pub expires_at: DateTime<Utc>,
    /// Completed/skipped steps preceding the wait, in execution order.
    pub prior_trace: &'a serde_json::Value,
    /// Run trace entry identifying the pending agent request.
    pub trace_entry: &'a serde_json::Value,
}

/// Values used to complete a persisted agent reply wait and resume its run.
pub struct CompleteWorkflowAgentWaitParams<'a> {
    /// Community that owns the workflow and run.
    pub community_id: CommunityId,
    /// Channel containing the request thread.
    pub channel_id: Uuid,
    /// Event ID bytes of the request thread root.
    pub request_event_id: &'a [u8],
    /// Pubkey bytes of the assigned agent.
    pub agent_pubkey: &'a [u8],
    /// Event ID bytes of the agent reply.
    pub reply_event_id: &'a [u8],
    /// Text of the agent reply, capped before it is stored in the trace.
    pub reply_text: &'a str,
    /// Current time used to reject replies received after the deadline.
    pub now: DateTime<Utc>,
}

/// A winning scheduled workflow fire claim.
///
/// The primary identity is `(workflow_id, scheduled_for)`. `community_id` is
/// resolved from the workflow row inside the claim SQL and returned for scoped
/// audit/logging; callers never supply it as a claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledWorkflowFireClaim {
    /// Community that owns this scheduled fire.
    pub community_id: CommunityId,
    /// Workflow definition that should run.
    pub workflow_id: Uuid,
    /// Authoritative schedule instant this claim represents.
    pub scheduled_for: DateTime<Utc>,
    /// Database timestamp for when this pod won the claim.
    pub claimed_at: DateTime<Utc>,
}

/// A pending or resolved approval gate for a workflow step.
#[derive(Debug, Clone)]
pub struct ApprovalRecord {
    /// Token hash as stored in the DB (BYTEA).
    pub token: Vec<u8>,
    /// The workflow this approval belongs to.
    pub workflow_id: Uuid,
    /// The run waiting on this approval.
    pub run_id: Uuid,
    /// The step ID that requested approval.
    pub step_id: String,
    /// Zero-based index of the step in the workflow.
    pub step_index: i32,
    /// Who may approve (user mention or role spec).
    pub approver_spec: String,
    /// Current status of this approval request.
    pub status: ApprovalStatus,
    /// Compressed public key bytes of the user who acted on this approval.
    pub approver_pubkey: Option<Vec<u8>>,
    /// Optional note left by the approver.
    pub note: Option<String>,
    /// When this approval request expires.
    pub expires_at: DateTime<Utc>,
    /// When the approval record was created.
    pub created_at: DateTime<Utc>,
}

// -- Workflow CRUD ------------------------------------------------------------

/// Insert a new workflow record. Returns the new workflow's UUID.
/// New workflows start as `active` and `enabled = TRUE`.
///
/// NOTE: see the cache-invalidation note on [`update_workflow`]. The relay's
/// creation path is [`upsert_workflow`] via event ingest. (No current callers.)
pub async fn create_workflow(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Option<Uuid>,
    owner_pubkey: &[u8],
    name: &str,
    definition_json: &str,
    definition_hash: &[u8],
) -> Result<Uuid> {
    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO workflows
            (id, community_id, name, owner_pubkey, channel_id, definition, definition_hash, status, enabled)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'active', TRUE)
        "#,
    )
    .bind(id)
    .bind(community_id.as_uuid())
    .bind(name)
    .bind(owner_pubkey)
    .bind(channel_id)
    .bind(definition_json)
    .bind(definition_hash)
    .execute(pool)
    .await?;

    Ok(id)
}

/// Insert or update a workflow at the caller-supplied NIP-33 `d`-tag UUID.
///
/// Updates are allowed only when the existing row has the same owner and
/// channel. That keeps a learned workflow UUID from becoming a cross-user or
/// cross-channel overwrite primitive while still making retries idempotent.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_workflow(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    channel_id: Option<Uuid>,
    owner_pubkey: &[u8],
    name: &str,
    definition_json: &str,
    definition_hash: &[u8],
) -> Result<()> {
    let row = sqlx::query(
        r#"
        INSERT INTO workflows
            (community_id, id, name, owner_pubkey, channel_id, definition, definition_hash, status, enabled)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'active', TRUE)
        ON CONFLICT (community_id, id) DO UPDATE
        SET name = EXCLUDED.name,
            definition = EXCLUDED.definition,
            definition_hash = EXCLUDED.definition_hash,
            updated_at = NOW()
        WHERE workflows.owner_pubkey = EXCLUDED.owner_pubkey
          AND workflows.channel_id IS NOT DISTINCT FROM EXCLUDED.channel_id
        RETURNING id
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .bind(name)
    .bind(owner_pubkey)
    .bind(channel_id)
    .bind(definition_json)
    .bind(definition_hash)
    .fetch_optional(pool)
    .await?;

    if row.is_none() {
        return Err(DbError::AccessDenied(format!(
            "workflow {id} belongs to a different owner or channel"
        )));
    }

    Ok(())
}

/// Fetch a single workflow by ID, scoped to its community.
///
/// `workflows` is keyed `(community_id, id)`; the same workflow UUID can exist
/// in two communities, so a request-scoped lookup must bind both. The caller
/// supplies the server-resolved community (host-bound tenant for request paths,
/// the run's own community for execution paths) — never a client-supplied id.
pub async fn get_workflow(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
) -> Result<WorkflowRecord> {
    let row = sqlx::query(
        r#"
        SELECT id, community_id, name, owner_pubkey, channel_id, definition, definition_hash,
               status::text AS status, enabled, created_at, updated_at
        FROM workflows
        WHERE community_id = $1 AND id = $2
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("workflow {id}")))?;

    row_to_workflow_record(row)
}

/// List workflows for a channel, ordered newest first.
///
/// `limit` is capped at [`LIST_MAX_LIMIT`]. Pass `None` to use [`LIST_DEFAULT_LIMIT`].
/// `offset` enables pagination (0-based row offset).
pub async fn list_channel_workflows(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<WorkflowRecord>> {
    let limit = limit.unwrap_or(LIST_DEFAULT_LIMIT).clamp(1, LIST_MAX_LIMIT);
    let offset = offset.unwrap_or(0).max(0);

    let rows = sqlx::query(
        r#"
        SELECT id, community_id, name, owner_pubkey, channel_id, definition, definition_hash,
               status::text AS status, enabled, created_at, updated_at
        FROM workflows
        WHERE community_id = $1 AND channel_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_workflow_record).collect()
}

/// List active, enabled workflows for a channel.
/// Used by the trigger-matching path to find workflows that should fire.
/// Only returns workflows with status = 'active' AND enabled = TRUE.
///
/// Bounded to [`LIST_MAX_LIMIT`] rows -- the trigger path should not process
/// an unbounded number of workflows per event.
pub async fn list_enabled_channel_workflows(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
) -> Result<Vec<WorkflowRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT id, community_id, name, owner_pubkey, channel_id, definition, definition_hash,
               status::text AS status, enabled, created_at, updated_at
        FROM workflows
        WHERE community_id = $1
          AND channel_id = $2
          AND status = 'active'
          AND enabled = TRUE
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(LIST_MAX_LIMIT)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_workflow_record).collect()
}

/// List all active, enabled workflows with a `schedule` trigger across all channels.
///
/// Used by the cron scheduler. Filters by trigger type in SQL to avoid loading
/// event-triggered workflows that the cron loop would immediately discard.
/// Results are bounded to [`LIST_MAX_LIMIT`] rows.
pub async fn list_all_enabled_workflows(pool: &PgPool) -> Result<Vec<WorkflowRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT w.id, w.community_id, w.name, w.owner_pubkey, w.channel_id, w.definition, w.definition_hash,
               w.status::text AS status, w.enabled, w.created_at, w.updated_at
        FROM workflows w
        JOIN communities c ON c.id = w.community_id
        WHERE w.status = 'active'
          AND w.enabled = TRUE
          AND w.definition->'trigger'->>'on' = 'schedule'
          AND c.archived_at IS NULL
        ORDER BY w.created_at ASC
        LIMIT $1
        "#,
    )
    .bind(LIST_MAX_LIMIT)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_workflow_record).collect()
}

/// Claim a scheduled workflow fire for an authoritative schedule instant.
///
/// Returns `Some` only for the first pod that claims `(community_id,
/// workflow_id, scheduled_for)`. All other pods receive `None` and must skip
/// creating a workflow run. The `scheduled_for` value must come from an
/// external schedule anchor (cron expression) or DB-authoritative interval
/// anchor; a per-pod in-memory timestamp is not safe because different pods
/// can compute different claim keys.
///
/// `community_id` is server provenance — for the global scheduler scan it is
/// the `workflow.community_id` returned by [`list_all_enabled_workflows`], not
/// any client-supplied value. It is required because `workflows` is keyed
/// `(community_id, id)`: duplicate workflow UUIDs across communities are
/// allowed, so resolving the owning community from `id` alone is ambiguous and
/// would fan a single claim across every community holding that UUID. Binding
/// `(community_id, id)` confines the claim — and its `SELECT`/`INSERT` row — to
/// exactly the intended tenant.
pub async fn claim_scheduled_workflow_fire(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    scheduled_for: DateTime<Utc>,
) -> Result<Option<ScheduledWorkflowFireClaim>> {
    let row = sqlx::query(
        r#"
        INSERT INTO scheduled_workflow_fires (community_id, workflow_id, scheduled_for)
        SELECT w.community_id, w.id, $3
        FROM workflows w
        WHERE w.community_id = $1 AND w.id = $2
        ON CONFLICT (community_id, workflow_id, scheduled_for) DO NOTHING
        RETURNING community_id, workflow_id, scheduled_for, claimed_at
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(workflow_id)
    .bind(scheduled_for)
    .fetch_optional(pool)
    .await?;

    row.map(|row| {
        let community_id: Uuid = row.try_get("community_id")?;
        Ok(ScheduledWorkflowFireClaim {
            community_id: CommunityId::from_uuid(community_id),
            workflow_id: row.try_get("workflow_id")?,
            scheduled_for: row.try_get("scheduled_for")?,
            claimed_at: row.try_get("claimed_at")?,
        })
    })
    .transpose()
}

/// Fetch the greatest claimed schedule instant for a workflow.
///
/// Interval schedulers use this as their DB-authoritative `last_fired` anchor.
/// It makes all pods compute the same next interval instant after a successful
/// claim, and preserves the interval clock across pod restarts. This intentionally
/// reads from `scheduled_workflow_fires`, not `workflow_runs`, because the claim
/// row is the source of truth for schedule deduplication.
pub async fn latest_scheduled_workflow_fire(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
) -> Result<Option<DateTime<Utc>>> {
    let row = sqlx::query(
        r#"
        SELECT MAX(scheduled_for) AS scheduled_for
        FROM scheduled_workflow_fires
        WHERE community_id = $1 AND workflow_id = $2
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(workflow_id)
    .fetch_one(pool)
    .await?;

    row.try_get("scheduled_for").map_err(Into::into)
}

/// Link a won scheduled-fire claim to the workflow run it created.
///
/// This is for ops/audit forensics only; the claim row remains the dedupe
/// boundary. If run creation succeeds, callers should attach the run id before
/// spawning execution. If run creation fails, leaving `workflow_run_id` NULL is
/// intentional: the schedule instant was claimed and must not duplicate later.
pub async fn attach_scheduled_workflow_run(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    scheduled_for: DateTime<Utc>,
    workflow_run_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE scheduled_workflow_fires
        SET workflow_run_id = $4
        WHERE community_id = $1
          AND workflow_id = $2
          AND scheduled_for = $3
          AND workflow_run_id IS NULL
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(workflow_id)
    .bind(scheduled_for)
    .bind(workflow_run_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

/// Delete old scheduled workflow fire claims for retention.
///
/// Schedule claim rows are correctness metadata, but they grow with every fire.
/// The relay/ops janitor should retain enough history for audits and interval
/// anchoring: the cutoff must be older than the largest interval schedule the
/// deployment supports, or interval workflows can lose their DB-authoritative
/// anchor after pruning.
pub async fn prune_scheduled_workflow_fires_before(
    pool: &PgPool,
    older_than: DateTime<Utc>,
) -> Result<u64> {
    let result = sqlx::query(
        r#"
        DELETE FROM scheduled_workflow_fires
        WHERE claimed_at < $1
          AND community_write_allowed(community_id)
        "#,
    )
    .bind(older_than)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

/// Update a workflow's name, definition, and definition_hash.
///
/// NOTE: the relay's `WorkflowEngine` caches enabled workflows per
/// `(community_id, channel_id)`; a caller mutating trigger behavior must
/// invalidate via `WorkflowEngine::invalidate_channel_workflows` or trigger
/// matching lags the change by up to the cache TTL. (No current callers.)
pub async fn update_workflow(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    name: &str,
    definition_json: &str,
    definition_hash: &[u8],
) -> Result<()> {
    let affected = sqlx::query(
        r#"
        UPDATE workflows
        SET name = $1, definition = $2::jsonb, definition_hash = $3
        WHERE community_id = $4 AND id = $5
        "#,
    )
    .bind(name)
    .bind(definition_json)
    .bind(definition_hash)
    .bind(community_id.as_uuid())
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow {id}")));
    }
    Ok(())
}

/// Update a workflow's status (active -> disabled -> archived).
///
/// NOTE: status gates trigger eligibility; see the cache-invalidation note on
/// [`update_workflow`]. (No current callers.)
pub async fn update_workflow_status(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    status: WorkflowStatus,
) -> Result<()> {
    let affected = sqlx::query(
        r#"
        UPDATE workflows
        SET status = $1::workflow_status
        WHERE community_id = $2 AND id = $3
        "#,
    )
    .bind(status.to_string())
    .bind(community_id.as_uuid())
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow {id}")));
    }
    Ok(())
}

/// Enable or disable a workflow without changing its status.
///
/// NOTE: `enabled` gates trigger eligibility; see the cache-invalidation note
/// on [`update_workflow`]. (No current callers.)
pub async fn set_workflow_enabled(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    enabled: bool,
) -> Result<()> {
    let affected = sqlx::query(
        r#"
        UPDATE workflows
        SET enabled = $1
        WHERE community_id = $2 AND id = $3
        "#,
    )
    .bind(enabled)
    .bind(community_id.as_uuid())
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow {id}")));
    }
    Ok(())
}

/// Update a workflow's paused lifecycle state and trigger eligibility together.
pub async fn set_workflow_lifecycle(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    status: WorkflowStatus,
    enabled: bool,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    set_workflow_lifecycle_in_transaction(&mut tx, community_id, id, status, enabled).await?;
    tx.commit().await?;
    Ok(())
}

/// Update a workflow's paused lifecycle in the transaction that stores its
/// signed status command.
pub async fn set_workflow_lifecycle_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    id: Uuid,
    status: WorkflowStatus,
    enabled: bool,
) -> Result<()> {
    let affected = sqlx::query(
        r#"
        UPDATE workflows
        SET status = $1::workflow_status,
            enabled = $2,
            updated_at = NOW()
        WHERE community_id = $3 AND id = $4
        "#,
    )
    .bind(status.to_string())
    .bind(enabled)
    .bind(community_id.as_uuid())
    .bind(id)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow {id}")));
    }
    Ok(())
}

/// Disable all of `owner_pubkey`'s workflows in a channel (SEC-006).
///
/// Called when the owner loses channel membership (kind 9001 removal or kind
/// 9022 leave) so their workflows stop firing durably — across pods and
/// restarts — rather than only until the per-fire authority gate happens to
/// run. Idempotent; returns the number of workflows disabled so the caller
/// can decide whether a trigger-cache invalidation is needed.
pub async fn disable_workflows_for_owner_in_channel(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
    owner_pubkey: &[u8],
) -> Result<u64> {
    let affected = sqlx::query(
        r#"
        UPDATE workflows
        SET enabled = FALSE
        WHERE community_id = $1 AND channel_id = $2 AND owner_pubkey = $3 AND enabled = TRUE
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(owner_pubkey)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(affected)
}

/// Delete a workflow and all its runs/approvals (CASCADE).
///
/// NOTE: see the cache-invalidation note on [`update_workflow`]. The relay's
/// deletion path uses [`delete_workflow_for_owner`], which returns the
/// `channel_id` needed for invalidation. (No current callers.)
pub async fn delete_workflow(pool: &PgPool, community_id: CommunityId, id: Uuid) -> Result<()> {
    let affected = sqlx::query("DELETE FROM workflows WHERE community_id = $1 AND id = $2")
        .bind(community_id.as_uuid())
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow {id}")));
    }
    Ok(())
}

/// Delete a workflow only when it belongs to `owner_pubkey`.
///
/// Used by event-driven deletion paths where the workflow UUID is attacker
/// controlled. Keeping the owner predicate in the DELETE statement avoids a
/// check-then-delete race and ensures a caller cannot delete another user's
/// workflow just by learning its UUID.
///
/// Returns the deleted workflow's `channel_id` so the caller can invalidate
/// the per-channel trigger cache without a separate lookup.
pub async fn delete_workflow_for_owner(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    owner_pubkey: &[u8],
) -> Result<Option<Uuid>> {
    let row = sqlx::query(
        "DELETE FROM workflows WHERE community_id = $1 AND id = $2 AND owner_pubkey = $3 \
         RETURNING channel_id",
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .bind(owner_pubkey)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => Ok(row.try_get("channel_id")?),
        None => Err(DbError::NotFound(format!("workflow {id}"))),
    }
}

// -- Workflow Run CRUD --------------------------------------------------------

/// Insert a new workflow run. Returns the new run's UUID.
///
/// `trigger_context` is the serialized `TriggerContext` for this run. It is stored
/// so that post-approval resume steps can restore the original trigger data and
/// correctly resolve `{{trigger.*}}` template variables.
pub async fn create_workflow_run(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    trigger_event_id: Option<&[u8]>,
    trigger_context: Option<&serde_json::Value>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (community_id, id, workflow_id, status, trigger_event_id, current_step, execution_trace, trigger_context)
        VALUES ($1, $2, $3, 'pending', $4, 0, '[]', $5)
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .bind(workflow_id)
    .bind(trigger_event_id)
    .bind(trigger_context)
    .execute(pool)
    .await?;

    Ok(id)
}

/// Insert a workflow run pinned to the exact active definition snapshot.
pub async fn create_workflow_run_versioned(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    trigger_event_id: Option<&[u8]>,
    trigger_context: Option<&serde_json::Value>,
    definition_version: &[u8],
    definition_snapshot: &serde_json::Value,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    if definition_version.len() != 32 {
        return Err(DbError::InvalidData(
            "workflow definition version must be 32 bytes".to_string(),
        ));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (community_id, id, workflow_id, workflow_channel_id, status, trigger_event_id,
             current_step, execution_trace, trigger_context, definition_version, definition_snapshot)
        SELECT $1, $2, $3, w.channel_id, 'pending', $4, 0, '[]', $5, $6, $7
        FROM workflows w
        WHERE w.community_id = $1 AND w.id = $3 AND w.status = 'active' AND w.enabled = TRUE
          AND w.definition_hash = $6 AND w.definition = $7
        RETURNING id
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .bind(workflow_id)
    .bind(trigger_event_id)
    .bind(trigger_context)
    .bind(definition_version)
    .bind(definition_snapshot)
    .fetch_optional(pool)
    .await?;

    row.map(|row| row.get("id")).ok_or_else(|| {
        DbError::NotFound(format!(
            "active workflow {workflow_id} at requested definition version"
        ))
    })
}

/// Fetch a single workflow run by ID, scoped to its community.
pub async fn get_workflow_run(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
) -> Result<WorkflowRunRecord> {
    let row = sqlx::query(
        r#"
        SELECT community_id, id, workflow_id, workflow_channel_id, status::text AS status,
               trigger_event_id, current_step,
               execution_trace, trigger_context, definition_version, definition_snapshot,
               started_at, completed_at, error_message, error_code, created_at
        FROM workflow_runs
        WHERE community_id = $1 AND id = $2
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("workflow_run {id}")))?;

    row_to_run_record(row)
}

/// List runs for a workflow using a stable newest-first keyset.
///
/// Rows are ordered by `(created_at DESC, id DESC)`. A cursor is valid only
/// when both `before` and `before_id` are supplied; callers should pass the
/// final row from the previous page. `limit` is clamped to the shared list
/// bounds.
pub async fn list_workflow_runs_page(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    before: Option<DateTime<Utc>>,
    before_id: Option<Uuid>,
    limit: i64,
) -> Result<Vec<WorkflowRunRecord>> {
    let limit = limit.clamp(1, LIST_MAX_LIMIT);
    let rows = sqlx::query(
        r#"
        SELECT community_id, id, workflow_id, workflow_channel_id, status::text AS status,
               trigger_event_id, current_step,
               execution_trace, trigger_context, definition_version, definition_snapshot,
               started_at, completed_at, error_message, error_code, created_at
        FROM workflow_runs
        WHERE community_id = $1 AND workflow_id = $2
          AND (
              $3::timestamptz IS NULL
              OR $4::uuid IS NULL
              OR (created_at, id) < ($3, $4)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $5
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(workflow_id)
    .bind(before)
    .bind(before_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_run_record).collect()
}

/// List runs for a workflow, newest first, up to `limit` rows.
pub async fn list_workflow_runs(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    limit: i64,
) -> Result<Vec<WorkflowRunRecord>> {
    list_workflow_runs_page(pool, community_id, workflow_id, None, None, limit).await
}

/// Structured failure persisted for a workflow run.
#[derive(Debug, Clone, Copy)]
pub struct WorkflowRunFailure<'a> {
    /// Stable machine-readable failure code.
    pub code: &'a str,
    /// Human-readable failure detail.
    pub message: &'a str,
}

/// Update run status, current step, execution trace, and optional failure.
///
/// Fix C3: `started_at` is set when the NEW status is 'running' and `started_at`
/// has not yet been stamped (IS NULL). The original code read `status` from the
/// column AFTER `SET status = ?` had already changed it, so the condition was
/// always false. We now check the bind parameter directly.
pub async fn update_workflow_run(
    pool: &PgPool,
    community_id: CommunityId,
    id: Uuid,
    status: RunStatus,
    current_step: i32,
    trace: &serde_json::Value,
    failure: Option<WorkflowRunFailure<'_>>,
) -> Result<()> {
    let status_str = status.to_string();
    let (error_code, error) = failure
        .map(|failure| (Some(failure.code), Some(failure.message)))
        .unwrap_or((None, None));
    let affected = sqlx::query(
        r#"
        UPDATE workflow_runs
        SET status        = $1::run_status,
            current_step  = $2,
            execution_trace = $3,
            error_code    = $4,
            error_message = $5,
            started_at    = CASE WHEN $6 = 'running' AND started_at IS NULL
                                 THEN NOW() ELSE started_at END,
            completed_at  = CASE WHEN $7 IN ('completed','failed','cancelled','timed_out')
                                 THEN NOW() ELSE completed_at END
        WHERE community_id = $8 AND id = $9
        "#,
    )
    .bind(&status_str)
    .bind(current_step)
    .bind(trace)
    .bind(error_code)
    .bind(error)
    .bind(&status_str) // for started_at CASE
    .bind(&status_str) // for completed_at CASE
    .bind(community_id.as_uuid())
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("workflow_run {id}")));
    }
    Ok(())
}

// -- Approval CRUD ------------------------------------------------------------

/// Parameters for creating a new approval request.
pub struct CreateApprovalParams<'a> {
    /// Server-resolved community that owns the workflow/run this approval gates.
    pub community_id: CommunityId,
    /// Raw approval token (will be hashed before storage).
    pub token: &'a str,
    /// The workflow this approval belongs to.
    pub workflow_id: Uuid,
    /// The run waiting on this approval.
    pub run_id: Uuid,
    /// The step ID that requested approval.
    pub step_id: &'a str,
    /// Zero-based index of the step in the workflow.
    pub step_index: i32,
    /// Who may approve (user mention or role spec).
    pub approver_spec: &'a str,
    /// When this approval request expires.
    pub expires_at: DateTime<Utc>,
}

/// Insert a new approval request.
///
/// The `token` parameter is the raw (plaintext) token. It is hashed with
/// SHA-256 before storage so the DB never holds the raw value.
pub async fn create_approval(pool: &PgPool, params: CreateApprovalParams<'_>) -> Result<()> {
    let CreateApprovalParams {
        community_id,
        token,
        workflow_id,
        run_id,
        step_id,
        step_index,
        approver_spec,
        expires_at,
    } = params;
    let token_hash = hash_approval_token(token);

    sqlx::query(
        r#"
        INSERT INTO workflow_approvals
            (community_id, token, workflow_id, run_id, step_id, step_index, approver_spec, status, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(token_hash)
    .bind(workflow_id)
    .bind(run_id)
    .bind(step_id)
    .bind(step_index)
    .bind(approver_spec)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Create an approval record and suspend its workflow run atomically.
pub async fn create_approval_and_suspend_run(
    pool: &PgPool,
    params: CreateApprovalParams<'_>,
    prior_trace: &serde_json::Value,
    trace_entry: &serde_json::Value,
    request_event: &nostr::Event,
    channel_id: Uuid,
) -> Result<(buzz_core::StoredEvent, bool)> {
    let mut tx = pool.begin().await?;
    let token_hash = hash_approval_token(params.token);
    sqlx::query(
        r#"
        INSERT INTO workflow_approvals
            (community_id, token, workflow_id, run_id, step_id, step_index, approver_spec, status, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
        "#,
    )
    .bind(params.community_id.as_uuid())
    .bind(token_hash)
    .bind(params.workflow_id)
    .bind(params.run_id)
    .bind(params.step_id)
    .bind(params.step_index)
    .bind(params.approver_spec)
    .bind(params.expires_at)
    .execute(&mut *tx)
    .await?;

    let affected = sqlx::query(
        r#"
        UPDATE workflow_runs
        SET status = 'waiting_approval', current_step = $1,
            execution_trace = $2::jsonb || jsonb_build_array($3::jsonb)
        WHERE community_id = $4 AND id = $5 AND workflow_id = $6 AND status = 'running'
        "#,
    )
    .bind(params.step_index)
    .bind(prior_trace)
    .bind(trace_entry)
    .bind(params.community_id.as_uuid())
    .bind(params.run_id)
    .bind(params.workflow_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(DbError::NotFound(format!(
            "running workflow run {}",
            params.run_id
        )));
    }
    let (stored_event, was_inserted) = crate::event::insert_event_in_transaction(
        &mut tx,
        params.community_id,
        request_event,
        Some(channel_id),
    )
    .await?;
    if was_inserted {
        crate::insert_mentions_in_transaction(
            &mut tx,
            params.community_id,
            request_event,
            Some(channel_id),
        )
        .await?;
    }
    tx.commit().await?;
    Ok((stored_event, was_inserted))
}

/// Fetch an approval record by raw token.
///
/// The token is hashed before the DB lookup so plaintext tokens are never
/// sent to the database layer.
pub async fn get_approval(
    pool: &PgPool,
    community_id: CommunityId,
    token: &str,
) -> Result<ApprovalRecord> {
    let token_hash = hash_approval_token(token);
    get_approval_by_stored_hash(pool, community_id, &token_hash).await
}

/// Fetch an approval record by its already-hashed token value.
///
/// Use this when you already have the hash stored in the DB (e.g., from
/// `get_run_approvals`). The `token_hash` is used directly without re-hashing.
///
/// `workflow_approvals` is keyed `(community_id, token)`; the same token bytes
/// could in principle collide across communities, so the lookup binds the
/// server-resolved community alongside the token.
pub async fn get_approval_by_stored_hash(
    pool: &PgPool,
    community_id: CommunityId,
    token_hash: &[u8],
) -> Result<ApprovalRecord> {
    let row = sqlx::query(
        r#"
        SELECT token, workflow_id, run_id, step_id, step_index, approver_spec,
               status::text AS status, approver_pubkey, note, expires_at, created_at
        FROM workflow_approvals
        WHERE community_id = $1 AND token = $2
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(token_hash)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound("approval token (hashed)".to_string()))?;

    row_to_approval_record(row)
}

/// Fetch all approval records for a given workflow run.
pub async fn get_run_approvals(
    pool: &PgPool,
    community_id: CommunityId,
    workflow_id: Uuid,
    run_id: Uuid,
) -> Result<Vec<ApprovalRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT token, workflow_id, run_id, step_id, step_index, approver_spec,
               status::text AS status, approver_pubkey, note, expires_at, created_at
        FROM workflow_approvals
        WHERE community_id = $1 AND run_id = $2 AND workflow_id = $3
        ORDER BY step_index, created_at
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(run_id)
    .bind(workflow_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_approval_record).collect()
}

/// Update an approval's status, approver pubkey, and optional note.
/// Also stamps `granted_at` or `denied_at` based on the new status.
///
/// The `token` parameter is the raw (plaintext) token; it is hashed before
/// the WHERE lookup.
///
/// # TOCTOU safety (N5)
/// The WHERE clause includes `AND status = 'pending'` so that two concurrent
/// grant/deny requests cannot both succeed. If the approval was already acted
/// on (status != 'pending'), the UPDATE touches 0 rows and this function
/// returns `Ok(false)`. Callers should treat `false` as a conflict (HTTP 409).
pub async fn update_approval(
    pool: &PgPool,
    community_id: CommunityId,
    token: &str,
    status: ApprovalStatus,
    approver_pubkey: Option<&[u8]>,
    note: Option<&str>,
) -> Result<bool> {
    let token_hash = hash_approval_token(token);
    update_approval_by_stored_hash(
        pool,
        community_id,
        &token_hash,
        status,
        approver_pubkey,
        note,
    )
    .await
}

/// Update an approval by its already-hashed token value.
///
/// Use this when you already have the hash stored in the DB (e.g., from
/// `get_run_approvals`). The `token_hash` is used directly without re-hashing.
///
/// See [`update_approval`] for TOCTOU safety notes. The predicate binds the
/// server-resolved community alongside the token so an approval action for A/X
/// can never act on B/X.
pub async fn update_approval_by_stored_hash(
    pool: &PgPool,
    community_id: CommunityId,
    token_hash: &[u8],
    status: ApprovalStatus,
    approver_pubkey: Option<&[u8]>,
    note: Option<&str>,
) -> Result<bool> {
    let status_str = status.to_string();
    let affected = sqlx::query(
        r#"
        UPDATE workflow_approvals
        SET status          = $1::approval_status,
            approver_pubkey = $2,
            note            = $3,
            granted_at      = CASE WHEN $4 = 'granted' THEN NOW() ELSE granted_at END,
            denied_at       = CASE WHEN $5 = 'denied'  THEN NOW() ELSE denied_at  END
        WHERE community_id = $6 AND token = $7 AND status = 'pending'
        "#,
    )
    .bind(&status_str)
    .bind(approver_pubkey)
    .bind(note)
    .bind(&status_str) // for granted_at CASE
    .bind(&status_str) // for denied_at CASE
    .bind(community_id.as_uuid())
    .bind(token_hash)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(affected > 0)
}

/// Persist an agent wait and suspend its run before publishing the request
/// event. A fast reply therefore always finds its durable wait record.
pub async fn create_workflow_agent_wait(
    pool: &PgPool,
    params: CreateWorkflowAgentWaitParams<'_>,
) -> Result<(buzz_core::StoredEvent, bool)> {
    if params.agent_pubkey.len() != 32 || params.request_event_id.len() != 32 {
        return Err(DbError::InvalidData(
            "agent wait pubkey and request id must be 32 bytes".to_string(),
        ));
    }
    if params.request_event.id.as_bytes() != params.request_event_id {
        return Err(DbError::InvalidData(
            "agent wait request id does not match its signed event".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO workflow_agent_waits
            (community_id, workflow_id, run_id, step_id, step_index, channel_id,
             agent_pubkey, request_event_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(params.community_id.as_uuid())
    .bind(params.workflow_id)
    .bind(params.run_id)
    .bind(params.step_id)
    .bind(params.step_index)
    .bind(params.channel_id)
    .bind(params.agent_pubkey)
    .bind(params.request_event_id)
    .bind(params.expires_at)
    .execute(&mut *tx)
    .await?;

    let affected = sqlx::query(
        r#"
        UPDATE workflow_runs
        SET status = 'waiting_agent',
            current_step = $1,
            execution_trace = $2::jsonb || jsonb_build_array($3::jsonb)
        WHERE community_id = $4 AND id = $5 AND workflow_id = $6 AND status = 'running'
        "#,
    )
    .bind(params.step_index)
    .bind(params.prior_trace)
    .bind(params.trace_entry)
    .bind(params.community_id.as_uuid())
    .bind(params.run_id)
    .bind(params.workflow_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!(
            "running workflow run {}",
            params.run_id
        )));
    }

    let (stored_event, was_inserted) = crate::event::insert_event_in_transaction(
        &mut tx,
        params.community_id,
        params.request_event,
        Some(params.channel_id),
    )
    .await?;
    if was_inserted {
        crate::insert_mentions_in_transaction(
            &mut tx,
            params.community_id,
            params.request_event,
            Some(params.channel_id),
        )
        .await?;
    }

    tx.commit().await?;
    Ok((stored_event, was_inserted))
}

/// Find a pending wait by its thread root, assigned agent, and channel.
pub async fn get_pending_workflow_agent_wait(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
    request_event_id: &[u8],
    agent_pubkey: &[u8],
) -> Result<Option<WorkflowAgentWaitRecord>> {
    let row = sqlx::query(
        r#"
        SELECT community_id, workflow_id, run_id, step_id, step_index, channel_id,
               agent_pubkey, request_event_id, status::text AS status,
               reply_event_id, expires_at
        FROM workflow_agent_waits
        WHERE community_id = $1 AND channel_id = $2 AND request_event_id = $3
          AND agent_pubkey = $4 AND status = 'pending'
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(request_event_id)
    .bind(agent_pubkey)
    .fetch_optional(pool)
    .await?;

    row.map(row_to_workflow_agent_wait).transpose()
}

/// Atomically claim an agent reply, record it in the trace, and resume the run.
pub async fn complete_workflow_agent_wait(
    pool: &PgPool,
    params: CompleteWorkflowAgentWaitParams<'_>,
) -> Result<Option<WorkflowRunRecord>> {
    let CompleteWorkflowAgentWaitParams {
        community_id,
        channel_id,
        request_event_id,
        agent_pubkey,
        reply_event_id,
        reply_text,
        now,
    } = params;
    if request_event_id.len() != 32 || agent_pubkey.len() != 32 || reply_event_id.len() != 32 {
        return Err(DbError::InvalidData(
            "agent wait event ids and pubkey must be 32 bytes".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;
    let wait_row = sqlx::query(
        r#"
        SELECT community_id, workflow_id, run_id, step_id, step_index, channel_id,
               agent_pubkey, request_event_id, status::text AS status,
               reply_event_id, expires_at
        FROM workflow_agent_waits
        WHERE community_id = $1 AND channel_id = $2 AND request_event_id = $3
          AND agent_pubkey = $4 AND status = 'pending'
        FOR UPDATE
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(request_event_id)
    .bind(agent_pubkey)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(wait_row) = wait_row else {
        tx.rollback().await?;
        return Ok(None);
    };
    let wait = row_to_workflow_agent_wait(wait_row)?;
    if wait.expires_at <= now {
        tx.rollback().await?;
        return Ok(None);
    }

    let run_row = sqlx::query(
        "SELECT status::text AS status, execution_trace FROM workflow_runs \
         WHERE community_id = $1 AND id = $2 AND workflow_id = $3 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(wait.run_id)
    .bind(wait.workflow_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(run_row) = run_row else {
        tx.rollback().await?;
        return Ok(None);
    };
    let run_status: String = run_row.try_get("status")?;
    if run_status != "waiting_agent" {
        tx.rollback().await?;
        return Ok(None);
    }

    let mut trace: serde_json::Value = run_row.try_get("execution_trace")?;
    let reply_text: String = reply_text.chars().take(16_384).collect();
    let output = serde_json::json!({
        "agent_pubkey": hex::encode(agent_pubkey),
        "request_event_id": hex::encode(request_event_id),
        "reply_event_id": hex::encode(reply_event_id),
        "reply_text": reply_text,
    });
    replace_wait_trace_entry(&mut trace, &wait.step_id, "completed", output);

    let changed = sqlx::query(
        r#"
        UPDATE workflow_agent_waits
        SET status = 'completed', reply_event_id = $1, updated_at = $2
        WHERE community_id = $3 AND run_id = $4 AND step_id = $5 AND status = 'pending'
        "#,
    )
    .bind(reply_event_id)
    .bind(now)
    .bind(community_id.as_uuid())
    .bind(wait.run_id)
    .bind(&wait.step_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed == 0 {
        tx.rollback().await?;
        return Ok(None);
    }

    sqlx::query(
        r#"
        UPDATE workflow_runs
        SET status = 'running', current_step = $1, execution_trace = $2,
            error_code = NULL, error_message = NULL
        WHERE community_id = $3 AND id = $4 AND status = 'waiting_agent'
        "#,
    )
    .bind(wait.step_index + 1)
    .bind(&trace)
    .bind(community_id.as_uuid())
    .bind(wait.run_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    get_workflow_run(pool, community_id, wait.run_id)
        .await
        .map(Some)
}

/// Mark an agent wait failed when its request could not be published.
pub async fn fail_workflow_agent_wait(
    pool: &PgPool,
    community_id: CommunityId,
    run_id: Uuid,
    step_id: &str,
    error_message: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT execution_trace FROM workflow_runs WHERE community_id = $1 AND id = $2 \
         AND status = 'waiting_agent' FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(run_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(());
    };
    let mut trace: serde_json::Value = row.try_get("execution_trace")?;
    replace_wait_trace_entry(
        &mut trace,
        step_id,
        "failed",
        serde_json::json!({ "error": error_message.chars().take(1024).collect::<String>() }),
    );
    sqlx::query(
        "UPDATE workflow_agent_waits SET status = 'failed', updated_at = NOW() \
         WHERE community_id = $1 AND run_id = $2 AND step_id = $3 AND status = 'pending'",
    )
    .bind(community_id.as_uuid())
    .bind(run_id)
    .bind(step_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE workflow_runs SET status = 'failed', execution_trace = $1, \
         error_code = 'agent_request_publish_failed', error_message = $2, completed_at = NOW() \
         WHERE community_id = $3 AND id = $4 AND status = 'waiting_agent'",
    )
    .bind(&trace)
    .bind(error_message.chars().take(1024).collect::<String>())
    .bind(community_id.as_uuid())
    .bind(run_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Mark due agent waits and their runs timed out. One scheduler tick processes
/// at most `limit` rows so a backlog cannot turn into an unbounded loop.
pub async fn expire_workflow_agent_waits(
    pool: &PgPool,
    now: DateTime<Utc>,
    limit: i64,
) -> Result<u64> {
    let limit = limit.clamp(1, 100);
    let mut tx = pool.begin().await?;
    let rows = sqlx::query(
        r#"
        SELECT w.community_id, w.workflow_id, w.run_id, w.step_id, w.step_index,
               w.channel_id, w.agent_pubkey, w.request_event_id,
               w.status::text AS status, w.reply_event_id, w.expires_at
        FROM workflow_agent_waits w
        JOIN workflow_runs r
          ON r.community_id = w.community_id AND r.id = w.run_id
        WHERE w.status = 'pending' AND w.expires_at <= $1 AND r.status = 'waiting_agent'
        ORDER BY w.expires_at, w.run_id, w.step_id
        LIMIT $2
        FOR UPDATE OF w SKIP LOCKED
        "#,
    )
    .bind(now)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;

    let mut expired = 0_u64;
    for row in rows {
        let wait = row_to_workflow_agent_wait(row)?;
        let run_row = sqlx::query(
            "SELECT execution_trace FROM workflow_runs WHERE community_id = $1 AND id = $2 \
             AND status = 'waiting_agent' FOR UPDATE",
        )
        .bind(wait.community_id.as_uuid())
        .bind(wait.run_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(run_row) = run_row else {
            continue;
        };
        let mut trace: serde_json::Value = run_row.try_get("execution_trace")?;
        replace_wait_trace_entry(
            &mut trace,
            &wait.step_id,
            "timed_out",
            serde_json::json!({
                "agent_pubkey": hex::encode(&wait.agent_pubkey),
                "request_event_id": hex::encode(&wait.request_event_id),
            }),
        );
        sqlx::query(
            r#"
            UPDATE workflow_agent_waits
            SET status = 'timed_out', updated_at = $1
            WHERE community_id = $2 AND run_id = $3 AND step_id = $4 AND status = 'pending'
            "#,
        )
        .bind(now)
        .bind(wait.community_id.as_uuid())
        .bind(wait.run_id)
        .bind(&wait.step_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            UPDATE workflow_runs
            SET status = 'timed_out', current_step = $1, execution_trace = $2,
                error_code = 'agent_timeout',
                error_message = 'assigned agent did not reply before the deadline',
                completed_at = $3
            WHERE community_id = $4 AND id = $5 AND status = 'waiting_agent'
            "#,
        )
        .bind(wait.step_index)
        .bind(&trace)
        .bind(now)
        .bind(wait.community_id.as_uuid())
        .bind(wait.run_id)
        .execute(&mut *tx)
        .await?;
        expired += 1;
    }

    tx.commit().await?;
    Ok(expired)
}

/// Expire a bounded batch of approval waits and make their runs terminal.
pub async fn expire_workflow_approvals(
    pool: &PgPool,
    now: DateTime<Utc>,
    limit: i64,
) -> Result<u64> {
    let limit = limit.clamp(1, 100);
    let mut tx = pool.begin().await?;
    let rows = sqlx::query(
        r#"
        SELECT a.community_id, a.workflow_id, a.run_id, a.step_id, a.step_index, a.token
        FROM workflow_approvals a
        JOIN workflow_runs r
          ON r.community_id = a.community_id AND r.id = a.run_id
        WHERE a.status = 'pending' AND a.expires_at <= $1 AND r.status = 'waiting_approval'
        ORDER BY a.expires_at, a.run_id, a.step_index
        LIMIT $2
        FOR UPDATE OF a SKIP LOCKED
        "#,
    )
    .bind(now)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;

    let mut expired = 0_u64;
    for row in rows {
        let community_uuid: Uuid = row.try_get("community_id")?;
        let community_id = CommunityId::from_uuid(community_uuid);
        let workflow_id: Uuid = row.try_get("workflow_id")?;
        let run_id: Uuid = row.try_get("run_id")?;
        let step_id: String = row.try_get("step_id")?;
        let step_index: i32 = row.try_get("step_index")?;
        let token: Vec<u8> = row.try_get("token")?;
        let run_row = sqlx::query(
            "SELECT execution_trace FROM workflow_runs WHERE community_id = $1 AND id = $2 \
             AND workflow_id = $3 AND status = 'waiting_approval' FOR UPDATE",
        )
        .bind(community_uuid)
        .bind(run_id)
        .bind(workflow_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(run_row) = run_row else {
            continue;
        };
        let mut trace: serde_json::Value = run_row.try_get("execution_trace")?;
        replace_wait_trace_entry(
            &mut trace,
            &step_id,
            "timed_out",
            serde_json::json!({ "reason": "approval deadline elapsed" }),
        );
        let approval_changed = sqlx::query(
            "UPDATE workflow_approvals SET status = 'expired', note = 'approval deadline elapsed' \
             WHERE community_id = $1 AND token = $2 AND status = 'pending'",
        )
        .bind(community_uuid)
        .bind(token)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if approval_changed == 0 {
            continue;
        }
        sqlx::query(
            "UPDATE workflow_runs SET status = 'timed_out', current_step = $1, \
             execution_trace = $2, error_code = 'approval_timeout', \
             error_message = 'approver did not respond before the deadline', completed_at = $3 \
             WHERE community_id = $4 AND id = $5 AND status = 'waiting_approval'",
        )
        .bind(step_index)
        .bind(&trace)
        .bind(now)
        .bind(community_id.as_uuid())
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
        expired += 1;
    }
    tx.commit().await?;
    Ok(expired)
}

fn replace_wait_trace_entry(
    trace: &mut serde_json::Value,
    step_id: &str,
    status: &str,
    output: serde_json::Value,
) {
    if !trace.is_array() {
        *trace = serde_json::Value::Array(Vec::new());
    }
    if let Some(entries) = trace.as_array_mut() {
        if let Some(entry) = entries
            .iter_mut()
            .rev()
            .find(|entry| entry.get("step_id").and_then(serde_json::Value::as_str) == Some(step_id))
        {
            entry["status"] = serde_json::Value::String(status.to_string());
            entry["output"] = output;
        } else {
            entries.push(serde_json::json!({
                "step_id": step_id,
                "status": status,
                "output": output,
            }));
        }
    }
}

// -- Row mappers --------------------------------------------------------------

fn row_to_workflow_record(row: sqlx::postgres::PgRow) -> Result<WorkflowRecord> {
    let id: Uuid = row.try_get("id")?;
    let channel_id: Option<Uuid> = row.try_get("channel_id")?;

    let status_str: String = row.try_get("status")?;
    let status = status_str.parse::<WorkflowStatus>()?;

    let enabled: bool = row.try_get("enabled")?;

    let community_id: Uuid = row.try_get("community_id")?;

    Ok(WorkflowRecord {
        id,
        community_id: CommunityId::from_uuid(community_id),
        name: row.try_get("name")?,
        owner_pubkey: row.try_get("owner_pubkey")?,
        channel_id,
        definition: row.try_get("definition")?,
        definition_hash: row.try_get("definition_hash")?,
        status,
        enabled,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_run_record(row: sqlx::postgres::PgRow) -> Result<WorkflowRunRecord> {
    let id: Uuid = row.try_get("id")?;
    let community_id: Uuid = row.try_get("community_id")?;
    let workflow_id: Uuid = row.try_get("workflow_id")?;

    let status_str: String = row.try_get("status")?;
    let status = status_str.parse::<RunStatus>()?;

    Ok(WorkflowRunRecord {
        id,
        community_id: CommunityId::from_uuid(community_id),
        workflow_id,
        workflow_channel_id: row.try_get("workflow_channel_id")?,
        definition_version: row.try_get("definition_version")?,
        definition_snapshot: row.try_get("definition_snapshot")?,
        status,
        trigger_event_id: row.try_get("trigger_event_id")?,
        current_step: row.try_get("current_step")?,
        execution_trace: row.try_get("execution_trace")?,
        trigger_context: row.try_get("trigger_context")?,
        started_at: row.try_get("started_at")?,
        completed_at: row.try_get("completed_at")?,
        error_message: row.try_get("error_message")?,
        error_code: row.try_get("error_code")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_workflow_agent_wait(row: sqlx::postgres::PgRow) -> Result<WorkflowAgentWaitRecord> {
    let community_id: Uuid = row.try_get("community_id")?;
    let status: String = row.try_get("status")?;
    Ok(WorkflowAgentWaitRecord {
        community_id: CommunityId::from_uuid(community_id),
        workflow_id: row.try_get("workflow_id")?,
        run_id: row.try_get("run_id")?,
        step_id: row.try_get("step_id")?,
        step_index: row.try_get("step_index")?,
        channel_id: row.try_get("channel_id")?,
        agent_pubkey: row.try_get("agent_pubkey")?,
        request_event_id: row.try_get("request_event_id")?,
        status: status.parse()?,
        reply_event_id: row.try_get("reply_event_id")?,
        expires_at: row.try_get("expires_at")?,
    })
}

fn row_to_approval_record(row: sqlx::postgres::PgRow) -> Result<ApprovalRecord> {
    let workflow_id: Uuid = row.try_get("workflow_id")?;
    let run_id: Uuid = row.try_get("run_id")?;

    let status_str: String = row.try_get("status")?;
    let status = status_str.parse::<ApprovalStatus>()?;

    Ok(ApprovalRecord {
        token: row.try_get("token")?,
        workflow_id,
        run_id,
        step_id: row.try_get("step_id")?,
        step_index: row.try_get("step_index")?,
        approver_spec: row.try_get("approver_spec")?,
        status,
        approver_pubkey: row.try_get("approver_pubkey")?,
        note: row.try_get("note")?,
        expires_at: row.try_get("expires_at")?,
        created_at: row.try_get("created_at")?,
    })
}

/// Find a workflow by owner pubkey and name within a community. Returns the
/// first match (active or not).
pub async fn find_by_owner_and_name(
    pool: &PgPool,
    community_id: CommunityId,
    owner_pubkey: &[u8],
    name: &str,
) -> Result<Option<WorkflowRecord>> {
    let row = sqlx::query(
        r#"
        SELECT id, community_id, name, owner_pubkey, channel_id, definition, definition_hash,
               status::text AS status, enabled, created_at, updated_at
        FROM workflows
        WHERE community_id = $1 AND owner_pubkey = $2 AND name = $3
        LIMIT 1
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(owner_pubkey)
    .bind(name)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => Ok(Some(row_to_workflow_record(r)?)),
        None => Ok(None),
    }
}

// -- Run and approval Db API --------------------------------------------------

impl Db {
    /// Create a new workflow run.
    #[datastore_span(name = "create_workflow_run", system = "postgresql")]
    pub async fn create_workflow_run(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        trigger_event_id: Option<&[u8]>,
        trigger_context: Option<&serde_json::Value>,
    ) -> Result<Uuid> {
        crate::workflow::create_workflow_run(
            &self.pool,
            community_id,
            workflow_id,
            trigger_event_id,
            trigger_context,
        )
        .await
    }

    /// Create a run pinned to the exact active workflow definition snapshot.
    #[datastore_span(name = "create_workflow_run_versioned", system = "postgresql")]
    pub async fn create_workflow_run_versioned(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        trigger_event_id: Option<&[u8]>,
        trigger_context: Option<&serde_json::Value>,
        definition_version: &[u8],
        definition_snapshot: &serde_json::Value,
    ) -> Result<Uuid> {
        crate::workflow::create_workflow_run_versioned(
            &self.pool,
            community_id,
            workflow_id,
            trigger_event_id,
            trigger_context,
            definition_version,
            definition_snapshot,
        )
        .await
    }

    /// Persist a wait for an agent reply and suspend its run atomically.
    #[datastore_span(name = "create_workflow_agent_wait", system = "postgresql")]
    pub async fn create_workflow_agent_wait(
        &self,
        params: CreateWorkflowAgentWaitParams<'_>,
    ) -> Result<(buzz_core::StoredEvent, bool)> {
        crate::workflow::create_workflow_agent_wait(&self.pool, params).await
    }

    /// Find an active agent wait by its exact request thread and assignee.
    #[datastore_span(name = "get_pending_workflow_agent_wait", system = "postgresql")]
    pub async fn get_pending_workflow_agent_wait(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
        request_event_id: &[u8],
        agent_pubkey: &[u8],
    ) -> Result<Option<WorkflowAgentWaitRecord>> {
        crate::workflow::get_pending_workflow_agent_wait(
            &self.pool,
            community_id,
            channel_id,
            request_event_id,
            agent_pubkey,
        )
        .await
    }

    /// Complete a pending agent wait and atomically resume its run.
    #[datastore_span(name = "complete_workflow_agent_wait", system = "postgresql")]
    pub async fn complete_workflow_agent_wait(
        &self,
        params: CompleteWorkflowAgentWaitParams<'_>,
    ) -> Result<Option<WorkflowRunRecord>> {
        crate::workflow::complete_workflow_agent_wait(&self.pool, params).await
    }

    /// Fail an agent wait when its request could not be published.
    #[datastore_span(name = "fail_workflow_agent_wait", system = "postgresql")]
    pub async fn fail_workflow_agent_wait(
        &self,
        community_id: CommunityId,
        run_id: Uuid,
        step_id: &str,
        error_message: &str,
    ) -> Result<()> {
        crate::workflow::fail_workflow_agent_wait(
            &self.pool,
            community_id,
            run_id,
            step_id,
            error_message,
        )
        .await
    }

    /// Expire a bounded batch of agent waits whose deadlines have passed.
    #[datastore_span(name = "expire_workflow_agent_waits", system = "postgresql")]
    pub async fn expire_workflow_agent_waits(&self, now: DateTime<Utc>, limit: i64) -> Result<u64> {
        crate::workflow::expire_workflow_agent_waits(&self.pool, now, limit).await
    }

    /// Expire a bounded batch of overdue workflow approvals.
    #[datastore_span(name = "expire_workflow_approvals", system = "postgresql")]
    pub async fn expire_workflow_approvals(&self, now: DateTime<Utc>, limit: i64) -> Result<u64> {
        crate::workflow::expire_workflow_approvals(&self.pool, now, limit).await
    }

    /// Fetch a single workflow run, scoped to its community.
    #[datastore_span(name = "get_workflow_run", system = "postgresql")]
    pub async fn get_workflow_run(
        &self,
        community_id: CommunityId,
        id: Uuid,
    ) -> Result<crate::workflow::WorkflowRunRecord> {
        crate::workflow::get_workflow_run(&self.pool, community_id, id).await
    }

    /// List runs for a workflow.
    #[datastore_span(name = "list_workflow_runs", system = "postgresql")]
    pub async fn list_workflow_runs(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        limit: i64,
    ) -> Result<Vec<crate::workflow::WorkflowRunRecord>> {
        crate::workflow::list_workflow_runs(&self.pool, community_id, workflow_id, limit).await
    }

    /// List one keyset-paginated page of workflow runs.
    #[datastore_span(name = "list_workflow_runs_page", system = "postgresql")]
    pub async fn list_workflow_runs_page(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        before: Option<chrono::DateTime<chrono::Utc>>,
        before_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<crate::workflow::WorkflowRunRecord>> {
        crate::workflow::list_workflow_runs_page(
            &self.pool,
            community_id,
            workflow_id,
            before,
            before_id,
            limit,
        )
        .await
    }

    /// Update a workflow run's status.
    #[datastore_span(name = "update_workflow_run", system = "postgresql")]
    pub async fn update_workflow_run(
        &self,
        community_id: CommunityId,
        id: Uuid,
        status: crate::workflow::RunStatus,
        current_step: i32,
        trace: &serde_json::Value,
        failure: Option<crate::workflow::WorkflowRunFailure<'_>>,
    ) -> Result<()> {
        crate::workflow::update_workflow_run(
            &self.pool,
            community_id,
            id,
            status,
            current_step,
            trace,
            failure,
        )
        .await
    }

    /// Create an approval request.
    #[datastore_span(name = "create_approval", system = "postgresql")]
    pub async fn create_approval(
        &self,
        params: crate::workflow::CreateApprovalParams<'_>,
    ) -> Result<()> {
        crate::workflow::create_approval(&self.pool, params).await
    }

    /// Create an approval and suspend its run in one transaction.
    #[datastore_span(name = "create_approval_and_suspend_run", system = "postgresql")]
    pub async fn create_approval_and_suspend_run(
        &self,
        params: crate::workflow::CreateApprovalParams<'_>,
        prior_trace: &serde_json::Value,
        trace_entry: &serde_json::Value,
        request_event: &nostr::Event,
        channel_id: Uuid,
    ) -> Result<(buzz_core::StoredEvent, bool)> {
        crate::workflow::create_approval_and_suspend_run(
            &self.pool,
            params,
            prior_trace,
            trace_entry,
            request_event,
            channel_id,
        )
        .await
    }

    /// Fetch an approval by raw token.
    #[datastore_span(name = "get_approval", system = "postgresql")]
    pub async fn get_approval(
        &self,
        community_id: CommunityId,
        token: &str,
    ) -> Result<crate::workflow::ApprovalRecord> {
        crate::workflow::get_approval(&self.pool, community_id, token).await
    }

    /// Fetch an approval by its already-hashed token (no re-hashing).
    #[datastore_span(name = "get_approval_by_stored_hash", system = "postgresql")]
    pub async fn get_approval_by_stored_hash(
        &self,
        community_id: CommunityId,
        token_hash: &[u8],
    ) -> Result<crate::workflow::ApprovalRecord> {
        crate::workflow::get_approval_by_stored_hash(&self.pool, community_id, token_hash).await
    }

    /// Fetch all approvals for a workflow run.
    #[datastore_span(name = "get_run_approvals", system = "postgresql")]
    pub async fn get_run_approvals(
        &self,
        community_id: CommunityId,
        workflow_id: uuid::Uuid,
        run_id: uuid::Uuid,
    ) -> Result<Vec<crate::workflow::ApprovalRecord>> {
        crate::workflow::get_run_approvals(&self.pool, community_id, workflow_id, run_id).await
    }

    /// Update an approval's status.
    #[datastore_span(name = "update_approval", system = "postgresql")]
    pub async fn update_approval(
        &self,
        community_id: CommunityId,
        token: &str,
        status: crate::workflow::ApprovalStatus,
        approver_pubkey: Option<&[u8]>,
        note: Option<&str>,
    ) -> Result<bool> {
        crate::workflow::update_approval(
            &self.pool,
            community_id,
            token,
            status,
            approver_pubkey,
            note,
        )
        .await
    }

    /// Update an approval by its already-hashed token (no re-hashing).
    #[datastore_span(name = "update_approval_by_stored_hash", system = "postgresql")]
    pub async fn update_approval_by_stored_hash(
        &self,
        community_id: CommunityId,
        token_hash: &[u8],
        status: crate::workflow::ApprovalStatus,
        approver_pubkey: Option<&[u8]>,
        note: Option<&str>,
    ) -> Result<bool> {
        crate::workflow::update_approval_by_stored_hash(
            &self.pool,
            community_id,
            token_hash,
            status,
            approver_pubkey,
            note,
        )
        .await
    }
}

// -- Workflow lifecycle Db API ------------------------------------------------

impl Db {
    /// Create a new workflow.
    #[datastore_span(name = "create_workflow", system = "postgresql")]
    pub async fn create_workflow(
        &self,
        community_id: CommunityId,
        channel_id: Option<Uuid>,
        owner_pubkey: &[u8],
        name: &str,
        definition_json: &str,
        definition_hash: &[u8],
    ) -> Result<Uuid> {
        crate::workflow::create_workflow(
            &self.pool,
            community_id,
            channel_id,
            owner_pubkey,
            name,
            definition_json,
            definition_hash,
        )
        .await
    }

    /// Insert or update a workflow using its NIP-33 `d`-tag UUID.
    #[allow(clippy::too_many_arguments)]
    #[datastore_span(name = "upsert_workflow", system = "postgresql")]
    pub async fn upsert_workflow(
        &self,
        community_id: CommunityId,
        id: Uuid,
        channel_id: Option<Uuid>,
        owner_pubkey: &[u8],
        name: &str,
        definition_json: &str,
        definition_hash: &[u8],
    ) -> Result<()> {
        crate::workflow::upsert_workflow(
            &self.pool,
            community_id,
            id,
            channel_id,
            owner_pubkey,
            name,
            definition_json,
            definition_hash,
        )
        .await
    }

    /// Fetch a single workflow by ID, scoped to its community.
    #[datastore_span(name = "get_workflow", system = "postgresql")]
    pub async fn get_workflow(
        &self,
        community_id: CommunityId,
        id: Uuid,
    ) -> Result<crate::workflow::WorkflowRecord> {
        crate::workflow::get_workflow(&self.pool, community_id, id).await
    }

    /// List workflows for a channel.
    #[datastore_span(name = "list_channel_workflows", system = "postgresql")]
    pub async fn list_channel_workflows(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<crate::workflow::WorkflowRecord>> {
        crate::workflow::list_channel_workflows(&self.pool, community_id, channel_id, limit, offset)
            .await
    }

    /// List active, enabled workflows for a channel.
    #[datastore_span(name = "list_enabled_channel_workflows", system = "postgresql")]
    pub async fn list_enabled_channel_workflows(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
    ) -> Result<Vec<crate::workflow::WorkflowRecord>> {
        crate::workflow::list_enabled_channel_workflows(&self.pool, community_id, channel_id).await
    }

    /// List all active, enabled schedule-triggered workflows.
    #[datastore_span(name = "list_all_enabled_workflows", system = "postgresql")]
    pub async fn list_all_enabled_workflows(&self) -> Result<Vec<crate::workflow::WorkflowRecord>> {
        crate::workflow::list_all_enabled_workflows(&self.pool).await
    }

    /// Claim a scheduled workflow fire for an authoritative schedule instant.
    ///
    /// Returns `Some` only for the first pod to claim `(community_id,
    /// workflow_id, scheduled_for)`; all other pods must skip creating a run.
    /// `community_id` is server provenance (the workflow row's own community
    /// from the scheduler scan), never client-supplied — `workflows` is keyed
    /// `(community_id, id)`, so the claim must bind both to avoid fanning
    /// across communities that share the workflow UUID.
    #[datastore_span(name = "claim_scheduled_workflow_fire", system = "postgresql")]
    pub async fn claim_scheduled_workflow_fire(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        scheduled_for: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<crate::workflow::ScheduledWorkflowFireClaim>> {
        crate::workflow::claim_scheduled_workflow_fire(
            &self.pool,
            community_id,
            workflow_id,
            scheduled_for,
        )
        .await
    }

    /// Fetch the latest claimed schedule instant for interval trigger anchoring.
    #[datastore_span(name = "latest_scheduled_workflow_fire", system = "postgresql")]
    pub async fn latest_scheduled_workflow_fire(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
    ) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
        crate::workflow::latest_scheduled_workflow_fire(&self.pool, community_id, workflow_id).await
    }

    /// Attach the workflow run id created from a won scheduled-fire claim.
    #[datastore_span(name = "attach_scheduled_workflow_run", system = "postgresql")]
    pub async fn attach_scheduled_workflow_run(
        &self,
        community_id: CommunityId,
        workflow_id: Uuid,
        scheduled_for: chrono::DateTime<chrono::Utc>,
        workflow_run_id: Uuid,
    ) -> Result<bool> {
        crate::workflow::attach_scheduled_workflow_run(
            &self.pool,
            community_id,
            workflow_id,
            scheduled_for,
            workflow_run_id,
        )
        .await
    }

    /// Delete old scheduled workflow fire claims before a retention cutoff.
    #[datastore_span(name = "prune_scheduled_workflow_fires_before", system = "postgresql")]
    pub async fn prune_scheduled_workflow_fires_before(
        &self,
        older_than: chrono::DateTime<chrono::Utc>,
    ) -> Result<u64> {
        crate::workflow::prune_scheduled_workflow_fires_before(&self.pool, older_than).await
    }

    /// Update a workflow's name, definition, and hash.
    #[datastore_span(name = "update_workflow", system = "postgresql")]
    pub async fn update_workflow(
        &self,
        community_id: CommunityId,
        id: Uuid,
        name: &str,
        definition_json: &str,
        definition_hash: &[u8],
    ) -> Result<()> {
        crate::workflow::update_workflow(
            &self.pool,
            community_id,
            id,
            name,
            definition_json,
            definition_hash,
        )
        .await
    }

    /// Update a workflow's status.
    #[datastore_span(name = "update_workflow_status", system = "postgresql")]
    pub async fn update_workflow_status(
        &self,
        community_id: CommunityId,
        id: Uuid,
        status: crate::workflow::WorkflowStatus,
    ) -> Result<()> {
        crate::workflow::update_workflow_status(&self.pool, community_id, id, status).await
    }

    /// Enable or disable a workflow.
    #[datastore_span(name = "set_workflow_enabled", system = "postgresql")]
    pub async fn set_workflow_enabled(
        &self,
        community_id: CommunityId,
        id: Uuid,
        enabled: bool,
    ) -> Result<()> {
        crate::workflow::set_workflow_enabled(&self.pool, community_id, id, enabled).await
    }

    /// Update a workflow's paused lifecycle state and trigger eligibility together.
    #[datastore_span(name = "set_workflow_lifecycle", system = "postgresql")]
    pub async fn set_workflow_lifecycle(
        &self,
        community_id: CommunityId,
        id: Uuid,
        status: crate::workflow::WorkflowStatus,
        enabled: bool,
    ) -> Result<()> {
        crate::workflow::set_workflow_lifecycle(&self.pool, community_id, id, status, enabled).await
    }

    /// Update lifecycle state inside the transaction that stores its command.
    #[datastore_span(name = "set_workflow_lifecycle_in_transaction", system = "postgresql")]
    pub async fn set_workflow_lifecycle_in_transaction(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        community_id: CommunityId,
        id: Uuid,
        status: crate::workflow::WorkflowStatus,
        enabled: bool,
    ) -> Result<()> {
        crate::workflow::set_workflow_lifecycle_in_transaction(
            tx,
            community_id,
            id,
            status,
            enabled,
        )
        .await
    }

    /// Disable all of an owner's workflows in a channel (SEC-006, on
    /// membership loss). Returns the number of workflows disabled.
    #[datastore_span(name = "disable_workflows_for_owner_in_channel", system = "postgresql")]
    pub async fn disable_workflows_for_owner_in_channel(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
        owner_pubkey: &[u8],
    ) -> Result<u64> {
        crate::workflow::disable_workflows_for_owner_in_channel(
            &self.pool,
            community_id,
            channel_id,
            owner_pubkey,
        )
        .await
    }

    /// Delete a workflow and all its runs/approvals.
    #[datastore_span(name = "delete_workflow", system = "postgresql")]
    pub async fn delete_workflow(&self, community_id: CommunityId, id: Uuid) -> Result<()> {
        crate::workflow::delete_workflow(&self.pool, community_id, id).await
    }

    /// Delete a workflow only when it belongs to the provided owner.
    /// Returns the deleted workflow's `channel_id`.
    #[datastore_span(name = "delete_workflow_for_owner", system = "postgresql")]
    pub async fn delete_workflow_for_owner(
        &self,
        community_id: CommunityId,
        id: Uuid,
        owner_pubkey: &[u8],
    ) -> Result<Option<Uuid>> {
        crate::workflow::delete_workflow_for_owner(&self.pool, community_id, id, owner_pubkey).await
    }

    /// Find a workflow by owner pubkey and name within a community. Used for
    /// NIP-09 a-tag deletion where the d-tag is the workflow name (not UUID).
    #[datastore_span(name = "find_workflow_by_owner_and_name", system = "postgresql")]
    pub async fn find_workflow_by_owner_and_name(
        &self,
        community_id: CommunityId,
        owner_pubkey: &[u8],
        name: &str,
    ) -> Result<Option<crate::workflow::WorkflowRecord>> {
        crate::workflow::find_by_owner_and_name(&self.pool, community_id, owner_pubkey, name).await
    }
}

// -- Tests --------------------------------------------------------------------

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use chrono::TimeZone;

    // -- WorkflowStatus enum --------------------------------------------------

    #[test]
    fn workflow_status_display_is_lowercase() {
        assert_eq!(WorkflowStatus::Active.to_string(), "active");
        assert_eq!(WorkflowStatus::Disabled.to_string(), "disabled");
        assert_eq!(WorkflowStatus::Archived.to_string(), "archived");
    }

    #[test]
    fn workflow_status_from_str_round_trips() {
        for s in &["active", "disabled", "archived"] {
            let status: WorkflowStatus = s.parse().expect("parse");
            assert_eq!(status.to_string(), *s);
        }
    }

    #[test]
    fn workflow_status_from_str_rejects_unknown() {
        let err = "pending".parse::<WorkflowStatus>().unwrap_err();
        assert!(matches!(err, DbError::InvalidData(_)));
    }

    #[test]
    fn workflow_status_equality() {
        assert_eq!(WorkflowStatus::Active, WorkflowStatus::Active);
        assert_ne!(WorkflowStatus::Active, WorkflowStatus::Disabled);
    }

    // -- RunStatus enum -------------------------------------------------------

    #[test]
    fn run_status_display_is_lowercase() {
        assert_eq!(RunStatus::Pending.to_string(), "pending");
        assert_eq!(RunStatus::Running.to_string(), "running");
        assert_eq!(RunStatus::WaitingApproval.to_string(), "waiting_approval");
        assert_eq!(RunStatus::WaitingAgent.to_string(), "waiting_agent");
        assert_eq!(RunStatus::Completed.to_string(), "completed");
        assert_eq!(RunStatus::Failed.to_string(), "failed");
        assert_eq!(RunStatus::Cancelled.to_string(), "cancelled");
        assert_eq!(RunStatus::TimedOut.to_string(), "timed_out");
    }

    #[test]
    fn run_status_from_str_round_trips() {
        for s in &[
            "pending",
            "running",
            "waiting_approval",
            "waiting_agent",
            "completed",
            "failed",
            "cancelled",
            "timed_out",
        ] {
            let status: RunStatus = s.parse().expect("parse");
            assert_eq!(status.to_string(), *s);
        }
    }

    #[test]
    fn run_status_from_str_rejects_unknown() {
        let err = "active".parse::<RunStatus>().unwrap_err();
        assert!(matches!(err, DbError::InvalidData(_)));
    }

    // -- ApprovalStatus enum --------------------------------------------------

    #[test]
    fn approval_status_display_is_lowercase() {
        assert_eq!(ApprovalStatus::Pending.to_string(), "pending");
        assert_eq!(ApprovalStatus::Granted.to_string(), "granted");
        assert_eq!(ApprovalStatus::Denied.to_string(), "denied");
        assert_eq!(ApprovalStatus::Expired.to_string(), "expired");
    }

    #[test]
    fn approval_status_from_str_round_trips() {
        for s in &["pending", "granted", "denied", "expired"] {
            let status: ApprovalStatus = s.parse().expect("parse");
            assert_eq!(status.to_string(), *s);
        }
    }

    #[test]
    fn approval_status_from_str_rejects_unknown() {
        let err = "approved".parse::<ApprovalStatus>().unwrap_err();
        assert!(matches!(err, DbError::InvalidData(_)));
    }

    // -- WorkflowRecord -------------------------------------------------------

    #[test]
    fn workflow_record_fields_are_accessible() {
        let id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        let now = Utc::now();
        let def = serde_json::json!({
            "name": "My Workflow",
            "trigger": { "on": "message_posted" },
            "steps": [{ "id": "s1", "action": "send_message", "text": "hi" }]
        });

        let community_id = CommunityId::from_uuid(Uuid::new_v4());

        let record = WorkflowRecord {
            id,
            community_id,
            name: "My Workflow".to_owned(),
            owner_pubkey: vec![0xab; 32],
            channel_id: Some(channel_id),
            definition: def.clone(),
            definition_hash: vec![0x01, 0x02, 0x03, 0x04],
            status: WorkflowStatus::Active,
            enabled: true,
            created_at: now,
            updated_at: now,
        };

        assert_eq!(record.id, id);
        assert_eq!(record.community_id, community_id);
        assert_eq!(record.name, "My Workflow");
        assert_eq!(record.owner_pubkey, vec![0xab; 32]);
        assert_eq!(record.channel_id, Some(channel_id));
        assert_eq!(record.definition, def);
        assert_eq!(record.definition_hash, vec![0x01, 0x02, 0x03, 0x04]);
        assert_eq!(record.status, WorkflowStatus::Active);
        assert!(record.enabled);
    }

    #[test]
    fn workflow_record_channel_id_can_be_none() {
        let id = Uuid::new_v4();
        let now = Utc::now();

        let record = WorkflowRecord {
            id,
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            name: "Global Workflow".to_owned(),
            owner_pubkey: vec![0x00; 32],
            channel_id: None,
            definition: serde_json::json!({}),
            definition_hash: vec![],
            status: WorkflowStatus::Active,
            enabled: true,
            created_at: now,
            updated_at: now,
        };

        assert!(record.channel_id.is_none());
    }

    #[test]
    fn workflow_record_clone_is_independent() {
        let id = Uuid::new_v4();
        let now = Utc::now();

        let record = WorkflowRecord {
            id,
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            name: "Original".to_owned(),
            owner_pubkey: vec![0x01; 32],
            channel_id: None,
            definition: serde_json::json!({}),
            definition_hash: vec![0xAA],
            status: WorkflowStatus::Active,
            enabled: true,
            created_at: now,
            updated_at: now,
        };

        let mut cloned = record.clone();
        cloned.name = "Cloned".to_owned();

        assert_eq!(record.name, "Original");
        assert_eq!(cloned.name, "Cloned");
    }

    #[test]
    fn workflow_record_status_variants() {
        let now = Utc::now();
        for status in &[
            WorkflowStatus::Active,
            WorkflowStatus::Disabled,
            WorkflowStatus::Archived,
        ] {
            let record = WorkflowRecord {
                id: Uuid::new_v4(),
                community_id: CommunityId::from_uuid(Uuid::new_v4()),
                name: "Test".to_owned(),
                owner_pubkey: vec![],
                channel_id: None,
                definition: serde_json::json!({}),
                definition_hash: vec![],
                status: status.clone(),
                enabled: true,
                created_at: now,
                updated_at: now,
            };
            assert_eq!(&record.status, status);
        }
    }

    #[test]
    fn workflow_record_disabled_has_enabled_false() {
        let now = Utc::now();
        let record = WorkflowRecord {
            id: Uuid::new_v4(),
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            name: "Paused".to_owned(),
            owner_pubkey: vec![],
            channel_id: None,
            definition: serde_json::json!({}),
            definition_hash: vec![],
            status: WorkflowStatus::Active,
            enabled: false,
            created_at: now,
            updated_at: now,
        };
        assert!(!record.enabled);
        assert_eq!(record.status, WorkflowStatus::Active);
    }

    // -- WorkflowRunRecord ----------------------------------------------------

    #[test]
    fn workflow_run_record_fields_are_accessible() {
        let id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        let now = Utc::now();
        let trigger_event_id = vec![0xde, 0xad, 0xbe, 0xef];

        let record = WorkflowRunRecord {
            id,
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id,
            workflow_channel_id: None,
            definition_version: None,
            definition_snapshot: None,
            status: RunStatus::Running,
            trigger_event_id: Some(trigger_event_id.clone()),
            current_step: 2,
            execution_trace: serde_json::json!([
                { "step": "s1", "status": "completed" }
            ]),
            trigger_context: None,
            started_at: Some(now),
            completed_at: None,
            error_message: None,
            error_code: None,
            created_at: now,
        };

        assert_eq!(record.id, id);
        assert_eq!(record.workflow_id, workflow_id);
        assert_eq!(record.status, RunStatus::Running);
        assert_eq!(record.trigger_event_id, Some(trigger_event_id));
        assert_eq!(record.current_step, 2);
        assert!(record.started_at.is_some());
        assert!(record.completed_at.is_none());
        assert!(record.error_message.is_none());
    }

    #[test]
    fn workflow_run_record_no_trigger_event() {
        let now = Utc::now();
        let record = WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: None,
            definition_version: None,
            definition_snapshot: None,
            status: RunStatus::Pending,
            trigger_event_id: None,
            current_step: 0,
            execution_trace: serde_json::json!([]),
            trigger_context: None,
            started_at: None,
            completed_at: None,
            error_message: None,
            error_code: None,
            created_at: now,
        };

        assert!(record.trigger_event_id.is_none());
        assert_eq!(record.current_step, 0);
        assert!(record.started_at.is_none());
    }

    #[test]
    fn workflow_run_record_failed_with_error_message() {
        let now = Utc::now();
        let record = WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: None,
            definition_version: None,
            definition_snapshot: None,
            status: RunStatus::Failed,
            trigger_event_id: None,
            current_step: 1,
            execution_trace: serde_json::json!([]),
            trigger_context: None,
            started_at: Some(now),
            completed_at: Some(now),
            error_message: Some("step timeout exceeded".to_owned()),
            error_code: Some("step_timeout".to_owned()),
            created_at: now,
        };

        assert_eq!(record.status, RunStatus::Failed);
        assert!(record.completed_at.is_some());
        assert_eq!(
            record.error_message.as_deref(),
            Some("step timeout exceeded")
        );
    }

    #[test]
    fn workflow_run_record_execution_trace_is_json_array() {
        let now = Utc::now();
        let trace = serde_json::json!([
            { "step_id": "notify", "status": "completed", "output": { "sent": true } },
            { "step_id": "log", "status": "skipped" }
        ]);

        let record = WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: None,
            definition_version: None,
            definition_snapshot: None,
            status: RunStatus::Completed,
            trigger_event_id: None,
            current_step: 2,
            execution_trace: trace.clone(),
            trigger_context: None,
            started_at: Some(now),
            completed_at: Some(now),
            error_message: None,
            error_code: None,
            created_at: now,
        };

        assert!(record.execution_trace.is_array());
        assert_eq!(record.execution_trace.as_array().unwrap().len(), 2);
    }

    #[test]
    fn workflow_run_record_clone_is_independent() {
        let now = Utc::now();
        let record = WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: None,
            definition_version: None,
            definition_snapshot: None,
            status: RunStatus::Pending,
            trigger_event_id: None,
            current_step: 0,
            execution_trace: serde_json::json!([]),
            trigger_context: None,
            started_at: None,
            completed_at: None,
            error_message: None,
            error_code: None,
            created_at: now,
        };

        let mut cloned = record.clone();
        cloned.status = RunStatus::Running;

        assert_eq!(record.status, RunStatus::Pending);
        assert_eq!(cloned.status, RunStatus::Running);
    }

    // -- ApprovalRecord -------------------------------------------------------

    #[test]
    fn approval_record_fields_are_accessible() {
        let workflow_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let expires_at = Utc.with_ymd_and_hms(2026, 12, 31, 23, 59, 59).unwrap();
        let now = Utc::now();

        let record = ApprovalRecord {
            token: b"abc123def456abc123def456abc123de".to_vec(),
            workflow_id,
            run_id,
            step_id: "request_approval".to_owned(),
            step_index: 1,
            approver_spec: "@engineering-lead".to_owned(),
            status: ApprovalStatus::Pending,
            approver_pubkey: None,
            note: None,
            expires_at,
            created_at: now,
        };

        assert_eq!(record.token, b"abc123def456abc123def456abc123de");
        assert_eq!(record.workflow_id, workflow_id);
        assert_eq!(record.run_id, run_id);
        assert_eq!(record.step_id, "request_approval");
        assert_eq!(record.step_index, 1);
        assert_eq!(record.approver_spec, "@engineering-lead");
        assert_eq!(record.status, ApprovalStatus::Pending);
        assert!(record.approver_pubkey.is_none());
        assert!(record.note.is_none());
    }

    #[test]
    fn approval_record_granted_with_pubkey_and_note() {
        let now = Utc::now();
        let approver_pubkey = vec![0xca; 32];

        let record = ApprovalRecord {
            token: b"token-granted".to_vec(),
            workflow_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            step_id: "gate".to_owned(),
            step_index: 0,
            approver_spec: "@manager".to_owned(),
            status: ApprovalStatus::Granted,
            approver_pubkey: Some(approver_pubkey.clone()),
            note: Some("Looks good, approved.".to_owned()),
            expires_at: now,
            created_at: now,
        };

        assert_eq!(record.status, ApprovalStatus::Granted);
        assert_eq!(record.approver_pubkey, Some(approver_pubkey));
        assert_eq!(record.note.as_deref(), Some("Looks good, approved."));
    }

    #[test]
    fn approval_record_denied_with_note() {
        let now = Utc::now();

        let record = ApprovalRecord {
            token: b"token-denied".to_vec(),
            workflow_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            step_id: "gate".to_owned(),
            step_index: 0,
            approver_spec: "@manager".to_owned(),
            status: ApprovalStatus::Denied,
            approver_pubkey: Some(vec![0xbb; 32]),
            note: Some("Not ready for production.".to_owned()),
            expires_at: now,
            created_at: now,
        };

        assert_eq!(record.status, ApprovalStatus::Denied);
        assert!(record.note.is_some());
    }

    #[test]
    fn approval_record_clone_is_independent() {
        let now = Utc::now();
        let record = ApprovalRecord {
            token: b"original-token".to_vec(),
            workflow_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            step_id: "gate".to_owned(),
            step_index: 0,
            approver_spec: "@lead".to_owned(),
            status: ApprovalStatus::Pending,
            approver_pubkey: None,
            note: None,
            expires_at: now,
            created_at: now,
        };

        let mut cloned = record.clone();
        cloned.status = ApprovalStatus::Granted;

        assert_eq!(record.status, ApprovalStatus::Pending);
        assert_eq!(cloned.status, ApprovalStatus::Granted);
    }

    // -- Scheduled workflow claim confinement ---------------------------------
    //
    // RECONCILED spec (supersedes the earlier S1 lock; Eva/Max 2026-06-27).
    //
    // The earlier S1 lock asserted "`workflow_id` is globally unique, so the
    // claim resolves community server-side from `workflow_id` alone and the
    // caller never names it." The final schema does NOT have that property:
    // `workflows` PK is `(community_id, id)` and `scheduled_workflow_fires` is
    // keyed/FK'd by `(community_id, workflow_id, scheduled_for)`. Duplicate
    // workflow UUIDs across communities are explicitly allowed (and pinned by
    // the Issue-4 confinement tests below). So resolve-from-id-alone is both
    // unimplementable and unsafe: `WHERE w.id = $1` matches every community
    // holding that UUID and fans one claim across all of them.
    //
    // The invariant that survives is NOT "the claim never receives community";
    // it is "the community used for the claim is server provenance, never
    // client-controlled." For the global scheduler scan that provenance is the
    // `workflow.community_id` returned by `list_all_enabled_workflows()`. The
    // claim therefore takes `community_id` and binds
    // `WHERE w.community_id = $1 AND w.id = $2`, confining the claim row to the
    // intended tenant.
    //
    //   1. `workflows.community_id` is row-owned, NOT NULL, immutable.
    //   2. The claim binds `(community_id, workflow_id)` of the workflow row.
    //   3. Claim uniqueness is `(community_id, workflow_id, scheduled_for)`.
    //   4. `latest_scheduled_workflow_fire` / `attach_scheduled_workflow_run`
    //      are already community-scoped; `claim` now matches.
    //
    // `claim_confined_to_its_community` is the confinement lock: a dup workflow
    // UUID in A and B must claim independently (claiming A/id leaves B/id
    // claimable). The other two tests are characterization guards: same-window
    // race must yield exactly one winner, and pruning below the largest
    // interval breaks `latest_*` (the §5c retention rule Sami flagged).

    use crate::user::ensure_user;

    const TEST_DB_URL: &str = "postgres://buzz:buzz_dev@localhost:5432/buzz"; // sadscan:disable np.postgres.1 -- local test-only credentials

    async fn setup_pool() -> PgPool {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| TEST_DB_URL.to_owned());

        PgPool::connect(&database_url)
            .await
            .expect("connect to test DB")
    }

    /// Insert a community with a unique host. Returns its `CommunityId`.
    async fn make_community(pool: &PgPool) -> CommunityId {
        let id = Uuid::new_v4();
        let host = format!("test-{}.example", id.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(&host)
            .execute(pool)
            .await
            .expect("insert community");
        CommunityId::from_uuid(id)
    }

    /// Insert a channel under a community. Returns the channel id.
    async fn make_channel(pool: &PgPool, community: CommunityId, owner: &[u8]) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO channels (id, community_id, name, created_by)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(id)
        .bind(community.as_uuid())
        .bind(format!("ch-{}", id.simple()))
        .bind(owner)
        .execute(pool)
        .await
        .expect("insert channel");
        id
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn run_keeps_its_definition_snapshot_after_publish() {
        let pool = setup_pool().await;
        let community = make_community(&pool).await;
        let owner = vec![0x51; 32];
        ensure_user(&pool, community, &owner)
            .await
            .expect("insert owner user");
        let channel_id = make_channel(&pool, community, &owner).await;
        let workflow_id = Uuid::new_v4();
        let active_v1 = serde_json::json!({
            "name": "snapshot-test",
            "trigger": {"on": "manual"},
            "steps": [{"id": "first", "action": "send_message", "text": "v1"}],
            "enabled": true
        });
        let active_v2 = serde_json::json!({
            "name": "snapshot-test",
            "trigger": {"on": "manual"},
            "steps": [{"id": "first", "action": "send_message", "text": "v2"}],
            "enabled": true
        });
        let v1_json = active_v1.to_string();
        let v2_json = active_v2.to_string();
        let v1_hash = Sha256::digest(v1_json.as_bytes()).to_vec();
        let v2_hash = Sha256::digest(v2_json.as_bytes()).to_vec();
        upsert_workflow(
            &pool,
            community,
            workflow_id,
            Some(channel_id),
            &owner,
            "snapshot-test",
            &v1_json,
            &v1_hash,
        )
        .await
        .expect("publish v1");
        let run_id = create_workflow_run_versioned(
            &pool,
            community,
            workflow_id,
            None,
            None,
            &v1_hash,
            &active_v1,
        )
        .await
        .expect("create pinned run");
        upsert_workflow(
            &pool,
            community,
            workflow_id,
            Some(channel_id),
            &owner,
            "snapshot-test",
            &v2_json,
            &v2_hash,
        )
        .await
        .expect("publish v2");

        set_workflow_lifecycle(
            &pool,
            community,
            workflow_id,
            WorkflowStatus::Disabled,
            false,
        )
        .await
        .expect("pause workflow");
        set_workflow_lifecycle(&pool, community, workflow_id, WorkflowStatus::Active, true)
            .await
            .expect("resume workflow");

        let run = get_workflow_run(&pool, community, run_id)
            .await
            .expect("load pinned run");
        assert_eq!(run.definition_version.as_deref(), Some(v1_hash.as_slice()));
        assert_eq!(run.definition_snapshot, Some(active_v1));
        assert_eq!(run.workflow_channel_id, Some(channel_id));
        let workflow = get_workflow(&pool, community, workflow_id)
            .await
            .expect("load resumed workflow");
        assert_eq!(workflow.definition_hash, v2_hash);
        assert!(workflow.enabled);
        assert_eq!(workflow.status, WorkflowStatus::Active);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn agent_reply_records_identity_and_resumes_run_from_snapshot() {
        let pool = setup_pool().await;
        let community = make_community(&pool).await;
        let owner = vec![0x52; 32];
        ensure_user(&pool, community, &owner)
            .await
            .expect("insert owner user");
        let channel_id = make_channel(&pool, community, &owner).await;
        let workflow_id = Uuid::new_v4();
        let agent_pubkey = nostr::Keys::generate().public_key().to_hex();
        let definition = serde_json::json!({
            "name": "agent-test",
            "trigger": {"on": "manual"},
            "steps": [{"id": "research", "action": "ask_agent", "agent_pubkey": agent_pubkey, "instruction": "Research"}],
            "enabled": true
        });
        let definition_hash = Sha256::digest(definition.to_string().as_bytes()).to_vec();
        upsert_workflow(
            &pool,
            community,
            workflow_id,
            Some(channel_id),
            &owner,
            "agent-test",
            &definition.to_string(),
            &definition_hash,
        )
        .await
        .expect("create workflow");
        let run_id = create_workflow_run_versioned(
            &pool,
            community,
            workflow_id,
            None,
            None,
            &definition_hash,
            &definition,
        )
        .await
        .expect("create run");
        update_workflow_run(
            &pool,
            community,
            run_id,
            RunStatus::Running,
            0,
            &serde_json::json!([]),
            None,
        )
        .await
        .expect("start run");
        let agent = vec![0xa1; 32];
        let channel_tag = channel_id.to_string();
        let request_event = nostr::EventBuilder::new(nostr::Kind::Custom(9), "Research this")
            .tags([nostr::Tag::parse(["h", channel_tag.as_str()]).expect("channel tag")])
            .sign_with_keys(&nostr::Keys::generate())
            .expect("sign request event");
        let request_id = request_event.id.as_bytes().to_vec();
        let reply_id = vec![0xc3; 32];
        let prior_trace = serde_json::json!([]);
        let wait_trace = serde_json::json!({
            "step_id": "research",
            "status": "waiting_agent",
            "output": {"agent_pubkey": hex::encode(&agent), "request_event_id": hex::encode(&request_id)}
        });
        create_workflow_agent_wait(
            &pool,
            CreateWorkflowAgentWaitParams {
                community_id: community,
                workflow_id,
                run_id,
                step_id: "research",
                step_index: 0,
                channel_id,
                agent_pubkey: &agent,
                request_event_id: &request_id,
                request_event: &request_event,
                expires_at: Utc::now() + chrono::Duration::minutes(1),
                prior_trace: &prior_trace,
                trace_entry: &wait_trace,
            },
        )
        .await
        .expect("persist agent wait");

        let run = complete_workflow_agent_wait(
            &pool,
            CompleteWorkflowAgentWaitParams {
                community_id: community,
                channel_id,
                request_event_id: &request_id,
                agent_pubkey: &agent,
                reply_event_id: &reply_id,
                reply_text: "The report is ready",
                now: Utc::now(),
            },
        )
        .await
        .expect("complete wait")
        .expect("matching wait resumes run");
        assert_eq!(run.status, RunStatus::Running);
        assert_eq!(run.current_step, 1);
        assert_eq!(run.definition_snapshot, Some(definition.clone()));
        let trace = run.execution_trace.as_array().expect("trace array");
        assert_eq!(trace[0]["status"], "completed");
        assert_eq!(trace[0]["output"]["agent_pubkey"], hex::encode(&agent));
        assert_eq!(
            trace[0]["output"]["request_event_id"],
            hex::encode(&request_id)
        );
        assert_eq!(trace[0]["output"]["reply_event_id"], hex::encode(&reply_id));
        let stored_requests: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE community_id = $1 AND id = $2")
                .bind(community.as_uuid())
                .bind(&request_id)
                .fetch_one(&pool)
                .await
                .expect("count persisted request events");
        assert_eq!(stored_requests, 1, "request and wait commit together");

        let timeout_run_id = create_workflow_run_versioned(
            &pool,
            community,
            workflow_id,
            None,
            None,
            &definition_hash,
            &definition,
        )
        .await
        .expect("create timeout run");
        update_workflow_run(
            &pool,
            community,
            timeout_run_id,
            RunStatus::Running,
            0,
            &serde_json::json!([]),
            None,
        )
        .await
        .expect("start timeout run");
        let timeout_event = nostr::EventBuilder::new(nostr::Kind::Custom(9), "Second request")
            .tags([nostr::Tag::parse(["h", channel_tag.as_str()]).expect("channel tag")])
            .sign_with_keys(&nostr::Keys::generate())
            .expect("sign timeout event");
        let timeout_request_id = timeout_event.id.as_bytes().to_vec();
        let timeout_expires_at = Utc::now() + chrono::Duration::minutes(1);
        let timeout_trace = serde_json::json!({
            "step_id": "research",
            "status": "waiting_agent",
            "output": {
                "agent_pubkey": hex::encode(&agent),
                "request_event_id": hex::encode(&timeout_request_id)
            }
        });
        create_workflow_agent_wait(
            &pool,
            CreateWorkflowAgentWaitParams {
                community_id: community,
                workflow_id,
                run_id: timeout_run_id,
                step_id: "research",
                step_index: 0,
                channel_id,
                agent_pubkey: &agent,
                request_event_id: &timeout_request_id,
                request_event: &timeout_event,
                expires_at: timeout_expires_at,
                prior_trace: &serde_json::json!([]),
                trace_entry: &timeout_trace,
            },
        )
        .await
        .expect("persist timeout wait");
        let expired = expire_workflow_agent_waits(
            &pool,
            timeout_expires_at + chrono::Duration::seconds(1),
            100,
        )
        .await
        .expect("expire bounded wait");
        assert_eq!(expired, 1);
        let timed_out = get_workflow_run(&pool, community, timeout_run_id)
            .await
            .expect("load timed out run");
        assert_eq!(timed_out.status, RunStatus::TimedOut);
        assert_eq!(timed_out.error_code.as_deref(), Some("agent_timeout"));
        assert!(timed_out.completed_at.is_some());
    }

    /// Insert a workflow whose tenant is `community`'s channel. Returns the
    /// workflow id and the owning community for callers that want to assert
    /// the resolved tenant.
    async fn make_workflow_in(pool: &PgPool, community: CommunityId) -> (Uuid, CommunityId) {
        let owner = vec![0xa1; 32];
        ensure_user(pool, community, &owner)
            .await
            .expect("ensure owner");
        let channel_id = make_channel(pool, community, &owner).await;
        let workflow_id = create_workflow(
            pool,
            community,
            Some(channel_id),
            &owner,
            "f1-attack-workflow",
            r#"{"trigger":{"on":"schedule"},"steps":[]}"#,
            &[0u8; 32],
        )
        .await
        .expect("create workflow");
        (workflow_id, community)
    }

    /// Confinement: a duplicate workflow UUID existing in both community A and
    /// community B must claim independently. Claiming `(A, id, t)` must NOT
    /// consume `(B, id, t)` — B's identical instant stays claimable, and the
    /// A-claim's resolved community is A (server provenance), never B.
    ///
    /// This is the reconciliation of the old S1 lock with the real
    /// `(community_id, id)` schema: because `id` is not globally unique, the
    /// claim binds `WHERE w.community_id = $1 AND w.id = $2`. With the old
    /// bare-`id` SQL (`WHERE w.id = $1`), a single `INSERT ... SELECT` matched
    /// BOTH workflow rows and fanned the claim across A and B — this test goes
    /// RED on that regression (B/id is no longer independently claimable).
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn claim_confined_to_its_community() {
        let pool = setup_pool().await;

        let community_a = make_community(&pool).await;
        let community_b = make_community(&pool).await;

        // Same workflow UUID + same channel UUID in both communities — the PK
        // is `(community_id, id)`, so the collision is structurally allowed.
        let workflow_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        insert_workflow_with_ids(&pool, community_a, workflow_id, channel_id, "sched-a").await;
        insert_workflow_with_ids(&pool, community_b, workflow_id, channel_id, "sched-b").await;

        let scheduled_for = Utc.with_ymd_and_hms(2026, 6, 27, 0, 0, 0).unwrap();

        // Claim A/id/t.
        let claim_a = claim_scheduled_workflow_fire(&pool, community_a, workflow_id, scheduled_for)
            .await
            .expect("claim A should not error")
            .expect("claim A should win");
        assert_eq!(
            claim_a.community_id, community_a,
            "A-claim must resolve to community A (server provenance)"
        );
        assert_eq!(claim_a.workflow_id, workflow_id);
        assert_eq!(claim_a.scheduled_for, scheduled_for);

        // B/id/t must still be claimable — A's claim did not touch B's row.
        let claim_b = claim_scheduled_workflow_fire(&pool, community_b, workflow_id, scheduled_for)
            .await
            .expect("claim B should not error")
            .expect("claim B must still win — A's claim must not have consumed B's instant");
        assert_eq!(
            claim_b.community_id, community_b,
            "B-claim must resolve to community B"
        );

        // And a second A-claim for the same instant must now lose (dedup holds
        // within the community).
        let claim_a_again =
            claim_scheduled_workflow_fire(&pool, community_a, workflow_id, scheduled_for)
                .await
                .expect("second A-claim should not error");
        assert!(
            claim_a_again.is_none(),
            "the same (A, id, t) instant must not be claimable twice"
        );
    }

    /// Same `(community_id, workflow_id, scheduled_for)` claimed concurrently by
    /// N tasks must yield exactly one `Some` winner. Post-reconciliation the
    /// claim key is `(community_id, workflow_id, scheduled_for)`; `community_id`
    /// is server provenance, not a client-named label. Characterization guard:
    /// protects the dedup boundary against regressions in the claim SQL.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn concurrent_same_window_claims_exactly_one_wins() {
        let pool = setup_pool().await;

        let community = make_community(&pool).await;
        let (workflow_id, _) = make_workflow_in(&pool, community).await;
        let scheduled_for = Utc.with_ymd_and_hms(2026, 6, 27, 0, 1, 0).unwrap();

        const N: usize = 8;
        let mut handles = Vec::with_capacity(N);
        for _ in 0..N {
            let pool = pool.clone();
            handles.push(tokio::spawn(async move {
                claim_scheduled_workflow_fire(&pool, community, workflow_id, scheduled_for).await
            }));
        }

        let mut winners = 0usize;
        for h in handles {
            let result = h.await.expect("task did not panic").expect("claim ok");
            if result.is_some() {
                winners += 1;
            }
        }
        assert_eq!(
            winners, 1,
            "exactly one task must win the claim race for (workflow_id, scheduled_for)"
        );
    }

    /// `attach_scheduled_workflow_run` links a won claim to the run it created.
    /// This is the regression for the missing `scheduled_workflow_fires.
    /// workflow_run_id` column: before the schema added it, the UPDATE failed at
    /// runtime with `column "workflow_run_id" does not exist`, so the audit link
    /// silently never populated and the scheduler warned on every fire. This test
    /// proves the column is present, the attach writes it, and the
    /// `workflow_run_id IS NULL` guard makes a second attach a no-op. It is RED
    /// without the migration column.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn attach_links_run_to_claim_and_is_idempotent() {
        let pool = setup_pool().await;

        let community = make_community(&pool).await;
        let (workflow_id, _) = make_workflow_in(&pool, community).await;
        let scheduled_for = Utc.with_ymd_and_hms(2026, 6, 27, 0, 2, 0).unwrap();

        // Win the claim for this instant.
        claim_scheduled_workflow_fire(&pool, community, workflow_id, scheduled_for)
            .await
            .expect("claim ok")
            .expect("claim wins");

        // Create the run the won claim is responsible for, then attach it.
        let run_id = create_workflow_run(&pool, community, workflow_id, None, None)
            .await
            .expect("create run ok");

        let attached =
            attach_scheduled_workflow_run(&pool, community, workflow_id, scheduled_for, run_id)
                .await
                .expect("attach ok");
        assert!(attached, "first attach must update the claim row");

        // The column is populated with the run id.
        let linked: Option<Uuid> = sqlx::query_scalar(
            "SELECT workflow_run_id FROM scheduled_workflow_fires \
             WHERE community_id = $1 AND workflow_id = $2 AND scheduled_for = $3",
        )
        .bind(community.as_uuid())
        .bind(workflow_id)
        .bind(scheduled_for)
        .fetch_one(&pool)
        .await
        .expect("row exists");
        assert_eq!(
            linked,
            Some(run_id),
            "the claim row must now point at the run it created"
        );

        // A second attach is a no-op: the `workflow_run_id IS NULL` guard means
        // an already-linked claim is never re-pointed to a different run.
        let other_run = create_workflow_run(&pool, community, workflow_id, None, None)
            .await
            .expect("create second run ok");
        let reattached =
            attach_scheduled_workflow_run(&pool, community, workflow_id, scheduled_for, other_run)
                .await
                .expect("second attach ok");
        assert!(
            !reattached,
            "attach must not overwrite an already-linked claim row"
        );
    }

    /// Documents the retention-vs-interval coupling Sami flagged for §5c:
    /// pruning every claim below the workflow's interval makes
    /// `latest_scheduled_workflow_fire` return `None`, which re-introduces the
    /// per-pod-clock anchor bug F5 was meant to fix. Test is GREEN today and
    /// MUST stay green — it pins the deployment-config rule that the janitor
    /// cutoff must exceed `MAX(interval_secs) + safety margin`. If a future
    /// change makes `latest_*` resilient to pruning (e.g. by reading the most
    /// recent workflow_run instead, or by retaining a sentinel row), this
    /// test's assertion encodes the contract that must be updated alongside.
    ///
    /// Test isolation: the prune primitive is global (filters only on
    /// `claimed_at`), so to avoid colliding with parallel claim tests we
    /// back-date this workflow's `claimed_at` into the deep past and use a
    /// past cutoff that cannot match any other test's `claimed_at = NOW()`.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn latest_after_prune_below_interval_breaks_anchor() {
        let pool = setup_pool().await;

        let community = make_community(&pool).await;
        let (workflow_id, _) = make_workflow_in(&pool, community).await;
        let scheduled_for = Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap();

        claim_scheduled_workflow_fire(&pool, community, workflow_id, scheduled_for)
            .await
            .expect("claim ok")
            .expect("first claim wins");

        // Backdate this row's `claimed_at` so the global prune below targets
        // only this workflow's row and cannot race-delete other tests' rows.
        let backdated_claimed_at = Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap();
        sqlx::query(
            "UPDATE scheduled_workflow_fires SET claimed_at = $1 \
             WHERE community_id = $2 AND workflow_id = $3 AND scheduled_for = $4",
        )
        .bind(backdated_claimed_at)
        .bind(community.as_uuid())
        .bind(workflow_id)
        .bind(scheduled_for)
        .execute(&pool)
        .await
        .expect("backdate ok");

        let latest_before = latest_scheduled_workflow_fire(&pool, community, workflow_id)
            .await
            .expect("latest ok");
        assert_eq!(
            latest_before,
            Some(scheduled_for),
            "latest must reflect the claim before pruning",
        );

        // Janitor cutoff above only the back-dated row: prunes the anchor row
        // without touching anything claimed at wall-clock NOW.
        let cutoff = backdated_claimed_at + chrono::Duration::seconds(1);
        let pruned = prune_scheduled_workflow_fires_before(&pool, cutoff)
            .await
            .expect("prune ok");
        assert!(
            pruned >= 1,
            "expected at least one row pruned, got {pruned}"
        );

        let latest_after = latest_scheduled_workflow_fire(&pool, community, workflow_id)
            .await
            .expect("latest ok");
        assert_eq!(
            latest_after, None,
            "pruning below the largest interval breaks the DB anchor; \
             retention cutoff MUST exceed MAX(interval_secs) + safety margin (§5c)",
        );
    }

    // -- Issue 4: workflow / approval community confinement -------------------

    /// Insert a workflow under `community` with a caller-chosen `id` and
    /// `channel_id`, so two communities can be given the *same* workflow UUID
    /// and channel UUID (the PK is `(community_id, id)`, which structurally
    /// allows the collision). Returns nothing; callers already hold the ids.
    async fn insert_workflow_with_ids(
        pool: &PgPool,
        community: CommunityId,
        id: Uuid,
        channel_id: Uuid,
        name: &str,
    ) {
        let owner = vec![0xb2; 32];
        ensure_user(pool, community, &owner)
            .await
            .expect("ensure owner");
        // The channel must exist first: `workflows.channel_id` is a composite FK
        // to `(community_id, channel_id)`.
        sqlx::query(
            r#"
            INSERT INTO channels (id, community_id, name, created_by)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(channel_id)
        .bind(community.as_uuid())
        .bind(format!("ch-{}", channel_id.simple()))
        .bind(&owner)
        .execute(pool)
        .await
        .expect("insert channel");
        sqlx::query(
            r#"
            INSERT INTO workflows
                (id, community_id, name, owner_pubkey, channel_id, definition, definition_hash, status, enabled)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'active', TRUE)
            "#,
        )
        .bind(id)
        .bind(community.as_uuid())
        .bind(name)
        .bind(&owner)
        .bind(channel_id)
        .bind(r#"{"trigger":{"on":"webhook"},"steps":[]}"#)
        .bind(&[0u8; 32][..])
        .execute(pool)
        .await
        .expect("insert workflow");
    }

    /// Issue 4 (workflow identity): the same workflow UUID and channel UUID can
    /// exist in communities A and B (PK `(community_id, id)`). A request-scoped
    /// `get_workflow` / `list_enabled_channel_workflows` MUST return only the
    /// row owned by the bound community — never B's colliding row for an
    /// A-scoped lookup. Pre-fix these bound only `id` / `channel_id`, so a
    /// B-host request (or a webhook/manual trigger satisfying membership against
    /// B's colliding channel) could load and drive A's workflow.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn workflow_lookup_is_confined_to_its_community() {
        let pool = setup_pool().await;

        let community_a = make_community(&pool).await;
        let community_b = make_community(&pool).await;

        // Same workflow UUID and channel UUID in both communities.
        let shared_workflow_id = Uuid::new_v4();
        let shared_channel_id = Uuid::new_v4();
        insert_workflow_with_ids(
            &pool,
            community_a,
            shared_workflow_id,
            shared_channel_id,
            "wf-A",
        )
        .await;
        insert_workflow_with_ids(
            &pool,
            community_b,
            shared_workflow_id,
            shared_channel_id,
            "wf-B",
        )
        .await;

        // Scoped get returns each community's own row, never the other's.
        let from_a = get_workflow(&pool, community_a, shared_workflow_id)
            .await
            .expect("A's workflow exists");
        let from_b = get_workflow(&pool, community_b, shared_workflow_id)
            .await
            .expect("B's workflow exists");
        assert_eq!(
            from_a.community_id, community_a,
            "A lookup must resolve A's row"
        );
        assert_eq!(from_a.name, "wf-A");
        assert_eq!(
            from_b.community_id, community_b,
            "B lookup must resolve B's row"
        );
        assert_eq!(from_b.name, "wf-B");

        // A workflow that exists ONLY in B must be NotFound under A.
        let b_only_id = Uuid::new_v4();
        let b_only_channel = Uuid::new_v4();
        insert_workflow_with_ids(&pool, community_b, b_only_id, b_only_channel, "wf-B-only").await;
        let cross = get_workflow(&pool, community_a, b_only_id).await;
        assert!(
            matches!(cross, Err(DbError::NotFound(_))),
            "A must not see B's workflow by id: {cross:?}"
        );

        // The channel listing is confined too: A's channel listing yields only
        // A's workflow even though B has the same channel UUID.
        let listed_a = list_enabled_channel_workflows(&pool, community_a, shared_channel_id)
            .await
            .expect("list A");
        assert_eq!(
            listed_a.len(),
            1,
            "A's channel listing must contain exactly A's workflow"
        );
        assert_eq!(listed_a[0].community_id, community_a);
        assert_eq!(listed_a[0].name, "wf-A");
    }

    /// Issue 4 (workflow lifecycle): deleting `A/id` must not delete `B/id`
    /// when both communities hold the same workflow UUID. Pre-fix
    /// `delete_workflow` predicated only on `id`, so a NIP-09 a-tag deletion in
    /// one community would erase the colliding workflow in every community.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn workflow_delete_is_confined_to_its_community() {
        let pool = setup_pool().await;

        let community_a = make_community(&pool).await;
        let community_b = make_community(&pool).await;
        let shared_workflow_id = Uuid::new_v4();
        insert_workflow_with_ids(
            &pool,
            community_a,
            shared_workflow_id,
            Uuid::new_v4(),
            "wf-A",
        )
        .await;
        insert_workflow_with_ids(
            &pool,
            community_b,
            shared_workflow_id,
            Uuid::new_v4(),
            "wf-B",
        )
        .await;

        delete_workflow(&pool, community_a, shared_workflow_id)
            .await
            .expect("delete A's workflow");

        // A's row is gone; B's identical-UUID row survives untouched.
        assert!(
            matches!(
                get_workflow(&pool, community_a, shared_workflow_id).await,
                Err(DbError::NotFound(_))
            ),
            "A's workflow must be deleted"
        );
        let surviving_b = get_workflow(&pool, community_b, shared_workflow_id)
            .await
            .expect("B's workflow must survive A's delete");
        assert_eq!(surviving_b.community_id, community_b);
        assert_eq!(surviving_b.name, "wf-B");
    }

    /// Issue 4 (approval path): the same approval token can hash to the same
    /// bytes in A and B (PK `(community_id, token)`). A scoped grant/deny acting
    /// on `A/token` MUST NOT touch `B/token`. Pre-fix the approval helpers
    /// predicated only on `token`, so granting one community's approval would
    /// silently resolve another's colliding gate.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn approval_is_confined_to_its_community() {
        let pool = setup_pool().await;

        let community_a = make_community(&pool).await;
        let community_b = make_community(&pool).await;

        // Same workflow + run + token in both communities.
        let workflow_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        insert_workflow_with_ids(&pool, community_a, workflow_id, channel_id, "wf-A").await;
        insert_workflow_with_ids(&pool, community_b, workflow_id, Uuid::new_v4(), "wf-B").await;

        let run_a = create_workflow_run(&pool, community_a, workflow_id, None, None)
            .await
            .expect("run A");
        let run_b = create_workflow_run(&pool, community_b, workflow_id, None, None)
            .await
            .expect("run B");

        let token = "shared-approval-token";
        let expires = Utc::now() + chrono::Duration::hours(1);
        create_approval(
            &pool,
            CreateApprovalParams {
                community_id: community_a,
                token,
                workflow_id,
                run_id: run_a,
                step_id: "gate",
                step_index: 0,
                approver_spec: "@anyone",
                expires_at: expires,
            },
        )
        .await
        .expect("create approval A");
        create_approval(
            &pool,
            CreateApprovalParams {
                community_id: community_b,
                token,
                workflow_id,
                run_id: run_b,
                step_id: "gate",
                step_index: 0,
                approver_spec: "@anyone",
                expires_at: expires,
            },
        )
        .await
        .expect("create approval B");

        // Scoped read returns each community's own approval (its own run id).
        let read_a = get_approval(&pool, community_a, token)
            .await
            .expect("read A");
        let read_b = get_approval(&pool, community_b, token)
            .await
            .expect("read B");
        assert_eq!(read_a.run_id, run_a, "A read must resolve A's approval");
        assert_eq!(read_b.run_id, run_b, "B read must resolve B's approval");

        // Granting A/token must NOT act on B/token.
        let approver = vec![0xc3; 32];
        let granted = update_approval(
            &pool,
            community_a,
            token,
            ApprovalStatus::Granted,
            Some(&approver),
            None,
        )
        .await
        .expect("grant A");
        assert!(granted, "A's approval must be granted");

        let after_a = get_approval(&pool, community_a, token)
            .await
            .expect("re-read A");
        let after_b = get_approval(&pool, community_b, token)
            .await
            .expect("re-read B");
        assert_eq!(after_a.status, ApprovalStatus::Granted, "A is now granted");
        assert_eq!(
            after_b.status,
            ApprovalStatus::Pending,
            "B's approval must remain pending after A is granted"
        );
    }

    // -- SEC-006: disable-on-membership-loss primitive -------------------------

    /// `disable_workflows_for_owner_in_channel` must disable exactly the
    /// departing owner's enabled workflows in that channel — not other owners'
    /// workflows, not the same owner's workflows in other channels — and be
    /// idempotent. Disabled workflows must drop out of the trigger-path list.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn disable_for_owner_scopes_to_owner_and_channel() {
        let pool = setup_pool().await;
        let community = make_community(&pool).await;

        let departing = vec![0xd1; 32];
        let staying = vec![0xd2; 32];
        ensure_user(&pool, community, &departing)
            .await
            .expect("ensure departing");
        ensure_user(&pool, community, &staying)
            .await
            .expect("ensure staying");

        let channel_a = make_channel(&pool, community, &departing).await;
        let channel_b = make_channel(&pool, community, &departing).await;

        let def = r#"{"trigger":{"on":"message_posted"},"steps":[]}"#;
        let wf_departing_a = create_workflow(
            &pool,
            community,
            Some(channel_a),
            &departing,
            "departing-a",
            def,
            &[0u8; 32],
        )
        .await
        .expect("wf departing a");
        let wf_departing_b = create_workflow(
            &pool,
            community,
            Some(channel_b),
            &departing,
            "departing-b",
            def,
            &[0u8; 32],
        )
        .await
        .expect("wf departing b");
        let wf_staying_a = create_workflow(
            &pool,
            community,
            Some(channel_a),
            &staying,
            "staying-a",
            def,
            &[0u8; 32],
        )
        .await
        .expect("wf staying a");

        let disabled =
            disable_workflows_for_owner_in_channel(&pool, community, channel_a, &departing)
                .await
                .expect("disable");
        assert_eq!(
            disabled, 1,
            "exactly the departing owner's channel-A workflow"
        );

        // Idempotent: second call finds nothing enabled.
        let again = disable_workflows_for_owner_in_channel(&pool, community, channel_a, &departing)
            .await
            .expect("disable again");
        assert_eq!(again, 0, "second disable must be a no-op");

        let enabled_a = list_enabled_channel_workflows(&pool, community, channel_a)
            .await
            .expect("list channel a");
        let enabled_a_ids: Vec<Uuid> = enabled_a.iter().map(|w| w.id).collect();
        assert!(
            !enabled_a_ids.contains(&wf_departing_a),
            "departing owner's workflow must no longer be trigger-eligible"
        );
        assert!(
            enabled_a_ids.contains(&wf_staying_a),
            "other owners' workflows in the channel must be untouched"
        );

        let enabled_b = list_enabled_channel_workflows(&pool, community, channel_b)
            .await
            .expect("list channel b");
        assert!(
            enabled_b.iter().any(|w| w.id == wf_departing_b),
            "same owner's workflow in a different channel must be untouched"
        );
    }
}
