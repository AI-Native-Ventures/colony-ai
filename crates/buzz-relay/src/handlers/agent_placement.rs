//! Broker for agent placement commands (kind 47071, head kind 30682).
//!
//! The owner of a managed agent moves it between "This Mac" and "Cloud" with
//! one signed command. This handler checks the owner, the beta gate and the
//! per-account cap, then changes the placement, writes the follow-up Fly
//! operation, revokes the agent's AI sessions, stores the command and the
//! relay-signed head, all in one transaction: a user action is one atomic
//! persist, so a crash can never leave a flipped agent without its follow-up
//! work, or a head that disagrees with the stored placement.
//!
//! After the commit, every live connection of the agent is closed. The new home
//! (or the Mac again) reconnects through the NIP-42 home fence, so an old app
//! or an old machine can not keep answering.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::agent_placement::{
    placement_d_tag, validate_placement_action, Home, PlacementAction, PlacementHead, PlacementOp,
    PlacementStatus, PLACEMENT_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_AGENT_PLACEMENT_ACTION, KIND_AGENT_PLACEMENT_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::cloud_agents::{self as store, CasOutcome, CloudAgentRow};
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};

use super::company_cofounder::{
    command_d_tag, conflict, duplicate_result, forbidden, internal, invalid, relay_head_event,
};
use super::company_initiative::{commit_head, lock_current_head, HeadWrite};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an owner's placement command (kind 47071).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_AGENT_PLACEMENT_ACTION {
        return Err(invalid("placement command has the wrong event kind"));
    }
    let action = serde_json::from_str::<PlacementAction>(&event.content)
        .map_err(|error| invalid(format!("placement command: {error}")))?;
    validate_placement_action(&action)
        .map_err(|error| invalid(format!("placement command: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("placement command signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot move an agent",
        ));
    }
    let d_tag = command_d_tag(&event, "placement")?;
    if d_tag != placement_d_tag(&action.agent) {
        return Err(invalid(
            "placement command d tag must be the agent's pubkey",
        ));
    }

    let community = tenant.community();
    let signer_hex = auth.pubkey().to_hex();
    let signer_key = auth.pubkey().to_bytes();
    let agent_key = nostr::PublicKey::from_hex(&action.agent)
        .map_err(|_| invalid("agent must be a public key"))?
        .to_bytes();

    // Only the agent's owner may move it. The users table is the ownership
    // record, the same one the credits gateway trusts.
    let owner = state
        .db
        .get_agent_channel_policy(community, &agent_key)
        .await
        .map_err(internal)?
        .and_then(|(_, owner)| owner);
    if owner.as_deref() != Some(signer_key.as_slice()) {
        return Err(forbidden(
            "only the agent's owner can change where it works",
        ));
    }

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;

    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community.as_uuid())
    .bind(event.id.to_bytes().as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if already_stored {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }

    // Moving to the Mac is always allowed, even with the feature off or the
    // account off the beta list: it is the way back for anyone stuck in the
    // cloud. Everything that uses the cloud is gated.
    let needs_cloud = !matches!(
        (action.op, action.home),
        (PlacementOp::SetHome, Some(Home::Mac))
    );
    if needs_cloud {
        let email = store::verified_account_email(&mut tx, &signer_hex)
            .await
            .map_err(internal)?;
        if !state.config.cloud_agents.allows_account(email.as_deref()) {
            return Err(forbidden("cloud agents are not available for this account"));
        }
    }

    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_AGENT_PLACEMENT_HEAD,
        &d_tag,
        &format!("agent-placement:{}", action.agent),
    )
    .await?;

    let row = store::get_cloud_agent_in(&mut tx, community, &agent_key, true)
        .await
        .map_err(internal)?;
    let now = Utc::now().timestamp();
    let default_model = state.config.cloud_agents.default_model.as_deref();

    let (head, changed) = match action.op {
        PlacementOp::SetHome => {
            let target = action
                .home
                .ok_or_else(|| invalid("setHome requires home"))?;
            match row {
                None => {
                    check_generation(action.expected_generation, 0)?;
                    let status = (target == Home::Cloud).then_some(PlacementStatus::NotCloudReady);
                    (
                        not_cloud_ready_head(&action, &signer_hex, default_model, status, now),
                        false,
                    )
                }
                Some(row) => {
                    if target == Home::Cloud && row.home != Home::Cloud {
                        enforce_account_cap(state, &mut tx, &signer_hex, &signer_key).await?;
                    }
                    let outcome = store::set_cloud_home_cas_in(
                        &mut tx,
                        community,
                        &agent_key,
                        generation_i64(action.expected_generation)?,
                        target,
                    )
                    .await
                    .map_err(internal)?;
                    let changed = match outcome {
                        CasOutcome::Applied { changed, .. } => changed,
                        CasOutcome::Conflict { current_generation } => {
                            return Err(generation_conflict(current_generation));
                        }
                        CasOutcome::NotFound => {
                            return Err(conflict("the agent's cloud bundle was removed"));
                        }
                    };
                    if changed && target == Home::Cloud {
                        grant_starter_credit(&mut tx, &signer_hex).await?;
                    }
                    (
                        head_for(&mut tx, community, &agent_key, default_model, now).await?,
                        changed,
                    )
                }
            }
        }
        PlacementOp::SetCloudModel => {
            let model = action
                .cloud_model
                .as_deref()
                .ok_or_else(|| invalid("setCloudModel requires cloudModel"))?;
            if !state.config.cloud_agents.model_allowed(model) {
                return Err(invalid("that cloud model is not allowed"));
            }
            let row = require_cloud_ready(row)?;
            check_generation(action.expected_generation, row.generation)?;
            store::set_cloud_model_in(&mut tx, community, &agent_key, model)
                .await
                .map_err(internal)?;
            (
                head_for(&mut tx, community, &agent_key, default_model, now).await?,
                false,
            )
        }
        PlacementOp::RetryWake => {
            let row = require_cloud_ready(row)?;
            if row.home != Home::Cloud {
                return Err(invalid("the agent is not placed in the cloud"));
            }
            check_generation(action.expected_generation, row.generation)?;
            store::reset_cloud_wake_in(&mut tx, community, &agent_key)
                .await
                .map_err(internal)?;
            (
                head_for(&mut tx, community, &agent_key, default_model, now).await?,
                false,
            )
        }
    };

    let head_json = serde_json::to_string(&head).map_err(internal)?;
    let result = commit_head(
        tenant,
        state,
        tx,
        &event,
        &signer_hex,
        HeadWrite {
            head_kind: KIND_AGENT_PLACEMENT_HEAD,
            action_kind: KIND_AGENT_PLACEMENT_ACTION,
            d_tag: &d_tag,
            head_json,
            current_head_id,
            current_stored,
            label: "agent placement",
        },
    )
    .await?;

    if changed {
        crate::cloud_agents::disconnect_agent_connections(
            state,
            tenant,
            &agent_key,
            &event.id.to_hex(),
        );
    }
    // A flip to the cloud wakes the agent so it answers anything that went
    // unanswered while its Mac was off; `Try again` starts a failed wake over.
    let wake = match (action.op, action.home) {
        (PlacementOp::RetryWake, _) => true,
        (PlacementOp::SetHome, Some(Home::Cloud)) => changed,
        _ => false,
    };
    if wake {
        crate::cloud_agents::doorbell::wake_now(state, community, &agent_key).await;
    }
    Ok(result)
}

/// Re-publishes an agent's placement head from its stored row, in its own
/// transaction. Used when the row changes without a command: a bundle upload
/// (`cloudReady`, `configVersion`), a wake, a stop. Does nothing when the agent
/// has no row, or when the head already says the same (only `updatedAt`
/// differs), so repeated uploads and reconcile passes cause no event churn.
pub(crate) async fn refresh_head(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    agent_key: &[u8],
) -> Result<(), IngestError> {
    let community = tenant.community();
    let d_tag = hex::encode(agent_key);
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_AGENT_PLACEMENT_HEAD,
        &d_tag,
        &format!("agent-placement:{d_tag}"),
    )
    .await?;
    let Some(row) = store::get_cloud_agent_in(&mut tx, community, agent_key, true)
        .await
        .map_err(internal)?
    else {
        tx.rollback().await.map_err(internal)?;
        return Ok(());
    };
    let now = Utc::now().timestamp();
    let head = crate::cloud_agents::placement_head(
        &row,
        state.config.cloud_agents.default_model.as_deref(),
        now,
    );
    let unchanged = current_stored
        .as_ref()
        .and_then(|stored| serde_json::from_str::<PlacementHead>(&stored.event.content).ok())
        .is_some_and(|current| {
            PlacementHead {
                updated_at: head.updated_at,
                ..current
            } == head
        });
    if unchanged {
        tx.rollback().await.map_err(internal)?;
        return Ok(());
    }
    let head_event = relay_head_event(
        state,
        KIND_AGENT_PLACEMENT_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community,
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
            "agent placement changed before its head could be refreshed; retry",
        ));
    }
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_AGENT_PLACEMENT_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(())
}

/// The first time an account puts an agent in the cloud it gets a small AI
/// credit, in the same transaction as the flip. Accounts that use the gateway
/// free get nothing: their AI is already free and their ledger stays untouched.
async fn grant_starter_credit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner_hex: &str,
) -> Result<(), IngestError> {
    let Some((account, email)) = buzz_db::credits_gateway::cloud_owner_account_in(tx, owner_hex)
        .await
        .map_err(internal)?
    else {
        return Ok(());
    };
    if crate::api::credits_gateway_limits::policy_from_env().is_free(&email) {
        return Ok(());
    }
    buzz_db::credits_gateway::grant_cloud_starter_in(tx, account)
        .await
        .map_err(internal)?;
    Ok(())
}

/// Refuses a command that was written against another generation.
fn check_generation(expected: u64, current: i64) -> Result<(), IngestError> {
    if i64::try_from(expected).ok() == Some(current) {
        Ok(())
    } else {
        Err(generation_conflict(current))
    }
}

fn generation_conflict(current: i64) -> IngestError {
    conflict(format!("generation_conflict:{current}"))
}

fn generation_i64(generation: u64) -> Result<i64, IngestError> {
    i64::try_from(generation).map_err(|_| invalid("expectedGeneration is out of range"))
}

fn require_cloud_ready(row: Option<CloudAgentRow>) -> Result<CloudAgentRow, IngestError> {
    row.ok_or_else(|| invalid("the agent is not cloud-ready: no key and config bundle uploaded"))
}

/// Refuses a flip that would put one more agent of this account in the cloud
/// than the beta allows. The account's flips are serialized by an advisory
/// lock so two at once can not both pass the check.
async fn enforce_account_cap(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    signer_hex: &str,
    signer_key: &[u8; 32],
) -> Result<(), IngestError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("cloud-agent-cap:{signer_hex}"))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    let cap = state.config.cloud_agents.max_per_account;
    let current = store::count_cloud_agents_for_owner_in(tx, signer_key)
        .await
        .map_err(internal)?;
    if current >= cap {
        return Err(forbidden(format!("cloud_limit:{cap}")));
    }
    Ok(())
}

/// The head of an agent that has no stored bundle: still on the Mac at
/// generation 0. `status` is `NotCloudReady` when the owner tried the cloud.
fn not_cloud_ready_head(
    action: &PlacementAction,
    owner_hex: &str,
    default_model: Option<&str>,
    status: Option<PlacementStatus>,
    now: i64,
) -> PlacementHead {
    PlacementHead {
        schema: PLACEMENT_SCHEMA_VERSION,
        agent: action.agent.clone(),
        owner: owner_hex.to_owned(),
        home: Home::Mac,
        generation: 0,
        cloud_ready: false,
        config_version: 0,
        cloud_model: default_model.map(str::to_owned),
        status,
        updated_at: now,
    }
}

async fn head_for(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    agent_key: &[u8],
    default_model: Option<&str>,
    now: i64,
) -> Result<PlacementHead, IngestError> {
    let row = store::get_cloud_agent_in(tx, community, agent_key, false)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("cloud agent row vanished inside its transaction"))?;
    Ok(crate::cloud_agents::placement_head(
        &row,
        default_model,
        now,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_expected_generation_is_a_conflict_that_names_the_current_one() {
        assert!(check_generation(4, 4).is_ok());
        let error = check_generation(3, 4).unwrap_err();
        assert!(
            matches!(error, IngestError::Rejected(message) if message == "conflict: generation_conflict:4")
        );
    }

    #[test]
    fn a_missing_bundle_is_not_cloud_ready() {
        let error = require_cloud_ready(None).unwrap_err();
        assert!(
            matches!(error, IngestError::Rejected(message) if message.contains("not cloud-ready"))
        );
    }
}

#[cfg(test)]
mod postgres_tests {
    use std::sync::OnceLock;

    use nostr::{EventBuilder, Keys, Kind, Tag};
    use tokio::sync::Mutex;
    use uuid::Uuid;

    use buzz_db::cloud_agents::BundleRow;

    use super::*;
    use crate::cloud_agents::config::{CloudAgentsConfig, CloudMode};
    use crate::handlers::company_initiative::load_head;

    static PLACEMENT_DB_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    struct Fixture {
        state: Arc<AppState>,
        tenant: TenantContext,
        pool: sqlx::PgPool,
        owner: Keys,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    }

    fn config(mode: CloudMode) -> CloudAgentsConfig {
        CloudAgentsConfig {
            mode,
            allowed_models: vec!["free/a".to_string()],
            ..CloudAgentsConfig::default()
        }
    }

    async fn fixture(cloud: CloudAgentsConfig) -> Fixture {
        let serial_guard = PLACEMENT_DB_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .await;
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("connect to the disposable test database");
        let state = crate::state::tests::test_state_with_cloud_agents(&database_url, cloud).await;
        let community = Uuid::new_v4();
        let host = format!("agent-placement-{}.test", community.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let owner = Keys::generate();
        sqlx::query("INSERT INTO users (community_id, pubkey) VALUES ($1, $2)")
            .bind(community)
            .bind(owner.public_key().to_bytes().to_vec())
            .execute(&pool)
            .await
            .expect("insert owner user");
        Fixture {
            state,
            tenant: TenantContext::resolved(CommunityId::from_uuid(community), host),
            pool,
            owner,
            _serial_guard: serial_guard,
        }
    }

    /// A managed agent owned by the fixture's owner, optionally with a stored
    /// cloud bundle.
    async fn agent(fixture: &Fixture, with_bundle: bool) -> Keys {
        let agent = Keys::generate();
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) VALUES ($1, $2, $3)",
        )
        .bind(fixture.tenant.community().as_uuid())
        .bind(agent.public_key().to_bytes().to_vec())
        .bind(fixture.owner.public_key().to_bytes().to_vec())
        .execute(&fixture.pool)
        .await
        .expect("insert agent user");
        if with_bundle {
            fixture
                .state
                .db
                .upsert_cloud_bundle(&BundleRow {
                    community: fixture.tenant.community(),
                    agent_pubkey: agent.public_key().to_bytes().to_vec(),
                    owner_pubkey: fixture.owner.public_key().to_bytes().to_vec(),
                    wrapped_dek: vec![1; 28],
                    sealed_nsec: vec![2; 48],
                    nonce: vec![3; 12],
                    kek_id: "test-kek".to_string(),
                    auth_tag: None,
                    config: serde_json::json!({"name": "Scout"}),
                    config_version: 1,
                })
                .await
                .expect("store bundle");
        }
        agent
    }

    fn auth(keys: &Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    fn command(
        signer: &Keys,
        agent: &Keys,
        op: PlacementOp,
        home: Option<Home>,
        expected_generation: u64,
        cloud_model: Option<&str>,
    ) -> Event {
        let agent_hex = agent.public_key().to_hex();
        let action = PlacementAction {
            schema: 1,
            agent: agent_hex.clone(),
            op,
            home,
            expected_generation,
            cloud_model: cloud_model.map(str::to_owned),
        };
        EventBuilder::new(
            Kind::Custom(KIND_AGENT_PLACEMENT_ACTION as u16),
            serde_json::to_string(&action).expect("serialize action"),
        )
        .tags([Tag::parse(["d", agent_hex.as_str()]).expect("d tag")])
        .sign_with_keys(signer)
        .expect("sign placement command")
    }

    async fn flip(
        fixture: &Fixture,
        signer: &Keys,
        agent: &Keys,
        home: Home,
        expected_generation: u64,
    ) -> Result<IngestResult, IngestError> {
        let event = command(
            signer,
            agent,
            PlacementOp::SetHome,
            Some(home),
            expected_generation,
            None,
        );
        handle(&fixture.tenant, &fixture.state, event, auth(signer)).await
    }

    async fn head(fixture: &Fixture, agent: &Keys) -> Option<PlacementHead> {
        load_head(
            &fixture.state,
            fixture.tenant.community(),
            KIND_AGENT_PLACEMENT_HEAD,
            &agent.public_key().to_hex(),
        )
        .await
        .expect("read head")
        .map(|stored| {
            serde_json::from_str::<PlacementHead>(&stored.event.content).expect("parse head")
        })
    }

    async fn stored(fixture: &Fixture, agent: &Keys) -> CloudAgentRow {
        fixture
            .state
            .db
            .get_cloud_agent(fixture.tenant.community(), &agent.public_key().to_bytes())
            .await
            .expect("read row")
            .expect("row exists")
    }

    async fn pending_ops(fixture: &Fixture, agent: &Keys) -> Vec<(String, i64)> {
        sqlx::query_as(
            "SELECT op, generation FROM cloud_agent_ops \
             WHERE community_id = $1 AND agent_pubkey = $2 AND status = 'pending' \
             ORDER BY created_at, id",
        )
        .bind(fixture.tenant.community().as_uuid())
        .bind(agent.public_key().to_bytes().to_vec())
        .fetch_all(&fixture.pool)
        .await
        .expect("read ops")
    }

    fn rejection(result: Result<IngestResult, IngestError>) -> String {
        match result {
            Err(IngestError::Rejected(message)) => message,
            _ => panic!("expected a rejected placement command"),
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn non_owner_cannot_flip() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        let stranger = Keys::generate();
        let message = rejection(flip(&fixture, &stranger, &agent, Home::Cloud, 0).await);
        assert!(message.starts_with("restricted:"), "{message}");
        assert_eq!(stored(&fixture, &agent).await.home, Home::Mac);
        assert!(head(&fixture, &agent).await.is_none());
        assert!(pending_ops(&fixture, &agent).await.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flip_without_bundle_reports_not_cloud_ready() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, false).await;
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("the command is accepted");
        let head = head(&fixture, &agent).await.expect("head published");
        assert_eq!(head.status, Some(PlacementStatus::NotCloudReady));
        assert_eq!(head.home, Home::Mac, "home is unchanged");
        assert_eq!(head.generation, 0);
        assert!(!head.cloud_ready);
        assert_eq!(head.owner, fixture.owner.public_key().to_hex());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flip_to_cloud_publishes_head_and_queues_ensure_atomically() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("flip accepted");
        let head = head(&fixture, &agent).await.expect("head published");
        assert_eq!(head.home, Home::Cloud);
        assert_eq!(head.generation, 1);
        assert_eq!(head.status, Some(PlacementStatus::Asleep));
        assert!(head.cloud_ready);
        assert_eq!(head.config_version, 1);
        assert_eq!(
            pending_ops(&fixture, &agent).await,
            vec![("ensure".to_string(), 1)]
        );
        let row = stored(&fixture, &agent).await;
        assert_eq!((row.home, row.generation), (Home::Cloud, 1));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flip_respects_per_account_cap() {
        let mut cloud = config(CloudMode::On);
        cloud.max_per_account = 1;
        let fixture = fixture(cloud).await;
        let first = agent(&fixture, true).await;
        let second = agent(&fixture, true).await;
        flip(&fixture, &fixture.owner, &first, Home::Cloud, 0)
            .await
            .expect("first agent fits the cap");
        let message = rejection(flip(&fixture, &fixture.owner, &second, Home::Cloud, 0).await);
        assert_eq!(message, "restricted: cloud_limit:1");
        assert_eq!(stored(&fixture, &second).await.home, Home::Mac);
        // The agent already in the cloud is not counted against itself again.
        flip(&fixture, &fixture.owner, &first, Home::Cloud, 1)
            .await
            .expect("an agent already in the cloud may be asked again");
        // Freeing the slot lets the second one in.
        flip(&fixture, &fixture.owner, &first, Home::Mac, 1)
            .await
            .expect("back to the Mac");
        flip(&fixture, &fixture.owner, &second, Home::Cloud, 0)
            .await
            .expect("the freed slot is usable");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stale_generation_rejected() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("flip accepted");
        let message = rejection(flip(&fixture, &fixture.owner, &agent, Home::Mac, 0).await);
        assert_eq!(message, "conflict: generation_conflict:1");
        let row = stored(&fixture, &agent).await;
        assert_eq!((row.home, row.generation), (Home::Cloud, 1));
        assert_eq!(
            head(&fixture, &agent).await.expect("head").home,
            Home::Cloud,
            "a refused command leaves the head alone"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn flag_off_rejects_all_cloud_flips() {
        let fixture = fixture(config(CloudMode::Off)).await;
        let agent = agent(&fixture, true).await;
        for event in [
            command(
                &fixture.owner,
                &agent,
                PlacementOp::SetHome,
                Some(Home::Cloud),
                0,
                None,
            ),
            command(
                &fixture.owner,
                &agent,
                PlacementOp::RetryWake,
                None,
                0,
                None,
            ),
            command(
                &fixture.owner,
                &agent,
                PlacementOp::SetCloudModel,
                None,
                0,
                Some("free/a"),
            ),
        ] {
            let message = rejection(
                handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner)).await,
            );
            assert_eq!(
                message,
                "restricted: cloud agents are not available for this account"
            );
        }
        assert_eq!(stored(&fixture, &agent).await.home, Home::Mac);

        // The way back is never closed: an agent stuck in the cloud when the
        // feature goes off can still be moved to the Mac.
        fixture
            .state
            .db
            .set_cloud_home_cas(
                fixture.tenant.community(),
                &agent.public_key().to_bytes(),
                0,
                Home::Cloud,
            )
            .await
            .expect("seed a cloud placement");
        flip(&fixture, &fixture.owner, &agent, Home::Mac, 1)
            .await
            .expect("moving to the Mac works with the feature off");
        assert_eq!(stored(&fixture, &agent).await.home, Home::Mac);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn allowlist_mode_admits_only_listed_verified_owners() {
        let listed = format!("listed-{}@example.com", Uuid::new_v4().simple());
        let mut cloud = config(CloudMode::Allowlist);
        cloud.allowlist = vec![listed.clone()];
        let fixture = fixture(cloud).await;
        let agent = agent(&fixture, true).await;
        let message = rejection(flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0).await);
        assert!(
            message.contains("not available"),
            "no verified account: {message}"
        );

        sqlx::query(
            "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, \
             sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(format!("{}@example.invalid", Uuid::new_v4().simple()))
        .bind(fixture.owner.public_key().to_hex())
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&fixture.pool)
        .await
        .expect("insert unlisted account");
        let message = rejection(flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0).await);
        assert!(
            message.contains("not available"),
            "unlisted account: {message}"
        );

        sqlx::query("UPDATE accounts SET email = $2 WHERE pubkey = $1")
            .bind(fixture.owner.public_key().to_hex())
            .bind(&listed)
            .execute(&fixture.pool)
            .await
            .expect("list the account");
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("a listed, verified owner is admitted");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn retry_wake_clears_a_failed_wake() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("flip accepted");
        sqlx::query(
            "UPDATE cloud_agents SET status = 'failed', wake_attempts = 3, last_error = 'x' \
             WHERE community_id = $1 AND agent_pubkey = $2",
        )
        .bind(fixture.tenant.community().as_uuid())
        .bind(agent.public_key().to_bytes().to_vec())
        .execute(&fixture.pool)
        .await
        .expect("fail the wake");
        let event = command(
            &fixture.owner,
            &agent,
            PlacementOp::RetryWake,
            None,
            1,
            None,
        );
        handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner))
            .await
            .expect("retry accepted");
        let row = stored(&fixture, &agent).await;
        assert_eq!(
            (row.status, row.wake_attempts),
            (Some(PlacementStatus::Asleep), 0)
        );
        assert_eq!(
            head(&fixture, &agent).await.expect("head").status,
            Some(PlacementStatus::Asleep)
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn set_cloud_model_needs_an_allowed_model() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        let denied = command(
            &fixture.owner,
            &agent,
            PlacementOp::SetCloudModel,
            None,
            0,
            Some("not/allowed"),
        );
        let message = rejection(
            handle(
                &fixture.tenant,
                &fixture.state,
                denied,
                auth(&fixture.owner),
            )
            .await,
        );
        assert!(message.contains("not allowed"), "{message}");
        let allowed = command(
            &fixture.owner,
            &agent,
            PlacementOp::SetCloudModel,
            None,
            0,
            Some("free/a"),
        );
        handle(
            &fixture.tenant,
            &fixture.state,
            allowed,
            auth(&fixture.owner),
        )
        .await
        .expect("an allowed model is accepted");
        assert_eq!(
            head(&fixture, &agent)
                .await
                .expect("head")
                .cloud_model
                .as_deref(),
            Some("free/a")
        );
        assert_eq!(
            stored(&fixture, &agent).await.generation,
            0,
            "a model change keeps the generation"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn the_same_command_twice_is_acknowledged_without_a_second_change() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        let event = command(
            &fixture.owner,
            &agent,
            PlacementOp::SetHome,
            Some(Home::Cloud),
            0,
            None,
        );
        handle(
            &fixture.tenant,
            &fixture.state,
            event.clone(),
            auth(&fixture.owner),
        )
        .await
        .expect("first");
        let second = handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner))
            .await
            .expect("a replay is not an error");
        assert!(
            second.message.starts_with("duplicate"),
            "{}",
            second.message
        );
        assert_eq!(stored(&fixture, &agent).await.generation, 1);
        assert_eq!(pending_ops(&fixture, &agent).await.len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn first_flip_to_the_cloud_gives_the_starter_credit_exactly_once() {
        let fixture = fixture(config(CloudMode::On)).await;
        let agent = agent(&fixture, true).await;
        let account = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, \
             sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
        )
        .bind(account)
        .bind(format!("{}@example.invalid", account.simple()))
        .bind(fixture.owner.public_key().to_hex())
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&fixture.pool)
        .await
        .expect("insert account");
        let balance = || async {
            fixture
                .state
                .db
                .account_credit_balance(account)
                .await
                .expect("balance")
        };
        assert_eq!(balance().await, 0);
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 0)
            .await
            .expect("first flip");
        assert_eq!(balance().await, 1_000_000_000, "the starter credit is $1");
        flip(&fixture, &fixture.owner, &agent, Home::Mac, 1)
            .await
            .expect("back to the Mac");
        flip(&fixture, &fixture.owner, &agent, Home::Cloud, 2)
            .await
            .expect("second flip");
        assert_eq!(balance().await, 1_000_000_000, "never a second one");
        // A refused flip grants nothing.
        let other = self::agent(&fixture, false).await;
        flip(&fixture, &fixture.owner, &other, Home::Cloud, 0)
            .await
            .expect("accepted as not cloud-ready");
        assert_eq!(balance().await, 1_000_000_000);
    }
}
