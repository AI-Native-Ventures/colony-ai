//! Booting a cloud machine: the one-time token and the environment it buys.
//!
//! A machine's Fly config carries only the boot URL and a single-use boot token
//! (valid 300 seconds). On start the harness trades the token for its real
//! environment here: the agent's own key, the relay URL, the home token that
//! lets it authenticate, a credits session, and its runnable settings. The token
//! is cleared in the same statement that checks it, so a second redemption, an
//! expired token, or a token for an agent that has since moved all get `401`.
//!
//! Never in that environment: the owner's key, the OpenRouter master key,
//! payment secrets, or any provider key.

use std::collections::BTreeMap;
use std::sync::Arc;

use buzz_core::agent_placement::{is_secret_env_name, CloudConfigSnapshot, CLOUD_MODEL_FREE};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::cloud_agents::CloudAgentRow;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::state::AppState;

/// Seconds a boot token stays valid.
pub const BOOT_TOKEN_TTL_SECS: i64 = 300;
/// Seconds of silence after which the harness exits and the machine sleeps.
pub const IDLE_EXIT_SECS: u32 = 600;
/// Where the machine's volume is mounted.
pub const DATA_DIR: &str = "/data";
/// OpenCode's free model, the first stop of the free route.
pub const OPENCODE_FREE_MODEL: &str = "opencode/deepseek-v4.1-flash-free";
/// Hours the OpenRouter free route stays in force after OpenCode refuses.
pub const FREE_ROUTE_SWITCH_HOURS: i32 = 6;
/// Seconds a route-switch start waits, so the refusing machine can exit first.
pub const FREE_ROUTE_START_DELAY_SECS: i32 = 10;

/// Which way a machine reaches its AI. The harness reads it as
/// `COLONY_CLOUD_ROUTE` (see `buzz-acp`'s `free_route`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// `colony-free`, first stop: OpenCode's free model, inside the machine,
    /// with no gateway session.
    OpenCodeFree,
    /// `colony-free` after OpenCode refused: the free models behind the Colony
    /// gateway, on a session that can never choose a paid model.
    OpenrouterFree,
    /// An allowlisted paid model through the credits gateway.
    Gateway,
}

impl Route {
    /// The `COLONY_CLOUD_ROUTE` value, `None` for the paid gateway route.
    pub const fn env_value(self) -> Option<&'static str> {
        match self {
            Self::OpenCodeFree => Some("openCodeFree"),
            Self::OpenrouterFree => Some("openrouterFree"),
            Self::Gateway => None,
        }
    }
}

/// Picks the route for a boot. `colony-free` starts on OpenCode and moves to the
/// OpenRouter free route only while a switch recorded by a refusal is in force
/// (`free_until` in the future). Any other model is the paid gateway route.
pub fn pick_route(
    model: &str,
    free_until: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> Route {
    if model != CLOUD_MODEL_FREE {
        return Route::Gateway;
    }
    match free_until {
        Some(until) if until > now => Route::OpenrouterFree,
        _ => Route::OpenCodeFree,
    }
}

/// Why a boot token could not be issued or redeemed.
#[derive(Debug)]
pub enum BootError {
    /// The token is unknown, already used, expired, or the agent is no longer
    /// placed in the cloud at the generation it was issued for.
    Unauthorized,
    /// The relay can not boot a machine right now. The text is safe to log.
    Unavailable(String),
}

fn unavailable(what: impl std::fmt::Display) -> BootError {
    BootError::Unavailable(what.to_string())
}

/// Issues a single-use boot token for a cloud-placed agent at `generation`.
/// Returns [`BootError::Unauthorized`] when the agent is not in the cloud at
/// that generation, so a stale wake can never mint a token.
pub async fn issue(
    state: &AppState,
    community: CommunityId,
    agent: &[u8],
    generation: i64,
) -> Result<Zeroizing<String>, BootError> {
    let token = Zeroizing::new(hex::encode(rand::random::<[u8; 32]>()));
    let hash = super::token_hash(&token);
    match state
        .db
        .issue_cloud_boot_token(community, agent, generation, &hash, BOOT_TOKEN_TTL_SECS)
        .await
    {
        Ok(true) => Ok(token),
        Ok(false) => Err(BootError::Unauthorized),
        Err(error) => Err(unavailable(format!("boot token not stored: {error}"))),
    }
}

/// Redeems a boot token and returns the environment for the machine.
///
/// The token is consumed first. Everything after it can fail without
/// re-enabling the token: the wake journal issues a fresh one on its next
/// attempt.
pub async fn redeem(
    state: &Arc<AppState>,
    token: &str,
) -> Result<BTreeMap<String, Zeroizing<String>>, BootError> {
    let row = state
        .db
        .consume_cloud_boot_token(&super::token_hash(token))
        .await
        .map_err(|error| unavailable(format!("boot token lookup failed: {error}")))?
        .ok_or(BootError::Unauthorized)?;

    let kek = state
        .config
        .accounts
        .account_kek()
        .ok_or_else(|| unavailable("no account key configured"))?;
    let agent_hex = hex::encode(&row.agent_pubkey);
    let nsec = crate::api::accounts::crypto::open_nsec(
        kek,
        &agent_hex,
        &row.kek_id,
        &row.wrapped_dek,
        &row.sealed_nsec,
        &row.nonce,
    )
    .map_err(|error| unavailable(format!("agent key could not be opened: {error}")))?;
    let snapshot = serde_json::from_value::<CloudConfigSnapshot>(row.config.clone())
        .map_err(|error| unavailable(format!("stored config is invalid: {error}")))?;
    let model = row
        .cloud_model
        .clone()
        .or_else(|| state.config.cloud_agents.default_model.clone())
        .ok_or_else(|| unavailable("no cloud model is configured"))?;

    let host = state
        .db
        .lookup_community_host(row.community)
        .await
        .map_err(|error| unavailable(format!("community lookup failed: {error}")))?
        .ok_or_else(|| unavailable("community no longer exists"))?;
    let tenant = TenantContext::resolved(row.community, host);
    let relay_url = crate::api::bridge::nip42_expected_relay_url(&state.config.relay_url, &tenant);

    // The home token is what lets this machine, and only this machine,
    // authenticate as the agent. It dies with the next placement change.
    let home_token = Zeroizing::new(hex::encode(rand::random::<[u8; 32]>()));
    let stored = state
        .db
        .set_cloud_home_token(
            row.community,
            &row.agent_pubkey,
            row.generation,
            &super::token_hash(&home_token),
        )
        .await
        .map_err(|error| unavailable(format!("home token not stored: {error}")))?;
    if !stored {
        return Err(BootError::Unauthorized);
    }

    let owner_hex = hex::encode(&row.owner_pubkey);
    let free_until = state
        .db
        .cloud_free_route_until(row.community, &row.agent_pubkey)
        .await
        .map_err(|error| unavailable(format!("route lookup failed: {error}")))?;
    let route = pick_route(&model, free_until, chrono::Utc::now());
    // OpenCode's free model needs no gateway session. The OpenRouter free route
    // gets one that can never choose a paid model; a paid model gets the
    // owner's full cloud session.
    let session = match route {
        Route::OpenCodeFree => None,
        Route::OpenrouterFree => Some(
            crate::api::credits_gateway::mint_cloud_free_session(
                state,
                row.community,
                &row.agent_pubkey,
                row.generation,
            )
            .await
            .map_err(|error| unavailable(format!("AI session not opened: {error}")))?
            .id,
        ),
        Route::Gateway => Some(
            crate::api::credits_gateway::mint_cloud_session(
                state,
                row.community,
                &row.agent_pubkey,
                row.generation,
            )
            .await
            .map_err(|error| unavailable(format!("AI session not opened: {error}")))?
            .id,
        ),
    };

    Ok(build_env(&EnvInputs {
        nsec: &nsec,
        relay_url: &relay_url,
        row: &row,
        snapshot: &snapshot,
        home_token: &home_token,
        route,
        session,
        model: &model,
        owner_hex: &owner_hex,
    }))
}

/// Everything [`build_env`] maps into the machine environment.
pub struct EnvInputs<'a> {
    /// The agent's secret key, `nsec1...`.
    pub nsec: &'a str,
    /// The community's relay URL as the AUTH event must name it.
    pub relay_url: &'a str,
    /// The stored agent.
    pub row: &'a CloudAgentRow,
    /// The runnable config snapshot.
    pub snapshot: &'a CloudConfigSnapshot,
    /// The home token the machine presents when it authenticates.
    pub home_token: &'a str,
    /// How the machine reaches its AI.
    pub route: Route,
    /// The credits session the machine pays with. `None` on the OpenCode free
    /// route, which has no gateway session.
    pub session: Option<Uuid>,
    /// The model the machine asks for (the cloud model value; the free routes
    /// name their own models).
    pub model: &'a str,
    /// The owner's public key, hex.
    pub owner_hex: &'a str,
}

fn put(env: &mut BTreeMap<String, Zeroizing<String>>, key: &str, value: impl Into<String>) {
    env.insert(key.to_owned(), Zeroizing::new(value.into()));
}

/// Maps the agent, its snapshot and its credits session to the environment the
/// harness expects: the same names the desktop sets when it starts a local
/// agent, plus the cloud-only ones. The snapshot's own `envVars` go in first
/// (minus any secret-looking name) so nothing the owner configured can shadow a
/// value the relay sets.
pub fn build_env(inputs: &EnvInputs<'_>) -> BTreeMap<String, Zeroizing<String>> {
    let snapshot = inputs.snapshot;
    let mut env = BTreeMap::new();
    for (name, value) in &snapshot.env_vars {
        if !is_secret_env_name(name) {
            put(&mut env, name, value.clone());
        }
    }

    put(&mut env, "BUZZ_PRIVATE_KEY", inputs.nsec);
    put(&mut env, "NOSTR_PRIVATE_KEY", inputs.nsec);
    put(&mut env, "BUZZ_RELAY_URL", inputs.relay_url);
    if let Some(tag) = &inputs.row.auth_tag {
        put(&mut env, "BUZZ_AUTH_TAG", tag.clone());
    } else {
        // Without a delegation tag the harness learns its owner from here.
        put(&mut env, "BUZZ_ACP_AGENT_OWNER", inputs.owner_hex);
    }

    put(&mut env, "COLONY_HOME", "cloud");
    put(
        &mut env,
        "COLONY_PLACEMENT_GENERATION",
        inputs.row.generation.to_string(),
    );
    put(&mut env, "COLONY_CLOUD_HOME_TOKEN", inputs.home_token);

    if let Some(value) = inputs.route.env_value() {
        put(&mut env, "COLONY_CLOUD_ROUTE", value);
    }
    match (inputs.route, inputs.session) {
        (Route::OpenCodeFree, _) => {
            // OpenCode's free model, run inside the machine as an ACP agent. Its
            // state lives under the volume's home so it survives sleep. No
            // gateway session, no provider key: nothing here can spend credit.
            put(&mut env, "BUZZ_ACP_AGENT_COMMAND", "opencode");
            put(&mut env, "BUZZ_ACP_AGENT_ARGS", "acp");
            put(&mut env, "BUZZ_ACP_MODEL", OPENCODE_FREE_MODEL);
            put(
                &mut env,
                "OPENCODE_CONFIG_CONTENT",
                serde_json::json!({
                    "autoupdate": false,
                    "share": "disabled",
                    "model": OPENCODE_FREE_MODEL,
                })
                .to_string(),
            );
            put(
                &mut env,
                "XDG_DATA_HOME",
                format!("{DATA_DIR}/home/.local/share"),
            );
        }
        (route, Some(session)) => {
            put(&mut env, "COLONY_CREDITS_GATEWAY", "1");
            put(&mut env, "COLONY_CREDITS_SESSION_ID", session.to_string());
            put(&mut env, "BUZZ_AGENT_PROVIDER", "colony-credits");
            put(&mut env, "LLM_PROVIDER", "colony-credits");
            // The free route names no model: the gateway answers a request with
            // no model from its free chain. Only a paid model is named.
            if route == Route::Gateway {
                put(&mut env, "COLONY_CREDITS_MODEL", inputs.model);
                put(&mut env, "BUZZ_AGENT_MODEL", inputs.model);
                put(&mut env, "BUZZ_ACP_MODEL", inputs.model);
            }
            put(&mut env, "BUZZ_ACP_AGENT_COMMAND", "buzz-agent");
        }
        (_, None) => {
            // `redeem` always opens a session for a gateway route. Without one
            // the machine gets no AI settings and fails to start, which is
            // better than silently picking another route.
            tracing::error!("a gateway route was built without a session");
        }
    }
    put(
        &mut env,
        "BUZZ_ACP_EXIT_AFTER_INACTIVITY",
        IDLE_EXIT_SECS.to_string(),
    );
    // The harness reads COLONY_WAKE_LEDGER; BUZZ_ACP_WAKE_LEDGER is the name the
    // plan's contract lists, so both are set to the same file on the volume.
    let ledger = format!("{DATA_DIR}/ledger.json");
    put(&mut env, "COLONY_WAKE_LEDGER", ledger.clone());
    put(&mut env, "BUZZ_ACP_WAKE_LEDGER", ledger);
    put(&mut env, "HOME", format!("{DATA_DIR}/home"));

    put(&mut env, "BUZZ_ACP_SESSION_TITLE", snapshot.name.clone());
    put(&mut env, "BUZZ_ACP_DISPLAY_NAME", snapshot.name.clone());
    if let Some(prompt) = snapshot.system_prompt.as_deref().filter(|p| !p.is_empty()) {
        put(&mut env, "BUZZ_ACP_SYSTEM_PROMPT", prompt);
    }
    if let Some(team) = snapshot
        .team_instructions
        .as_deref()
        .filter(|t| !t.is_empty())
    {
        put(&mut env, "BUZZ_ACP_TEAM_INSTRUCTIONS", team);
    }
    put(&mut env, "BUZZ_ACP_RESPOND_TO", snapshot.respond_to.clone());
    if snapshot.respond_to == "allowlist" {
        put(
            &mut env,
            "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
            snapshot.respond_to_allowlist.join(","),
        );
    }
    put(
        &mut env,
        "BUZZ_ACP_AGENTS",
        snapshot.parallelism.to_string(),
    );
    if let Some(idle) = snapshot.idle_timeout_seconds {
        put(&mut env, "BUZZ_ACP_IDLE_TIMEOUT", idle.to_string());
    }
    if let Some(max) = snapshot.max_turn_duration_seconds {
        put(&mut env, "BUZZ_ACP_MAX_TURN_DURATION", max.to_string());
    }
    put(
        &mut env,
        "BUZZ_ACP_SUBSCRIBE",
        snapshot.subscribe_mode.clone(),
    );
    put(&mut env, "BUZZ_ACP_MULTIPLE_EVENT_HANDLING", "steer");
    put(&mut env, "BUZZ_ACP_DEDUP", "queue");
    put(&mut env, "BUZZ_ACP_RELAY_OBSERVER", "true");
    env
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use buzz_core::agent_placement::{Home, PlacementStatus};

    use super::*;

    const SECRET_NSEC: &str = "nsec1agentsecretagentsecretagentsecretagentsecretagentsecret";

    fn row(auth_tag: Option<&str>) -> CloudAgentRow {
        let now = chrono::Utc::now();
        CloudAgentRow {
            community: CommunityId::from_uuid(Uuid::nil()),
            agent_pubkey: vec![0xaa; 32],
            owner_pubkey: vec![0xbb; 32],
            home: Home::Cloud,
            generation: 4,
            cloud_model: None,
            status: Some(PlacementStatus::Waking),
            wrapped_dek: vec![1; 28],
            sealed_nsec: vec![2; 48],
            nonce: vec![3; 12],
            kek_id: "k".to_string(),
            auth_tag: auth_tag.map(str::to_owned),
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

    fn snapshot() -> CloudConfigSnapshot {
        CloudConfigSnapshot {
            name: "Scout".to_string(),
            system_prompt: Some("Be brief.".to_string()),
            team_instructions: None,
            respond_to: "owner-only".to_string(),
            respond_to_allowlist: Vec::new(),
            parallelism: 2,
            idle_timeout_seconds: None,
            max_turn_duration_seconds: Some(900),
            subscribe_mode: "mentions".to_string(),
            env_vars: BTreeMap::new(),
            effort_level: None,
        }
    }

    fn env_for(
        row: &CloudAgentRow,
        snapshot: &CloudConfigSnapshot,
    ) -> BTreeMap<String, Zeroizing<String>> {
        env_on(
            row,
            snapshot,
            Route::Gateway,
            Some(Uuid::nil()),
            "deepseek/deepseek-v4.1-flash",
        )
    }

    fn env_on(
        row: &CloudAgentRow,
        snapshot: &CloudConfigSnapshot,
        route: Route,
        session: Option<Uuid>,
        model: &str,
    ) -> BTreeMap<String, Zeroizing<String>> {
        build_env(&EnvInputs {
            nsec: SECRET_NSEC,
            relay_url: "wss://acme.example",
            row,
            snapshot,
            home_token: "home-token-value",
            route,
            session,
            model,
            owner_hex: &"bb".repeat(32),
        })
    }

    fn keys_of(env: &BTreeMap<String, Zeroizing<String>>) -> BTreeSet<&str> {
        env.keys().map(String::as_str).collect()
    }

    const FORBIDDEN_EVERYWHERE: [&str; 9] = [
        "OPENROUTER_MASTER_KEY",
        "OPENROUTER_API_KEY",
        "COLONY_ACCOUNT_KEK",
        "PAYFAST_MERCHANT_KEY",
        "PAYFAST_PASSPHRASE",
        "STRIPE_SECRET_KEY",
        "BUZZ_ACP_PRIVATE_KEY",
        "BUZZ_ACP_API_TOKEN",
        "ANTHROPIC_API_KEY",
    ];

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc::now()
    }

    #[test]
    fn colony_free_starts_on_opencode_and_a_live_switch_moves_it_to_openrouter() {
        let later = now() + chrono::Duration::hours(5);
        let earlier = now() - chrono::Duration::minutes(1);
        assert_eq!(pick_route("colony-free", None, now()), Route::OpenCodeFree);
        assert_eq!(
            pick_route("colony-free", Some(later), now()),
            Route::OpenrouterFree
        );
        assert_eq!(
            pick_route("colony-free", Some(earlier), now()),
            Route::OpenCodeFree,
            "an expired switch means OpenCode again"
        );
        // A paid model ignores the free route entirely.
        assert_eq!(
            pick_route("deepseek/deepseek-v4.1-flash", Some(later), now()),
            Route::Gateway
        );
    }

    /// The OpenCode route: `opencode acp`, the free model forced, state on the
    /// volume, and no gateway session or provider variable at all.
    #[test]
    fn colony_free_boots_opencode_without_a_gateway_session() {
        let env = env_on(
            &row(None),
            &snapshot(),
            Route::OpenCodeFree,
            None,
            "colony-free",
        );
        assert_eq!(env["BUZZ_ACP_AGENT_COMMAND"].as_str(), "opencode");
        assert_eq!(env["BUZZ_ACP_AGENT_ARGS"].as_str(), "acp");
        assert_eq!(
            env["BUZZ_ACP_MODEL"].as_str(),
            "opencode/deepseek-v4.1-flash-free"
        );
        assert_eq!(env["COLONY_CLOUD_ROUTE"].as_str(), "openCodeFree");
        let config: serde_json::Value =
            serde_json::from_str(env["OPENCODE_CONFIG_CONTENT"].as_str()).expect("json");
        assert_eq!(config["model"], "opencode/deepseek-v4.1-flash-free");
        assert_eq!(config["share"], "disabled");
        assert_eq!(config["autoupdate"], false);
        assert_eq!(env["XDG_DATA_HOME"].as_str(), "/data/home/.local/share");
        assert_eq!(env["HOME"].as_str(), "/data/home");
        for gateway_name in [
            "COLONY_CREDITS_GATEWAY",
            "COLONY_CREDITS_SESSION_ID",
            "COLONY_CREDITS_MODEL",
            "BUZZ_AGENT_PROVIDER",
            "BUZZ_AGENT_MODEL",
            "LLM_PROVIDER",
        ] {
            assert!(
                !env.contains_key(gateway_name),
                "{gateway_name} has no place on the OpenCode route"
            );
        }
        for forbidden in FORBIDDEN_EVERYWHERE {
            assert!(!env.contains_key(forbidden), "{forbidden}");
        }
        // Nothing beyond the paid route's list, except what OpenCode needs.
        let paid = env_for(&row(None), &snapshot());
        let extra: BTreeSet<&str> = keys_of(&env).difference(&keys_of(&paid)).copied().collect();
        let allowed: BTreeSet<&str> = [
            "COLONY_CLOUD_ROUTE",
            "BUZZ_ACP_AGENT_ARGS",
            "OPENCODE_CONFIG_CONTENT",
            "XDG_DATA_HOME",
        ]
        .into_iter()
        .collect();
        assert_eq!(extra, allowed);
    }

    /// The OpenRouter free route: buzz-agent on the gateway, naming no model so
    /// the gateway answers from its free chain.
    #[test]
    fn the_openrouter_free_route_names_no_model_and_uses_the_gateway() {
        let session = Uuid::from_u128(7);
        let env = env_on(
            &row(None),
            &snapshot(),
            Route::OpenrouterFree,
            Some(session),
            "colony-free",
        );
        assert_eq!(env["BUZZ_ACP_AGENT_COMMAND"].as_str(), "buzz-agent");
        assert_eq!(env["COLONY_CREDITS_GATEWAY"].as_str(), "1");
        assert_eq!(
            env["COLONY_CREDITS_SESSION_ID"].as_str(),
            session.to_string()
        );
        assert_eq!(env["BUZZ_AGENT_PROVIDER"].as_str(), "colony-credits");
        assert_eq!(env["COLONY_CLOUD_ROUTE"].as_str(), "openrouterFree");
        for model_name in ["COLONY_CREDITS_MODEL", "BUZZ_AGENT_MODEL", "BUZZ_ACP_MODEL"] {
            assert!(
                !env.contains_key(model_name),
                "{model_name}: `colony-free` is not a gateway model"
            );
        }
        assert!(!env.contains_key("OPENCODE_CONFIG_CONTENT"));
        for forbidden in FORBIDDEN_EVERYWHERE {
            assert!(!env.contains_key(forbidden), "{forbidden}");
        }
    }

    /// The paid route is untouched and carries no route variable.
    #[test]
    fn the_paid_route_is_unchanged() {
        let env = env_for(&row(None), &snapshot());
        assert!(!env.contains_key("COLONY_CLOUD_ROUTE"));
        assert_eq!(env["BUZZ_ACP_AGENT_COMMAND"].as_str(), "buzz-agent");
        assert_eq!(
            env["COLONY_CREDITS_MODEL"].as_str(),
            "deepseek/deepseek-v4.1-flash"
        );
    }

    /// The contract: exactly these names reach a machine, and none of them is
    /// an owner key, a master key or a payment secret.
    #[test]
    fn boot_env_has_no_owner_or_master_secrets() {
        let env = env_for(&row(None), &snapshot());
        let keys: BTreeSet<&str> = env.keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> = [
            // Identity and relay.
            "BUZZ_PRIVATE_KEY",
            "NOSTR_PRIVATE_KEY",
            "BUZZ_RELAY_URL",
            "BUZZ_ACP_AGENT_OWNER",
            // Placement and the home fence.
            "COLONY_HOME",
            "COLONY_PLACEMENT_GENERATION",
            "COLONY_CLOUD_HOME_TOKEN",
            // Credits session and model.
            "COLONY_CREDITS_GATEWAY",
            "COLONY_CREDITS_SESSION_ID",
            "COLONY_CREDITS_MODEL",
            "BUZZ_AGENT_PROVIDER",
            "LLM_PROVIDER",
            "BUZZ_AGENT_MODEL",
            "BUZZ_ACP_MODEL",
            // Harness.
            "BUZZ_ACP_AGENT_COMMAND",
            "BUZZ_ACP_EXIT_AFTER_INACTIVITY",
            "COLONY_WAKE_LEDGER",
            "BUZZ_ACP_WAKE_LEDGER",
            "HOME",
            // From the snapshot.
            "BUZZ_ACP_SESSION_TITLE",
            "BUZZ_ACP_DISPLAY_NAME",
            "BUZZ_ACP_SYSTEM_PROMPT",
            "BUZZ_ACP_RESPOND_TO",
            "BUZZ_ACP_AGENTS",
            "BUZZ_ACP_MAX_TURN_DURATION",
            "BUZZ_ACP_SUBSCRIBE",
            "BUZZ_ACP_MULTIPLE_EVENT_HANDLING",
            "BUZZ_ACP_DEDUP",
            "BUZZ_ACP_RELAY_OBSERVER",
        ]
        .into_iter()
        .collect();
        assert_eq!(keys, expected);
        for forbidden in [
            "OPENROUTER_MASTER_KEY",
            "OPENROUTER_API_KEY",
            "COLONY_ACCOUNT_KEK",
            "PAYFAST_MERCHANT_KEY",
            "PAYFAST_PASSPHRASE",
            "STRIPE_SECRET_KEY",
            "BUZZ_ACP_PRIVATE_KEY",
            "BUZZ_ACP_API_TOKEN",
            "ANTHROPIC_API_KEY",
        ] {
            assert!(
                !env.contains_key(forbidden),
                "{forbidden} must never reach a machine"
            );
        }
        assert_eq!(env["BUZZ_PRIVATE_KEY"].as_str(), SECRET_NSEC);
        assert_eq!(env["COLONY_HOME"].as_str(), "cloud");
        assert_eq!(env["COLONY_PLACEMENT_GENERATION"].as_str(), "4");
        assert_eq!(env["BUZZ_ACP_EXIT_AFTER_INACTIVITY"].as_str(), "600");
        assert_eq!(env["BUZZ_AGENT_PROVIDER"].as_str(), "colony-credits");
    }

    #[test]
    fn a_delegation_tag_replaces_the_owner_variable() {
        let env = env_for(&row(Some(r#"["auth","a","b","c"]"#)), &snapshot());
        assert!(env.contains_key("BUZZ_AUTH_TAG"));
        assert!(!env.contains_key("BUZZ_ACP_AGENT_OWNER"));
    }

    #[test]
    fn the_snapshots_own_env_never_shadows_what_the_relay_sets() {
        let mut snapshot = snapshot();
        for (name, value) in [
            ("BUZZ_PRIVATE_KEY", "attacker"),
            ("COLONY_HOME", "mac"),
            ("BUZZ_ACP_MODEL", "other/model"),
            ("HOME", "/root"),
            ("LOG_LEVEL", "debug"),
            ("SOME_API_KEY", "should-be-dropped"),
        ] {
            snapshot.env_vars.insert(name.to_owned(), value.to_owned());
        }
        let env = env_for(&row(None), &snapshot);
        assert_eq!(env["BUZZ_PRIVATE_KEY"].as_str(), SECRET_NSEC);
        assert_eq!(env["COLONY_HOME"].as_str(), "cloud");
        assert_eq!(
            env["BUZZ_ACP_MODEL"].as_str(),
            "deepseek/deepseek-v4.1-flash"
        );
        assert_eq!(env["HOME"].as_str(), "/data/home");
        assert_eq!(
            env["LOG_LEVEL"].as_str(),
            "debug",
            "ordinary env passes through"
        );
        assert!(
            !env.contains_key("SOME_API_KEY"),
            "secret-looking names are dropped"
        );
    }

    #[test]
    fn the_allowlist_only_travels_when_the_mode_is_allowlist() {
        let mut snapshot = snapshot();
        snapshot.respond_to = "allowlist".to_owned();
        snapshot.respond_to_allowlist = vec!["cc".repeat(32), "dd".repeat(32)];
        let env = env_for(&row(None), &snapshot);
        assert_eq!(
            env["BUZZ_ACP_RESPOND_TO_ALLOWLIST"].as_str(),
            format!("{},{}", "cc".repeat(32), "dd".repeat(32))
        );
        let owner_only = env_for(&row(None), &self::snapshot());
        assert!(!owner_only.contains_key("BUZZ_ACP_RESPOND_TO_ALLOWLIST"));
    }
}
