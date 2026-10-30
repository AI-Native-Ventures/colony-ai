//! Broker for the business brief record (kind 47064, head kind 30674).
//!
//! Scout (a managed agent) can only propose a brief, and only while co-founder
//! mode is on. Confirming, editing or discarding is for an owner or admin. The
//! relay writes one head, `company:brief`, holding the confirmed brief and any
//! proposal still waiting for the owner.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::company_brief::{
    next_brief_head, validate_brief_action, validate_brief_d_tag, validate_brief_head, BriefAction,
    BriefHead,
};
use buzz_core::kind::{KIND_BRIEF_ACTION, KIND_BRIEF_HEAD};
use buzz_core::tenant::TenantContext;

use super::company_cofounder::{
    check_expected_head, command_d_tag, duplicate_result, forbidden, internal, invalid, is_admin,
};
use super::company_initiative::{cofounder_settings, commit_head, lock_current_head, HeadWrite};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a business brief action (kind 47064).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_BRIEF_ACTION {
        return Err(invalid("brief action has the wrong event kind"));
    }
    let action = serde_json::from_str::<BriefAction>(&event.content)
        .map_err(|error| invalid(format!("brief action: {error}")))?;
    validate_brief_action(&action).map_err(|error| invalid(format!("brief action: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("brief action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write the business brief",
        ));
    }
    let d_tag = command_d_tag(&event, "brief")?;
    validate_brief_d_tag(&d_tag)
        .map_err(|error| invalid(format!("brief command d tag: {error}")))?;

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
            "only the owner or an admin can confirm, edit or discard the business brief",
        ));
    }
    if !actor_is_admin {
        // Only Scout (a managed agent) may propose, and only while co-founder
        // mode is on: switching it off stops new initiative.
        if !super::company_member_records::is_registered_employee(
            state,
            community_id,
            &actor_pubkey,
        )
        .await?
        {
            return Err(forbidden(
                "only an agent or an admin can propose the business brief",
            ));
        }
        if !cofounder_settings(state, community_id).await?.enabled {
            return Err(forbidden("co-founder mode is off for this company"));
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
        KIND_BRIEF_HEAD,
        &d_tag,
        "company-brief",
    )
    .await?;
    check_expected_head(
        "business brief",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    )?;
    let current = current_stored
        .as_ref()
        .map(|stored| serde_json::from_str::<BriefHead>(&stored.event.content))
        .transpose()
        .map_err(|error| internal(format!("stored brief head is invalid: {error}")))?;
    let head = next_brief_head(
        current.as_ref(),
        &action,
        &actor_pubkey,
        Utc::now().timestamp(),
    )
    .map_err(|error| invalid(format!("brief action: {error}")))?;
    validate_brief_head(&head).map_err(|error| internal(format!("brief head: {error}")))?;

    commit_head(
        tenant,
        state,
        tx,
        &event,
        &actor_pubkey,
        HeadWrite {
            head_kind: KIND_BRIEF_HEAD,
            action_kind: KIND_BRIEF_ACTION,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&head).map_err(internal)?,
            current_head_id,
            current_stored,
            label: "business brief",
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use buzz_core::company_brief::{BriefActionKind, BriefContent};
        use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
        use buzz_core::StoredEvent;

        use super::super::super::company_initiative::load_head;
        use super::super::super::company_initiative::test_support::{
            add_agent, add_member, auth, enable_cofounder, fixture, rejection, Fixture,
        };
        use super::super::*;

        fn content(what: &str) -> BriefContent {
            BriefContent {
                what_you_sell: what.into(),
                who_buys: "Guesthouses around Johannesburg".into(),
                prices: None,
                how_you_talk: "Friendly and short".into(),
                sources: vec!["Your website".into()],
            }
        }

        fn action(
            kind: BriefActionKind,
            content: Option<BriefContent>,
            expected: Option<&str>,
        ) -> BriefAction {
            BriefAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                kind,
                content,
                expected_head_event_id: expected.map(str::to_owned),
            }
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &BriefAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_initiative::build_brief_action(action)
                .expect("build brief action")
                .sign_with_keys(keys)
                .expect("sign brief action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn head_of(fixture: &Fixture) -> (StoredEvent, BriefHead) {
            let stored = load_head(
                &fixture.state,
                fixture.tenant.community(),
                KIND_BRIEF_HEAD,
                buzz_core::company_brief::BRIEF_D_TAG,
            )
            .await
            .expect("query brief head")
            .expect("brief head exists");
            let head = serde_json::from_str(&stored.event.content).expect("brief head");
            (stored, head)
        }

        /// An owner, Scout (a managed agent) and co-founder mode switched on.
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
        async fn scout_proposes_and_the_owner_confirms() {
            let (fixture, owner, scout) = company_with_scout().await;

            send(
                &fixture,
                &scout,
                &action(BriefActionKind::Propose, Some(content("Websites")), None),
            )
            .await
            .expect("Scout proposes the brief");
            let (stored, head) = head_of(&fixture).await;
            assert_eq!(stored.event.kind.as_u16() as u32, KIND_BRIEF_HEAD);
            assert_eq!(
                stored.event.pubkey,
                fixture.state.relay_keypair.public_key()
            );
            assert!(stored.channel_id.is_none());
            assert_eq!(head.pending, Some(content("Websites")));
            assert!(head.confirmed.is_none());

            let first = stored.event.id.to_hex();
            send(
                &fixture,
                &owner,
                &action(BriefActionKind::Confirm, None, Some(first.as_str())),
            )
            .await
            .expect("owner confirms");
            let (_, head) = head_of(&fixture).await;
            assert_eq!(head.confirmed, Some(content("Websites")));
            assert!(head.pending.is_none());
            assert_eq!(
                head.confirmed_by_pubkey.as_deref(),
                Some(owner.public_key().to_hex().as_str())
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_owner_can_edit_the_brief_at_any_time() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            // Even with co-founder mode off, the owner keeps the brief editable.
            send(
                &fixture,
                &owner,
                &action(
                    BriefActionKind::Edit,
                    Some(content("Websites and ads")),
                    None,
                ),
            )
            .await
            .expect("owner edits the brief");
            let (_, head) = head_of(&fixture).await;
            assert_eq!(head.confirmed, Some(content("Websites and ads")));
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_cannot_propose_while_cofounder_mode_is_off() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let scout = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_agent(&fixture, &owner, &scout).await;

            let message = rejection(
                send(
                    &fixture,
                    &scout,
                    &action(BriefActionKind::Propose, Some(content("Websites")), None),
                )
                .await,
            );
            assert!(
                message.contains("co-founder mode is off for this company"),
                "{message}"
            );
            let missing = load_head(
                &fixture.state,
                fixture.tenant.community(),
                KIND_BRIEF_HEAD,
                buzz_core::company_brief::BRIEF_D_TAG,
            )
            .await
            .expect("query brief head");
            assert!(
                missing.is_none(),
                "a refused proposal must not create a head"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn scout_cannot_confirm_its_own_proposal() {
            let (fixture, _owner, scout) = company_with_scout().await;
            send(
                &fixture,
                &scout,
                &action(BriefActionKind::Propose, Some(content("Websites")), None),
            )
            .await
            .expect("Scout proposes the brief");
            let first = head_of(&fixture).await.0.event.id.to_hex();
            let message = rejection(
                send(
                    &fixture,
                    &scout,
                    &action(BriefActionKind::Confirm, None, Some(first.as_str())),
                )
                .await,
            );
            assert!(
                message.contains("only the owner or an admin can confirm"),
                "{message}"
            );
            let (_, head) = head_of(&fixture).await;
            assert!(
                head.confirmed.is_none(),
                "Scout must not confirm its own brief"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_plain_member_cannot_propose() {
            let (fixture, _owner, _scout) = company_with_scout().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let message = rejection(
                send(
                    &fixture,
                    &member,
                    &action(BriefActionKind::Propose, Some(content("Websites")), None),
                )
                .await,
            );
            assert!(
                message.contains("only an agent or an admin can propose"),
                "{message}"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_stale_head_conflicts() {
            let (fixture, _owner, scout) = company_with_scout().await;
            send(
                &fixture,
                &scout,
                &action(BriefActionKind::Propose, Some(content("Websites")), None),
            )
            .await
            .expect("first proposal");
            let message = rejection(
                send(
                    &fixture,
                    &scout,
                    &action(BriefActionKind::Propose, Some(content("Ads")), None),
                )
                .await,
            );
            assert!(message.starts_with("conflict:"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn confirming_with_nothing_proposed_is_refused() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let message = rejection(
                send(
                    &fixture,
                    &owner,
                    &action(BriefActionKind::Confirm, None, None),
                )
                .await,
            );
            assert!(
                message.contains("no proposed brief to confirm"),
                "{message}"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_command_d_tag_must_be_the_brief_coordinate() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let event = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_BRIEF_ACTION as u16),
                serde_json::to_string(&action(BriefActionKind::Confirm, None, None))
                    .expect("serialize"),
            )
            .tags([nostr::Tag::parse(["d", "company:brief:other"]).expect("d tag")])
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await);
            assert!(message.contains("d tag"), "{message}");
        }
    }
}
