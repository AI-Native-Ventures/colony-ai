//! Shared helpers for the co-founder initiative brokers (business brief and
//! onboarding progress): who may write, the current co-founder settings, and
//! the one atomic head write every action ends with.

use std::sync::Arc;

use nostr::Event;

use buzz_core::company_cofounder::{CofounderHead, CofounderSettings, COFOUNDER_D_TAG};
use buzz_core::kind::KIND_COFOUNDER_HEAD;
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    conflict, duplicate_result, internal, relay_head_event, verify_stored_head,
};
use super::ingest::{IngestError, IngestResult};
use crate::state::AppState;

/// Loads the relay-signed head of a single-record company coordinate.
pub(super) async fn load_head(
    state: &AppState,
    community_id: CommunityId,
    head_kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![head_kind as i32]);
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
        return Err(internal("stored head d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        verify_stored_head(stored, head_kind, d_tag, state)?;
    }
    Ok(stored)
}

/// The company's saved co-founder settings; the defaults (off) while none exist.
pub(super) async fn cofounder_settings(
    state: &AppState,
    community_id: CommunityId,
) -> Result<CofounderSettings, IngestError> {
    let stored = load_head(state, community_id, KIND_COFOUNDER_HEAD, COFOUNDER_D_TAG).await?;
    match stored {
        None => Ok(CofounderSettings::default()),
        Some(stored) => {
            let head = serde_json::from_str::<CofounderHead>(&stored.event.content)
                .map_err(|error| internal(format!("stored co-founder head is invalid: {error}")))?;
            Ok(head.settings)
        }
    }
}

/// Takes the per-record advisory lock, locks the head row and loads the current
/// head, refusing when the two views disagree. Returns the current head event id
/// and event.
pub(super) async fn lock_current_head(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    head_kind: u32,
    d_tag: &str,
    lock_name: &str,
) -> Result<(Option<Vec<u8>>, Option<StoredEvent>), IngestError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{lock_name}:{}", community_id.as_uuid()))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        head_kind,
        &state.relay_keypair.public_key().to_bytes(),
        d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = load_head(state, community_id, head_kind, d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal("head changed while its transaction lock was held"));
    }
    Ok((current_head_id, current_stored))
}

/// Everything the final write of a company-record action needs.
pub(super) struct HeadWrite<'a> {
    /// Kind of the relay-signed head.
    pub head_kind: u32,
    /// Kind of the member-signed action.
    pub action_kind: u32,
    /// The record's single d-tag.
    pub d_tag: &'a str,
    /// The new head as JSON.
    pub head_json: String,
    /// The current head event id, `None` while no head exists.
    pub current_head_id: Option<Vec<u8>>,
    /// The current head event, if any.
    pub current_stored: Option<StoredEvent>,
    /// Name used in the conflict message.
    pub label: &'static str,
}

/// Stores the member action, replaces the head against the current revision,
/// commits and fans both events out. One user action is one atomic persist.
pub(super) async fn commit_head(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    event: &Event,
    actor_pubkey: &str,
    write: HeadWrite<'_>,
) -> Result<IngestResult, IngestError> {
    let community_id = tenant.community();
    let head_event = relay_head_event(
        state,
        write.head_kind,
        write.d_tag,
        write.head_json,
        write.current_stored.as_ref(),
    )?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(event));
    }
    let precondition = write.current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &head_event,
            write.d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(format!(
            "{} changed before the action could commit; refresh and retry",
            write.label
        )));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        write.action_kind,
        actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        write.head_kind,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

/// Fixtures for the PostgreSQL tests of the initiative brokers. Each test gets
/// its own community in the disposable test database.
#[cfg(test)]
pub(super) mod test_support {
    use std::time::Duration;

    use tokio::sync::Mutex;
    use uuid::Uuid;

    use buzz_core::company_cofounder::CofounderSettings;

    use super::super::ingest::IngestAuth;
    use super::*;

    static INITIATIVE_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

    pub(in crate::handlers) struct Fixture {
        pub state: Arc<AppState>,
        pub tenant: TenantContext,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    }

    pub(in crate::handlers) async fn fixture() -> Fixture {
        let serial_guard = INITIATIVE_DB_TEST_LOCK
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
        let host = format!("company-initiative-{}.test", community_id.simple());
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

    pub(in crate::handlers) async fn add_member(fixture: &Fixture, keys: &nostr::Keys, role: &str) {
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

    /// Registers `agent` as a managed agent owned by `owner` (who must be a member).
    pub(in crate::handlers) async fn add_agent(
        fixture: &Fixture,
        owner: &nostr::Keys,
        agent: &nostr::Keys,
    ) {
        let agent_bytes = agent.public_key().to_bytes();
        fixture
            .state
            .db
            .ensure_user(fixture.tenant.community(), &owner.public_key().to_bytes())
            .await
            .expect("ensure owner user");
        fixture
            .state
            .db
            .ensure_user(fixture.tenant.community(), &agent_bytes)
            .await
            .expect("ensure agent user");
        fixture
            .state
            .db
            .set_agent_owner(
                fixture.tenant.community(),
                &agent_bytes,
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("bind managed agent owner");
    }

    pub(in crate::handlers) fn auth(keys: &nostr::Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    /// Saves co-founder settings through the real broker, as `admin`.
    pub(in crate::handlers) async fn save_cofounder_settings(
        fixture: &Fixture,
        admin: &nostr::Keys,
        settings: &CofounderSettings,
    ) {
        let expected = load_head(
            &fixture.state,
            fixture.tenant.community(),
            KIND_COFOUNDER_HEAD,
            COFOUNDER_D_TAG,
        )
        .await
        .expect("query co-founder head")
        .map(|stored| stored.event.id.to_hex());
        let event =
            buzz_sdk::company_records::build_cofounder_action(settings, expected.as_deref())
                .expect("build co-founder action")
                .sign_with_keys(admin)
                .expect("sign co-founder action");
        super::super::company_cofounder::handle(
            &fixture.tenant,
            &fixture.state,
            event,
            auth(admin),
        )
        .await
        .expect("save co-founder settings");
    }

    /// Switches co-founder mode on, keeping the other settings at their defaults.
    pub(in crate::handlers) async fn enable_cofounder(fixture: &Fixture, admin: &nostr::Keys) {
        save_cofounder_settings(
            fixture,
            admin,
            &CofounderSettings {
                enabled: true,
                ..CofounderSettings::default()
            },
        )
        .await;
    }

    pub(in crate::handlers) fn rejection(result: Result<IngestResult, IngestError>) -> String {
        match result {
            Err(IngestError::Rejected(message)) => message,
            Err(other) => panic!("expected a rejection, got {other:?}"),
            Ok(_) => panic!("expected a rejection, the write was accepted"),
        }
    }
}
