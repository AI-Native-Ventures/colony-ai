//! Agent-first commands for employee duties and structured lessons.

use buzz_core::company_duties::{
    duty_d_tag, validate_duty_action, validate_duty_head, validate_duty_proposal, DutyAction,
    DutyActionKind, DutyHead, DutyProposal,
};
use buzz_core::company_lessons::{
    lesson_d_tag, validate_lesson_action, validate_lesson_head, validate_lesson_snapshot,
    LessonAction, LessonActionKind, LessonConfidence, LessonHead, LessonSnapshot,
};
use buzz_core::company_records::{
    AskAction, AskActionKind, AskCategory, AskRecord, AskSubject, AskSubjectKind, AskType,
    COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_DUTY_HEAD, KIND_LESSON_HEAD};
use nostr::{Event, Kind};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::{DutiesCmd, LessonConfidenceArg, LessonsCmd};

const COMPANY_HEAD_QUERY_BOUND: u32 = 10_000;

pub async fn dispatch_duties(command: DutiesCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        DutiesCmd::Propose {
            channel,
            thread_root,
            proposal,
        } => propose_duty(client, &channel, &thread_root, &proposal).await,
        DutiesCmd::List { employee, limit } => {
            list_duties(client, employee.as_deref(), limit).await
        }
        DutiesCmd::Get { duty, runs } => get_duty(client, &duty, runs).await,
        DutiesCmd::Update { duty, proposal } => update_duty(client, &duty, &proposal).await,
        DutiesCmd::Pause { duty } => change_duty_status(client, &duty, DutyActionKind::Pause).await,
        DutiesCmd::Resume { duty } => {
            change_duty_status(client, &duty, DutyActionKind::Resume).await
        }
        DutiesCmd::Delete { duty } => {
            change_duty_status(client, &duty, DutyActionKind::Delete).await
        }
    }
}

pub async fn dispatch_lessons(command: LessonsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        LessonsCmd::Create { employee, record } => create_lesson(client, &employee, &record).await,
        LessonsCmd::List { employee, limit } => {
            list_lessons(client, employee.as_deref(), limit).await
        }
        LessonsCmd::Get { lesson } => get_lesson(client, &lesson).await,
        LessonsCmd::Update { lesson, record } => update_lesson(client, &lesson, &record).await,
        LessonsCmd::Approve { lesson, confidence } => {
            approve_lesson(client, &lesson, confidence).await
        }
        LessonsCmd::Deprecate { lesson } => {
            change_lesson_status(client, &lesson, LessonActionKind::Deprecate).await
        }
        LessonsCmd::Restore { lesson } => {
            change_lesson_status(client, &lesson, LessonActionKind::RestoreCandidate).await
        }
    }
}

async fn propose_duty(
    client: &BuzzClient,
    channel: &str,
    thread_root: &str,
    proposal_input: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let thread_root = parse_event_id(thread_root)?;
    let proposal: DutyProposal = read_json(proposal_input, "duty proposal")?;
    validate_duty_proposal(&proposal)
        .map_err(|error| CliError::Usage(format!("invalid duty proposal: {error}")))?;
    if proposal.channel_id != channel_id {
        return Err(CliError::Usage(
            "DutyProposal.channelId must match --channel".into(),
        ));
    }
    let ask_id = Uuid::new_v4();
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Duty,
        title: proposal.title.clone(),
        body: None,
        thread_root_event_id: thread_root,
        addressee_pubkey: None,
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: Some(AskSubject {
            kind: AskSubjectKind::Duty,
            id: proposal.duty_id.to_string(),
        }),
        member_proposal: None,
        secret_request: None,
        hire_proposal: None,
        duty_proposal: Some(proposal),
    };
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    let builder =
        buzz_sdk::asks::build_ask_action(channel_id, &action).map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    let response = client.submit_event(event).await?;
    let normalized = accepted_response(&response, "duty proposal changed before it was accepted")?;
    println!(
        "{}",
        json!({
            "accepted": true,
            "event_id": event_id,
            "ask_id": ask_id,
            "duty_id": action.ask.as_ref().and_then(|ask| ask.duty_proposal.as_ref()).map(|proposal| proposal.duty_id),
            "relay_response": normalized,
        })
    );
    Ok(())
}

async fn list_duties(
    client: &BuzzClient,
    employee: Option<&str>,
    limit: Option<u32>,
) -> Result<(), CliError> {
    let employee = employee.map(normalize_pubkey).transpose()?;
    let limit = normalize_limit(limit);
    let page = query_heads(client, KIND_DUTY_HEAD, None, employee.as_deref(), limit).await?;
    let relay_self = relay_self(client).await?;
    let duties = page
        .events
        .into_iter()
        .map(|raw| {
            let event = parse_relay_head(raw, KIND_DUTY_HEAD, &relay_self)?;
            let head = parse_duty_head(&event)?;
            verify_duty_head_coordinates(&event, &head, employee.as_deref())?;
            Ok(json!({"event_id": event.id.to_hex(), "head": head}))
        })
        .collect::<Result<Vec<_>, CliError>>()?;
    println!("{}", json!({"duties": duties, "has_more": page.has_more}));
    Ok(())
}

async fn get_duty(client: &BuzzClient, duty: &str, runs: Option<u32>) -> Result<(), CliError> {
    let duty_id = parse_uuid(duty)?;
    let (event, head) = current_duty_head(client, duty_id).await?;
    let run_history =
        crate::commands::workflows::load_workflow_runs(client, &duty_id.to_string(), runs).await?;
    println!(
        "{}",
        json!({
            "event_id": event.id.to_hex(),
            "head": head,
            "run_history": run_history,
        })
    );
    Ok(())
}

async fn update_duty(
    client: &BuzzClient,
    duty: &str,
    proposal_input: &str,
) -> Result<(), CliError> {
    let duty_id = parse_uuid(duty)?;
    let (current_event, current) = current_duty_event(client, duty_id).await?;
    if current.status == buzz_core::company_duties::DutyStatus::Deleted {
        return Err(CliError::Conflict("a deleted duty cannot be edited".into()));
    }
    let proposal: DutyProposal = read_json(proposal_input, "duty proposal")?;
    validate_duty_proposal(&proposal)
        .map_err(|error| CliError::Usage(format!("invalid duty proposal: {error}")))?;
    if proposal.duty_id != duty_id || proposal.employee_pubkey != current.proposal.employee_pubkey {
        return Err(CliError::Usage(
            "DutyProposal.dutyId and employeePubkey must match the current duty".into(),
        ));
    }
    let action = DutyAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id,
        action: DutyActionKind::Update,
        expected_head_event_id: current_event.id.to_hex(),
        proposal: Some(proposal),
        reason: None,
    };
    submit_duty_action(client, &action, &current.proposal.employee_pubkey).await
}

async fn change_duty_status(
    client: &BuzzClient,
    duty: &str,
    action_kind: DutyActionKind,
) -> Result<(), CliError> {
    let duty_id = parse_uuid(duty)?;
    let (event, head) = current_duty_event(client, duty_id).await?;
    let action = DutyAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id,
        action: action_kind,
        expected_head_event_id: event.id.to_hex(),
        proposal: None,
        reason: None,
    };
    submit_duty_action(client, &action, &head.proposal.employee_pubkey).await
}

async fn submit_duty_action(
    client: &BuzzClient,
    action: &DutyAction,
    employee_pubkey: &str,
) -> Result<(), CliError> {
    validate_duty_action(action)
        .map_err(|error| CliError::Usage(format!("invalid duty action: {error}")))?;
    let builder = buzz_sdk::company_duties::build_duty_action(action, employee_pubkey)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    let response = client.submit_event(event).await?;
    let normalized = accepted_response(&response, "duty changed before the action committed")?;
    println!(
        "{}",
        json!({
            "accepted": true,
            "event_id": event_id,
            "duty_id": action.duty_id,
            "action": action.action,
            "relay_response": normalized,
        })
    );
    Ok(())
}

async fn create_lesson(
    client: &BuzzClient,
    employee: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let employee = normalize_pubkey(employee)?;
    let snapshot: LessonSnapshot = read_json(record_input, "lesson snapshot")?;
    validate_lesson_snapshot(&snapshot)
        .map_err(|error| CliError::Usage(format!("invalid lesson snapshot: {error}")))?;
    if snapshot.employee_pubkey != employee {
        return Err(CliError::Usage(
            "LessonSnapshot.employeePubkey must match --employee".into(),
        ));
    }
    let action = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id: snapshot.lesson_id,
        action: LessonActionKind::Create,
        expected_head_event_id: None,
        snapshot: Some(snapshot),
        confidence: None,
    };
    submit_lesson_action(client, &action, &employee).await
}

async fn list_lessons(
    client: &BuzzClient,
    employee: Option<&str>,
    limit: Option<u32>,
) -> Result<(), CliError> {
    let employee = employee.map(normalize_pubkey).transpose()?;
    let limit = normalize_limit(limit);
    let page = query_heads(client, KIND_LESSON_HEAD, None, employee.as_deref(), limit).await?;
    let relay_self = relay_self(client).await?;
    let lessons = page
        .events
        .into_iter()
        .map(|raw| {
            let event = parse_relay_head(raw, KIND_LESSON_HEAD, &relay_self)?;
            let head = parse_lesson_head(&event)?;
            verify_lesson_head_coordinates(&event, &head, employee.as_deref())?;
            Ok(json!({"event_id": event.id.to_hex(), "head": head}))
        })
        .collect::<Result<Vec<_>, CliError>>()?;
    println!("{}", json!({"lessons": lessons, "has_more": page.has_more}));
    Ok(())
}

async fn get_lesson(client: &BuzzClient, lesson: &str) -> Result<(), CliError> {
    let lesson_id = parse_uuid(lesson)?;
    let (event, head) = current_lesson_event(client, lesson_id).await?;
    println!("{}", json!({"event_id": event.id.to_hex(), "head": head}));
    Ok(())
}

async fn update_lesson(
    client: &BuzzClient,
    lesson: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let lesson_id = parse_uuid(lesson)?;
    let (event, head) = current_lesson_event(client, lesson_id).await?;
    if head.status == buzz_core::company_lessons::LessonStatus::Deprecated {
        return Err(CliError::Conflict(
            "a deprecated lesson cannot be edited".into(),
        ));
    }
    let snapshot: LessonSnapshot = read_json(record_input, "lesson snapshot")?;
    validate_lesson_snapshot(&snapshot)
        .map_err(|error| CliError::Usage(format!("invalid lesson snapshot: {error}")))?;
    if snapshot.lesson_id != lesson_id || snapshot.employee_pubkey != head.snapshot.employee_pubkey
    {
        return Err(CliError::Usage(
            "LessonSnapshot identity and employee must match the current lesson".into(),
        ));
    }
    let action = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: LessonActionKind::Update,
        expected_head_event_id: Some(event.id.to_hex()),
        snapshot: Some(snapshot),
        confidence: None,
    };
    submit_lesson_action(client, &action, &head.snapshot.employee_pubkey).await
}

async fn approve_lesson(
    client: &BuzzClient,
    lesson: &str,
    confidence: LessonConfidenceArg,
) -> Result<(), CliError> {
    let lesson_id = parse_uuid(lesson)?;
    let (event, head) = current_lesson_event(client, lesson_id).await?;
    let confidence = match confidence {
        LessonConfidenceArg::Low => LessonConfidence::Low,
        LessonConfidenceArg::Moderate => LessonConfidence::Moderate,
        LessonConfidenceArg::High => LessonConfidence::High,
    };
    let action = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: LessonActionKind::Approve,
        expected_head_event_id: Some(event.id.to_hex()),
        snapshot: None,
        confidence: Some(confidence),
    };
    submit_lesson_action(client, &action, &head.snapshot.employee_pubkey).await
}

async fn change_lesson_status(
    client: &BuzzClient,
    lesson: &str,
    action_kind: LessonActionKind,
) -> Result<(), CliError> {
    let lesson_id = parse_uuid(lesson)?;
    let (event, head) = current_lesson_event(client, lesson_id).await?;
    let action = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: action_kind,
        expected_head_event_id: Some(event.id.to_hex()),
        snapshot: None,
        confidence: None,
    };
    submit_lesson_action(client, &action, &head.snapshot.employee_pubkey).await
}

async fn submit_lesson_action(
    client: &BuzzClient,
    action: &LessonAction,
    employee_pubkey: &str,
) -> Result<(), CliError> {
    validate_lesson_action(action)
        .map_err(|error| CliError::Usage(format!("invalid lesson action: {error}")))?;
    let builder = buzz_sdk::company_lessons::build_lesson_action(action, employee_pubkey)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    let response = client.submit_event(event).await?;
    let normalized = accepted_response(&response, "lesson changed before the action committed")?;
    println!(
        "{}",
        json!({
            "accepted": true,
            "event_id": event_id,
            "lesson_id": action.lesson_id,
            "action": action.action,
            "relay_response": normalized,
        })
    );
    Ok(())
}

async fn current_duty_event(
    client: &BuzzClient,
    duty_id: Uuid,
) -> Result<(Event, DutyHead), CliError> {
    let event = find_current_head(client, KIND_DUTY_HEAD, &duty_d_tag(duty_id)).await?;
    let head = parse_duty_head(&event)?;
    verify_duty_head_coordinates(&event, &head, None)?;
    Ok((event, head))
}

async fn current_duty_head(
    client: &BuzzClient,
    duty_id: Uuid,
) -> Result<(Event, DutyHead), CliError> {
    current_duty_event(client, duty_id).await
}

async fn current_lesson_event(
    client: &BuzzClient,
    lesson_id: Uuid,
) -> Result<(Event, LessonHead), CliError> {
    let event = find_current_head(client, KIND_LESSON_HEAD, &lesson_d_tag(lesson_id)).await?;
    let head = parse_lesson_head(&event)?;
    verify_lesson_head_coordinates(&event, &head, None)?;
    Ok((event, head))
}

async fn find_current_head(client: &BuzzClient, kind: u32, d_tag: &str) -> Result<Event, CliError> {
    let page = query_heads(client, kind, Some(d_tag), None, 2).await?;
    if page.events.len() > 1 {
        return Err(CliError::Other(
            "relay returned duplicate company record heads".into(),
        ));
    }
    let raw = page
        .events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound(format!("company record {d_tag} not found")))?;
    let relay_self = relay_self(client).await?;
    parse_relay_head(raw, kind, &relay_self)
}

async fn query_heads(
    client: &BuzzClient,
    kind: u32,
    d_tag: Option<&str>,
    employee: Option<&str>,
    limit: u32,
) -> Result<HeadPage, CliError> {
    let relay_self = relay_self(client).await?;
    let requested = limit.clamp(1, COMPANY_HEAD_QUERY_BOUND);
    let mut filter = json!({
        "kinds": [kind],
        "authors": [relay_self],
    });
    if let Some(d_tag) = d_tag {
        filter["#d"] = json!([d_tag]);
    }
    if let Some(employee) = employee {
        filter["#p"] = json!([employee]);
    }
    let events = client
        .query_paginated(filter, requested.saturating_add(1))
        .await?;
    let has_more = events.len() > requested as usize;
    let mut events = events;
    if has_more {
        events.truncate(requested as usize);
    }
    Ok(HeadPage { events, has_more })
}

struct HeadPage {
    events: Vec<Value>,
    has_more: bool,
}

fn parse_relay_head(raw: Value, kind: u32, relay_self: &str) -> Result<Event, CliError> {
    let event = serde_json::from_value::<Event>(raw)
        .map_err(|error| CliError::Other(format!("company record head is malformed: {error}")))?;
    if event.kind != Kind::Custom(kind as u16) || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "company record head has an unexpected kind or author".into(),
        ));
    }
    event.verify().map_err(|error| {
        CliError::Other(format!("company record head signature is invalid: {error}"))
    })?;
    Ok(event)
}

fn parse_duty_head(event: &Event) -> Result<DutyHead, CliError> {
    let head = serde_json::from_str::<DutyHead>(&event.content)
        .map_err(|error| CliError::Other(format!("duty head content is invalid: {error}")))?;
    validate_duty_head(&head)
        .map_err(|error| CliError::Other(format!("duty head is invalid: {error}")))?;
    Ok(head)
}

fn parse_lesson_head(event: &Event) -> Result<LessonHead, CliError> {
    let head = serde_json::from_str::<LessonHead>(&event.content)
        .map_err(|error| CliError::Other(format!("lesson head content is invalid: {error}")))?;
    validate_lesson_head(&head)
        .map_err(|error| CliError::Other(format!("lesson head is invalid: {error}")))?;
    Ok(head)
}

fn verify_duty_head_coordinates(
    event: &Event,
    head: &DutyHead,
    employee: Option<&str>,
) -> Result<(), CliError> {
    let d_tags = tag_values(event, "d");
    let p_tags = tag_values(event, "p");
    let expected_employee = employee.unwrap_or(&head.proposal.employee_pubkey);
    let expected_p_tags = std::slice::from_ref(&head.proposal.employee_pubkey);
    if event.tags.len() != 2
        || d_tags.as_slice() != [duty_d_tag(head.duty_id)]
        || p_tags.as_slice() != expected_p_tags
        || expected_employee != head.proposal.employee_pubkey
    {
        return Err(CliError::Other(
            "duty head tags do not match its employee and d-tag".into(),
        ));
    }
    Ok(())
}

fn verify_lesson_head_coordinates(
    event: &Event,
    head: &LessonHead,
    employee: Option<&str>,
) -> Result<(), CliError> {
    let d_tags = tag_values(event, "d");
    let p_tags = tag_values(event, "p");
    let expected_employee = employee.unwrap_or(&head.snapshot.employee_pubkey);
    let expected_p_tags = std::slice::from_ref(&head.snapshot.employee_pubkey);
    if event.tags.len() != 2
        || d_tags.as_slice() != [lesson_d_tag(head.lesson_id)]
        || p_tags.as_slice() != expected_p_tags
        || expected_employee != head.snapshot.employee_pubkey
    {
        return Err(CliError::Other(
            "lesson head tags do not match its employee and d-tag".into(),
        ));
    }
    Ok(())
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await?;
    let nip11: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("relay info is not valid JSON: {error}")))?;
    let value = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document is missing self".into()))?;
    normalize_pubkey(value).map_err(|_| CliError::Other("relay self key is invalid".into()))
}

fn tag_values(event: &Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == name)
        .filter_map(|tag| tag.content().map(str::to_owned))
        .collect()
}

fn normalize_pubkey(value: &str) -> Result<String, CliError> {
    nostr::PublicKey::from_hex(value)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid public key: {error}")))
}

fn normalize_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(500).clamp(1, COMPANY_HEAD_QUERY_BOUND)
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let content = crate::validate::read_or_stdin(input)?;
    serde_json::from_str(&content)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}

fn parse_uuid(value: &str) -> Result<Uuid, CliError> {
    crate::validate::parse_uuid(value)
}

fn parse_event_id(value: &str) -> Result<String, CliError> {
    nostr::EventId::parse(value)
        .map(|id| id.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid event id: {error}")))
}

fn accepted_response(response: &str, conflict_message: &str) -> Result<String, CliError> {
    crate::commands::parse_write_response(response, conflict_message)?;
    Ok(normalize_write_response(response))
}
