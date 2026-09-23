//! Opt-in headless host for the Electron shell.
//!
//! Electron owns the only visible UI. This process keeps the existing Tauri
//! commands, managed state, and plugins, and serves them to the Electron parent
//! over a private stdio transport. Its Tauri window is never shown; it exists
//! only as the dispatch context for `InvokeRequest`s. Ordinary Tauri builds
//! never open this transport.

#[cfg(feature = "electron-host")]
mod runtime;
pub(crate) mod shell_events;
#[cfg(feature = "electron-host")]
mod wire;
pub(crate) use shell_events::WindowAction;

/// Whether this process is serving an Electron parent.
pub(crate) fn enabled() -> bool {
    cfg!(feature = "electron-host") && std::env::var("COLONY_ELECTRON_HOST").as_deref() == Ok("1")
}

/// Profile-scoped native storage and keyring namespace supplied by the parent.
///
/// Every Electron profile gets its own identifier so a development profile can
/// never open another profile's (or the standalone Tauri app's) store.
pub(crate) fn data_identifier(base: &str) -> String {
    let profile = std::env::var("COLONY_ELECTRON_PROFILE_ID").unwrap_or_default();
    profile_identifier(base, &profile)
}

fn profile_identifier(base: &str, profile: &str) -> String {
    if profile.len() == 16 && profile.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        format!("{base}.electron.{profile}")
    } else {
        format!("{base}.electron")
    }
}

/// Install the channel interceptor that forwards `Channel` messages to Electron.
pub(crate) fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(feature = "electron-host")]
    if enabled() {
        return builder.channel_interceptor(runtime::channel);
    }
    builder
}

/// Keep the dispatch window hidden, blank, and on a profile-scoped identifier.
pub(crate) fn context(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if enabled() {
        let config = context.config_mut();
        config.identifier = data_identifier(&config.identifier);
        for window in &mut config.app.windows {
            window.visible = false;
            window.focus = false;
            window.maximized = false;
            window.incognito = true;
            if let Ok(url) = url::Url::parse("about:blank") {
                window.url = tauri::WebviewUrl::External(url);
            }
        }
    }
    context
}

/// Start the stdio transport once the app has been set up.
pub(crate) fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(feature = "electron-host")]
    if enabled() {
        runtime::start(app.clone())?;
    }
    #[cfg(not(feature = "electron-host"))]
    let _ = app;
    Ok(())
}

/// Ask the Electron parent to reveal its window instead of the hidden one.
///
/// Returns `true` when the request was routed to Electron, in which case the
/// caller must not touch the hidden Tauri window.
pub(crate) fn route_show_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    shell_events::emit(app, shell_events::SHOW_WINDOW, serde_json::Value::Null)
}

#[cfg(target_os = "macos")]
pub(crate) fn emit_application_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event: &str,
    payload: serde_json::Value,
) -> bool {
    shell_events::emit(app, event, payload)
}

pub(crate) fn route_window_action<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    action: shell_events::WindowAction,
) -> bool {
    shell_events::emit(
        app,
        shell_events::WINDOW_ACTION,
        shell_events::window_action_payload(action),
    )
}

pub(crate) fn route_window_vibrancy<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
    material: Option<String>,
) -> bool {
    shell_events::emit(
        app,
        shell_events::SET_WINDOW_VIBRANCY,
        shell_events::vibrancy_payload(enabled, material),
    )
}

pub(crate) fn route_huddle_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event: &str,
    channel_id: &str,
) -> bool {
    shell_events::emit(app, event, shell_events::huddle_window_payload(channel_id))
}

#[cfg(test)]
mod tests {
    use super::profile_identifier;

    #[test]
    fn profiles_have_distinct_native_namespaces() {
        let base = "xyz.block.buzz.app";
        assert_ne!(
            profile_identifier(base, "1111111111111111"),
            profile_identifier(base, "2222222222222222")
        );
        assert_eq!(
            profile_identifier(base, "../../production"),
            profile_identifier(base, "")
        );
        assert_eq!(
            profile_identifier(base, "1234567890abcdef"),
            "xyz.block.buzz.app.electron.1234567890abcdef"
        );
        assert_ne!(profile_identifier(base, ""), base);
    }
}
