//! Agent-first commands for co-founder playbooks and their running copies.
//!
//! `colony playbooks propose` sends a playbook (or a change to one) for the
//! owner to approve. A running copy per client job is started with `start`
//! and moved along with `step`, `request-approval` and `hand-off`. A step with
//! an approval point cannot start until the owner approved it. Approving,
//! rejecting, editing and archiving are for the owner or an admin: the relay
//! refuses them from an agent.

use buzz_core::company_functions::CompanyFunction;
use buzz_core::company_plans::{PlanOwnerKind, PlanStepOwner};
use buzz_core::company_playbooks::{
    playbook_d_tag, playbook_job_d_tag, playbook_record_kind, validate_job_head,
    validate_playbook_content, validate_playbook_head, JobActionKind, JobStatus, JobStepStatus,
    PlaybookAction, PlaybookActionKind, PlaybookContent, PlaybookHead, PlaybookJobAction,
    PlaybookJobHead, PlaybookRecordKind, PlaybookStatus,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_PLAYBOOK_HEAD;
use nostr::Event;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::BuzzClient;
use crate::commands::cofounder::{head_d_tag, map_write_error, query_company_heads, relay_self};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::{JobStatusArg, JobStepStatusArg, PlaybookStatusArg, PlaybooksCmd};

/// Upper bound on playbook heads one query may return.
const PLAYBOOK_HEAD_QUERY_BOUND: u32 = 500;
/// Largest playbook file the CLI reads.
const MAX_PLAYBOOK_FILE_BYTES: usize = 128 * 1024;

/// Both record families, loaded from one query.
struct Records {
    playbooks: Vec<(Event, PlaybookHead)>,
    jobs: Vec<(Event, PlaybookJobHead)>,
}

pub async fn dispatch(command: PlaybooksCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        PlaybooksCmd::Propose {
            file,
            playbook,
            summary,
        } => {
            let content = read_playbook_file(&file)?;
            match playbook {
                None => {
                    let playbook_id = Uuid::new_v4().to_string();
                    let action = PlaybookAction {
                        content: Some(content),
                        change_summary: summary,
                        ..base_action(&playbook_id, PlaybookActionKind::Propose)
                    };
                    let response = submit_playbook(client, &action).await?;
                    print_with_id(&response, "playbookId", &playbook_id);
                    Ok(())
                }
                Some(playbook_id) => {
                    let summary = summary.ok_or_else(|| {
                        CliError::Usage(
                            "a change to an approved playbook needs --summary, one line saying what it does"
                                .into(),
                        )
                    })?;
                    let (event, _) = load_playbook(client, &playbook_id).await?;
                    let action = PlaybookAction {
                        content: Some(content),
                        change_summary: Some(summary),
                        expected_head_event_id: Some(event.id.to_hex()),
                        ..base_action(&playbook_id, PlaybookActionKind::ProposeChange)
                    };
                    write_playbook(client, &action).await
                }
            }
        }
        PlaybooksCmd::List { status } => {
            let records = load_all(client).await?;
            println!("{}", Value::Array(list_rows(&records.playbooks, status)));
            Ok(())
        }
        PlaybooksCmd::Show { playbook_id } => {
            let (event, head) = load_playbook(client, &playbook_id).await?;
            let records = load_all(client).await?;
            let jobs = job_rows(&records.jobs, Some(playbook_id.as_str()), None);
            println!("{}", show_output(&event, &head, jobs));
            Ok(())
        }
        PlaybooksCmd::Revise {
            playbook_id,
            file,
            summary,
        } => {
            let content = read_playbook_file(&file)?;
            let (event, _) = load_playbook(client, &playbook_id).await?;
            let action = PlaybookAction {
                content: Some(content),
                change_summary: summary,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_action(&playbook_id, PlaybookActionKind::Revise)
            };
            write_playbook(client, &action).await
        }
        PlaybooksCmd::Edit {
            playbook_id,
            file,
            summary,
        } => {
            let content = read_playbook_file(&file)?;
            let (event, _) = load_playbook(client, &playbook_id).await?;
            let action = PlaybookAction {
                content: Some(content),
                change_summary: summary,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_action(&playbook_id, PlaybookActionKind::Edit)
            };
            write_playbook(client, &action).await
        }
        PlaybooksCmd::Withdraw { playbook_id, note } => {
            playbook_note_action(client, playbook_id, note, PlaybookActionKind::Withdraw).await
        }
        PlaybooksCmd::Archive { playbook_id, note } => {
            playbook_note_action(client, playbook_id, note, PlaybookActionKind::Archive).await
        }
        PlaybooksCmd::Approve {
            playbook_id,
            revision,
            note,
        } => {
            decide(
                client,
                playbook_id,
                revision,
                note,
                PlaybookActionKind::Approve,
            )
            .await
        }
        PlaybooksCmd::Reject {
            playbook_id,
            revision,
            note,
        } => {
            decide(
                client,
                playbook_id,
                revision,
                note,
                PlaybookActionKind::Reject,
            )
            .await
        }
        PlaybooksCmd::Approvals { playbook } => {
            let records = load_all(client).await?;
            let rows = approval_rows(&records, playbook.as_deref());
            println!("{}", Value::Array(rows));
            Ok(())
        }
        PlaybooksCmd::Start {
            playbook_id,
            title,
            version,
        } => {
            let job_id = Uuid::new_v4().to_string();
            let action = PlaybookJobAction {
                playbook_id: Some(playbook_id),
                playbook_version: version,
                title: Some(title),
                ..base_job_action(&job_id, JobActionKind::Start)
            };
            let response = submit_job(client, &action).await?;
            print_with_id(&response, "jobId", &job_id);
            Ok(())
        }
        PlaybooksCmd::Jobs { playbook, status } => {
            let records = load_all(client).await?;
            println!(
                "{}",
                Value::Array(job_rows(&records.jobs, playbook.as_deref(), status))
            );
            Ok(())
        }
        PlaybooksCmd::Job { job_id } => {
            let (event, head) = load_job(client, &job_id).await?;
            println!("{}", job_show_output(&event, &head));
            Ok(())
        }
        PlaybooksCmd::Step {
            job_id,
            step_id,
            status,
            note,
            progress,
        } => {
            let (event, _) = load_job(client, &job_id).await?;
            let action = PlaybookJobAction {
                step_id: Some(step_id),
                step_status: Some(status.into()),
                progress_label: progress,
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_job_action(&job_id, JobActionKind::UpdateStep)
            };
            write_job(client, &action).await
        }
        PlaybooksCmd::RequestApproval {
            job_id,
            step_id,
            note,
        } => {
            job_step_action(
                client,
                job_id,
                step_id,
                note,
                JobActionKind::RequestStepApproval,
            )
            .await
        }
        PlaybooksCmd::ApproveStep {
            job_id,
            step_id,
            note,
        } => job_step_action(client, job_id, step_id, note, JobActionKind::ApproveStep).await,
        PlaybooksCmd::RejectStep {
            job_id,
            step_id,
            note,
        } => job_step_action(client, job_id, step_id, note, JobActionKind::RejectStep).await,
        PlaybooksCmd::HandOff {
            job_id,
            step_id,
            function,
            agent,
            worker,
            founder,
            note,
        } => {
            let to = hand_off_owner(function, agent, worker, founder)?;
            let (event, _) = load_job(client, &job_id).await?;
            let action = PlaybookJobAction {
                step_id: Some(step_id),
                hand_off_to: Some(to),
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_job_action(&job_id, JobActionKind::HandOff)
            };
            write_job(client, &action).await
        }
        PlaybooksCmd::Cancel { job_id, note } => {
            let (event, _) = load_job(client, &job_id).await?;
            let action = PlaybookJobAction {
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_job_action(&job_id, JobActionKind::Cancel)
            };
            write_job(client, &action).await
        }
    }
}

impl From<JobStepStatusArg> for JobStepStatus {
    fn from(value: JobStepStatusArg) -> Self {
        match value {
            JobStepStatusArg::InProgress => JobStepStatus::InProgress,
            JobStepStatusArg::Done => JobStepStatus::Done,
            JobStepStatusArg::Blocked => JobStepStatus::Blocked,
            JobStepStatusArg::Skipped => JobStepStatus::Skipped,
        }
    }
}

impl From<PlaybookStatusArg> for PlaybookStatus {
    fn from(value: PlaybookStatusArg) -> Self {
        match value {
            PlaybookStatusArg::Proposed => PlaybookStatus::Proposed,
            PlaybookStatusArg::Active => PlaybookStatus::Active,
            PlaybookStatusArg::Archived => PlaybookStatus::Archived,
            PlaybookStatusArg::Rejected => PlaybookStatus::Rejected,
        }
    }
}

impl From<JobStatusArg> for JobStatus {
    fn from(value: JobStatusArg) -> Self {
        match value {
            JobStatusArg::Running => JobStatus::Running,
            JobStatusArg::Completed => JobStatus::Completed,
            JobStatusArg::Cancelled => JobStatus::Cancelled,
        }
    }
}

/// Exactly one of the four hand-off targets.
fn hand_off_owner(
    function: Option<CompanyFunction>,
    agent: Option<String>,
    worker: Option<String>,
    founder: bool,
) -> Result<PlanStepOwner, CliError> {
    let named = usize::from(function.is_some())
        + usize::from(agent.is_some())
        + usize::from(worker.is_some())
        + usize::from(founder);
    if named != 1 {
        return Err(CliError::Usage(
            "hand a step to exactly one of --function, --agent, --worker or --founder".into(),
        ));
    }
    Ok(PlanStepOwner {
        kind: match (&function, &agent, &worker) {
            (Some(_), _, _) => PlanOwnerKind::Function,
            (_, Some(_), _) => PlanOwnerKind::LeadAgent,
            (_, _, Some(_)) => PlanOwnerKind::Worker,
            _ => PlanOwnerKind::Owner,
        },
        function,
        agent_pubkey: agent,
        worker_type: worker,
    })
}

fn base_action(playbook_id: &str, kind: PlaybookActionKind) -> PlaybookAction {
    PlaybookAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        playbook_id: playbook_id.to_owned(),
        kind,
        content: None,
        change_summary: None,
        revision: None,
        note: None,
        expected_head_event_id: None,
    }
}

fn base_job_action(job_id: &str, kind: JobActionKind) -> PlaybookJobAction {
    PlaybookJobAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        job_id: job_id.to_owned(),
        kind,
        playbook_id: None,
        playbook_version: None,
        title: None,
        step_id: None,
        step_status: None,
        progress_label: None,
        hand_off_to: None,
        note: None,
        expected_head_event_id: None,
    }
}

fn print_with_id(response: &str, key: &str, id: &str) {
    let mut output: Value =
        serde_json::from_str(response).unwrap_or_else(|_| json!({ "raw": response }));
    if let Some(object) = output.as_object_mut() {
        object.insert(key.into(), json!(id));
    }
    println!("{output}");
}

async fn playbook_note_action(
    client: &BuzzClient,
    playbook_id: String,
    note: Option<String>,
    kind: PlaybookActionKind,
) -> Result<(), CliError> {
    let (event, _) = load_playbook(client, &playbook_id).await?;
    let action = PlaybookAction {
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base_action(&playbook_id, kind)
    };
    write_playbook(client, &action).await
}

/// Approve or reject the proposal revision the caller names, or the waiting one.
async fn decide(
    client: &BuzzClient,
    playbook_id: String,
    revision: Option<u32>,
    note: Option<String>,
    kind: PlaybookActionKind,
) -> Result<(), CliError> {
    let (event, head) = load_playbook(client, &playbook_id).await?;
    let revision = match (revision, &head.pending) {
        (Some(revision), _) => revision,
        (None, Some(pending)) => pending.revision,
        (None, None) => {
            return Err(CliError::Usage(
                "no change is waiting for a decision on that playbook".into(),
            ))
        }
    };
    let action = PlaybookAction {
        revision: Some(revision),
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base_action(&playbook_id, kind)
    };
    write_playbook(client, &action).await
}

async fn job_step_action(
    client: &BuzzClient,
    job_id: String,
    step_id: String,
    note: Option<String>,
    kind: JobActionKind,
) -> Result<(), CliError> {
    let (event, _) = load_job(client, &job_id).await?;
    let action = PlaybookJobAction {
        step_id: Some(step_id),
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base_job_action(&job_id, kind)
    };
    write_job(client, &action).await
}

async fn submit_playbook(client: &BuzzClient, action: &PlaybookAction) -> Result<String, CliError> {
    let builder = buzz_sdk::company_playbooks::build_playbook_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "playbook changed before it was saved")
}

async fn write_playbook(client: &BuzzClient, action: &PlaybookAction) -> Result<(), CliError> {
    println!("{}", submit_playbook(client, action).await?);
    Ok(())
}

async fn submit_job(client: &BuzzClient, action: &PlaybookJobAction) -> Result<String, CliError> {
    let builder =
        buzz_sdk::company_playbooks::build_playbook_job_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "the job changed before it was saved")
}

async fn write_job(client: &BuzzClient, action: &PlaybookJobAction) -> Result<(), CliError> {
    println!("{}", submit_job(client, action).await?);
    Ok(())
}

/// Reads a playbook from a file (`-` reads stdin) and checks it before
/// anything is sent.
pub(crate) fn read_playbook_file(path: &str) -> Result<PlaybookContent, CliError> {
    let text = if path == "-" {
        use std::io::Read;
        let mut text = String::new();
        std::io::stdin()
            .lock()
            .take(MAX_PLAYBOOK_FILE_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|error| {
                CliError::Usage(format!("could not read the playbook from stdin: {error}"))
            })?;
        text
    } else {
        std::fs::read_to_string(path)
            .map_err(|error| CliError::Usage(format!("could not read {path}: {error}")))?
    };
    parse_playbook_text(&text)
}

pub(crate) fn parse_playbook_text(text: &str) -> Result<PlaybookContent, CliError> {
    if text.len() > MAX_PLAYBOOK_FILE_BYTES {
        return Err(CliError::Usage(format!(
            "the playbook file is larger than {MAX_PLAYBOOK_FILE_BYTES} bytes"
        )));
    }
    let content = serde_json::from_str::<PlaybookContent>(text).map_err(|error| {
        CliError::Usage(format!("the playbook is not valid playbook JSON: {error}"))
    })?;
    validate_playbook_content(&content)
        .map_err(|error| CliError::Usage(format!("the playbook is not valid: {error}")))?;
    Ok(content)
}

async fn load_all(client: &BuzzClient) -> Result<Records, CliError> {
    let relay_self = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [KIND_PLAYBOOK_HEAD], "authors": [relay_self]}),
            PLAYBOOK_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut records = Records {
        playbooks: Vec::new(),
        jobs: Vec::new(),
    };
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("playbook head is malformed: {error}")))?;
        match playbook_record_kind(&head_d_tag(&event)) {
            Some(PlaybookRecordKind::Playbook) => records
                .playbooks
                .push(verify_playbook_head(event, &relay_self)?),
            Some(PlaybookRecordKind::Job) => {
                records.jobs.push(verify_job_head(event, &relay_self)?)
            }
            None => {
                return Err(CliError::Other(
                    "playbook head has an unexpected d-tag".into(),
                ))
            }
        }
    }
    records.playbooks.sort_by(|(_, first), (_, second)| {
        second
            .updated_at
            .cmp(&first.updated_at)
            .then_with(|| first.playbook_id.cmp(&second.playbook_id))
    });
    records.jobs.sort_by(|(_, first), (_, second)| {
        second
            .updated_at
            .cmp(&first.updated_at)
            .then_with(|| first.job_id.cmp(&second.job_id))
    });
    Ok(records)
}

async fn load_playbook(
    client: &BuzzClient,
    playbook_id: &str,
) -> Result<(Event, PlaybookHead), CliError> {
    let d_tag = playbook_d_tag(playbook_id).map_err(|error| CliError::Usage(error.to_string()))?;
    let events = query_company_heads(client, KIND_PLAYBOOK_HEAD, &[d_tag]).await?;
    let event = events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound(format!("no playbook {playbook_id}")))?;
    let relay_self = relay_self(client).await?;
    verify_playbook_head(event, &relay_self)
}

async fn load_job(client: &BuzzClient, job_id: &str) -> Result<(Event, PlaybookJobHead), CliError> {
    let d_tag = playbook_job_d_tag(job_id).map_err(|error| CliError::Usage(error.to_string()))?;
    let events = query_company_heads(client, KIND_PLAYBOOK_HEAD, &[d_tag]).await?;
    let event = events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound(format!("no job {job_id}")))?;
    let relay_self = relay_self(client).await?;
    verify_job_head(event, &relay_self)
}

fn verify_event(event: &Event, relay_self: &str) -> Result<(), CliError> {
    if u32::from(event.kind.as_u16()) != KIND_PLAYBOOK_HEAD || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "playbook head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("playbook head signature is invalid: {error}")))
}

fn verify_playbook_head(event: Event, relay_self: &str) -> Result<(Event, PlaybookHead), CliError> {
    verify_event(&event, relay_self)?;
    let head = serde_json::from_str::<PlaybookHead>(&event.content)
        .map_err(|error| CliError::Other(format!("playbook head content is invalid: {error}")))?;
    validate_playbook_head(&head)
        .map_err(|error| CliError::Other(format!("playbook head is invalid: {error}")))?;
    let d_tag = playbook_d_tag(&head.playbook_id)
        .map_err(|error| CliError::Other(format!("playbook head id is invalid: {error}")))?;
    if d_tag != head_d_tag(&event) {
        return Err(CliError::Other(
            "playbook head does not match its d-tag".into(),
        ));
    }
    Ok((event, head))
}

fn verify_job_head(event: Event, relay_self: &str) -> Result<(Event, PlaybookJobHead), CliError> {
    verify_event(&event, relay_self)?;
    let head = serde_json::from_str::<PlaybookJobHead>(&event.content)
        .map_err(|error| CliError::Other(format!("job head content is invalid: {error}")))?;
    validate_job_head(&head)
        .map_err(|error| CliError::Other(format!("job head is invalid: {error}")))?;
    let d_tag = playbook_job_d_tag(&head.job_id)
        .map_err(|error| CliError::Other(format!("job head id is invalid: {error}")))?;
    if d_tag != head_d_tag(&event) {
        return Err(CliError::Other("job head does not match its d-tag".into()));
    }
    Ok((event, head))
}

/// One compact row per playbook, newest first, optionally limited to one status.
pub(crate) fn list_rows(
    heads: &[(Event, PlaybookHead)],
    status: Option<PlaybookStatusArg>,
) -> Vec<Value> {
    let wanted = status.map(PlaybookStatus::from);
    heads
        .iter()
        .filter(|(_, head)| wanted.is_none_or(|status| head.status == status))
        .map(|(event, head)| {
            let title = head
                .current
                .as_ref()
                .map(|content| content.title.clone())
                .or_else(|| {
                    head.pending
                        .as_ref()
                        .map(|change| change.content.title.clone())
                });
            json!({
                "playbookId": head.playbook_id,
                "title": title,
                "status": head.status,
                "version": head.version,
                "function": head.current.as_ref().and_then(|content| content.function),
                "stepCount": head.current.as_ref().map(|content| content.steps.len()),
                "changeWaiting": head.pending.is_some(),
                "updatedAt": head.updated_at,
                "headEventId": event.id.to_hex(),
            })
        })
        .collect()
}

/// The full playbook plus the head event id a write must name, with its jobs.
pub(crate) fn show_output(event: &Event, head: &PlaybookHead, jobs: Vec<Value>) -> Value {
    json!({
        "headEventId": event.id.to_hex(),
        "playbookId": head.playbook_id,
        "status": head.status,
        "version": head.version,
        "current": head.current,
        "pending": head.pending,
        "records": head.records,
        "createdByPubkey": head.created_by_pubkey,
        "createdAt": head.created_at,
        "updatedByPubkey": head.updated_by_pubkey,
        "updatedAt": head.updated_at,
        "jobs": jobs,
    })
}

/// One compact row per running copy, newest first, optionally for one playbook or status.
pub(crate) fn job_rows(
    heads: &[(Event, PlaybookJobHead)],
    playbook: Option<&str>,
    status: Option<JobStatusArg>,
) -> Vec<Value> {
    let wanted = status.map(JobStatus::from);
    heads
        .iter()
        .filter(|(_, head)| playbook.is_none_or(|id| head.playbook_id == id))
        .filter(|(_, head)| wanted.is_none_or(|status| head.status == status))
        .map(|(event, head)| {
            json!({
                "jobId": head.job_id,
                "playbookId": head.playbook_id,
                "playbookVersion": head.playbook_version,
                "title": head.title,
                "status": head.status,
                "currentStepId": head.current_step_id,
                "stepsDone": head.steps.iter().filter(|step| step.status.is_ended()).count(),
                "stepCount": head.steps.len(),
                "startedAt": head.started_at,
                "updatedAt": head.updated_at,
                "headEventId": event.id.to_hex(),
            })
        })
        .collect()
}

/// The full running copy plus the head event id a write must name.
pub(crate) fn job_show_output(event: &Event, head: &PlaybookJobHead) -> Value {
    json!({
        "headEventId": event.id.to_hex(),
        "jobId": head.job_id,
        "playbookId": head.playbook_id,
        "playbookVersion": head.playbook_version,
        "playbookTitle": head.playbook_title,
        "title": head.title,
        "status": head.status,
        "currentStepId": head.current_step_id,
        "steps": head.steps,
        "approvals": head.approvals,
        "handoffs": head.handoffs,
        "startedByPubkey": head.started_by_pubkey,
        "startedAt": head.started_at,
        "endedAt": head.ended_at,
        "updatedByPubkey": head.updated_by_pubkey,
        "updatedAt": head.updated_at,
    })
}

/// Every decision on every playbook and every step approval on every job,
/// oldest first: who decided what and when.
fn approval_rows(records: &Records, playbook: Option<&str>) -> Vec<Value> {
    let mut rows: Vec<(i64, Value)> = Vec::new();
    for (_, head) in &records.playbooks {
        if playbook.is_some_and(|id| head.playbook_id != id) {
            continue;
        }
        let title = head
            .current
            .as_ref()
            .map(|content| content.title.clone())
            .or_else(|| {
                head.pending
                    .as_ref()
                    .map(|change| change.content.title.clone())
            });
        for record in &head.records {
            rows.push((
                record.at,
                json!({
                    "scope": "playbook",
                    "playbookId": head.playbook_id,
                    "playbookTitle": title,
                    "decision": record.decision,
                    "version": record.version,
                    "revision": record.revision,
                    "actorPubkey": record.actor_pubkey,
                    "at": record.at,
                    "note": record.note,
                    "changeSummary": record.change_summary,
                    "proposedByPubkey": record.proposed_by_pubkey,
                    "actionEventId": record.action_event_id,
                }),
            ));
        }
    }
    for (_, head) in &records.jobs {
        if playbook.is_some_and(|id| head.playbook_id != id) {
            continue;
        }
        for record in &head.approvals {
            rows.push((
                record.at,
                json!({
                    "scope": "job_step",
                    "playbookId": head.playbook_id,
                    "jobId": head.job_id,
                    "jobTitle": head.title,
                    "stepId": record.step_id,
                    "decision": record.decision,
                    "actorPubkey": record.actor_pubkey,
                    "at": record.at,
                    "note": record.note,
                    "actionEventId": record.action_event_id,
                }),
            ));
        }
    }
    rows.sort_by_key(|(at, _)| *at);
    rows.into_iter().map(|(_, row)| row).collect()
}

#[cfg(test)]
mod tests {
    use buzz_core::company_playbooks::{
        JobApprovalRecord, JobDecision, PlaybookChange, PlaybookDecision, PlaybookDecisionRecord,
    };
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    const PLAYBOOK_ID: &str = "3c2f6a0e-1b7d-4f0a-9c55-7a1d0e4b2f11";
    const JOB_ID: &str = "9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4";

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn playbook_json() -> String {
        json!({
            "title": "Delivery playbook",
            "function": "operations",
            "steps": [{
                "stepId": "brief",
                "title": "Client brief and assets",
                "owner": { "kind": "function", "function": "operations" },
                "inputs": ["signed agreement"],
                "outputs": ["brief"],
                "tools": ["WhatsApp"]
            }, {
                "stepId": "approval",
                "title": "Your approval",
                "owner": { "kind": "owner" },
                "approvalPoint": { "kind": "taste", "prompt": "Pick the design" }
            }]
        })
        .to_string()
    }

    fn sign(kind_d: &str, content: String) -> Event {
        EventBuilder::new(Kind::Custom(KIND_PLAYBOOK_HEAD as u16), content)
            .tag(Tag::parse(["d", kind_d]).expect("d tag"))
            .sign_with_keys(&Keys::generate())
            .expect("sign head")
    }

    fn playbook_head(status: PlaybookStatus, with_change: bool) -> (Event, PlaybookHead) {
        let content = parse_playbook_text(&playbook_json()).expect("playbook");
        let head = PlaybookHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            playbook_id: PLAYBOOK_ID.to_owned(),
            status,
            version: if status == PlaybookStatus::Proposed {
                0
            } else {
                2
            },
            current: (status != PlaybookStatus::Proposed).then(|| content.clone()),
            pending: (with_change || status == PlaybookStatus::Proposed).then(|| PlaybookChange {
                content: content.clone(),
                change_summary: Some("Add a logins checklist".to_owned()),
                proposed_by_pubkey: "a".repeat(64),
                proposed_at: 1_700_000_000,
                revision: 3,
            }),
            records: vec![PlaybookDecisionRecord {
                decision: PlaybookDecision::Approved,
                version: 1,
                revision: Some(1),
                actor_pubkey: "b".repeat(64),
                at: 1_700_000_050,
                note: None,
                change_summary: None,
                proposed_by_pubkey: None,
                action_event_id: "d".repeat(64),
            }],
            created_by_pubkey: "a".repeat(64),
            created_at: 1_700_000_000,
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1_700_000_100,
            source_action_event_id: "c".repeat(64),
        };
        let event = sign(
            &playbook_d_tag(PLAYBOOK_ID).expect("d"),
            serde_json::to_string(&head).expect("serialize"),
        );
        (event, head)
    }

    fn job_head(status: JobStatus) -> (Event, PlaybookJobHead) {
        let content = parse_playbook_text(&playbook_json()).expect("playbook");
        let steps = content
            .steps
            .iter()
            .enumerate()
            .map(
                |(index, step)| buzz_core::company_playbooks::PlaybookJobStep {
                    step_id: step.step_id.clone(),
                    title: step.title.clone(),
                    detail: None,
                    owner: step.owner.clone(),
                    inputs: step.inputs.clone(),
                    outputs: step.outputs.clone(),
                    tools: step.tools.clone(),
                    approval_point: step.approval_point.clone(),
                    status: if status == JobStatus::Completed || index == 0 {
                        JobStepStatus::Done
                    } else {
                        JobStepStatus::Pending
                    },
                    note: None,
                    progress_label: None,
                    status_at: 1_700_000_000,
                },
            )
            .collect::<Vec<_>>();
        let mut head = PlaybookJobHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            job_id: JOB_ID.to_owned(),
            playbook_id: PLAYBOOK_ID.to_owned(),
            playbook_version: 2,
            playbook_title: content.title,
            title: "Plane Tree Guesthouse".to_owned(),
            status,
            current_step_id: None,
            steps,
            approvals: vec![JobApprovalRecord {
                step_id: "approval".to_owned(),
                decision: JobDecision::Approved,
                actor_pubkey: "b".repeat(64),
                at: 1_700_000_080,
                note: None,
                action_event_id: "e".repeat(64),
            }],
            handoffs: Vec::new(),
            started_by_pubkey: "a".repeat(64),
            started_at: 1_700_000_000,
            ended_at: (status != JobStatus::Running).then_some(1_700_000_090),
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1_700_000_100,
            source_action_event_id: "c".repeat(64),
        };
        if status == JobStatus::Running {
            head.current_step_id = Some("approval".to_owned());
        }
        let event = sign(
            &playbook_job_d_tag(JOB_ID).expect("d"),
            serde_json::to_string(&head).expect("serialize"),
        );
        (event, head)
    }

    #[test]
    fn playbook_file_must_be_a_valid_playbook() {
        assert!(parse_playbook_text(&playbook_json()).is_ok());
        assert!(parse_playbook_text("{}").is_err());
        assert!(parse_playbook_text("not json").is_err());
        // Unknown keys are refused, the same as on the relay.
        let mut value: Value = serde_json::from_str(&playbook_json()).unwrap();
        value["surprise"] = json!(true);
        assert!(parse_playbook_text(&value.to_string()).is_err());
        // A worker step with an outreach approval point is refused before anything is sent.
        let mut value: Value = serde_json::from_str(&playbook_json()).unwrap();
        value["steps"][0]["owner"] = json!({ "kind": "worker", "workerType": "research" });
        value["steps"][0]["approvalPoint"] = json!({ "kind": "outreach", "prompt": "Approve" });
        assert!(parse_playbook_text(&value.to_string()).is_err());
    }

    #[test]
    fn playbooks_commands_parse() {
        let ok = parse(&["playbooks", "propose", "--file", "playbook.json"]).expect("propose");
        assert!(matches!(
            ok.command,
            Cmd::Playbooks(PlaybooksCmd::Propose { .. })
        ));
        assert!(parse(&["playbooks", "propose"]).is_err());
        assert!(parse(&[
            "playbooks",
            "propose",
            "--file",
            "p.json",
            "--playbook",
            PLAYBOOK_ID,
            "--summary",
            "Add a checklist"
        ])
        .is_ok());
        assert!(parse(&["playbooks", "list", "--status", "active"]).is_ok());
        assert!(parse(&["playbooks", "show", PLAYBOOK_ID]).is_ok());
        assert!(parse(&["playbooks", "approve", PLAYBOOK_ID, "--revision", "2"]).is_ok());
        assert!(parse(&["playbooks", "start", PLAYBOOK_ID, "--title", "Plane Tree"]).is_ok());
        assert!(parse(&["playbooks", "start", PLAYBOOK_ID]).is_err());
        let step = parse(&[
            "playbooks",
            "step",
            JOB_ID,
            "brief",
            "--status",
            "in_progress",
            "--progress",
            "Round 1 of 2",
        ])
        .expect("step");
        assert!(matches!(
            step.command,
            Cmd::Playbooks(PlaybooksCmd::Step { .. })
        ));
        assert!(parse(&["playbooks", "step", JOB_ID, "brief"]).is_err());
        assert!(parse(&["playbooks", "step", JOB_ID, "brief", "--status", "pending"]).is_err());
        assert!(parse(&["playbooks", "step", JOB_ID, "brief", "--status", "failed"]).is_err());
        assert!(parse(&["playbooks", "request-approval", JOB_ID, "approval"]).is_ok());
        assert!(parse(&["playbooks", "approve-step", JOB_ID, "approval"]).is_ok());
        assert!(parse(&["playbooks", "jobs", "--status", "running"]).is_ok());
        assert!(parse(&["playbooks", "job", JOB_ID]).is_ok());
        assert!(parse(&["playbooks", "approvals"]).is_ok());
        assert!(parse(&[
            "playbooks",
            "hand-off",
            JOB_ID,
            "brief",
            "--function",
            "customer_success"
        ])
        .is_ok());
    }

    #[test]
    fn a_hand_off_names_exactly_one_target() {
        assert!(hand_off_owner(None, None, None, false).is_err());
        assert!(hand_off_owner(
            Some(CompanyFunction::Sales),
            Some("a".repeat(64)),
            None,
            false
        )
        .is_err());
        let owner = hand_off_owner(Some(CompanyFunction::Sales), None, None, false).expect("owner");
        assert_eq!(owner.kind, PlanOwnerKind::Function);
        assert_eq!(owner.function, Some(CompanyFunction::Sales));
        let owner = hand_off_owner(None, Some("a".repeat(64)), None, false).expect("owner");
        assert_eq!(owner.kind, PlanOwnerKind::LeadAgent);
        let owner = hand_off_owner(None, None, Some("research".to_owned()), false).expect("owner");
        assert_eq!(owner.kind, PlanOwnerKind::Worker);
        let owner = hand_off_owner(None, None, None, true).expect("owner");
        assert_eq!(owner.kind, PlanOwnerKind::Owner);
    }

    #[test]
    fn list_rows_filter_by_status_and_show_the_waiting_change() {
        let heads = vec![
            playbook_head(PlaybookStatus::Proposed, false),
            playbook_head(PlaybookStatus::Active, true),
        ];
        assert_eq!(list_rows(&heads, None).len(), 2);
        let active = list_rows(&heads, Some(PlaybookStatusArg::Active));
        assert_eq!(active.len(), 1);
        assert_eq!(active[0]["status"], "active");
        assert_eq!(active[0]["version"], 2);
        assert_eq!(active[0]["changeWaiting"], true);
        assert_eq!(active[0]["stepCount"], 2);
    }

    #[test]
    fn show_output_names_the_head_a_write_must_cite() {
        let (event, head) = playbook_head(PlaybookStatus::Active, true);
        let output = show_output(&event, &head, Vec::new());
        assert_eq!(output["headEventId"], event.id.to_hex());
        assert_eq!(output["pending"]["revision"], 3);
        assert_eq!(output["current"]["steps"][0]["stepId"], "brief");
    }

    #[test]
    fn job_rows_show_the_current_step_and_filter() {
        let heads = vec![job_head(JobStatus::Running), job_head(JobStatus::Completed)];
        let all = job_rows(&heads, None, None);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["currentStepId"], "approval");
        assert_eq!(all[0]["stepsDone"], 1);
        assert_eq!(all[0]["stepCount"], 2);
        assert_eq!(
            job_rows(&heads, None, Some(JobStatusArg::Completed)).len(),
            1
        );
        assert_eq!(job_rows(&heads, Some("other"), None).len(), 0);
        assert_eq!(job_rows(&heads, Some(PLAYBOOK_ID), None).len(), 2);
    }

    #[test]
    fn approval_rows_list_who_decided_what_when_oldest_first() {
        let records = Records {
            playbooks: vec![playbook_head(PlaybookStatus::Active, false)],
            jobs: vec![job_head(JobStatus::Running)],
        };
        let rows = approval_rows(&records, None);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["scope"], "playbook");
        assert_eq!(rows[0]["decision"], "approved");
        assert_eq!(rows[0]["actorPubkey"], "b".repeat(64));
        assert_eq!(rows[1]["scope"], "job_step");
        assert_eq!(rows[1]["stepId"], "approval");
        assert_eq!(rows[1]["jobTitle"], "Plane Tree Guesthouse");
        assert_eq!(approval_rows(&records, Some("other")).len(), 0);
    }
}
