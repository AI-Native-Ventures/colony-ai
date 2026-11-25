//! Tauri commands for cloud agents: where each agent works, and what the
//! desktop tells the relay so an agent can work in the cloud.

use tauri::AppHandle;

use crate::managed_agents::placement_cache::{self, PlacementCacheEntry};

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
