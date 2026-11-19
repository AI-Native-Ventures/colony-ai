//! Field normalization for `create_managed_agent` — the pure validators and
//! resolvers its request-to-record mapping runs before any side effect.

use crate::managed_agents::{
    managed_agent_avatar_url, BackendKind, ManagedAgentRecord, RelayMeshConfig,
};

pub(super) fn normalize_relay_mesh(
    config: Option<&RelayMeshConfig>,
    backend: &BackendKind,
) -> Result<Option<RelayMeshConfig>, String> {
    let Some(config) = config else {
        return Ok(None);
    };

    let model_ref = config.model_ref.trim();
    if model_ref.is_empty() {
        return Err("Colony shared compute model is required".to_string());
    }
    if backend != &BackendKind::Local {
        return Err("Colony shared compute agents must use the local backend".to_string());
    }

    Ok(Some(RelayMeshConfig {
        model_ref: model_ref.to_string(),
    }))
}

pub(super) fn trim_to_optional_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Normalizes an explicit linked-instance model choice before creation starts.
pub(super) fn requested_model_override(value: Option<&str>) -> Result<Option<String>, String> {
    let model_override = value.and_then(trim_to_optional_string);
    if value.is_some() && model_override.is_none() {
        return Err("Choose a model before creating this agent.".to_string());
    }
    Ok(model_override)
}

/// Applies the one existing linked-instance model authority during creation.
///
/// A linked record's `model` field is a materialized snapshot and does not
/// control launch resolution. A deliberate create-time choice must therefore
/// take the same `model_override` path as an edit before the record is saved.
pub(super) fn apply_create_model_override(
    record: &mut ManagedAgentRecord,
    requested_model_override: Option<String>,
) -> Result<(), String> {
    if let Some(model_override) = requested_model_override {
        crate::commands::agent_models::apply_linked_model_override(
            record,
            Some(Some(model_override)),
        )?;
    }
    Ok(())
}

pub(super) fn resolve_created_avatar_url(
    requested_avatar_url: Option<&str>,
    persona_avatar_url: Option<String>,
    agent_command: &str,
) -> Option<String> {
    requested_avatar_url
        .and_then(trim_to_optional_string)
        .or_else(|| {
            persona_avatar_url
                .as_deref()
                .and_then(trim_to_optional_string)
        })
        .or_else(|| managed_agent_avatar_url(agent_command))
}
