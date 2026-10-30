//! Agent-first commands for co-founder plans.
//!
//! `colony plans propose` sends a typed plan for the owner to approve, edit or
//! reject. An approved plan runs without more asks except at its approval
//! points; `colony plans step` and `request-approval` move the steps along.
//! Approving, rejecting and cancelling are for the owner or an admin: the relay
//! refuses them from an agent.

use buzz_core::company_plans::{
    plan_d_tag, validate_plan_head, validate_plan_proposal, PlanAction, PlanActionKind, PlanHead,
    PlanProposal, PlanStatus, PlanStepStatus,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_PLAN_HEAD;
use nostr::Event;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::BuzzClient;
use crate::commands::cofounder::{head_d_tag, map_write_error, query_company_heads, relay_self};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::{PlanStatusArg, PlanStepStatusArg, PlansCmd};

/// Upper bound on plan heads one query may return.
const PLAN_HEAD_QUERY_BOUND: u32 = 500;
/// Largest plan file the CLI reads.
const MAX_PLAN_FILE_BYTES: usize = 128 * 1024;

pub async fn dispatch(command: PlansCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        PlansCmd::Propose { file } => {
            let plan = read_plan_file(&file)?;
            let plan_id = Uuid::new_v4().to_string();
            let action = PlanAction {
                plan: Some(plan),
                expected_head_event_id: None,
                ..base_action(&plan_id, PlanActionKind::Propose)
            };
            let response = submit(client, &action).await?;
            let mut output: Value =
                serde_json::from_str(&response).unwrap_or_else(|_| json!({ "raw": response }));
            if let Some(object) = output.as_object_mut() {
                object.insert("planId".into(), json!(plan_id));
            }
            println!("{output}");
            Ok(())
        }
        PlansCmd::List { status } => {
            let heads = load_all_heads(client).await?;
            println!("{}", Value::Array(list_rows(&heads, status)));
            Ok(())
        }
        PlansCmd::Show { plan_id } => {
            let (event, head) = load_one(client, &plan_id).await?;
            println!("{}", show_output(&event, &head));
            Ok(())
        }
        PlansCmd::Approvals { plan } => {
            let heads = match plan {
                Some(plan_id) => {
                    let (event, head) = load_one(client, &plan_id).await?;
                    vec![(event, head)]
                }
                None => load_all_heads(client).await?,
            };
            println!("{}", Value::Array(approval_rows(&heads)));
            Ok(())
        }
        PlansCmd::Revise { plan_id, file } => {
            let plan = read_plan_file(&file)?;
            let (event, _) = load_one(client, &plan_id).await?;
            let action = PlanAction {
                plan: Some(plan),
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_action(&plan_id, PlanActionKind::Revise)
            };
            write(client, &action).await
        }
        PlansCmd::Step {
            plan_id,
            step_id,
            status,
            note,
        } => {
            let (event, _) = load_one(client, &plan_id).await?;
            let action = PlanAction {
                step_id: Some(step_id),
                step_status: Some(status.into()),
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_action(&plan_id, PlanActionKind::UpdateStep)
            };
            write(client, &action).await
        }
        PlansCmd::RequestApproval {
            plan_id,
            step_id,
            note,
        } => {
            step_action(
                client,
                plan_id,
                step_id,
                note,
                PlanActionKind::RequestStepApproval,
            )
            .await
        }
        PlansCmd::ApproveStep {
            plan_id,
            step_id,
            note,
        } => step_action(client, plan_id, step_id, note, PlanActionKind::ApproveStep).await,
        PlansCmd::RejectStep {
            plan_id,
            step_id,
            note,
        } => step_action(client, plan_id, step_id, note, PlanActionKind::RejectStep).await,
        PlansCmd::Approve {
            plan_id,
            revision,
            note,
        } => decide(client, plan_id, revision, note, PlanActionKind::Approve).await,
        PlansCmd::Reject {
            plan_id,
            revision,
            note,
        } => decide(client, plan_id, revision, note, PlanActionKind::Reject).await,
        PlansCmd::Cancel { plan_id, note } => {
            let (event, _) = load_one(client, &plan_id).await?;
            let action = PlanAction {
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base_action(&plan_id, PlanActionKind::Cancel)
            };
            write(client, &action).await
        }
    }
}

impl From<PlanStepStatusArg> for PlanStepStatus {
    fn from(value: PlanStepStatusArg) -> Self {
        match value {
            PlanStepStatusArg::InProgress => PlanStepStatus::InProgress,
            PlanStepStatusArg::Done => PlanStepStatus::Done,
            PlanStepStatusArg::Skipped => PlanStepStatus::Skipped,
            PlanStepStatusArg::Failed => PlanStepStatus::Failed,
        }
    }
}

impl From<PlanStatusArg> for PlanStatus {
    fn from(value: PlanStatusArg) -> Self {
        match value {
            PlanStatusArg::Proposed => PlanStatus::Proposed,
            PlanStatusArg::Approved => PlanStatus::Approved,
            PlanStatusArg::Completed => PlanStatus::Completed,
            PlanStatusArg::Rejected => PlanStatus::Rejected,
            PlanStatusArg::Cancelled => PlanStatus::Cancelled,
        }
    }
}

fn base_action(plan_id: &str, kind: PlanActionKind) -> PlanAction {
    PlanAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        plan_id: plan_id.to_owned(),
        kind,
        plan: None,
        revision: None,
        step_id: None,
        step_status: None,
        note: None,
        expected_head_event_id: None,
    }
}

async fn step_action(
    client: &BuzzClient,
    plan_id: String,
    step_id: String,
    note: Option<String>,
    kind: PlanActionKind,
) -> Result<(), CliError> {
    let (event, _) = load_one(client, &plan_id).await?;
    let action = PlanAction {
        step_id: Some(step_id),
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base_action(&plan_id, kind)
    };
    write(client, &action).await
}

/// Approve or reject the revision the caller names, or the current one.
async fn decide(
    client: &BuzzClient,
    plan_id: String,
    revision: Option<u32>,
    note: Option<String>,
    kind: PlanActionKind,
) -> Result<(), CliError> {
    let (event, head) = load_one(client, &plan_id).await?;
    let action = PlanAction {
        revision: Some(revision.unwrap_or(head.revision)),
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base_action(&plan_id, kind)
    };
    write(client, &action).await
}

async fn submit(client: &BuzzClient, action: &PlanAction) -> Result<String, CliError> {
    let builder = buzz_sdk::company_plans::build_plan_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "plan changed before it was saved")
}

async fn write(client: &BuzzClient, action: &PlanAction) -> Result<(), CliError> {
    println!("{}", submit(client, action).await?);
    Ok(())
}

/// Reads a plan proposal from a file (`-` reads stdin) and checks it before
/// anything is sent.
pub(crate) fn read_plan_file(path: &str) -> Result<PlanProposal, CliError> {
    let text = if path == "-" {
        use std::io::Read;
        let mut text = String::new();
        std::io::stdin()
            .lock()
            .take(MAX_PLAN_FILE_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|error| {
                CliError::Usage(format!("could not read the plan from stdin: {error}"))
            })?;
        text
    } else {
        std::fs::read_to_string(path)
            .map_err(|error| CliError::Usage(format!("could not read {path}: {error}")))?
    };
    parse_plan_text(&text)
}

pub(crate) fn parse_plan_text(text: &str) -> Result<PlanProposal, CliError> {
    if text.len() > MAX_PLAN_FILE_BYTES {
        return Err(CliError::Usage(format!(
            "the plan file is larger than {MAX_PLAN_FILE_BYTES} bytes"
        )));
    }
    let plan = serde_json::from_str::<PlanProposal>(text)
        .map_err(|error| CliError::Usage(format!("the plan is not valid plan JSON: {error}")))?;
    validate_plan_proposal(&plan, true)
        .map_err(|error| CliError::Usage(format!("the plan is not valid: {error}")))?;
    Ok(plan)
}

async fn load_all_heads(client: &BuzzClient) -> Result<Vec<(Event, PlanHead)>, CliError> {
    let relay_self = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [KIND_PLAN_HEAD], "authors": [relay_self]}),
            PLAN_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut heads = Vec::with_capacity(raw.len());
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("plan head is malformed: {error}")))?;
        heads.push(verify_plan_head(event, &relay_self)?);
    }
    heads.sort_by(|(_, first), (_, second)| {
        second
            .updated_at
            .cmp(&first.updated_at)
            .then_with(|| first.plan_id.cmp(&second.plan_id))
    });
    Ok(heads)
}

async fn load_one(client: &BuzzClient, plan_id: &str) -> Result<(Event, PlanHead), CliError> {
    let d_tag = plan_d_tag(plan_id).map_err(|error| CliError::Usage(error.to_string()))?;
    let events = query_company_heads(client, KIND_PLAN_HEAD, &[d_tag]).await?;
    let event = events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound(format!("no plan {plan_id}")))?;
    let relay_self = relay_self(client).await?;
    verify_plan_head(event, &relay_self)
}

fn verify_plan_head(event: Event, relay_self: &str) -> Result<(Event, PlanHead), CliError> {
    if u32::from(event.kind.as_u16()) != KIND_PLAN_HEAD || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "plan head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("plan head signature is invalid: {error}")))?;
    let head = serde_json::from_str::<PlanHead>(&event.content)
        .map_err(|error| CliError::Other(format!("plan head content is invalid: {error}")))?;
    validate_plan_head(&head)
        .map_err(|error| CliError::Other(format!("plan head is invalid: {error}")))?;
    let d_tag = plan_d_tag(&head.plan_id)
        .map_err(|error| CliError::Other(format!("plan head id is invalid: {error}")))?;
    if d_tag != head_d_tag(&event) {
        return Err(CliError::Other("plan head does not match its d-tag".into()));
    }
    Ok((event, head))
}

/// One compact row per plan, newest first, optionally limited to one status.
pub(crate) fn list_rows(heads: &[(Event, PlanHead)], status: Option<PlanStatusArg>) -> Vec<Value> {
    let wanted = status.map(PlanStatus::from);
    heads
        .iter()
        .filter(|(_, head)| wanted.is_none_or(|status| head.status == status))
        .map(|(event, head)| {
            json!({
                "planId": head.plan_id,
                "title": head.plan.title,
                "status": head.status,
                "revision": head.revision,
                "function": head.plan.function,
                "proposedByPubkey": head.proposed_by_pubkey,
                "updatedAt": head.updated_at,
                "headEventId": event.id.to_hex(),
                "steps": head.plan.steps.iter().map(|step| json!({
                    "stepId": step.step_id,
                    "title": step.title,
                    "status": step.status,
                })).collect::<Vec<_>>(),
            })
        })
        .collect()
}

/// The full plan plus the head event id a write must name.
pub(crate) fn show_output(event: &Event, head: &PlanHead) -> Value {
    json!({
        "headEventId": event.id.to_hex(),
        "planId": head.plan_id,
        "status": head.status,
        "revision": head.revision,
        "plan": head.plan,
        "proposedByPubkey": head.proposed_by_pubkey,
        "proposedAt": head.proposed_at,
        "updatedByPubkey": head.updated_by_pubkey,
        "updatedAt": head.updated_at,
        "approvals": head.approvals,
    })
}

/// Every approval record of the given plans, oldest first: who decided what and when.
pub(crate) fn approval_rows(heads: &[(Event, PlanHead)]) -> Vec<Value> {
    let mut rows: Vec<(i64, Value)> = heads
        .iter()
        .flat_map(|(_, head)| {
            head.approvals.iter().map(move |record| {
                (
                    record.at,
                    json!({
                        "planId": head.plan_id,
                        "planTitle": head.plan.title,
                        "scope": record.scope,
                        "stepId": record.step_id,
                        "decision": record.decision,
                        "actorPubkey": record.actor_pubkey,
                        "at": record.at,
                        "revision": record.revision,
                        "note": record.note,
                        "actionEventId": record.action_event_id,
                    }),
                )
            })
        })
        .collect();
    rows.sort_by_key(|(at, _)| *at);
    rows.into_iter().map(|(_, row)| row).collect()
}

#[cfg(test)]
mod tests {
    use buzz_core::company_plans::{PlanApprovalRecord, PlanApprovalScope, PlanDecision};
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    const PLAN_ID: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn proposal_json() -> String {
        json!({
            "title": "Get 5 clients",
            "summary": "",
            "currency": "ZAR",
            "steps": [{
                "stepId": "find",
                "title": "Find guesthouses",
                "owner": { "kind": "function", "function": "sales" },
                "costLabel": "Free",
                "whenLabel": "This week",
                "status": "pending"
            }]
        })
        .to_string()
    }

    fn plan_head(status: PlanStatus, approvals: Vec<PlanApprovalRecord>) -> (Event, PlanHead) {
        let plan = parse_plan_text(&proposal_json()).expect("proposal");
        let head = PlanHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            plan_id: PLAN_ID.to_owned(),
            status,
            revision: 3,
            plan,
            proposed_by_pubkey: "a".repeat(64),
            proposed_at: 1_700_000_000,
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1_700_000_100,
            approvals,
            source_action_event_id: "c".repeat(64),
        };
        let event = EventBuilder::new(
            Kind::Custom(KIND_PLAN_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tag(Tag::parse(["d", plan_d_tag(PLAN_ID).expect("d").as_str()]).expect("d tag"))
        .sign_with_keys(&Keys::generate())
        .expect("sign head");
        (event, head)
    }

    #[test]
    fn plan_file_must_be_a_valid_proposal() {
        assert!(parse_plan_text(&proposal_json()).is_ok());
        assert!(parse_plan_text("{}").is_err());
        assert!(parse_plan_text("not json").is_err());
        // Unknown keys are refused, the same as on the relay.
        let mut value: Value = serde_json::from_str(&proposal_json()).unwrap();
        value["surprise"] = json!(true);
        assert!(parse_plan_text(&value.to_string()).is_err());
        // A worker step that spends is refused before anything is sent.
        let mut value: Value = serde_json::from_str(&proposal_json()).unwrap();
        value["steps"][0]["owner"] = json!({ "kind": "worker", "workerType": "research" });
        value["steps"][0]["costEstimateCents"] = json!(500);
        assert!(parse_plan_text(&value.to_string()).is_err());
    }

    #[test]
    fn plans_commands_parse() {
        let ok = parse(&["plans", "propose", "--file", "plan.json"]).expect("propose");
        assert!(matches!(ok.command, Cmd::Plans(PlansCmd::Propose { .. })));
        assert!(parse(&["plans", "propose"]).is_err());
        let step =
            parse(&["plans", "step", PLAN_ID, "find", "--status", "in_progress"]).expect("step");
        assert!(matches!(step.command, Cmd::Plans(PlansCmd::Step { .. })));
        assert!(parse(&["plans", "step", PLAN_ID, "find"]).is_err());
        assert!(parse(&["plans", "step", PLAN_ID, "find", "--status", "pending"]).is_err());
        assert!(parse(&["plans", "list", "--status", "approved"]).is_ok());
        assert!(parse(&["plans", "approve", PLAN_ID, "--revision", "2"]).is_ok());
        assert!(parse(&["plans", "approvals"]).is_ok());
    }

    #[test]
    fn list_rows_filter_by_status() {
        let heads = vec![
            plan_head(PlanStatus::Proposed, vec![]),
            plan_head(PlanStatus::Approved, vec![]),
        ];
        assert_eq!(list_rows(&heads, None).len(), 2);
        let approved = list_rows(&heads, Some(PlanStatusArg::Approved));
        assert_eq!(approved.len(), 1);
        assert_eq!(approved[0]["status"], "approved");
        assert_eq!(approved[0]["steps"][0]["stepId"], "find");
    }

    #[test]
    fn show_output_names_the_head_a_write_must_cite() {
        let (event, head) = plan_head(PlanStatus::Proposed, vec![]);
        let output = show_output(&event, &head);
        assert_eq!(output["headEventId"], event.id.to_hex());
        assert_eq!(output["revision"], 3);
        assert_eq!(output["plan"]["steps"][0]["status"], "pending");
    }

    #[test]
    fn approval_rows_list_who_decided_what_when_oldest_first() {
        let record = |at: i64, decision: PlanDecision, step: Option<&str>| PlanApprovalRecord {
            scope: if step.is_some() {
                PlanApprovalScope::Step
            } else {
                PlanApprovalScope::Plan
            },
            step_id: step.map(str::to_owned),
            decision,
            actor_pubkey: "b".repeat(64),
            at,
            revision: 3,
            note: None,
            action_event_id: "d".repeat(64),
        };
        let heads = vec![plan_head(
            PlanStatus::Approved,
            vec![
                record(1_700_000_050, PlanDecision::Approved, None),
                record(1_700_000_020, PlanDecision::Edited, None),
                record(1_700_000_090, PlanDecision::Approved, Some("find")),
            ],
        )];
        let rows = approval_rows(&heads);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["decision"], "edited");
        assert_eq!(rows[1]["decision"], "approved");
        assert_eq!(rows[2]["scope"], "step");
        assert_eq!(rows[2]["stepId"], "find");
        assert_eq!(rows[2]["actorPubkey"], "b".repeat(64));
        assert_eq!(rows[2]["planTitle"], "Get 5 clients");
    }
}
