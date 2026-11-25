//! Agent placement: where a managed agent works, "This Mac" or "Cloud".
//!
//! The owner flips an agent between homes with one signed command
//! ([`PlacementAction`], kind `KIND_AGENT_PLACEMENT_ACTION`). The relay checks
//! the command, bumps the placement generation and publishes a relay-signed
//! [`PlacementHead`] (kind `KIND_AGENT_PLACEMENT_HEAD`, `d` = the agent's pubkey
//! hex). Absence of a head means the agent works on the Mac at generation 0.
//!
//! The generation is the fence: a cloud machine started for generation `N`
//! exits when it sees a newer generation, and the relay refuses agent
//! authentication that does not match the current home.
//!
//! A cloud machine boots from a [`CloudConfigSnapshot`], the runnable part of
//! the Mac's agent record. It never carries provider keys or other secrets.
//!
//! This module owns wire types and pure validation. Authorization, storage and
//! the Fly lifecycle live in `buzz-relay` and `buzz-db`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::company_records::is_hex_id;

/// Wire schema version of placement actions, heads and snapshots.
pub const PLACEMENT_SCHEMA_VERSION: u32 = 1;
/// Longest cloud model identifier, in characters.
pub const MAX_CLOUD_MODEL_CHARS: usize = 120;
/// Longest agent display name in a snapshot, in characters.
pub const MAX_SNAPSHOT_NAME_CHARS: usize = 120;
/// Longest system prompt or team instructions in a snapshot, in bytes.
pub const MAX_SNAPSHOT_TEXT_BYTES: usize = 64 * 1024;
/// Most allowlist entries a snapshot may carry.
pub const MAX_SNAPSHOT_ALLOWLIST: usize = 256;
/// Most environment variables a snapshot may carry.
pub const MAX_SNAPSHOT_ENV_VARS: usize = 64;
/// Longest environment variable name in a snapshot, in bytes.
pub const MAX_SNAPSHOT_ENV_NAME_BYTES: usize = 128;
/// Longest environment variable value in a snapshot, in bytes.
pub const MAX_SNAPSHOT_ENV_VALUE_BYTES: usize = 8 * 1024;
/// Largest `parallelism` a snapshot may ask for.
pub const MAX_SNAPSHOT_PARALLELISM: u32 = 64;
/// Largest idle or turn timeout a snapshot may ask for, in seconds (24 hours).
pub const MAX_SNAPSHOT_TIMEOUT_SECS: u64 = 86_400;
/// Longest effort level string in a snapshot, in characters.
pub const MAX_SNAPSHOT_EFFORT_CHARS: usize = 32;

/// Accepted `respond_to` values, the same strings `buzz-acp --respond-to` takes.
pub const SNAPSHOT_RESPOND_TO_VALUES: &[&str] = &["owner-only", "allowlist", "anyone"];
/// Accepted `subscribe_mode` values, the same strings `buzz-acp --subscribe` takes.
pub const SNAPSHOT_SUBSCRIBE_MODES: &[&str] = &["mentions", "all", "config"];

/// Where an agent works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Home {
    /// A harness on the owner's computer.
    Mac,
    /// A harness on the agent's own cloud machine.
    Cloud,
}

/// What a placement command asks the relay to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlacementOp {
    /// Move the agent to the home named in `home`.
    SetHome,
    /// Start the cloud machine again after a failed wake.
    RetryWake,
    /// Change the cloud model named in `cloud_model`.
    SetCloudModel,
}

/// Cloud machine state the interface shows. `None` on a head means `home` is `mac`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlacementStatus {
    /// The machine is stopped; it wakes when a message arrives.
    Asleep,
    /// The machine is starting.
    Waking,
    /// The harness is connected and working.
    Working,
    /// The machine could not start.
    Failed,
    /// The agent's owner has no AI credit left.
    OutOfCredit,
    /// The relay has no key and config bundle for the agent yet.
    NotCloudReady,
}

/// An owner-signed placement command, the content of a
/// `KIND_AGENT_PLACEMENT_ACTION` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlacementAction {
    /// Wire schema version, [`PLACEMENT_SCHEMA_VERSION`].
    pub schema: u32,
    /// Agent pubkey, 64 lowercase hex characters.
    pub agent: String,
    /// What to do.
    pub op: PlacementOp,
    /// Target home, required for [`PlacementOp::SetHome`]; ignored otherwise.
    #[serde(default)]
    pub home: Option<Home>,
    /// Generation the sender saw. The relay rejects a mismatch with
    /// `generation_conflict` (compare and swap).
    pub expected_generation: u64,
    /// Model for [`PlacementOp::SetCloudModel`]; ignored otherwise.
    #[serde(default)]
    pub cloud_model: Option<String>,
}

/// The relay-signed placement state of one agent, the content of a
/// `KIND_AGENT_PLACEMENT_HEAD` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlacementHead {
    /// Wire schema version, [`PLACEMENT_SCHEMA_VERSION`].
    pub schema: u32,
    /// Agent pubkey, 64 lowercase hex characters.
    pub agent: String,
    /// Owner pubkey, 64 lowercase hex characters.
    pub owner: String,
    /// Current home.
    pub home: Home,
    /// Monotonic placement generation. Starts at 0 (no head) and grows on every
    /// home change.
    pub generation: u64,
    /// `true` once the relay holds the agent's key and config bundle.
    pub cloud_ready: bool,
    /// Version of the stored config snapshot.
    pub config_version: u64,
    /// Cloud model, when one is set.
    pub cloud_model: Option<String>,
    /// Cloud machine state; `None` when `home` is `mac`.
    pub status: Option<PlacementStatus>,
    /// Time of the last change, in Unix seconds.
    pub updated_at: i64,
}

/// The runnable part of a Mac agent record that a cloud machine boots from.
///
/// Paid-provider keys and Mac-only paths are never part of it: the desktop
/// strips secret environment names and the relay rejects them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CloudConfigSnapshot {
    /// Display name.
    pub name: String,
    /// System prompt, when the agent has one.
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// Instructions inherited from the agent's team.
    #[serde(default)]
    pub team_instructions: Option<String>,
    /// Who the agent answers: `owner-only`, `allowlist` or `anyone`.
    pub respond_to: String,
    /// Pubkeys the agent also answers when `respond_to` is `allowlist`.
    #[serde(default)]
    pub respond_to_allowlist: Vec<String>,
    /// Turns the harness may run at once.
    pub parallelism: u32,
    /// Idle timeout in seconds, when set.
    #[serde(default)]
    pub idle_timeout_seconds: Option<u64>,
    /// Longest a single turn may run, in seconds, when set.
    #[serde(default)]
    pub max_turn_duration_seconds: Option<u64>,
    /// What the harness subscribes to: `mentions`, `all` or `config`.
    pub subscribe_mode: String,
    /// Extra environment variables for the harness, with secret names removed.
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    /// Reasoning effort level, when set.
    #[serde(default)]
    pub effort_level: Option<String>,
}

/// Why a placement action or config snapshot was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlacementError {
    /// `schema` is not [`PLACEMENT_SCHEMA_VERSION`].
    #[error("unsupported placement schema {0}")]
    UnsupportedSchema(u32),
    /// A pubkey field is not 64 lowercase hex characters.
    #[error("{0} must be 64 lowercase hex characters")]
    InvalidPubkey(&'static str),
    /// `setHome` without `home`.
    #[error("setHome requires home")]
    MissingHome,
    /// `setCloudModel` without `cloudModel`.
    #[error("setCloudModel requires cloudModel")]
    MissingCloudModel,
    /// The cloud model identifier is empty, too long or has unsafe characters.
    #[error("invalid cloud model")]
    InvalidCloudModel,
    /// A snapshot field is empty, too long or out of range.
    #[error("invalid snapshot field {0}")]
    InvalidField(&'static str),
    /// A snapshot environment variable name looks like a secret.
    #[error("environment variable {0} looks like a secret and cannot go to the cloud")]
    SecretEnvName(String),
}

/// Returns the `d` tag of an agent's placement head: the agent pubkey in
/// lowercase hex.
pub fn placement_d_tag(agent_hex: &str) -> String {
    agent_hex.to_ascii_lowercase()
}

/// Returns `true` when an environment variable name must never reach a cloud
/// machine: `*_API_KEY`, `*_TOKEN` or `*_SECRET` (case-insensitive), or one of
/// those words on its own.
pub fn is_secret_env_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    ["API_KEY", "TOKEN", "SECRET"]
        .iter()
        .any(|word| upper == *word || upper.ends_with(&format!("_{word}")))
}

/// Checks a placement command before the relay looks at ownership or storage.
pub fn validate_placement_action(action: &PlacementAction) -> Result<(), PlacementError> {
    if action.schema != PLACEMENT_SCHEMA_VERSION {
        return Err(PlacementError::UnsupportedSchema(action.schema));
    }
    if !is_hex_id(&action.agent) {
        return Err(PlacementError::InvalidPubkey("agent"));
    }
    match action.op {
        PlacementOp::SetHome => {
            if action.home.is_none() {
                return Err(PlacementError::MissingHome);
            }
        }
        PlacementOp::RetryWake => {}
        PlacementOp::SetCloudModel => match action.cloud_model.as_deref() {
            None => return Err(PlacementError::MissingCloudModel),
            Some(model) => validate_cloud_model(model)?,
        },
    }
    Ok(())
}

/// Checks a cloud config snapshot before the relay stores it.
pub fn validate_config_snapshot(snapshot: &CloudConfigSnapshot) -> Result<(), PlacementError> {
    let name_chars = snapshot.name.trim().chars().count();
    if name_chars == 0 || name_chars > MAX_SNAPSHOT_NAME_CHARS {
        return Err(PlacementError::InvalidField("name"));
    }
    check_text("systemPrompt", snapshot.system_prompt.as_deref())?;
    check_text("teamInstructions", snapshot.team_instructions.as_deref())?;
    if !SNAPSHOT_RESPOND_TO_VALUES.contains(&snapshot.respond_to.as_str()) {
        return Err(PlacementError::InvalidField("respondTo"));
    }
    if snapshot.respond_to_allowlist.len() > MAX_SNAPSHOT_ALLOWLIST
        || !snapshot.respond_to_allowlist.iter().all(|k| is_hex_id(k))
    {
        return Err(PlacementError::InvalidField("respondToAllowlist"));
    }
    if snapshot.parallelism == 0 || snapshot.parallelism > MAX_SNAPSHOT_PARALLELISM {
        return Err(PlacementError::InvalidField("parallelism"));
    }
    check_timeout("idleTimeoutSeconds", snapshot.idle_timeout_seconds)?;
    check_timeout("maxTurnDurationSeconds", snapshot.max_turn_duration_seconds)?;
    if !SNAPSHOT_SUBSCRIBE_MODES.contains(&snapshot.subscribe_mode.as_str()) {
        return Err(PlacementError::InvalidField("subscribeMode"));
    }
    if let Some(effort) = snapshot.effort_level.as_deref() {
        if effort.is_empty() || effort.chars().count() > MAX_SNAPSHOT_EFFORT_CHARS {
            return Err(PlacementError::InvalidField("effortLevel"));
        }
    }
    check_env_vars(&snapshot.env_vars)
}

/// Checks a cloud model identifier such as `deepseek/deepseek-v4.1-flash`.
/// Whether the model is allowlisted is the relay's decision.
fn validate_cloud_model(model: &str) -> Result<(), PlacementError> {
    let chars = model.chars().count();
    let safe = model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_' | ':'));
    if chars == 0 || chars > MAX_CLOUD_MODEL_CHARS || !safe {
        return Err(PlacementError::InvalidCloudModel);
    }
    Ok(())
}

fn check_text(field: &'static str, value: Option<&str>) -> Result<(), PlacementError> {
    match value {
        Some(text) if text.len() > MAX_SNAPSHOT_TEXT_BYTES => {
            Err(PlacementError::InvalidField(field))
        }
        _ => Ok(()),
    }
}

fn check_timeout(field: &'static str, value: Option<u64>) -> Result<(), PlacementError> {
    match value {
        Some(secs) if secs == 0 || secs > MAX_SNAPSHOT_TIMEOUT_SECS => {
            Err(PlacementError::InvalidField(field))
        }
        _ => Ok(()),
    }
}

fn check_env_vars(env_vars: &BTreeMap<String, String>) -> Result<(), PlacementError> {
    if env_vars.len() > MAX_SNAPSHOT_ENV_VARS {
        return Err(PlacementError::InvalidField("envVars"));
    }
    for (name, value) in env_vars {
        let mut bytes = name.bytes();
        let first_ok = bytes
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_');
        let rest_ok = bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_');
        if !first_ok || !rest_ok || name.len() > MAX_SNAPSHOT_ENV_NAME_BYTES {
            return Err(PlacementError::InvalidField("envVars"));
        }
        if is_secret_env_name(name) {
            return Err(PlacementError::SecretEnvName(name.clone()));
        }
        if value.len() > MAX_SNAPSHOT_ENV_VALUE_BYTES {
            return Err(PlacementError::InvalidField("envVars"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGENT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OWNER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn action(op: PlacementOp) -> PlacementAction {
        PlacementAction {
            schema: 1,
            agent: AGENT.to_string(),
            op,
            home: None,
            expected_generation: 3,
            cloud_model: None,
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

    #[test]
    fn set_home_requires_home() {
        let mut a = action(PlacementOp::SetHome);
        assert_eq!(
            validate_placement_action(&a),
            Err(PlacementError::MissingHome)
        );
        a.home = Some(Home::Cloud);
        assert_eq!(validate_placement_action(&a), Ok(()));
    }

    #[test]
    fn set_cloud_model_requires_model() {
        let mut a = action(PlacementOp::SetCloudModel);
        assert_eq!(
            validate_placement_action(&a),
            Err(PlacementError::MissingCloudModel)
        );
        a.cloud_model = Some("deepseek/deepseek-v4.1-flash".to_string());
        assert_eq!(validate_placement_action(&a), Ok(()));
        a.cloud_model = Some("bad model\n".to_string());
        assert_eq!(
            validate_placement_action(&a),
            Err(PlacementError::InvalidCloudModel)
        );
        a.cloud_model = Some(String::new());
        assert_eq!(
            validate_placement_action(&a),
            Err(PlacementError::InvalidCloudModel)
        );
    }

    #[test]
    fn retry_wake_needs_no_extra_fields() {
        assert_eq!(
            validate_placement_action(&action(PlacementOp::RetryWake)),
            Ok(())
        );
    }

    #[test]
    fn rejects_unknown_schema() {
        let mut a = action(PlacementOp::RetryWake);
        a.schema = 2;
        assert_eq!(
            validate_placement_action(&a),
            Err(PlacementError::UnsupportedSchema(2))
        );
    }

    #[test]
    fn rejects_bad_agent_pubkey() {
        let bad_agents: Vec<String> = vec![
            String::new(),
            "abc".to_string(),
            AGENT.to_ascii_uppercase(),
            format!("{AGENT}0"),
        ];
        for bad in bad_agents {
            let mut a = action(PlacementOp::RetryWake);
            a.agent = bad.clone();
            assert_eq!(
                validate_placement_action(&a),
                Err(PlacementError::InvalidPubkey("agent")),
                "agent {bad:?}"
            );
        }
    }

    #[test]
    fn action_parses_contract_json_and_refuses_unknown_fields() {
        let json = format!(
            r#"{{"schema":1,"agent":"{AGENT}","op":"setHome","home":"cloud","expectedGeneration":3,"cloudModel":null}}"#
        );
        let parsed: PlacementAction = serde_json::from_str(&json).expect("contract json");
        assert_eq!(parsed.op, PlacementOp::SetHome);
        assert_eq!(parsed.home, Some(Home::Cloud));
        assert_eq!(parsed.expected_generation, 3);
        assert_eq!(parsed.cloud_model, None);

        let extra = format!(
            r#"{{"schema":1,"agent":"{AGENT}","op":"retryWake","expectedGeneration":0,"surprise":1}}"#
        );
        assert!(serde_json::from_str::<PlacementAction>(&extra).is_err());
    }

    #[test]
    fn head_round_trips_camel_case() {
        let json = format!(
            r#"{{"schema":1,"agent":"{AGENT}","owner":"{OWNER}","home":"cloud","generation":4,"cloudReady":true,"configVersion":7,"cloudModel":"deepseek/deepseek-v4.1-flash","status":"asleep","updatedAt":1764072000}}"#
        );
        let head: PlacementHead = serde_json::from_str(&json).expect("contract json");
        assert_eq!(head.home, Home::Cloud);
        assert_eq!(head.generation, 4);
        assert!(head.cloud_ready);
        assert_eq!(head.status, Some(PlacementStatus::Asleep));
        let back = serde_json::to_value(&head).expect("serialize");
        let original: serde_json::Value = serde_json::from_str(&json).expect("value");
        assert_eq!(back, original);
        let again: PlacementHead = serde_json::from_value(back).expect("parse back");
        assert_eq!(again, head);
    }

    #[test]
    fn mac_head_serializes_null_status() {
        let head = PlacementHead {
            schema: 1,
            agent: AGENT.to_string(),
            owner: OWNER.to_string(),
            home: Home::Mac,
            generation: 5,
            cloud_ready: false,
            config_version: 0,
            cloud_model: None,
            status: None,
            updated_at: 1,
        };
        let value = serde_json::to_value(&head).expect("serialize");
        assert_eq!(value["status"], serde_json::Value::Null);
        assert_eq!(value["home"], "mac");
    }

    #[test]
    fn every_status_has_its_contract_name() {
        for (status, name) in [
            (PlacementStatus::Asleep, "asleep"),
            (PlacementStatus::Waking, "waking"),
            (PlacementStatus::Working, "working"),
            (PlacementStatus::Failed, "failed"),
            (PlacementStatus::OutOfCredit, "outOfCredit"),
            (PlacementStatus::NotCloudReady, "notCloudReady"),
        ] {
            assert_eq!(serde_json::to_value(status).expect("serialize"), name);
        }
    }

    #[test]
    fn snapshot_accepts_a_normal_agent() {
        assert_eq!(validate_config_snapshot(&snapshot()), Ok(()));
        let mut s = snapshot();
        s.env_vars
            .insert("LOG_LEVEL".to_string(), "debug".to_string());
        assert_eq!(validate_config_snapshot(&s), Ok(()));
    }

    #[test]
    fn snapshot_rejects_secret_env_names() {
        for name in [
            "OPENROUTER_API_KEY",
            "GITHUB_TOKEN",
            "X_SECRET",
            "openrouter_api_key",
            "TOKEN",
        ] {
            let mut s = snapshot();
            s.env_vars.insert(name.to_string(), "value".to_string());
            assert_eq!(
                validate_config_snapshot(&s),
                Err(PlacementError::SecretEnvName(name.to_string())),
                "name {name}"
            );
        }
    }

    #[test]
    fn secret_name_check_does_not_catch_ordinary_names() {
        for name in ["TOKENIZER_MODE", "SECRETARY", "KEYBOARD", "LOG_LEVEL"] {
            assert!(!is_secret_env_name(name), "name {name}");
        }
    }

    #[test]
    fn snapshot_rejects_out_of_range_fields() {
        let mut s = snapshot();
        s.name = "  ".to_string();
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("name"))
        );
        let mut s = snapshot();
        s.respond_to = "everyone".to_string();
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("respondTo"))
        );
        let mut s = snapshot();
        s.respond_to_allowlist = vec!["nothex".to_string()];
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("respondToAllowlist"))
        );
        let mut s = snapshot();
        s.parallelism = 0;
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("parallelism"))
        );
        let mut s = snapshot();
        s.max_turn_duration_seconds = Some(0);
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("maxTurnDurationSeconds"))
        );
        let mut s = snapshot();
        s.subscribe_mode = "everything".to_string();
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("subscribeMode"))
        );
        let mut s = snapshot();
        s.env_vars.insert("9BAD".to_string(), "x".to_string());
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("envVars"))
        );
        let mut s = snapshot();
        s.system_prompt = Some("x".repeat(MAX_SNAPSHOT_TEXT_BYTES + 1));
        assert_eq!(
            validate_config_snapshot(&s),
            Err(PlacementError::InvalidField("systemPrompt"))
        );
    }

    #[test]
    fn d_tag_is_the_lowercase_agent_pubkey() {
        assert_eq!(placement_d_tag(&AGENT.to_ascii_uppercase()), AGENT);
        assert_eq!(placement_d_tag(AGENT), AGENT);
    }
}
