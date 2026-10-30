//! Co-founder numbers: the scorecard per function, goals per function and the
//! Friday weekly review (spec sections 9 and 11).
//!
//! Three record families share one relay-signed head kind (30678) and one
//! member action kind (47068), told apart by d-tag:
//!
//! | d-tag | Record |
//! | --- | --- |
//! | `company:scorecard` | The live scorecard of all five functions, plus progress on approved goals |
//! | `company:fngoal:<uuid>` | One goal of one function (Scout proposes, the owner approves) |
//! | `company:review:<YYYY-MM-DD>` | The weekly review of the week that ended that Friday |
//!
//! **The relay computes every number.** An agent can never write a value into
//! a scorecard or a review: [`compute_scorecard`] runs inside the relay over
//! timestamped facts it read from the company's own records ([`NumbersInputs`]),
//! so a review cannot be talked into a figure that the records do not support.
//! What an agent does write is words: a goal proposal, the wins and misses of a
//! review and the decisions the owner must make.
//!
//! [`apply_goal_action`], [`apply_review_annotate`] and [`apply_review_decide`]
//! are the state machines. The relay broker resolves the caller's role first, so
//! every rule that matters (only an owner or admin approves a goal or answers a
//! decision, agents never do, a goal metric belongs to its own function,
//! co-founder mode must be on) is testable here without a database.
//!
//! Windows are half open, `[start, end)`, in Unix seconds. A scorecard looks at
//! the seven days before `asOf` and compares them with the seven days before
//! that, so a change is always between two equally long periods.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_functions::CompanyFunction;
use crate::company_plans::{PlanActor, PlanActorRole, PlanContext, PlanError, PlanErrorKind};
use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored numbers head (community-wide, scorecard, goals and reviews).
pub const KIND_NUMBERS_HEAD: u32 = crate::kind::KIND_NUMBERS_HEAD;
/// Member goal, scorecard refresh and review write, brokered and community-wide.
pub const KIND_NUMBERS_ACTION: u32 = crate::kind::KIND_NUMBERS_ACTION;

/// d-tag of the one live scorecard record.
pub const SCORECARD_D_TAG: &str = "company:scorecard";
const GOAL_D_TAG_PREFIX: &str = "company:fngoal:";
const REVIEW_D_TAG_PREFIX: &str = "company:review:";

/// Seconds in the seven-day window a scorecard looks at.
pub const WEEK_SECS: i64 = 7 * 86_400;
/// Johannesburg is UTC+2 all year; calendar months start there.
pub const SAST_OFFSET_SECS: i64 = 2 * 3_600;
/// The Friday review covers the seven days up to this UTC hour (16:00 in Johannesburg).
pub const REVIEW_HOUR_UTC: u32 = 14;
/// A review missed on Friday is still written until this long after its Friday cut.
pub const REVIEW_CATCH_UP_SECS: i64 = 3 * 86_400;

/// Longest goal or decision title, in characters.
pub const MAX_NUMBERS_TITLE_CHARS: usize = 120;
/// Longest goal reason, decision detail or note, in characters.
pub const MAX_NUMBERS_NOTE_CHARS: usize = 300;
/// Longest win or miss line, in characters.
pub const MAX_REVIEW_LINE_CHARS: usize = 200;
/// Most wins, misses or decisions one review carries.
pub const MAX_REVIEW_ITEMS: usize = 5;
/// Largest goal target.
pub const MAX_GOAL_TARGET: i64 = 1_000_000_000_000;
/// Most open (proposed or approved) goals a company keeps.
pub const MAX_OPEN_GOALS: usize = 50;

/// What a number counts or measures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    /// Sales: leads created in the window.
    LeadsFound,
    /// Sales: new WhatsApp chats whose first message went out in the window.
    Contacted,
    /// Sales: contacts whose first reply to outreach arrived in the window.
    Replied,
    /// Sales: proposals whose first version was written in the window.
    Quotes,
    /// Sales: proposals accepted in the window.
    Won,
    /// Operations: worker runs started in the window.
    WorkersStarted,
    /// Operations: worker runs that finished well in the window.
    WorkersDone,
    /// Operations: worker runs that failed or timed out in the window.
    WorkersFailed,
    /// Operations: plans the owner approved in the window.
    PlansApproved,
    /// Customer Success: clients that are active now.
    ActiveClients,
    /// Finance: payments received in the window.
    CashIn,
    /// Finance: invoices issued in the window.
    Invoiced,
    /// Finance: what issued invoices still owe now.
    Owed,
    /// Finance: cost of worker runs started in the window.
    WorkerCost,
    /// Brand: worker cost of the window divided by the proposals won in it.
    CostPerWin,
}

/// How a metric's value is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricUnit {
    /// A whole number of things.
    Count,
    /// Minor units (cents) of the scorecard currency.
    Money,
    /// US dollar cents, because worker runs report their cost in dollars.
    UsdCents,
}

impl Metric {
    /// Every metric, in the order a function page lists them.
    pub const ALL: [Metric; 15] = [
        Metric::LeadsFound,
        Metric::Contacted,
        Metric::Replied,
        Metric::Quotes,
        Metric::Won,
        Metric::WorkersStarted,
        Metric::WorkersDone,
        Metric::WorkersFailed,
        Metric::PlansApproved,
        Metric::ActiveClients,
        Metric::CashIn,
        Metric::Invoiced,
        Metric::Owed,
        Metric::WorkerCost,
        Metric::CostPerWin,
    ];

    /// The function this number belongs to.
    pub const fn function(self) -> CompanyFunction {
        match self {
            Metric::LeadsFound
            | Metric::Contacted
            | Metric::Replied
            | Metric::Quotes
            | Metric::Won => CompanyFunction::Sales,
            Metric::WorkersStarted
            | Metric::WorkersDone
            | Metric::WorkersFailed
            | Metric::PlansApproved => CompanyFunction::Operations,
            Metric::ActiveClients => CompanyFunction::CustomerSuccess,
            Metric::CashIn | Metric::Invoiced | Metric::Owed | Metric::WorkerCost => {
                CompanyFunction::Finance
            }
            Metric::CostPerWin => CompanyFunction::Brand,
        }
    }

    /// How the value is written.
    pub const fn unit(self) -> MetricUnit {
        match self {
            Metric::CashIn | Metric::Invoiced | Metric::Owed => MetricUnit::Money,
            Metric::WorkerCost | Metric::CostPerWin => MetricUnit::UsdCents,
            _ => MetricUnit::Count,
        }
    }

    /// A number of how things stand now, with no history to compare against.
    pub const fn is_point_in_time(self) -> bool {
        matches!(self, Metric::ActiveClients | Metric::Owed)
    }

    /// What people read.
    pub const fn label(self) -> &'static str {
        match self {
            Metric::LeadsFound => "Leads found",
            Metric::Contacted => "Contacted",
            Metric::Replied => "Replied",
            Metric::Quotes => "Quotes",
            Metric::Won => "Won",
            Metric::WorkersStarted => "Worker runs",
            Metric::WorkersDone => "Runs finished",
            Metric::WorkersFailed => "Runs failed",
            Metric::PlansApproved => "Plans approved",
            Metric::ActiveClients => "Active clients",
            Metric::CashIn => "Cash in",
            Metric::Invoiced => "Invoiced",
            Metric::Owed => "Owed",
            Metric::WorkerCost => "Worker cost",
            Metric::CostPerWin => "Cost per win",
        }
    }
}

/// The metrics of one function, in display order.
pub fn metrics_for(function: CompanyFunction) -> Vec<Metric> {
    Metric::ALL
        .into_iter()
        .filter(|metric| metric.function() == function)
        .collect()
}

/// Numbers the spec names for a function that Colony has no record of yet.
/// They are shown as "not tracked yet", never as zero.
pub fn not_tracked(function: CompanyFunction) -> &'static [&'static str] {
    match function {
        CompanyFunction::Sales => &["calls"],
        CompanyFunction::Operations => &["jobs_in_progress", "days_to_deliver", "revisions"],
        CompanyFunction::CustomerSuccess => &["renewals", "referrals"],
        CompanyFunction::Finance => &["recurring"],
        CompanyFunction::Brand => &[],
    }
}

/// How one worker run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerOutcome {
    /// Still running inside its deadline.
    Running,
    /// Finished and produced output.
    Done,
    /// Failed, refused or ran past its deadline.
    Failed,
    /// Stopped by its employee or an admin.
    Cancelled,
}

/// One worker run, reduced to what a scorecard counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerFact {
    /// Start time, Unix seconds.
    pub started_at: i64,
    /// When the run ended (its deadline for a run that timed out).
    pub ended_at: Option<i64>,
    /// How it ended.
    pub outcome: WorkerOutcome,
    /// Reported cost in US dollar cents; 0 when the provider reported none.
    pub cost_usd_cents: i64,
}

/// A sum of money at one moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoneyFact {
    /// When it happened, Unix seconds.
    pub at: i64,
    /// Minor units of the scorecard currency.
    pub amount_minor: i64,
}

/// Everything a scorecard counts, as timestamped facts read from the
/// company's own records. The relay fills this in; nothing here comes from an
/// agent's say-so.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NumbersInputs {
    /// ISO 4217 code of every money fact.
    pub currency: String,
    /// Creation time of each lead.
    pub leads_created: Vec<i64>,
    /// Send time of the first message of each new WhatsApp chat.
    pub contacts_started: Vec<i64>,
    /// Time of each contact's first reply to outreach.
    pub first_replies: Vec<i64>,
    /// Time each proposal's first version was written.
    pub quotes_sent: Vec<i64>,
    /// Time each proposal was accepted.
    pub proposals_accepted: Vec<i64>,
    /// Every worker run.
    pub worker_runs: Vec<WorkerFact>,
    /// Time of each whole-plan approval.
    pub plan_approvals: Vec<i64>,
    /// Payments received.
    pub payments: Vec<MoneyFact>,
    /// Invoices issued.
    pub invoices_issued: Vec<MoneyFact>,
    /// What issued invoices still owe now.
    pub owed_minor: i64,
    /// Clients that are active now.
    pub active_clients: u32,
    /// Money facts left out because they were in another currency.
    pub other_currency_facts: u32,
}

fn count_within(times: &[i64], start: i64, end: i64) -> i64 {
    times
        .iter()
        .filter(|at| **at >= start && **at < end)
        .count() as i64
}

fn sum_within(facts: &[MoneyFact], start: i64, end: i64) -> i64 {
    facts
        .iter()
        .filter(|fact| fact.at >= start && fact.at < end)
        .map(|fact| fact.amount_minor)
        .sum()
}

fn worker_cost_within(inputs: &NumbersInputs, start: i64, end: i64) -> i64 {
    inputs
        .worker_runs
        .iter()
        .filter(|run| run.started_at >= start && run.started_at < end)
        .map(|run| run.cost_usd_cents)
        .sum()
}

/// The value of one metric over `[start, end)`, or `None` when it cannot be
/// stated (a cost per win with nothing won).
pub fn metric_value(inputs: &NumbersInputs, metric: Metric, start: i64, end: i64) -> Option<i64> {
    let ended_within = |run: &&WorkerFact, outcome: WorkerOutcome| {
        run.outcome == outcome && run.ended_at.is_some_and(|at| at >= start && at < end)
    };
    match metric {
        Metric::LeadsFound => Some(count_within(&inputs.leads_created, start, end)),
        Metric::Contacted => Some(count_within(&inputs.contacts_started, start, end)),
        Metric::Replied => Some(count_within(&inputs.first_replies, start, end)),
        Metric::Quotes => Some(count_within(&inputs.quotes_sent, start, end)),
        Metric::Won => Some(count_within(&inputs.proposals_accepted, start, end)),
        Metric::WorkersStarted => Some(
            inputs
                .worker_runs
                .iter()
                .filter(|run| run.started_at >= start && run.started_at < end)
                .count() as i64,
        ),
        Metric::WorkersDone => Some(
            inputs
                .worker_runs
                .iter()
                .filter(|run| ended_within(run, WorkerOutcome::Done))
                .count() as i64,
        ),
        Metric::WorkersFailed => Some(
            inputs
                .worker_runs
                .iter()
                .filter(|run| ended_within(run, WorkerOutcome::Failed))
                .count() as i64,
        ),
        Metric::PlansApproved => Some(count_within(&inputs.plan_approvals, start, end)),
        Metric::ActiveClients => Some(i64::from(inputs.active_clients)),
        Metric::CashIn => Some(sum_within(&inputs.payments, start, end)),
        Metric::Invoiced => Some(sum_within(&inputs.invoices_issued, start, end)),
        Metric::Owed => Some(inputs.owed_minor),
        Metric::WorkerCost => Some(worker_cost_within(inputs, start, end)),
        Metric::CostPerWin => {
            let won = count_within(&inputs.proposals_accepted, start, end);
            if won == 0 {
                return None;
            }
            let cost = worker_cost_within(inputs, start, end);
            // Rounded half up, in whole US dollar cents.
            Some((cost * 2 + won) / (won * 2))
        }
    }
}

/// One number of a scorecard with its comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MetricReading {
    /// What is measured.
    pub metric: Metric,
    /// The value over the latest seven days; `null` when it cannot be stated.
    pub value: Option<i64>,
    /// The value over the seven days before; `null` for a number of how things
    /// stand now, which has no history.
    pub previous: Option<i64>,
    /// `value - previous`, when both exist.
    pub change: Option<i64>,
}

/// The numbers of one function.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FunctionScorecard {
    /// Which function.
    pub function: CompanyFunction,
    /// Its numbers, in display order.
    pub metrics: Vec<MetricReading>,
    /// Numbers the spec names that Colony does not record yet.
    pub not_tracked: Vec<String>,
}

/// Progress of one approved goal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalProgress {
    /// The goal.
    pub goal_id: String,
    /// Its function.
    pub function: CompanyFunction,
    /// Its title.
    pub title: String,
    /// What it measures.
    pub metric: Metric,
    /// Where it should get to.
    pub target: i64,
    /// Over which period.
    pub period: GoalPeriod,
    /// Where it stands; `null` when the metric cannot be stated.
    pub current: Option<i64>,
    /// Percent of the target reached, at most 1000.
    pub percent: Option<u32>,
}

/// Compute the scorecard of all five functions.
///
/// `as_of` ends the latest window; the window before it is the seven days
/// before that. Point-in-time numbers carry no previous value.
pub fn compute_function_scorecards(inputs: &NumbersInputs, as_of: i64) -> Vec<FunctionScorecard> {
    let start = as_of - WEEK_SECS;
    let previous_start = start - WEEK_SECS;
    CompanyFunction::ALL
        .into_iter()
        .map(|function| FunctionScorecard {
            function,
            metrics: metrics_for(function)
                .into_iter()
                .map(|metric| {
                    let value = metric_value(inputs, metric, start, as_of);
                    let previous = if metric.is_point_in_time() {
                        None
                    } else {
                        metric_value(inputs, metric, previous_start, start)
                    };
                    let change = match (value, previous) {
                        (Some(value), Some(previous)) => Some(value - previous),
                        _ => None,
                    };
                    MetricReading {
                        metric,
                        value,
                        previous,
                        change,
                    }
                })
                .collect(),
            not_tracked: not_tracked(function)
                .iter()
                .map(|name| (*name).to_owned())
                .collect(),
        })
        .collect()
}

/// First instant of the calendar month that contains `at`, in Johannesburg.
pub fn month_start_sast(at: i64) -> i64 {
    let local = DateTime::from_timestamp(at + SAST_OFFSET_SECS, 0).unwrap_or_default();
    Utc.with_ymd_and_hms(local.year(), local.month(), 1, 0, 0, 0)
        .single()
        .map_or(at, |first| first.timestamp() - SAST_OFFSET_SECS)
}

/// How an approved goal stands at `as_of`.
pub fn goal_progress(inputs: &NumbersInputs, goal: &GoalHead, as_of: i64) -> GoalProgress {
    let start = match goal.period {
        GoalPeriod::Week => as_of - WEEK_SECS,
        GoalPeriod::Month => month_start_sast(as_of),
    };
    let current = metric_value(inputs, goal.metric, start, as_of);
    let percent = current.map(|value| {
        let reached = i128::from(value.max(0)) * 100 / i128::from(goal.target.max(1));
        reached.min(1000) as u32
    });
    GoalProgress {
        goal_id: goal.goal_id.clone(),
        function: goal.function,
        title: goal.title.clone(),
        metric: goal.metric,
        target: goal.target,
        period: goal.period,
        current,
        percent,
    }
}

/// How long a goal is measured over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalPeriod {
    /// The latest seven days.
    Week,
    /// The calendar month so far, in Johannesburg.
    Month,
}

/// Lifecycle of a goal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// Scout proposed it; the owner has not decided.
    Proposed,
    /// The owner approved it; the scorecard tracks it.
    Approved,
    /// The owner turned it down.
    Rejected,
    /// Stopped by its proposer, the owner or an admin.
    Retired,
}

impl GoalStatus {
    /// A goal that still waits for the owner or is tracked.
    pub const fn is_open(self) -> bool {
        matches!(self, GoalStatus::Proposed | GoalStatus::Approved)
    }
}

/// Relay-authored goal of one function (`company:fngoal:<uuid>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable goal UUID.
    pub goal_id: String,
    /// The function the goal belongs to.
    pub function: CompanyFunction,
    /// What the owner reads, for example "5 new clients a month".
    pub title: String,
    /// The number that measures it.
    pub metric: Metric,
    /// Where it should get to.
    pub target: i64,
    /// Over which period.
    pub period: GoalPeriod,
    /// Lifecycle state.
    pub status: GoalStatus,
    /// Why Scout proposes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Who proposed it.
    pub proposed_by_pubkey: String,
    /// When, Unix seconds.
    pub proposed_at: i64,
    /// Owner or admin who approved, rejected or retired it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by_pubkey: Option<String>,
    /// When, Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<i64>,
    /// Note that came with the decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// Relay-authored live scorecard (`company:scorecard`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ScorecardHead {
    /// Schema version.
    pub schema_version: u8,
    /// End of the latest window, Unix seconds.
    pub as_of: i64,
    /// Start of the latest window.
    pub window_start: i64,
    /// Start of the window before it.
    pub previous_start: i64,
    /// Currency of every money number.
    pub currency: String,
    /// Money facts left out because they were in another currency.
    pub other_currency_facts: u32,
    /// The five functions.
    pub functions: Vec<FunctionScorecard>,
    /// Approved goals and where they stand.
    pub goals: Vec<GoalProgress>,
}

/// Build the live scorecard at `as_of` over `inputs`, tracking `goals`.
pub fn compute_scorecard(inputs: &NumbersInputs, goals: &[GoalHead], as_of: i64) -> ScorecardHead {
    ScorecardHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        as_of,
        window_start: as_of - WEEK_SECS,
        previous_start: as_of - 2 * WEEK_SECS,
        currency: inputs.currency.clone(),
        other_currency_facts: inputs.other_currency_facts,
        functions: compute_function_scorecards(inputs, as_of),
        goals: goals
            .iter()
            .filter(|goal| goal.status == GoalStatus::Approved)
            .map(|goal| goal_progress(inputs, goal, as_of))
            .collect(),
    }
}

/// What the owner decided about one review decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionState {
    /// Waiting for the owner.
    Open,
    /// The owner said yes.
    Approved,
    /// The owner said no.
    Declined,
    /// The owner put it off until a later review.
    Deferred,
}

/// A decision a weekly review asks of the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewDecision {
    /// Stable id inside the review, `[a-z0-9_-]`, 1 to 32 characters.
    pub decision_id: String,
    /// What is asked, 1 to 120 characters.
    pub title: String,
    /// Why and what changes, at most 300 characters.
    #[serde(default)]
    pub detail: String,
    /// The function it concerns, if one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// Where it stands.
    pub state: DecisionState,
    /// Owner or admin who answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by_pubkey: Option<String>,
    /// When, Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<i64>,
    /// Note that came with the answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A decision as an agent proposes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewDecisionInput {
    /// Stable id inside the review.
    pub decision_id: String,
    /// What is asked.
    pub title: String,
    /// Why and what changes.
    #[serde(default)]
    pub detail: String,
    /// The function it concerns, if one.
    #[serde(default)]
    pub function: Option<CompanyFunction>,
}

/// Relay-authored weekly review (`company:review:<Friday date>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewHead {
    /// Schema version.
    pub schema_version: u8,
    /// The Friday that ends the week, `YYYY-MM-DD`.
    pub review_date: String,
    /// End of the week, Unix seconds.
    pub as_of: i64,
    /// Start of the week.
    pub window_start: i64,
    /// Start of the week before it.
    pub previous_start: i64,
    /// Currency of every money number.
    pub currency: String,
    /// Money facts left out because they were in another currency.
    pub other_currency_facts: u32,
    /// The numbers of the week, with the change against the week before. Written
    /// by the relay and never changed afterwards.
    pub functions: Vec<FunctionScorecard>,
    /// What went well, in Scout's words.
    #[serde(default)]
    pub wins: Vec<String>,
    /// What did not, in Scout's words.
    #[serde(default)]
    pub misses: Vec<String>,
    /// What the owner must decide.
    #[serde(default)]
    pub decisions: Vec<ReviewDecision>,
    /// Agent or admin who wrote the words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotated_by_pubkey: Option<String>,
    /// When, Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotated_at: Option<i64>,
    /// When the relay wrote the numbers, Unix seconds.
    pub created_at: i64,
    /// Latest action event that changed this head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_action_event_id: Option<String>,
}

/// The Friday a review is due for, and when its week ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewWindow {
    /// The Friday, `YYYY-MM-DD`.
    pub review_date: String,
    /// Friday 14:00 UTC (16:00 in Johannesburg), Unix seconds.
    pub as_of: i64,
}

/// The review due at `now`: the latest Friday cut that has passed, until
/// [`REVIEW_CATCH_UP_SECS`] after it. `None` on a quiet Wednesday.
pub fn review_due(now: i64) -> Option<ReviewWindow> {
    let at = DateTime::from_timestamp(now, 0)?;
    let days_since_friday = i64::from((at.weekday().num_days_from_monday() + 3) % 7);
    let friday = at.date_naive() - Duration::days(days_since_friday);
    let mut cut = Utc
        .with_ymd_and_hms(
            friday.year(),
            friday.month(),
            friday.day(),
            REVIEW_HOUR_UTC,
            0,
            0,
        )
        .single()?;
    if cut.timestamp() > now {
        cut -= Duration::days(7);
    }
    let as_of = cut.timestamp();
    if now - as_of > REVIEW_CATCH_UP_SECS {
        return None;
    }
    Some(ReviewWindow {
        review_date: cut.format("%Y-%m-%d").to_string(),
        as_of,
    })
}

/// A fresh review: the relay's numbers and no words yet.
pub fn build_review(window: &ReviewWindow, inputs: &NumbersInputs, created_at: i64) -> ReviewHead {
    ReviewHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        review_date: window.review_date.clone(),
        as_of: window.as_of,
        window_start: window.as_of - WEEK_SECS,
        previous_start: window.as_of - 2 * WEEK_SECS,
        currency: inputs.currency.clone(),
        other_currency_facts: inputs.other_currency_facts,
        functions: compute_function_scorecards(inputs, window.as_of),
        wins: Vec::new(),
        misses: Vec::new(),
        decisions: Vec::new(),
        annotated_by_pubkey: None,
        annotated_at: None,
        created_at,
        source_action_event_id: None,
    }
}

/// What a numbers action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NumbersOp {
    /// Propose a goal for a function.
    GoalPropose,
    /// Approve a proposed goal (owner or admin).
    GoalApprove,
    /// Reject a proposed goal (owner or admin).
    GoalReject,
    /// Stop a goal (its proposer, the owner or an admin).
    GoalRetire,
    /// Ask the relay to recompute the live scorecard.
    ScorecardRefresh,
    /// Write the wins, misses and decisions of a review.
    ReviewAnnotate,
    /// Answer one decision of a review (owner or admin).
    ReviewDecide,
}

/// Member-signed numbers write (kind 47068). Each op takes only the fields it
/// names; anything else is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NumbersAction {
    /// Schema version.
    pub schema_version: u8,
    /// What to do.
    pub op: NumbersOp,
    /// The goal, for goal ops.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    /// The goal's function, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// The goal's title, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The goal's number, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<Metric>,
    /// The goal's target, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<i64>,
    /// The goal's period, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<GoalPeriod>,
    /// Why the goal is proposed, for `goal_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The review's Friday, for review ops.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_date: Option<String>,
    /// Wins, for `review_annotate`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wins: Option<Vec<String>>,
    /// Misses, for `review_annotate`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub misses: Option<Vec<String>>,
    /// Decisions, for `review_annotate`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decisions: Option<Vec<ReviewDecisionInput>>,
    /// The decision answered, for `review_decide`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision_id: Option<String>,
    /// The answer, for `review_decide`: `approved`, `declined` or `deferred`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice: Option<DecisionState>,
    /// A note with a decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Exact current head event id; omitted for `goal_propose` and `scorecard_refresh`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

impl NumbersAction {
    /// The d-tag of the record this action changes.
    pub fn d_tag(&self) -> Result<String, CompanyRecordError> {
        match self.op {
            NumbersOp::ScorecardRefresh => Ok(SCORECARD_D_TAG.to_owned()),
            NumbersOp::GoalPropose
            | NumbersOp::GoalApprove
            | NumbersOp::GoalReject
            | NumbersOp::GoalRetire => goal_d_tag(self.goal_id.as_deref().unwrap_or_default()),
            NumbersOp::ReviewAnnotate | NumbersOp::ReviewDecide => {
                review_d_tag(self.review_date.as_deref().unwrap_or_default())
            }
        }
    }
}

/// d-tag of a goal.
pub fn goal_d_tag(goal_id: &str) -> Result<String, CompanyRecordError> {
    if !is_canonical_uuid(goal_id) {
        return Err(CompanyRecordError::Invalid(
            "goalId must be a lowercase UUID",
        ));
    }
    Ok(format!("{GOAL_D_TAG_PREFIX}{goal_id}"))
}

/// d-tag of a review.
pub fn review_d_tag(review_date: &str) -> Result<String, CompanyRecordError> {
    if !is_review_date(review_date) {
        return Err(CompanyRecordError::Invalid(
            "reviewDate must be a Friday written YYYY-MM-DD",
        ));
    }
    Ok(format!("{REVIEW_D_TAG_PREFIX}{review_date}"))
}

/// Which record a numbers d-tag names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NumbersRecord {
    /// The live scorecard.
    Scorecard,
    /// A goal, by id.
    Goal(String),
    /// A review, by Friday date.
    Review(String),
}

/// Read a numbers d-tag.
pub fn parse_numbers_d_tag(d_tag: &str) -> Result<NumbersRecord, CompanyRecordError> {
    if d_tag == SCORECARD_D_TAG {
        return Ok(NumbersRecord::Scorecard);
    }
    if let Some(id) = d_tag.strip_prefix(GOAL_D_TAG_PREFIX) {
        goal_d_tag(id)?;
        return Ok(NumbersRecord::Goal(id.to_owned()));
    }
    if let Some(date) = d_tag.strip_prefix(REVIEW_D_TAG_PREFIX) {
        review_d_tag(date)?;
        return Ok(NumbersRecord::Review(date.to_owned()));
    }
    Err(CompanyRecordError::DTagMismatch)
}

fn is_canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|id| !id.is_nil() && id.hyphenated().to_string() == value)
        .unwrap_or(false)
}

fn is_review_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|date| {
            date.format("%Y-%m-%d").to_string() == value
                && date.weekday().num_days_from_monday() == 4
        })
        .unwrap_or(false)
}

fn text_within(value: &str, max_chars: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max_chars
}

fn is_item_id(value: &str) -> bool {
    let length = value.chars().count();
    (1..=32).contains(&length)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn present_fields(action: &NumbersAction) -> Vec<&'static str> {
    let mut fields = Vec::new();
    let mut note = |present: bool, name: &'static str| {
        if present {
            fields.push(name);
        }
    };
    note(action.goal_id.is_some(), "goalId");
    note(action.function.is_some(), "function");
    note(action.title.is_some(), "title");
    note(action.metric.is_some(), "metric");
    note(action.target.is_some(), "target");
    note(action.period.is_some(), "period");
    note(action.reason.is_some(), "reason");
    note(action.review_date.is_some(), "reviewDate");
    note(action.wins.is_some(), "wins");
    note(action.misses.is_some(), "misses");
    note(action.decisions.is_some(), "decisions");
    note(action.decision_id.is_some(), "decisionId");
    note(action.choice.is_some(), "choice");
    note(action.note.is_some(), "note");
    note(
        action.expected_head_event_id.is_some(),
        "expectedHeadEventId",
    );
    fields
}

/// `(required, optional)` fields of each op.
fn op_fields(op: NumbersOp) -> (&'static [&'static str], &'static [&'static str]) {
    match op {
        NumbersOp::GoalPropose => (
            &["goalId", "function", "title", "metric", "target", "period"],
            &["reason"],
        ),
        NumbersOp::GoalApprove | NumbersOp::GoalReject | NumbersOp::GoalRetire => {
            (&["goalId", "expectedHeadEventId"], &["note"])
        }
        NumbersOp::ScorecardRefresh => (&[], &["expectedHeadEventId"]),
        NumbersOp::ReviewAnnotate => (
            &["reviewDate", "expectedHeadEventId"],
            &["wins", "misses", "decisions"],
        ),
        NumbersOp::ReviewDecide => (
            &["reviewDate", "decisionId", "choice", "expectedHeadEventId"],
            &["note"],
        ),
    }
}

fn lines_valid(lines: &[String]) -> bool {
    lines.len() <= MAX_REVIEW_ITEMS
        && lines
            .iter()
            .all(|line| text_within(line, MAX_REVIEW_LINE_CHARS))
}

/// Validate a numbers action on its own, before any state is read.
pub fn validate_numbers_action(action: &NumbersAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    let present = present_fields(action);
    let (required, optional) = op_fields(action.op);
    if required.iter().any(|name| !present.contains(name)) {
        return Err(CompanyRecordError::Invalid(
            "this numbers op is missing a field it needs",
        ));
    }
    if present
        .iter()
        .any(|name| !required.contains(name) && !optional.contains(name))
    {
        return Err(CompanyRecordError::Invalid(
            "this numbers op carries a field it does not take",
        ));
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    action.d_tag()?;
    if let Some(title) = action.title.as_deref() {
        if !text_within(title, MAX_NUMBERS_TITLE_CHARS) {
            return Err(CompanyRecordError::Invalid(
                "a title is 1 to 120 characters",
            ));
        }
    }
    for text in [action.reason.as_deref(), action.note.as_deref()]
        .into_iter()
        .flatten()
    {
        if !text_within(text, MAX_NUMBERS_NOTE_CHARS) {
            return Err(CompanyRecordError::Invalid(
                "a reason or note is 1 to 300 characters",
            ));
        }
    }
    if action
        .target
        .is_some_and(|target| !(1..=MAX_GOAL_TARGET).contains(&target))
    {
        return Err(CompanyRecordError::Invalid("a goal target is out of range"));
    }
    if let (Some(function), Some(metric)) = (action.function, action.metric) {
        if metric.function() != function {
            return Err(CompanyRecordError::Invalid(
                "a goal measures a number of its own function",
            ));
        }
    }
    if action
        .wins
        .as_deref()
        .is_some_and(|lines| !lines_valid(lines))
        || action
            .misses
            .as_deref()
            .is_some_and(|lines| !lines_valid(lines))
    {
        return Err(CompanyRecordError::Invalid(
            "a review carries at most 5 wins and 5 misses of 1 to 200 characters",
        ));
    }
    if let Some(decisions) = action.decisions.as_deref() {
        validate_decision_inputs(decisions)?;
    }
    if let Some(choice) = action.choice {
        if choice == DecisionState::Open {
            return Err(CompanyRecordError::Invalid(
                "choice is approved, declined or deferred",
            ));
        }
    }
    if let Some(id) = action.decision_id.as_deref() {
        if !is_item_id(id) {
            return Err(CompanyRecordError::Invalid(
                "decisionId is 1 to 32 characters of a-z, 0-9, - and _",
            ));
        }
    }
    Ok(())
}

fn validate_decision_inputs(decisions: &[ReviewDecisionInput]) -> Result<(), CompanyRecordError> {
    if decisions.len() > MAX_REVIEW_ITEMS {
        return Err(CompanyRecordError::Invalid(
            "a review asks at most 5 decisions",
        ));
    }
    for (index, decision) in decisions.iter().enumerate() {
        if !is_item_id(&decision.decision_id)
            || !text_within(&decision.title, MAX_NUMBERS_TITLE_CHARS)
            || decision.detail.chars().count() > MAX_NUMBERS_NOTE_CHARS
        {
            return Err(CompanyRecordError::Invalid(
                "a decision needs an id, a title of 1 to 120 characters and a detail of at most 300",
            ));
        }
        if decisions[..index]
            .iter()
            .any(|seen| seen.decision_id == decision.decision_id)
        {
            return Err(CompanyRecordError::Invalid(
                "decision ids are unique inside a review",
            ));
        }
    }
    Ok(())
}

/// Validate a relay-authored goal head.
pub fn validate_goal_head(head: &GoalHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    goal_d_tag(&head.goal_id)?;
    if !text_within(&head.title, MAX_NUMBERS_TITLE_CHARS)
        || head.metric.function() != head.function
        || !(1..=MAX_GOAL_TARGET).contains(&head.target)
        || !is_hex_id(&head.proposed_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
    {
        return Err(CompanyRecordError::Invalid(
            "goal head needs a title, a target, a metric of its function and valid ids",
        ));
    }
    if head
        .decided_by_pubkey
        .as_deref()
        .is_some_and(|key| !is_hex_id(key))
    {
        return Err(CompanyRecordError::Invalid(
            "goal head decider must be a 64-character pubkey",
        ));
    }
    Ok(())
}

/// Validate a relay-authored review head.
pub fn validate_review_head(head: &ReviewHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    review_d_tag(&head.review_date)?;
    if head.functions.len() != CompanyFunction::ALL.len()
        || !lines_valid(&head.wins)
        || !lines_valid(&head.misses)
        || head.decisions.len() > MAX_REVIEW_ITEMS
    {
        return Err(CompanyRecordError::Invalid(
            "review head carries five functions and at most 5 wins, misses and decisions",
        ));
    }
    Ok(())
}

/// Validate a relay-authored scorecard head.
pub fn validate_scorecard_head(head: &ScorecardHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if head.functions.len() != CompanyFunction::ALL.len() {
        return Err(CompanyRecordError::Invalid(
            "scorecard head carries five functions",
        ));
    }
    Ok(())
}

fn refuse(kind: PlanErrorKind, message: impl Into<String>) -> PlanError {
    PlanError {
        kind,
        message: message.into(),
    }
}

fn require_cofounder(context: &PlanContext, what: &str) -> Result<(), PlanError> {
    if context.cofounder_enabled {
        Ok(())
    } else {
        Err(refuse(
            PlanErrorKind::Forbidden,
            format!("co-founder mode is off for this company, so {what}"),
        ))
    }
}

fn require_admin(actor: &PlanActor, what: &str) -> Result<(), PlanError> {
    if actor.role == PlanActorRole::Admin {
        Ok(())
    } else {
        Err(refuse(
            PlanErrorKind::Forbidden,
            format!("only an owner or admin can {what}; an agent never can"),
        ))
    }
}

/// Apply a goal action to the current goal head (`None` when it does not exist).
pub fn apply_goal_action(
    current: Option<&GoalHead>,
    action: &NumbersAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<GoalHead, PlanError> {
    let bad = |message: &str| refuse(PlanErrorKind::Invalid, message);
    let goal_id = action.goal_id.clone().unwrap_or_default();
    match (action.op, current) {
        (NumbersOp::GoalPropose, Some(_)) => Err(refuse(
            PlanErrorKind::Conflict,
            "a goal with this id already exists",
        )),
        (NumbersOp::GoalPropose, None) => {
            require_cofounder(context, "no new goal can be proposed")?;
            if actor.role == PlanActorRole::Member {
                return Err(refuse(
                    PlanErrorKind::Forbidden,
                    "only an owner, an admin or an employee can propose a goal",
                ));
            }
            Ok(GoalHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                goal_id,
                function: action.function.ok_or_else(|| bad("function is required"))?,
                title: action
                    .title
                    .clone()
                    .ok_or_else(|| bad("title is required"))?,
                metric: action.metric.ok_or_else(|| bad("metric is required"))?,
                target: action.target.ok_or_else(|| bad("target is required"))?,
                period: action.period.ok_or_else(|| bad("period is required"))?,
                status: GoalStatus::Proposed,
                reason: action.reason.clone(),
                proposed_by_pubkey: actor.pubkey.clone(),
                proposed_at: context.now,
                decided_by_pubkey: None,
                decided_at: None,
                note: None,
                source_action_event_id: context.action_event_id.clone(),
            })
        }
        (_, None) => Err(refuse(PlanErrorKind::Conflict, "there is no such goal")),
        (NumbersOp::GoalApprove | NumbersOp::GoalReject, Some(goal)) => {
            require_cofounder(context, "no goal can be decided")?;
            if goal.status != GoalStatus::Proposed {
                return Err(refuse(
                    PlanErrorKind::Conflict,
                    "only a proposed goal can be approved or rejected",
                ));
            }
            let mut next = goal.clone();
            next.status = if action.op == NumbersOp::GoalApprove {
                GoalStatus::Approved
            } else {
                GoalStatus::Rejected
            };
            decide_goal(&mut next, action, actor, context);
            Ok(next)
        }
        (NumbersOp::GoalRetire, Some(goal)) => {
            if actor.role != PlanActorRole::Admin && actor.pubkey != goal.proposed_by_pubkey {
                return Err(refuse(
                    PlanErrorKind::Forbidden,
                    "only the proposer, an owner or an admin can retire a goal",
                ));
            }
            if !goal.status.is_open() {
                return Err(refuse(PlanErrorKind::Conflict, "this goal already ended"));
            }
            let mut next = goal.clone();
            next.status = GoalStatus::Retired;
            decide_goal(&mut next, action, actor, context);
            Ok(next)
        }
        _ => Err(bad("this is not a goal op")),
    }
}

fn decide_goal(
    goal: &mut GoalHead,
    action: &NumbersAction,
    actor: &PlanActor,
    context: &PlanContext,
) {
    goal.decided_by_pubkey = Some(actor.pubkey.clone());
    goal.decided_at = Some(context.now);
    goal.note = action.note.clone();
    goal.source_action_event_id = context.action_event_id.clone();
}

/// Write the wins, misses and decisions of a review. Only the words change;
/// the relay's numbers never do. Once the owner answered a decision the words
/// are final.
pub fn apply_review_annotate(
    current: &ReviewHead,
    action: &NumbersAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<ReviewHead, PlanError> {
    require_cofounder(context, "no review can be written")?;
    if actor.role == PlanActorRole::Member {
        return Err(refuse(
            PlanErrorKind::Forbidden,
            "only an owner, an admin or an employee can write a review",
        ));
    }
    if current
        .decisions
        .iter()
        .any(|decision| decision.state != DecisionState::Open)
    {
        return Err(refuse(
            PlanErrorKind::Conflict,
            "the owner already answered a decision of this review, so its words are final",
        ));
    }
    let mut next = current.clone();
    next.wins = action.wins.clone().unwrap_or_default();
    next.misses = action.misses.clone().unwrap_or_default();
    next.decisions = action
        .decisions
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|input| ReviewDecision {
            decision_id: input.decision_id,
            title: input.title,
            detail: input.detail,
            function: input.function,
            state: DecisionState::Open,
            decided_by_pubkey: None,
            decided_at: None,
            note: None,
        })
        .collect();
    next.annotated_by_pubkey = Some(actor.pubkey.clone());
    next.annotated_at = Some(context.now);
    next.source_action_event_id = Some(context.action_event_id.clone());
    Ok(next)
}

/// Answer one decision of a review (owner or admin only).
pub fn apply_review_decide(
    current: &ReviewHead,
    action: &NumbersAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<ReviewHead, PlanError> {
    require_cofounder(context, "no decision can be answered")?;
    require_admin(actor, "answer a review decision")?;
    let decision_id = action.decision_id.as_deref().unwrap_or_default();
    let choice = action
        .choice
        .ok_or_else(|| refuse(PlanErrorKind::Invalid, "choice is required"))?;
    let mut next = current.clone();
    let decision = next
        .decisions
        .iter_mut()
        .find(|decision| decision.decision_id == decision_id)
        .ok_or_else(|| refuse(PlanErrorKind::Conflict, "this review has no such decision"))?;
    if decision.state != DecisionState::Open {
        return Err(refuse(
            PlanErrorKind::Conflict,
            "this decision was already answered",
        ));
    }
    decision.state = choice;
    decision.decided_by_pubkey = Some(actor.pubkey.clone());
    decision.decided_at = Some(context.now);
    decision.note = action.note.clone();
    next.source_action_event_id = Some(context.action_event_id.clone());
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SCOUT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const EVENT: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const GOAL: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

    /// Friday 30 October 2026, 14:00 UTC.
    fn friday() -> i64 {
        Utc.with_ymd_and_hms(2026, 10, 30, 14, 0, 0)
            .unwrap()
            .timestamp()
    }

    const HOUR: i64 = 3_600;
    const DAY: i64 = 86_400;

    fn actor(role: PlanActorRole, pubkey: &str) -> PlanActor {
        PlanActor {
            pubkey: pubkey.to_owned(),
            role,
            led_functions: Vec::new(),
        }
    }

    fn context(enabled: bool) -> PlanContext {
        PlanContext {
            now: friday(),
            cofounder_enabled: enabled,
            action_event_id: EVENT.to_owned(),
        }
    }

    /// A week of fixture records. The latest window is
    /// `[friday - 7d, friday)`, the one before is `[friday - 14d, friday - 7d)`.
    fn fixture() -> NumbersInputs {
        let now = friday();
        NumbersInputs {
            currency: "ZAR".into(),
            leads_created: vec![
                now - HOUR,
                now - 2 * DAY,
                now - 6 * DAY,
                now - 7 * DAY - 1, // last second of the previous window
                now - 9 * DAY,
            ],
            contacts_started: vec![now - 3 * DAY, now - 3 * DAY, now - 4 * DAY, now - 8 * DAY],
            first_replies: vec![now - 2 * DAY, now - 10 * DAY, now - 11 * DAY],
            quotes_sent: vec![now - DAY],
            proposals_accepted: vec![now - 2 * HOUR, now - 5 * DAY, now - 20 * DAY],
            worker_runs: vec![
                WorkerFact {
                    started_at: now - 2 * DAY,
                    ended_at: Some(now - 2 * DAY + 600),
                    outcome: WorkerOutcome::Done,
                    cost_usd_cents: 35,
                },
                WorkerFact {
                    started_at: now - 3 * DAY,
                    ended_at: Some(now - 3 * DAY + 900),
                    outcome: WorkerOutcome::Failed,
                    cost_usd_cents: 10,
                },
                WorkerFact {
                    started_at: now - 8 * DAY,
                    ended_at: Some(now - 8 * DAY + 60),
                    outcome: WorkerOutcome::Done,
                    cost_usd_cents: 100,
                },
                WorkerFact {
                    started_at: now - 600,
                    ended_at: None,
                    outcome: WorkerOutcome::Running,
                    cost_usd_cents: 0,
                },
            ],
            plan_approvals: vec![now - DAY, now - 9 * DAY],
            payments: vec![
                MoneyFact {
                    at: now - DAY,
                    amount_minor: 150_000,
                },
                MoneyFact {
                    at: now - 3 * DAY,
                    amount_minor: 25_050,
                },
                MoneyFact {
                    at: now - 10 * DAY,
                    amount_minor: 80_000,
                },
            ],
            invoices_issued: vec![
                MoneyFact {
                    at: now - 2 * DAY,
                    amount_minor: 300_000,
                },
                MoneyFact {
                    at: now - 12 * DAY,
                    amount_minor: 120_000,
                },
            ],
            owed_minor: 144_950,
            active_clients: 4,
            other_currency_facts: 1,
        }
    }

    fn reading(
        scorecards: &[FunctionScorecard],
        function: CompanyFunction,
        metric: Metric,
    ) -> &MetricReading {
        scorecards
            .iter()
            .find(|card| card.function == function)
            .expect("function")
            .metrics
            .iter()
            .find(|reading| reading.metric == metric)
            .expect("metric")
    }

    fn assert_reading(
        scorecards: &[FunctionScorecard],
        metric: Metric,
        value: Option<i64>,
        previous: Option<i64>,
        change: Option<i64>,
    ) {
        let got = reading(scorecards, metric.function(), metric);
        assert_eq!(
            (got.value, got.previous, got.change),
            (value, previous, change),
            "{metric:?}"
        );
    }

    #[test]
    fn a_week_of_fixture_records_gives_exact_numbers() {
        let cards = compute_function_scorecards(&fixture(), friday());
        // Sales
        assert_reading(&cards, Metric::LeadsFound, Some(3), Some(2), Some(1));
        assert_reading(&cards, Metric::Contacted, Some(3), Some(1), Some(2));
        assert_reading(&cards, Metric::Replied, Some(1), Some(2), Some(-1));
        assert_reading(&cards, Metric::Quotes, Some(1), Some(0), Some(1));
        assert_reading(&cards, Metric::Won, Some(2), Some(0), Some(2));
        // Operations
        assert_reading(&cards, Metric::WorkersStarted, Some(3), Some(1), Some(2));
        assert_reading(&cards, Metric::WorkersDone, Some(1), Some(1), Some(0));
        assert_reading(&cards, Metric::WorkersFailed, Some(1), Some(0), Some(1));
        assert_reading(&cards, Metric::PlansApproved, Some(1), Some(1), Some(0));
        // Customer Success and Finance
        assert_reading(&cards, Metric::ActiveClients, Some(4), None, None);
        assert_reading(
            &cards,
            Metric::CashIn,
            Some(175_050),
            Some(80_000),
            Some(95_050),
        );
        assert_reading(
            &cards,
            Metric::Invoiced,
            Some(300_000),
            Some(120_000),
            Some(180_000),
        );
        assert_reading(&cards, Metric::Owed, Some(144_950), None, None);
        assert_reading(&cards, Metric::WorkerCost, Some(45), Some(100), Some(-55));
        // Brand: 45 cents of worker cost over 2 wins is 22.5, rounded half up to 23.
        assert_reading(&cards, Metric::CostPerWin, Some(23), None, None);
    }

    #[test]
    fn a_window_includes_its_start_and_excludes_its_end() {
        let now = friday();
        let inputs = NumbersInputs {
            leads_created: vec![now - WEEK_SECS, now - 1, now],
            ..NumbersInputs::default()
        };
        // now - 7d is inside the latest window, `now` itself is not.
        assert_eq!(
            metric_value(&inputs, Metric::LeadsFound, now - WEEK_SECS, now),
            Some(2)
        );
    }

    #[test]
    fn a_cost_per_win_with_nothing_won_is_not_stated() {
        let inputs = NumbersInputs {
            worker_runs: vec![WorkerFact {
                started_at: 10,
                ended_at: Some(20),
                outcome: WorkerOutcome::Done,
                cost_usd_cents: 500,
            }],
            ..NumbersInputs::default()
        };
        assert_eq!(metric_value(&inputs, Metric::CostPerWin, 0, 100), None);
    }

    #[test]
    fn an_empty_company_reads_zero_not_missing() {
        let cards = compute_function_scorecards(&NumbersInputs::default(), friday());
        assert_eq!(cards.len(), 5);
        assert_reading(&cards, Metric::LeadsFound, Some(0), Some(0), Some(0));
        assert_reading(&cards, Metric::CashIn, Some(0), Some(0), Some(0));
        assert_eq!(
            cards[0].not_tracked,
            vec!["calls".to_owned()],
            "Sales does not track calls yet"
        );
    }

    #[test]
    fn every_metric_belongs_to_one_function_and_the_five_functions_are_covered() {
        for function in CompanyFunction::ALL {
            let metrics = metrics_for(function);
            assert!(!metrics.is_empty(), "{function:?} has a number");
            assert!(metrics.iter().all(|metric| metric.function() == function));
        }
        assert_eq!(
            CompanyFunction::ALL
                .into_iter()
                .map(|function| metrics_for(function).len())
                .sum::<usize>(),
            Metric::ALL.len()
        );
    }

    fn goal(period: GoalPeriod, metric: Metric, target: i64) -> GoalHead {
        GoalHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id: GOAL.into(),
            function: metric.function(),
            title: "Win clients".into(),
            metric,
            target,
            period,
            status: GoalStatus::Approved,
            reason: None,
            proposed_by_pubkey: SCOUT.into(),
            proposed_at: 1,
            decided_by_pubkey: Some(OWNER.into()),
            decided_at: Some(2),
            note: None,
            source_action_event_id: EVENT.into(),
        }
    }

    #[test]
    fn goal_progress_measures_the_goal_period() {
        let inputs = fixture();
        // Week: the latest seven days hold 2 wins.
        let week = goal_progress(&inputs, &goal(GoalPeriod::Week, Metric::Won, 5), friday());
        assert_eq!((week.current, week.percent), (Some(2), Some(40)));
        // Month: October (Johannesburg) so far holds all 3 wins (the oldest is 20 days back, 10 Oct).
        let month = goal_progress(&inputs, &goal(GoalPeriod::Month, Metric::Won, 4), friday());
        assert_eq!((month.current, month.percent), (Some(3), Some(75)));
    }

    #[test]
    fn a_month_starts_at_midnight_in_johannesburg() {
        // 1 November 00:00 in Johannesburg is 31 October 22:00 UTC.
        let late_october = Utc
            .with_ymd_and_hms(2026, 10, 31, 23, 0, 0)
            .unwrap()
            .timestamp();
        assert_eq!(
            month_start_sast(late_october),
            Utc.with_ymd_and_hms(2026, 10, 31, 22, 0, 0)
                .unwrap()
                .timestamp()
        );
        assert_eq!(
            month_start_sast(friday()),
            Utc.with_ymd_and_hms(2026, 9, 30, 22, 0, 0)
                .unwrap()
                .timestamp()
        );
    }

    #[test]
    fn a_goal_over_target_is_capped_and_an_unstated_goal_has_no_percent() {
        let inputs = fixture();
        let over = goal_progress(&inputs, &goal(GoalPeriod::Week, Metric::Won, 1), friday());
        assert_eq!(over.percent, Some(200));
        let none = goal_progress(
            &NumbersInputs::default(),
            &goal(GoalPeriod::Week, Metric::CostPerWin, 100),
            friday(),
        );
        assert_eq!((none.current, none.percent), (None, None));
    }

    #[test]
    fn the_scorecard_tracks_only_approved_goals() {
        let mut proposed = goal(GoalPeriod::Week, Metric::Won, 5);
        proposed.status = GoalStatus::Proposed;
        let approved = goal(GoalPeriod::Week, Metric::Contacted, 10);
        let head = compute_scorecard(&fixture(), &[proposed, approved], friday());
        assert_eq!(head.goals.len(), 1);
        assert_eq!(head.goals[0].metric, Metric::Contacted);
        assert_eq!(head.window_start, friday() - WEEK_SECS);
        assert_eq!(head.previous_start, friday() - 2 * WEEK_SECS);
        validate_scorecard_head(&head).unwrap();
    }

    fn ts(year: i32, month: u32, day: u32, hour: u32) -> i64 {
        Utc.with_ymd_and_hms(year, month, day, hour, 0, 0)
            .unwrap()
            .timestamp()
    }

    #[test]
    fn the_review_is_due_after_the_friday_cut_and_through_the_weekend() {
        // Friday 13:59 UTC: the cut has not passed, and last Friday is 7 days old.
        assert_eq!(review_due(ts(2026, 10, 30, 13) + 59 * 60), None);
        let due = review_due(ts(2026, 10, 30, 14)).expect("due at the cut");
        assert_eq!(due.review_date, "2026-10-30");
        assert_eq!(due.as_of, ts(2026, 10, 30, 14));
        // Sunday and Monday morning still write the Friday review.
        assert_eq!(
            review_due(ts(2026, 11, 1, 9)).unwrap().review_date,
            "2026-10-30"
        );
        assert_eq!(
            review_due(ts(2026, 11, 2, 9)).unwrap().review_date,
            "2026-10-30"
        );
        // A quiet Wednesday has nothing due.
        assert_eq!(review_due(ts(2026, 11, 4, 9)), None);
        // The next Friday starts the next review.
        assert_eq!(
            review_due(ts(2026, 11, 6, 15)).unwrap().review_date,
            "2026-11-06"
        );
    }

    #[test]
    fn a_review_carries_the_relays_numbers_for_the_week() {
        let window = review_due(ts(2026, 10, 30, 15)).unwrap();
        let review = build_review(&window, &fixture(), ts(2026, 10, 30, 15));
        assert_eq!(review.review_date, "2026-10-30");
        assert_eq!(review.as_of, friday());
        assert_eq!(review.functions.len(), 5);
        assert_reading(&review.functions, Metric::Won, Some(2), Some(0), Some(2));
        assert!(review.wins.is_empty() && review.decisions.is_empty());
        validate_review_head(&review).unwrap();
        // Round trip through the wire format.
        let json = serde_json::to_string(&review).unwrap();
        assert_eq!(serde_json::from_str::<ReviewHead>(&json).unwrap(), review);
    }

    fn propose_action() -> NumbersAction {
        NumbersAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            op: NumbersOp::GoalPropose,
            goal_id: Some(GOAL.into()),
            function: Some(CompanyFunction::Sales),
            title: Some("5 new clients a month".into()),
            metric: Some(Metric::Won),
            target: Some(5),
            period: Some(GoalPeriod::Month),
            reason: Some("Last month closed 3.".into()),
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

    fn decide_action(op: NumbersOp) -> NumbersAction {
        NumbersAction {
            op,
            function: None,
            title: None,
            metric: None,
            target: None,
            period: None,
            reason: None,
            expected_head_event_id: Some(EVENT.into()),
            ..propose_action()
        }
    }

    #[test]
    fn an_agent_proposes_a_goal_and_only_the_owner_approves_it() {
        let scout = actor(PlanActorRole::ManagedAgent, SCOUT);
        let owner = actor(PlanActorRole::Admin, OWNER);
        let proposed = apply_goal_action(None, &propose_action(), &scout, &context(true)).unwrap();
        assert_eq!(proposed.status, GoalStatus::Proposed);
        assert_eq!(proposed.proposed_by_pubkey, SCOUT);

        let approve = decide_action(NumbersOp::GoalApprove);
        let refused = apply_goal_action(Some(&proposed), &approve, &scout, &context(true))
            .expect_err("an agent never approves");
        assert_eq!(refused.kind, PlanErrorKind::Forbidden);
        let member = actor(
            PlanActorRole::Member,
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        );
        assert_eq!(
            apply_goal_action(Some(&proposed), &approve, &member, &context(true))
                .expect_err("a plain member never approves")
                .kind,
            PlanErrorKind::Forbidden
        );

        let approved =
            apply_goal_action(Some(&proposed), &approve, &owner, &context(true)).unwrap();
        assert_eq!(approved.status, GoalStatus::Approved);
        assert_eq!(approved.decided_by_pubkey.as_deref(), Some(OWNER));
        assert_eq!(approved.decided_at, Some(friday()));
        // Approving twice conflicts.
        assert_eq!(
            apply_goal_action(Some(&approved), &approve, &owner, &context(true))
                .expect_err("already decided")
                .kind,
            PlanErrorKind::Conflict
        );
    }

    #[test]
    fn co_founder_mode_off_stops_new_goals_and_decisions() {
        let scout = actor(PlanActorRole::ManagedAgent, SCOUT);
        let owner = actor(PlanActorRole::Admin, OWNER);
        assert_eq!(
            apply_goal_action(None, &propose_action(), &scout, &context(false))
                .expect_err("off")
                .kind,
            PlanErrorKind::Forbidden
        );
        let proposed = apply_goal_action(None, &propose_action(), &scout, &context(true)).unwrap();
        assert_eq!(
            apply_goal_action(
                Some(&proposed),
                &decide_action(NumbersOp::GoalApprove),
                &owner,
                &context(false)
            )
            .expect_err("off")
            .kind,
            PlanErrorKind::Forbidden
        );
    }

    #[test]
    fn a_proposer_or_the_owner_retires_a_goal_and_nobody_else() {
        let scout = actor(PlanActorRole::ManagedAgent, SCOUT);
        let other = actor(
            PlanActorRole::ManagedAgent,
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        );
        let owner = actor(PlanActorRole::Admin, OWNER);
        let proposed = apply_goal_action(None, &propose_action(), &scout, &context(true)).unwrap();
        let retire = decide_action(NumbersOp::GoalRetire);
        assert_eq!(
            apply_goal_action(Some(&proposed), &retire, &other, &context(true))
                .expect_err("not the proposer")
                .kind,
            PlanErrorKind::Forbidden
        );
        let retired = apply_goal_action(Some(&proposed), &retire, &scout, &context(true)).unwrap();
        assert_eq!(retired.status, GoalStatus::Retired);
        assert_eq!(
            apply_goal_action(Some(&retired), &retire, &owner, &context(true))
                .expect_err("ended")
                .kind,
            PlanErrorKind::Conflict
        );
    }

    #[test]
    fn a_goal_measures_a_number_of_its_own_function() {
        let mut action = propose_action();
        action.metric = Some(Metric::CashIn);
        assert!(validate_numbers_action(&action).is_err());
        action.function = Some(CompanyFunction::Finance);
        assert!(validate_numbers_action(&action).is_ok());
    }

    #[test]
    fn each_op_takes_only_its_own_fields() {
        assert!(validate_numbers_action(&propose_action()).is_ok());
        let mut extra = propose_action();
        extra.choice = Some(DecisionState::Approved);
        assert!(
            validate_numbers_action(&extra).is_err(),
            "choice is not a goal field"
        );
        let mut missing = propose_action();
        missing.target = None;
        assert!(validate_numbers_action(&missing).is_err());
        let mut zero = propose_action();
        zero.target = Some(0);
        assert!(validate_numbers_action(&zero).is_err());
        let refresh = NumbersAction {
            op: NumbersOp::ScorecardRefresh,
            goal_id: None,
            function: None,
            title: None,
            metric: None,
            target: None,
            period: None,
            reason: None,
            ..propose_action()
        };
        assert!(validate_numbers_action(&refresh).is_ok());
        assert_eq!(refresh.d_tag().unwrap(), SCORECARD_D_TAG);
    }

    #[test]
    fn d_tags_round_trip_and_reject_other_shapes() {
        let goal_tag = goal_d_tag(GOAL).unwrap();
        assert_eq!(
            parse_numbers_d_tag(&goal_tag),
            Ok(NumbersRecord::Goal(GOAL.into()))
        );
        let review_tag = review_d_tag("2026-10-30").unwrap();
        assert_eq!(review_tag, "company:review:2026-10-30");
        assert_eq!(
            parse_numbers_d_tag(&review_tag),
            Ok(NumbersRecord::Review("2026-10-30".into()))
        );
        assert_eq!(
            parse_numbers_d_tag(SCORECARD_D_TAG),
            Ok(NumbersRecord::Scorecard)
        );
        // A Saturday, a bad date, an upper-case id and a stranger are all refused.
        assert!(review_d_tag("2026-10-31").is_err());
        assert!(review_d_tag("2026-13-01").is_err());
        assert!(goal_d_tag(&GOAL.to_uppercase()).is_err());
        assert!(parse_numbers_d_tag("company:plan:x").is_err());
    }

    fn annotate_action(decisions: Vec<ReviewDecisionInput>) -> NumbersAction {
        NumbersAction {
            op: NumbersOp::ReviewAnnotate,
            goal_id: None,
            function: None,
            title: None,
            metric: None,
            target: None,
            period: None,
            reason: None,
            review_date: Some("2026-10-30".into()),
            wins: Some(vec!["Two proposals accepted".into()]),
            misses: Some(vec!["Replies fell from 2 to 1".into()]),
            decisions: Some(decisions),
            expected_head_event_id: Some(EVENT.into()),
            ..propose_action()
        }
    }

    fn input(id: &str) -> ReviewDecisionInput {
        ReviewDecisionInput {
            decision_id: id.into(),
            title: "Hire a Customer Success lead?".into(),
            detail: "Four active clients now.".into(),
            function: Some(CompanyFunction::CustomerSuccess),
        }
    }

    fn fresh_review() -> ReviewHead {
        build_review(&review_due(friday()).unwrap(), &fixture(), friday())
    }

    #[test]
    fn scout_writes_words_and_the_relays_numbers_stay_untouched() {
        let scout = actor(PlanActorRole::ManagedAgent, SCOUT);
        let review = fresh_review();
        let action = annotate_action(vec![input("hire-cs")]);
        validate_numbers_action(&action).unwrap();
        let written = apply_review_annotate(&review, &action, &scout, &context(true)).unwrap();
        assert_eq!(written.functions, review.functions, "numbers never change");
        assert_eq!(written.wins, vec!["Two proposals accepted".to_owned()]);
        assert_eq!(written.decisions.len(), 1);
        assert_eq!(written.decisions[0].state, DecisionState::Open);
        assert_eq!(written.annotated_by_pubkey.as_deref(), Some(SCOUT));
        // Scout may rewrite the words while nothing is answered.
        let again = apply_review_annotate(
            &written,
            &annotate_action(vec![input("other")]),
            &scout,
            &context(true),
        )
        .unwrap();
        assert_eq!(again.decisions[0].decision_id, "other");
        // A plain member cannot write a review.
        let member = actor(
            PlanActorRole::Member,
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        );
        assert_eq!(
            apply_review_annotate(&review, &action, &member, &context(true))
                .expect_err("member")
                .kind,
            PlanErrorKind::Forbidden
        );
    }

    #[test]
    fn only_the_owner_answers_a_decision_and_only_once() {
        let scout = actor(PlanActorRole::ManagedAgent, SCOUT);
        let owner = actor(PlanActorRole::Admin, OWNER);
        let review = apply_review_annotate(
            &fresh_review(),
            &annotate_action(vec![input("hire-cs")]),
            &scout,
            &context(true),
        )
        .unwrap();
        let answer = NumbersAction {
            op: NumbersOp::ReviewDecide,
            wins: None,
            misses: None,
            decisions: None,
            goal_id: None,
            decision_id: Some("hire-cs".into()),
            choice: Some(DecisionState::Approved),
            note: Some("Go ahead".into()),
            ..annotate_action(Vec::new())
        };
        validate_numbers_action(&answer).unwrap();
        assert_eq!(
            apply_review_decide(&review, &answer, &scout, &context(true))
                .expect_err("agent")
                .kind,
            PlanErrorKind::Forbidden
        );
        let decided = apply_review_decide(&review, &answer, &owner, &context(true)).unwrap();
        assert_eq!(decided.decisions[0].state, DecisionState::Approved);
        assert_eq!(
            decided.decisions[0].decided_by_pubkey.as_deref(),
            Some(OWNER)
        );
        assert_eq!(decided.decisions[0].note.as_deref(), Some("Go ahead"));
        assert_eq!(
            apply_review_decide(&decided, &answer, &owner, &context(true))
                .expect_err("twice")
                .kind,
            PlanErrorKind::Conflict
        );
        // Once answered, the words are final.
        assert_eq!(
            apply_review_annotate(
                &decided,
                &annotate_action(vec![input("x")]),
                &scout,
                &context(true)
            )
            .expect_err("final")
            .kind,
            PlanErrorKind::Conflict
        );
        // An unknown decision is a conflict, not a crash.
        let unknown = NumbersAction {
            decision_id: Some("nope".into()),
            ..answer
        };
        assert_eq!(
            apply_review_decide(&review, &unknown, &owner, &context(true))
                .expect_err("unknown")
                .kind,
            PlanErrorKind::Conflict
        );
    }

    #[test]
    fn review_words_are_bounded() {
        let mut too_many = annotate_action(Vec::new());
        too_many.wins = Some(vec!["win".into(); 6]);
        assert!(validate_numbers_action(&too_many).is_err());
        let mut duplicated = annotate_action(vec![input("same"), input("same")]);
        duplicated.wins = None;
        assert!(validate_numbers_action(&duplicated).is_err());
        let mut long = annotate_action(Vec::new());
        long.misses = Some(vec!["x".repeat(MAX_REVIEW_LINE_CHARS + 1)]);
        assert!(validate_numbers_action(&long).is_err());
        let mut open_choice = annotate_action(Vec::new());
        open_choice.op = NumbersOp::ReviewDecide;
        open_choice.wins = None;
        open_choice.misses = None;
        open_choice.decisions = None;
        open_choice.decision_id = Some("a".into());
        open_choice.choice = Some(DecisionState::Open);
        assert!(
            validate_numbers_action(&open_choice).is_err(),
            "open is not an answer"
        );
    }

    #[test]
    fn heads_carry_no_em_dash_in_labels() {
        for metric in Metric::ALL {
            assert!(!metric.label().contains('\u{2014}'));
        }
    }
}
