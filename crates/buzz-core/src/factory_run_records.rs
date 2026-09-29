//! Typed contract for relay-brokered Software Factory run metadata.

use std::net::IpAddr;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;
use uuid::Uuid;

/// Current schema version for Factory run records.
pub const FACTORY_RUN_RECORD_SCHEMA_VERSION: u8 = 1;
/// Maximum saved development command length, in characters.
pub const MAX_FACTORY_PREVIEW_COMMAND_CHARS: usize = 512;
/// Maximum preview or pull request URL length, in characters.
pub const MAX_FACTORY_RUN_URL_CHARS: usize = 2048;
/// Maximum preview failure reason length, in characters.
pub const MAX_FACTORY_PREVIEW_REASON_CHARS: usize = 1000;
/// Maximum captured preview startup output size, in bytes.
pub const MAX_FACTORY_PREVIEW_OUTPUT_BYTES: usize = 4096;
/// Maximum number of check results attached to a pull request.
pub const MAX_FACTORY_PULL_REQUEST_CHECKS: usize = 100;
/// Maximum check name length, in characters.
pub const MAX_FACTORY_CHECK_NAME_CHARS: usize = 120;
/// Maximum review handoff length, in characters.
pub const MAX_FACTORY_REVIEW_HANDOFF_CHARS: usize = 4000;

/// Errors returned while parsing or validating a Factory run record.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FactoryRunRecordError {
    /// The JSON content does not match the typed Factory run schema.
    #[error("invalid Factory run record content")]
    InvalidContent,
    /// The record uses a schema version the relay does not understand.
    #[error("unsupported Factory run record schema version")]
    UnsupportedSchemaVersion,
    /// A field breaks a Factory run record contract rule.
    #[error("invalid Factory run record: {0}")]
    Invalid(&'static str),
    /// The expected relay head is stale or does not exist.
    #[error("Factory run record changed; refresh the current head")]
    Conflict,
    /// The authenticated actor is not allowed to update this run record.
    #[error("actor cannot update this Factory run record")]
    Forbidden,
}

/// Preview lifecycle status stored in a Factory run head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactoryPreviewStatus {
    /// No preview command or local address is configured.
    NotConfigured,
    /// Configuration exists, but a preview process has not started.
    NotStarted,
    /// The preview runtime is starting the configured process.
    Starting,
    /// The configured process is ready at an actual preview URL.
    Running,
    /// The configured process failed with a recorded reason.
    Failed,
    /// The preview process has stopped.
    Stopped,
}

/// Per-run preview state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum FactoryPreviewState {
    /// No command or local address has been saved.
    NotConfigured,
    /// A command and local address have been saved, but not started.
    NotStarted {
        /// The saved development command.
        command: String,
        /// The configured local preview address.
        local_url: String,
    },
    /// The preview runtime is starting the saved command.
    Starting {
        /// The saved development command.
        command: String,
        /// The configured local preview address.
        local_url: String,
    },
    /// The preview runtime reports a ready process at its actual URL.
    Running {
        /// The saved development command.
        command: String,
        /// The configured local preview address.
        local_url: String,
        /// The actual preview URL reported by the runtime.
        url: String,
    },
    /// The preview runtime reports a startup or running failure.
    Failed {
        /// The saved development command.
        command: String,
        /// The configured local preview address.
        local_url: String,
        /// The actual failure reason reported by the runtime.
        reason: String,
        /// Bounded process output captured by the preview runtime.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        startup_output: Option<String>,
    },
    /// The preview runtime reports that the process has stopped.
    Stopped {
        /// The saved development command.
        command: String,
        /// The configured local preview address.
        local_url: String,
    },
}

impl FactoryPreviewState {
    /// Return the lifecycle status without copying configuration values.
    pub fn status(&self) -> FactoryPreviewStatus {
        match self {
            Self::NotConfigured => FactoryPreviewStatus::NotConfigured,
            Self::NotStarted { .. } => FactoryPreviewStatus::NotStarted,
            Self::Starting { .. } => FactoryPreviewStatus::Starting,
            Self::Running { .. } => FactoryPreviewStatus::Running,
            Self::Failed { .. } => FactoryPreviewStatus::Failed,
            Self::Stopped { .. } => FactoryPreviewStatus::Stopped,
        }
    }

    fn configuration(&self) -> Option<(&str, &str)> {
        match self {
            Self::NotConfigured => None,
            Self::NotStarted { command, local_url }
            | Self::Starting { command, local_url }
            | Self::Running {
                command, local_url, ..
            }
            | Self::Failed {
                command, local_url, ..
            }
            | Self::Stopped { command, local_url } => Some((command, local_url)),
        }
    }
}

/// State reported for one pull request check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactoryCheckStatus {
    /// The check status has not been verified.
    Unknown,
    /// The check is waiting to start.
    Queued,
    /// The check is in progress.
    Running,
    /// The check passed.
    Passed,
    /// The check failed.
    Failed,
    /// The check was cancelled.
    Cancelled,
}

/// A pull request check result explicitly reported by an authorized actor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactoryCheckResult {
    /// Check name shown to reviewers.
    pub name: String,
    /// Recorded result. An absent check is not a pass.
    pub status: FactoryCheckStatus,
    /// Optional HTTPS link to the check details.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details_url: Option<String>,
}

/// Lifecycle state of a linked pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactoryPullRequestState {
    /// The forge state has not been verified.
    Unknown,
    /// The pull request is a draft.
    Draft,
    /// The pull request is open for review.
    Open,
    /// The pull request is closed without merging.
    Closed,
    /// The pull request is merged.
    Merged,
}

/// Existing pull request metadata linked to a Factory run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactoryPullRequest {
    /// Existing HTTPS pull request URL.
    pub url: String,
    /// Pull request number parsed from its URL.
    pub number: u64,
    /// Explicitly reported forge state.
    pub state: FactoryPullRequestState,
    /// Recorded checks. An empty list means no check results were recorded.
    pub check_results: Vec<FactoryCheckResult>,
    /// Optional review handoff supplied by the run owner or an administrator.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_handoff: Option<String>,
}

/// Relay-signed canonical metadata for one local Factory run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactoryRunHead {
    /// Company record schema version.
    pub schema_version: u8,
    /// UUID from the native Factory run record.
    pub run_id: Uuid,
    /// Immutable owner key from the local Factory run scope.
    pub run_owner_pubkey: String,
    /// Current per-run preview lifecycle state.
    pub preview: FactoryPreviewState,
    /// Linked pull request metadata, if one has been attached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<FactoryPullRequest>,
    /// Relay-authored timestamp of the latest accepted update.
    pub updated_at: String,
}

/// Supported mutations for a Factory run head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactoryRunActionKind {
    /// Save a development command and preview address without starting it.
    ConfigurePreview,
    /// Record a lifecycle result emitted by a real preview runtime.
    ReportPreviewState,
    /// Attach metadata for an existing pull request.
    LinkPullRequest,
    /// Remove the current pull request link.
    UnlinkPullRequest,
}

/// Member-signed command brokered by the relay into a Factory run head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactoryRunAction {
    /// Company record schema version.
    pub schema_version: u8,
    /// UUID from the native Factory run record.
    pub run_id: Uuid,
    /// Owner key required when creating the first head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_owner_pubkey: Option<String>,
    /// Expected relay-signed head id, required for every update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Requested mutation.
    pub action: FactoryRunActionKind,
    /// Development command used by `configure_preview`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Local preview address used by `configure_preview`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_url: Option<String>,
    /// Runtime lifecycle result used by `report_preview_state`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<FactoryPreviewState>,
    /// Existing pull request metadata used by `link_pull_request`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<FactoryPullRequest>,
}

/// Build the company d-tag for one Factory run.
pub fn factory_run_d_tag(run_id: Uuid) -> String {
    format!("company:factory-run:{run_id}")
}

/// Parse and validate a member-authored Factory command.
pub fn parse_factory_run_action(content: &str) -> Result<FactoryRunAction, FactoryRunRecordError> {
    let action = serde_json::from_str::<FactoryRunAction>(content)
        .map_err(|_| FactoryRunRecordError::InvalidContent)?;
    if action.schema_version != FACTORY_RUN_RECORD_SCHEMA_VERSION {
        return Err(FactoryRunRecordError::UnsupportedSchemaVersion);
    }
    if action.run_id.is_nil() {
        return Err(FactoryRunRecordError::Invalid("runId must not be nil"));
    }
    Ok(action)
}

/// Apply an authorized Factory command to the current head.
///
/// `current_head_event_id` is the relay's current head id, not a client value.
/// `actor_pubkey` and `is_admin` come from authenticated relay state.
pub fn apply_factory_run_action(
    action: &FactoryRunAction,
    actor_pubkey: &str,
    is_admin: bool,
    current: Option<&FactoryRunHead>,
    current_head_event_id: Option<&str>,
    updated_at: &str,
) -> Result<FactoryRunHead, FactoryRunRecordError> {
    if action.schema_version != FACTORY_RUN_RECORD_SCHEMA_VERSION {
        return Err(FactoryRunRecordError::UnsupportedSchemaVersion);
    }
    if action.run_id.is_nil() {
        return Err(FactoryRunRecordError::Invalid("runId must not be nil"));
    }
    validate_pubkey(actor_pubkey)?;
    chrono::DateTime::parse_from_rfc3339(updated_at)
        .map_err(|_| FactoryRunRecordError::Invalid("updatedAt must be RFC 3339"))?;

    let create = current.is_none();
    let owner_pubkey = if let Some(current) = current {
        if current.run_id != action.run_id {
            return Err(FactoryRunRecordError::Invalid(
                "runId does not match the head",
            ));
        }
        validate_pubkey(&current.run_owner_pubkey)?;
        let expected = action
            .expected_head_event_id
            .as_deref()
            .ok_or(FactoryRunRecordError::Conflict)?;
        validate_hex64(expected, "expectedHeadEventId")?;
        if current_head_event_id != Some(expected) {
            return Err(FactoryRunRecordError::Conflict);
        }
        if action.run_owner_pubkey.is_some() {
            return Err(FactoryRunRecordError::Invalid(
                "runOwnerPubkey may be set only when creating a head",
            ));
        }
        if !actor_pubkey.eq_ignore_ascii_case(&current.run_owner_pubkey) && !is_admin {
            return Err(FactoryRunRecordError::Forbidden);
        }
        current.run_owner_pubkey.to_ascii_lowercase()
    } else {
        if action.expected_head_event_id.is_some() {
            return Err(FactoryRunRecordError::Conflict);
        }
        let owner = action
            .run_owner_pubkey
            .as_deref()
            .ok_or(FactoryRunRecordError::Invalid(
                "runOwnerPubkey is required when creating a head",
            ))?;
        validate_pubkey(owner)?;
        if !actor_pubkey.eq_ignore_ascii_case(owner) && !is_admin {
            return Err(FactoryRunRecordError::Forbidden);
        }
        owner.to_ascii_lowercase()
    };

    let mut next = current.cloned().unwrap_or_else(|| FactoryRunHead {
        schema_version: FACTORY_RUN_RECORD_SCHEMA_VERSION,
        run_id: action.run_id,
        run_owner_pubkey: owner_pubkey,
        preview: FactoryPreviewState::NotConfigured,
        pull_request: None,
        updated_at: updated_at.to_owned(),
    });
    validate_action_fields(action, create)?;

    match action.action {
        FactoryRunActionKind::ConfigurePreview => {
            let command = action
                .command
                .as_deref()
                .ok_or(FactoryRunRecordError::Invalid("command is required"))?;
            let local_url = action
                .local_url
                .as_deref()
                .ok_or(FactoryRunRecordError::Invalid("localUrl is required"))?;
            validate_preview_configuration(command, local_url)?;
            if matches!(
                next.preview.status(),
                FactoryPreviewStatus::Starting | FactoryPreviewStatus::Running
            ) {
                return Err(FactoryRunRecordError::Invalid(
                    "preview cannot be reconfigured while it is active",
                ));
            }
            next.preview = FactoryPreviewState::NotStarted {
                command: command.to_owned(),
                local_url: local_url.to_owned(),
            };
        }
        FactoryRunActionKind::ReportPreviewState => {
            let preview = action
                .preview
                .as_ref()
                .ok_or(FactoryRunRecordError::Invalid("preview state is required"))?;
            validate_preview_state(preview)?;
            validate_preview_transition(&next.preview, preview)?;
            next.preview = preview.clone();
        }
        FactoryRunActionKind::LinkPullRequest => {
            let pull_request = action
                .pull_request
                .as_ref()
                .ok_or(FactoryRunRecordError::Invalid("pullRequest is required"))?;
            validate_pull_request(pull_request)?;
            next.pull_request = Some(pull_request.clone());
        }
        FactoryRunActionKind::UnlinkPullRequest => {
            if next.pull_request.is_none() {
                return Err(FactoryRunRecordError::Invalid(
                    "there is no pull request to unlink",
                ));
            }
            next.pull_request = None;
        }
    }
    next.updated_at = updated_at.to_owned();
    validate_factory_run_head(&next)?;
    Ok(next)
}

/// Validate a relay-signed head before it is returned or used as a base.
pub fn validate_factory_run_head(head: &FactoryRunHead) -> Result<(), FactoryRunRecordError> {
    if head.schema_version != FACTORY_RUN_RECORD_SCHEMA_VERSION {
        return Err(FactoryRunRecordError::UnsupportedSchemaVersion);
    }
    if head.run_id.is_nil() {
        return Err(FactoryRunRecordError::Invalid("runId must not be nil"));
    }
    validate_pubkey(&head.run_owner_pubkey)?;
    chrono::DateTime::parse_from_rfc3339(&head.updated_at)
        .map_err(|_| FactoryRunRecordError::Invalid("updatedAt must be RFC 3339"))?;
    validate_preview_state(&head.preview)?;
    if let Some(pull_request) = &head.pull_request {
        validate_pull_request(pull_request)?;
    }
    Ok(())
}

fn validate_action_fields(
    action: &FactoryRunAction,
    create: bool,
) -> Result<(), FactoryRunRecordError> {
    if create != action.run_owner_pubkey.is_some() {
        return Err(FactoryRunRecordError::Invalid(
            "runOwnerPubkey is required only when creating a head",
        ));
    }
    if create != action.expected_head_event_id.is_none() {
        return Err(FactoryRunRecordError::Conflict);
    }
    match action.action {
        FactoryRunActionKind::ConfigurePreview => {
            if action.command.is_none()
                || action.local_url.is_none()
                || action.preview.is_some()
                || action.pull_request.is_some()
            {
                return Err(FactoryRunRecordError::Invalid(
                    "configure_preview requires only command and localUrl",
                ));
            }
        }
        FactoryRunActionKind::ReportPreviewState => {
            if action.preview.is_none()
                || action.command.is_some()
                || action.local_url.is_some()
                || action.pull_request.is_some()
                || create
            {
                return Err(FactoryRunRecordError::Invalid(
                    "report_preview_state requires an existing head and preview state",
                ));
            }
        }
        FactoryRunActionKind::LinkPullRequest => {
            if action.pull_request.is_none()
                || action.command.is_some()
                || action.local_url.is_some()
                || action.preview.is_some()
            {
                return Err(FactoryRunRecordError::Invalid(
                    "link_pull_request requires only pullRequest",
                ));
            }
        }
        FactoryRunActionKind::UnlinkPullRequest => {
            if action.command.is_some()
                || action.local_url.is_some()
                || action.preview.is_some()
                || action.pull_request.is_some()
                || create
            {
                return Err(FactoryRunRecordError::Invalid(
                    "unlink_pull_request requires an existing head and no payload",
                ));
            }
        }
    }
    Ok(())
}

fn validate_preview_transition(
    current: &FactoryPreviewState,
    next: &FactoryPreviewState,
) -> Result<(), FactoryRunRecordError> {
    let allowed = matches!(
        (current.status(), next.status()),
        (
            FactoryPreviewStatus::NotStarted,
            FactoryPreviewStatus::Starting
        ) | (
            FactoryPreviewStatus::Starting,
            FactoryPreviewStatus::Running
        ) | (FactoryPreviewStatus::Starting, FactoryPreviewStatus::Failed)
            | (
                FactoryPreviewStatus::Starting,
                FactoryPreviewStatus::Stopped
            )
            | (FactoryPreviewStatus::Running, FactoryPreviewStatus::Failed)
            | (FactoryPreviewStatus::Running, FactoryPreviewStatus::Stopped)
            | (FactoryPreviewStatus::Failed, FactoryPreviewStatus::Starting)
            | (
                FactoryPreviewStatus::Stopped,
                FactoryPreviewStatus::Starting
            )
    );
    if !allowed {
        return Err(FactoryRunRecordError::Invalid(
            "preview state transition is not allowed",
        ));
    }
    let current_config = current
        .configuration()
        .ok_or(FactoryRunRecordError::Invalid(
            "preview must be configured before it can start",
        ))?;
    let next_config = next.configuration().ok_or(FactoryRunRecordError::Invalid(
        "reported preview state must retain its configuration",
    ))?;
    if current_config != next_config {
        return Err(FactoryRunRecordError::Invalid(
            "reported preview state does not match the saved configuration",
        ));
    }
    Ok(())
}

fn validate_preview_state(state: &FactoryPreviewState) -> Result<(), FactoryRunRecordError> {
    match state {
        FactoryPreviewState::NotConfigured => Ok(()),
        FactoryPreviewState::NotStarted { command, local_url }
        | FactoryPreviewState::Starting { command, local_url }
        | FactoryPreviewState::Stopped { command, local_url } => {
            validate_preview_configuration(command, local_url)
        }
        FactoryPreviewState::Running {
            command,
            local_url,
            url,
        } => {
            validate_preview_configuration(command, local_url)?;
            validate_preview_url(url)
        }
        FactoryPreviewState::Failed {
            command,
            local_url,
            reason,
            startup_output,
        } => {
            validate_preview_configuration(command, local_url)?;
            validate_non_empty(reason, MAX_FACTORY_PREVIEW_REASON_CHARS, "preview reason")?;
            if startup_output
                .as_ref()
                .is_some_and(|output| output.len() > MAX_FACTORY_PREVIEW_OUTPUT_BYTES)
            {
                return Err(FactoryRunRecordError::Invalid(
                    "startup output exceeds its byte limit",
                ));
            }
            Ok(())
        }
    }
}

fn validate_preview_configuration(
    command: &str,
    local_url: &str,
) -> Result<(), FactoryRunRecordError> {
    validate_non_empty(
        command,
        MAX_FACTORY_PREVIEW_COMMAND_CHARS,
        "development command",
    )?;
    validate_preview_url(local_url)
}

fn validate_preview_url(value: &str) -> Result<(), FactoryRunRecordError> {
    validate_url_length(value)?;
    let url =
        Url::parse(value).map_err(|_| FactoryRunRecordError::Invalid("invalid preview URL"))?;
    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err(FactoryRunRecordError::Invalid(
            "preview URL must not contain credentials",
        ));
    }
    match url.scheme() {
        "https" => Ok(()),
        "http" if url.host_str().is_some_and(is_loopback_host) => Ok(()),
        "http" => Err(FactoryRunRecordError::Invalid(
            "HTTP preview URL must use a loopback host",
        )),
        _ => Err(FactoryRunRecordError::Invalid(
            "preview URL must use HTTPS or loopback HTTP",
        )),
    }
}

fn validate_pull_request(pull_request: &FactoryPullRequest) -> Result<(), FactoryRunRecordError> {
    validate_https_url(&pull_request.url, "pull request URL")?;
    let number = pull_request_number(&pull_request.url)?;
    if pull_request.number == 0 || pull_request.number != number {
        return Err(FactoryRunRecordError::Invalid(
            "pull request number must match its URL",
        ));
    }
    if pull_request.check_results.len() > MAX_FACTORY_PULL_REQUEST_CHECKS {
        return Err(FactoryRunRecordError::Invalid(
            "pull request has too many check results",
        ));
    }
    for check in &pull_request.check_results {
        validate_non_empty(
            check.name.as_str(),
            MAX_FACTORY_CHECK_NAME_CHARS,
            "check name",
        )?;
        if let Some(url) = &check.details_url {
            validate_https_url(url, "check details URL")?;
        }
    }
    if let Some(handoff) = &pull_request.review_handoff {
        validate_non_empty(handoff, MAX_FACTORY_REVIEW_HANDOFF_CHARS, "review handoff")?;
    }
    Ok(())
}

fn validate_https_url(value: &str, field: &'static str) -> Result<(), FactoryRunRecordError> {
    validate_url_length(value)?;
    let url = Url::parse(value).map_err(|_| FactoryRunRecordError::Invalid(field))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err(FactoryRunRecordError::Invalid(field));
    }
    Ok(())
}

fn pull_request_number(value: &str) -> Result<u64, FactoryRunRecordError> {
    let url = Url::parse(value)
        .map_err(|_| FactoryRunRecordError::Invalid("invalid pull request URL"))?;
    let segments = url
        .path_segments()
        .ok_or(FactoryRunRecordError::Invalid(
            "pull request URL has no supported path",
        ))?
        .collect::<Vec<_>>();
    for index in 0..segments.len() {
        let number_segment = match segments.get(index).copied() {
            Some("pull" | "pulls" | "pullrequest") => segments.get(index + 1).copied(),
            Some("merge_requests") if index > 0 && segments[index - 1] == "-" => {
                segments.get(index + 1).copied()
            }
            _ => None,
        };
        if let Some(number) = number_segment.and_then(|segment| segment.parse::<u64>().ok()) {
            return Ok(number);
        }
    }
    Err(FactoryRunRecordError::Invalid(
        "pull request URL must contain a supported pull request number",
    ))
}

fn validate_url_length(value: &str) -> Result<(), FactoryRunRecordError> {
    if value.chars().count() > MAX_FACTORY_RUN_URL_CHARS {
        return Err(FactoryRunRecordError::Invalid(
            "URL exceeds its length limit",
        ));
    }
    Ok(())
}

fn validate_non_empty(
    value: &str,
    max_chars: usize,
    field: &'static str,
) -> Result<(), FactoryRunRecordError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return Err(FactoryRunRecordError::Invalid(field));
    }
    Ok(())
}

fn validate_pubkey(value: &str) -> Result<(), FactoryRunRecordError> {
    validate_hex64(value, "runOwnerPubkey")
}

fn validate_hex64(value: &str, field: &'static str) -> Result<(), FactoryRunRecordError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(FactoryRunRecordError::Invalid(field));
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "abababababababababababababababababababababababababababababababab";
    const RUN_ID: Uuid = Uuid::from_u128(1);
    const HEAD_ID: &str = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
    const NOW: &str = "2026-09-29T12:00:00Z";

    fn action(kind: FactoryRunActionKind) -> FactoryRunAction {
        FactoryRunAction {
            schema_version: FACTORY_RUN_RECORD_SCHEMA_VERSION,
            run_id: RUN_ID,
            run_owner_pubkey: None,
            expected_head_event_id: Some(HEAD_ID.to_owned()),
            action: kind,
            command: None,
            local_url: None,
            preview: None,
            pull_request: None,
        }
    }

    fn head() -> FactoryRunHead {
        FactoryRunHead {
            schema_version: FACTORY_RUN_RECORD_SCHEMA_VERSION,
            run_id: RUN_ID,
            run_owner_pubkey: OWNER.to_owned(),
            preview: FactoryPreviewState::NotConfigured,
            pull_request: None,
            updated_at: NOW.to_owned(),
        }
    }

    #[test]
    fn configure_saves_values_and_leaves_preview_not_started() {
        let mut action = action(FactoryRunActionKind::ConfigurePreview);
        action.expected_head_event_id = None;
        action.run_owner_pubkey = Some(OWNER.to_owned());
        action.command = Some("pnpm dev".to_owned());
        action.local_url = Some("http://127.0.0.1:4000".to_owned());

        let next = apply_factory_run_action(&action, OWNER, false, None, None, NOW)
            .expect("valid configure action");

        assert_eq!(next.preview.status(), FactoryPreviewStatus::NotStarted);
        assert_eq!(next.run_owner_pubkey, OWNER);
        assert!(next.pull_request.is_none());
    }

    #[test]
    fn report_requires_the_exact_next_lifecycle_state_and_saved_configuration() {
        let current = FactoryRunHead {
            preview: FactoryPreviewState::NotStarted {
                command: "pnpm dev".to_owned(),
                local_url: "http://localhost:4000".to_owned(),
            },
            ..head()
        };
        let mut action = action(FactoryRunActionKind::ReportPreviewState);
        action.preview = Some(FactoryPreviewState::Running {
            command: "pnpm dev".to_owned(),
            local_url: "http://localhost:4000".to_owned(),
            url: "http://localhost:4000".to_owned(),
        });
        assert!(matches!(
            apply_factory_run_action(&action, OWNER, false, Some(&current), Some(HEAD_ID), NOW),
            Err(FactoryRunRecordError::Invalid(
                "preview state transition is not allowed"
            ))
        ));

        action.preview = Some(FactoryPreviewState::Starting {
            command: "pnpm dev".to_owned(),
            local_url: "http://localhost:4000".to_owned(),
        });
        let starting =
            apply_factory_run_action(&action, OWNER, false, Some(&current), Some(HEAD_ID), NOW)
                .expect("valid starting transition");
        assert_eq!(starting.preview.status(), FactoryPreviewStatus::Starting);
    }

    #[test]
    fn run_owner_or_admin_can_write_but_other_member_cannot() {
        let current = head();
        let mut action = action(FactoryRunActionKind::ConfigurePreview);
        action.command = Some("pnpm dev".to_owned());
        action.local_url = Some("http://localhost:4000".to_owned());
        assert_eq!(
            apply_factory_run_action(
                &action,
                &"ef".repeat(32),
                false,
                Some(&current),
                Some(HEAD_ID),
                NOW
            ),
            Err(FactoryRunRecordError::Forbidden)
        );
        assert!(apply_factory_run_action(
            &action,
            &"ef".repeat(32),
            true,
            Some(&current),
            Some(HEAD_ID),
            NOW
        )
        .is_ok());
    }

    #[test]
    fn stale_head_and_unknown_action_fields_are_rejected() {
        let current = head();
        let mut action = action(FactoryRunActionKind::UnlinkPullRequest);
        assert_eq!(
            apply_factory_run_action(
                &action,
                OWNER,
                false,
                Some(&current),
                Some(&"ef".repeat(32)),
                NOW
            ),
            Err(FactoryRunRecordError::Conflict)
        );
        action.expected_head_event_id = None;
        assert_eq!(
            parse_factory_run_action(
                &serde_json::to_string(&action)
                    .expect("serialize action")
                    .replace("\"action\"", "\"unexpected\":true,\"action\"")
            ),
            Err(FactoryRunRecordError::InvalidContent)
        );
    }

    #[test]
    fn pull_request_url_number_and_check_urls_are_validated() {
        let pull_request = FactoryPullRequest {
            url: "https://github.com/example/project/pull/42".to_owned(),
            number: 42,
            state: FactoryPullRequestState::Unknown,
            check_results: vec![FactoryCheckResult {
                name: "CI".to_owned(),
                status: FactoryCheckStatus::Unknown,
                details_url: Some("https://ci.example/builds/1".to_owned()),
            }],
            review_handoff: None,
        };
        assert!(validate_pull_request(&pull_request).is_ok());
        let invalid_number = FactoryPullRequest {
            number: 41,
            ..pull_request.clone()
        };
        assert!(validate_pull_request(&invalid_number).is_err());
        let credential_url = FactoryPullRequest {
            url: "https://user:pass@github.com/example/project/pull/42".to_owned(),
            ..pull_request
        };
        assert!(validate_pull_request(&credential_url).is_err());
    }

    #[test]
    fn non_loopback_http_and_oversized_output_are_rejected() {
        assert!(validate_preview_url("http://example.com:4000").is_err());
        assert!(validate_preview_url("http://127.0.0.1:4000").is_ok());
        let failed = FactoryPreviewState::Failed {
            command: "pnpm dev".to_owned(),
            local_url: "http://localhost:4000".to_owned(),
            reason: "process exited".to_owned(),
            startup_output: Some("x".repeat(MAX_FACTORY_PREVIEW_OUTPUT_BYTES + 1)),
        };
        assert!(validate_preview_state(&failed).is_err());
    }
}
