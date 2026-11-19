//! Managed-agent summary assembly shared by creation and lifecycle commands.

use tauri::AppHandle;

use crate::managed_agents::{
    build_managed_agent_summary, load_global_agent_config, load_personas, load_teams,
    ManagedAgentPairRuntime, ManagedAgentRecord, ManagedAgentRuntimeKey, ManagedAgentSummary,
};

/// Build a summary from fresh disk state (personas, teams, global config).
///
/// One-shot command paths use this helper. The five-second list poll calls
/// `build_managed_agent_summary` directly after loading stores once per poll.
pub(super) fn summarize_from_disk(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    runtimes: &std::collections::HashMap<ManagedAgentRuntimeKey, ManagedAgentPairRuntime>,
) -> Result<ManagedAgentSummary, String> {
    build_managed_agent_summary(
        app,
        record,
        runtimes,
        &load_personas(app).unwrap_or_default(),
        &load_teams(app).unwrap_or_default(),
        &load_global_agent_config(app).unwrap_or_default(),
    )
}
