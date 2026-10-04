use tauri::{AppHandle, State};

use crate::{app_state::AppState, managed_agents, relay};

/// Resolve a local managed author's actual runtime directory without keyring access.
#[tauri::command]
pub fn get_agent_workspace_root(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_pubkey: String,
    expected_relay_url: String,
) -> Result<String, String> {
    if agent_pubkey.len() != 64 || !agent_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid agent identity".into());
    }
    if expected_relay_url.trim().is_empty() {
        return Err("Missing workspace scope".into());
    }
    let _scope = relay::bind_expected_relay_scope(
        Some(&expected_relay_url),
        relay::relay_ws_url_with_override(&state),
    )?;
    let records = managed_agents::storage::load_factory_agent_records(&app)?;
    // Local runtimes follow the active workspace; legacy per-record relay pins are ignored.
    let belongs_here = records
        .iter()
        .any(|record| local_author_matches(&record.pubkey, &record.backend, &agent_pubkey));
    if !belongs_here {
        return Err("No local workspace for this agent in this community".into());
    }
    let root = managed_agents::nest_dir().ok_or("Agent workspace is unavailable")?;
    if managed_agents::default_agent_workdir().as_ref() != Some(&root) {
        return Err("Agent workspace is unavailable".into());
    }
    root.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Invalid workspace path".into())
}

fn local_author_matches(
    record_pubkey: &str,
    backend: &managed_agents::BackendKind,
    requested_pubkey: &str,
) -> bool {
    record_pubkey.eq_ignore_ascii_case(requested_pubkey)
        && *backend == managed_agents::BackendKind::Local
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_access_requires_the_local_author() {
        let local = managed_agents::BackendKind::Local;
        assert!(local_author_matches("abc", &local, "ABC"));
        assert!(!local_author_matches("abc", &local, "def"));
        let remote = managed_agents::BackendKind::Provider {
            id: "remote".into(),
            config: serde_json::json!({}),
        };
        assert!(!local_author_matches("abc", &remote, "abc"));
    }
}
