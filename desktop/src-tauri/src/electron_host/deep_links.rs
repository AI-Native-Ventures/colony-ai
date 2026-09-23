//! Deep-link entry point for the Electron parent process.

/// Pass an OS-delivered URL through the existing Tauri deep-link parser.
#[tauri::command]
pub(crate) fn handle_electron_deep_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !crate::build_identity::is_deep_link_for_build(&url) {
        return Err("Unsupported deep-link scheme".to_string());
    }
    crate::deep_link::handle_deep_link_url(&app, &url);
    Ok(())
}
