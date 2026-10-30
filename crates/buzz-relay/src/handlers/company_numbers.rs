//! Broker for co-founder numbers (kind 47068, head kind 30678).
//!
//! One relay-signed head kind carries three record families told apart by
//! d-tag: the live scorecard, the goal of a function and the weekly review. The
//! relay resolves who the caller is and whether co-founder mode is on, then
//! hands both to `buzz_core::company_numbers`, which owns every rule. **No
//! number is ever taken from a caller**: a scorecard and a review get their
//! figures from `crate::numbers_inputs`, which reads the company's own records.
//!
//! The Friday review is written by the relay itself ([`ensure_weekly_review`],
//! called from the wake sweep); an agent only adds words to it afterwards.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::company_numbers::{
    apply_goal_action, apply_review_annotate, apply_review_decide, build_review, compute_scorecard,
    parse_numbers_d_tag, review_d_tag, review_due, validate_goal_head, validate_numbers_action,
    validate_review_head, validate_scorecard_head, GoalHead, NumbersOp, NumbersRecord, ReviewHead,
    ReviewWindow, ScorecardHead, MAX_OPEN_GOALS,
};
use buzz_core::company_plans::{PlanActor, PlanActorRole, PlanContext, PlanError, PlanErrorKind};
use buzz_core::kind::{KIND_NUMBERS_ACTION, KIND_NUMBERS_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
    is_admin, relay_head_event,
};
use super::company_initiative::{
    cofounder_settings, commit_head, load_head, lock_current_head, HeadWrite,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// A scorecard younger than this is not recomputed.
const SCORECARD_FRESH_SECS: i64 = 60;
/// Most numbers heads one read returns.
const MAX_NUMBERS_HEADS: i64 = 1_000;

/// Handles a numbers write (kind 47068).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_NUMBERS_ACTION {
        return Err(invalid("numbers action has the wrong event kind"));
    }
    let action = serde_json::from_str::<buzz_core::company_numbers::NumbersAction>(&event.content)
        .map_err(|error| invalid(format!("numbers action: {error}")))?;
    validate_numbers_action(&action)
        .map_err(|error| invalid(format!("numbers action: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("numbers action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write numbers",
        ));
    }
    let d_tag = command_d_tag(&event, "numbers")?;
    let expected_d_tag = action
        .d_tag()
        .map_err(|error| invalid(format!("numbers action: {error}")))?;
    if d_tag != expected_d_tag {
        return Err(invalid("numbers command d tag must match its record"));
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let actor_managed = is_managed_agent(state, community_id, &auth.pubkey().to_bytes()).await?;

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community_id)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    if role.is_none() && !actor_managed {
        return Err(forbidden("actor is not a member or managed employee"));
    }
    // A managed agent never counts as an owner or admin, whatever its role row says.
    let actor_role = if actor_managed {
        PlanActorRole::ManagedAgent
    } else if role.as_deref().is_some_and(is_admin) {
        PlanActorRole::Admin
    } else {
        PlanActorRole::Member
    };

    let command_id = event.id.to_bytes();
    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id.as_uuid())
    .bind(command_id.as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if already_stored {
        return Ok(duplicate_result(&event));
    }

    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community_id,
        KIND_NUMBERS_HEAD,
        &d_tag,
        &format!("company-numbers:{d_tag}"),
    )
    .await?;
    let actor = PlanActor {
        pubkey: actor_pubkey.clone(),
        role: actor_role,
        led_functions: Vec::new(),
    };
    let now = Utc::now().timestamp();
    let context = PlanContext {
        now,
        cofounder_enabled: cofounder_settings(state, community_id).await?.enabled,
        action_event_id: event.id.to_hex(),
    };

    let (head_json, label) = match action.op {
        NumbersOp::GoalPropose
        | NumbersOp::GoalEdit
        | NumbersOp::GoalApprove
        | NumbersOp::GoalReject
        | NumbersOp::GoalRetire => {
            if current_stored.is_some() || action.expected_head_event_id.is_some() {
                check_expected_head(
                    "goal",
                    action.expected_head_event_id.as_deref(),
                    current_head_id.as_deref(),
                )?;
            }
            let current = current_stored.as_ref().map(parse_goal_head).transpose()?;
            if action.op == NumbersOp::GoalPropose {
                let open = goal_heads(state, community_id)
                    .await?
                    .iter()
                    .filter(|goal| goal.status.is_open())
                    .count();
                if open >= MAX_OPEN_GOALS {
                    return Err(conflict(
                        "this company already has the most open goals it can keep; retire one first",
                    ));
                }
            }
            let next = apply_goal_action(current.as_ref(), &action, &actor, &context)
                .map_err(map_error)?;
            validate_goal_head(&next).map_err(|error| invalid(format!("goal head: {error}")))?;
            (serde_json::to_string(&next).map_err(internal)?, "goal")
        }
        NumbersOp::ScorecardRefresh => {
            if !context.cofounder_enabled {
                return Err(forbidden(
                    "co-founder mode is off for this company, so the scorecard is not refreshed",
                ));
            }
            if action.expected_head_event_id.is_some() {
                check_expected_head(
                    "scorecard",
                    action.expected_head_event_id.as_deref(),
                    current_head_id.as_deref(),
                )?;
            }
            if let Some(stored) = &current_stored {
                let head = parse_scorecard_head(stored)?;
                if now - head.as_of < SCORECARD_FRESH_SECS {
                    // Fresh enough: nothing to recompute, nothing stored.
                    return Ok(IngestResult {
                        event_id: event.id.to_hex(),
                        accepted: true,
                        message: "scorecard is fresh".into(),
                    });
                }
            }
            let goals = goal_heads(state, community_id).await?;
            let inputs = crate::numbers_inputs::gather_inputs(state, community_id, now, now)
                .await
                .map_err(internal)?;
            let head = compute_scorecard(&inputs, &goals, now);
            validate_scorecard_head(&head)
                .map_err(|error| internal(format!("scorecard head: {error}")))?;
            (serde_json::to_string(&head).map_err(internal)?, "scorecard")
        }
        NumbersOp::ReviewAnnotate | NumbersOp::ReviewDecide => {
            let Some(stored) = current_stored.as_ref() else {
                return Err(conflict("there is no review for that Friday yet"));
            };
            check_expected_head(
                "review",
                action.expected_head_event_id.as_deref(),
                current_head_id.as_deref(),
            )?;
            let current = parse_review_head(stored)?;
            let next = if action.op == NumbersOp::ReviewAnnotate {
                apply_review_annotate(&current, &action, &actor, &context)
            } else {
                apply_review_decide(&current, &action, &actor, &context)
            }
            .map_err(map_error)?;
            validate_review_head(&next)
                .map_err(|error| invalid(format!("review head: {error}")))?;
            (serde_json::to_string(&next).map_err(internal)?, "review")
        }
    };

    let result = commit_head(
        tenant,
        state,
        tx,
        &event,
        &actor_pubkey,
        HeadWrite {
            head_kind: KIND_NUMBERS_HEAD,
            action_kind: KIND_NUMBERS_ACTION,
            d_tag: &d_tag,
            head_json,
            current_head_id,
            current_stored,
            label,
        },
    )
    .await?;

    if matches!(action.op, NumbersOp::GoalApprove | NumbersOp::ReviewDecide) {
        // Scout carries on with the approved goal or the answered decision.
        crate::cofounder_wake::enqueue(
            state,
            community_id,
            crate::cofounder_wake::WakeReason::ApprovalGiven,
            &format!("numbers-approval:{}", event.id.to_hex()),
            "",
        )
        .await;
    }
    Ok(result)
}

fn map_error(error: PlanError) -> IngestError {
    match error.kind {
        PlanErrorKind::Invalid => invalid(error.message),
        PlanErrorKind::Forbidden => forbidden(error.message),
        PlanErrorKind::Conflict => conflict(error.message),
    }
}

async fn is_managed_agent(
    state: &AppState,
    community_id: CommunityId,
    pubkey: &[u8; 32],
) -> Result<bool, IngestError> {
    Ok(state
        .db
        .get_agent_channel_policy(community_id, pubkey)
        .await
        .map_err(internal)?
        .is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()))
}

fn parse_goal_head(stored: &StoredEvent) -> Result<GoalHead, IngestError> {
    let head = serde_json::from_str::<GoalHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored goal head is invalid: {error}")))?;
    validate_goal_head(&head).map_err(|error| internal(format!("stored goal head: {error}")))?;
    Ok(head)
}

fn parse_review_head(stored: &StoredEvent) -> Result<ReviewHead, IngestError> {
    let head = serde_json::from_str::<ReviewHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored review head is invalid: {error}")))?;
    validate_review_head(&head)
        .map_err(|error| internal(format!("stored review head: {error}")))?;
    Ok(head)
}

fn parse_scorecard_head(stored: &StoredEvent) -> Result<ScorecardHead, IngestError> {
    let head = serde_json::from_str::<ScorecardHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored scorecard head is invalid: {error}")))?;
    validate_scorecard_head(&head)
        .map_err(|error| internal(format!("stored scorecard head: {error}")))?;
    Ok(head)
}

fn d_tag_of(event: &Event) -> Option<String> {
    event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content())
        .map(str::to_owned)
}

/// Every goal head of the company. A head that does not parse is skipped.
async fn goal_heads(
    state: &AppState,
    community_id: CommunityId,
) -> Result<Vec<GoalHead>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_NUMBERS_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(MAX_NUMBERS_HEADS);
    query.max_limit = Some(MAX_NUMBERS_HEADS);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    Ok(rows
        .iter()
        .filter(|stored| {
            d_tag_of(&stored.event)
                .and_then(|d_tag| parse_numbers_d_tag(&d_tag).ok())
                .is_some_and(|record| matches!(record, NumbersRecord::Goal(_)))
        })
        .filter_map(|stored| serde_json::from_str::<GoalHead>(&stored.event.content).ok())
        .collect())
}

/// Write the Friday review if one is due and not written yet: the relay's own
/// numbers for the week that ended at the Friday cut, and no words yet.
/// Returns the window when this call wrote it, `None` when nothing was due or
/// the review already exists.
pub(crate) async fn ensure_weekly_review(
    state: &Arc<AppState>,
    community_id: CommunityId,
    now: i64,
) -> Result<Option<ReviewWindow>, String> {
    let Some(window) = review_due(now) else {
        return Ok(None);
    };
    let d_tag = review_d_tag(&window.review_date).map_err(|error| error.to_string())?;
    if load_head(state, community_id, KIND_NUMBERS_HEAD, &d_tag)
        .await
        .map_err(|error| format!("could not read the review: {error:?}"))?
        .is_some()
    {
        return Ok(None);
    }
    let inputs =
        crate::numbers_inputs::gather_inputs(state, community_id, window.as_of, now).await?;
    let review = build_review(&window, &inputs, now);
    validate_review_head(&review).map_err(|error| error.to_string())?;
    let head_json = serde_json::to_string(&review).map_err(|error| error.to_string())?;

    let host = state
        .db
        .lookup_community_host(community_id)
        .await
        .map_err(|error| format!("community host lookup failed: {error}"))?
        .ok_or_else(|| "community no longer exists".to_string())?;
    let tenant = TenantContext::resolved(community_id, host);
    let failed = |error: IngestError| format!("could not write the review: {error:?}");

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(|error| failed(internal(error)))?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community_id)
        .await
        .map_err(|error| format!("community writes are fenced: {error}"))?;
    let (_, current) = lock_current_head(
        state,
        &mut tx,
        community_id,
        KIND_NUMBERS_HEAD,
        &d_tag,
        &format!("company-numbers:{d_tag}"),
    )
    .await
    .map_err(failed)?;
    if current.is_some() {
        // Another relay instance wrote it while this one was reading.
        return Ok(None);
    }
    let head_event =
        relay_head_event(state, KIND_NUMBERS_HEAD, &d_tag, head_json, None).map_err(failed)?;
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &head_event,
            &d_tag,
            None,
            ParameterizedReplacePrecondition::CreateOnly,
        )
        .await
        .map_err(|error| failed(internal(error)))?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Ok(None);
    }
    tx.commit().await.map_err(|error| failed(internal(error)))?;
    super::event::dispatch_persistent_event(
        &tenant,
        state,
        &replaced.event,
        KIND_NUMBERS_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(Some(window))
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use buzz_core::company_functions::CompanyFunction;
        use buzz_core::company_numbers::{
            DecisionState, GoalPeriod, GoalStatus, Metric, NumbersAction, ReviewDecisionInput,
            SCORECARD_D_TAG,
        };
        use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
        use chrono::TimeZone;

        use super::super::super::company_initiative::test_support::{
            add_agent, add_member, auth, enable_cofounder, fixture, rejection, Fixture,
        };
        use super::super::*;

        const GOAL_ID: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

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

        fn propose() -> NumbersAction {
            NumbersAction {
                goal_id: Some(GOAL_ID.into()),
                function: Some(CompanyFunction::Sales),
                title: Some("5 new clients a month".into()),
                metric: Some(Metric::Won),
                target: Some(5),
                period: Some(GoalPeriod::Month),
                ..base(NumbersOp::GoalPropose)
            }
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &NumbersAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_numbers::build_numbers_action(action)
                .expect("build numbers action")
                .sign_with_keys(keys)
                .expect("sign numbers action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn head_of(fixture: &Fixture, d_tag: &str) -> Option<StoredEvent> {
            load_head(
                &fixture.state,
                fixture.tenant.community(),
                KIND_NUMBERS_HEAD,
                d_tag,
            )
            .await
            .expect("query numbers head")
        }

        async fn company_with_scout() -> (Fixture, nostr::Keys, nostr::Keys) {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let scout = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_agent(&fixture, &owner, &scout).await;
            enable_cofounder(&fixture, &owner).await;
            (fixture, owner, scout)
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_proposes_a_goal_and_only_the_owner_approves_it() {
            let (fixture, owner, scout) = company_with_scout().await;
            send(&fixture, &scout, &propose())
                .await
                .expect("Scout proposes the goal");
            let d_tag = format!("company:fngoal:{GOAL_ID}");
            let stored = head_of(&fixture, &d_tag).await.expect("goal head");
            assert_eq!(
                stored.event.pubkey,
                fixture.state.relay_keypair.public_key()
            );
            assert!(stored.channel_id.is_none());
            let goal: GoalHead = serde_json::from_str(&stored.event.content).unwrap();
            assert_eq!(goal.status, GoalStatus::Proposed);

            let approve = NumbersAction {
                goal_id: Some(GOAL_ID.into()),
                expected_head_event_id: Some(stored.event.id.to_hex()),
                ..base(NumbersOp::GoalApprove)
            };
            let message = rejection(send(&fixture, &scout, &approve).await);
            assert!(message.contains("only an owner or admin"), "{message}");
            assert_eq!(
                head_of(&fixture, &d_tag).await.unwrap().event.id,
                stored.event.id,
                "a refused approval leaves the head alone"
            );

            send(&fixture, &owner, &approve)
                .await
                .expect("the owner approves");
            let goal: GoalHead =
                serde_json::from_str(&head_of(&fixture, &d_tag).await.unwrap().event.content)
                    .unwrap();
            assert_eq!(goal.status, GoalStatus::Approved);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn goal_edit_replaces_the_proposed_head_once_and_fences_stale_edits() {
            let (fixture, owner, scout) = company_with_scout().await;
            send(&fixture, &scout, &propose())
                .await
                .expect("Scout proposes the goal");
            let d_tag = format!("company:fngoal:{GOAL_ID}");
            let before = head_of(&fixture, &d_tag).await.expect("goal head");
            let edit = NumbersAction {
                op: NumbersOp::GoalEdit,
                goal_id: Some(GOAL_ID.into()),
                title: Some("8 new clients a month".into()),
                metric: Some(Metric::Won),
                target: Some(8),
                period: Some(GoalPeriod::Month),
                expected_head_event_id: Some(before.event.id.to_hex()),
                ..base(NumbersOp::GoalEdit)
            };

            send(&fixture, &owner, &edit)
                .await
                .expect("owner edits the proposed goal");
            let after = head_of(&fixture, &d_tag).await.expect("edited goal head");
            assert_ne!(after.event.id, before.event.id);
            let goal: GoalHead = serde_json::from_str(&after.event.content).unwrap();
            assert_eq!(goal.status, GoalStatus::Proposed);
            assert_eq!(goal.title, "8 new clients a month");
            assert_eq!(goal.target, 8);
            assert_eq!(goal.proposed_by_pubkey, scout.public_key().to_hex());

            let stale = rejection(send(&fixture, &owner, &edit).await);
            assert!(stale.contains("does not match the latest"), "{stale}");
            assert_eq!(
                head_of(&fixture, &d_tag).await.unwrap().event.id,
                after.event.id,
                "a stale edit leaves the latest goal untouched"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn goals_stop_while_co_founder_mode_is_off() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let scout = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_agent(&fixture, &owner, &scout).await;
            let message = rejection(send(&fixture, &scout, &propose()).await);
            assert!(message.contains("co-founder mode is off"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_refresh_writes_one_scorecard_and_a_second_one_is_throttled() {
            let (fixture, _owner, scout) = company_with_scout().await;
            send(&fixture, &scout, &base(NumbersOp::ScorecardRefresh))
                .await
                .expect("first refresh");
            let first = head_of(&fixture, SCORECARD_D_TAG).await.expect("scorecard");
            let head: ScorecardHead = serde_json::from_str(&first.event.content).unwrap();
            assert_eq!(head.functions.len(), 5);
            assert_eq!(head.currency, "ZAR");

            // The same action signed in the same second has the same event id and
            // reads as a duplicate, so let the clock move on before the retry.
            tokio::time::sleep(std::time::Duration::from_millis(1_100)).await;
            let again = send(&fixture, &scout, &base(NumbersOp::ScorecardRefresh))
                .await
                .expect("second refresh");
            assert_eq!(again.message, "scorecard is fresh");
            assert_eq!(
                head_of(&fixture, SCORECARD_D_TAG).await.unwrap().event.id,
                first.event.id
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_friday_review_is_written_once_and_scout_adds_words_the_owner_answers() {
            let (fixture, owner, scout) = company_with_scout().await;
            let community = fixture.tenant.community();
            let friday_cut = chrono::Utc
                .with_ymd_and_hms(2026, 10, 30, 15, 0, 0)
                .unwrap()
                .timestamp();

            // A quiet Wednesday writes nothing.
            let wednesday = chrono::Utc
                .with_ymd_and_hms(2026, 11, 4, 9, 0, 0)
                .unwrap()
                .timestamp();
            assert!(ensure_weekly_review(&fixture.state, community, wednesday)
                .await
                .unwrap()
                .is_none());

            let window = ensure_weekly_review(&fixture.state, community, friday_cut)
                .await
                .unwrap()
                .expect("the Friday review is written");
            assert_eq!(window.review_date, "2026-10-30");
            assert!(
                ensure_weekly_review(&fixture.state, community, friday_cut + 600)
                    .await
                    .unwrap()
                    .is_none(),
                "a second pass writes nothing"
            );

            let d_tag = review_d_tag("2026-10-30").unwrap();
            let stored = head_of(&fixture, &d_tag).await.expect("review head");
            let review: ReviewHead = serde_json::from_str(&stored.event.content).unwrap();
            assert_eq!(review.functions.len(), 5);

            let annotate = NumbersAction {
                review_date: Some("2026-10-30".into()),
                wins: Some(vec!["Quiet week, nothing lost".into()]),
                misses: Some(Vec::new()),
                decisions: Some(vec![ReviewDecisionInput {
                    decision_id: "hire-cs".into(),
                    title: "Hire a Customer Success lead?".into(),
                    detail: String::new(),
                    function: Some(CompanyFunction::CustomerSuccess),
                }]),
                expected_head_event_id: Some(stored.event.id.to_hex()),
                ..base(NumbersOp::ReviewAnnotate)
            };
            send(&fixture, &scout, &annotate)
                .await
                .expect("Scout writes the words");
            let annotated = head_of(&fixture, &d_tag).await.unwrap();
            let after: ReviewHead = serde_json::from_str(&annotated.event.content).unwrap();
            assert_eq!(after.functions, review.functions, "numbers never change");
            assert_eq!(after.decisions.len(), 1);

            let answer = NumbersAction {
                review_date: Some("2026-10-30".into()),
                decision_id: Some("hire-cs".into()),
                choice: Some(DecisionState::Approved),
                expected_head_event_id: Some(annotated.event.id.to_hex()),
                ..base(NumbersOp::ReviewDecide)
            };
            let message = rejection(send(&fixture, &scout, &answer).await);
            assert!(message.contains("only an owner or admin"), "{message}");
            send(&fixture, &owner, &answer)
                .await
                .expect("the owner answers");
            let decided: ReviewHead =
                serde_json::from_str(&head_of(&fixture, &d_tag).await.unwrap().event.content)
                    .unwrap();
            assert_eq!(decided.decisions[0].state, DecisionState::Approved);
        }
    }
}
