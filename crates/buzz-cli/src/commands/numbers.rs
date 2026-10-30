//! Agent-first commands for co-founder numbers: the scorecard per function,
//! goals per function and the Friday weekly review.
//!
//! Every figure comes from the relay, which counts the company's own records.
//! An agent cannot write a number: `colony numbers scorecard` asks the relay to
//! recompute and prints the result, `colony numbers goals propose` and
//! `colony numbers review write` carry words only. Approving a goal and
//! answering a review decision are for the owner or an admin; the relay refuses
//! them from an agent.

use buzz_core::company_functions::CompanyFunction;
use buzz_core::company_numbers::{
    goal_d_tag, parse_numbers_d_tag, review_d_tag, validate_goal_head, validate_review_head,
    validate_scorecard_head, DecisionState, GoalHead, GoalStatus, Metric, NumbersAction, NumbersOp,
    NumbersRecord, ReviewDecisionInput, ReviewHead, ScorecardHead, SCORECARD_D_TAG,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::KIND_NUMBERS_HEAD;
use nostr::Event;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::BuzzClient;
use crate::commands::cofounder::{head_d_tag, map_write_error, query_company_heads, relay_self};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::{NumbersCmd, NumbersGoalsCmd, NumbersReviewCmd};

/// Upper bound on numbers heads one query may return.
const NUMBERS_HEAD_QUERY_BOUND: u32 = 1_000;
/// Largest review file the CLI reads.
const MAX_REVIEW_FILE_BYTES: usize = 64 * 1024;

pub async fn dispatch(command: NumbersCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        NumbersCmd::Scorecard {
            function,
            no_refresh,
        } => {
            let only = function
                .as_deref()
                .map(|value| parse_name::<CompanyFunction>(value, "function"))
                .transpose()?;
            if !no_refresh {
                // The relay recomputes at most once a minute. If it refuses
                // (co-founder mode off), the last stored scorecard still reads.
                if let Err(error) = submit(client, &base(NumbersOp::ScorecardRefresh)).await {
                    eprintln!("could not refresh the scorecard, showing the last one: {error}");
                }
            }
            let (_, head) = load_scorecard(client).await?;
            println!("{}", scorecard_output(&head, only));
            Ok(())
        }
        NumbersCmd::Goals(sub) => dispatch_goals(sub, client).await,
        NumbersCmd::Review(sub) => dispatch_review(sub, client).await,
    }
}

async fn dispatch_goals(command: NumbersGoalsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        NumbersGoalsCmd::List { status, function } => {
            let status = status
                .as_deref()
                .map(|value| parse_name::<GoalStatus>(value, "status"))
                .transpose()?;
            let function = function
                .as_deref()
                .map(|value| parse_name::<CompanyFunction>(value, "function"))
                .transpose()?;
            let goals = load_goals(client).await?;
            println!("{}", Value::Array(goal_rows(&goals, status, function)));
            Ok(())
        }
        NumbersGoalsCmd::Propose {
            function,
            metric,
            target,
            period,
            title,
            reason,
        } => {
            let goal_id = Uuid::new_v4().to_string();
            let action = NumbersAction {
                goal_id: Some(goal_id.clone()),
                function: Some(parse_name(&function, "function")?),
                metric: Some(parse_name(&metric, "metric")?),
                target: Some(target),
                period: Some(parse_name(&period, "period")?),
                title: Some(title),
                reason,
                ..base(NumbersOp::GoalPropose)
            };
            let response = submit(client, &action).await?;
            let mut output: Value =
                serde_json::from_str(&response).unwrap_or_else(|_| json!({ "raw": response }));
            if let Some(object) = output.as_object_mut() {
                object.insert("goalId".into(), json!(goal_id));
            }
            println!("{output}");
            Ok(())
        }
        NumbersGoalsCmd::Edit {
            goal_id,
            title,
            metric,
            target,
            period,
            reason,
        } => {
            let (event, goal) = load_goal(client, &goal_id).await?;
            let metric = parse_name::<Metric>(&metric, "metric")?;
            if metric.function() != goal.function {
                return Err(CliError::Usage(
                    "a goal measures a number of its own function".into(),
                ));
            }
            let action = NumbersAction {
                goal_id: Some(goal_id),
                title: Some(title),
                metric: Some(metric),
                target: Some(target),
                period: Some(parse_name(&period, "period")?),
                reason,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base(NumbersOp::GoalEdit)
            };
            println!("{}", submit(client, &action).await?);
            Ok(())
        }
        NumbersGoalsCmd::Approve { goal_id, note } => {
            decide_goal(client, goal_id, note, NumbersOp::GoalApprove).await
        }
        NumbersGoalsCmd::Reject { goal_id, note } => {
            decide_goal(client, goal_id, note, NumbersOp::GoalReject).await
        }
        NumbersGoalsCmd::Retire { goal_id, note } => {
            decide_goal(client, goal_id, note, NumbersOp::GoalRetire).await
        }
    }
}

async fn dispatch_review(command: NumbersReviewCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        NumbersReviewCmd::List => {
            let reviews = load_reviews(client).await?;
            println!("{}", Value::Array(review_rows(&reviews)));
            Ok(())
        }
        NumbersReviewCmd::Show { date } => {
            let (event, head) = load_review(client, date.as_deref()).await?;
            println!("{}", review_output(&event, &head));
            Ok(())
        }
        NumbersReviewCmd::Write { date, file } => {
            let words = read_review_file(&file)?;
            let (event, _) = load_review(client, Some(&date)).await?;
            let action = NumbersAction {
                review_date: Some(date),
                wins: Some(words.wins),
                misses: Some(words.misses),
                decisions: Some(words.decisions),
                expected_head_event_id: Some(event.id.to_hex()),
                ..base(NumbersOp::ReviewAnnotate)
            };
            println!("{}", submit(client, &action).await?);
            Ok(())
        }
        NumbersReviewCmd::Decide {
            date,
            decision_id,
            choice,
            note,
        } => {
            let (event, _) = load_review(client, Some(&date)).await?;
            let action = NumbersAction {
                review_date: Some(date),
                decision_id: Some(decision_id),
                choice: Some(parse_name::<DecisionState>(&choice, "choice")?),
                note,
                expected_head_event_id: Some(event.id.to_hex()),
                ..base(NumbersOp::ReviewDecide)
            };
            println!("{}", submit(client, &action).await?);
            Ok(())
        }
    }
}

fn base(op: NumbersOp) -> NumbersAction {
    NumbersAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        op,
        goal_id: None,
        function: None,
        title: None,
        metric: None,
        target: None,
        period: None,
        reason: None,
        review_date: None,
        wins: None,
        misses: None,
        decisions: None,
        decision_id: None,
        choice: None,
        note: None,
        expected_head_event_id: None,
    }
}

/// Read a snake_case name (`customer_success`, `won`) into its enum. A dash
/// is accepted for an underscore.
fn parse_name<T: DeserializeOwned>(value: &str, what: &str) -> Result<T, CliError> {
    let name = value.trim().to_ascii_lowercase().replace('-', "_");
    serde_json::from_value::<T>(Value::String(name))
        .map_err(|_| CliError::Usage(format!("{value:?} is not a valid {what}")))
}

async fn decide_goal(
    client: &BuzzClient,
    goal_id: String,
    note: Option<String>,
    op: NumbersOp,
) -> Result<(), CliError> {
    let (event, _) = load_goal(client, &goal_id).await?;
    let action = NumbersAction {
        goal_id: Some(goal_id),
        note,
        expected_head_event_id: Some(event.id.to_hex()),
        ..base(op)
    };
    println!("{}", submit(client, &action).await?);
    Ok(())
}

async fn submit(client: &BuzzClient, action: &NumbersAction) -> Result<String, CliError> {
    let builder = buzz_sdk::company_numbers::build_numbers_action(action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, "numbers changed before they were saved")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReviewWords {
    #[serde(default)]
    wins: Vec<String>,
    #[serde(default)]
    misses: Vec<String>,
    #[serde(default)]
    decisions: Vec<ReviewDecisionInput>,
}

/// Reads the words of a review from a file (`-` reads stdin) and checks them
/// before anything is sent.
fn read_review_file(path: &str) -> Result<ReviewWords, CliError> {
    let text = if path == "-" {
        use std::io::Read;
        let mut text = String::new();
        std::io::stdin()
            .lock()
            .take(MAX_REVIEW_FILE_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|error| {
                CliError::Usage(format!("could not read the review from stdin: {error}"))
            })?;
        text
    } else {
        std::fs::read_to_string(path)
            .map_err(|error| CliError::Usage(format!("could not read {path}: {error}")))?
    };
    parse_review_words(&text)
}

fn parse_review_words(text: &str) -> Result<ReviewWords, CliError> {
    if text.len() > MAX_REVIEW_FILE_BYTES {
        return Err(CliError::Usage(format!(
            "the review file is larger than {MAX_REVIEW_FILE_BYTES} bytes"
        )));
    }
    serde_json::from_str::<ReviewWords>(text)
        .map_err(|error| CliError::Usage(format!("the review is not valid review JSON: {error}")))
}

fn verify_numbers_head(event: Event, relay_self: &str) -> Result<(Event, NumbersRecord), CliError> {
    if u32::from(event.kind.as_u16()) != KIND_NUMBERS_HEAD || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "numbers head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("numbers head signature is invalid: {error}")))?;
    let record = parse_numbers_d_tag(&head_d_tag(&event))
        .map_err(|_| CliError::Other("numbers head has an unknown d-tag".into()))?;
    Ok((event, record))
}

fn decode<T: DeserializeOwned>(event: &Event, what: &str) -> Result<T, CliError> {
    serde_json::from_str::<T>(&event.content)
        .map_err(|error| CliError::Other(format!("{what} head content is invalid: {error}")))
}

async fn load_all(client: &BuzzClient) -> Result<Vec<(Event, NumbersRecord)>, CliError> {
    let relay_self = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [KIND_NUMBERS_HEAD], "authors": [relay_self]}),
            NUMBERS_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut heads = Vec::with_capacity(raw.len());
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("numbers head is malformed: {error}")))?;
        // A head this client does not know is skipped, so a newer relay's new
        // record family never breaks an older agent.
        if let Ok(head) = verify_numbers_head(event, &relay_self) {
            heads.push(head);
        }
    }
    Ok(heads)
}

async fn load_one(client: &BuzzClient, d_tag: String) -> Result<Option<Event>, CliError> {
    let events = query_company_heads(client, KIND_NUMBERS_HEAD, &[d_tag]).await?;
    let relay_self = relay_self(client).await?;
    events
        .into_iter()
        .next()
        .map(|event| verify_numbers_head(event, &relay_self).map(|(event, _)| event))
        .transpose()
}

async fn load_scorecard(client: &BuzzClient) -> Result<(Event, ScorecardHead), CliError> {
    let event = load_one(client, SCORECARD_D_TAG.to_owned())
        .await?
        .ok_or_else(|| {
            CliError::NotFound("no scorecard yet; co-founder mode must be on".to_owned())
        })?;
    let head = decode::<ScorecardHead>(&event, "scorecard")?;
    validate_scorecard_head(&head)
        .map_err(|error| CliError::Other(format!("scorecard head is invalid: {error}")))?;
    Ok((event, head))
}

async fn load_goal(client: &BuzzClient, goal_id: &str) -> Result<(Event, GoalHead), CliError> {
    let d_tag = goal_d_tag(goal_id).map_err(|error| CliError::Usage(error.to_string()))?;
    let event = load_one(client, d_tag)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("no goal {goal_id}")))?;
    let head = decode::<GoalHead>(&event, "goal")?;
    validate_goal_head(&head)
        .map_err(|error| CliError::Other(format!("goal head is invalid: {error}")))?;
    Ok((event, head))
}

async fn load_goals(client: &BuzzClient) -> Result<Vec<(Event, GoalHead)>, CliError> {
    let mut goals = Vec::new();
    for (event, record) in load_all(client).await? {
        if matches!(record, NumbersRecord::Goal(_)) {
            let head = decode::<GoalHead>(&event, "goal")?;
            validate_goal_head(&head)
                .map_err(|error| CliError::Other(format!("goal head is invalid: {error}")))?;
            goals.push((event, head));
        }
    }
    goals.sort_by(|(_, first), (_, second)| {
        second
            .proposed_at
            .cmp(&first.proposed_at)
            .then_with(|| first.goal_id.cmp(&second.goal_id))
    });
    Ok(goals)
}

async fn load_reviews(client: &BuzzClient) -> Result<Vec<(Event, ReviewHead)>, CliError> {
    let mut reviews = Vec::new();
    for (event, record) in load_all(client).await? {
        if matches!(record, NumbersRecord::Review(_)) {
            let head = decode::<ReviewHead>(&event, "review")?;
            validate_review_head(&head)
                .map_err(|error| CliError::Other(format!("review head is invalid: {error}")))?;
            reviews.push((event, head));
        }
    }
    reviews.sort_by(|(_, first), (_, second)| second.review_date.cmp(&first.review_date));
    Ok(reviews)
}

/// The review of a Friday, or the latest one when no date is given.
async fn load_review(
    client: &BuzzClient,
    date: Option<&str>,
) -> Result<(Event, ReviewHead), CliError> {
    match date {
        Some(date) => {
            let d_tag = review_d_tag(date).map_err(|error| CliError::Usage(error.to_string()))?;
            let event = load_one(client, d_tag)
                .await?
                .ok_or_else(|| CliError::NotFound(format!("no review for {date}")))?;
            let head = decode::<ReviewHead>(&event, "review")?;
            validate_review_head(&head)
                .map_err(|error| CliError::Other(format!("review head is invalid: {error}")))?;
            Ok((event, head))
        }
        None => load_reviews(client)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| CliError::NotFound("no weekly review yet".to_owned())),
    }
}

fn function_output(card: &buzz_core::company_numbers::FunctionScorecard) -> Value {
    json!({
        "function": card.function,
        "metrics": card.metrics.iter().map(|reading| json!({
            "metric": reading.metric,
            "label": reading.metric.label(),
            "unit": reading.metric.unit(),
            "value": reading.value,
            "previous": reading.previous,
            "change": reading.change,
        })).collect::<Vec<_>>(),
        "notTracked": card.not_tracked,
    })
}

/// The scorecard as the CLI prints it, optionally for one function.
pub(crate) fn scorecard_output(head: &ScorecardHead, only: Option<CompanyFunction>) -> Value {
    json!({
        "asOf": head.as_of,
        "windowStart": head.window_start,
        "previousStart": head.previous_start,
        "currency": head.currency,
        "otherCurrencyFacts": head.other_currency_facts,
        "functions": head
            .functions
            .iter()
            .filter(|card| only.is_none_or(|function| card.function == function))
            .map(function_output)
            .collect::<Vec<_>>(),
        "goals": head
            .goals
            .iter()
            .filter(|goal| only.is_none_or(|function| goal.function == function))
            .collect::<Vec<_>>(),
    })
}

/// One compact row per goal, newest first, optionally limited.
pub(crate) fn goal_rows(
    goals: &[(Event, GoalHead)],
    status: Option<GoalStatus>,
    function: Option<CompanyFunction>,
) -> Vec<Value> {
    goals
        .iter()
        .filter(|(_, goal)| status.is_none_or(|status| goal.status == status))
        .filter(|(_, goal)| function.is_none_or(|function| goal.function == function))
        .map(|(event, goal)| {
            json!({
                "goalId": goal.goal_id,
                "function": goal.function,
                "title": goal.title,
                "metric": goal.metric,
                "target": goal.target,
                "period": goal.period,
                "status": goal.status,
                "reason": goal.reason,
                "proposedByPubkey": goal.proposed_by_pubkey,
                "proposedAt": goal.proposed_at,
                "decidedByPubkey": goal.decided_by_pubkey,
                "decidedAt": goal.decided_at,
                "headEventId": event.id.to_hex(),
            })
        })
        .collect()
}

pub(crate) fn review_rows(reviews: &[(Event, ReviewHead)]) -> Vec<Value> {
    reviews
        .iter()
        .map(|(event, review)| {
            json!({
                "reviewDate": review.review_date,
                "asOf": review.as_of,
                "wins": review.wins.len(),
                "misses": review.misses.len(),
                "openDecisions": review
                    .decisions
                    .iter()
                    .filter(|decision| decision.state == DecisionState::Open)
                    .count(),
                "headEventId": event.id.to_hex(),
            })
        })
        .collect()
}

/// The full review plus the head event id a write must name.
pub(crate) fn review_output(event: &Event, head: &ReviewHead) -> Value {
    json!({
        "headEventId": event.id.to_hex(),
        "reviewDate": head.review_date,
        "asOf": head.as_of,
        "windowStart": head.window_start,
        "previousStart": head.previous_start,
        "currency": head.currency,
        "otherCurrencyFacts": head.other_currency_facts,
        "functions": head.functions.iter().map(function_output).collect::<Vec<_>>(),
        "wins": head.wins,
        "misses": head.misses,
        "decisions": head.decisions,
        "annotatedByPubkey": head.annotated_by_pubkey,
        "annotatedAt": head.annotated_at,
        "link": format!("colony://numbers/review/{}", head.review_date),
    })
}

#[cfg(test)]
mod tests {
    use buzz_core::company_numbers::{
        build_review, compute_scorecard, review_due, GoalPeriod, Metric, MoneyFact, NumbersInputs,
    };
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    const GOAL_ID: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";
    /// Friday 2026-10-30 15:00 UTC.
    const NOW: i64 = 1_793_372_400;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn inputs() -> NumbersInputs {
        NumbersInputs {
            currency: "ZAR".into(),
            proposals_accepted: vec![NOW - 86_400],
            payments: vec![MoneyFact {
                at: NOW - 3_600,
                amount_minor: 12_345,
            }],
            ..NumbersInputs::default()
        }
    }

    fn signed(kind: u32, d_tag: &str, content: String) -> Event {
        EventBuilder::new(Kind::Custom(kind as u16), content)
            .tag(Tag::parse(["d", d_tag]).expect("d tag"))
            .sign_with_keys(&Keys::generate())
            .expect("sign head")
    }

    #[test]
    fn numbers_commands_parse() {
        let scorecard = parse(&["numbers", "scorecard", "--function", "sales"]).expect("scorecard");
        assert!(matches!(
            scorecard.command,
            Cmd::Numbers(NumbersCmd::Scorecard { .. })
        ));
        assert!(parse(&["numbers", "scorecard", "--no-refresh"]).is_ok());
        assert!(parse(&["numbers", "goals", "list", "--status", "approved"]).is_ok());
        assert!(parse(&[
            "numbers",
            "goals",
            "propose",
            "--function",
            "sales",
            "--metric",
            "won",
            "--target",
            "5",
            "--period",
            "month",
            "--title",
            "5 new clients a month",
        ])
        .is_ok());
        assert!(parse(&[
            "numbers",
            "goals",
            "edit",
            GOAL_ID,
            "--title",
            "8 new clients a month",
            "--metric",
            "won",
            "--target",
            "8",
            "--period",
            "month",
        ])
        .is_ok());
        assert!(
            parse(&["numbers", "goals", "propose", "--function", "sales"]).is_err(),
            "metric, target, period and title are required"
        );
        assert!(parse(&["numbers", "goals", "approve", GOAL_ID, "--note", "yes"]).is_ok());
        assert!(parse(&["numbers", "review", "show"]).is_ok());
        assert!(parse(&["numbers", "review", "show", "2026-10-30"]).is_ok());
        assert!(parse(&["numbers", "review", "write", "2026-10-30", "--file", "-"]).is_ok());
        assert!(parse(&["numbers", "review", "write", "2026-10-30"]).is_err());
        assert!(parse(&[
            "numbers",
            "review",
            "decide",
            "2026-10-30",
            "hire-cs",
            "--choice",
            "approved",
        ])
        .is_ok());
    }

    #[test]
    fn names_are_read_in_snake_case_and_a_wrong_name_is_a_usage_error() {
        assert_eq!(
            parse_name::<CompanyFunction>("customer-success", "function").unwrap(),
            CompanyFunction::CustomerSuccess
        );
        assert_eq!(parse_name::<Metric>("Won", "metric").unwrap(), Metric::Won);
        assert_eq!(
            parse_name::<GoalPeriod>("month", "period").unwrap(),
            GoalPeriod::Month
        );
        assert!(matches!(
            parse_name::<Metric>("sales", "metric"),
            Err(CliError::Usage(_))
        ));
        assert_eq!(
            parse_name::<DecisionState>("deferred", "choice").unwrap(),
            DecisionState::Deferred
        );
    }

    #[test]
    fn a_review_file_takes_words_only() {
        let words = parse_review_words(
            r#"{"wins":["Two won"],"decisions":[{"decisionId":"hire-cs","title":"Hire?"}]}"#,
        )
        .expect("words");
        assert_eq!(words.wins, vec!["Two won".to_owned()]);
        assert!(words.misses.is_empty());
        assert_eq!(words.decisions[0].decision_id, "hire-cs");
        // A number cannot be smuggled in: unknown keys are refused.
        assert!(parse_review_words(r#"{"functions":[]}"#).is_err());
        assert!(parse_review_words("not json").is_err());
    }

    #[test]
    fn the_scorecard_prints_labels_values_and_can_be_cut_to_one_function() {
        let head = compute_scorecard(&inputs(), &[], NOW);
        let all = scorecard_output(&head, None);
        assert_eq!(all["functions"].as_array().unwrap().len(), 5);
        assert_eq!(all["currency"], "ZAR");
        let sales = scorecard_output(&head, Some(CompanyFunction::Sales));
        let functions = sales["functions"].as_array().unwrap();
        assert_eq!(functions.len(), 1);
        let won = functions[0]["metrics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["metric"] == "won")
            .expect("won row");
        assert_eq!(won["label"], "Won");
        assert_eq!(won["value"], 1);
        assert_eq!(won["previous"], 0);
        assert_eq!(won["change"], 1);
        assert_eq!(functions[0]["notTracked"][0], "calls");
    }

    #[test]
    fn a_review_prints_its_link_and_the_head_to_write_against() {
        let window = review_due(NOW).expect("a review is due on Friday afternoon");
        let review = build_review(&window, &inputs(), NOW);
        let d_tag = review_d_tag(&review.review_date).unwrap();
        let event = signed(
            KIND_NUMBERS_HEAD,
            &d_tag,
            serde_json::to_string(&review).unwrap(),
        );
        let output = review_output(&event, &review);
        assert_eq!(output["headEventId"], event.id.to_hex());
        assert_eq!(output["link"], "colony://numbers/review/2026-10-30");
        assert_eq!(output["functions"].as_array().unwrap().len(), 5);
        let rows = review_rows(&[(event, review)]);
        assert_eq!(rows[0]["reviewDate"], "2026-10-30");
        assert_eq!(rows[0]["openDecisions"], 0);
    }

    #[test]
    fn a_foreign_head_is_refused() {
        let relay = Keys::generate();
        let head = signed(KIND_NUMBERS_HEAD, SCORECARD_D_TAG, "{}".to_owned());
        // Signed by somebody other than the relay.
        assert!(verify_numbers_head(head, &relay.public_key().to_hex()).is_err());
    }

    #[test]
    fn goal_rows_filter_by_status_and_function() {
        let goal = |function: CompanyFunction, metric: Metric, status: GoalStatus| GoalHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id: GOAL_ID.into(),
            function,
            title: "Goal".into(),
            metric,
            target: 5,
            period: GoalPeriod::Week,
            status,
            reason: None,
            proposed_by_pubkey: "a".repeat(64),
            proposed_at: 1,
            decided_by_pubkey: None,
            decided_at: None,
            note: None,
            source_action_event_id: "c".repeat(64),
        };
        let wrap = |head: GoalHead| {
            let event = signed(
                KIND_NUMBERS_HEAD,
                &goal_d_tag(GOAL_ID).unwrap(),
                serde_json::to_string(&head).unwrap(),
            );
            (event, head)
        };
        let goals = vec![
            wrap(goal(
                CompanyFunction::Sales,
                Metric::Won,
                GoalStatus::Approved,
            )),
            wrap(goal(
                CompanyFunction::Finance,
                Metric::CashIn,
                GoalStatus::Proposed,
            )),
        ];
        assert_eq!(goal_rows(&goals, None, None).len(), 2);
        assert_eq!(goal_rows(&goals, Some(GoalStatus::Approved), None).len(), 1);
        assert_eq!(
            goal_rows(&goals, None, Some(CompanyFunction::Finance))[0]["metric"],
            "cash_in"
        );
    }
}
