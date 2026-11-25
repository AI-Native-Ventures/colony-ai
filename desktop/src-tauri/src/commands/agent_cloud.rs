//! Tauri commands for cloud agents: where each agent works, and what the
//! desktop tells the relay so an agent can work in the cloud.

use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    managed_agents::{
        cloud_bundle::{self, CloudCapabilities, CloudUploadOutcome},
        delegation::{foreign_delegation_refusal, signed_in_owner_hex},
        load_managed_agents,
        placement_cache::{self, PlacementCacheEntry},
    },
};

/// Records where the relay says agents work, so no local spawn can start a
/// second copy of an agent that works in the cloud. Entries replace older
/// ones of the same or a lower generation only.
#[tauri::command]
pub fn set_placement_cache(
    entries: Vec<PlacementCacheEntry>,
    app: AppHandle,
) -> Result<(), String> {
    placement_cache::set_entries(&app, &entries)
}

/// What this account may do with cloud agents on the active relay. A relay
/// without cloud agents answers "not enabled", not an error.
#[tauri::command]
pub async fn get_cloud_capabilities(app: AppHandle) -> Result<CloudCapabilities, String> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state.signing_keys()?;
        let base = crate::relay::relay_api_base_url_with_override(&state);
        cloud_bundle::fetch_capabilities(&base, &owner)
    })
    .await
    .map_err(|error| format!("spawn_blocking failed: {error}"))?
}

/// Uploads one agent's key and config so the relay can run it in the cloud.
/// `relay_ready` and `relay_config_version` are what the agent's placement head
/// says the relay holds; an unchanged agent the relay already has is skipped.
/// Nothing is sent unless the relay says this account may use cloud agents.
#[tauri::command]
pub async fn upload_cloud_bundle(
    pubkey: String,
    relay_ready: bool,
    relay_config_version: u64,
    app: AppHandle,
) -> Result<CloudUploadOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let record = {
            let _store_guard = state
                .managed_agents_store_lock
                .lock()
                .map_err(|error| error.to_string())?;
            load_managed_agents(&app)?
                .into_iter()
                .find(|record| record.pubkey == pubkey)
                .ok_or_else(|| format!("agent {pubkey} not found"))?
        };
        let owner = state.signing_keys()?;
        let signed_in_owner = signed_in_owner_hex(&state)?;
        if let Some(error) = foreign_delegation_refusal(&record, &signed_in_owner) {
            return Err(error);
        }
        let base = crate::relay::relay_api_base_url_with_override(&state);
        cloud_bundle::upload_blocking(
            &app,
            &record,
            &owner,
            &base,
            relay_ready,
            relay_config_version,
        )
    })
    .await
    .map_err(|error| format!("spawn_blocking failed: {error}"))?
}
