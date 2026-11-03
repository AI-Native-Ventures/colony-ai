use super::*;
use crate::managed_agents::AgentModelsResponse;

const CODEX_MODELS: &str =
    include_str!("../../tests/fixtures/agent_models/codex-debug-models.json");
const OPENCODE_MODELS: &str = include_str!("../../tests/fixtures/agent_models/opencode-models.txt");
const CLAUDE_ACP_MODELS: &str =
    include_str!("../../tests/fixtures/agent_models/claude-acp-models.json");

#[test]
fn codex_cli_catalog_exposes_supported_effort_variants_with_readable_names() {
    let response = parse_codex_model_catalog(CODEX_MODELS, None).expect("Codex catalog parses");

    let gpt_6 = response
        .models
        .iter()
        .filter(|model| model.id.starts_with("gpt-6-luna["))
        .map(|model| (model.id.as_str(), model.name.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(
        gpt_6,
        vec![
            ("gpt-6-luna[low]", Some("GPT-6 Luna (Low)")),
            ("gpt-6-luna[medium]", Some("GPT-6 Luna")),
            ("gpt-6-luna[high]", Some("GPT-6 Luna (High)")),
            ("gpt-6-luna[xhigh]", Some("GPT-6 Luna (Extra high)")),
            ("gpt-6-luna[max]", Some("GPT-6 Luna (Max)")),
        ]
    );
}

#[test]
fn opencode_cli_provider_model_rows_keep_ids_and_make_readable_labels() {
    let response = parse_opencode_model_list(OPENCODE_MODELS, None).expect("OpenCode list parses");

    assert_eq!(response.models.len(), 9);
    assert_eq!(response.models[0].id, "opencode/beam-free");
    assert_eq!(response.models[0].name.as_deref(), Some("Beam Free"));
    assert!(response.models.iter().any(|model| {
        model.id == "opencode/big-pickle" && model.name.as_deref() == Some("Big Pickle")
    }));
}

#[test]
fn opencode_cli_marks_a_default_when_the_cli_marks_one() {
    let response = parse_opencode_model_list("provider/model-a\n* provider/model-b\n", None)
        .expect("OpenCode list parses");

    assert_eq!(
        response.agent_default_model.as_deref(),
        Some("provider/model-b")
    );
}

#[test]
fn claude_acp_current_models_are_combined_with_cli_aliases() {
    let raw: serde_json::Value = serde_json::from_str(CLAUDE_ACP_MODELS).expect("ACP fixture JSON");
    let mut response = super::super::agent_models::normalize_agent_models(&raw, None);
    merge_claude_code_aliases(&mut response);

    assert_eq!(
        response.agent_default_model.as_deref(),
        Some("claude-sonnet-4-20250514")
    );
    assert!(response.models.iter().any(|model| {
        model.id == "claude-sonnet-4-20250514" && model.name.as_deref() == Some("Sonnet 4")
    }));
    assert!(response
        .models
        .iter()
        .any(|model| { model.id == "opus" && model.name.as_deref() == Some("Claude Opus") }));
    assert!(response.models.iter().any(|model| model.id == "sonnet"));
    assert!(response.models.iter().any(|model| model.id == "haiku"));
}

#[test]
fn codex_fallback_keeps_custom_escape_hatch_available_to_the_ui() {
    let response = fallback_codex_model_catalog(Some("custom-model".to_string()));

    assert_eq!(response.selected_model.as_deref(), Some("custom-model"));
    assert!(response.supports_switching);
    assert!(response
        .models
        .iter()
        .any(|model| model.id == "gpt-6-luna[max]"));
    assert!(response.models.iter().all(|model| model.id.contains('[')));
}

#[test]
fn opencode_fallback_has_a_short_known_list() {
    let response = fallback_opencode_model_catalog(None);

    assert_eq!(response.models.len(), 2);
    assert_eq!(response.models[0].id, "opencode/beam-free");
    assert_eq!(response.models[1].id, "opencode/big-pickle");
}

#[test]
fn merging_catalogs_keeps_native_order_and_acp_default() {
    let native = parse_codex_model_catalog(CODEX_MODELS, None).expect("Codex catalog parses");
    let secondary = AgentModelsResponse {
        agent_name: "codex-acp".to_string(),
        agent_version: "fixture".to_string(),
        models: vec![AgentModelInfo {
            id: "gpt-5.5[high]".to_string(),
            name: Some("GPT-5.5 High".to_string()),
            description: None,
        }],
        agent_default_model: Some("gpt-5.5[high]".to_string()),
        selected_model: None,
        supports_switching: true,
    };

    let merged = merge_model_responses(native, secondary);
    assert_eq!(merged.models[0].id, "gpt-6-luna[low]");
    assert_eq!(merged.agent_default_model.as_deref(), Some("gpt-5.5[high]"));
    assert!(merged
        .models
        .iter()
        .any(|model| model.id == "gpt-5.5[high]"));
}
