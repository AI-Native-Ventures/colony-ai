//! Reading and writing the team computer record on the company relay.

use buzz_core_pkg::kind::KIND_TEAM_COMPUTER_HEAD;
use buzz_core_pkg::team_computer::{
    TeamComputerAction, TeamComputerActionKind, TEAM_COMPUTER_D_TAG,
};
use tauri::{AppHandle, Manager};

use super::claim::{parse_head, ClaimView};
use super::{computer, ensure_computer, normalize_relay, now_unix, record_claim};
use crate::app_state::AppState;

const UNREACHABLE: &str =
    "Colony could not reach your company. Check the connection and try again.";

/// Whether the relay refused because another computer holds the team.
pub(crate) fn is_conflict(error: &str) -> bool {
    error.contains("conflict:")
}

/// Whether the relay refused a heartbeat as too soon. Harmless.
pub(crate) fn is_rate_limited(error: &str) -> bool {
    error.contains("rate-limited:")
}

/// Whether the relay says this computer no longer holds the team.
pub(crate) fn is_not_holder(error: &str) -> bool {
    error.contains("restricted:") || is_conflict(error)
}

/// The newest of `events`.
pub(crate) fn newest(events: Vec<nostr::Event>) -> Option<nostr::Event> {
    events.into_iter().max_by_key(|event| event.created_at)
}

/// The relay's own signing key (NIP-11 `self`, cached by the app).
pub(crate) async fn relay_self(app: &AppHandle, relay_url: &str) -> Result<String, String> {
    let state = app.state::<AppState>();
    crate::commands::fetch_relay_self_at(&state, relay_url)
        .await?
        .ok_or_else(|| UNREACHABLE.to_string())
}

/// Read the company's record from the relay and remember it.
pub(crate) async fn refresh(app: &AppHandle, relay_url: &str) -> Result<ClaimView, String> {
    let relay = normalize_relay(relay_url)?;
    let relay_self = relay_self(app, &relay).await?;
    let state = app.state::<AppState>();
    let events = crate::relay::query_relay_at(
        &state,
        &crate::relay::relay_http_base_url(&relay),
        &[serde_json::json!({
            "kinds": [KIND_TEAM_COMPUTER_HEAD],
            "authors": [relay_self],
            "#d": [TEAM_COMPUTER_D_TAG],
            "limit": 1
        })],
    )
    .await?;
    let holder = match newest(events) {
        Some(event) => parse_head(&event, &relay_self)?.holder(),
        None => None,
    };
    let view = ClaimView {
        holder,
        fetched_at: now_unix(),
    };
    record_claim(app, &relay, view.clone())?;
    Ok(view)
}

/// Sign one team computer action with the signed-in person's key and send it.
pub(crate) async fn publish(
    app: &AppHandle,
    relay_url: &str,
    action: TeamComputerActionKind,
    force: bool,
) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    let state = app.state::<AppState>();
    let keys = state.signing_keys()?;
    let identity = ensure_computer(app)?;
    let action = TeamComputerAction {
        action,
        computer_id: identity.computer_id,
        computer_name: computer::this_computer_name(),
        force,
    };
    let builder = buzz_sdk_pkg::team_computer::build_team_computer_action(&action)
        .map_err(|error| error.to_string())?;
    crate::relay::submit_event_at_with_keys(
        builder,
        &state,
        &crate::relay::relay_http_base_url(&relay),
        &keys,
    )
    .await
    .map(|_| ())
}

/// Claim the team for this computer (`force` moves it from another one) and
/// return the record afterwards. When another computer holds it and this is
/// not a move, the refreshed record names that computer; that is not an error.
pub(crate) async fn claim(
    app: &AppHandle,
    relay_url: &str,
    force: bool,
) -> Result<ClaimView, String> {
    match publish(app, relay_url, TeamComputerActionKind::Claim, force).await {
        Ok(()) => refresh(app, relay_url).await,
        Err(error) if is_conflict(&error) => refresh(app, relay_url).await,
        Err(error) => Err(error),
    }
}

/// Give the team up from this computer.
pub(crate) async fn release(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    publish(app, relay_url, TeamComputerActionKind::Release, false).await?;
    refresh(app, relay_url).await.map(|_| ())
}
