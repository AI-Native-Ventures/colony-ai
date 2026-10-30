//! Broker for co-founder onboarding progress (kind 47065, head kind 30675).
//!
//! Scout (a managed agent) starts onboarding, asks one question at a time and
//! proposes the company map, only while co-founder mode is on. Only an owner or
//! admin answers a question or decides on the map. The relay writes one head,
//! `company:onboarding`, that survives switching co-founder mode off and on.
//!
//! An answer on the money or approvals step is only accepted when it matches the
//! co-founder settings the owner already saved, and an answer on the brief step
//! only when the brief is confirmed. The relay reads those records itself.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::company_brief::BriefHead;
use buzz_core::company_onboarding::{
    next_onboarding_head, validate_onboarding_action, validate_onboarding_d_tag,
    validate_onboarding_head, OnboardingAction, OnboardingContext, OnboardingHead,
};
use buzz_core::kind::{KIND_BRIEF_HEAD, KIND_ONBOARDING_ACTION, KIND_ONBOARDING_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};

use super::company_cofounder::{
    check_expected_head, command_d_tag, duplicate_result, forbidden, internal, invalid, is_admin,
};
use super::company_initiative::{
    cofounder_settings, commit_head, load_head, lock_current_head, HeadWrite,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an onboarding action (kind 47065).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_ONBOARDING_ACTION {
        return Err(invalid("onboarding action has the wrong event kind"));
    }
    let action = serde_json::from_str::<OnboardingAction>(&event.content)
        .map_err(|error| invalid(format!("onboarding action: {error}")))?;
    validate_onboarding_action(&action)
        .map_err(|error| invalid(format!("onboarding action: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("onboarding action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write onboarding",
        ));
    }
    let d_tag = command_d_tag(&event, "onboarding")?;
    validate_onboarding_d_tag(&d_tag)
        .map_err(|error| invalid(format!("onboarding command d tag: {error}")))?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
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
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
    if action.kind.needs_admin() && !actor_is_admin {
        return Err(forbidden(
            "only the owner or an admin can answer onboarding questions or decide on the company map",
        ));
    }
    let settings = cofounder_settings(state, community_id).await?;
    if !action.kind.needs_admin() {
        // Asking, proposing and completing are initiative: they stop when
        // co-founder mode is off, and they belong to Scout or an admin.
        if !actor_is_admin
            && !super::company_member_records::is_registered_employee(
                state,
                community_id,
                &actor_pubkey,
            )
            .await?
        {
            return Err(forbidden(
                "only an agent or an admin can run co-founder onboarding",
            ));
        }
        if !settings.enabled {
            return Err(forbidden("co-founder mode is off for this company"));
        }
    }
    if let Some(lead) = action.lead_pubkey.as_deref() {
        if !super::company_member_records::is_registered_employee(state, community_id, lead).await?
        {
            return Err(forbidden(
                "the lead for co-founder onboarding must be a managed agent of this company",
            ));
        }
    }

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
        KIND_ONBOARDING_HEAD,
        &d_tag,
        "company-onboarding",
    )
    .await?;
    check_expected_head(
        "onboarding",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    )?;
    let current = current_stored
        .as_ref()
        .map(|stored| serde_json::from_str::<OnboardingHead>(&stored.event.content))
        .transpose()
        .map_err(|error| internal(format!("stored onboarding head is invalid: {error}")))?;
    let context = OnboardingContext {
        settings,
        brief_confirmed: brief_is_confirmed(state, community_id).await?,
    };
    let head = next_onboarding_head(
        current.as_ref(),
        &action,
        &actor_pubkey,
        actor_is_admin,
        &context,
        Utc::now().timestamp(),
    )
    .map_err(|error| invalid(format!("onboarding action: {error}")))?;
    validate_onboarding_head(&head)
        .map_err(|error| internal(format!("onboarding head: {error}")))?;

    commit_head(
        tenant,
        state,
        tx,
        &event,
        &actor_pubkey,
        HeadWrite {
            head_kind: KIND_ONBOARDING_HEAD,
            action_kind: KIND_ONBOARDING_ACTION,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&head).map_err(internal)?,
            current_head_id,
            current_stored,
            label: "onboarding",
        },
    )
    .await
}

/// Whether the owner has confirmed a business brief.
async fn brief_is_confirmed(
    state: &AppState,
    community_id: CommunityId,
) -> Result<bool, IngestError> {
    let stored = load_head(
        state,
        community_id,
        KIND_BRIEF_HEAD,
        buzz_core::company_brief::BRIEF_D_TAG,
    )
    .await?;
    match stored {
        None => Ok(false),
        Some(stored) => {
            let head = serde_json::from_str::<BriefHead>(&stored.event.content)
                .map_err(|error| internal(format!("stored brief head is invalid: {error}")))?;
            Ok(head.confirmed.is_some())
        }
    }
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use buzz_core::company_brief::{BriefAction, BriefActionKind, BriefContent};
        use buzz_core::company_cofounder::{ApprovalSwitches, CofounderSettings, MoneyPreference};
        use buzz_core::company_functions::CompanyFunction;
        use buzz_core::company_onboarding::{
            AccountRequest, MapEntry, MapPlacement, MapProposalInput, OnboardingActionKind,
            OnboardingStatus, OnboardingStep, StepState,
        };
        use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
        use buzz_core::StoredEvent;

        use super::super::super::company_initiative::test_support::{
            add_agent, add_member, auth, enable_cofounder, fixture, rejection,
            save_cofounder_settings, Fixture,
        };
        use super::super::*;

        fn blank(kind: OnboardingActionKind) -> OnboardingAction {
            OnboardingAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                kind,
                step: None,
                text: None,
                account: None,
                map: None,
                skipped: false,
                money_preference: None,
                approval_switches: None,
                lead_pubkey: None,
                expected_head_event_id: None,
            }
        }

        fn ask(step: OnboardingStep) -> OnboardingAction {
            let mut action = blank(OnboardingActionKind::Ask);
            action.step = Some(step);
            action.text = Some("A short question".into());
            if step == OnboardingStep::Accounts {
                action.account = Some(AccountRequest {
                    id: "pinterest".into(),
                    label: "Pinterest".into(),
                    url: Some("https://www.pinterest.com/login/".into()),
                });
            }
            action
        }

        fn answer(step: OnboardingStep) -> OnboardingAction {
            let mut action = blank(OnboardingActionKind::Answer);
            action.step = Some(step);
            match step {
                OnboardingStep::Money => {
                    action.money_preference = Some(MoneyPreference::CheapestFirst);
                }
                OnboardingStep::Approvals => {
                    action.approval_switches = Some(ApprovalSwitches::default());
                }
                _ => {}
            }
            action
        }

        async fn current(fixture: &Fixture) -> Option<(StoredEvent, OnboardingHead)> {
            load_head(
                &fixture.state,
                fixture.tenant.community(),
                KIND_ONBOARDING_HEAD,
                buzz_core::company_onboarding::ONBOARDING_D_TAG,
            )
            .await
            .expect("query onboarding head")
            .map(|stored| {
                let head = serde_json::from_str(&stored.event.content).expect("onboarding head");
                (stored, head)
            })
        }

        /// Sends an action against the current head, as a client that read it first.
        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            mut action: OnboardingAction,
        ) -> Result<IngestResult, IngestError> {
            if action.expected_head_event_id.is_none() {
                action.expected_head_event_id = current(fixture)
                    .await
                    .map(|(stored, _)| stored.event.id.to_hex());
            }
            let event = buzz_sdk::company_initiative::build_onboarding_action(&action)
                .expect("build onboarding action")
                .sign_with_keys(keys)
                .expect("sign onboarding action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn confirm_a_brief(fixture: &Fixture, scout: &nostr::Keys, owner: &nostr::Keys) {
            let content = BriefContent {
                what_you_sell: "Websites".into(),
                who_buys: "Guesthouses".into(),
                prices: None,
                how_you_talk: "Friendly".into(),
                sources: vec![],
            };
            let propose = BriefAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                kind: BriefActionKind::Propose,
                content: Some(content),
                expected_head_event_id: None,
            };
            let event = buzz_sdk::company_initiative::build_brief_action(&propose)
                .expect("build brief proposal")
                .sign_with_keys(scout)
                .expect("sign brief proposal");
            super::super::super::company_brief::handle(
                &fixture.tenant,
                &fixture.state,
                event,
                auth(scout),
            )
            .await
            .expect("Scout proposes the brief");
            let head = load_head(
                &fixture.state,
                fixture.tenant.community(),
                KIND_BRIEF_HEAD,
                buzz_core::company_brief::BRIEF_D_TAG,
            )
            .await
            .expect("query brief head")
            .expect("brief head exists");
            let confirm = BriefAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                kind: BriefActionKind::Confirm,
                content: None,
                expected_head_event_id: Some(head.event.id.to_hex()),
            };
            let event = buzz_sdk::company_initiative::build_brief_action(&confirm)
                .expect("build brief confirmation")
                .sign_with_keys(owner)
                .expect("sign brief confirmation");
            super::super::super::company_brief::handle(
                &fixture.tenant,
                &fixture.state,
                event,
                auth(owner),
            )
            .await
            .expect("owner confirms the brief");
        }

        /// An owner, Scout (a managed agent), co-founder mode on, onboarding started.
        async fn started_company() -> (Fixture, nostr::Keys, nostr::Keys) {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let scout = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_agent(&fixture, &owner, &scout).await;
            enable_cofounder(&fixture, &owner).await;
            send(&fixture, &scout, blank(OnboardingActionKind::Start))
                .await
                .expect("Scout starts onboarding");
            (fixture, owner, scout)
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_starts_onboarding_and_leads_it() {
            let (fixture, _owner, scout) = started_company().await;
            let (stored, head) = current(&fixture).await.expect("onboarding head");
            assert_eq!(stored.event.kind.as_u16() as u32, KIND_ONBOARDING_HEAD);
            assert_eq!(
                stored.event.pubkey,
                fixture.state.relay_keypair.public_key()
            );
            assert!(stored.channel_id.is_none());
            assert_eq!(head.lead_pubkey, scout.public_key().to_hex());
            assert_eq!(head.status, OnboardingStatus::InProgress);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_cannot_start_onboarding_while_cofounder_mode_is_off() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let scout = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_agent(&fixture, &owner, &scout).await;
            let message =
                rejection(send(&fixture, &scout, blank(OnboardingActionKind::Start)).await);
            assert!(message.contains("co-founder mode is off"), "{message}");
            assert!(current(&fixture).await.is_none());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_plain_member_cannot_run_onboarding() {
            let (fixture, _owner, _scout) = started_company().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let message = rejection(send(&fixture, &member, ask(OnboardingStep::Brief)).await);
            assert!(
                message.contains("only an agent or an admin can run co-founder onboarding"),
                "{message}"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_cannot_answer_its_own_question() {
            let (fixture, _owner, scout) = started_company().await;
            send(&fixture, &scout, ask(OnboardingStep::Money))
                .await
                .expect("Scout asks about money");
            let message = rejection(send(&fixture, &scout, answer(OnboardingStep::Money)).await);
            assert!(
                message.contains("only the owner or an admin can answer"),
                "{message}"
            );
            let (_, head) = current(&fixture).await.expect("head");
            assert_eq!(head.step_state(OnboardingStep::Money), StepState::Asked);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_brief_answer_needs_a_confirmed_brief() {
            let (fixture, owner, scout) = started_company().await;
            send(&fixture, &scout, ask(OnboardingStep::Brief))
                .await
                .expect("Scout asks about the brief");
            let message = rejection(send(&fixture, &owner, answer(OnboardingStep::Brief)).await);
            assert!(
                message.contains("confirm the business brief first"),
                "{message}"
            );

            confirm_a_brief(&fixture, &scout, &owner).await;
            send(&fixture, &owner, answer(OnboardingStep::Brief))
                .await
                .expect("answer after the brief is confirmed");
            let (_, head) = current(&fixture).await.expect("head");
            assert_eq!(head.step_state(OnboardingStep::Brief), StepState::Done);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_money_answer_must_match_the_saved_setting() {
            let (fixture, owner, scout) = started_company().await;
            send(&fixture, &scout, ask(OnboardingStep::Money))
                .await
                .expect("Scout asks about money");
            let mut best = answer(OnboardingStep::Money);
            best.money_preference = Some(MoneyPreference::BestOption);
            let message = rejection(send(&fixture, &owner, best.clone()).await);
            assert!(message.contains("not saved yet"), "{message}");

            save_cofounder_settings(
                &fixture,
                &owner,
                &CofounderSettings {
                    enabled: true,
                    money_preference: MoneyPreference::BestOption,
                    approval_switches: ApprovalSwitches::default(),
                },
            )
            .await;
            send(&fixture, &owner, best)
                .await
                .expect("answer once the setting is saved");
            let (_, head) = current(&fixture).await.expect("head");
            assert_eq!(head.step_state(OnboardingStep::Money), StepState::Done);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn switching_cofounder_mode_off_and_on_keeps_progress() {
            let (fixture, owner, scout) = started_company().await;
            send(&fixture, &scout, ask(OnboardingStep::Money))
                .await
                .expect("Scout asks about money");
            send(&fixture, &owner, answer(OnboardingStep::Money))
                .await
                .expect("owner answers");

            save_cofounder_settings(&fixture, &owner, &CofounderSettings::default()).await;
            let message = rejection(send(&fixture, &scout, ask(OnboardingStep::Approvals)).await);
            assert!(message.contains("co-founder mode is off"), "{message}");

            enable_cofounder(&fixture, &owner).await;
            send(&fixture, &scout, blank(OnboardingActionKind::Start))
                .await
                .expect("Scout resumes onboarding");
            let (_, head) = current(&fixture).await.expect("head");
            assert_eq!(head.step_state(OnboardingStep::Money), StepState::Done);
            assert_eq!(head.resume_count, 1);
            assert_eq!(head.status, OnboardingStatus::InProgress);
        }

        fn map_input(lead: &nostr::Keys) -> MapProposalInput {
            let entry = |function, placement, lead: Option<String>| MapEntry {
                function,
                placement,
                lead_pubkey: lead,
            };
            MapProposalInput {
                entries: vec![
                    entry(
                        CompanyFunction::Sales,
                        MapPlacement::ExistingAgent,
                        Some(lead.public_key().to_hex()),
                    ),
                    entry(CompanyFunction::Operations, MapPlacement::Scout, None),
                    entry(CompanyFunction::CustomerSuccess, MapPlacement::Empty, None),
                    entry(CompanyFunction::Finance, MapPlacement::Empty, None),
                    entry(CompanyFunction::Brand, MapPlacement::Empty, None),
                ],
                first_function: CompanyFunction::Sales,
            }
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn onboarding_runs_from_start_to_an_approved_map() {
            let (fixture, owner, scout) = started_company().await;
            confirm_a_brief(&fixture, &scout, &owner).await;
            for step in [
                OnboardingStep::Brief,
                OnboardingStep::Money,
                OnboardingStep::Approvals,
            ] {
                send(&fixture, &scout, ask(step)).await.expect("ask");
                send(&fixture, &owner, answer(step)).await.expect("answer");
            }
            let mut propose = blank(OnboardingActionKind::ProposeMap);
            propose.map = Some(map_input(&scout));
            send(&fixture, &scout, propose).await.expect("propose map");
            send(&fixture, &owner, blank(OnboardingActionKind::ApproveMap))
                .await
                .expect("approve map");
            send(&fixture, &scout, blank(OnboardingActionKind::Complete))
                .await
                .expect("complete");

            let (_, head) = current(&fixture).await.expect("head");
            assert_eq!(head.status, OnboardingStatus::Complete);
            assert!(head.map.as_ref().is_some_and(|map| map.approved));
            assert!(head.completed_at.is_some());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_cannot_approve_the_map() {
            let (fixture, owner, scout) = started_company().await;
            confirm_a_brief(&fixture, &scout, &owner).await;
            for step in [
                OnboardingStep::Brief,
                OnboardingStep::Money,
                OnboardingStep::Approvals,
            ] {
                send(&fixture, &scout, ask(step)).await.expect("ask");
                send(&fixture, &owner, answer(step)).await.expect("answer");
            }
            let mut propose = blank(OnboardingActionKind::ProposeMap);
            propose.map = Some(map_input(&scout));
            send(&fixture, &scout, propose).await.expect("propose map");
            let message =
                rejection(send(&fixture, &scout, blank(OnboardingActionKind::ApproveMap)).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            let (_, head) = current(&fixture).await.expect("head");
            assert!(head.map.as_ref().is_some_and(|map| !map.approved));
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_lead_must_be_a_managed_agent() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let stranger = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            enable_cofounder(&fixture, &owner).await;
            let mut start = blank(OnboardingActionKind::Start);
            start.lead_pubkey = Some(stranger.public_key().to_hex());
            let message = rejection(send(&fixture, &owner, start).await);
            assert!(message.contains("must be a managed agent"), "{message}");
            assert!(current(&fixture).await.is_none());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_stale_head_conflicts() {
            let (fixture, _owner, scout) = started_company().await;
            let mut stale = ask(OnboardingStep::Money);
            // A client that believes no head exists yet.
            stale.expected_head_event_id = None;
            let event = buzz_sdk::company_initiative::build_onboarding_action(&stale)
                .expect("build action")
                .sign_with_keys(&scout)
                .expect("sign action");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&scout)).await);
            assert!(message.starts_with("conflict:"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_command_d_tag_must_be_the_onboarding_coordinate() {
            let (fixture, _owner, scout) = started_company().await;
            let event = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_ONBOARDING_ACTION as u16),
                serde_json::to_string(&blank(OnboardingActionKind::Start)).expect("serialize"),
            )
            .tags([nostr::Tag::parse(["d", "company:onboarding:other"]).expect("d tag")])
            .sign_with_keys(&scout)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&scout)).await);
            assert!(message.contains("d tag"), "{message}");
        }
    }
}
