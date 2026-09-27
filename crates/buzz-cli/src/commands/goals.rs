use buzz_core::company_records::{
    GoalAction, GoalActionKind, GoalHead, GoalProgress, GoalRecord, GoalStatus,
    COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_GOAL_HEAD;
use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::client::{
    normalize_events, normalize_write_response, print_create_response, BuzzClient,
};
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, sdk_err};

const GOAL_QUERY_BOUND: u32 = 10_000;

pub async fn dispatch(cmd: crate::GoalsCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::GoalsCmd;
    match cmd {
        GoalsCmd::Create {
            community_id,
            record,
        } => cmd_create(client, &community_id, &record).await,
        GoalsCmd::Update { goal, record } => cmd_update(client, &goal, &record).await,
        GoalsCmd::Progress { goal, progress } => cmd_progress(client, &goal, &progress).await,
        GoalsCmd::Status {
            goal,
            status,
            reason,
        } => cmd_status(client, &goal, &status, &reason).await,
        GoalsCmd::Archive { goal, reason } => cmd_archive(client, &goal, &reason).await,
        GoalsCmd::Restore { goal } => cmd_restore(client, &goal).await,
        GoalsCmd::Delete { goal, reason } => cmd_delete(client, &goal, &reason).await,
        GoalsCmd::List { limit } => cmd_list(client, limit).await,
        GoalsCmd::Get { goal } => cmd_get(client, &goal).await,
    }
}

async fn cmd_create(
    client: &BuzzClient,
    community_id: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let community_id = parse_uuid(community_id)?;
    let record: GoalRecord = read_json(record_input, "goal record")?;
    let goal_id = record.goal_id;
    let action = GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id,
        action: GoalActionKind::Create,
        expected_head_event_id: None,
        goal: Some(record),
        progress: None,
        status: None,
        reason: None,
    };
    let builder =
        buzz_sdk::company_records::build_goal_action(community_id, &action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    print_create_response(&response, "goal_id", &goal_id.to_string());
    Ok(())
}

async fn cmd_update(
    client: &BuzzClient,
    goal_id: &str,
    record_input: &str,
) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let record: GoalRecord = read_json(record_input, "goal record")?;
    if record.goal_id != goal_id {
        return Err(CliError::Usage(
            "GoalRecord.goalId must match --goal".into(),
        ));
    }
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::Update,
        event_id(&event)?,
        Some(record),
        None,
        None,
        None,
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_progress(
    client: &BuzzClient,
    goal_id: &str,
    progress_input: &str,
) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let progress: GoalProgress = read_json(progress_input, "goal progress")?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::Progress,
        event_id(&event)?,
        None,
        Some(progress),
        None,
        None,
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_status(
    client: &BuzzClient,
    goal_id: &str,
    status: &str,
    reason: &str,
) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let status = parse_status(status)?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::SetStatus,
        event_id(&event)?,
        None,
        None,
        Some(status),
        Some(reason.to_owned()),
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_archive(client: &BuzzClient, goal_id: &str, reason: &str) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::Archive,
        event_id(&event)?,
        None,
        None,
        None,
        Some(reason.to_owned()),
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_restore(client: &BuzzClient, goal_id: &str) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::Restore,
        event_id(&event)?,
        None,
        None,
        None,
        None,
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_delete(client: &BuzzClient, goal_id: &str, reason: &str) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    let community_id = community_id_from_event(&event, goal_id)?;
    let action = action_with_head(
        goal_id,
        GoalActionKind::Delete,
        event_id(&event)?,
        None,
        None,
        None,
        Some(reason.to_owned()),
    );
    submit_action(client, community_id, &action).await
}

async fn cmd_list(client: &BuzzClient, limit: Option<u32>) -> Result<(), CliError> {
    let limit = limit.unwrap_or(GOAL_QUERY_BOUND).min(GOAL_QUERY_BOUND) as usize;
    let mut events = query_goal_events(client).await?;
    events.truncate(limit);
    println!("{}", normalize_events(&events));
    Ok(())
}

async fn cmd_get(client: &BuzzClient, goal_id: &str) -> Result<(), CliError> {
    let goal_id = parse_uuid(goal_id)?;
    let (event, _) = current_goal_event(client, goal_id).await?;
    println!("{}", normalize_events(std::slice::from_ref(&event)));
    Ok(())
}

async fn query_goal_events(client: &BuzzClient) -> Result<Vec<Value>, CliError> {
    client
        .query_all_bounded(
            serde_json::json!({ "kinds": [KIND_GOAL_HEAD] }),
            GOAL_QUERY_BOUND,
        )
        .await
}

async fn current_goal_event(
    client: &BuzzClient,
    goal_id: Uuid,
) -> Result<(Value, GoalHead), CliError> {
    for event in query_goal_events(client).await? {
        let head = parse_goal_head(&event)?;
        if head.goal_id == goal_id {
            return Ok((event, head));
        }
    }
    Err(CliError::NotFound(format!("goal {goal_id} not found")))
}

async fn submit_action(
    client: &BuzzClient,
    community_id: Uuid,
    action: &GoalAction,
) -> Result<(), CliError> {
    let builder =
        buzz_sdk::company_records::build_goal_action(community_id, action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

fn action_with_head(
    goal_id: Uuid,
    action: GoalActionKind,
    expected_head_event_id: String,
    goal: Option<GoalRecord>,
    progress: Option<GoalProgress>,
    status: Option<GoalStatus>,
    reason: Option<String>,
) -> GoalAction {
    GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id,
        action,
        expected_head_event_id: Some(expected_head_event_id),
        goal,
        progress,
        status,
        reason,
    }
}

fn parse_goal_head(event: &Value) -> Result<GoalHead, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("goal head event has no string content".into()))?;
    serde_json::from_str(content)
        .map_err(|error| CliError::Other(format!("goal head content is invalid: {error}")))
}

fn event_id(event: &Value) -> Result<String, CliError> {
    event
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CliError::Other("goal head event has no id".into()))
}

fn community_id_from_event(event: &Value, goal_id: Uuid) -> Result<Uuid, CliError> {
    let d_tag = crate::client::extract_d_tag(event);
    let parts = d_tag.split(':').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != "company" || parts[2] != "goal" {
        return Err(CliError::Other(
            "goal head has an invalid company d-tag".into(),
        ));
    }
    let community_id = parse_uuid(parts[1])?;
    let d_goal_id = parse_uuid(parts[3])?;
    if d_goal_id != goal_id {
        return Err(CliError::Other(
            "goal head d-tag does not match its goalId".into(),
        ));
    }
    Ok(community_id)
}

fn parse_status(value: &str) -> Result<GoalStatus, CliError> {
    match value {
        "active" => Ok(GoalStatus::Active),
        "off_pace" => Ok(GoalStatus::OffPace),
        "achieved" => Ok(GoalStatus::Achieved),
        _ => Err(CliError::Usage(
            "status must be active, off_pace, or achieved".into(),
        )),
    }
}

fn read_json<T: DeserializeOwned>(input: &str, label: &str) -> Result<T, CliError> {
    let json = read_or_stdin(input)?;
    serde_json::from_str(&json)
        .map_err(|error| CliError::Usage(format!("invalid {label} JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_accepts_only_explicit_goal_statuses() {
        assert_eq!(parse_status("active").unwrap(), GoalStatus::Active);
        assert_eq!(parse_status("off_pace").unwrap(), GoalStatus::OffPace);
        assert_eq!(parse_status("achieved").unwrap(), GoalStatus::Achieved);
        assert!(parse_status("archived").is_err());
        assert!(parse_status("deleted").is_err());
    }

    #[test]
    fn goal_event_coordinate_must_match_the_requested_goal() {
        let event = serde_json::json!({
            "tags": [["d", "company:00000000-0000-0000-0000-000000000001:goal:00000000-0000-0000-0000-000000000002"]]
        });
        assert_eq!(
            community_id_from_event(&event, Uuid::from_u128(2)).unwrap(),
            Uuid::from_u128(1)
        );
        assert!(community_id_from_event(&event, Uuid::from_u128(3)).is_err());
    }
}
