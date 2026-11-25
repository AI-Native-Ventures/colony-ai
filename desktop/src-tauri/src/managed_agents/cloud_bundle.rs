//! Making an agent cloud-ready (spec 5.3): the key and a config snapshot the
//! relay keeps, sealed, so an agent can be woken in the cloud with this Mac
//! closed.
//!
//! The desktop builds a [`CloudConfigSnapshot`] from the agent's record, strips
//! everything that must never leave the Mac, and PUTs it with the agent's key
//! to `/api/cloud-agents/{agent}/bundle`, signed (NIP-98) by the owner. What is
//! stripped: any environment variable that looks like a secret (the relay
//! refuses those too), the desktop's reserved keys, malformed names, and values
//! that are paths on this computer.
//!
//! What was last uploaded is remembered per agent (a hash of the snapshot and
//! the version sent) so an unchanged agent is not uploaded again, and so every
//! upload carries a version above the last one: the relay refuses a lower one.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use buzz_core_pkg::agent_placement::{
    is_secret_env_name, validate_config_snapshot, CloudConfigSnapshot,
    MAX_SNAPSHOT_ENV_VALUE_BYTES, MAX_SNAPSHOT_ENV_VARS, MAX_SNAPSHOT_TIMEOUT_SECS,
};
use nostr::Keys;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zeroize::Zeroizing;

use super::access_policy::projected_access_with_policy;
use super::types::{validate_respond_to_allowlist, ManagedAgentRecord, RespondTo};

const STATE_FILE_NAME: &str = "cloud-bundles.json";
/// Words in an env var name that mark it as a credential. Wider than the
/// relay's own check: the relay refuses what is certain, the desktop also drops
/// what is merely likely.
const SECRET_NAME_WORDS: &[&str] = &["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"];
/// Value prefixes that are folders on this computer: they mean nothing in the
/// cloud.
const LOCAL_PATH_PREFIXES: &[&str] = &[
    "/Users/",
    "/home/",
    "/Volumes/",
    "/Applications/",
    "/private/",
    "~/",
];

/// What the relay says this account may do with cloud agents.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCapabilities {
    /// The relay has cloud agents switched on.
    #[serde(default)]
    pub enabled: bool,
    /// This account is allowed to use them.
    #[serde(default)]
    pub allowed: bool,
    /// How many agents one account may keep in the cloud.
    #[serde(default)]
    pub max_per_account: u32,
    /// Models a cloud agent may use.
    #[serde(default)]
    pub models: Vec<String>,
    /// The model a new cloud agent uses.
    #[serde(default)]
    pub default_model: Option<String>,
}

/// What an upload attempt did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum CloudUploadOutcome {
    /// The relay took a new bundle at `version`.
    #[serde(rename_all = "camelCase")]
    Uploaded {
        /// The version the relay now holds.
        version: u64,
    },
    /// The relay already holds this agent's current bundle.
    Unchanged,
    /// This account may not use cloud agents; nothing was sent.
    NotAllowed,
}

/// What was last uploaded for one agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SentBundle {
    hash: String,
    version: u64,
}

/// What to do about one agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UploadPlan {
    /// Nothing to send.
    Skip,
    /// Send a bundle at this version.
    Send(u64),
}

/// Whether a cloud upload may go ahead at all: the relay has the feature on
/// and this account is allowed. Nothing is sent otherwise.
pub(crate) fn may_upload(capabilities: &CloudCapabilities) -> bool {
    capabilities.enabled && capabilities.allowed
}

/// Whether `name` must stay on this Mac.
fn is_secret_like(name: &str) -> bool {
    if is_secret_env_name(name) {
        return true;
    }
    let upper = name.to_ascii_uppercase();
    SECRET_NAME_WORDS.iter().any(|word| upper.contains(word))
}

/// The agent's own environment variables, minus everything that must not go to
/// the cloud (see the module docs). At most [`MAX_SNAPSHOT_ENV_VARS`] remain.
pub(crate) fn strip_cloud_env(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    // Reserved keys, malformed names, NULs and oversize values are dropped by
    // the same filter the local spawn uses.
    let mut kept = super::env_vars::merged_user_env(&BTreeMap::new(), env);
    kept.retain(|name, value| {
        !is_secret_like(name)
            && name.len() <= 128
            && value.len() <= MAX_SNAPSHOT_ENV_VALUE_BYTES
            && !LOCAL_PATH_PREFIXES
                .iter()
                .any(|prefix| value.trim_start().starts_with(prefix))
            && !looks_like_windows_path(value)
    });
    while kept.len() > MAX_SNAPSHOT_ENV_VARS {
        let Some(last) = kept.keys().next_back().cloned() else {
            break;
        };
        kept.remove(&last);
    }
    kept
}

fn looks_like_windows_path(value: &str) -> bool {
    let bytes = value.trim_start().as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

fn timeout_or_none(value: Option<u64>) -> Option<u64> {
    value.filter(|secs| *secs > 0 && *secs <= MAX_SNAPSHOT_TIMEOUT_SECS)
}

/// Builds the cloud config snapshot for `record`. `system_prompt` and
/// `team_instructions` are the values a local spawn would use, resolved by the
/// caller; access comes from the same projection the local harness uses.
pub(crate) fn build_snapshot(
    record: &ManagedAgentRecord,
    system_prompt: Option<String>,
    team_instructions: Option<String>,
    respond_to: RespondTo,
    allowlist: &[String],
) -> Result<CloudConfigSnapshot, String> {
    let respond_to_allowlist = if respond_to == RespondTo::Allowlist {
        validate_respond_to_allowlist(allowlist)?
    } else {
        Vec::new()
    };
    if respond_to == RespondTo::Allowlist && respond_to_allowlist.is_empty() {
        return Err("respond-to mode 'allowlist' requires at least one pubkey".to_string());
    }
    let snapshot = CloudConfigSnapshot {
        name: record.name.trim().to_string(),
        system_prompt: system_prompt.filter(|text| !text.trim().is_empty()),
        team_instructions: team_instructions.filter(|text| !text.trim().is_empty()),
        respond_to: respond_to.as_str().to_string(),
        respond_to_allowlist,
        parallelism: record.parallelism.clamp(1, 64),
        idle_timeout_seconds: timeout_or_none(record.idle_timeout_seconds),
        max_turn_duration_seconds: timeout_or_none(record.max_turn_duration_seconds),
        subscribe_mode: "mentions".to_string(),
        env_vars: strip_cloud_env(&record.env_vars),
        effort_level: None,
    };
    validate_config_snapshot(&snapshot).map_err(|error| error.to_string())?;
    Ok(snapshot)
}

/// A stable fingerprint of a snapshot: what changed is what gets uploaded.
pub(crate) fn snapshot_hash(snapshot: &CloudConfigSnapshot) -> Result<String, String> {
    // `BTreeMap` fields and struct order make the JSON stable.
    let json = serde_json::to_vec(snapshot)
        .map_err(|error| format!("failed to encode the cloud config: {error}"))?;
    Ok(hex::encode(Sha256::digest(&json)))
}

/// Decides whether to send a bundle.
///
/// An unchanged agent the relay already holds (`relay_ready`, at a version no
/// older than what was sent) is skipped. Anything else sends at a version above
/// both the last one sent and `relay_version`, and never below `now_ms`, so
/// the relay's "not lower than what it has" rule cannot refuse a re-upload.
pub(crate) fn plan_upload(
    previous: Option<&SentBundle>,
    hash: &str,
    relay_ready: bool,
    relay_version: u64,
    now_ms: u64,
) -> UploadPlan {
    if let Some(sent) = previous {
        if sent.hash == hash && relay_ready && relay_version >= sent.version {
            return UploadPlan::Skip;
        }
    }
    let above_last = previous.map_or(0, |sent| sent.version).max(relay_version) + 1;
    UploadPlan::Send(above_last.max(now_ms))
}

/// The JSON body of the bundle PUT.
pub(crate) fn bundle_body(
    nsec: &str,
    auth_tag: Option<&str>,
    snapshot: &CloudConfigSnapshot,
    version: u64,
) -> serde_json::Value {
    serde_json::json!({
        "nsec": nsec,
        "authTag": auth_tag,
        "config": snapshot,
        "configVersion": version,
    })
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(super::storage::managed_agents_base_dir(app)?.join(STATE_FILE_NAME))
}

fn load_sent(path: &Path) -> HashMap<String, SentBundle> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_sent(path: &Path, sent: &HashMap<String, SentBundle>) -> Result<(), String> {
    let json = serde_json::to_string(sent)
        .map_err(|error| format!("failed to encode the upload record: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)
        .map_err(|error| format!("failed to write the upload record: {error}"))?;
    fs::rename(&temp, path).map_err(|error| format!("failed to save the upload record: {error}"))
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|_| "Cloud agents are unavailable.".to_string())
}

/// Reads what this account may do with cloud agents. A relay that does not
/// know the endpoint (older than this feature) answers "not available", not an
/// error.
pub(crate) fn fetch_capabilities(base: &str, owner: &Keys) -> Result<CloudCapabilities, String> {
    let url = format!(
        "{}/api/cloud-agents/capabilities",
        base.trim_end_matches('/')
    );
    let auth =
        crate::relay::build_nip98_auth_header_for_keys(owner, &reqwest::Method::GET, &url, &[])?;
    let response = http_client()?
        .get(&url)
        .header("authorization", auth)
        .send()
        .map_err(|_| "Could not reach the relay to check cloud agents.".to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(CloudCapabilities::default());
    }
    if !status.is_success() {
        return Err(format!(
            "The relay refused the cloud agents check ({status})."
        ));
    }
    response
        .json::<CloudCapabilities>()
        .map_err(|_| "The relay sent an unreadable cloud agents answer.".to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Builds the snapshot of `record` the way a local spawn would resolve it.
fn snapshot_for_record(
    app: &AppHandle,
    record: &ManagedAgentRecord,
) -> Result<CloudConfigSnapshot, String> {
    let personas = super::load_personas(app).unwrap_or_default();
    let teams = super::load_teams(app).unwrap_or_default();
    let global = super::load_global_agent_config(app).unwrap_or_default();
    let effective = super::effective_config::resolve_effective_config(record, &personas, &global)
        .require_resolved()?;
    let team_instructions = super::spawn_snapshot::effective_team_instructions(record, &teams);
    let (respond_to, allowlist) = projected_access_with_policy(record, super::owner_only());
    build_snapshot(
        record,
        effective.system_prompt.value,
        team_instructions,
        respond_to,
        &allowlist,
    )
}

/// Uploads the agent's key and config so the relay can run it in the cloud.
///
/// Blocking: call from a blocking worker. `relay_ready` and `relay_version` are
/// what the relay's placement head says it holds; they let an unchanged agent
/// the relay already has be skipped without a request. Nothing is uploaded
/// unless the relay says this account may use cloud agents.
pub(crate) fn upload_blocking(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    owner: &Keys,
    base: &str,
    relay_ready: bool,
    relay_version: u64,
) -> Result<CloudUploadOutcome, String> {
    let capabilities = fetch_capabilities(base, owner)?;
    if !may_upload(&capabilities) {
        return Ok(CloudUploadOutcome::NotAllowed);
    }
    if record.private_key_nsec.is_empty() {
        return Err("This agent's key is not available on this computer.".to_string());
    }
    let agent_keys = Keys::parse(&record.private_key_nsec)
        .map_err(|_| "This agent's key is not valid.".to_string())?;
    if agent_keys.public_key().to_hex() != record.pubkey {
        return Err("This agent's key does not match its public key.".to_string());
    }
    let snapshot = snapshot_for_record(app, record)?;
    let hash = snapshot_hash(&snapshot)?;
    let path = state_path(app)?;
    let mut sent = load_sent(&path);
    let version = match plan_upload(
        sent.get(&record.pubkey),
        &hash,
        relay_ready,
        relay_version,
        now_ms(),
    ) {
        UploadPlan::Skip => return Ok(CloudUploadOutcome::Unchanged),
        UploadPlan::Send(version) => version,
    };
    let auth_tag = match &record.auth_tag {
        Some(tag) => Some(tag.clone()),
        None => Some(
            buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &agent_keys.public_key(), "")
                .map_err(|_| "Could not authorize the agent identity.".to_string())?,
        ),
    };
    let body = Zeroizing::new(
        serde_json::to_vec(&bundle_body(
            &record.private_key_nsec,
            auth_tag.as_deref(),
            &snapshot,
            version,
        ))
        .map_err(|_| "Could not encode the cloud bundle.".to_string())?,
    );
    let url = format!(
        "{}/api/cloud-agents/{}/bundle",
        base.trim_end_matches('/'),
        record.pubkey
    );
    let auth =
        crate::relay::build_nip98_auth_header_for_keys(owner, &reqwest::Method::PUT, &url, &body)?;
    let response = http_client()?
        .put(&url)
        .header("authorization", auth)
        .header("content-type", "application/json")
        .body(body.to_vec())
        .send()
        .map_err(|_| "Could not reach the relay to make this agent cloud-ready.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(bundle_refusal(status));
    }
    // The relay holds it: remember it. A failed write only costs one repeat.
    sent.insert(record.pubkey.clone(), SentBundle { hash, version });
    if let Err(error) = save_sent(&path, &sent) {
        eprintln!("buzz-desktop: could not remember the cloud upload: {error}");
    }
    Ok(CloudUploadOutcome::Uploaded { version })
}

/// What a refused bundle upload means, in words a person can act on.
pub(crate) fn bundle_refusal(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 => "The relay did not allow this account to use cloud agents.".to_string(),
        404 => "This relay does not support cloud agents yet.".to_string(),
        409 => "The relay already holds a newer setup for this agent.".to_string(),
        400 => "The relay could not accept this agent's cloud setup.".to_string(),
        code => format!("The relay refused the cloud setup ({code})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> ManagedAgentRecord {
        serde_json::from_value(serde_json::json!({
            "pubkey": "aa".repeat(32),
            "name": "Scout",
            "private_key_nsec": "nsec1fake",
            "relay_url": "wss://relay.example",
            "acp_command": "buzz-acp",
            "agent_command": "buzz-agent",
            "agent_args": [],
            "mcp_command": "",
            "turn_timeout_seconds": 320,
            "created_at": "",
            "updated_at": ""
        }))
        .expect("record fixture")
    }

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn snapshot_strips_secret_env() {
        let mut record = record();
        record.env_vars = env(&[
            ("OPENROUTER_API_KEY", "sk-or-1"),
            ("GITHUB_TOKEN", "ghp_1"),
            ("X_SECRET", "s"),
            ("OPENROUTER_MASTER_KEY", "m"),
            ("DB_PASSWORD", "p"),
            ("BUZZ_PRIVATE_KEY", "nsec1reserved"),
            ("GOOSE_TEMPERATURE", "0.2"),
            ("SHOP_REGION", "za"),
        ]);
        let snapshot = build_snapshot(&record, None, None, RespondTo::OwnerOnly, &[])
            .expect("a stripped snapshot is valid");
        let names: Vec<&str> = snapshot.env_vars.keys().map(String::as_str).collect();
        assert_eq!(names, vec!["GOOSE_TEMPERATURE", "SHOP_REGION"]);
    }

    #[test]
    fn snapshot_drops_paths_on_this_computer() {
        let mut record = record();
        record.env_vars = env(&[
            ("WORK_DIR", "/Users/mac/projects/shop"),
            ("DRIVE", "C:\\Users\\mac"),
            ("REGION", "za"),
        ]);
        let snapshot =
            build_snapshot(&record, None, None, RespondTo::OwnerOnly, &[]).expect("valid snapshot");
        assert_eq!(
            snapshot
                .env_vars
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["REGION"]
        );
    }

    #[test]
    fn snapshot_carries_the_spawn_resolved_prompt_and_access() {
        let mut record = record();
        record.parallelism = 3;
        record.idle_timeout_seconds = Some(90);
        record.max_turn_duration_seconds = Some(0);
        let owner = "bb".repeat(32);
        let snapshot = build_snapshot(
            &record,
            Some("Be brief.".to_string()),
            Some("Team rules".to_string()),
            RespondTo::Allowlist,
            std::slice::from_ref(&owner),
        )
        .expect("valid snapshot");
        assert_eq!(snapshot.name, "Scout");
        assert_eq!(snapshot.system_prompt.as_deref(), Some("Be brief."));
        assert_eq!(snapshot.team_instructions.as_deref(), Some("Team rules"));
        assert_eq!(snapshot.respond_to, "allowlist");
        assert_eq!(snapshot.respond_to_allowlist, vec![owner]);
        assert_eq!(snapshot.parallelism, 3);
        assert_eq!(snapshot.idle_timeout_seconds, Some(90));
        // A zero cap is "unset", not an invalid snapshot.
        assert_eq!(snapshot.max_turn_duration_seconds, None);
        assert_eq!(snapshot.subscribe_mode, "mentions");
    }

    #[test]
    fn an_allowlist_agent_with_nobody_on_the_list_is_refused() {
        assert!(build_snapshot(&record(), None, None, RespondTo::Allowlist, &[]).is_err());
    }

    #[test]
    fn upload_skipped_when_not_allowed() {
        assert!(!may_upload(&CloudCapabilities::default()));
        assert!(!may_upload(&CloudCapabilities {
            enabled: true,
            allowed: false,
            ..CloudCapabilities::default()
        }));
        assert!(!may_upload(&CloudCapabilities {
            enabled: false,
            allowed: true,
            ..CloudCapabilities::default()
        }));
        assert!(may_upload(&CloudCapabilities {
            enabled: true,
            allowed: true,
            ..CloudCapabilities::default()
        }));
    }

    #[test]
    fn unchanged_agent_the_relay_holds_is_not_uploaded_again() {
        let sent = SentBundle {
            hash: "h1".into(),
            version: 1_000,
        };
        assert_eq!(
            plan_upload(Some(&sent), "h1", true, 1_000, 5_000),
            UploadPlan::Skip
        );
    }

    #[test]
    fn a_changed_agent_is_uploaded_above_the_last_version() {
        let sent = SentBundle {
            hash: "h1".into(),
            version: 9_000,
        };
        // The clock is behind the last version: still strictly above it.
        assert_eq!(
            plan_upload(Some(&sent), "h2", true, 9_000, 5_000),
            UploadPlan::Send(9_001)
        );
        assert_eq!(
            plan_upload(Some(&sent), "h2", true, 9_000, 20_000),
            UploadPlan::Send(20_000)
        );
    }

    #[test]
    fn an_agent_the_relay_does_not_hold_is_uploaded_even_if_unchanged() {
        let sent = SentBundle {
            hash: "h1".into(),
            version: 1_000,
        };
        // Not cloud-ready on the relay: another relay, or the row was deleted.
        assert_eq!(
            plan_upload(Some(&sent), "h1", false, 0, 5_000),
            UploadPlan::Send(5_000)
        );
        // First ever upload.
        assert_eq!(
            plan_upload(None, "h1", false, 0, 5_000),
            UploadPlan::Send(5_000)
        );
    }

    #[test]
    fn a_relay_with_a_newer_version_is_never_sent_a_lower_one() {
        assert_eq!(
            plan_upload(None, "h1", true, 70_000, 5_000),
            UploadPlan::Send(70_001)
        );
    }

    #[test]
    fn bundle_body_has_the_contract_keys() {
        let snapshot = build_snapshot(&record(), None, None, RespondTo::OwnerOnly, &[])
            .expect("valid snapshot");
        let body = bundle_body("nsec1abc", None, &snapshot, 7);
        assert_eq!(body["nsec"], "nsec1abc");
        assert_eq!(body["authTag"], serde_json::Value::Null);
        assert_eq!(body["configVersion"], 7);
        assert_eq!(body["config"]["name"], "Scout");
        assert_eq!(body["config"]["respondTo"], "owner-only");
        let mut keys: Vec<&str> = body
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["authTag", "config", "configVersion", "nsec"]);
    }

    #[test]
    fn identical_snapshots_hash_alike_and_a_change_moves_the_hash() {
        let first = build_snapshot(&record(), None, None, RespondTo::OwnerOnly, &[])
            .expect("valid snapshot");
        let second = build_snapshot(&record(), None, None, RespondTo::OwnerOnly, &[])
            .expect("valid snapshot");
        assert_eq!(snapshot_hash(&first), snapshot_hash(&second));
        let changed = build_snapshot(
            &record(),
            Some("new prompt".into()),
            None,
            RespondTo::OwnerOnly,
            &[],
        )
        .expect("valid snapshot");
        assert_ne!(snapshot_hash(&first), snapshot_hash(&changed));
    }

    #[test]
    fn capabilities_decode_with_missing_fields() {
        let caps: CloudCapabilities = serde_json::from_str(
            r#"{"enabled":true,"allowed":true,"maxPerAccount":2,"models":["m"],"defaultModel":"m"}"#,
        )
        .expect("contract json");
        assert_eq!(caps.max_per_account, 2);
        assert_eq!(caps.default_model.as_deref(), Some("m"));
        let sparse: CloudCapabilities = serde_json::from_str(r#"{"enabled":false}"#).expect("json");
        assert!(!may_upload(&sparse));
    }

    #[test]
    fn upload_state_round_trips_through_the_file() {
        let dir = std::env::temp_dir().join(format!(
            "colony-cloud-bundles-{}-roundtrip",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join(STATE_FILE_NAME);
        assert!(load_sent(&path).is_empty());
        let mut sent = HashMap::new();
        sent.insert(
            "aa".to_string(),
            SentBundle {
                hash: "h".into(),
                version: 4,
            },
        );
        save_sent(&path, &sent).expect("save");
        assert_eq!(load_sent(&path), sent);
        let _ = fs::remove_dir_all(&dir);
    }
}
