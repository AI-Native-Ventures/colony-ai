//! Who leads co-founder work, and whether the relay can reach them.
//!
//! The wake worker needs Scout's key. Onboarding records it once Scout has
//! started, but onboarding only starts after the first wake, and no business
//! created before position heads existed has a position head. So the lead is
//! found in this order, and the first rule that answers wins:
//!
//! 1. the lead the onboarding head recorded;
//! 2. the one active "Chief of Staff" on the team (relay-signed position head);
//! 3. the company's managed agents (an agent owned by an owner or admin):
//!    the one named Scout, else the only managed agent there is.
//!
//! Two candidates at the same rule is never guessed between: nobody is woken
//! and the business is told so through the lead status record (kind 30680).
//! That record is relay-signed and only changes when the state changes, so a
//! failing wake leaves something the owner can see instead of a silent skip.

use std::sync::Arc;

use chrono::Utc;

use buzz_core::company_cofounder::{
    validate_lead_status_head, LeadProblem, LeadState, LeadStatusHead, COFOUNDER_LEAD_D_TAG,
};
use buzz_core::company_members::{MemberKind, MemberPositionHead, MemberStatus};
use buzz_core::company_onboarding::{OnboardingHead, ONBOARDING_D_TAG};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::{KIND_COFOUNDER_LEAD_HEAD, KIND_MEMBER_POSITION_HEAD, KIND_ONBOARDING_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{internal, relay_head_event};
use super::company_initiative::{load_head, lock_current_head};
use crate::state::AppState;

/// The answer to "who leads co-founder work here".
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Lead {
    /// Exactly one lead, as a hex public key.
    Found(String),
    /// Nobody the relay can identify.
    Missing,
    /// More than one candidate; nobody is woken.
    Several,
}

impl Lead {
    /// The lead status problem this answer is, when it is not a lead.
    pub(crate) fn problem(&self) -> Option<LeadProblem> {
        match self {
            Lead::Found(_) => None,
            Lead::Missing => Some(LeadProblem::NoScout),
            Lead::Several => Some(LeadProblem::SeveralScouts),
        }
    }
}

/// One short plain sentence for the owner for each problem.
pub(crate) fn problem_detail(problem: LeadProblem) -> &'static str {
    match problem {
        LeadProblem::NoScout => "Colony could not find Scout in this business.",
        LeadProblem::SeveralScouts => {
            "This business has more than one possible Scout, so Colony woke none of them."
        }
        LeadProblem::DeliveryFailed => "Colony could not deliver the message to Scout.",
    }
}

/// Finds the lead. See the module docs for the order.
pub(crate) async fn find_lead(
    state: &Arc<AppState>,
    community_id: CommunityId,
) -> Result<Lead, String> {
    let onboarding = load_head(state, community_id, KIND_ONBOARDING_HEAD, ONBOARDING_D_TAG)
        .await
        .map_err(|error| format!("could not read onboarding: {error:?}"))?;
    if let Some(stored) = onboarding {
        let head = serde_json::from_str::<OnboardingHead>(&stored.event.content)
            .map_err(|error| format!("stored onboarding head is invalid: {error}"))?;
        return Ok(Lead::Found(head.lead_pubkey));
    }

    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(500);
    let rows = state
        .db
        .query_events_for_maintenance(&query)
        .await
        .map_err(|error| format!("could not read member positions: {error}"))?;
    let mut chiefs = rows
        .iter()
        .filter_map(|stored| serde_json::from_str::<MemberPositionHead>(&stored.event.content).ok())
        .filter(|head| {
            head.kind == MemberKind::Employee
                && head.status == MemberStatus::Active
                && head.title.trim().eq_ignore_ascii_case("chief of staff")
        })
        .map(|head| head.pubkey);
    if let Some(first) = chiefs.next() {
        return Ok(if chiefs.next().is_some() {
            Lead::Several
        } else {
            Lead::Found(first)
        });
    }

    let agents = state
        .db
        .list_admin_managed_agents(community_id)
        .await
        .map_err(|error| format!("could not read the company's agents: {error}"))?;
    Ok(pick_from_agents(&agents))
}

/// Rule 3: the one agent named Scout, else the only managed agent.
pub(crate) fn pick_from_agents(agents: &[buzz_db::user::ManagedAgentCandidate]) -> Lead {
    let scouts = agents
        .iter()
        .filter(|agent| {
            agent
                .display_name
                .as_deref()
                .is_some_and(|name| name.trim().eq_ignore_ascii_case("scout"))
        })
        .collect::<Vec<_>>();
    let chosen = match (scouts.as_slice(), agents) {
        ([one], _) => Some(*one),
        ([], [only]) => Some(only),
        ([], []) => return Lead::Missing,
        _ => return Lead::Several,
    };
    chosen.map_or(Lead::Missing, |agent| {
        Lead::Found(hex::encode(&agent.pubkey))
    })
}

/// What to record about the lead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeadUpdate {
    /// A wake reached Scout.
    Reached,
    /// Wakes keep failing for this reason after this many attempts.
    Unreachable { problem: LeadProblem, attempts: u32 },
}

/// The current lead status, if one was ever recorded.
pub(crate) async fn current_status(
    state: &Arc<AppState>,
    community_id: CommunityId,
) -> Result<Option<LeadStatusHead>, String> {
    let stored = load_head(
        state,
        community_id,
        KIND_COFOUNDER_LEAD_HEAD,
        COFOUNDER_LEAD_D_TAG,
    )
    .await
    .map_err(|error| format!("could not read the lead status: {error:?}"))?;
    stored
        .map(|stored| {
            serde_json::from_str::<LeadStatusHead>(&stored.event.content)
                .map_err(|error| format!("stored lead status is invalid: {error}"))
        })
        .transpose()
}

/// Records the update unless the record already says the same. Returns whether
/// a new head was written. A write that loses a race returns an error so the
/// caller's retry record stays in force.
pub(crate) async fn record_status(
    state: &Arc<AppState>,
    community_id: CommunityId,
    update: LeadUpdate,
) -> Result<bool, String> {
    let failed = |what: &str, error: String| format!("could not {what}: {error}");
    let host = state
        .db
        .lookup_community_host(community_id)
        .await
        .map_err(|error| failed("look up the community", error.to_string()))?
        .ok_or_else(|| "community no longer exists".to_string())?;
    let tenant = TenantContext::resolved(community_id, host);
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(|error| failed("begin the lead status write", error.to_string()))?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community_id)
        .await
        .map_err(|error| format!("community writes are fenced: {error}"))?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community_id,
        KIND_COFOUNDER_LEAD_HEAD,
        COFOUNDER_LEAD_D_TAG,
        "company-cofounder-lead",
    )
    .await
    .map_err(|error| failed("lock the lead status", format!("{error:?}")))?;
    let previous = current_stored
        .as_ref()
        .map(|stored| serde_json::from_str::<LeadStatusHead>(&stored.event.content))
        .transpose()
        .map_err(|error| format!("stored lead status is invalid: {error}"))?;

    let now = Utc::now().timestamp();
    let Some(head) = next_status(previous.as_ref(), update, now) else {
        // Nothing to change. End the transaction so its lock goes now.
        tx.rollback()
            .await
            .map_err(|error| failed("release the lead status lock", error.to_string()))?;
        return Ok(false);
    };
    validate_lead_status_head(&head).map_err(|error| format!("lead status: {error}"))?;
    let head_json = serde_json::to_string(&head).map_err(|error| error.to_string())?;
    let head_event = relay_head_event(
        state,
        KIND_COFOUNDER_LEAD_HEAD,
        COFOUNDER_LEAD_D_TAG,
        head_json,
        current_stored.as_ref(),
    )
    .map_err(|error| format!("{error:?}"))?;
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &head_event,
            COFOUNDER_LEAD_D_TAG,
            None,
            precondition,
        )
        .await
        .map_err(|error| format!("{:?}", internal(error)))?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err("the lead status changed while it was being written".to_string());
    }
    tx.commit()
        .await
        .map_err(|error| failed("commit the lead status", error.to_string()))?;
    super::event::dispatch_persistent_event(
        &tenant,
        state,
        &replaced.event,
        KIND_COFOUNDER_LEAD_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(true)
}

/// The head to write for this update, or `None` when the record already says it.
pub(crate) fn next_status(
    previous: Option<&LeadStatusHead>,
    update: LeadUpdate,
    now: i64,
) -> Option<LeadStatusHead> {
    match update {
        // Nothing was ever wrong, or it is already taken back: no record to write.
        LeadUpdate::Reached => previous
            .filter(|previous| previous.state == LeadState::Unreachable)
            .map(|_| LeadStatusHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                state: LeadState::Reached,
                problem: None,
                detail: String::new(),
                attempts: 0,
                since: now,
                updated_at: now,
            }),
        LeadUpdate::Unreachable { problem, attempts } => {
            let detail = problem_detail(problem);
            if previous.is_some_and(|previous| {
                previous.state == LeadState::Unreachable
                    && previous.problem == Some(problem)
                    && previous.detail == detail
            }) {
                // Already recorded. The attempt count is not worth a rewrite.
                return None;
            }
            Some(LeadStatusHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                state: LeadState::Unreachable,
                problem: Some(problem),
                detail: detail.to_owned(),
                attempts,
                since: previous
                    .filter(|previous| previous.state == LeadState::Unreachable)
                    .map_or(now, |previous| previous.since),
                updated_at: now,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use buzz_db::user::ManagedAgentCandidate;

    use super::*;

    fn agent(byte: u8, name: Option<&str>) -> ManagedAgentCandidate {
        ManagedAgentCandidate {
            pubkey: vec![byte; 32],
            display_name: name.map(str::to_owned),
        }
    }

    fn hex_of(byte: u8) -> String {
        hex::encode([byte; 32])
    }

    #[test]
    fn no_agents_means_no_lead() {
        assert_eq!(pick_from_agents(&[]), Lead::Missing);
    }

    #[test]
    fn the_one_agent_named_scout_leads_whatever_else_is_there() {
        let agents = [
            agent(1, Some("Maya")),
            agent(2, Some(" scout ")),
            agent(3, None),
        ];
        assert_eq!(pick_from_agents(&agents), Lead::Found(hex_of(2)));
    }

    #[test]
    fn two_scouts_are_never_guessed_between() {
        let agents = [agent(1, Some("Scout")), agent(2, Some("SCOUT"))];
        assert_eq!(pick_from_agents(&agents), Lead::Several);
    }

    #[test]
    fn the_only_agent_leads_even_if_renamed() {
        assert_eq!(
            pick_from_agents(&[agent(7, Some("Maya"))]),
            Lead::Found(hex_of(7))
        );
        assert_eq!(pick_from_agents(&[agent(7, None)]), Lead::Found(hex_of(7)));
    }

    #[test]
    fn several_agents_and_none_called_scout_is_ambiguous() {
        let agents = [agent(1, Some("Maya")), agent(2, Some("Lerato"))];
        assert_eq!(pick_from_agents(&agents), Lead::Several);
    }

    #[test]
    fn a_lead_answer_maps_to_its_problem() {
        assert_eq!(Lead::Found("a".into()).problem(), None);
        assert_eq!(Lead::Missing.problem(), Some(LeadProblem::NoScout));
        assert_eq!(Lead::Several.problem(), Some(LeadProblem::SeveralScouts));
    }

    fn unreachable_update(problem: LeadProblem, attempts: u32) -> LeadUpdate {
        LeadUpdate::Unreachable { problem, attempts }
    }

    #[test]
    fn reached_writes_nothing_unless_something_was_wrong() {
        assert_eq!(next_status(None, LeadUpdate::Reached, 10), None);
        let wrong = next_status(None, unreachable_update(LeadProblem::NoScout, 3), 10)
            .expect("unreachable is recorded");
        assert_eq!(wrong.state, LeadState::Unreachable);
        assert_eq!(wrong.problem, Some(LeadProblem::NoScout));
        assert_eq!(wrong.since, 10);
        let fixed = next_status(Some(&wrong), LeadUpdate::Reached, 20).expect("taken back");
        assert_eq!(fixed.state, LeadState::Reached);
        assert_eq!(fixed.problem, None);
        assert_eq!(next_status(Some(&fixed), LeadUpdate::Reached, 30), None);
    }

    #[test]
    fn the_same_problem_is_not_rewritten_but_a_new_one_keeps_the_start_time() {
        let first = next_status(None, unreachable_update(LeadProblem::NoScout, 3), 10).unwrap();
        assert_eq!(
            next_status(
                Some(&first),
                unreachable_update(LeadProblem::NoScout, 4),
                20
            ),
            None
        );
        let changed = next_status(
            Some(&first),
            unreachable_update(LeadProblem::SeveralScouts, 4),
            20,
        )
        .expect("a different problem is recorded");
        assert_eq!(changed.since, 10, "still unreachable since the first time");
        assert_eq!(changed.updated_at, 20);
        for problem in [
            LeadProblem::NoScout,
            LeadProblem::SeveralScouts,
            LeadProblem::DeliveryFailed,
        ] {
            let detail = problem_detail(problem);
            assert!(!detail.contains('\u{2014}'), "no em dash in copy");
            assert!(detail.chars().count() <= buzz_core::company_cofounder::MAX_LEAD_DETAIL_CHARS);
        }
    }
}
