use tauri::Manager;

/// Performs the platform's default sidebar alignment haptic when available.
#[tauri::command]
pub fn perform_sidebar_default_haptic() {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
            NSHapticFeedbackPerformer,
        };

        NSHapticFeedbackManager::defaultPerformer().performFeedbackPattern_performanceTime(
            NSHapticFeedbackPattern::Alignment,
            NSHapticFeedbackPerformanceTime::Now,
        );
    }
}

/// Performs the window action matching the macOS "double-click a window's
/// title bar to" preference (`AppleActionOnDoubleClick`).
///
/// macOS values are `Minimize`, `Maximize` (default when unset), `Fill`, or
/// `None`.
/// The desktop app uses a web-based title-bar drag region, so the frontend
/// forwards double-clicks here and suppresses Tauri's injected drag-region
/// handler, whose default macOS path hardcodes maximize.
///
/// For `Fill`, resize to the current monitor work area instead of using
/// Tauri's maximize path, which maps to macOS zoom for titled, resizable
/// windows.
///
/// On non-macOS platforms this always toggles maximize (the historical
/// behavior).
#[tauri::command]
pub fn title_bar_double_click(window: tauri::Window) {
    let action = preferred_double_click_action();
    if crate::electron_host::enabled() {
        if let Some(action) = action {
            let _ = crate::electron_host::route_window_action(window.app_handle(), action);
        }
        return;
    }

    #[cfg(target_os = "macos")]
    {
        match action {
            None => {}
            Some(crate::electron_host::WindowAction::Minimize) => {
                let _ = window.minimize();
            }
            Some(crate::electron_host::WindowAction::FillWorkArea) => {
                fill_window(&window);
            }
            Some(crate::electron_host::WindowAction::ToggleMaximize) => {
                toggle_maximize(&window);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if matches!(
            action,
            Some(crate::electron_host::WindowAction::ToggleMaximize)
        ) {
            toggle_maximize(&window);
        }
    }
}

#[cfg(target_os = "macos")]
fn preferred_double_click_action() -> Option<crate::electron_host::WindowAction> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleActionOnDoubleClick"])
        .output();
    let preference = match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => "Maximize".to_string(),
    };

    action_for_apple_preference(&preference)
}

#[cfg(target_os = "macos")]
fn action_for_apple_preference(preference: &str) -> Option<crate::electron_host::WindowAction> {
    use crate::electron_host::WindowAction;

    match preference {
        "None" => None,
        "Minimize" => Some(WindowAction::Minimize),
        "Fill" => Some(WindowAction::FillWorkArea),
        _ => Some(WindowAction::ToggleMaximize),
    }
}

#[cfg(not(target_os = "macos"))]
fn preferred_double_click_action() -> Option<crate::electron_host::WindowAction> {
    Some(crate::electron_host::WindowAction::ToggleMaximize)
}

/// Fills the current display work area, excluding system UI like the menu bar
/// and Dock.
#[cfg(target_os = "macos")]
fn fill_window(window: &tauri::Window) {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }

            let work_area = monitor.work_area();
            let _ = window.set_position(work_area.position);
            let _ = window.set_size(work_area.size);
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

/// Toggles the window between maximized and its previous size, matching the
/// historical double-click behavior.
fn toggle_maximize(window: &tauri::Window) {
    match window.is_maximized() {
        Ok(true) => {
            let _ = window.unmaximize();
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn apple_double_click_preference_maps_to_shell_actions() {
        use crate::electron_host::WindowAction;

        assert_eq!(action_for_apple_preference("None"), None);
        assert_eq!(
            action_for_apple_preference("Minimize"),
            Some(WindowAction::Minimize)
        );
        assert_eq!(
            action_for_apple_preference("Fill"),
            Some(WindowAction::FillWorkArea)
        );
        assert_eq!(
            action_for_apple_preference("Maximize"),
            Some(WindowAction::ToggleMaximize)
        );
        assert_eq!(
            action_for_apple_preference("unexpected"),
            Some(WindowAction::ToggleMaximize)
        );
    }
}
