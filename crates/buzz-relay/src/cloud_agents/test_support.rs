//! Shared fixtures for the cloud agents PostgreSQL tests. Each test gets its
//! own community in the disposable test database, so tests that run in
//! parallel never see each other's agents, journal rows or machines.

use std::sync::Arc;

use buzz_core::agent_placement::{Home, PlacementStatus};
use buzz_core::tenant::CommunityId;
use buzz_db::cloud_agents::CloudAgentRow;
use uuid::Uuid;

use super::config::{CloudAgentsConfig, CloudMode, FlyConfig};
use super::fake_host::FakeHost;
use crate::state::AppState;

/// One agent with a stored bundle, in a fresh community, with a fake host.
pub(crate) struct Fixture {
    pub state: Arc<AppState>,
    pub pool: sqlx::PgPool,
    pub community: CommunityId,
    pub agent: Vec<u8>,
    pub owner: Vec<u8>,
    pub host: FakeHost,
}

/// A fixture with cloud agents switched on.
pub(crate) async fn fixture() -> Fixture {
    fixture_in(CloudMode::On).await
}

/// A fixture with the given feature mode.
pub(crate) async fn fixture_in(mode: CloudMode) -> Fixture {
    fixture_with(mode, |_| {}).await
}

/// A fixture whose cloud agents configuration is adjusted by `adjust`.
pub(crate) async fn fixture_with(
    mode: CloudMode,
    adjust: impl FnOnce(&mut CloudAgentsConfig),
) -> Fixture {
    let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
    let pool = sqlx::PgPool::connect(&database_url)
        .await
        .expect("connect to the disposable test database");
    let mut cloud = CloudAgentsConfig {
        mode,
        fly: Some(FlyConfig::new(
            "colony-agents".into(),
            "iad".into(),
            1024,
            1,
            "registry.fly.io/colony-agents@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            "http://127.0.0.1:1/v1".into(),
            "token".into(),
        )),
        default_model: Some("free/a".into()),
        allowed_models: vec!["free/a".into()],
        // The cap is global and tests share one database: keep it out of the way.
        max_machines: 1_000_000,
        ..CloudAgentsConfig::default()
    };
    adjust(&mut cloud);
    let state = crate::state::tests::test_state_with_cloud_agents(&database_url, cloud).await;
    let community = Uuid::new_v4();
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community)
        .bind(format!("cloud-{}.test", community.simple()))
        .execute(&pool)
        .await
        .expect("insert test community");
    let community = CommunityId::from_uuid(community);
    let agent = nostr::Keys::generate().public_key().to_bytes().to_vec();
    let owner = nostr::Keys::generate().public_key().to_bytes().to_vec();
    state
        .db
        .upsert_cloud_bundle(&buzz_db::cloud_agents::BundleRow {
            community,
            agent_pubkey: agent.clone(),
            owner_pubkey: owner.clone(),
            wrapped_dek: vec![1; 28],
            sealed_nsec: vec![2; 48],
            nonce: vec![3; 12],
            kek_id: "test-kek".into(),
            auth_tag: None,
            config: serde_json::json!({"name": "Scout"}),
            config_version: 1,
        })
        .await
        .expect("store bundle");
    Fixture {
        state,
        pool,
        community,
        agent,
        owner,
        host: FakeHost::new(),
    }
}

impl Fixture {
    /// Changes the agent's home with a compare-and-swap, as the broker does.
    pub async fn flip(&self, expected: i64, home: Home) {
        self.state
            .db
            .set_cloud_home_cas(self.community, &self.agent, expected, home)
            .await
            .expect("flip");
    }

    /// The agent's stored row.
    pub async fn row(&self) -> CloudAgentRow {
        self.state
            .db
            .get_cloud_agent(self.community, &self.agent)
            .await
            .expect("read row")
            .expect("row")
    }

    /// Whether the agent still has a row.
    pub async fn row_exists(&self) -> bool {
        self.state
            .db
            .get_cloud_agent(self.community, &self.agent)
            .await
            .expect("read row")
            .is_some()
    }

    /// (op, generation, status, attempt) of every journal row, oldest first.
    pub async fn journal(&self) -> Vec<(String, i64, String, i32)> {
        sqlx::query_as(
            "SELECT op, generation, status, attempt FROM cloud_agent_ops \
             WHERE community_id = $1 ORDER BY created_at, id",
        )
        .bind(self.community.as_uuid())
        .fetch_all(&self.pool)
        .await
        .expect("read journal")
    }

    /// Makes every pending op due now and releases any lease.
    pub async fn make_due(&self) {
        sqlx::query(
            "UPDATE cloud_agent_ops SET next_attempt_at = now() - interval '1 second', \
             claimed_until = NULL WHERE community_id = $1 AND status = 'pending'",
        )
        .bind(self.community.as_uuid())
        .execute(&self.pool)
        .await
        .expect("make due");
    }

    /// Forces the stored status, as if a wake or a reconcile had set it.
    pub async fn force_status(&self, status: PlacementStatus) {
        let text = buzz_db::cloud_agents::status_str(status).expect("a stored status");
        sqlx::query(
            "UPDATE cloud_agents SET status = $3 WHERE community_id = $1 AND agent_pubkey = $2",
        )
        .bind(self.community.as_uuid())
        .bind(&self.agent)
        .bind(text)
        .execute(&self.pool)
        .await
        .expect("force status");
    }

    /// Runs one journal pass over this community only.
    pub async fn pass(&self) -> usize {
        super::ops::process_due_for(&self.state, &self.host, Some(self.community))
            .await
            .expect("journal pass")
    }
}
