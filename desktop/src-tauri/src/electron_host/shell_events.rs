use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

pub(crate) const SHOW_WINDOW: &str = "electron-shell:show-window";
#[cfg(target_os = "macos")]
pub(crate) const QUIT_APP: &str = "electron-shell:quit";
pub(crate) const WINDOW_ACTION: &str = "electron-shell:window-action";
pub(crate) const SET_WINDOW_VIBRANCY: &str = "electron-shell:set-window-vibrancy";
pub(crate) const OPEN_HUDDLE_WINDOW: &str = "electron-shell:open-huddle-window";
pub(crate) const CLOSE_HUDDLE_WINDOW: &str = "electron-shell:close-huddle-window";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WindowAction {
    #[cfg(target_os = "macos")]
    Minimize,
    ToggleMaximize,
    #[cfg(target_os = "macos")]
    FillWorkArea,
}

pub(crate) fn window_action_payload(action: WindowAction) -> Value {
    json!({ "action": action })
}

pub(crate) fn vibrancy_payload(enabled: bool, material: Option<String>) -> Value {
    json!({ "enabled": enabled, "material": material })
}

pub(crate) fn huddle_window_payload(channel_id: &str) -> Value {
    json!({ "channelId": channel_id })
}

fn dispatch(enabled: bool, event: &str, payload: Value, send: impl FnOnce(&str, Value)) -> bool {
    if !enabled {
        return false;
    }
    send(event, payload);
    true
}

pub(crate) fn emit<R: Runtime>(app: &AppHandle<R>, event: &str, payload: Value) -> bool {
    dispatch(super::enabled(), event, payload, |event, payload| {
        if let Err(error) = app.emit(event, payload) {
            eprintln!("colony-native: failed to emit shell event {event}: {error}");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_dispatch_emits_the_exact_event_and_payload() {
        let mut emitted = None;

        let routed = dispatch(true, SHOW_WINDOW, Value::Null, |event, payload| {
            emitted = Some((event.to_owned(), payload))
        });

        assert!(routed);
        assert_eq!(emitted, Some((SHOW_WINDOW.to_owned(), Value::Null)));
    }

    #[test]
    fn disabled_dispatch_does_not_call_the_emitter() {
        let mut emitted = false;

        let routed = dispatch(false, SHOW_WINDOW, Value::Null, |_, _| emitted = true);

        assert!(!routed);
        assert!(!emitted);
    }

    #[test]
    fn toggle_maximize_payload_matches_the_electron_shell_contract() {
        assert_eq!(
            window_action_payload(WindowAction::ToggleMaximize),
            json!({ "action": "toggle-maximize" })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn window_action_payloads_match_the_electron_shell_contract() {
        assert_eq!(
            window_action_payload(WindowAction::Minimize),
            json!({ "action": "minimize" })
        );
        assert_eq!(
            window_action_payload(WindowAction::FillWorkArea),
            json!({ "action": "fill-work-area" })
        );
    }

    #[test]
    fn huddle_and_vibrancy_payloads_match_the_electron_shell_contract() {
        assert_eq!(SHOW_WINDOW, "electron-shell:show-window");
        #[cfg(target_os = "macos")]
        assert_eq!(QUIT_APP, "electron-shell:quit");
        assert_eq!(OPEN_HUDDLE_WINDOW, "electron-shell:open-huddle-window");
        assert_eq!(CLOSE_HUDDLE_WINDOW, "electron-shell:close-huddle-window");
        assert_eq!(SET_WINDOW_VIBRANCY, "electron-shell:set-window-vibrancy");
        assert_eq!(WINDOW_ACTION, "electron-shell:window-action");
        assert_eq!(
            huddle_window_payload("huddle-123"),
            json!({ "channelId": "huddle-123" })
        );
        assert_eq!(
            vibrancy_payload(true, Some("sidebar".to_owned())),
            json!({ "enabled": true, "material": "sidebar" })
        );
    }
}
