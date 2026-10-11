//! Bounded, keyless onboarding proof using the same managed authorization.
use super::{apply, authorize, bounded_json, Authorization};
use nostr::Keys;
use std::{
    process::{Command, Output},
    time::Duration,
};

fn revoke(relay: &str, owner: &Keys, authorization: &Authorization) -> Result<(), String> {
    let origin =
        buzz_agent_pkg::credits_gateway::gateway_origin(relay).map_err(|e| e.to_string())?;
    let url = format!("{origin}/api/credits-gateway/sessions/revoke");
    let body = serde_json::to_vec(&serde_json::json!({"session_id": authorization.session_id}))
        .map_err(|_| "Could not close the credits test session.".to_owned())?;
    let auth =
        crate::relay::build_nip98_auth_header_for_keys(owner, &reqwest::Method::POST, &url, &body)?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|_| "Could not close the credits test session.".to_owned())?;
    let response: serde_json::Value = bounded_json(client.post(url).header("authorization", auth)
        .header("content-type", "application/json").body(body).send()
        .map_err(|_| "Could not close the credits test session. It will expire automatically; try again later.".to_owned())?)?;
    if response["revoked"] != true {
        return Err("Could not confirm the credits test session closed. Try again later.".into());
    }
    Ok(())
}

/// Called only inside spawn_blocking, after the native flag/runtime gate. The
/// ephemeral agent key never persists. Server expiry durably bounds cleanup
/// failures, which propagate and cannot produce a saved connection proof.
pub(crate) fn run(
    mut command: Command,
    relay: &str,
    owner: &Keys,
    is_current: impl Fn() -> bool,
    timeout: Duration,
) -> Result<Option<Output>, String> {
    if !is_current() {
        return Err("Connection test cancelled.".into());
    }
    let agent = Keys::generate();
    let authorization = authorize(relay, &agent, owner)?;
    let output = if is_current() {
        command
            .env("BUZZ_RELAY_URL", relay)
            .env("BUZZ_PRIVATE_KEY", agent.secret_key().to_secret_hex())
            .env("BUZZ_ACP_RUNTIME_ID", "buzz-agent");
        apply(&mut command, Some(&authorization));
        // Relay model is authoritative; this probe must not request a customer override.
        command.env_remove("COLONY_CONNECTION_MODEL");
        Ok(super::super::output_with_timeout(command, timeout))
    } else {
        Err("Connection test cancelled.".to_owned())
    };
    // Revoke on success, spawn failure, cancellation and timeout. Never hide a
    // cleanup failure behind a successful reply. No inference is retried.
    let still_current = is_current();
    revoke(relay, owner, &authorization)?;
    if !still_current || !is_current() {
        return Err("Connection test cancelled or business changed.".into());
    }
    output
}
