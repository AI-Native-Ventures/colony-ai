//! Broker for the per-company co-founder settings record (kind 47060).
//!
//! Only a community owner or admin can change co-founder mode. The relay
//! validates the action, serializes writers on one company lock, checks the
//! caller's expected head, and replaces the relay-signed head (kind 30670).
//! The same helpers back the function slot broker.

use std::sync::Arc;

use chrono::Utc;
use nostr::{Event, EventBuilder, Kind, Tag};

use buzz_core::company_cofounder::{
    validate_cofounder_action, validate_cofounder_d_tag, validate_cofounder_head, CofounderHead,
    COFOUNDER_D_TAG,
};
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_COFOUNDER_ACTION, KIND_COFOUNDER_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an owner or admin co-founder settings action (kind 47060).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::CofounderAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_cofounder_action(&action)
        .map_err(|error| invalid(format!("co-founder action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_COFOUNDER_ACTION {
        return Err(invalid("co-founder action has the wrong event kind"));
    }
    if event.verify().is_err() {
        return Err(invalid("co-founder action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write co-founder settings",
        ));
    }
    let d_tag = command_d_tag(&event, "co-founder")?;
    validate_cofounder_d_tag(&d_tag)
        .map_err(|error| invalid(format!("co-founder command d tag: {error}")))?;

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
    // Members and managed agents (which have no owner or admin role) are refused.
    if !actor_role.as_deref().is_some_and(is_admin) {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only the owner or an admin can change co-founder mode",
        ));
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
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-cofounder:{}", community_id.as_uuid()))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_COFOUNDER_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_cofounder_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(internal(
            "co-founder head changed while its transaction lock was held",
        ));
    }
    if let Err(error) = check_expected_head(
        "co-founder settings",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    ) {
        tx.rollback().await.map_err(internal)?;
        return Err(error);
    }

    let was_enabled = current_stored
        .as_ref()
        .and_then(|stored| serde_json::from_str::<CofounderHead>(&stored.event.content).ok())
        .is_some_and(|head| head.settings.enabled);
    let head = CofounderHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        settings: action.settings,
        updated_by_pubkey: actor_pubkey.clone(),
        updated_at: Utc::now().timestamp(),
    };
    let head_event = relay_head_event(
        state,
        KIND_COFOUNDER_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
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
            &d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(
            "co-founder settings changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_COFOUNDER_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_COFOUNDER_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    if action.settings.enabled && !was_enabled {
        // Scout starts (or resumes) onboarding as soon as the mode goes on.
        crate::cofounder_wake::enqueue(
            state,
            community_id,
            crate::cofounder_wake::WakeReason::ModeOn,
            &format!("mode_on:{}", replaced.event.event.id.to_hex()),
            "",
        )
        .await;
    }
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

/// Whether co-founder mode is on for this company. A company with no head is off.
pub(super) async fn cofounder_enabled(
    state: &AppState,
    community_id: CommunityId,
) -> Result<bool, IngestError> {
    let Some(stored) = current_cofounder_head(state, community_id, COFOUNDER_D_TAG).await? else {
        return Ok(false);
    };
    let head = serde_json::from_str::<CofounderHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored co-founder head is invalid: {error}")))?;
    Ok(head.settings.enabled)
}

pub(super) async fn current_cofounder_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COFOUNDER_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.global_only = true;
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(internal(
            "stored co-founder d-tag resolved to multiple heads",
        ));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = serde_json::from_str::<CofounderHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored co-founder head is invalid: {error}")))?;
        validate_cofounder_head(&head)
            .map_err(|error| internal(format!("stored co-founder head: {error}")))?;
        verify_stored_head(stored, KIND_COFOUNDER_HEAD, COFOUNDER_D_TAG, state)?;
    }
    Ok(stored)
}

/// Checks that a stored head is the relay's own signed, global, d-tag-only head.
pub(super) fn verify_stored_head(
    stored: &StoredEvent,
    kind: u32,
    d_tag: &str,
    state: &AppState,
) -> Result<(), IngestError> {
    let d_tags = stored
        .event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if stored.event.kind != Kind::Custom(kind as u16)
        || stored.event.pubkey != state.relay_keypair.public_key()
        || stored.event.verify().is_err()
        || stored.channel_id.is_some()
        || d_tags.len() != 1
        || d_tags[0].content() != Some(d_tag)
        || stored.event.tags.len() != 1
    {
        return Err(internal("stored company head has invalid tags"));
    }
    Ok(())
}

/// Builds a relay-signed head event with a strictly increasing `created_at`.
pub(super) fn relay_head_event(
    state: &AppState,
    kind: u32,
    d_tag: &str,
    content: String,
    previous: Option<&StoredEvent>,
) -> Result<Event, IngestError> {
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let d_tag = Tag::parse(["d", d_tag]).map_err(internal)?;
    EventBuilder::new(Kind::Custom(kind as u16), content)
        .tags([d_tag])
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

/// Returns the single `d` tag of a command, refusing `h`, `p` or any other tag
/// except an optional `auth` tag.
pub(super) fn command_d_tag(event: &Event, label: &str) -> Result<String, IngestError> {
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    let auth_tag_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "auth")
        .count();
    if d_tags.len() != 1
        || auth_tag_count > 1
        || event.tags.iter().any(|tag| {
            let kind = tag.kind().to_string();
            kind != "d" && kind != "auth"
        })
    {
        return Err(invalid(format!(
            "{label} commands require one d tag and no h or p tag"
        )));
    }
    d_tags[0]
        .content()
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{label} command d tag must have a value")))
}

/// Refuses a write whose expected head is not the current head.
pub(super) fn check_expected_head(
    label: &str,
    expected: Option<&str>,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    let actual = current_head_id.map(hex::encode);
    if expected == actual.as_deref() {
        Ok(())
    } else {
        Err(conflict(format!(
            "{label} changed; current head is {}",
            actual.unwrap_or_else(|| "missing".to_owned())
        )))
    }
}

pub(super) fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

pub(super) fn duplicate_result(event: &Event) -> IngestResult {
    IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: "duplicate: already processed".into(),
    }
}

pub(super) fn invalid(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("invalid: {}", message.into()))
}

pub(super) fn forbidden(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("restricted: {}", message.into()))
}

pub(super) fn conflict(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("conflict: {}", message.into()))
}

pub(super) fn internal(error: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {error}"))
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use std::time::Duration;

        use buzz_core::company_cofounder::{CofounderAction, CofounderSettings, MoneyPreference};
        use tokio::sync::Mutex;
        use uuid::Uuid;

        use super::super::*;

        static COFOUNDER_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

        struct Fixture {
            state: Arc<AppState>,
            tenant: TenantContext,
            _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        }

        async fn fixture() -> Fixture {
            let serial_guard = COFOUNDER_DB_TEST_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .await;
            let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
                .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
            let pool = sqlx::PgPool::connect(&database_url)
                .await
                .expect("connect to the disposable test database");
            let state = crate::state::tests::test_state_with_database_url_and_acquire_timeout(
                &database_url,
                Duration::from_secs(10),
            )
            .await;
            let community_id = Uuid::new_v4();
            let host = format!("company-cofounder-{}.test", community_id.simple());
            sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
                .bind(community_id)
                .bind(&host)
                .execute(&pool)
                .await
                .expect("insert test community");
            Fixture {
                state,
                tenant: TenantContext::resolved(CommunityId::from_uuid(community_id), host),
                _serial_guard: serial_guard,
            }
        }

        async fn add_member(fixture: &Fixture, keys: &nostr::Keys, role: &str) {
            fixture
                .state
                .db
                .add_relay_member(
                    fixture.tenant.community(),
                    &keys.public_key().to_hex(),
                    role,
                    None,
                )
                .await
                .expect("add relay member");
        }

        fn auth(keys: &nostr::Keys) -> IngestAuth {
            IngestAuth::Http {
                pubkey: keys.public_key(),
                scopes: vec![buzz_auth::Scope::MessagesWrite],
                auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
            }
        }

        fn enabled_settings() -> CofounderSettings {
            CofounderSettings {
                enabled: true,
                money_preference: MoneyPreference::BestOption,
                ..CofounderSettings::default()
            }
        }

        fn signed(
            keys: &nostr::Keys,
            settings: &CofounderSettings,
            expected: Option<&str>,
        ) -> Event {
            buzz_sdk::company_records::build_cofounder_action(settings, expected)
                .expect("build co-founder action")
                .sign_with_keys(keys)
                .expect("sign co-founder action")
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            settings: &CofounderSettings,
            expected: Option<&str>,
        ) -> Result<IngestResult, IngestError> {
            let event = signed(keys, settings, expected);
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn current_head(fixture: &Fixture) -> StoredEvent {
            current_cofounder_head(&fixture.state, fixture.tenant.community(), COFOUNDER_D_TAG)
                .await
                .expect("query co-founder head")
                .expect("co-founder head exists")
        }

        fn rejection(result: Result<IngestResult, IngestError>) -> String {
            match result {
                Err(IngestError::Rejected(message)) => message,
                _ => panic!("expected a rejected co-founder action"),
            }
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_set_by_owner_writes_head() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;

            let settings = enabled_settings();
            let result = send(&fixture, &owner, &settings, None)
                .await
                .expect("owner enables co-founder mode");
            assert!(result.accepted);

            let stored = current_head(&fixture).await;
            assert_eq!(stored.event.kind.as_u16() as u32, KIND_COFOUNDER_HEAD);
            assert_eq!(
                stored.event.pubkey,
                fixture.state.relay_keypair.public_key()
            );
            assert!(stored.channel_id.is_none());
            let head: CofounderHead = serde_json::from_str(&stored.event.content).expect("head");
            assert_eq!(head.settings, settings);
            assert_eq!(head.updated_by_pubkey, owner.public_key().to_hex());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_set_by_admin_writes_head() {
            let fixture = fixture().await;
            let admin = nostr::Keys::generate();
            add_member(&fixture, &admin, "admin").await;

            send(&fixture, &admin, &enabled_settings(), None)
                .await
                .expect("admin enables co-founder mode");
            let head: CofounderHead =
                serde_json::from_str(&current_head(&fixture).await.event.content).expect("head");
            assert!(head.settings.enabled);
            assert_eq!(head.updated_by_pubkey, admin.public_key().to_hex());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_set_by_member_is_denied() {
            let fixture = fixture().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;

            let message = rejection(send(&fixture, &member, &enabled_settings(), None).await);
            assert!(
                message.contains("only the owner or an admin can change co-founder mode"),
                "{message}"
            );
            let missing =
                current_cofounder_head(&fixture.state, fixture.tenant.community(), COFOUNDER_D_TAG)
                    .await
                    .expect("query co-founder head");
            assert!(missing.is_none(), "a denied write must not create a head");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_set_by_agent_is_denied() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            // A managed agent is not an owner or admin: it has no relay_members row.
            let agent = nostr::Keys::generate();
            fixture
                .state
                .db
                .ensure_user(fixture.tenant.community(), &agent.public_key().to_bytes())
                .await
                .expect("ensure agent user");

            let message = rejection(send(&fixture, &agent, &enabled_settings(), None).await);
            assert!(
                message.contains("only the owner or an admin can change co-founder mode"),
                "{message}"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_set_with_stale_expected_head_conflicts() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;

            send(&fixture, &owner, &enabled_settings(), None)
                .await
                .expect("first write");
            let first_head = current_head(&fixture).await.event.id.to_hex();

            // A writer that still believes no head exists is stale.
            let message =
                rejection(send(&fixture, &owner, &CofounderSettings::default(), None).await);
            assert!(message.starts_with("conflict:"), "{message}");

            // A writer that names the current head succeeds and replaces it.
            send(
                &fixture,
                &owner,
                &CofounderSettings::default(),
                Some(first_head.as_str()),
            )
            .await
            .expect("write with the current head");
            let head: CofounderHead =
                serde_json::from_str(&current_head(&fixture).await.event.content).expect("head");
            assert!(!head.settings.enabled);

            // The superseded head id is now stale as well.
            let message = rejection(
                send(
                    &fixture,
                    &owner,
                    &enabled_settings(),
                    Some(first_head.as_str()),
                )
                .await,
            );
            assert!(message.starts_with("conflict:"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cofounder_action_with_h_tag_is_refused() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let action = CofounderAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                settings: enabled_settings(),
                expected_head_event_id: None,
            };
            let event = EventBuilder::new(
                Kind::Custom(KIND_COFOUNDER_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tags([
                Tag::parse(["d", COFOUNDER_D_TAG]).expect("d tag"),
                Tag::parse(["h", Uuid::new_v4().to_string().as_str()]).expect("h tag"),
            ])
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await);
            assert!(message.contains("no h or p tag"), "{message}");
        }
    }
}
