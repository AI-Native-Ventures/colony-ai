//! Desktop-owned authorization for the bundled Colony Agent. No provider key.

use std::{io::Read, process::Command, time::Duration};

use nostr::Keys;
use serde::Deserialize;

use super::BackendKind;

const SESSION_ENV: &str = "COLONY_CREDITS_SESSION_ID";
const MODEL_ENV: &str = "COLONY_CREDITS_MODEL";
// Remove every supported paid-provider credential, including inherited values.
const PROVIDER_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_COMPAT_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "DATABRICKS_TOKEN",
    "OPENROUTER_MASTER_KEY",
    "COLONY_CREDITS_UPSTREAM_KEY",
    "COLONY_CREDITS_USER_HASH_KEY",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Authorization {
    session_id: uuid::Uuid,
    model: String,
    expires_in_seconds: u64,
}

pub(super) fn enabled() -> bool {
    std::env::var("COLONY_CREDITS_GATEWAY").ok().as_deref() == Some("1")
        || option_env!("COLONY_CREDITS_GATEWAY") == Some("1")
}

/// Refuse before network or process side effects. Only the saved provider opts in.
pub(super) fn validate_selection(
    selected: bool,
    flag: bool,
    runtime: Option<&str>,
    backend: &BackendKind,
) -> Result<(), String> {
    if !selected {
        return Ok(());
    }
    if !flag {
        return Err("Colony credits are unavailable in this build.".into());
    }
    if runtime != Some("buzz-agent") || !matches!(backend, BackendKind::Local) {
        return Err(
            "Colony credits require the bundled Colony Agent running on this computer.".into(),
        );
    }
    Ok(())
}

fn bounded_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, String> {
    if !response.status().is_success() {
        return Err("Colony credits are unavailable or this agent is not authorized. Try restarting your Colony Agent.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read Colony credits authorization.".to_string())?;
    if bytes.len() > 16 * 1024 {
        return Err("Invalid Colony credits authorization.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid Colony credits authorization.".into())
}

/// Runs at the existing blocking native spawn boundary with an explicit relay.
/// Ownership is proved by the active owner's NIP-98 signature; agent ownership
/// and membership are checked by the relay before returning a session.
pub(super) fn authorize(relay: &str, agent: &str, owner: &Keys) -> Result<Authorization, String> {
    let relay = relay.to_owned();
    let agent = agent.to_owned();
    let owner = owner.clone();
    // Some launch callers are async. reqwest blocking clients must be created
    // and dropped outside their Tokio runtime; this worker has bounded I/O.
    std::thread::Builder::new()
        .name("colony-credits-session".into())
        .spawn(move || authorize_blocking(&relay, &agent, &owner))
        .map_err(|_| "Could not start Colony credits authorization.".to_string())?
        .join()
        .map_err(|_| "Colony credits authorization stopped.".to_string())?
}

fn authorize_blocking(relay: &str, agent: &str, owner: &Keys) -> Result<Authorization, String> {
    let origin =
        buzz_agent_pkg::credits_gateway::gateway_origin(relay).map_err(|e| e.to_string())?;
    let http = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|_| "Colony credits are unavailable.".to_string())?;
    let capability: serde_json::Value = bounded_json(
        http.get(format!("{origin}/api/credits-gateway/capabilities"))
            .send()
            .map_err(|_| "Could not check Colony credits availability.".to_string())?,
    )?;
    if capability["enabled"] != true || capability["runtime"] != "colony" {
        return Err("Colony credits are not configured on this relay.".into());
    }
    let url = format!("{origin}/api/credits-gateway/sessions");
    let body = serde_json::to_vec(&serde_json::json!({"agent_pubkey": agent}))
        .map_err(|_| "Could not authorize Colony credits.".to_string())?;
    let auth =
        crate::relay::build_nip98_auth_header_for_keys(owner, &reqwest::Method::POST, &url, &body)?;
    let authorization: Authorization = bounded_json(
        http.post(url)
            .header("authorization", auth)
            .header("content-type", "application/json")
            .body(body)
            .send()
            .map_err(|_| {
                "Could not authorize Colony credits. Try restarting your Colony Agent.".to_string()
            })?,
    )?;
    if authorization.model.trim().is_empty()
        || authorization.model.len() > 200
        || authorization.expires_in_seconds == 0
        || authorization.expires_in_seconds > 7200
    {
        return Err("Invalid Colony credits authorization.".into());
    }
    Ok(authorization)
}

/// Applied AFTER all saved env layers, so ephemeral authorization has one owner.
pub(super) fn apply(command: &mut Command, authorization: Option<&Authorization>) {
    for key in ["COLONY_CREDITS_GATEWAY", SESSION_ENV, MODEL_ENV] {
        command.env_remove(key);
    }
    if let Some(authorization) = authorization {
        for key in PROVIDER_KEYS {
            command.env_remove(key);
        }
        command
            .env("COLONY_CREDITS_GATEWAY", "1")
            .env(SESSION_ENV, authorization.session_id.to_string())
            .env(MODEL_ENV, &authorization.model)
            .env("BUZZ_AGENT_PROVIDER", "colony-credits")
            .env("LLM_PROVIDER", "colony-credits")
            .env("BUZZ_AGENT_MODEL", &authorization.model)
            .env("BUZZ_ACP_MODEL", &authorization.model)
            .env_remove("BUZZ_ACP_SETUP_PAYLOAD");
    }
}

#[cfg(test)]
mod tests;
