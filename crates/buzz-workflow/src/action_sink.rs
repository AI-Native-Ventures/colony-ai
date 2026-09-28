//! Action sink trait — interface for workflow side-effects.
//!
//! The relay implements [`ActionSink`] to provide direct DB access to the
//! executor, replacing the HTTP loopback pattern.

use std::future::Future;
use std::pin::Pin;

use buzz_core::tenant::CommunityId;

/// Errors from action sink operations.
#[derive(Debug, thiserror::Error)]
pub enum ActionSinkError {
    /// An input parameter is malformed (e.g. invalid UUID).
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// The target channel does not exist.
    #[error("channel not found: {0}")]
    ChannelNotFound(String),
    /// The target channel is archived.
    #[error("channel is archived: {0}")]
    ChannelArchived(String),
    /// Nostr event construction or signing failed.
    #[error("event construction failed: {0}")]
    EventBuild(String),
    /// A database operation failed.
    #[error("database error: {0}")]
    Database(String),
    /// Message content is empty or whitespace-only.
    #[error("empty message content")]
    EmptyContent,
}

impl From<ActionSinkError> for crate::WorkflowError {
    fn from(e: ActionSinkError) -> Self {
        crate::WorkflowError::WebhookError(e.to_string())
    }
}

/// Boxed, sendable result used to keep [`ActionSink`] object-safe.
pub type ActionSinkFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ActionSinkError>> + Send + 'a>>;

/// Inputs for asking a named agent to complete a workflow task.
pub struct AgentTaskParams<'a> {
    /// Community that owns the workflow and run.
    pub community_id: CommunityId,
    /// Workflow run waiting for the agent.
    pub run_id: uuid::Uuid,
    /// Stable workflow step identifier.
    pub step_id: &'a str,
    /// Zero-based step index.
    pub step_index: usize,
    /// Assigned agent pubkey in hex form.
    pub agent_pubkey: &'a str,
    /// Work instructions posted to the request thread.
    pub instruction: &'a str,
    /// Optional result description appended to the request.
    pub expected_result: Option<&'a str>,
    /// Maximum wait for the agent reply.
    pub timeout_secs: u64,
    /// Workflow owner pubkey in hex form.
    pub owner_pubkey: &'a str,
    /// Completed step trace preceding the agent wait.
    pub prior_trace: &'a serde_json::Value,
}

/// Inputs for publishing an approval request and suspending a workflow run.
pub struct ApprovalRequestParams<'a> {
    /// Community that owns the workflow and run.
    pub community_id: CommunityId,
    /// Workflow run waiting for approval.
    pub run_id: uuid::Uuid,
    /// Stable workflow step identifier.
    pub step_id: &'a str,
    /// Zero-based step index.
    pub step_index: usize,
    /// Allowed approver key, role, or `any`.
    pub approver_spec: &'a str,
    /// Message shown to the approver.
    pub message: &'a str,
    /// Maximum wait for an approval response.
    pub timeout_secs: u64,
    /// Completed step trace preceding the approval request.
    pub prior_trace: &'a serde_json::Value,
    /// Raw approval token used to correlate the decision.
    pub approval_token: &'a str,
}

/// Interface for workflow actions that produce side effects.
///
/// Implemented by the relay to provide direct DB/event access to the executor.
/// This replaces the HTTP loopback where the executor POSTed to the relay's
/// REST API (which failed with 401 auth errors).
///
/// Returns `Pin<Box<dyn Future>>` for dyn-compatibility — required because
/// `WorkflowEngine` stores `Arc<dyn ActionSink>`.
pub trait ActionSink: Send + Sync {
    /// Post a message to a channel on behalf of a workflow owner.
    ///
    /// - `community_id`: the server-resolved community that owns the workflow
    ///   run driving this side effect. The relay-signed message is published
    ///   under *this* community, never the deployment/default tenant — the run
    ///   carries its owning community so a workflow in community B posts into B
    ///   even though the side effect has no inbound connection to bind.
    /// - `channel_id`: UUID string of the target channel
    /// - `text`: rendered message body (must not be empty/whitespace-only)
    /// - `authored_text`: the workflow owner's stored, unrendered step template;
    ///   consumers must use this rather than trigger-controlled rendered output
    ///   when attaching authority-bearing metadata
    /// - `author_pubkey`: hex-encoded pubkey of the workflow owner (used for
    ///   the `p` attribution tag; the relay keypair signs the event)
    /// - `reply_to`: when `Some(event_id_hex)`, the message is posted as a
    ///   threaded reply to that event (NIP-10 root/reply tags + real thread
    ///   metadata); when `None`, it is a top-level channel message.
    ///
    /// Returns the event ID hex string on success.
    fn send_message(
        &self,
        community_id: CommunityId,
        channel_id: &str,
        text: &str,
        authored_text: &str,
        author_pubkey: &str,
        reply_to: Option<&str>,
    ) -> ActionSinkFuture<'_, String>;

    /// Publish a workflow task to a named channel agent and persist its reply wait.
    fn ask_agent(&self, params: AgentTaskParams<'_>) -> ActionSinkFuture<'_, String>;

    /// Persist and publish a request for approval, returning its token and event id.
    fn request_approval(
        &self,
        params: ApprovalRequestParams<'_>,
    ) -> ActionSinkFuture<'_, (String, String)>;
}
