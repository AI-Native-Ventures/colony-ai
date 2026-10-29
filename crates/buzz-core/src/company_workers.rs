//! Budgeted worker runs started by company employees.
//!
//! A worker run is a one-shot, tool-less model call an employee launches for
//! research, drafts or variations. It is a company record, not a team member:
//! it never has a pubkey, a position or a managed agent. The employee writes
//! one `Running` record when it starts and one terminal record when it ends;
//! readers treat a `Running` record past its deadline as failed, so a crashed
//! launcher never leaves a run looking alive.
//!
//! This module owns wire validation and pure status math. Authorization and
//! persistence live in `buzz-relay`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Longest output a worker record carries, in bytes. Longer output is cut by
/// [`truncate_worker_output`] and the full text stays on the employee's disk.
pub const MAX_WORKER_OUTPUT_BYTES: usize = 16_384;
/// Longest worker label, in characters.
pub const MAX_WORKER_LABEL_CHARS: usize = 120;
/// Longest model identifier, in characters.
pub const MAX_WORKER_MODEL_CHARS: usize = 120;
/// Longest failure reason, in characters.
pub const MAX_WORKER_FAILURE_REASON_CHARS: usize = 500;
/// Longest time a worker may run, in seconds (`deadline_at - started_at`).
pub const MAX_WORKER_RUN_SECS: i64 = 900;
/// Seconds after its deadline that a `Done` record is still accepted. A run
/// that finishes later than this must be recorded as failed.
pub const WORKER_DEADLINE_GRACE_SECS: i64 = 30;
/// Largest USD cost a record may state.
pub const MAX_WORKER_COST_USD: f64 = 1_000.0;
/// Most token counts a record may state, per direction.
pub const MAX_WORKER_TOKENS: u64 = 1_000_000_000;

const WORKER_D_TAG_PREFIX: &str = "company:worker:";

/// Lifecycle state of one worker run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatus {
    /// The run started and has not reported an end.
    Running,
    /// The run finished and produced output.
    Done,
    /// The run crashed, timed out or was refused; the record says why.
    Failed,
    /// The employee or an admin stopped the run.
    Cancelled,
}

/// One worker run as stored in an action and in the relay-signed head.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRun {
    /// Stable run UUID in lowercase hyphenated form.
    pub worker_id: String,
    /// Employee that launched the run, 64 lowercase hex characters.
    pub parent_pubkey: String,
    /// Short human label shown on the function page.
    pub label: String,
    /// Model the run asked for.
    pub model: String,
    /// Current lifecycle state.
    pub status: WorkerStatus,
    /// Start time in Unix seconds.
    pub started_at: i64,
    /// Time after which a `Running` record reads as failed, in Unix seconds.
    pub deadline_at: i64,
    /// End time in Unix seconds, present once the run is no longer running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    /// Input tokens the provider reported.
    pub input_tokens: u64,
    /// Output tokens the provider reported.
    pub output_tokens: u64,
    /// Cost in USD when the provider reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// The run's answer, at most [`MAX_WORKER_OUTPUT_BYTES`] bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_text: Option<String>,
    /// Why a failed run failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

/// Employee- or admin-signed worker record write (kind 47062).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkerRunAction {
    /// Schema version.
    pub schema_version: u8,
    /// The full record to store.
    pub run: WorkerRun,
    /// Exact current head event id; omitted only when starting a run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Relay-authored current worker record (kind 30672).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkerRunHead {
    /// Schema version.
    pub schema_version: u8,
    /// The stored record.
    pub run: WorkerRun,
    /// Pubkey that signed the action which produced this head.
    pub updated_by_pubkey: String,
    /// Relay acceptance time in Unix seconds.
    pub updated_at: i64,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// Build the community-wide d-tag of a worker run.
pub fn worker_d_tag(worker_id: &str) -> Result<String, CompanyRecordError> {
    if !is_canonical_uuid(worker_id) {
        return Err(CompanyRecordError::Invalid(
            "workerId must be a lowercase UUID",
        ));
    }
    Ok(format!("{WORKER_D_TAG_PREFIX}{worker_id}"))
}

/// Check a d-tag against a worker id.
pub fn validate_worker_d_tag(d_tag: &str, worker_id: &str) -> Result<(), CompanyRecordError> {
    if d_tag == worker_d_tag(worker_id)? {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Returns the status a reader should show at `now`: a `Running` record past
/// its deadline reads as `Failed`.
pub fn worker_effective_status(run: &WorkerRun, now: i64) -> WorkerStatus {
    if false && run.status == WorkerStatus::Running && now > run.deadline_at {
        WorkerStatus::Failed
    } else {
        run.status
    }
}

/// Returns the failure reason a reader should show at `now`, including the
/// one it supplies for a run that is still marked running past its deadline.
pub fn worker_effective_failure_reason(run: &WorkerRun, now: i64) -> Option<String> {
    if run.status == WorkerStatus::Running && now > run.deadline_at {
        Some("The worker ran past its deadline without reporting an end.".to_owned())
    } else {
        run.failure_reason.clone()
    }
}

/// Cut `text` to [`MAX_WORKER_OUTPUT_BYTES`]. Longer text ends with
/// `[output cut, full text in <path>]`, and the result never exceeds the limit.
pub fn truncate_worker_output(text: &str, full_text_path: &str) -> String {
    if text.len() <= MAX_WORKER_OUTPUT_BYTES {
        return text.to_owned();
    }
    let marker = format!("\n[output cut, full text in {full_text_path}]");
    let budget = MAX_WORKER_OUTPUT_BYTES.saturating_sub(marker.len());
    let mut out = String::with_capacity(MAX_WORKER_OUTPUT_BYTES);
    out.push_str(cut_at_char_boundary(text, budget));
    out.push_str(&marker);
    if out.len() > MAX_WORKER_OUTPUT_BYTES {
        // A path long enough to overflow the limit by itself: keep the limit.
        let keep = cut_at_char_boundary(&out, MAX_WORKER_OUTPUT_BYTES).len();
        out.truncate(keep);
    }
    out
}

fn cut_at_char_boundary(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Validate one worker record, including the state it claims to be in.
pub fn validate_worker_run(run: &WorkerRun) -> Result<(), CompanyRecordError> {
    if !is_canonical_uuid(&run.worker_id) {
        return Err(CompanyRecordError::Invalid(
            "workerId must be a lowercase UUID",
        ));
    }
    if !is_hex_id(&run.parent_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "parentPubkey must be 64 lowercase hex characters",
        ));
    }
    let label_chars = run.label.trim().chars().count();
    if label_chars == 0 || run.label.chars().count() > MAX_WORKER_LABEL_CHARS {
        return Err(CompanyRecordError::Invalid(
            "label is required, 120 characters at most",
        ));
    }
    let model_chars = run.model.trim().chars().count();
    if model_chars == 0 || run.model.chars().count() > MAX_WORKER_MODEL_CHARS {
        return Err(CompanyRecordError::Invalid(
            "model is required, 120 characters at most",
        ));
    }
    if run.started_at <= 0
        || run.deadline_at <= run.started_at
        || run.deadline_at - run.started_at > MAX_WORKER_RUN_SECS
    {
        return Err(CompanyRecordError::Invalid(
            "deadlineAt must be after startedAt by at most 900 seconds",
        ));
    }
    if run.input_tokens > MAX_WORKER_TOKENS || run.output_tokens > MAX_WORKER_TOKENS {
        return Err(CompanyRecordError::Invalid("token counts are out of range"));
    }
    if run
        .cost_usd
        .is_some_and(|cost| !cost.is_finite() || !(0.0..=MAX_WORKER_COST_USD).contains(&cost))
    {
        return Err(CompanyRecordError::Invalid(
            "costUsd must be between 0 and 1000",
        ));
    }
    if run
        .output_text
        .as_ref()
        .is_some_and(|text| text.len() > MAX_WORKER_OUTPUT_BYTES * 1000)
    {
        return Err(CompanyRecordError::Invalid(
            "outputText is at most 16384 bytes",
        ));
    }
    if run.failure_reason.as_ref().is_some_and(|reason| {
        reason.trim().is_empty() || reason.chars().count() > MAX_WORKER_FAILURE_REASON_CHARS
    }) {
        return Err(CompanyRecordError::Invalid(
            "failureReason is 1 to 500 characters",
        ));
    }
    match run.status {
        WorkerStatus::Running => {
            if run.finished_at.is_some()
                || run.output_text.is_some()
                || run.failure_reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a running worker has no end time, output or failure reason",
                ));
            }
        }
        WorkerStatus::Done => {
            let finished = run.finished_at.ok_or(CompanyRecordError::Invalid(
                "a finished worker needs finishedAt",
            ))?;
            if finished < run.started_at
                || finished > run.deadline_at.saturating_add(WORKER_DEADLINE_GRACE_SECS)
            {
                return Err(CompanyRecordError::Invalid(
                    "a done worker must finish between its start and its deadline",
                ));
            }
            if run.output_text.is_none() || run.failure_reason.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a done worker has output and no failure reason",
                ));
            }
        }
        WorkerStatus::Failed => {
            let finished = run.finished_at.ok_or(CompanyRecordError::Invalid(
                "a failed worker needs finishedAt",
            ))?;
            if finished < run.started_at {
                return Err(CompanyRecordError::Invalid(
                    "finishedAt cannot be before startedAt",
                ));
            }
            if run.failure_reason.is_none() {
                return Err(CompanyRecordError::Invalid(
                    "a failed worker needs a failure reason",
                ));
            }
        }
        WorkerStatus::Cancelled => {
            let finished = run.finished_at.ok_or(CompanyRecordError::Invalid(
                "a cancelled worker needs finishedAt",
            ))?;
            if finished < run.started_at {
                return Err(CompanyRecordError::Invalid(
                    "finishedAt cannot be before startedAt",
                ));
            }
            if run.failure_reason.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a cancelled worker has no failure reason",
                ));
            }
        }
    }
    Ok(())
}

/// Validate the shape of a worker action. Starting a run writes a `Running`
/// record with no expected head; every later write names the exact head and
/// ends the run.
pub fn validate_worker_action(action: &WorkerRunAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_worker_run(&action.run)?;
    match (action.run.status, action.expected_head_event_id.as_deref()) {
        (WorkerStatus::Running, None) => Ok(()),
        (WorkerStatus::Running, Some(_)) => Err(CompanyRecordError::Invalid(
            "starting a worker names no expected head",
        )),
        (_, Some(expected)) if is_hex_id(expected) => Ok(()),
        _ => Err(CompanyRecordError::Invalid(
            "ending a worker needs the exact head it ends",
        )),
    }
}

/// Validate a relay-authored worker head.
pub fn validate_worker_head(head: &WorkerRunHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&head.updated_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || head.updated_at <= 0
    {
        return Err(CompanyRecordError::Invalid(
            "worker head identity and time must be valid",
        ));
    }
    validate_worker_run(&head.run)
}

fn is_canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|id| !id.is_nil() && id.hyphenated().to_string() == value)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORKER_ID: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

    fn running() -> WorkerRun {
        WorkerRun {
            worker_id: WORKER_ID.into(),
            parent_pubkey: "ab".repeat(32),
            label: "Research: Melville guesthouses".into(),
            model: "colony-credits".into(),
            status: WorkerStatus::Running,
            started_at: 1_000,
            deadline_at: 1_600,
            finished_at: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: None,
            output_text: None,
            failure_reason: None,
        }
    }

    fn done() -> WorkerRun {
        WorkerRun {
            status: WorkerStatus::Done,
            finished_at: Some(1_200),
            input_tokens: 800,
            output_tokens: 300,
            cost_usd: Some(0.02),
            output_text: Some("Ten guesthouses, ranked.".into()),
            ..running()
        }
    }

    #[test]
    fn running_past_deadline_reads_failed() {
        let run = running();
        assert_eq!(worker_effective_status(&run, 1_600), WorkerStatus::Running);
        assert_eq!(worker_effective_status(&run, 1_601), WorkerStatus::Failed);
        assert!(worker_effective_failure_reason(&run, 1_601).is_some());
        assert!(worker_effective_failure_reason(&run, 1_599).is_none());
        // A finished run never changes, however late it is read.
        assert_eq!(worker_effective_status(&done(), 9_999), WorkerStatus::Done);
    }

    #[test]
    fn output_over_limit_is_rejected_by_validation() {
        let mut run = done();
        run.output_text = Some("x".repeat(MAX_WORKER_OUTPUT_BYTES));
        assert!(validate_worker_run(&run).is_ok());
        run.output_text = Some("x".repeat(MAX_WORKER_OUTPUT_BYTES + 1));
        assert!(validate_worker_run(&run).is_err());
    }

    #[test]
    fn worker_run_rejects_unknown_fields() {
        let mut value = serde_json::to_value(running()).expect("serialize run");
        value["surprise"] = serde_json::json!(true);
        assert!(serde_json::from_value::<WorkerRun>(value).is_err());
        let mut action = serde_json::to_value(WorkerRunAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: running(),
            expected_head_event_id: None,
        })
        .expect("serialize action");
        action["surprise"] = serde_json::json!(true);
        assert!(serde_json::from_value::<WorkerRunAction>(action).is_err());
    }

    #[test]
    fn long_output_is_cut_with_a_marker_inside_the_limit() {
        let long = "é".repeat(MAX_WORKER_OUTPUT_BYTES);
        let cut = truncate_worker_output(&long, "/tmp/worker.txt");
        assert!(cut.len() <= MAX_WORKER_OUTPUT_BYTES);
        assert!(cut.ends_with("[output cut, full text in /tmp/worker.txt]"));
        assert_eq!(truncate_worker_output("short", "/tmp/x"), "short");
        let huge_path = "p".repeat(MAX_WORKER_OUTPUT_BYTES * 2);
        assert!(truncate_worker_output(&long, &huge_path).len() <= MAX_WORKER_OUTPUT_BYTES);
    }

    #[test]
    fn d_tags_round_trip_and_reject_other_ids() {
        let tag = worker_d_tag(WORKER_ID).expect("d-tag");
        assert_eq!(tag, format!("company:worker:{WORKER_ID}"));
        assert!(validate_worker_d_tag(&tag, WORKER_ID).is_ok());
        assert!(worker_d_tag("not-a-uuid").is_err());
        assert!(worker_d_tag(&WORKER_ID.to_uppercase()).is_err());
        assert!(validate_worker_d_tag("company:worker:other", WORKER_ID).is_err());
    }

    #[test]
    fn states_must_match_their_fields() {
        assert!(validate_worker_run(&running()).is_ok());
        assert!(validate_worker_run(&done()).is_ok());

        let mut running_with_output = running();
        running_with_output.output_text = Some("early".into());
        assert!(validate_worker_run(&running_with_output).is_err());

        let mut failed = WorkerRun {
            status: WorkerStatus::Failed,
            finished_at: Some(1_100),
            ..running()
        };
        assert!(validate_worker_run(&failed).is_err());
        failed.failure_reason = Some("The model call timed out.".into());
        assert!(validate_worker_run(&failed).is_ok());

        let mut cancelled = WorkerRun {
            status: WorkerStatus::Cancelled,
            finished_at: Some(1_100),
            ..running()
        };
        assert!(validate_worker_run(&cancelled).is_ok());
        cancelled.failure_reason = Some("why".into());
        assert!(validate_worker_run(&cancelled).is_err());

        // Finishing long after the deadline must be recorded as failed.
        let mut late = done();
        late.finished_at = Some(late.deadline_at + WORKER_DEADLINE_GRACE_SECS + 1);
        assert!(validate_worker_run(&late).is_err());
    }

    #[test]
    fn budget_and_window_are_bounded() {
        let mut run = running();
        run.deadline_at = run.started_at + MAX_WORKER_RUN_SECS;
        assert!(validate_worker_run(&run).is_ok());
        run.deadline_at += 1;
        assert!(validate_worker_run(&run).is_err());
        run.deadline_at = run.started_at;
        assert!(validate_worker_run(&run).is_err());

        let mut costly = done();
        costly.cost_usd = Some(f64::NAN);
        assert!(validate_worker_run(&costly).is_err());
        costly.cost_usd = Some(-0.01);
        assert!(validate_worker_run(&costly).is_err());
    }

    #[test]
    fn actions_start_without_a_head_and_end_with_one() {
        let start = WorkerRunAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: running(),
            expected_head_event_id: None,
        };
        assert!(validate_worker_action(&start).is_ok());

        let mut start_with_head = start.clone();
        start_with_head.expected_head_event_id = Some("12".repeat(32));
        assert!(validate_worker_action(&start_with_head).is_err());

        let end = WorkerRunAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: done(),
            expected_head_event_id: Some("12".repeat(32)),
        };
        assert!(validate_worker_action(&end).is_ok());

        let mut end_without_head = end.clone();
        end_without_head.expected_head_event_id = None;
        assert!(validate_worker_action(&end_without_head).is_err());

        let mut wrong_version = start;
        wrong_version.schema_version = 2;
        assert!(validate_worker_action(&wrong_version).is_err());
    }

    #[test]
    fn head_validation_checks_identity_and_record() {
        let head = WorkerRunHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: done(),
            updated_by_pubkey: "ab".repeat(32),
            updated_at: 1_300,
            source_action_event_id: "cd".repeat(32),
        };
        assert!(validate_worker_head(&head).is_ok());
        let mut bad = head;
        bad.source_action_event_id = "nope".into();
        assert!(validate_worker_head(&bad).is_err());
    }
}
