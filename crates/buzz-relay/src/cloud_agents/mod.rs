//! Cloud agents: agents that work on their own machine instead of the owner's
//! Mac. The relay owns placement, the stored key and config, and (in later
//! slices) the machine lifecycle.
//!
//! This slice holds the configuration, the NIP-42 home fence and the machine boot. The placement
//! broker lives in [`crate::handlers::agent_placement`].

pub mod boot;
pub mod config;
#[cfg(any(test, feature = "test-fakes"))]
pub mod fake_host;
pub mod fence;
pub mod fly;
pub mod host;

use std::sync::Arc;

use buzz_core::agent_placement::{PlacementHead, PLACEMENT_SCHEMA_VERSION};
use buzz_db::cloud_agents::CloudAgentRow;
use sha2::{Digest, Sha256};

use crate::state::AppState;

/// SHA-256 of a home or boot token, the only form stored in the database.
pub fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Closes every live connection authenticated as the agent, on this pod and
/// every other, with a reason the harness can read.
///
/// A placement change clears the agent's home token, so every connection that
/// authenticated before it belongs to a home that no longer has the right to
/// answer: an old app still running on the Mac, or a cloud machine of an older
/// generation. Replies those connections had not yet published are not lost:
/// the new home asks the relay which messages are unanswered when it starts.
pub fn disconnect_agent_connections(
    state: &Arc<AppState>,
    tenant: &buzz_core::tenant::TenantContext,
    agent_pubkey: &[u8],
    event_id: &str,
) -> usize {
    state.disconnect_pubkey_clusterwide(
        tenant,
        agent_pubkey,
        event_id,
        "restricted: this agent moved to another home",
    )
}

/// The relay-signed head content for a stored cloud agent. `default_model`
/// fills `cloudModel` while the agent has not chosen one.
pub fn placement_head(row: &CloudAgentRow, default_model: Option<&str>, now: i64) -> PlacementHead {
    PlacementHead {
        schema: PLACEMENT_SCHEMA_VERSION,
        agent: hex::encode(&row.agent_pubkey),
        owner: hex::encode(&row.owner_pubkey),
        home: row.home,
        generation: u64::try_from(row.generation).unwrap_or(0),
        cloud_ready: true,
        config_version: u64::try_from(row.config_version).unwrap_or(0),
        cloud_model: row
            .cloud_model
            .clone()
            .or_else(|| default_model.map(str::to_owned)),
        status: row.status,
        updated_at: now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::agent_placement::{Home, PlacementStatus};
    use buzz_core::tenant::CommunityId;

    fn row(home: Home, status: Option<PlacementStatus>, model: Option<&str>) -> CloudAgentRow {
        let now = chrono::Utc::now();
        CloudAgentRow {
            community: CommunityId::from_uuid(uuid::Uuid::nil()),
            agent_pubkey: vec![0xaa; 32],
            owner_pubkey: vec![0xbb; 32],
            home,
            generation: 4,
            cloud_model: model.map(str::to_owned),
            status,
            wrapped_dek: vec![1; 28],
            sealed_nsec: vec![2; 48],
            nonce: vec![3; 12],
            kek_id: "k".to_string(),
            auth_tag: None,
            config: serde_json::json!({}),
            config_version: 7,
            fly_machine_id: None,
            fly_volume_id: None,
            home_token_hash: None,
            wake_attempts: 0,
            last_wake_at: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn the_head_mirrors_the_stored_row_and_never_carries_secrets() {
        let head = placement_head(
            &row(Home::Cloud, Some(PlacementStatus::Asleep), None),
            Some("deepseek/deepseek-v4.1-flash"),
            1_764_072_000,
        );
        assert_eq!(head.agent, "aa".repeat(32));
        assert_eq!(head.owner, "bb".repeat(32));
        assert_eq!((head.generation, head.config_version), (4, 7));
        assert!(head.cloud_ready);
        assert_eq!(head.status, Some(PlacementStatus::Asleep));
        assert_eq!(
            head.cloud_model.as_deref(),
            Some("deepseek/deepseek-v4.1-flash"),
            "the default fills in until the owner picks a model"
        );
        let json = serde_json::to_string(&head).expect("serialize");
        assert!(!json.contains("sealed") && !json.contains("nsec") && !json.contains("token"));
    }

    #[test]
    fn a_chosen_model_beats_the_default_and_a_mac_head_has_no_status() {
        let head = placement_head(&row(Home::Mac, None, Some("free/a")), Some("other/b"), 1);
        assert_eq!(head.cloud_model.as_deref(), Some("free/a"));
        assert_eq!(head.status, None);
        assert_eq!(head.home, Home::Mac);
    }

    #[test]
    fn token_hashes_are_sha256_of_the_token_text() {
        let hash = token_hash("abc");
        assert_eq!(
            hex::encode(hash),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
