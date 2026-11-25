//! The NIP-42 home fence: which connection may authenticate as an agent.
//!
//! An agent works in one home at a time. When it is placed in the cloud, only
//! the machine the relay booted for the current generation holds the home token
//! and may authenticate as the agent. When it is placed on the Mac, nothing may
//! present a cloud token, and Mac connections authenticate exactly as before (no
//! tag), so apps that know nothing about cloud agents keep working.
//!
//! The fence is the relay-side half of "two copies never answer": a desktop
//! that starts a local harness for a cloud agent anyway, an older app, or a
//! machine of an old generation is refused here, whatever the clients do.

use buzz_core::agent_placement::Home;
use buzz_core::tenant::CommunityId;
use buzz_db::cloud_agents::FenceState;
use subtle::ConstantTimeEq;

use crate::state::AppState;

/// Name of the tag a cloud machine adds to its signed AUTH event.
pub const HOME_TAG: &str = "colony_home";

/// Why an authentication was refused by the fence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FenceRefusal {
    /// The agent is in the cloud and the connection presented no home token.
    HomeTokenRequired,
    /// The connection presented a home token the relay does not accept: wrong,
    /// old, or presented for an agent that is not in the cloud.
    HomeTokenNotAccepted,
    /// The placement could not be read. The connection is refused; a retry
    /// works once the database is back.
    Unavailable,
}

impl FenceRefusal {
    /// The reason sent to the client in the `OK false` frame.
    pub const fn message(self) -> &'static str {
        match self {
            Self::HomeTokenRequired | Self::HomeTokenNotAccepted => {
                "restricted: this agent works in another home"
            }
            Self::Unavailable => "error: internal error checking agent placement",
        }
    }
}

/// The home token of an AUTH event: the value of its single `colony_home` tag.
///
/// `None` when the event has no such tag (every Mac connection). Two tags, or a
/// tag with no value, count as a presented token that no stored hash can match.
pub fn extract_home_token(event: &nostr::Event) -> Option<String> {
    let mut tags = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(|name| name.as_str()) == Some(HOME_TAG));
    let first = tags.next()?;
    if tags.next().is_some() {
        return Some(String::new());
    }
    Some(first.as_slice().get(1).cloned().unwrap_or_default())
}

/// The fence rule on already-loaded state. `state` is `None` for an agent with
/// no stored bundle, which is a Mac agent at generation 0.
pub fn decide(state: Option<&FenceState>, home_token: Option<&str>) -> Result<(), FenceRefusal> {
    match (state.map(|state| state.home), home_token) {
        // Never uploaded a bundle, or placed on the Mac: ordinary Mac connection.
        (None | Some(Home::Mac), None) => Ok(()),
        // A cloud credential presented where nothing may hold one.
        (None | Some(Home::Mac), Some(_)) => Err(FenceRefusal::HomeTokenNotAccepted),
        (Some(Home::Cloud), None) => Err(FenceRefusal::HomeTokenRequired),
        (Some(Home::Cloud), Some(token)) => {
            let stored = state.and_then(|state| state.home_token_hash.as_deref());
            let presented = crate::cloud_agents::token_hash(token);
            match stored {
                Some(stored) if bool::from(stored.ct_eq(presented.as_slice())) => Ok(()),
                _ => Err(FenceRefusal::HomeTokenNotAccepted),
            }
        }
    }
}

/// Checks a verified NIP-42 authentication as `agent_pubkey` against the
/// agent's placement. Called by the AUTH handler after signature verification.
pub async fn check_agent_auth(
    state: &AppState,
    community: CommunityId,
    agent_pubkey: &[u8],
    home_tag: Option<&str>,
) -> Result<(), FenceRefusal> {
    // RED PROOF: the placement is never consulted, so any connection is let in.
    let _ = (state, community, agent_pubkey, home_tag);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(home: Home, token: Option<&str>) -> FenceState {
        FenceState {
            home,
            generation: 3,
            home_token_hash: token.map(|t| crate::cloud_agents::token_hash(t).to_vec()),
        }
    }

    #[test]
    fn mac_and_unknown_agents_authenticate_without_a_tag() {
        assert_eq!(decide(None, None), Ok(()));
        assert_eq!(decide(Some(&state(Home::Mac, None)), None), Ok(()));
    }

    #[test]
    fn a_cloud_token_is_refused_where_no_cloud_home_exists() {
        assert_eq!(
            decide(None, Some("tok")),
            Err(FenceRefusal::HomeTokenNotAccepted)
        );
        assert_eq!(
            decide(Some(&state(Home::Mac, Some("tok"))), Some("tok")),
            Err(FenceRefusal::HomeTokenNotAccepted),
            "a Mac-placed agent accepts no cloud credential even if a hash is left over"
        );
    }

    #[test]
    fn a_cloud_agent_needs_the_current_token() {
        let cloud = state(Home::Cloud, Some("current"));
        assert_eq!(decide(Some(&cloud), Some("current")), Ok(()));
        assert_eq!(
            decide(Some(&cloud), None),
            Err(FenceRefusal::HomeTokenRequired)
        );
        for wrong in ["old", "", "CURRENT", "current "] {
            assert_eq!(
                decide(Some(&cloud), Some(wrong)),
                Err(FenceRefusal::HomeTokenNotAccepted),
                "token {wrong:?}"
            );
        }
    }

    #[test]
    fn a_cloud_agent_with_no_booted_machine_accepts_nobody() {
        let waiting = state(Home::Cloud, None);
        assert_eq!(
            decide(Some(&waiting), Some("anything")),
            Err(FenceRefusal::HomeTokenNotAccepted)
        );
        assert_eq!(
            decide(Some(&waiting), None),
            Err(FenceRefusal::HomeTokenRequired)
        );
    }

    #[test]
    fn the_home_token_is_read_from_a_single_colony_home_tag() {
        let keys = nostr::Keys::generate();
        let sign = |tags: Vec<nostr::Tag>| {
            nostr::EventBuilder::new(nostr::Kind::Authentication, "")
                .tags(tags)
                .sign_with_keys(&keys)
                .expect("sign")
        };
        let tag = |values: &[&str]| nostr::Tag::parse(values.to_vec()).expect("tag");
        assert_eq!(extract_home_token(&sign(vec![])), None);
        assert_eq!(
            extract_home_token(&sign(vec![tag(&["colony_home", "tok"])])),
            Some("tok".to_string())
        );
        assert_eq!(
            extract_home_token(&sign(vec![
                tag(&["colony_home", "a"]),
                tag(&["colony_home", "b"])
            ])),
            Some(String::new()),
            "two tags are a presented token no hash can match"
        );
        assert_eq!(
            extract_home_token(&sign(vec![tag(&["colony_home"])])),
            Some(String::new())
        );
    }
}

/// The fence driven through the real AUTH handler, against a real database, so
/// removing the call from `handle_auth` fails these tests.
#[cfg(test)]
mod postgres_tests {
    use std::collections::HashMap;
    use std::sync::atomic::AtomicU8;
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Instant;

    use buzz_core::agent_placement::Home;
    use buzz_db::cloud_agents::{BundleRow, CasOutcome};
    use nostr::{EventBuilder, Keys, RelayUrl, Tag};
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;
    use uuid::Uuid;

    use crate::connection::{tests::read_frame, AuthState, ConnectionState};
    use crate::handlers::company_initiative::test_support::{fixture, Fixture};

    const CHALLENGE: &str = "cloud-fence-challenge";

    async fn put_agent_in_cloud(fixture: &Fixture, agent: &Keys, token: &str) {
        let db = &fixture.state.db;
        let community = fixture.tenant.community();
        let key = agent.public_key().to_bytes();
        db.upsert_cloud_bundle(&BundleRow {
            community,
            agent_pubkey: key.to_vec(),
            owner_pubkey: Keys::generate().public_key().to_bytes().to_vec(),
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
        let flipped = db
            .set_cloud_home_cas(community, &key, 0, Home::Cloud)
            .await
            .expect("flip to cloud");
        assert!(matches!(flipped, CasOutcome::Applied { generation: 1, .. }));
        let stored = db
            .set_cloud_home_token(community, &key, 1, &crate::cloud_agents::token_hash(token))
            .await
            .expect("store home token");
        assert!(stored);
    }

    async fn move_agent_to_mac(fixture: &Fixture, agent: &Keys) {
        let outcome = fixture
            .state
            .db
            .set_cloud_home_cas(
                fixture.tenant.community(),
                &agent.public_key().to_bytes(),
                1,
                Home::Mac,
            )
            .await
            .expect("flip to mac");
        assert!(matches!(outcome, CasOutcome::Applied { generation: 2, .. }));
    }

    /// Authenticates `agent` through `handle_auth`, optionally presenting a
    /// home token. Returns whether the connection ended up authenticated and
    /// the reason frame's text.
    async fn authenticate(fixture: &Fixture, agent: &Keys, token: Option<&str>) -> (bool, String) {
        let (send_tx, mut send_rx) = mpsc::channel(8);
        let (ctrl_tx, _ctrl_rx) = mpsc::channel(8);
        let conn = Arc::new(ConnectionState {
            conn_id: Uuid::new_v4(),
            tenant: fixture.tenant.clone(),
            remote_addr: "127.0.0.1:1234".parse().expect("socket addr"),
            auth_state: StdMutex::new(AuthState::Pending {
                challenge: CHALLENGE.to_owned(),
                started_at: Instant::now(),
            }),
            subscriptions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            send_tx,
            ctrl_tx,
            cancel: CancellationToken::new(),
            backpressure_count: Arc::new(AtomicU8::new(0)),
            grace_limit: 3,
        });
        crate::metrics::record_auth_attempt_started();
        let relay_url: RelayUrl = crate::api::bridge::nip42_expected_relay_url(
            &fixture.state.config.relay_url,
            &conn.tenant,
        )
        .parse()
        .expect("relay url");
        let mut builder = EventBuilder::auth(CHALLENGE, relay_url);
        if let Some(token) = token {
            builder = builder.tags([Tag::parse(["colony_home", token]).expect("home tag")]);
        }
        let event = builder.sign_with_keys(agent).expect("sign auth");
        crate::handlers::auth::handle_auth(event, conn.clone(), fixture.state.clone()).await;
        let frame = read_frame(&mut send_rx);
        let message = frame[3].as_str().unwrap_or_default().to_owned();
        let authenticated = matches!(conn.auth_state_snapshot(), AuthState::Authenticated(_));
        assert_eq!(frame[2].as_bool(), Some(authenticated), "frame {frame}");
        (authenticated, message)
    }

    /// [red-proof] A cloud-placed agent must not authenticate without the
    /// home token, which is what stops an older Mac app answering for it.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn auth_without_home_token_rejected_when_cloud() {
        let fixture = fixture().await;
        let agent = Keys::generate();
        put_agent_in_cloud(&fixture, &agent, "machine-token").await;

        let (authenticated, message) = authenticate(&fixture, &agent, None).await;
        assert!(!authenticated, "a Mac-style connection must be refused");
        assert_eq!(message, "restricted: this agent works in another home");

        let (authenticated, _) = authenticate(&fixture, &agent, Some("wrong-token")).await;
        assert!(!authenticated, "a wrong token must be refused");

        let (authenticated, message) = authenticate(&fixture, &agent, Some("machine-token")).await;
        assert!(authenticated, "the booted machine is let in: {message}");
    }

    /// [red-proof] After the agent moves back to the Mac, the cloud machine's
    /// old token buys nothing.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stale_cloud_token_rejected_when_mac() {
        let fixture = fixture().await;
        let agent = Keys::generate();
        put_agent_in_cloud(&fixture, &agent, "machine-token").await;
        move_agent_to_mac(&fixture, &agent).await;

        let (authenticated, message) = authenticate(&fixture, &agent, Some("machine-token")).await;
        assert!(!authenticated, "an old cloud credential must be refused");
        assert_eq!(message, "restricted: this agent works in another home");

        let (authenticated, message) = authenticate(&fixture, &agent, None).await;
        assert!(authenticated, "the Mac connects as before: {message}");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn mac_auth_unchanged_when_no_head() {
        let fixture = fixture().await;
        let agent = Keys::generate();
        let (authenticated, message) = authenticate(&fixture, &agent, None).await;
        assert!(
            authenticated,
            "an agent with no placement works as before: {message}"
        );
        let other = Keys::generate();
        let (authenticated, _) = authenticate(&fixture, &other, Some("any-token")).await;
        assert!(
            !authenticated,
            "a cloud token with no cloud home is refused"
        );
    }
}
