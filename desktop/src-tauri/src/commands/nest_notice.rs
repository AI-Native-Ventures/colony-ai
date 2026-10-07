//! The one-time, plain-language notice about moving the agents' folder.
//!
//! The move runs before the window exists, so its message is stored in the
//! app-data directory and fetched by the frontend once it has mounted. A
//! message the person has seen is acknowledged and never shown again.

use crate::managed_agents::nest_migration::{
    acknowledge_notice, pending_notice, state_dir, NestMigrationNotice,
};
use tauri::{AppHandle, Manager};

/// The notice the person has not seen yet, or `None`.
#[tauri::command]
pub fn get_nest_migration_notice(app: AppHandle) -> Option<NestMigrationNotice> {
    let data_dir = app.path().app_data_dir().ok()?;
    pending_notice(&state_dir(&data_dir))
}

/// Mark the stored notice as seen.
#[tauri::command]
pub fn acknowledge_nest_migration_notice(app: AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    acknowledge_notice(&state_dir(&data_dir))
}
