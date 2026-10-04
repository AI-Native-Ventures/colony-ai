//! Short-lived readiness evidence from a completed runtime turn, independent of discovery caches.
use super::GlobalAgentConfig;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, Instant},
};

struct Proof {
    runtime_id: String,
    config_digest: Vec<u8>,
    auth_digest: Vec<u8>,
    completed: Instant,
}
impl Proof {
    fn matches(&self, runtime_id: &str, env: &BTreeMap<String, String>) -> bool {
        self.runtime_id == runtime_id
            && self.completed.elapsed() < TTL
            && self.auth_digest == auth_digest(env)
    }
}
static PROOF: Mutex<Option<Proof>> = Mutex::new(None);
const TTL: Duration = Duration::from_secs(15 * 60);

fn auth_digest(env: &BTreeMap<String, String>) -> Vec<u8> {
    let relevant = |key: &str| {
        (key.starts_with("ANTHROPIC_")
            || key.starts_with("CLAUDE_")
            || key.starts_with("OPENAI_")
            || key.starts_with("CODEX_"))
            && !key.ends_with("_MODEL")
            && key != "CLAUDE_CODE_EXECUTABLE"
    };
    let mut values: BTreeMap<String, String> =
        std::env::vars().filter(|(k, _)| relevant(k)).collect();
    values.extend(
        env.iter()
            .filter(|(k, _)| relevant(k))
            .map(|(k, v)| (k.clone(), v.clone())),
    );
    let mut digest = Sha256::new();
    for (key, value) in values {
        digest.update(key.as_bytes());
        digest.update([0]);
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    digest.finalize().to_vec()
}
fn config_digest(config: &GlobalAgentConfig) -> Result<Vec<u8>, String> {
    let mut config = config.clone();
    super::global_config::strip_empty_env_vars(&mut config);
    super::global_config::normalize_global_config_fields(&mut config);
    let bytes = serde_json::to_vec(&config)
        .map_err(|_| "Could not record connection readiness.".to_owned())?;
    Ok(Sha256::digest(bytes).to_vec())
}
/// Record only a completed, nonempty real turn. No credentials or reply text are stored here.
pub(crate) fn record(config: &GlobalAgentConfig) -> Result<(), String> {
    let runtime_id = config
        .preferred_runtime
        .clone()
        .ok_or("Missing tested runtime.")?;
    *PROOF
        .lock()
        .map_err(|_| "Connection readiness is unavailable.")? = Some(Proof {
        runtime_id,
        config_digest: config_digest(config)?,
        auth_digest: auth_digest(&config.env_vars),
        completed: Instant::now(),
    });
    Ok(())
}
/// A changed configuration invalidates evidence; saving the tested snapshot preserves it.
pub(crate) fn retain_for_config(config: &GlobalAgentConfig) -> Result<(), String> {
    let digest = config_digest(config)?;
    let mut guard = PROOF
        .lock()
        .map_err(|_| "Connection readiness is unavailable.")?;
    if guard
        .as_ref()
        .is_some_and(|proof| proof.config_digest != digest)
    {
        *guard = None;
    }
    Ok(())
}
/// Preserve resolved adapter paths while a recent real turn remains authoritative.
pub(crate) fn protects_command(command: &str) -> bool {
    PROOF.lock().ok().is_some_and(|guard| {
        guard.as_ref().is_some_and(|proof| {
            proof.completed.elapsed() < TTL
                && super::known_acp_runtime_exact(&proof.runtime_id).is_some_and(|runtime| {
                    runtime.commands.contains(&command) || runtime.underlying_cli == Some(command)
                })
        })
    })
}
/// Discovery can retain recent completed-turn auth evidence across its cache refresh.
pub(crate) fn runtime_recent(runtime_id: &str) -> bool {
    PROOF.lock().ok().is_some_and(|guard| {
        guard
            .as_ref()
            .is_some_and(|proof| proof.runtime_id == runtime_id && proof.completed.elapsed() < TTL)
    })
}
/// Completed-turn evidence can satisfy auth only for the same runtime and transport credentials.
pub(crate) fn ready(runtime_id: &str, env: &BTreeMap<String, String>) -> bool {
    PROOF.lock().ok().is_some_and(|guard| {
        guard
            .as_ref()
            .is_some_and(|proof| proof.matches(runtime_id, env))
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_turn_evidence_is_runtime_credential_config_and_time_bound() {
        let config = GlobalAgentConfig {
            preferred_runtime: Some("claude".into()),
            ..Default::default()
        };
        let mut proof = Proof {
            runtime_id: "claude".into(),
            config_digest: config_digest(&config).expect("digest"),
            auth_digest: auth_digest(&config.env_vars),
            completed: Instant::now(),
        };
        assert!(proof.matches("claude", &config.env_vars));
        assert!(!proof.matches("codex", &config.env_vars));
        let mut changed = config.clone();
        changed
            .env_vars
            .insert("ANTHROPIC_API_KEY".into(), "test-only-placeholder".into());
        assert!(!proof.matches("claude", &changed.env_vars));
        assert_ne!(
            config_digest(&changed).expect("changed"),
            proof.config_digest
        );
        proof.completed = Instant::now() - TTL;
        assert!(!proof.matches("claude", &config.env_vars));
    }
}
