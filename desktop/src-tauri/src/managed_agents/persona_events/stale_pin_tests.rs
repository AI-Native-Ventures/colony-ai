//! Explicit per-agent runtime pins remain authoritative across persona snapshots.

use super::tests::{sample_persona, sample_record};
use crate::managed_agents::{apply_agent_command_update, record_agent_command};
use crate::managed_agents::persona_events::apply_persona_snapshot;
use crate::managed_agents::types::AgentDefinition;

#[test]
fn explicit_codex_pin_beats_persona_default_after_store_reload() {
    let persona = AgentDefinition {
        company_role: None,
        session_policy: Default::default(),
        runtime: Some("claude".to_string()),
        ..sample_persona()
    };
    let personas = [persona];
    let mut record = sample_record();

    let inherit_transition = apply_agent_command_update(&mut record, &personas, "codex", true);
    assert!(!inherit_transition);
    assert_eq!(record.agent_command_override.as_deref(), Some("codex"));

    let serialized = serde_json::to_vec(&record).expect("agent record serializes");
    let mut reloaded: crate::managed_agents::ManagedAgentRecord =
        serde_json::from_slice(&serialized).expect("agent record reloads");
    apply_persona_snapshot(&mut reloaded, &personas[0]);

    assert_eq!(reloaded.agent_command_override.as_deref(), Some("codex"));
    assert_eq!(
        record_agent_command(&reloaded, &personas),
        "codex",
        "persona runtime must not replace the owner's explicit Codex selection"
    );
}

#[test]
fn explicit_custom_command_pin_survives_persona_runtime_change() {
    let mut record = sample_record();
    record.agent_command_override = Some("my-custom-agent".to_string());
    let persona = AgentDefinition {
        company_role: None,
        session_policy: Default::default(),
        runtime: Some("goose".to_string()),
        ..sample_persona()
    };

    apply_persona_snapshot(&mut record, &persona);

    assert_eq!(
        record.agent_command_override.as_deref(),
        Some("my-custom-agent")
    );
    assert_eq!(record_agent_command(&record, &[persona]), "my-custom-agent");
}
